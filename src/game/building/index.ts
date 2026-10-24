// Base building as the game has it (2026-10-24, the second step; the rules are src/sim/build/, the server's side
// server/build.ts). Rust's two tools, the owner: "We will need a building hammer and blueprint paper like rust has or
// equivilent solution ... why change something thats not broken".
//   The building plan in the hands: a ghost of the chosen piece snaps to the nearest place it can go, pale blue where it
//   can and red with the reason where it cannot; the left button lays it as a frame; R turns it; the right button held
//   is the wheel of pieces (one radial menu for the game, src/ui/radial.ts; the owner: "the bottom option for the radial
//   wheel should always be cancel").
//   The hammer in the hands, looking at a piece: the left button held nails it up a tier; the right button held is the
//   hammer's wheel: wood, stone, metal, take it down.
// Online, what is built is the server's: this game shows what it says and asks it for what the player does. Alone,
// this game's own store is the world's, by the same rules.

import * as THREE from 'three';
import { physics, SOLID_GROUPS } from '../../core/physics';
import { audio } from '../../core/audio';
import type { Input } from '../../core/input';
import type { Atmosphere } from '../../world/atmosphere';
import { heightAt, type World } from '../../world/worldgen';
import { Radial } from '../../ui/radial';
import { Bases, heard, heardClaim, heardPiece, said, type KeptBase } from '../../sim/build/bases';
import { PIECES, TIERS, TIER_S, costOf, hpOf, laidAt, type Tier } from '../../sim/build/pieces';
import { deployAt, nearestSpot, nearestToRay, restsOn, spots, toLocal, toWorld, worldYaw, type Base, type Spot } from '../../sim/build/snap';
import { Solids, noBuilding, wetAt } from '../../sim/build/land';
import { HAMMERS, condition, worn } from '../../sim/gather';
import { ITEMS, makeItem, type ItemInstance } from '../../sim/items';
import type { C2S, S2C } from '../../net/protocol';
import { BaseDraw, PieceRef } from './draw';
import { ClaimView } from './claims';
import { publicId } from '../../net/client';
import type { Stash } from '../loot';
import { ghostGeometry } from './look';
import { CATS, HAMMER_PER, HAMMER_WHEEL, PER, RINGS, hammerEntries, outerOf, piecesOf, planEntries } from './wheel';
import { DoorView } from './doors';
import { BoxView } from './boxes';

export interface BuildHost {
  scene: THREE.Scene;
  atmo: Atmosphere;
  world: World;
  input: Input;
  camera: () => THREE.Camera;
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  held: () => ItemInstance | null;
  me: () => THREE.Vector3;
  yaw: () => number;
  /** how many of a thing are carried; so many taken out; things put in (at the feet what finds no room) */
  count: (id: string) => number;
  take: (id: string, n: number) => void;
  give: (items: ItemInstance[], gift: string) => void;
  begin: (label: string, dur: number, valid: () => boolean, done: () => void, lost: string) => void;
  busy: () => boolean;
  breakOff: () => void;
  changed: () => void;
  /** the felled trees (a stump is no trunk) */
  felled: (i: number) => boolean;
  /** where the wheels go (asked when one is first opened: the game makes its screen after this) */
  hud: () => HTMLElement;
  player: () => import('@dimforge/rapier3d-compat').Collider | undefined;
  /** a store opened in the inventory (a claim's) */
  open: (s: Stash) => void;
  /** the player's name, as their claim's members are listed */
  name: () => string;
}

/** how far the pointer goes to reach each ring (of the wheel's reach) */
const RING = { pick: 0.22, outer: 0.66, reach: 260 };
/** a player who lays is told nothing of a refusal they have already been told, for this long */
const SAID_AGAIN = 1500;

const _dir = new THREE.Vector3();

/** the building's card under the crosshair (hud.css .bc): what it is, what it takes, the keys */
const card = (head: string, line: string, keys: string, kbd?: string) => `<span class="bc">${kbd ? `<kbd>${kbd}</kbd>` : ''}<b>${head}</b>${line ? ` ${line}` : ''}<i>${keys}</i></span>`;

/** so many of a thing, said as a person says it: 2 logs, 4 planks, 30 stone */
export const amount = (id: string, n: number, more = '') => `${n} ${more}${ITEMS[id].name.toLowerCase()}${id === 'log' && n !== 1 ? 's' : ''}`;

