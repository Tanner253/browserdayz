// Raiding in the game (src/sim/build/raid.ts the rules, server/raid.ts the server's side). A blow that lands on a piece
// is told to the server, or played out here alone; a charge in the hands is stuck where the eye meets a base within
// reach, and burns there, beeping or fizzing, until it goes off: its fire and sound are this game's, what it breaks the
// server's (or this game's own, alone).

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { assets } from '../../core/assets';
import { audio } from '../../core/audio';
import { physics, SOLID_GROUPS, type Surface } from '../../core/physics';
import type { Input } from '../../core/input';
import { PIECES, TIERS, hpOf } from '../../sim/build/pieces';
import { RAID, blastOn, blowOf, fuseOf, struckAs } from '../../sim/build/raid';
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
}

/** the item in the hands that is a charge, by its id: the model it is drawn with */
const CHARGES: Record<string, string> = { c4: 'c4', satchel: 'satchel_charge' };
/** how a charge's light and sound go: C4's beep every second, faster in its last three; a satchel's fuse fizzing */
const LOOK = { beep: { every: 1, fast: 0.25, from: 3, heard: 40 }, fuse: { size: 0.035, smoke: 0.35, glow: 0.22, reach: 3 } };
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
}

const _dir = new THREE.Vector3(), _o = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const LED = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
const ledGeo = new THREE.SphereGeometry(0.004, 8, 6);
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
    if (!held || !CHARGES[held.id]) return null;
    const name = ITEMS[held.id].name.toLowerCase();
    const aim = this.aim();
    if (!aim) return card(`Stick the ${name}`, '', 'look at a wall, a door or a floor of a base, within reach');
    if (ok && this.h.input.pressed('Mouse0')) this.plant(held, aim.at, aim.n);
    return card(`Stick the ${name}`, `<small>here: ${RAID.charge[held.id].fuse[0] === RAID.charge[held.id].fuse[1] ? `${RAID.charge[held.id].fuse[0]} s` : 'a fuse of some seconds'}</small>`, 'then get clear', 'LMB');
  }

  /** where the eye meets a piece within reach of a charge, and the face it meets */
  private aim(): { at: THREE.Vector3; n: THREE.Vector3 } | null {
    const cam = this.h.camera();
    cam.getWorldDirection(_dir);
    const hit = physics.raycast(cam.getWorldPosition(_o), _dir, RAID.reach.plant, SOLID_GROUPS, this.h.player());
    if (!(hit?.tag?.owner instanceof PieceRef)) return null;
    const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    // (a face turned toward the eye: a ray's normal may come out of the far side of a thin leaf)
    if (n.dot(_dir) > 0) n.negate();
    return { at: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z), n };
  }

  private plant(it: ItemInstance, at: THREE.Vector3, n: THREE.Vector3) {
    audio.ui('pickup');
    if (this.h.online()) return void this.h.send({ t: 'bplant', w: it.id, u: it.uid, at: [at.x, at.y, at.z], n: [n.x, n.y, n.z] });
    this.h.take(it.id, 1);
    this.h.changed();
    this.add(this.next--, it.id, at.clone().addScaledVector(n, 0.04), n, fuseOf(it.id, Math.random()), true);
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

  private add(i: number, w: string, at: THREE.Vector3, n: THREE.Vector3, f: number, mine: boolean) {
    const was = this.charges.get(i);
    if (was) {
      was.f = f;
      return;
    }
    const d: Drawn = { i, w, at, n: n.clone().normalize(), f, obj: null, beepT: 0, mine };
    this.charges.set(i, d);
    void this.model(w).then((src) => {
      if (this.charges.get(i) !== d) return;
      const obj = src.clone();
      const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
      // Its front (+x, the C4's keypad and the satchel's flap) out along the face it is stuck to, its top up the wall;
      // stuck to a floor or a ceiling, its top away from whoever stuck it.
      _x.copy(d.n);
      _y.set(0, 1, 0);
      if (Math.abs(_x.dot(_y)) > 0.85) _y.copy(d.at).sub(this.h.me()).setY(0).normalize();
      _y.addScaledVector(_x, -_y.dot(_x)).normalize();
      _z.crossVectors(_x, _y);
      obj.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
      // (it stands about its own middle on its foot: its back on the face, its middle where it was stuck)
      obj.position.copy(d.at).addScaledVector(_x, size.x / 2 - 0.04).addScaledVector(_y, -size.y / 2);
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      if (w === 'c4') {
        // (the timer's light, on the face by its little screen)
        d.led = new THREE.Mesh(ledGeo, LED);
        d.led.position.set(size.x / 2 + 0.002, size.y * 0.82, size.z * 0.3);
        obj.add(d.led);
      }
      this.h.scene.add(obj);
      d.obj = obj;
    });
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
    for (const d of [...this.charges.values()]) {
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
        const every = d.f < LOOK.beep.from ? LOOK.beep.fast : LOOK.beep.every;
        d.beepT -= dt;
        if (d.beepT <= 0) {
          d.beepT = every;
          if (far < LOOK.beep.heard) audio.beep(d.at);
        }
        if (d.led) d.led.visible = d.beepT > every * 0.6;
      } else {
        // (the satchel's fuse, burning where it comes out of the bag's top)
        const tip = _o.copy(d.at).addScaledVector(d.n, 0.1).add(_y.set(0, 0.12, 0));
        d.fire ??= this.h.flames().add(tip.clone(), { size: LOOK.fuse.size, smoke: LOOK.fuse.smoke });
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
    this.add(m.i, m.w, new THREE.Vector3(...m.o), new THREE.Vector3(...m.n), m.f, false);
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
  /** focus gone (Game.letGo) */
  letGo() {}
  /** the server gone (back alone): its charges with it */
  clear() {
    for (const d of [...this.charges.values()]) if (!d.mine) this.drop(d);
  }
}
