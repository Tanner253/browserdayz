// Raiding in the game (src/sim/build/raid.ts the rules, src/sim/build/charges.ts every figure of a charge, server/raid.ts
// the server's side). A blow that lands on a piece is told to the server, or played out here alone. A charge is Rust's
// timed explosive (the owner, 2026-10-25: "touching the c4 multiple times like input buttons, and then throwing the C4
// like a grenade, doesnt explode until it is thrown, and also takes 30 seconds to explode, beeps loudly for people in
// proximity to hear, like rust"): armed in the hands, its keys pressed a beat at a time; thrown as a grenade is; stuck to
// whatever it strikes first, or lying where it falls; beeping, faster at the end, or fizzing, until it goes off. Its
// flight, fire and sound are this game's, its fuse and what it breaks the server's (or this game's own, alone).

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { assets } from '../../core/assets';
import { audio } from '../../core/audio';
import { physics, SOLID_GROUPS, type Surface } from '../../core/physics';
import type { Input } from '../../core/input';
import { PIECES, TIERS, hpOf } from '../../sim/build/pieces';
import { RAID, blastOn, blowOf, fuseOf, struckAs } from '../../sim/build/raid';
import { NADE } from '../../sim/grenades';
import type { Bases } from '../../sim/build/bases';
import type { BaseSolids } from '../../sim/build/solid';
import { toWorld, type Base, type Piece } from '../../sim/build/snap';
import { HAMMERS, worn } from '../../sim/gather';
import { ITEMS, type ItemInstance } from '../../sim/items';
import type { C2S, S2C } from '../../net/protocol';
import { PieceRef } from './draw';
import type { TorchHost } from './torches';

export interface RaidHost {
  scene: THREE.Scene;
  input: Input;
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  held: () => ItemInstance | null;
  camera: () => THREE.Camera;
  player: () => RAPIER.Collider | undefined;
  me: () => THREE.Vector3;
  take: (id: string, n: number) => void;
  changed: () => void;
  flames: TorchHost['flames'];
  glow: TorchHost['glow'];
  /** a blast gone off: its fire and its sound, and alone, what it does to this game's own bodies (Game.explode) */
  explode: (at: THREE.Vector3, mine: boolean, w: string) => void;
  /** pieces of a base broken alone, in this game's own copy of it */
  broken: (b: Base, ids: number[]) => void;
  /** chips and dust off a surface where something struck it (Effects.impact, with no mark left) */
  impact: (surface: Surface, at: THREE.Vector3, normal: THREE.Vector3) => void;
  /** this player's number online: a charge the server tells of that this game threw */
  myId: () => number;
  charge: {
    /** the hands at its keys for `dur` seconds, in first person and as everybody sees them */
    arm: (w: string, dur: number) => void;
    /** armed: up in the one fist to throw */
    ready: (w: string) => void;
    /** let down again, not thrown */
    unarm: () => void;
    /** thrown: where it leaves the hand and how fast, the hand going on through the throw (Game.tossCharge) */
    toss: () => { o: THREE.Vector3; v: THREE.Vector3 };
  };
}

/** the item in the hands that is a charge, by its id: the model it is drawn with */
const CHARGES: Record<string, string> = { c4: 'c4', satchel: 'satchel_charge' };
/**
 * How a charge's light and sound go. A C4 beeps loud, heard by anybody within `heard` metres, once a second; twice a
 * second in its last ten, five times in its last three (`steps`: seconds left, seconds between beeps), its light lit at
 * each beep; the keys pressed as it is armed give a small beep each (`at`: how far through a key's beat). A satchel's fuse
 * fizzes.
 */
const LOOK = {
  beep: { steps: [[10, 1], [3, 0.5], [0, 0.2]] as [number, number][], heard: 70, glow: 0.9, reach: 2.5 },
  key: { at: 0.5 },
  fuse: { size: 0.035, smoke: 0.35, glow: 0.22, reach: 3 },
};
/** a thrown charge: how near a surface it stops (its middle off it, metres), and how long it is flown at most */
const FLY = { radius: 0.05, most: 8 };
/** a piece coming down: how many bursts of chips and dust over it, how far out from its middle, and how many pieces of one
 * message are heard and seen (a whole base rotting at once is not a hundred crashes) */
