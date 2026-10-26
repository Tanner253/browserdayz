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
import { audio, buildRecordings } from '../../core/audio';
import type { Input } from '../../core/input';
import type { Atmosphere } from '../../world/atmosphere';
import { heightAt, type World } from '../../world/worldgen';
import { Radial } from '../../ui/radial';
import { mendOf, Bases, heard, heardClaim, heardPiece, heardSite, repairOf, said, type KeptBase } from '../../sim/build/bases';
import { PLACED, PLACES, PIECES, TIERS, TIER_S, byHand, costOf, hpOf, laidAt, topOf, type Tier } from '../../sim/build/pieces';
import { HandPickup } from './pickup';
import { FREE_LEAN, leanAt, deployAt, deployTurn, footOf, nearestSpot, nearestToRay, restsOn, rigid, spots, toLocal, toWorld, worldYaw, type Base, type Piece, type Spot } from '../../sim/build/snap';
import { Solids, noBuilding, wetAt } from '../../sim/build/land';
import { HAMMERS, condition, worn } from '../../sim/gather';
import { ITEMS, makeItem, type ItemInstance } from '../../sim/items';
import type { C2S, S2C } from '../../net/protocol';
import { BaseDraw, PieceRef } from './draw';
import { ClaimView } from './claims';
import { publicId } from '../../net/client';
import type { Stash } from '../loot';
import { ghostGeometry } from './look';
import { CATS, HAMMER_PER, HAMMER_WHEEL, PER, RINGS, ROMAN, hammerEntries, itemsOf, nameOf, pieceAt, planEntries } from './wheel';
import { DoorView } from './doors';
import { BoxView } from './boxes';
import { LockView } from './locks';
import { BedsView } from './beds';
import { LadderView, type Climber } from './ladders';
import { PrintView } from './prints';
import { TorchView, type TorchHost } from './torches';
import { RaidView, type RaidHost } from './raid';
import { printCost, printOf } from '../../sim/build/blueprints';
import { BaseSolids } from '../../sim/build/solid';
import { inRoom, shutRoom, type Room } from '../../sim/build/rooms';

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
  /** a blow of what is in the hands at the work, hitting nobody (false: the hands are at something else) */
  work: (dur: number) => boolean;
  /** an admin in creative, online: nothing costs, nothing is held for, no bench is asked (server/build.ts) */
  creative: () => boolean;
  breakOff: () => void;
  changed: () => void;
  /** the felled trees (a stump is no trunk) */
  felled: (i: number) => boolean;
  /** where the wheels go (asked when one is first opened: the game makes its screen after this) */
  hud: () => HTMLElement;
  player: () => import('@dimforge/rapier3d-compat').Collider | undefined;
  /** a store opened in the inventory (a claim's) */
  open: (s: Stash) => void;
  /** another system's word on a piece looked at (crafting's research table): what the corner says, and F is its */
  use?: (free: boolean, t: { base: Base; id: number } | null, tap?: boolean) => string | null;
  /** the player's name, as their claim's members are listed */
  name: () => string;
  /** the numbers of the keys carried (src/sim/build/locks.ts) */
  keys: () => number[];
  /** a panel of the building's up (the mouse freed) or put away */
  panel: (open: boolean) => void;
  /** played alone: hurt (a code lock's shock) */
  hurt: (n: number) => void;
  /** played alone: back after a death, woken at a bed */
  wake: (x: number, y: number, z: number, yaw: number) => void;
  /** the player's body, as a ladder is climbed by it */
  climber: () => Climber;
  /** a torch's flames and light, and where the head of what is held is */
  flames: TorchHost['flames'];
  glow: TorchHost['glow'];
  tip: TorchHost['tip'];
  /** a blast gone off: its fire and sound, and alone what it does to this game's bodies (Game.explode) */
  explode: (at: THREE.Vector3, mine: boolean, w: string) => void;
  /** chips and dust off a surface struck (Effects.impact, no mark) */
  impact: (surface: import('../../core/physics').Surface, at: THREE.Vector3, normal: THREE.Vector3) => void;
  myId: RaidHost['myId'];
  /** a Weapon Rack set down or gone: drawn with its guns as the world's racks are (src/game/racks.ts) */
  rack: (cid: string, at: [number, number, number] | null, rot?: number) => void;
  /** the player's own body pushed by a leaf swinging, through its controller (Player.shove) */
  shove: (dx: number, dz: number, past: ReadonlySet<number>) => number;
  /** the store open in the inventory now, and the pictures of things (the claim's screen beside its store) */
  shown: () => import('../loot').Stash | null;
  icons: () => Record<string, string>;
  charge: RaidHost['charge'];
}

/** what in the hands has its left button here, not the hands' (the plan lays, a lock is fitted, a charge stuck) */
export const LEFT_HELD = new Set(['building_plan', 'code_lock', 'key_lock', 'c4', 'satchel', ...Object.keys(PLACES)]);

/** how far the mouse moves for the pointer to cross the wheel, px */
const RING = { reach: 260 };
/** a hammer's blow at a nail, seconds, and how far through it the nail is struck */
const NAIL = { blow: 0.55, lands: 0.45 };
/** how far from the eye, along the ground, a foundation begun on its own is laid at most (see `alone`) */
const PLACE = { reach: 6 };
/** the ghost held steady (the owner, 2026-10-25: "when im placing with the building planner the ghost structure flashes in
 * and out ALOT seems super buggy"): another place takes over only when it is this much nearer the aim (metres), the place
 * held is let go of past `far`, and with nothing found the ghost stays where it was for `grace` ms */