export class Building {
  /** played alone: this game's own bases; online: what the server has told of them */
  private local: Bases;
  private seen: Bases;
  readonly draw: BaseDraw;
  /** the chosen piece, and the turn asked for (R) */
  kind = 'foundation';
  private turn = 0;
  /** the ghost: one for each kind, its paint pale blue or red */
  private ghost: THREE.Mesh | null = null;
  private ghostKind = '';
  private ok = new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
  private bad = new THREE.MeshBasicMaterial({ color: 0xee7a6e, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
  /** spots worked out for a base, kept until it or the choice changes */
  private cache: { key: string; list: Spot[] } | null = null;
  private versions = new Map<number, number>();
  /** the last 'spent' taken out of the pockets (said back to the server in 'me') */
  sp = 0;
  /** the plan's wheel and the hammer's, and whichever was opened last */
  private wheels: { plan: Radial; hammer: Radial };
  private wheel: Radial;
  private wheelFor: 'plan' | 'hammer' | null = null;
  private wheelAt = new THREE.Vector2();
  private wheelCat = 0;
  private wheelPick = -1;
  private toldAt = 0;
  private told = '';
  /** what the corner says (the game puts it under the crosshair) */
  prompt: string | null = null;

  constructor(private h: BuildHost) {
    const solids = new Solids(h.world.trees, h.world.rocks), wet = wetAt(h.world.water, (x, z) => heightAt(h.world.heights, x, z));
    const land = {
      ground: (x: number, z: number) => heightAt(h.world.heights, x, z),
      why: (x: number, z: number) => noBuilding(x, z, h.world.pois, h.world.buildings, h.world.spawns, wet),
      solids: (x: number, z: number, within: number) => solids.near(x, z, within, h.felled),
    };
    this.local = new Bases(land);
    this.seen = new Bases(land);
    this.draw = new BaseDraw(h.scene, h.atmo);
    this.claims = new ClaimView({ input: h.input, online: h.online, send: h.send, note: h.note, me: h.me, who: () => this.me, name: h.name, open: h.open, hud: h.hud, broke: (b, ids) => this.draw.remove(b.id, ids), changed: (b) => this.bump(b.id) }, () => this.store);
    const wheel = (per: number) => new Radial({ rings: RINGS, per, className: 'hud-wheel', tick: () => audio.click(2600, 0.05, 0.008), chose: () => audio.click(1500, 0.12, 0.018) });
    this.wheels = { plan: wheel(PER), hammer: wheel(HAMMER_PER) };
    this.wheel = this.wheels.plan;
    this.boxes = new BoxView(h.input, h.open);
    this.doors = new DoorView({ input: h.input, online: h.online, send: h.send, note: h.note, me: h.me, camera: h.camera }, () => this.store, this.draw);
  }

  private get store() {
    return this.h.online() ? this.seen : this.local;
  }
  /** a wheel is up: the view does not turn, and the hands do nothing else */
  get wheelOpen() {
    return this.wheel.isOpen;
  }

  /** who the player is to a base: their public id online (as their dog tag has it), 'me' alone */
  private get me() {
    return this.h.online() ? publicId() : 'me';
  }
  /** claims: their stores, joining, the chip at the top (src/game/building/claims.ts) */
  readonly claims: ClaimView;
  /** doors, hatches, shutters and gates: F swings them (src/game/building/doors.ts) */
  readonly doors: DoorView;
  /** boxes: F opens their stores (src/game/building/boxes.ts) */
  readonly boxes: BoxView;

  /** a base's stores (its claim's, its boxes') as it now stands */
  private synced(b: Base) {
    this.claims.sync(b);
    this.boxes.sync(b);
  }

  // ---- every frame

  update(dt: number, ok: boolean) {
    const held = this.h.held();
    const plan = ok && held?.id === 'building_plan', hammer = ok && !!held && !!HAMMERS[held.id];
    this.prompt = null;
    this.draw.update(dt, this.h.me());
    if (this.wheel.isOpen) this.wheelFrame(ok && (plan || hammer));
    else if (ok && (plan || hammer) && this.h.input.pressed('Mouse2') && !this.h.busy()) this.openWheel(plan ? 'plan' : 'hammer');
    if (plan && !this.wheel.isOpen) this.planFrame(held!);
    else this.hideGhost();
    if (hammer && !this.wheel.isOpen) this.hammerFrame(held!);
    // (a claim looked at: F opens its store, held it joins; a door: F swings it. Whatever is in the hands, though the
    // plan's and the hammer's cards say more of what is looked at than that)
    const free = ok && !this.wheel.isOpen && !this.h.busy(), t = ok ? this.target() : null;
    const claim = this.claims.frame(dt, free, t);
    if (claim) this.prompt = claim;
    const door = this.doors.frame(free, t) ?? this.boxes.frame(free, t);
    if (door && !plan && !hammer) this.prompt = door;
    // (while the hands are at it, the ring round the crosshair says what they are doing: the card stands aside)
    if (this.h.busy()) this.prompt = null;
  }

  // ---- the plan

  private planFrame(plan: ItemInstance) {
    const input = this.h.input, cam = this.h.camera();
    if (input.pressed('KeyR')) this.turn = (this.turn + 1) % 12;
    cam.getWorldDirection(_dir);
    const from = cam.getWorldPosition(new THREE.Vector3());
    const hit = physics.raycast(from, _dir, 9, SOLID_GROUPS, this.h.player()) ?? this.ontoGround(from);
    const at = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : from.clone().addScaledVector(_dir, 6);
    const K = PIECES[this.kind];
    // (the base aimed at: the nearest with a piece near the aim)
    const near = this.store.near(at.x, at.z, 14);
    let best: { base: Base; s: Spot; d: number } | null = null;
    // (the place nearest the line of sight, out to a little past what the aim meets; else the nearest where it meets)
    const far = (hit ? from.distanceTo(at) : 6) + 1.5;
    for (const b of near) {
      const [fx, fy, fz] = toLocal(b, from.x, from.y, from.z), [tx, ty, tz] = toLocal(b, from.x + _dir.x, from.y + _dir.y, from.z + _dir.z);
      const list = this.spotsOf(b), [lx, ly, lz] = toLocal(b, at.x, at.y, at.z);
      const s = nearestToRay(list, this.kind, { x: fx, y: fy, z: fz }, { x: tx - fx, y: ty - fy, z: tz - fz }, far) ?? nearestSpot(list, this.kind, { x: lx, y: ly, z: lz }, 3.4);
      if (!s) continue;
      const [wx, wy, wz] = toWorld(b, s.x, s.y, s.z), d = Math.hypot(wx - at.x, wy - at.y, wz - at.z);
      if (!best || d < best.d) best = { base: b, s, d };
    }
    let ask: { b?: number; k: string; x: number; y: number; z: number; r: number; yaw?: number } | null = null;
    // (a thing set down goes where the aim meets a floor, turned as R turns it)
    if (K.role === 'deploy') {
      best = null;
      for (const b of near) {
        const [lx, ly, lz] = toLocal(b, at.x, at.y, at.z), s = deployAt(b, this.kind, { x: lx, y: ly, z: lz }, this.turn);
        if (s) best = { base: b, s, d: 0 };
      }
    }
    if (best) ask = { b: best.base.id, k: this.kind, x: best.s.x, y: best.s.y, z: best.s.z, r: best.s.r };
    else if ((K.ground || K.role === 'free') && hit) ask = { k: this.kind, x: at.x, y: 0, z: at.z, r: 0, yaw: this.h.yaw() + Math.PI };
    if (!ask) {
      this.hideGhost();
      this.prompt = card(K.name, near.length ? 'aim at where it goes on your base' : K.ground ? 'aim at open ground' : 'lay a foundation first', 'hold the right button for the pieces');
      return;
    }
    const c = this.store.check(ask, this.me);
    let why = typeof c === 'string' ? c : null;
    const cost = costOf(this.kind, laidAt(this.kind));
    if (!why) why = this.short(cost);
    // the ghost, where it would stand
    const base = typeof c === 'string' ? (ask.b !== undefined ? this.store.bases.get(ask.b)! : null) : c.base;
    const spot = typeof c === 'string' ? (ask.b !== undefined ? { x: ask.x, y: ask.y, z: ask.z, r: ask.r } : null) : c.spot;
    if (base && spot) this.showGhost(base, spot, !why);
    else this.showGhostAt(at, ask.yaw ?? 0, false);
    this.prompt = why ? card(K.name, `<span class="no">${why}</span>`, this.costHtml(cost)) : card(`Lay ${K.name}`, this.costHtml(cost), 'R turns it · hold the right button for the pieces', 'LMB');
    if (input.pressed('Mouse0') && !this.h.busy()) this.lay(plan, ask, why);
  }

  /** where the aim meets the ground, walked along it a quarter metre at a time (the ground's own height, which the rules go by) */
  private ontoGround(from: THREE.Vector3): { point: { x: number; y: number; z: number } } | null {
    for (let d = 0.5; d <= 9; d += 0.25) {
      const x = from.x + _dir.x * d, y = from.y + _dir.y * d, z = from.z + _dir.z * d;
      if (y <= heightAt(this.h.world.heights, x, z)) return { point: { x, y: heightAt(this.h.world.heights, x, z), z } };
    }
    return null;
  }

  /** a cost against what is carried, each thing in green when there is enough of it and in red when not */
  private costHtml(cost: Record<string, number>) {
    return Object.entries(cost).map(([id, n]) => `<span class="${this.h.count(id) >= n ? 'ok' : 'no'}">${amount(id, n)}</span> <small>(${this.h.count(id)})</small>`).join(' · ');
  }

  private short(cost: Record<string, number>): string | null {
    const missing = Object.entries(cost).filter(([id, n]) => this.h.count(id) < n);
    return missing.length ? `Needs ${missing.map(([id, n]) => `${amount(id, n - this.h.count(id), 'more ')}`).join(' and ')}` : null;
  }

  private lay(plan: ItemInstance, ask: { b?: number; k: string; x: number; y: number; z: number; r: number; yaw?: number }, why: string | null) {
    if (why) {
      if (this.told !== why || performance.now() - this.toldAt > SAID_AGAIN) this.h.note(why, 'warn');
      this.told = why;
      this.toldAt = performance.now();
      audio.click(420, 0.12, 0.02);
      return;
    }
    const [x, y, z] = this.ghost ? [this.ghost.position.x, this.ghost.position.y, this.ghost.position.z] : [ask.x, 0, ask.z];
    audio.impact('wood', { x, y, z }, 1);
    if (this.h.online()) return void this.h.send({ t: 'blay', ...ask, u: plan.uid });
    const r = this.local.lay(ask, this.me, Date.now(), this.h.name());
    if (typeof r === 'string') return void this.h.note(r, 'warn');
    for (const [id, n] of Object.entries(costOf(ask.k, laidAt(ask.k)))) this.h.take(id, n);
    this.bump(r.base.id);
    this.draw.put(r.base, r.piece);
    this.synced(r.base);
    this.h.changed();
  }

  private spotsOf(b: Base): Spot[] {
    const key = `${b.id}:${this.versions.get(b.id) ?? 0}:${this.kind}:${this.turn}`;
    if (this.cache?.key !== key) this.cache = { key, list: spots(b, this.kind, this.turn) };
    return this.cache.list;
  }
  private bump(b: number) {
    this.versions.set(b, (this.versions.get(b) ?? 0) + 1);
  }

  private showGhost(base: Base, s: { x: number; y: number; z: number; r: number }, good: boolean) {
    const [x, y, z] = toWorld(base, s.x, s.y, s.z);
    this.placeGhost(x, y, z, worldYaw(base, s.r), good);
  }
  private showGhostAt(at: THREE.Vector3, yaw: number, good: boolean) {
    this.placeGhost(at.x, at.y, at.z, yaw, good);
  }
  private placeGhost(x: number, y: number, z: number, yaw: number, good: boolean) {
    if (!this.ghost || this.ghostKind !== this.kind) {
      this.hideGhost();
      this.ghost = new THREE.Mesh(ghostGeometry(this.kind), good ? this.ok : this.bad);
      this.ghost.renderOrder = 5;
      this.ghostKind = this.kind;
      this.h.scene.add(this.ghost);
    }
    this.ghost.material = good ? this.ok : this.bad;
    this.ghost.visible = true;
    // (it glides to a new place rather than jumping: sixty milliseconds)
    const to = new THREE.Vector3(x, y, z);
    if (this.ghost.position.distanceTo(to) > 6) this.ghost.position.copy(to);
    else this.ghost.position.lerp(to, 0.5);
    this.ghost.rotation.set(0, yaw, 0);
  }
  private hideGhost() {
    if (this.ghost) this.ghost.visible = false;
  }

  // ---- the hammer

  private target(): { base: Base; id: number } | null {
    const cam = this.h.camera();
    cam.getWorldDirection(_dir);
    const hit = physics.raycast(cam.getWorldPosition(new THREE.Vector3()), _dir, 3.2, SOLID_GROUPS, this.h.player());
    const ref = hit?.tag?.owner;
    if (!(ref instanceof PieceRef)) return null;
    const base = this.store.bases.get(ref.b);
    return base?.pieces.has(ref.p) ? { base, id: ref.p } : null;
  }

  private hammerFrame(hammer: ItemInstance) {
    const t = this.target();
    if (!t) return;
    const p = t.base.pieces.get(t.id)!, K = PIECES[p.k];
    const next = (Math.min(3, p.t + 1)) as Tier;
    const head = `${K.name} · ${K.only !== undefined ? '' : `${TIERS[p.t]} · `}${Math.round(p.hp)}/${hpOf(p.k, p.t)}`;
    if (K.only !== undefined || p.t >= 3) {
      this.prompt = card(head, '', 'hold the right button to take it down');
      return;
    }
    const cost = costOf(p.k, next), why = this.short(cost);
    this.prompt = card(head, `${why ? `<span class="no">${why}</span> · ` : ''}up to ${TIERS[next]}: ${this.costHtml(cost)}`, 'hold the right button for more', why ? undefined : 'LMB');
    if (this.h.input.pressed('Mouse0') && !this.h.busy() && !why) this.upgrade(hammer, t.base, t.id, next);
  }

  /** the hammer at a piece for its tier's seconds, then up a tier (the server says whether, online) */
  private upgrade(hammer: ItemInstance, base: Base, id: number, to: Tier) {
    if (condition(hammer.cond).ruined) return void this.h.note('Your hammer is ruined', 'warn');
    const p = base.pieces.get(id);
    if (!p) return;
    const still = () => this.h.held()?.uid === hammer.uid && this.target()?.id === id && this.target()?.base === base;
    if (this.h.online()) this.h.send({ t: 'bup', b: base.id, p: id, to, go: 1, u: hammer.uid });
    this.h.begin(`Nailing the ${PIECES[p.k].name.toLowerCase()} up to ${TIERS[to].toLowerCase()}`, TIER_S[to], still, () => {
      if (!still()) return;
      if (this.h.online()) return void this.h.send({ t: 'bup', b: base.id, p: id, to, go: 2, u: hammer.uid });
      const cost = costOf(p.k, to), why = this.short(cost);
      if (why) return void this.h.note(why, 'warn');
      for (const [k, n] of Object.entries(cost)) this.h.take(k, n);
      this.local.upgrade(base.id, id, to);
      hammer.cond = worn(hammer.id, hammer.cond);
      this.draw.put(base, p);
      this.bump(base.id);
      this.h.changed();
    }, 'You stopped: it is as it was');
  }

  private takeDown(hammer: ItemInstance, base: Base, id: number) {
    const p = base.pieces.get(id);
    if (!p) return;
    if (this.boxes.byCid(`bbox:${base.id}:${id}`)?.container.serialize().items.length) return void this.h.note('Empty it first', 'warn');
    const still = () => this.h.held()?.uid === hammer.uid && !!base.pieces.get(id);
    const up = PIECES[p.k].role === 'deploy' && p.k !== 'claim';
    this.h.begin(up ? `Picking the ${PIECES[p.k].name.toLowerCase()} up` : `Taking the ${PIECES[p.k].name.toLowerCase()} down`, 2, still, () => {
      if (!still()) return;
      if (this.h.online()) return void this.h.send({ t: 'bdel', b: base.id, p: id, u: hammer.uid });
      const back = this.local.refund(base.id, id), gone = this.local.remove(base.id, id);
      this.draw.remove(base.id, gone);
      this.synced(base);
      this.bump(base.id);
      const items = Object.entries(back).map(([k, n]) => makeItem(k, n));
      if (items.length) this.h.give(items, Object.entries(back).map(([k, n]) => `${n} ${ITEMS[k].name}`).join(', '));
      hammer.cond = worn(hammer.id, hammer.cond);
      this.h.changed();
    }, 'You stopped: it stands');
  }

  // ---- the wheels

  private openWheel(what: 'plan' | 'hammer') {
    this.wheel = this.wheels[what];
    if (!this.wheel.el.parentElement) this.h.hud().appendChild(this.wheel.el);
    this.wheelFor = what;
    this.wheelAt.set(0, 0);
    this.wheelPick = -1;
    if (what === 'plan') this.wheelCat = Math.max(0, CATS.findIndex((c) => c.cat === PIECES[this.kind].cat));
    this.fillWheel();
    this.wheel.open();
    this.wheel.hub(what === 'plan' ? PIECES[this.kind].name : 'Hammer', what === 'plan' ? 'let go on a piece' : 'let go on what to do');
  }

  private fillWheel() {
    if (this.wheelFor === 'hammer') {
      const t = this.target();
      this.wheel.set(hammerEntries(t ? t.base.pieces.get(t.id) ?? null : null));
    } else this.wheel.set(planEntries(this.wheelCat, this.kind));
  }

  private wheelFrame(ok: boolean) {
    const input = this.h.input, at = this.wheelAt;
    at.x += input.mouseDX / RING.reach;
    at.y += input.mouseDY / RING.reach;
    if (at.length() > 1) at.normalize();
    const per = this.wheelFor === 'plan' ? PER : HAMMER_PER;
    const far = at.length(), k = ((Math.round((Math.atan2(at.x, -at.y) / (Math.PI * 2)) * per) % per) + per) % per;
    let pick = -1;
    if (this.wheelFor === 'plan') {
      if (far > RING.outer) pick = outerOf(this.wheelCat)[k] ? PER + k : -1;
      else if (far > RING.pick) pick = k;
      // (onto another group: its pieces come round the outside)
      if (pick >= 0 && pick < PER && CATS[pick].cat && pick !== this.wheelCat) {
        this.wheelCat = pick;
        this.fillWheel();
      }
    } else if (far > RING.pick) pick = HAMMER_WHEEL[k] ? k : -1;
    if (pick !== this.wheelPick) {
      this.wheelPick = pick;
      this.wheel.hub(...this.hubFor(pick));
    }
    this.wheel.point(pick, [at.x, at.y]);
    if (ok && input.held('Mouse2')) return;
    // (let go: what is under the pointer is done, or nothing)
    const what = this.wheelFor;
    this.wheelFor = null;
    const chose = this.choose(what, pick);
    this.wheel.close(chose ? pick : -1);
  }

  private hubFor(pick: number): [string, string] {
    if (this.wheelFor === 'hammer') {
      const w = HAMMER_WHEEL[pick];
      const t = this.target(), p = t ? t.base.pieces.get(t.id) : null;
      if (!w || pick < 0) return ['Hammer', p ? `${PIECES[p.k].name} · ${TIERS[p.t]}` : 'look at a piece'];
      if (w === 'cancel') return ['Cancel', ''];
      if (w === 'remove') return ['Take down', p ? `half of it back: ${Object.entries(this.store.refund(t!.base.id, t!.id)).map(([k, n]) => `${amount(k, n)}`).join(', ') || 'nothing'}` : ''];
      if (w.startsWith('up') && p) {
        const to = Number(w.slice(2)) as Tier;
        return [TIERS[to], Object.entries(costOf(p.k, to)).map(([k, n]) => `${amount(k, n)} (${this.h.count(k)})`).join(', ')];
      }
      return [w === 'repair' ? 'Repair' : 'Turn', 'to come'];
    }
    if (pick < 0) return [PIECES[this.kind].name, 'let go on a piece'];
    if (pick < PER) return CATS[pick].cat ? [CATS[pick].label, 'out to the pieces'] : ['Cancel', ''];
    const id = outerOf(this.wheelCat)[pick - PER]!;
    return [PIECES[id].name, Object.entries(costOf(id, laidAt(id))).map(([k, n]) => `${amount(k, n)} (${this.h.count(k)})`).join(', ')];
  }

  /** what the wheel's wedge `pick` does; true when it did something */
  private choose(what: 'plan' | 'hammer' | null, pick: number): boolean {
    if (pick < 0) return false;
    if (what === 'plan') {
      if (pick >= PER) {
        this.kind = outerOf(this.wheelCat)[pick - PER]!;
        this.turn = 0;
        return true;
      }
      // (a group let go on: its first piece)
      const cat = CATS[pick].cat;
      if (!cat) return false;
      this.kind = piecesOf(cat).some((k) => k.id === this.kind) ? this.kind : piecesOf(cat)[0].id;
      return true;
    }
    const w = HAMMER_WHEEL[pick], held = this.h.held(), t = this.target();
    if (!w || w === 'cancel' || !held || !t) return false;
    if (w === 'remove') {
      this.takeDown(held, t.base, t.id);
      return true;
    }
    if (w.startsWith('up')) {
      const to = Number(w.slice(2)) as Tier, p = t.base.pieces.get(t.id)!;
      const why = this.store.canUpgrade(t.base.id, t.id, to) ?? this.short(costOf(p.k, to));
      if (why) {
        this.h.note(why, 'warn');
        return false;
      }
      this.upgrade(held, t.base, t.id, to);
      return true;
    }
    this.h.note('That is still to come', 'info');
    return false;
  }

  // ---- what the server says

  onBase(m: Extract<S2C, { t: 'base' }>) {
    const b = heard(m.b);
    if (!b) return;
    this.seen.bases.set(b.id, b);
    this.draw.setBase(b);
    this.synced(b);
    this.bump(b.id);
  }
  onGone(m: Extract<S2C, { t: 'bgone' }>) {
    this.seen.bases.delete(m.b);
    this.draw.forget(m.b);
    this.claims.forget(m.b);
    this.boxes.forget(m.b);
  }
  onPiece(m: Extract<S2C, { t: 'bpc' }>) {
    const b = this.seen.bases.get(m.b), p = heardPiece(m.p);
    if (!b || !p) return;
    p.by = b.owner;
    b.pieces.set(p.id, p);
    p.on = restsOn(b, p.k, p).filter((id) => id !== p.id);
    b.next = Math.max(b.next, p.id + 1);
    this.draw.put(b, p);
    this.synced(b);
    this.bump(b.id);
  }
  onOut(m: Extract<S2C, { t: 'bout' }>) {
    const b = this.seen.bases.get(m.b);
    if (!b) return;
    for (const id of m.ids) b.pieces.delete(id);
    for (const p of b.pieces.values()) p.on = p.on.filter((q) => !m.ids.includes(q));
    this.draw.remove(m.b, m.ids);
    this.synced(b);
    if (!b.pieces.size) this.seen.bases.delete(m.b);
    this.bump(m.b);
  }
  onClaim(m: Extract<S2C, { t: 'bclaim' }>) {
    this.claims.onClaim(m, this.seen.bases.get(m.b), heardClaim);
    this.bump(m.b);
  }
  onKeep(m: Extract<S2C, { t: 'bkeep' }>) {
    this.claims.onKeep(m);
  }
  /** the health of a base's pieces as they rot */
  onHp(m: Extract<S2C, { t: 'bhp' }>) {
    const b = this.seen.bases.get(m.b);
    if (!b) return;
    for (const [id, hp] of m.hp) {
      const p = b.pieces.get(id);
      if (p) p.hp = hp;
    }
  }
  onSpent(m: Extract<S2C, { t: 'spent' }>) {
    for (const [id, n] of m.items) this.h.take(id, n);
    this.sp = Math.max(this.sp, m.n);
    this.h.changed();
  }
  onUp(m: Extract<S2C, { t: 'bup' }>) {
    if (m.ok) return;
    this.h.breakOff();
    if (m.why) this.h.note(m.why, 'warn');
  }

  /** a new server, or none: what was seen of the last is forgotten (alone, this game's own bases are drawn again) */
  reset() {
    this.seen = new Bases(this.seen.land);
    this.sp = 0;
    this.draw.clear();
    this.claims.clear();
    this.boxes.clear();
    if (!this.h.online()) for (const b of this.local.bases.values()) {
      this.draw.setBase(b);
      this.synced(b);
    }
  }

  /** alone: what was built, kept with the game's own save (src/sim/save.ts) */
  keepLocal(): KeptBase[] {
    return [...this.local.bases.values()].map((b) => said(b));
  }
  restoreLocal(kept: KeptBase[] | undefined) {
    this.local.restore(kept);
    if (!this.h.online()) for (const b of this.local.bases.values()) this.draw.setBase(b);
  }
}