const BREAK = { bursts: 9, spread: 1.3, most: 4, seen: 90 };
/** what flies off a piece of each tier when it breaks or is struck */
const SURFACE: Surface[] = ['wood', 'wood', 'concrete', 'metal', 'metal'];

interface Drawn {
  i: number;
  w: string;
  at: THREE.Vector3;
  n: THREE.Vector3;
  /** seconds left (-1: it did not go off) */
  f: number;
  obj: THREE.Object3D | null;
  led?: THREE.Mesh;
  beepT: number;
  fire?: ReturnType<ReturnType<TorchHost['flames']>['add']>;
  hiss?: { stop: () => void };
  /** alone: this game's own charge, who goes off by its own count */
  mine: boolean;
  /** in the air, this fast, and for how long so far */
  vel?: THREE.Vector3;
  flown: number;
  /** come to rest (stuck, or lying where it fell) */
  stuck: boolean;
  /** online, thrown from here: where it stuck is this game's to tell; `want`, its number not yet heard from the server */
  own?: boolean;
  want?: boolean;
}

const _step = new THREE.Vector3(), _dir = new THREE.Vector3(), _o = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const LED = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
const ledGeo = new THREE.SphereGeometry(0.0075, 10, 8);
const RED = new THREE.Color(1, 0.12, 0.06);
const card = (head: string, line: string, keys: string, kbd?: string) => `<span class="bc">${kbd ? `<kbd>${kbd}</kbd>` : ''}<b>${head}</b>${line ? ` ${line}` : ''}<i>${keys}</i></span>`;

export class RaidView {
  private charges = new Map<number, Drawn>();
  private next = -1;
  /** the piece last struck, and till when its health is shown */
  private hit: { b: number; p: number; until: number } | null = null;
  /** when each piece was last struck from here, by `b:p` (it is not mended for a while after: src/sim/build/bases.ts MEND) */
  private struck = new Map<string, number>();
  struckAt = (b: number, p: number) => this.struck.get(`${b}:${p}`) ?? 0;
  /** a piece struck now (a blow, a blast, or the server's word that it lost health) */
  mark = (b: number, p: number) => void this.struck.set(`${b}:${p}`, Date.now());
  private toldAt = 0;
  private models = new Map<string, Promise<THREE.Object3D>>();
  /** a charge being armed in the hands: how long, how many of its keys pressed, armed, and the button still down */
  private arming: { it: ItemInstance; t: number; taps: number; armed: boolean; button: boolean } | null = null;

  constructor(private h: RaidHost, private store: () => Bases, private solids: BaseSolids) {}

  // ---- a blow

  /** a swing that landed on a piece (Weapons.onWhack) */
  whack(ref: PieceRef, at: THREE.Vector3, weapon: string) {
    const it = this.h.held();
    if (!it || it.id !== weapon || HAMMERS[weapon]) return;
    const base = this.store().bases.get(ref.b), p = base?.pieces.get(ref.p);
    if (!base || !p) return;
    this.hit = { b: base.id, p: p.id, until: performance.now() + 2500 };
    const dmg = blowOf(weapon, p);
    // (the weight of a sledgehammer or a pickaxe landing on stone or steel, over the hit the swing makes of itself)
    if (dmg > 0 && struckAs(p) >= 2) audio.sledge(at);
    if (dmg > 0) this.mark(base.id, p.id);
    if (dmg <= 0) {
      if (performance.now() - this.toldAt > 4000) {
        this.toldAt = performance.now();
        this.h.note(`A ${ITEMS[weapon]?.name.toLowerCase() ?? 'blow'} does nothing to ${TIERS[struckAs(p)]?.toLowerCase() ?? 'it'}: ${struckAs(p) >= 3 ? 'it takes a charge' : 'a pickaxe or a sledgehammer, or a charge'}`, 'info');
      }
      return;
    }
    if (this.h.online()) return void this.h.send({ t: 'bhit', b: base.id, p: p.id, u: it.uid, at: [at.x, at.y, at.z] });
    it.cond = worn(it.id, it.cond);
    p.hp -= dmg;
    if (p.hp <= 0) {
      this.broke(base, [p.id]);
      this.h.broken(base, [p.id]);
    }
    this.h.changed();
  }