const GHOST = { stick: 0.35, far: 3.4, grace: 250 };
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
  /** the place the ghost was last shown at on a base, and when: held until another is clearly nearer the aim (GHOST) */
  private kept: { b: number; k: string; s: Spot; at: number } | null = null;
  /**
   * A thing being set down, Rust's way (the owner, 2026-10-24: "a click once to place then move mouse to rotate click
   * again to confirm ... rigid when using crates"): its spot, held since the first click, in its base's frame; how it is
   * turned now; and for a box, the quarter turns R has given it since. Null: the first click is still to come.
   */
  private placing: { k: string; b: number; x: number; y: number; z: number; r: number; quarters: number; locked: boolean } | null = null;
  /** the arrow on the floor under a thing being turned, the way its front faces */
  private arrow: THREE.Mesh | null = null;
  /** a thing is held at its spot and being turned (the keys say so: src/game/key-hints.ts) */
  get turning() {
    return !!this.placing;
  }
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
    this.claims = new ClaimView({ input: h.input, online: h.online, send: h.send, note: h.note, me: h.me, who: () => this.me, name: h.name, open: h.open, shown: h.shown, icons: h.icons, hud: h.hud, broke: (b, ids) => this.draw.remove(b.id, ids), changed: (b) => this.bump(b.id) }, () => this.store);
    const wheel = (per: number) => new Radial({ rings: RINGS, per, className: 'hud-wheel', tick: () => audio.click(2600, 0.05, 0.008), chose: () => audio.click(1500, 0.12, 0.018) });
    this.wheels = { plan: wheel(PER), hammer: wheel(HAMMER_PER) };
    this.wheel = this.wheels.plan;
    this.boxes = new BoxView(h.input, h.open, h.rack);
    this.hand = new HandPickup(h.input);
    this.doors = new DoorView({ input: h.input, online: h.online, send: h.send, note: h.note, me: h.me, camera: h.camera }, () => this.store, this.draw);
    this.locks = new LockView({
      input: h.input, online: h.online, send: h.send, note: h.note, held: h.held, who: () => this.me, keys: h.keys, count: h.count, take: h.take, give: h.give,
      begin: h.begin, panel: h.panel, hurt: h.hurt, looked: () => this.target(), myId: h.myId,
      spark: (at) => h.impact('metal', at, new THREE.Vector3(0, 1, 0)),
      changed: (b) => {
        for (const p of b.pieces.values()) this.draw.put(b, p);
        this.synced(b);
        this.bump(b.id);
        h.changed();
      },
      openClaim: (b) => this.claims.openStore(b),
      joinClaim: (b) => this.claims.toggle(b),
    }, () => this.store, this.doors, this.boxes);
    this.ladders = new LadderView(h.input, () => this.store, h.climber);
    this.torches = new TorchView({ input: h.input, flames: h.flames, glow: h.glow, held: () => h.held()?.id ?? null, tip: h.tip, me: h.me, shut: (at) => this.lightShut(at) }, () => this.store);
    this.draw.shove = (dx, dz, past) => h.shove(dx, dz, past);
    this.draw.me = h.me;
    this.raid = new RaidView({
      scene: h.scene, input: h.input, online: h.online, send: h.send, note: h.note, held: h.held, camera: h.camera, player: h.player, me: h.me, take: h.take,
      changed: h.changed, flames: h.flames, glow: h.glow, explode: h.explode, broken: (b, ids) => this.brokeAlone(b, ids), impact: h.impact,
      myId: h.myId, charge: h.charge,
    }, () => this.store, this.solids);
    this.prints = new PrintView({
      scene: h.scene, input: h.input, online: h.online, send: h.send, note: h.note, yaw: h.yaw, who: () => this.me, name: h.name, count: h.count, take: h.take,
      changed: (b) => {
        this.draw.setBase(b);
        this.synced(b);
        this.bump(b.id);
        h.changed();
      },
      costHtml: (c) => this.costHtml(c),
      me: h.me,
      give: h.give,
    }, () => this.store);
    this.beds = new BedsView({ online: h.online, send: h.send, me: h.me, who: () => this.me, hud: h.hud, wake: h.wake }, () => this.store);
  }

  private get store() {
    return this.h.online() ? this.seen : this.local;
  }
  /** the bases this game knows (crafting looks for its workbenches and forges in them) */
  get known(): Bases {
    return this.store;
  }
  /** the bases' solids as this game knows them, for what its colliders do not reach (a body laid far off: src/sim/build/solid.ts) */
  readonly solids = new BaseSolids(() => this.store.bases.values());

  /** the rooms lights were last found in, by where they were (to half a metre), for half a second */
  private rooms = new Map<string, { at: number; room: Room | null; b: Base | null }>();
  /**
   * A light at a place is in a room shut all round in stone or metal, and the eye is not in it: nobody outside sees it
   * (the owner: "light should not be seen outside an enclosed stone+ base that originates within"; src/sim/build/rooms.ts).
   */
  lightShut(at: THREE.Vector3): boolean {
    const key = `${Math.round(at.x * 2)},${Math.round(at.y * 2)},${Math.round(at.z * 2)}`, now = performance.now();
    let c = this.rooms.get(key);
    if (!c || now - c.at > 500) {
      if (this.rooms.size > 64) this.rooms.clear();
      c = { at: now, room: null, b: null };
      for (const b of this.solids.around(at.x, at.z, 2)) {
        const room = shutRoom(b, at.x, at.y, at.z);
        if (room) {
          c = { at: now, room, b };
          break;
        }
      }
      this.rooms.set(key, c);
    }
    if (!c.room || !c.b) return false;
    const eye = this.h.camera().position;
    return !inRoom(c.room, c.b, eye.x, eye.y, eye.z);
  }

  /** somebody is stood somewhere new (come in, woken, put there): the pieces about them solid at once */
  stood(at: THREE.Vector3) {
    this.draw.solidNear(at);
  }
  /** a wheel is up: the view does not turn, and the hands do nothing else */
  get wheelOpen() {
    return this.wheel.isOpen;
  }
  /** focus gone (Game.letGo): a wheel up shuts choosing nothing, a piece being turned goes back to its first click */
  letGo() {
    if (this.wheel.isOpen) {
      this.wheelFor = null;
      this.wheel.close(-1);
    }
    this.placing = null;
    this.raid.letGo();
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
  /** F held at a thing set down in one's own base: picked up by hand (src/game/building/pickup.ts) */
  private hand!: HandPickup;
  /** locks: fitted from the hands, worked with F (src/game/building/locks.ts) */
  readonly locks: LockView;
  /** beds on the death screen (src/game/building/beds.ts) */
  readonly beds: BedsView;
  /** ladders: walked into, climbed (src/game/building/ladders.ts) */
  readonly ladders: LadderView;
  /** blueprints: laid as one ghost (src/game/building/prints.ts) */
  readonly prints: PrintView;
  /** torches: in the hands, and on walls (src/game/building/torches.ts) */
  readonly torches: TorchView;
  /** raiding: blows at pieces, charges stuck and going off (src/game/building/raid.ts) */
  readonly raid: RaidView;

  /** a base's stores (its claim's, its boxes') as it now stands */
  private synced(b: Base) {
    this.claims.sync(b);
    this.boxes.sync(b);
  }

  // ---- every frame

  update(dt: number, ok: boolean) {
    const held = this.h.held();
    // (a box, a bench, a forge, a bed in the hands: set down as the plan sets down a thing, that kind and no other)
    const placing = ok && !!held && !!PLACES[held.id];
    if (placing) this.kind = PLACES[held.id];
    else if (PLACED[this.kind]) this.kind = 'foundation';
    const plan = (ok && held?.id === 'building_plan') || placing, hammer = ok && !!held && !!HAMMERS[held.id];
    this.prompt = null;
    // (building's sounds asked for once a building tool is first in the hands)
    if (plan || hammer) void buildRecordings();
    // (the hammer driving nails while it works at a piece)
    // (the hammer's blows seen, its own and everybody's: each nail rings as its blow lands. The plan alone, nails only)
    if (this.nailing && this.h.busy()) {
      const now = performance.now(), n = this.nailing;
      if (now >= n.next) {
        const blow = hammer && this.h.work(NAIL.blow);
        n.next = now + (blow ? NAIL.blow * 1000 + 60 + Math.random() * 120 : 360 + Math.random() * 280);
        n.ring = now + (blow ? NAIL.lands * NAIL.blow * 1000 : 0);
      }
      if (n.ring && now >= n.ring) {
        n.ring = 0;
        audio.built('nail', n.at, 0.9, 0.94 + Math.random() * 0.12);
      }
    } else this.nailing = null;
    this.draw.update(dt, this.h.me());
    // (the plan put away, another piece chosen, or the mouse let go of (Esc): a thing being turned goes back to its first click)
    if (this.placing && (!plan || this.placing.k !== this.kind || (this.placing.locked && !this.h.input.locked))) this.placing = null;
    if (this.wheel.isOpen) this.wheelFrame(ok && (plan || hammer));
    // (the right button, while a thing is being turned, takes it back to its first click instead: `turnFrame`)
    else if (ok && ((plan && !placing) || hammer) && !this.placing && this.h.input.pressed('Mouse2') && !this.h.busy()) this.openWheel(plan ? 'plan' : 'hammer');
    if (plan && !this.wheel.isOpen) this.planFrame(held!);
    else {
      this.hideGhost();
      this.prints.hide();
    }
    if (!this.placing && this.arrow) this.arrow.visible = false;
    if (hammer && !this.wheel.isOpen) this.hammerFrame(held!);
    // (a claim looked at: F opens its store, held it joins; a door: F swings it. Whatever is in the hands, though the
    // plan's and the hammer's cards say more of what is looked at than that)
    const free = ok && !this.wheel.isOpen && !this.h.busy(), t = ok ? this.target() : null;
    // (a lock in the hands, or a lock on what is looked at: F is the lock's)
    const lock = this.locks.frame(dt, free, t);
    const claim = this.claims.frame(dt, free, lock ? null : t);
    if (claim) this.prompt = claim;
    // (a thing set down in a base one may work, F held at it: picked up whole, by hand; F tapped does what it always did)
    const mine = t && !lock && this.mineByHand(t) ? t : null;
    const said = mine && this.hand.frame(dt, free, `${mine.base.id}:${mine.id}`, this.boxes.frame(false, mine) ?? this.h.use?.(false, mine) ?? `<b>${PIECES[mine.base.pieces.get(mine.id)!.k].name}</b>`,
      () => (this.boxes.byCid(`bbox:${mine.base.id}:${mine.id}`) ? this.boxes.openFor(mine.base.id, mine.id) : void this.h.use?.(true, mine, true)), () => this.pickUpByHand(mine.base, mine.id));
    if (!mine) this.hand.frame(dt, false, null, null, () => {}, () => {});
    const door = lock ?? said ?? this.doors.frame(free, t) ?? this.boxes.frame(free, t) ?? this.h.use?.(free, t) ?? null;
    if (door && !plan && !hammer) this.prompt = door;
    this.torches.update(dt, ok && !this.wheel.isOpen);
    const ladder = this.ladders.frame(dt, ok && !this.wheel.isOpen);
    if (ladder && !this.prompt) this.prompt = ladder;
    // (a charge in the hands, or one that did not go off; the health of a piece just struck)
    this.raid.update(dt);
    const raid = this.raid.frame(free);
    if (raid && !plan && !hammer) this.prompt = raid;
    if (!this.prompt) this.prompt = this.raid.shown();
    // (a blueprint set down near: its ghost, and at it what F does, when nothing else is asked of the eye)
    const site = this.prints.sites(dt, free && !this.prompt);
    if (site && !this.prompt) this.prompt = site;
    // (while the hands are at it, the ring round the crosshair says what they are doing: the card stands aside)
    if (this.h.busy()) this.prompt = null;
  }

  // ---- the plan

  private planFrame(plan: ItemInstance) {
    const input = this.h.input, cam = this.h.camera();
    if (this.placing) return this.turnFrame(plan);
    if (input.pressed('KeyR')) this.turn = (this.turn + 1) % 12;
    cam.getWorldDirection(_dir);
    const from = cam.getWorldPosition(new THREE.Vector3());
    const hit = physics.raycast(from, _dir, 9, SOLID_GROUPS, this.h.player()) ?? this.ontoGround(from);
    const at = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : from.clone().addScaledVector(_dir, 6);
    // (a blueprint: its own ghost, whole)
    if (printOf(this.kind)) {
      this.hideGhost();
      this.prompt = this.prints.frame(plan, this.kind, hit ? at : null);
      return;
    }
    this.prints.hide();
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
    // (the place held, while it is still a place for this piece and near the aim, unless another is clearly nearer)
    const kept = this.kept, same = (q: Spot, s: Spot) => q.x === s.x && q.y === s.y && q.z === s.z && q.r === s.r;
    if (kept && kept.k === this.kind && K.role !== 'deploy' && !FREE_LEAN.has(this.kind)) {
      const kb = this.store.bases.get(kept.b);
      if (kb && near.includes(kb) && this.spotsOf(kb).some((q) => same(q, kept.s))) {
        const [wx, wy, wz] = toWorld(kb, kept.s.x, kept.s.y, kept.s.z), d = Math.hypot(wx - at.x, wy - at.y, wz - at.z);
        if (d < GHOST.far && (!best || d < best.d + GHOST.stick)) best = { base: kb, s: kept.s, d };
      }
    }
    // (a torch held: hung where the aim meets a wall's face, anywhere on it, with no places to snap to)
    if (FREE_LEAN.has(this.kind)) {
      best = null;
      for (const b of near) {
        const [lx, ly, lz] = toLocal(b, at.x, at.y, at.z), s = leanAt(b, this.kind, { x: lx, y: ly, z: lz });
        if (s) best = { base: b, s, d: 0 };
      }
    }
    if (best && K.role !== 'deploy' && !FREE_LEAN.has(this.kind)) this.kept = { b: best.base.id, k: this.kind, s: best.s, at: performance.now() };
    let ask: { b?: number; k: string; x: number; y: number; z: number; r: number; yaw?: number } | null = null;
    // (a thing set down goes where the aim meets a floor: its front to whoever sets it down, a box's back to the wall
    // behind it if there is one; R turns it on from there, a step, or a box a quarter)
    if (K.role === 'deploy') {
      best = null;
      for (const b of near) {
        const [lx, ly, lz] = toLocal(b, at.x, at.y, at.z), first = deployAt(b, this.kind, { x: lx, y: ly, z: lz });
        if (!first) continue;
        const s = deployAt(b, this.kind, first, this.facing(b, first, from) + (rigid(this.kind) ? 3 : 1) * this.turn);
        if (s) best = { base: b, s, d: 0 };
      }
    }
    // (a foundation or a high wall begun on its own: square to the way the player looks, and R turns it a quarter, a
    // triangle a sixth)
    const turned = K.shape === 'tri' ? (this.turn % 6) * (Math.PI / 3) : (this.turn % 4) * (Math.PI / 2);
    if (best) ask = { b: best.base.id, k: this.kind, x: best.s.x, y: best.s.y, z: best.s.z, r: best.s.r };
    else if (K.ground || K.role === 'free') {
      const own = this.alone(from, hit);
      if (own) ask = { k: this.kind, x: own.x, y: K.ground ? own.y : 0, z: own.z, r: 0, yaw: this.h.yaw() + Math.PI + turned };
    }
    if (!ask) {
      // (a frame or two with nothing found: the ghost stays where it was)
      if (this.kept && performance.now() - this.kept.at < GHOST.grace) return;
      this.hideGhost();
      this.prompt = card(K.name, near.length ? 'aim at where it goes on your base' : K.ground ? 'aim at open ground' : 'lay a foundation first', 'hold the right button for the pieces');
      return;
    }
    const c = this.store.check(ask, this.me, this.h.creative());
    let why = typeof c === 'string' ? c : null;
    const cost = costOf(this.kind, laidAt(this.kind));
    if (!why) why = this.short(cost);
    // the ghost, where it would stand
    const base = typeof c === 'string' ? (ask.b !== undefined ? this.store.bases.get(ask.b)! : null) : c.base;
    const spot = typeof c === 'string' ? (ask.b !== undefined ? { x: ask.x, y: ask.y, z: ask.z, r: ask.r } : null) : c.spot;
    if (base && spot) this.showGhost(base, spot, !why);
    else this.showGhostAt(ask.b === undefined ? new THREE.Vector3(ask.x, Math.max(ask.y, heightAt(this.h.world.heights, ask.x, ask.z)), ask.z) : at, ask.yaw ?? 0, false);
    if (K.role === 'deploy') {
      // (the first click holds it where it is, to be turned: `turnFrame`)
      this.prompt = why ? card(K.name, `<span class="no">${why}</span>`, this.costHtml(cost)) : card(`Place ${K.name}`, this.costHtml(cost), 'then turn it with the aim · R turns it · hold the right button for the pieces', 'LMB');
      if (input.pressed('Mouse0') && !this.h.busy()) {
        if (why || ask.b === undefined) return void this.lay(plan, ask, why);
        this.placing = { k: this.kind, b: ask.b, x: ask.x, y: ask.y, z: ask.z, r: ask.r, quarters: 0, locked: input.locked };
        audio.click(900, 0.12, 0.015);
      }
      return;
    }
    this.prompt = why ? card(K.name, `<span class="no">${why}</span>`, this.costHtml(cost)) : card(`Lay ${K.name}`, this.costHtml(cost), 'R turns it · hold the right button for the pieces', 'LMB');
    if (input.pressed('Mouse0') && !this.h.busy()) this.lay(plan, ask, why);
  }

  /**
   * How a thing about to be set down at `s` (in base `b`'s frame) is first turned, in steps: a box's back to the
   * nearest wall within a metre and a half of it, squared; anything else, and a box with no wall by it, its front to
   * the eye (`from`).
   */
  private facing(b: Base, s: { x: number; y: number; z: number }, from: THREE.Vector3): number {
    const STEP = Math.PI / 6;
    if (rigid(this.kind)) {
      let wall: { x: number; z: number; d: number } | null = null;
      for (const p of b.pieces.values()) {
        if (PIECES[p.k].role !== 'wall' || Math.abs(p.y - s.y) > 0.5) continue;
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d < 1.5 && (!wall || d < wall.d)) wall = { x: p.x, z: p.z, d };
      }
      if (wall) return Math.round(Math.atan2(s.x - wall.x, s.z - wall.z) / STEP / 3) * 3;
    }
    const [ex, , ez] = toLocal(b, from.x, from.y, from.z);
    return Math.atan2(ex - s.x, ez - s.z) / STEP;
  }

  /**
   * The second step of setting a thing down: held at its spot, its front turned to where the aim meets the floor about
   * it (a box in quarter turns, squared to its base; R turns a box a quarter more), an arrow under it the way it faces,
   * and a click to set it there. The right button takes it back to the first click; so does letting go of the mouse (Esc).
   */
  private turnFrame(plan: ItemInstance) {
    const input = this.h.input, cam = this.h.camera(), pl = this.placing!, b = this.store.bases.get(pl.b), K = PIECES[pl.k];
    if (!b || input.pressed('Mouse2')) {
      this.placing = null;
      audio.click(500, 0.1, 0.015);
      return;
    }
    if (input.pressed('KeyR') && rigid(pl.k)) pl.quarters = (pl.quarters + 1) % 4;
    cam.getWorldDirection(_dir);
    const from = cam.getWorldPosition(new THREE.Vector3());
    const hit = physics.raycast(from, _dir, 12, SOLID_GROUPS, this.h.player()) ?? this.ontoGround(from);
    if (hit) {
      const [lx, , lz] = toLocal(b, hit.point.x, hit.point.y, hit.point.z), dx = lx - pl.x, dz = lz - pl.z;
      // (near its own spot the way is no way at all: it keeps the last)
      if (Math.hypot(dx, dz) > 0.35) {
        const steps = Math.atan2(dx, dz) / (Math.PI / 6);
        pl.r = rigid(pl.k) ? deployTurn(pl.k, Math.round(steps / 3) * 3 + 3 * pl.quarters) : deployTurn(pl.k, steps);
      }
    }
    const ask = { b: pl.b, k: pl.k, x: pl.x, y: pl.y, z: pl.z, r: pl.r };
    const c = this.store.check(ask, this.me, this.h.creative());
    let why = typeof c === 'string' ? c : null;
    const cost = costOf(pl.k, laidAt(pl.k));
    if (!why) why = this.short(cost);
    this.showGhost(b, ask, !why);
    // (the arrow: from its middle out past its front, flat on what it stands on)
    const [wx, wy, wz] = toWorld(b, pl.x, pl.y, pl.z), yaw = worldYaw(b, ask.r);
    this.placeArrow(pl.k, wx, wy + 0.03, wz, yaw, !why);
    const deg = Math.round((ask.r * 30) % 360);
    this.prompt = why
      ? card(K.name, `<span class="no">${why}</span>`, 'the right button: back')
      : card(`Set ${K.name} down`, `facing ${deg}° · ${this.costHtml(cost)}`, rigid(pl.k) ? 'the aim turns it a quarter at a time · R a quarter more · the right button: back' : 'the aim turns it · the right button: back', 'LMB');
    if (input.pressed('Mouse0') && !this.h.busy()) {
      this.lay(plan, ask, why);
      if (!why) this.placing = null;
    }
  }

  private arrowOk = new THREE.MeshBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  private arrowBad = new THREE.MeshBasicMaterial({ color: 0xffb3a8, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  /** the arrow under a thing being turned: flat, from its middle out half a metre past its front, the way the front faces */
  private placeArrow(kind: string, x: number, y: number, z: number, yaw: number, good: boolean) {
    if (!this.arrow) {
      // (a metre long, pointing +z: stretched to each thing's own depth)
      const s = new THREE.Shape();
      s.moveTo(-0.07, 0);
      s.lineTo(0.07, 0);
      s.lineTo(0.07, 0.68);
      s.lineTo(0.24, 0.68);
      s.lineTo(0, 1);
      s.lineTo(-0.24, 0.68);
      s.lineTo(-0.07, 0.68);
      s.closePath();
      this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(s).rotateX(Math.PI / 2), this.arrowOk);
      this.arrow.renderOrder = 6;
      this.h.scene.add(this.arrow);
    }
    const front = Math.max(...footOf(kind, 0, 0, 0).map(([, fz]) => Math.abs(fz)));
    this.arrow.scale.set(1, 1, front + 0.5);
    this.arrow.material = good ? this.arrowOk : this.arrowBad;
    this.arrow.position.set(x, y, z);
    this.arrow.rotation.set(0, yaw, 0);
    this.arrow.visible = true;
  }

  /** where the aim meets the ground, walked along it a quarter metre at a time (the ground's own height, which the rules go by) */
  /**
   * Where a foundation begun on its own goes, Rust's way: where the aim meets the ground within PLACE.reach of the eye
   * (along the ground), its top over the ground there; past that, held at that distance along the aim, its top as high
   * as the aim is there, so that looking up raises it on its footing (the owner, 2026-10-25: "as the player looks
   * further away we cap the distance ... then as the player continues looking up the height of the foundation is
   * adjusted"). A height under the ground's least is the least (src/sim/build/bases.ts).
   */
  private alone(from: THREE.Vector3, hit: { point: { x: number; y: number; z: number } } | null): { x: number; y: number; z: number } | null {
    if (hit && Math.hypot(hit.point.x - from.x, hit.point.z - from.z) <= PLACE.reach) return { x: hit.point.x, y: 0, z: hit.point.z };
    const flat = Math.hypot(_dir.x, _dir.z);
    if (flat < 0.05) return null;
    const t = PLACE.reach / flat;
    return { x: from.x + _dir.x * t, y: from.y + _dir.y * t, z: from.z + _dir.z * t };
  }

  private ontoGround(from: THREE.Vector3): { point: { x: number; y: number; z: number } } | null {
    for (let d = 0.5; d <= 9; d += 0.25) {
      const x = from.x + _dir.x * d, y = from.y + _dir.y * d, z = from.z + _dir.z * d;
      if (y <= heightAt(this.h.world.heights, x, z)) return { point: { x, y: heightAt(this.h.world.heights, x, z), z } };
    }
    return null;
  }

  /** a cost against what is carried, each thing in green when there is enough of it and in red when not */
  private costHtml(cost: Record<string, number>) {
    if (this.h.creative()) return '<span class="ok">Creative</span>';
    return Object.entries(cost).map(([id, n]) => `<span class="${this.h.count(id) >= n ? 'ok' : 'no'}">${amount(id, n)}</span> <small>(${this.h.count(id)})</small>`).join(' · ');
  }

  private short(cost: Record<string, number>): string | null {
    if (this.h.creative()) return null;
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
    this.kept = null;
    const [x, y, z] = this.ghost ? [this.ghost.position.x, this.ghost.position.y, this.ghost.position.z] : [ask.x, 0, ask.z];
    audio.impact('wood', { x, y, z }, 1);
    // (a frame nailed together; a sleeping bag or a bed's bedding laid out)
    audio.built(PIECES[ask.k].sleep ? 'cloth' : 'nail', { x, y: y + 0.5, z }, 0.9);
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
    // (a workbench goes up in levels, the rest in tiers to armoured: the progression plan)
    const top = topOf(p.k), next = Math.min(top, p.t + 1) as Tier, said = (n: number) => (K.levels ? `level ${ROMAN[n]}` : TIERS[n]);
    const head = `${K.name} · ${K.levels ? `Level ${ROMAN[p.t]} · ` : K.only !== undefined ? '' : `${TIERS[p.t]} · `}${Math.round(p.hp)}/${hpOf(p.k, p.t)}`;
    if (this.mendFrame(hammer, t.base, p, head)) return;
    if ((K.only !== undefined && !K.levels) || p.t >= top) {
      this.prompt = card(head, '', 'hold the right button to take it down');
      return;
    }
    const cost = costOf(p.k, next), why = this.store.canUpgrade(t.base.id, p.id, next, this.h.creative()) ?? this.short(cost);
    this.prompt = card(head, `${why ? `<span class="no">${why}</span> · ` : ''}up to ${said(next)}: ${this.costHtml(cost)}`, 'hold the right button for more', why ? undefined : 'LMB');
    if (this.h.input.pressed('Mouse0') && !this.h.busy() && !why) this.upgrade(hammer, t.base, t.id, next);
  }

  /** a hurt piece at the hammer: the left button held mends it a bit a blow, out of the pockets (Rust's) */
  private mendFrame(hammer: ItemInstance, base: Base, p: Piece, head: string): boolean {
    if (p.hp >= hpOf(p.k, p.t) - 0.5) return false;
    const free = this.h.creative(), bit = mendOf(p), why = free ? null : this.store.canRepair(base.id, p.id, this.raid.struckAt(base.id, p.id), Date.now()) ?? this.short(bit.cost);
    this.prompt = card(head, `${why ? `<span class="no">${why}</span> · ` : ''}repair, a blow: ${free ? '<span class="ok">Creative</span>' : this.costHtml(bit.cost)}`, 'hold the left button to mend it · the right button for more', why ? undefined : 'LMB');
    const input = this.h.input, now = performance.now();
    if (!input.held('Mouse0') || this.h.busy() || now < this.mendAt) return true;
    this.mendAt = now + NAIL.blow * 1000 + 90;
    if (why) {
      if (input.pressed('Mouse0')) this.h.note(why, 'warn');
      return true;
    }
    this.h.work(NAIL.blow);
    const [x, y, z] = toWorld(base, p.x, p.y + 1, p.z);
    setTimeout(() => audio.built('nail', { x, y, z }, 0.9, 0.94 + Math.random() * 0.12), NAIL.lands * NAIL.blow * 1000);
    if (this.h.online()) return void this.h.send({ t: 'bfix', b: base.id, p: p.id, u: hammer.uid, bit: 1 }), true;
    for (const [k, n] of Object.entries(bit.cost)) this.h.take(k, n);
    p.hp = Math.min(hpOf(p.k, p.t), p.hp + bit.gain);
    hammer.cond = worn(hammer.id, hammer.cond);
    this.draw.put(base, p);
    this.bump(base.id);
    this.h.changed();
    return true;
  }
  private mendAt = 0;

  /** the hammer at a piece for its tier's seconds, then up a tier (the server says whether, online) */
  private upgrade(hammer: ItemInstance, base: Base, id: number, to: Tier) {
    if (condition(hammer.cond).ruined) return void this.h.note('Your hammer is ruined', 'warn');
    const p = base.pieces.get(id);
    if (!p) return;
    const still = () => this.h.held()?.uid === hammer.uid && this.target()?.id === id && this.target()?.base === base;
    if (this.h.online()) this.h.send({ t: 'bup', b: base.id, p: id, to, go: 1, u: hammer.uid });
    // (creative: at once, no hold)
    if (this.h.creative()) return void this.h.send({ t: 'bup', b: base.id, p: id, to, go: 2, u: hammer.uid });
    this.nail(base, p);
    this.h.begin(PIECES[p.k].levels ? `Bringing the ${PIECES[p.k].name.toLowerCase()} up to level ${ROMAN[to]}` : `Nailing the ${PIECES[p.k].name.toLowerCase()} up to ${TIERS[to].toLowerCase()}`, TIER_S[to], still, () => {
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

  /** the hammer heard at a piece while it works at it (the nails go in until the work is done or stopped) */
  private nailing: { at: { x: number; y: number; z: number }; next: number; ring: number } | null = null;
  private nail(base: Base, p: { x: number; y: number; z: number; k: string }) {
    const [x, y, z] = toWorld(base, p.x, p.y + (PIECES[p.k].role === 'floor' ? 0 : 1.2), p.z);
    this.nailing = { at: { x, y, z }, next: 0, ring: 0 };
  }

  /** pieces of a base broken in this game's own copy of it (alone: a raid, src/game/building/raid.ts), with what stood only on them */
  private brokeAlone(base: Base, ids: number[]) {
    for (const id of ids) {
      if (!base.pieces.has(id)) continue;
      this.draw.remove(base.id, this.local.remove(base.id, id));
    }
    this.synced(base);
    this.bump(base.id);
  }

  /** whether a thing looked at is picked up by hand: set down from an item, in a base the player may work */
  private mineByHand(t: { base: Base; id: number }) {
    const p = t.base.pieces.get(t.id);
    return !!p && byHand(p.k) && this.store.mayWork(t.base, this.me);
  }

  /** a thing set down, picked up whole by hand (F held at it): a box only when it is empty, a workbench with its levels */
  private pickUpByHand(base: Base, id: number) {
    const p = base.pieces.get(id);
    if (!p) return;
    if (this.boxes.byCid(`bbox:${base.id}:${id}`)?.container.serialize().items.length) return void this.h.note('Empty it first', 'warn');
    if (this.h.online()) return void this.h.send({ t: 'bdel', b: base.id, p: id, u: '', hand: 1 });
    const back = this.local.refund(base.id, id), gone = this.local.remove(base.id, id);
    this.draw.remove(base.id, gone);
    this.synced(base);
    this.bump(base.id);
    const items = Object.entries(back).map(([k, n]) => makeItem(k, n));
    if (items.length) this.h.give(items, Object.entries(back).map(([k, n]) => `${n} ${ITEMS[k].name}`).join(', '));
    this.h.changed();
  }

  /** @param scrap broken up for some of its materials, not picked up whole (a thing set down from the hands) */
  private takeDown(hammer: ItemInstance, base: Base, id: number, scrap = false) {
    const p = base.pieces.get(id);
    if (!p) return;
    if (!scrap && this.boxes.byCid(`bbox:${base.id}:${id}`)?.container.serialize().items.length) return void this.h.note('Empty it first, or deconstruct it', 'warn');
    const still = () => this.h.held()?.uid === hammer.uid && !!base.pieces.get(id);
    const up = (PIECES[p.k].role === 'deploy' && p.k !== 'claim') || !!PLACED[p.k], name = PIECES[p.k].name.toLowerCase();
    this.h.begin(scrap ? `Deconstructing the ${name}` : up ? `Picking the ${name} up` : `Taking the ${name} down`, 2, still, () => {
      if (!still()) return;
      if (this.h.online()) return void this.h.send({ t: 'bdel', b: base.id, p: id, u: hammer.uid, ...(scrap ? { scrap: 1 as const } : {}) });
      const back = scrap ? this.local.salvage(base.id, id) : this.local.refund(base.id, id), gone = this.local.remove(base.id, id);
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
    if (what === 'plan') this.wheelCat = Math.max(0, CATS.findIndex((c) => c.cat === (printOf(this.kind) ? 'found' : PIECES[this.kind].cat)));
    this.fillWheel();
    this.wheel.open();
    this.say(this.hubFor(-1));
  }

  private fillWheel() {
    if (this.wheelFor === 'hammer') {
      const t = this.target();
      this.wheel.set(hammerEntries(t ? t.base.pieces.get(t.id) ?? null : null));
    } else this.wheel.set(planEntries(this.wheelCat, this.kind));
  }

  /** the hub says the name only; what it costs or gives is the line under the wheel */
  private say([title, foot]: [string, string]) {
    this.wheel.hub(title, '');
    const el = this.wheel.el.querySelector('.radial-foot') ?? this.wheel.el.appendChild(Object.assign(document.createElement('div'), { className: 'radial-foot' }));
    el.textContent = foot;
  }

  private wheelFrame(ok: boolean) {
    const input = this.h.input, at = this.wheelAt;
    at.x += input.mouseDX / RING.reach;
    at.y += input.mouseDY / RING.reach;
    if (at.length() > 1) at.normalize();
    const pick = this.wheel.pickAt([at.x, at.y]);
    // (onto another group: its pieces come round the outside)
    if (this.wheelFor === 'plan' && pick >= 0 && pick < CATS.length && pick !== this.wheelCat) {
      this.wheelCat = pick;
      this.fillWheel();
    }
    if (pick !== this.wheelPick) {
      this.wheelPick = pick;
      this.say(this.hubFor(pick));
    }
    this.wheel.point(pick, [at.x, at.y]);
    if (ok && input.held('Mouse2')) return;
    // (let go: what is under the pointer is done; on Cancel or the hub, nothing)
    const what = this.wheelFor;
    this.wheelFor = null;
    const chose = pick >= 0 && this.choose(what, pick);
    this.wheel.close(chose || pick === Radial.CANCEL ? pick : -1);
  }

  /** the hub's word for wedge `pick`, and the line under the wheel */
  private hubFor(pick: number): [string, string] {
    if (pick === Radial.CANCEL) return ['Cancel', ''];
    const costs = (c: Record<string, number>) => Object.entries(c).map(([k, n]) => `${amount(k, n)} (${this.h.count(k)})`).join(' · ');
    if (this.wheelFor === 'hammer') {
      const w = pick >= 0 ? HAMMER_WHEEL[pick] : '';
      const t = this.target(), p = t ? t.base.pieces.get(t.id) : null;
      if (!w) return ['Hammer', p ? `${PIECES[p.k].name} · ${PIECES[p.k].levels ? `Level ${ROMAN[p.t]}` : TIERS[p.t]}` : 'Look at a piece'];
      if (w === 'remove') return [(PIECES[p?.k ?? '']?.role === 'deploy' && p?.k !== 'claim') || PLACED[p?.k ?? ''] ? 'Pick up' : 'Take down', p ? `Back: ${Object.entries(this.store.refund(t!.base.id, t!.id)).map(([k, n]) => amount(k, n)).join(' · ') || 'nothing'}` : ''];
      if (w === 'scrap') return ['Deconstruct', p && PLACED[p.k] ? `Back: ${Object.entries(this.store.salvage(t!.base.id, t!.id)).map(([k, n]) => amount(k, n)).join(' · ') || 'nothing'}` : 'Only what is set down from the hands'];
      if (w.startsWith('up') && p) {
        const to = Number(w.slice(2)) as Tier, why = this.store.canUpgrade(t!.base.id, t!.id, to, this.h.creative());
        return [PIECES[p.k].levels ? `Level ${ROMAN[to] ?? ''}` : TIERS[to], why && !why.startsWith('It is') ? why : costs(costOf(p.k, to))];
      }
      if (w === 'unlock') return ['Take the lock off', p?.lock ? `The ${p.lock.k === 'code' ? 'code' : 'key'} lock back in your pockets` : 'There is no lock on it'];
      if (!p || !t) return [w === 'repair' ? 'Repair' : 'Turn', 'Look at a piece'];
      if (w === 'repair') return ['Repair', this.store.canRepair(t.base.id, t.id, this.raid.struckAt(t.base.id, t.id), Date.now()) ?? costs(repairOf(p))];
      return ['Turn', this.store.canTurn(t.base.id, t.id, Date.now()) ?? (PIECES[p.k].role === 'deploy' ? 'a quarter round' : 'the other way about')];
    }
    if (pick < 0) return [nameOf(this.kind), 'Let go on a piece'];
    if (pick < CATS.length) return [CATS[pick].cat === 'found' ? 'Foundations' : CATS[pick].label, ''];
    const id = pieceAt(this.wheelCat, pick);
    return id ? [nameOf(id), costs(printOf(id) ? printCost(id) : costOf(id, laidAt(id)))] : [nameOf(this.kind), ''];
  }

  /** what the wheel's wedge `pick` does; true when it did something */
  private choose(what: 'plan' | 'hammer' | null, pick: number): boolean {
    if (what === 'plan') {
      const id = pieceAt(this.wheelCat, pick);
      if (id) {
        this.kind = id;
        this.turn = 0;
        return true;
      }
      // (a group let go on: its first piece)
      if (pick >= CATS.length) return false;
      const cat = CATS[pick].cat;
      this.kind = itemsOf(cat).includes(this.kind) ? this.kind : itemsOf(cat)[0];
      return true;
    }
    const w = HAMMER_WHEEL[pick], held = this.h.held(), t = this.target();
    if (!w || !held || !t) return false;
    if (w === 'remove' || w === 'scrap') {
      const p = t.base.pieces.get(t.id);
      if (w === 'scrap' && !(p && PLACED[p.k])) return false;
      this.takeDown(held, t.base, t.id, w === 'scrap');
      return true;
    }
    if (w === 'unlock') {
      const p = t.base.pieces.get(t.id);
      if (!p?.lock) return false;
      this.locks.unfit(t.base, p, held);
      return true;
    }
    if (w.startsWith('up')) {
      const to = Number(w.slice(2)) as Tier, p = t.base.pieces.get(t.id)!;
      const why = this.store.canUpgrade(t.base.id, t.id, to, this.h.creative()) ?? this.short(costOf(p.k, to));
      if (why) {
        this.h.note(why, 'warn');
        return false;
      }
      this.upgrade(held, t.base, t.id, to);
      return true;
    }
    return this.mend(held, t.base, t.id, w === 'rotate');
  }

  /** the hammer at a piece: mended whole for a share of its cost, or turned about (the server says whether, online) */
  private mend(hammer: ItemInstance, base: Base, id: number, turn: boolean): boolean {
    const p = base.pieces.get(id);
    if (!p) return false;
    const now = Date.now(), why = this.h.creative() ? null : turn ? this.store.canTurn(base.id, id, now) : this.store.canRepair(base.id, id, this.raid.struckAt(base.id, id), now) ?? this.short(repairOf(p));
    if (why) {
      this.h.note(why, 'warn');
      return false;
    }
    const name = PIECES[p.k].name.toLowerCase(), still = () => this.h.held()?.uid === hammer.uid && !!base.pieces.get(id);
    if (this.h.creative()) {
      this.h.send({ t: 'bfix', b: base.id, p: id, u: hammer.uid, ...(turn ? { turn: true } : {}) });
      return true;
    }
    this.nail(base, p);
    this.h.begin(turn ? `Turning the ${name} about` : `Mending the ${name}`, turn ? 1.5 : 3, still, () => {
      if (!still()) return;
      if (this.h.online()) return void this.h.send({ t: 'bfix', b: base.id, p: id, u: hammer.uid, ...(turn ? { turn: true } : {}) });
      if (turn) this.local.turn(base.id, id);
      else {
        const cost = repairOf(p), no = this.short(cost);
        if (no) return void this.h.note(no, 'warn');
        for (const [k, n] of Object.entries(cost)) this.h.take(k, n);
        this.local.repair(base.id, id);
      }
      hammer.cond = worn(hammer.id, hammer.cond);
      this.draw.put(base, p);
      this.bump(base.id);
      this.h.changed();
    }, 'You stopped: it is as it was');
    return true;
  }

  // ---- what the server says

  onBase(m: Extract<S2C, { t: 'base' }>) {
    const b = heard(m.b);
    if (!b) return;
    this.seen.bases.set(b.id, b);
    this.draw.setBase(b);
    this.draw.solidNear(this.h.me());
    this.synced(b);
    this.bump(b.id);
  }
  onGone(m: Extract<S2C, { t: 'bgone' }>) {
    this.seen.bases.delete(m.b);
    this.draw.forget(m.b);
    this.claims.forget(m.b);
    this.boxes.forget(m.b);
  }
  /** a base's blueprint as it is now (filled some more, done, or called off) */
  onSite(m: Extract<S2C, { t: 'bsite' }>) {
    const b = this.seen.bases.get(m.b);
    if (b) b.site = heardSite(m.s);
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
    this.raid.broke(b, m.ids);
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
      if (!p) continue;
      // (struck, if it was not rot: rot is told an hour's worth at a time, and only to a base with no claim or a dry one)
      if (hp < p.hp - 1) this.raid.mark(m.b, id);
      p.hp = hp;
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
    this.torches.clear();
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