  /** the health of the piece last struck, for a moment after (the card under the crosshair) */
  shown(): string | null {
    if (!this.hit || performance.now() > this.hit.until) return null;
    const p = this.store().bases.get(this.hit.b)?.pieces.get(this.hit.p);
    if (!p) return null;
    const max = hpOf(p.k, p.t), k = Math.max(0, Math.min(1, p.hp / max));
    return card(PIECES[p.k].name, `<small>${TIERS[struckAs(p)] ?? ''}</small> <span class="bhp"><span style="width:${Math.round(k * 100)}%"></span></span> <small>${Math.max(0, Math.round(p.hp))} / ${max}</small>`, '');
  }

  // ---- a charge in the hands, and those lying unlit

  /** what the left button does with a charge in the hands, and F at one that did not go off: the card it shows */
  frame(ok: boolean): string | null {
    const held = this.h.held();
    const dud = this.dudLooked();
    if (dud) {
      if (ok && this.h.input.pressed('KeyF')) this.light(dud);
      return card('Light it again', `<small>the ${dud.w === 'c4' ? 'C4' : 'satchel charge'} did not go off</small>`, '', 'F');
    }
    const a = this.arming;
    if (a && (!held || held.uid !== a.it.uid)) this.arming = null;
    if (!held || !CHARGES[held.id]) return null;
    const name = ITEMS[held.id].name.toLowerCase(), C = RAID.charge[held.id];
    const fuse = C.fuse[0] === C.fuse[1] ? `${C.fuse[0]} s` : `${C.fuse[0]} to ${C.fuse[1]} s`;
    if (!this.arming) {
      if (ok && this.h.input.pressed('Mouse0')) this.beginArm(held);
      return card(`Arm the ${name}`, `<small>then throw it: it sticks where it lands, ${fuse} after</small>`, '', 'LMB');
    }
    // (the other button lets it down again, unthrown)
    if (ok && this.h.input.pressed('Mouse2')) {
      this.arming = null;
      this.h.charge.unarm();
      return null;
    }
    return this.arming.armed ? card(`Throw the ${name}`, `<small>${fuse} from the throw</small>`, 'let go to throw', 'LMB') : card(held.id === 'c4' ? 'Arming the C4' : 'Lighting the satchel', '', '');
  }

  private beginArm(it: ItemInstance) {
    this.arming = { it, t: 0, taps: 0, armed: false, button: true };
    this.h.charge.arm(it.id, RAID.charge[it.id].arm);
  }

  /** the charge being armed: its keys pressed, armed, and thrown when the button is let go (a tap: as soon as it is armed) */
  private armFrame(dt: number) {
    const a = this.arming!, C = RAID.charge[a.it.id];
    a.t += dt;
    a.button &&= this.h.input.held('Mouse0');
    const per = C.arm / Math.max(1, C.taps);
    while (a.taps < C.taps && a.t >= (a.taps + LOOK.key.at) * per) {
      a.taps++;
      if (a.it.id === 'c4') audio.beep(this.handAt(), true);
      else audio.ui('pickup');
    }
    if (!a.armed && a.t >= C.arm) {
      a.armed = true;
      this.h.charge.ready(a.it.id);
    }
    if (a.armed && !a.button) this.toss(a.it);
  }

  /** where the hand is: a little ahead of the eye, below it */
  private handAt() {
    const cam = this.h.camera();
    return cam.getWorldPosition(new THREE.Vector3()).add(cam.getWorldDirection(_dir).multiplyScalar(0.4)).setY(cam.getWorldPosition(_o).y - 0.15);
  }

  /** thrown: flown here from the hand; online the server is told and counts its fuse from now, alone this game does */
  private toss(it: ItemInstance) {
    this.arming = null;
    const { o, v } = this.h.charge.toss();
    const d = this.add(this.next--, it.id, o, new THREE.Vector3(0, 1, 0), fuseOf(it.id, Math.random()), !this.h.online(), v);
    if (!this.h.online()) {
      this.h.take(it.id, 1);
      this.h.changed();
      return;
    }
    d.own = d.want = true;
    this.h.send({ t: 'bthrow', w: it.id, u: it.uid, o: [o.x, o.y, o.z], v: [v.x, v.y, v.z] });
  }

  private light(d: Drawn) {
    if (this.h.online()) return void this.h.send({ t: 'blight', i: d.i });
    d.f = fuseOf(d.w, Math.random());
  }

  /** a charge that did not go off, looked at within reach */
  private dudLooked(): Drawn | null {
    const cam = this.h.camera();
    cam.getWorldDirection(_dir);
    cam.getWorldPosition(_o);
    let best: Drawn | null = null, bestD = RAID.reach.plant;
    for (const d of this.charges.values()) {
      if (d.f >= 0) continue;
      const to = _x.copy(d.at).sub(_o), along = to.dot(_dir);
      if (along <= 0 || along > bestD) continue;
      if (to.addScaledVector(_dir, -along).length() < 0.25) {
        best = d;
        bestD = along;
      }
    }
    return best;
  }

  // ---- drawn

  private model(w: string): Promise<THREE.Object3D> {
    let p = this.models.get(w);
    if (!p) this.models.set(w, (p = assets.model(CHARGES[w])));
    return p;
  }

  /** @param vel in the air, thrown this fast from `at` (flown here till it strikes something) */
  private add(i: number, w: string, at: THREE.Vector3, n: THREE.Vector3, f: number, mine: boolean, vel?: THREE.Vector3): Drawn {
    const was = this.charges.get(i);
    if (was) {
      was.f = f;
      return was;
    }
    const d: Drawn = { i, w, at, n: n.clone().normalize(), f, obj: null, beepT: 0, mine, vel: vel?.clone(), flown: 0, stuck: !vel };
    this.charges.set(i, d);
    void this.model(w).then((src) => {
      if (this.charges.get(d.i) !== d) return;
      const obj = src.clone();
      const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
      // (the model about its own middle, so that it turns about that in the air and is set down from it)
      const mid = box.getCenter(new THREE.Vector3());
      const body = new THREE.Group();
      obj.position.sub(mid);
      body.add(obj);
      body.userData.size = size;
      body.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      if (w === 'c4') {
        // (the timer's light, on the face by its little screen)
        d.led = new THREE.Mesh(ledGeo, LED);
        d.led.position.set(size.x / 2 + 0.003, size.y * 0.32, size.z * -0.2);
        body.add(d.led);
      }
      this.h.scene.add(body);
      d.obj = body;
      if (d.stuck) this.place(d);
      else body.position.copy(d.at);
    });
    return d;
  }

  /** set where it came to rest: its front (+x, the C4's keypad and the satchel's flap) out along the face it is stuck to,
   * its top up the wall; on a floor or the ground, its top away from whoever is looking */
  private place(d: Drawn) {
    const obj = d.obj;
    if (!obj) return;
    const size = obj.userData.size as THREE.Vector3;
    _x.copy(d.n);
    _y.set(0, 1, 0);
    if (Math.abs(_x.dot(_y)) > 0.85) _y.copy(d.at).sub(this.h.me()).setY(0).normalize();
    if (_y.lengthSq() < 1e-6) _y.set(0, 0, 1);
    _y.addScaledVector(_x, -_y.dot(_x)).normalize();
    _z.crossVectors(_x, _y);
    obj.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    // (its back on the face: `at` is a hand's breadth off it)
    obj.position.copy(d.at).addScaledVector(_x, size.x / 2 - 0.04);
  }

  /** a thrown charge through the air in small steps, till it strikes the world or anything built: there it stays */
  private fly(d: Drawn, dt: number) {
    d.flown += dt;
    let left = dt;
    while (left > 0 && d.vel) {
      const h = Math.min(left, 1 / 120);
      left -= h;
      d.vel.y -= NADE.fall * h;
      const len = _step.copy(d.vel).multiplyScalar(h).length();
      if (len < 1e-6) break;
      _dir.copy(_step).divideScalar(len);
      const hit = physics.raycast(d.at, _dir, len + FLY.radius, SOLID_GROUPS, this.h.player());
      if (!hit) {
        d.at.add(_step);
        continue;
      }
      d.at.addScaledVector(_dir, hit.toi);
      d.n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      if (d.n.dot(_dir) > 0) d.n.negate();
      d.at.addScaledVector(d.n, 0.04);
      audio.impact((hit.tag?.surface ?? 'dirt') as Surface, d.at, 0);
      this.land(d);
    }
    if (d.vel && d.flown > FLY.most) {
      d.n.set(0, 1, 0);
      this.land(d);
    }
    if (d.vel && d.obj) {
      d.obj.position.copy(d.at);
      d.obj.rotation.x += 9 * dt;
      d.obj.rotation.y += 3 * dt;
    }
  }

  private land(d: Drawn) {
    d.vel = undefined;
    d.stuck = true;
    this.place(d);
    if (d.own && !d.want) this.tellStuck(d);
  }

  private tellStuck(d: Drawn) {
    this.h.send({ t: 'bstick', i: d.i, at: [d.at.x, d.at.y, d.at.z], n: [d.n.x, d.n.y, d.n.z] });
  }

  private drop(d: Drawn) {
    this.charges.delete(d.i);
    if (d.obj) this.h.scene.remove(d.obj);
    if (d.fire) this.h.flames().remove(d.fire);
    d.hiss?.stop();
  }

  /** where a piece's middle is in the world, near enough: a floor's just under its top, anything else's half way up */
  private middle(base: Base, p: Piece) {
    const K = PIECES[p.k], up = K.role === 'floor' ? -0.1 : (K.h ?? (K.role === 'deploy' ? 0.6 : 1.2)) / 2;
    return new THREE.Vector3(...toWorld(base, p.x, p.y + up, p.z));
  }

  /** pieces about to go (broken by a raid, rotted, or taken down): each heard coming down, and its chips and dust thrown */
  broke(base: Base, ids: number[]) {
    const me = this.h.me();
    let n = 0;
    for (const id of ids) {
      const p = base.pieces.get(id);
      if (!p || n >= BREAK.most) continue;
      const at = this.middle(base, p);
      if (at.distanceTo(me) > BREAK.seen) continue;
      n++;
      const tier = struckAs(p);
      audio.breakPiece(tier, at);
      for (let k = 0; k < BREAK.bursts; k++) {
        const off = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 2).multiplyScalar(BREAK.spread);
        this.h.impact(SURFACE[tier] ?? 'wood', at.clone().add(off), off.clone().normalize());
      }
    }
  }

  update(dt: number) {
    if (this.arming) this.armFrame(dt);
    for (const d of [...this.charges.values()]) {
      if (d.vel) this.fly(d, dt);
      if (d.f < 0) {
        if (d.fire) {
          this.h.flames().remove(d.fire);
          d.fire = undefined;
        }
        d.hiss?.stop();
        d.hiss = undefined;
        if (d.led) d.led.visible = false;
        continue;
      }
      d.f = Math.max(0, d.f - dt);
      const far = d.at.distanceTo(this.h.me());
      if (d.w === 'c4') {
        const every = LOOK.beep.steps.find(([from]) => d.f > from)?.[1] ?? 0.2;
        d.beepT -= dt;
        if (d.beepT <= 0) {
          d.beepT = Math.min(every, d.beepT + every);
          if (far < LOOK.beep.heard) audio.beep(d.at);
        }
        const lit = d.beepT > every * 0.6;
        if (d.led) {
          d.led.visible = lit;
          if (lit && far < 40) this.h.glow(d.led.getWorldPosition(_o), RED, LOOK.beep.glow, LOOK.beep.reach);
        }
      } else {
        // (the satchel's fuse, burning where it comes out of the bag's top)
        const tip = _o.copy(d.at).addScaledVector(d.n, 0.1).add(_y.set(0, 0.12, 0));
        // (flown, its fuse goes with it: lit again where it comes to rest)
        if (d.fire && !d.stuck) {
          this.h.flames().remove(d.fire);
          d.fire = undefined;
        }
        if (d.stuck) d.fire ??= this.h.flames().add(tip.clone(), { size: LOOK.fuse.size, smoke: LOOK.fuse.smoke });
        d.hiss ??= audio.fuse(d.at);
        this.h.glow(tip, new THREE.Color(1, 0.62, 0.3), LOOK.fuse.glow * (0.8 + Math.random() * 0.4), LOOK.fuse.reach);
      }
      // (alone, this game's own charge goes off by its own count; online the server says when)
      if (d.mine && d.f <= 0) this.goOff(d);
    }
  }

  /** alone: a charge of this game's own gone off, or not */
  private goOff(d: Drawn) {
    if (Math.random() < RAID.charge[d.w].dud) {
      d.f = -1;
      return;
    }
    this.drop(d);
    const by = new Map<Base, number[]>();
    for (const { base, p, hp } of blastOn(this.solids, [d.at.x, d.at.y, d.at.z], d.w, [d.n.x, d.n.y, d.n.z])) {
      this.mark(base.id, p.id);
      if (hp > 0) p.hp = hp;
      else {
        if (!by.has(base)) by.set(base, []);
        by.get(base)!.push(p.id);
      }
    }
    for (const [base, ids] of by) {
      this.broke(base, ids);
      this.h.broken(base, ids);
    }
    this.h.explode(d.at.clone(), true, d.w);
  }

  // ---- what the server says

  onCharge(m: Extract<S2C, { t: 'bcharge' }>) {
    let d = this.charges.get(m.i);
    // (the one this game threw, numbered now: told where it stuck, if it already has)
    if (!d && m.v && m.by === this.h.myId()) {
      d = [...this.charges.values()].find((x) => x.want && x.w === m.w);
      if (d) {
        this.charges.delete(d.i);
        d.i = m.i;
        d.want = false;
        this.charges.set(d.i, d);
        if (d.stuck) this.tellStuck(d);
      }
    }
    if (!d) return void this.add(m.i, m.w, new THREE.Vector3(...m.o), new THREE.Vector3(...m.n), m.f, false, m.v ? new THREE.Vector3(...m.v) : undefined);
    d.f = m.f;
    // (where its thrower's game says it stuck, for everybody else's)
    if (!m.v && !d.own) {
      d.at.set(...m.o);
      d.n.set(...m.n);
      d.vel = undefined;
      d.stuck = true;
      this.place(d);
    }
  }
  onBoom(m: Extract<S2C, { t: 'bboom' }>) {
    const d = this.charges.get(m.i);
    if (d) this.drop(d);
    this.h.explode(new THREE.Vector3(...m.o), false, m.w);
  }
  onFizz(m: Extract<S2C, { t: 'bfizz' }>) {
    const d = this.charges.get(m.i);
    if (d) this.drop(d);
  }
  /** focus gone (Game.letGo): a charge being armed is let down, not thrown */
  letGo() {
    if (!this.arming) return;
    this.arming = null;
    this.h.charge.unarm();
  }
  /** the server gone (back alone): its charges with it */
  clear() {
    for (const d of [...this.charges.values()]) if (!d.mine) this.drop(d);
  }
}
