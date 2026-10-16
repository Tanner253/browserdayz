// The seventeenth film: "The man in the window" (2026-10-16). A story, the real game on a clock that only moves when
// the film says. The owner: "a high quality trailer ... origional ... should tell a story ... maybe theres a camper in
// a 2nd story of a house and people united by being killed form this person team up and take them down"; and on the
// board (marketing/plan-film-17.html, said yes to): "i want this to look like a movie, flush and smooth transitions
// etc... high quality, no visual bugs or glitches shown".
//
// The story, in four acts. ONE: dusk in Kamenka; a camper (Volkov) in the upstairs of a brick townhouse kills Mira
// going through a bag on the road, Dmitri dancing at the well, Kestrel in the police car. TWO: the three meet, fresh
// off the map's edge with nothing, and gear up: Mira at the police HQ, Dmitri in the gas, Kestrel by helicopter to
// the fort's vaults; a night by a fire, a plan. THREE: dawn; Mira as the bait takes a leg and crawls; Kestrel cooks a
// frag onto the balcony; Dmitri comes up the stair and finishes him with a hatchet; the tag, a dance in the street,
// what a tag pays. FOUR: dusk again, the same window: Kestrel at the sill, her scope on a packless figure at a bag on
// the road. It is Volkov. Black on the crack. What is coming, said as coming.
//
// Every figure on the screen is read off the rules or the world as the film is made, or written below with where it
// is from (LIVE). Nothing runs at any speed but its own. Nothing is borrowed from the sixteen films before it.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import { scoreMusic17, type Kind17, type Row17 } from './music17';
import { physics, SOLID_GROUPS } from '../core/physics';
import { castleAt, type FortPlace } from '../sim/castle';
import { UNDER } from '../sim/castle/plan';
import { HELI, heliSpots } from '../sim/heli';
import { GAS } from '../sim/gas';
import { BLOOD } from '../sim/blood';
import { ITEMS, makeItem } from '../sim/items';
import { EMOTE, EMOTE_SHIFT } from '../sim/emotes';
import { F_LIMP, F_PRONE, F_SIT } from '../net/protocol';
import { SEATS_OF } from '../game/garage';
import { RIDE_HEIGHT } from '../sim/vehicles';
import { TOWN, SQUARE_HALF } from '../world/worldgen';

/** how long the film is, seconds: said when its shots have been laid out */
let total = 0;
export const seconds17 = () => total;
/** its score, a bar of two seconds to each row, written from its own shots (see `add`) */
const ROWS: Row17[] = [];
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic17(ctx, out, ROWS);

const ASKED = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
/** `?scout=1`: a second on each of the film's places from a free camera, to find the stair, the sill, the well */
const SCOUT = ASKED.has('scout');

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** a gain per second, as a fraction of the way each frame (the same turn at 30 and at 60 frames) */
const gain = (k: number, dt: number) => 1 - Math.exp(-k * dt);

/**
 * What was read off the live payouts record on 16 Oct 2026 07:45 UTC (`/api/cashins?format=json`, a read): tags
 * paid since the machine was switched on 8 Oct 2026, the SOL that went out, the wallets it went to; and the rule
 * (`?format=status`): a tag pays 0.01 SOL, more for holding $ZONA, up to 0.025. RE-READ BEFORE FILMING AGAIN.
 */
const LIVE = { paid: 232, sol: 3.86, wallets: 35, since: '8 OCT 2026', tagPays: 0.01, tagMax: 0.025 };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Extra = {
  fadeIn?: number; fadeOut?: number;
  /** black from this second of the shot to its end (the crack, and nothing after it) */
  dark?: number;
  /** the hour of the game's day it is filmed at */
  hour?: number;
  /** words at the foot of the picture: from, until, what */
  plates?: [number, number, string][];
  /** a line of the story across the picture: from, until, what */
  line?: [number, number, string];
  /** how many frames nobody sees are run when the hour has been turned to */
  settle?: number;
  /** its people put where they are, after the hour has been turned to */
  stage?: () => void | Promise<void>;
  /** what the score plays under it (one kind for all its bars), and a blow as it opens */
  m?: Kind17;
  hit?: number;
  lift?: boolean;
  under?: boolean;
};
type Build = { id: string; type: string; x: number; z: number; rot: number; floorY: number };

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any, world = S.world as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  document.body.classList.add('tr-cut17');
  const overlay = document.getElementById('tr-overlay')!;
  const say = (...a: unknown[]) => console.log('[tr] cut 17:', ...a);
  const scene: THREE.Scene = g.s.r.scene;

  // ------------------------------------------------------------ places
  /** what is underfoot at a spot: the top of whatever stops a body under it, looked for from so far over it to so far under */
  const under = (p: THREE.Vector3, up = 1.2, far = 30): number | null => {
    const hit = physics.raycast({ x: p.x, y: p.y + up, z: p.z }, { x: 0, y: -1, z: 0 }, up + far, SOLID_GROUPS);
    return hit ? p.y + up - hit.toi : null;
  };
  const yawTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
  const builds = world.buildings as Build[];
  const one = (type: string) => {
    const b = builds.find((q) => q.type === type);
    if (!b) throw new Error(`the map has no ${type}`);
    return b;
  };
  /** a place in a building, by its own measure: so far to its right, so far to its front (its front is +z), so far above its floor */
  const at = (b: Build, lx: number, lz: number, up = 0) => {
    const co = Math.cos(b.rot), si = Math.sin(b.rot);
    return new THREE.Vector3(b.x + lx * co + lz * si, b.floorY + up, b.z - lx * si + lz * co);
  };
  const T = TOWN, ul = Math.hypot(T.street[0], T.street[1]), ux = T.street[0] / ul, uz = T.street[1] / ul;
  /** a place in Kamenka: so far down its street, so far to the right of it, so high over the ground */
  const K = (along: number, right = 0, up = 0) => S.at(T.x + ux * along + uz * right, T.z + uz * along - ux * right, up);
  /** the way down the street, and across it to the right */
  const DOWN = V(ux, 0, uz), RIGHT = V(uz, 0, -ux);
  /** the camper's house: the brick townhouse on the right of the street by the middle of the town (a balcony over its door, two floors) */
  const house = (() => {
    const want = K(10, 11.2);
    const th = builds.filter((b) => b.type === 'townhouse');
    if (!th.length) throw new Error('Kamenka has no townhouse');
    return th.reduce((a, b) => (Math.hypot(a.x - want.x, a.z - want.z) < Math.hypot(b.x - want.x, b.z - want.z) ? a : b));
  })();
  /** a place in the camper's house, by the model's own measure (its balcony door is in its -x wall at z -4.5, 3.29 m up) */
  const H = (lx: number, lz: number, up = 0) => at(house, lx, lz, up);
  /** the upstairs floor, measured (the model says 0.18 + 3.294 over its ground) */
  const UP = (() => {
    const said = 0.18 + 3.294;
    const y = under(H(-1.5, -3.0, said + 0.9), 0.2, 1.6);
    if (y === null || Math.abs(y - (house.floorY + said)) > 0.6) {
      say(`upstairs floor: not measured (${y}); the model's ${said.toFixed(2)} taken`);
      return said;
    }
    return y - house.floorY;
  })();
  /** where the camper stands: at the wide upstairs window on the street side (its opening runs z -2.5 to -0.75, measured by rays), the rifle out through it */
  /** the house's doors stood open for the lens, and shut again after */
  const doors = (g.s.buildings.doors ?? []) as { pivot: THREE.Object3D; open: boolean; setOpen(open: boolean, swing?: number): void }[];
  const opened: (typeof doors)[number][] = [];
  const doorPos = new THREE.Vector3();
  const shutDoors = () => {
    for (const d of opened.splice(0)) d.setOpen(false);
  };
  const openDoors = (p: THREE.Vector3, reach: number) => {
    for (const d of doors) {
      const q = d.pivot.getWorldPosition(doorPos);
      if (!d.open && Math.hypot(q.x - p.x, q.z - p.z) < reach) {
        d.setOpen(true);
        opened.push(d);
      }
    }
  };
  /** the balcony's floor where the camper stands (its planks are a little under the room's floor), measured */
  const balconyY = (lx: number, lz: number) => under(H(lx, lz, UP + 0.8), 0.2, 1.8);
  const NEST0 = (() => {
    const n = H(-4.2, -3.2, UP), y = balconyY(-4.2, -3.2);
    if (y === null) say('the balcony has no floor under the camper: the room\'s height taken');
    else n.y = y;
    return n;
  })();
  let NEST = NEST0.clone();
  /** the camper stood on the balcony by its door, where the rail is under his eye and the target is seen clear */
  const nestFor = (target: THREE.Vector3) => {
    for (const lx of [-4.2, -4.0, -4.4]) {
      for (const dz of [0, -0.3, 0.3, -0.6, 0.6]) {
        const n = H(lx, -3.2 + dz, UP), y = balconyY(lx, -3.2 + dz);
        if (y === null) continue;
        n.y = y;
        const eye = n.clone().setY(n.y + 1.64);
        if (S.clearLine(eye, target) && S.clearLine(eye.clone().setY(eye.y - 0.25), target)) {
          NEST = n;
          return n;
        }
      }
    }
    say(`no clear line from the balcony to ${target.x.toFixed(0)},${target.z.toFixed(0)}: the door end taken`);
    NEST = NEST0.clone();
    return NEST;
  };
  /** the balcony door stood open: the camper went out through it */
  const camperOut = () => openDoors(H(-3.9, -4.5, UP + 1), 2.5);
  /** the window's middle, and a point just outside it */
  const SILL = H(-3.9, -1.6, UP + 1.45), BALC = H(-4.6, -1.6, UP + 1.3);
  /** the street in front of the house: its door side is the side toward the street */
  const FRONT = (along: number, right = 0, up = 0) => {
    void along;
    return K(10 + along, right, up);
  };
  /** the well of Kamenka */
  const WELL = (() => {
    const wells = (g.wells ?? []) as { x: number; z: number }[];
    if (!wells.length) return K(-10, -6);
    const w = wells.reduce((a, b) => (Math.hypot(a.x - T.x, a.z - T.z) < Math.hypot(b.x - T.x, b.z - T.z) ? a : b));
    return S.at(w.x, w.z);
  })();
  const hq = one('police_hq');
  /** the Chemical Works: where the gas lies */
  const GASAT = (() => {
    const p = (world.pois as { name: string; x: number; z: number }[]).find((q) => q.name === GAS.place);
    if (!p) throw new Error('no Chemical Works on the map');
    return S.at(p.x, p.z);
  })();
  /** the fort, by its own measure */
  const FP = world.castle as FortPlace | null;
  if (!FP) throw new Error('the map has no fort');
  const F = (x: number, z: number, y = 0) => {
    const [wx, wy, wz] = castleAt(FP, x, z, y);
    return new THREE.Vector3(wx, wy, wz);
  };
  const spots = heliSpots(world);
  const ROOF = spots[0], PAD = spots[1];
  if (!ROOF || !PAD) throw new Error('a helicopter spot is missing');
  const trunks = ((world.trees ?? []) as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush'));
  const nearestTrunk = (x: number, z: number) => trunks.reduce((d, t) => Math.min(d, Math.hypot(t.x - x, t.z - z)), 99);
  /** the edge of the map on Kamenka's side: open level ground just inside the wall, where a new life walks in from */
  const EDGE = (() => {
    const dir = V(T.x, 0, T.z).normalize();
    const level = (x: number, z: number) => Math.abs(S.ground(x + 6, z) - S.ground(x - 6, z)) < 1.6 && Math.abs(S.ground(x, z + 6) - S.ground(x, z - 6)) < 1.6;
    const built = (x: number, z: number) => builds.some((b) => Math.hypot(b.x - x, b.z - z) < 24);
    for (let r = SQUARE_HALF - 14; r > SQUARE_HALF - 90; r -= 4) {
      for (let k = 0; k < 24; k++) {
        const a = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.03;
        const x = (dir.x * Math.cos(a) - dir.z * Math.sin(a)) * r, z = (dir.x * Math.sin(a) + dir.z * Math.cos(a)) * r;
        if (Math.abs(x) > SQUARE_HALF - 6 || Math.abs(z) > SQUARE_HALF - 6) continue;
        if (nearestTrunk(x, z) > 7 && level(x, z) && !built(x, z) && nearestTrunk(x - dir.x * 30, z - dir.z * 30) > 5) return S.at(x, z);
      }
    }
    say('no open ground at the edge: the edge itself taken');
    return S.at(dir.x * (SQUARE_HALF - 20), dir.z * (SQUARE_HALF - 20));
  })();
  /** inward from the edge, toward the town */
  const IN = V(-EDGE.x, 0, -EDGE.z).normalize();
  const ACROSS = V(-IN.z, 0, IN.x);
  /** the fire ring in the wood over Kamenka: the nearest to the town that is out of it */
  const FIRE = (() => {
    const fs = (g.fires?.spots ?? []) as THREE.Vector3[];
    let best = -1, d = 1e9;
    fs.forEach((s, i) => {
      const e = Math.hypot(s.x - T.x, s.z - T.z);
      if (e > 60 && e < d) [best, d] = [i, e];
    });
    if (best < 0 && fs.length) best = 0;
    return { i: best, p: best >= 0 ? fs[best].clone() : K(60, 30) };
  })();
  say(`house ${house.id} at ${house.x.toFixed(0)},${house.z.toFixed(0)} rot ${house.rot.toFixed(2)}; upstairs ${UP.toFixed(2)}; well ${WELL.x.toFixed(0)},${WELL.z.toFixed(0)}; edge ${EDGE.x.toFixed(0)},${EDGE.z.toFixed(0)}; fire ${FIRE.i} at ${FIRE.p.x.toFixed(0)},${FIRE.p.z.toFixed(0)}; gas ${GASAT.x.toFixed(0)},${GASAT.z.toFixed(0)}`);

  // ------------------------------------------------------------ a lens held in a hand
  const hand = (pose: CamPose, t: number, amp = 1, seed = 0): CamPose => {
    const n = (f: number, ph: number) => Math.sin(t * f + ph + seed) * 0.6 + Math.sin(t * f * 2.3 + ph * 1.7 + seed) * 0.4;
    const p = pose.p.clone(), l = pose.l.clone();
    p.x += n(1.9, 0.3) * 0.014 * amp;
    p.y += n(2.3, 1.1) * 0.011 * amp;
    p.z += n(1.7, 2.2) * 0.014 * amp;
    l.x += n(2.9, 4.1) * 0.022 * amp;
    l.y += n(3.3, 5.2) * 0.017 * amp;
    l.z += n(2.6, 0.7) * 0.022 * amp;
    return { ...pose, p, l, roll: (pose.roll ?? 0) + n(1.3, 3.3) * 0.004 * amp };
  };
  /** a lens that follows a moving thing with a little weight (no swing from frame to frame) */
  const rig = { p: new THREE.Vector3(), l: new THREE.Vector3(), t: -1e9 };
  const follow = (p: THREE.Vector3, l: THREE.Vector3, t: number, k = 6): CamPose => {
    const dt = t - rig.t;
    if (dt < 0 || dt > 0.5) {
      rig.p.copy(p);
      rig.l.copy(l);
    } else {
      rig.p.lerp(p, gain(k, dt));
      rig.l.lerp(l, gain(k * 1.5, dt));
    }
    rig.t = t;
    return { p: rig.p.clone(), l: rig.l.clone() };
  };

  // ------------------------------------------------------------ the look: grain, a fade, the dark, and the words
  const piece = (cls: string, html = '') => {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    overlay.appendChild(el);
    return el;
  };
  const grain = piece('tr-grain4'), black = piece('tr-black4');
  piece('tr-vig4');
  let frame = 0;
  const look = (t: number, len: number, o: Extra) => {
    frame++;
    grain.style.transform = `translate(${((frame * 73) % 97) - 48}px, ${((frame * 41) % 89) - 44}px)`;
    const a = o.fadeIn ? 1 - ease(t / o.fadeIn) : 0, z = o.fadeOut ? ease((t - (len - o.fadeOut)) / o.fadeOut) : 0;
    black.style.opacity = String(Math.max(a, z, o.dark !== undefined && t >= o.dark ? 1 : 0));
  };
  const gfx: HTMLElement[] = [];
  const Gx = (cls: string, html: string) => {
    const el = piece(`tr-gfx ${cls}`, html);
    el.style.display = 'none';
    gfx.push(el);
    return el;
  };
  const show = (el: HTMLElement, t: number, o = 1) => {
    el.style.display = '';
    el.style.setProperty('--t', t.toFixed(3));
    el.style.setProperty('--o', o.toFixed(3));
  };
  const plate = Gx('x10-plate', '<span></span>');
  const line = Gx('x17-line', '<span></span>');
  const title = Gx('x17-title', `
    <div class="t17-kick">ZONA &nbsp;·&nbsp; A STORY FROM THE ZONE</div>
    <div class="t17-name">THE MAN IN<br>THE <em>WINDOW</em></div>`);
  /** words that stay on over the black at the end */
  line.style.zIndex = '5';

  // ------------------------------------------------------------ people, and frames nobody sees
  const A = (i: number) => S.actors[i];
  const VOLKOV = 0, MIRA = 1, KESTREL = 2, DMITRI = 3;
  const NAME = (i: number) => A(i).name;
  const hush = () => document.querySelectorAll('.hud-notes > *').forEach((e) => e.remove());
  const clearFeed = () => document.querySelectorAll('.hud-feed > *').forEach((e) => e.remove());
  /** frames nobody sees or hears */
  const run = async (frames: number, each?: (k: number) => boolean | void) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      if (each?.(i) === false) break;
      for (const a of S.actors) a.push();
      clock.advance(1000 / 60);
      if (i % 20 === 19) await wait(8);
    }
    S.mute = false;
  };
  const dressing: Promise<unknown>[] = [];
  /** somebody of the cast stood on a floor (which is not always the ground's) */
  const stand = (a: Actor, p: THREE.Vector3, yaw: number, weapon: string | null = null, gear: string[] = []) => {
    a.place(p.x, p.z, yaw, weapon, gear);
    a.pos.y = p.y;
    dressing.push(Promise.resolve(g.wear(a.rp.avatar, gear)).catch(() => {}));
    return a;
  };
  const dressed = async () => {
    let done = false;
    void Promise.all(dressing.splice(0)).then(() => (done = true));
    for (let i = 0; i < 90 && !done; i++) {
      await run(1);
      await wait(12);
    }
    if (!done) say('somebody is not dressed yet as the shot opens');
  };
  /** how each is dressed and armed: the first evening (what they lose), fresh (nothing), and geared for the morning */
  const LOOK = {
    camper: { weapon: 'mosin', gear: ['boonie_hat', 'sack_pack'] },
    mira0: { weapon: null, gear: ['sack_pack'] },
    dmitri0: { weapon: null, gear: ['life_vest'] },
    kestrel0: { weapon: null, gear: ['patrol_cap'] },
    fresh: { weapon: null, gear: [] as string[] },
    mira: { weapon: 'ar15', gear: ['chest_rig', 'patrol_cap'] },
    dmitri: { weapon: 'hatchet', gear: ['armor_vest', 'helmet_m1', 'gasmask'] },
    kestrel: { weapon: null, gear: ['soft_vest', 'boonie_hat'] },
    volkov0: { weapon: null, gear: [] as string[] },
  };
  type Look = keyof typeof LOOK;
  const cast = (i: number, p: THREE.Vector3, yaw: number, look: Look) => stand(A(i), p, yaw, LOOK[look].weapon, LOOK[look].gear);
  const THINGS = ['boonie_hat', 'sack_pack', 'life_vest', 'patrol_cap', 'chest_rig', 'armor_vest', 'helmet_m1', 'gasmask', 'soft_vest', 'mosin', 'ar15', 'hatchet', 'frag', 'blood_bag', 'pu_scope'];
  /** who sits in a vehicle, and where */
  const seat = (a: Actor, j: Any, k: number) => {
    (a.rp as Any).seat = { jeep: j, at: SEATS_OF[j.kind][k], how: null };
  };
  /** a pack dance on a body, as the game shows another player's */
  const dance = (a: Actor, id: string | null) => {
    a.dance = !!id;
    a.more = (a.more & ~(0x7f << EMOTE_SHIFT)) | (id ? (EMOTE[id]?.n ?? 0) << EMOTE_SHIFT : 0);
  };
  /** a thing of the camper's (and later Kestrel's): a lamp in the upstairs room, the one lit window of the street */
  const lamp = new THREE.PointLight(0xffb366, 0, 16, 1.6);
  lamp.position.copy(H(-1.4, -1.0, UP + 2.2));
  scene.add(lamp);
  /** a light at the first-person hands, for under a roof (the sleeves are black there without it) */
  const handLamp = new THREE.PointLight(0xfff0dc, 0, 6, 1.2);
  handLamp.position.set(0.2, 0.3, -0.4);
  (g.weapons.vmScene as THREE.Scene | undefined)?.add(handLamp);
  /** a cool wash of light over whoever the street's dusk shots watch (the game's dusk leaves a body black) */
  const fill = new THREE.PointLight(0xbfcfff, 0, 16, 1.5);
  scene.add(fill);
  const fillOn = (p: THREE.Vector3, toward: THREE.Vector3, strength = 2.4) => {
    fill.intensity = strength;
    fill.position.copy(p).setY(p.y + 3.2).addScaledVector(toward.clone().sub(p).setY(0).normalize(), 2.5);
  };
  /** a light for the vault */
  const vaultLamp = new THREE.PointLight(0xffd9a0, 0, 14, 1.4);
  scene.add(vaultLamp);

  // ------------------------------------------------------------ the police car
  const car = (): Any => {
    let best: Any = null, d = 1e9;
    for (const j of (g.garage.jeeps as Map<number, Any>).values()) {
      if (j.kind !== 1) continue;
      const e = Math.hypot(j.pos.x - T.x, j.pos.z - T.z);
      if (e < d) [best, d] = [j, e];
    }
    return best;
  };
  /** any other vehicle standing in Kamenka's street is stood well off it, out of the car's way and the pictures */
  const clearStreet = () => {
    const mine = car();
    for (const j of (g.garage.jeeps as Map<number, Any>).values()) {
      if (j === mine || j.kind === HELI.kind) continue;
      const dx = j.pos.x - T.x, dz = j.pos.z - T.z, along = dx * ux + dz * uz, right = dx * uz - dz * ux;
      if (along < -40 || along > 90 || Math.abs(right) > 5) continue;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-ux, -uz), 0, 'YXZ'));
      const to = K(along, -16);
      j.place([to.x, to.y + RIDE_HEIGHT, to.z, q.x, q.y, q.z, q.w, 0, 0, 0, 0, 0]);
      say(`a ${j.kind === 1 ? 'police car' : 'jeep'} stood in the street at ${along.toFixed(0)} m: put off it`);
    }
  };
  const carQ = new THREE.Quaternion();
  /** the car put where it is told, moving so, as another player's game would show it */
  const drive = (p: THREE.Vector3, yaw: number, v: THREE.Vector3, lights = 1) => {
    const j = car();
    if (!j) return;
    carQ.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    j.place([p.x, p.y + RIDE_HEIGHT, p.z, carQ.x, carQ.y, carQ.z, carQ.w, v.x, 0, v.z, 0, lights]);
  };
  const CAR_V = 15, BRAKE_T = 4.0, BRAKE_A = 5;
  /** where it comes to rest the first evening, nosed into the verge below the house; and out of every picture */
  const STOP = K(74 - (CAR_V * BRAKE_T + 0.5 * CAR_V * (CAR_V / BRAKE_A)), 3.8), STOP_YAW = yawTo(K(0, 2.6), K(-9, 3.8));
  const carAway = () => drive(S.at(-700, -700), 0, V(0, 0, 0), 0);
  const carStopped = () => drive(STOP, STOP_YAW, V(0, 0, 0), 0);
  /** the helicopters: the one on the hospital's roof, and the pad's, put out of the way */
  const heliAt = (spot: { x: number; z: number }) => {
    let best: Any = null, d = 1e9;
    for (const j of (g.garage.jeeps as Map<number, Any>).values()) {
      if (j.kind !== HELI.kind) continue;
      const e = Math.hypot(j.pos.x - spot.x, j.pos.z - spot.z);
      if (e < d) [best, d] = [j, e];
    }
    return best;
  };
  const md500 = () => heliAt(ROOF);
  const snapped = new Set<Any>();
  const fly = (j: Any, p: THREE.Vector3, yaw: number, pitch = 0, roll = 0, v = new THREE.Vector3(), rpm = 1) => {
    if (!j) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    const st = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, rpm, rpm > 0 ? 0.7 : 0];
    if (j.mode !== 'follow' || !snapped.has(j)) {
      snapped.add(j);
      j.place(st);
      j.mode = 'follow';
    }
    j.push(st, performance.now(), performance.now());
  };
  const padHeliAway = () => {
    const h = heliAt(PAD);
    if (h && h !== md500()) fly(h, S.at(-650, 650, 0), 0, 0, 0, new THREE.Vector3(), 0);
  };

  const reset = () => {
    for (const a of S.actors) {
      a.dance = a.surrender = a.crouch = a.aim = a.sprint = a.bleeding = false;
      a.more = 0;
      a.foe = null;
      (a.rp as Any).seat = null;
      a.rp.avatar.clearWounds();
      a.hide();
    }
    g.glass = null;
    clearStreet();
    {
      const v = g.player?.vitals;
      if (v && 'blood' in v) v.blood = BLOOD.full;
    }
    shutDoors();
    if (g.map?.open) g.toggleMap(false);
    lamp.intensity = 0;
    fill.intensity = 0;
    handLamp.intensity = 0;
    vaultLamp.intensity = 0;
    rig.t = -1e9;
    S.parkMe();
    S.clean();
    hush();
    clearFeed();
  };

  // ------------------------------------------------------------ a walk: one line with a speed along it, read between its samples
  interface Walk { len: number; dur: number; at: (t: number) => { p: THREE.Vector3; yaw: number; v: number } }
  /**
   * Somebody's way from one place to the next at a speed, started at `t0` seconds of the shot: easing in over
   * `inS` seconds and out over `outS` before the end, never turning on the spot (the heading is the line's own).
   * Heights come from `floor`, the ground unless said.
   */
  const walk = (pts: THREE.Vector3[], speed: number, t0 = 0, inS = 0.7, outS = 0.9, floor: (x: number, z: number) => number = (x, z) => S.ground(x, z)): Walk => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    c.arcLengthDivisions = 600;
    const len = c.getLength();
    // (sampled at 60 Hz: where along the line each sixtieth finds them)
    const s: number[] = [0];
    const slow = Math.min(len / 2, speed * outS * 0.5);
    for (let k = 0; s[s.length - 1] < len && k < 60 * 120; k++) {
      const d = s[s.length - 1];
      const vIn = Math.min(1, (k / 60) / inS + 0.08), vOut = Math.min(1, (len - d) / Math.max(0.01, slow) + 0.05);
      s.push(Math.min(len, d + (speed * Math.min(vIn, vOut)) / 60));
    }
    const dur = (s.length - 1) / 60;
    const yaw0 = (() => { const tg = c.getTangentAt(0); return Math.atan2(-tg.x, -tg.z); })();
    return {
      len, dur,
      at: (t) => {
        const f = Math.max(0, (t - t0) * 60), i = Math.min(s.length - 2, Math.floor(f)), k = Math.min(1, f - i);
        const d = s[i] + (s[i + 1] - s[i]) * k, u = clamp01(d / len);
        const p = c.getPointAt(u), tg = c.getTangentAt(Math.min(0.999, Math.max(0.001, u)));
        p.y = floor(p.x, p.z);
        const v = t < t0 ? 0 : (s[i + 1] - s[i]) * 60;
        return { p, yaw: t < t0 ? yaw0 : Math.atan2(-tg.x, -tg.z), v };
      },
    };
  };
  /** a body put where its walk has it */
  const put = (a: Actor, w: Walk, t: number, turn = true) => {
    const q = w.at(t);
    a.pos.copy(q.p);
    if (turn) a.yaw = q.yaw;
    a.sprint = q.v > 4.6;
    return q;
  };
  /** a yaw eased toward another, by a gain a second */
  const turn = (a: Actor, to: number, k: number, dt: number) => {
    let d = to - a.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    a.yaw += d * gain(k, dt);
  };

  // ------------------------------------------------------------ the player's own eyes
  /** the local player stood here, looking there, carrying these */
  const eyes = (p: THREE.Vector3, yaw: number, pitch: number, kit: (string | [string, number])[], slot: string | null, mods: Record<string, string[]> = {}) => {
    S.me(p.x, p.z, yaw, pitch, p.y);
    S.kit(kit, mods);
    S.hold(slot);
  };
  /** the view eased toward a world point, by a gain a second */
  const aim = (to: THREE.Vector3, k: number, dt: number) => {
    const c = g.s.r.camera.position as THREE.Vector3, pl = g.player;
    const wy = Math.atan2(-(to.x - c.x), -(to.z - c.z)), wp = Math.atan2(to.y - c.y, Math.hypot(to.x - c.x, to.z - c.z));
    let d = wy - pl.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    pl.yaw += d * gain(k, dt);
    pl.pitch += (wp - pl.pitch) * gain(k, dt);
  };
  /** the first-person view breathing a little, as a rifle held does */
  const breathe = (t: number, amp = 1) => {
    const pl = g.player;
    pl.yaw += Math.sin(t * 1.7) * 0.00035 * amp;
    pl.pitch += Math.sin(t * 2.3 + 1) * 0.0003 * amp;
  };
  /** the kill line the game writes, with the real distance */
  const killLine = (by: number, who: number, weapon: string, from: THREE.Vector3, to: THREE.Vector3) => `${NAME(by)} killed ${NAME(who)} · ${weapon} · ${Math.round(from.distanceTo(to))} m`;

  // ------------------------------------------------------------ the bag on the road
  let bag: Any = null;
  const BAG = K(9, -3.6);
  nestFor(BAG.clone().setY(BAG.y + 0.8));
  const layBag = async () => {
    if (bag) return;
    try {
      const st = g.newStash({ uid: 'film17-bag', x: BAG.x, y: BAG.y, z: BAG.z, rot: 0.8, item: 'sack_pack', buried: false });
      const c = st.container;
      if (c) for (const id of ['bandage', 'ammo_556', 'can_beans']) if (ITEMS[id]) c.add(makeItem(id));
      await g.loot.addStash(st);
      bag = st;
    } catch (e) {
      say(`the bag could not be laid: ${(e as Error).message}`);
    }
  };

  // ------------------------------------------------------------ the set got ready
  let warmed = false;
  const warm = async () => {
    if (warmed) return;
    warmed = true;
    try { localStorage.setItem('zona-howto-seen', '1'); } catch { /* */ }
    (document.querySelector('.howto-ok') as HTMLElement | null)?.click();
    for (const id of THINGS) void Promise.resolve(g.loot.models.get(id)).catch(() => {});
    (g.castle as Any)?.finish?.();
    const t0 = clock.real.now();
    for (const [p, l] of [[K(-40, -4, 6), K(10, 8, 4)], [V(ROOF.x + 20, ROOF.y + 6, ROOF.z + 20), V(ROOF.x, ROOF.y, ROOF.z)], [F(30, 0, 8), F(0, 0, 2)]] as [THREE.Vector3, THREE.Vector3][]) {
      S.cam = { p, l, fov: 50 };
      await run(60 * 3);
      await wait(200);
    }
    S.cam = null;
    await layBag();
    say(`the set is ready; ${((clock.real.now() - t0) / 1000).toFixed(1)} s`);
  };

  // ------------------------------------------------------------ the shots
  const shots: Shot[] = [];
  const DUSK = 0.745, DAY = 0.31, DAWN = 0.27, NIGHT = 0.76;
  let cur = 0, hourWas = -1;
  /** a shot of so many seconds (a whole number of the score's two-second bars) */
  const add = (len: number, s: Omit<Shot, 'start' | 'end'> & Extra) => {
    const setup = s.setup, after = s.after, start = cur;
    cur += len;
    const bars = Math.max(1, Math.round(len / 2));
    for (let b = 0; b < bars; b++) ROWS.push({ kind: s.m ?? 'tour', hit: b === 0 ? s.hit : undefined, lift: b === bars - 1 && s.lift ? 1 : undefined, build: bars > 1 ? b / (bars - 1) : undefined, under: s.under });
    shots.push({
      bars: true,
      ...s,
      start,
      end: start + len,
      setup: async (st) => {
        for (const el of gfx) el.style.display = 'none';
        snapped.clear();
        try {
          g.hourHeld = hourWas < 0 ? (s.hour ?? DAY) : hourWas;
          await warm();
          reset();
          const hour = s.hour ?? DAY;
          g.hourHeld = hour;
          await setup?.(st);
          if (s.cam) S.cam = s.cam(0, st);
          if (hour !== hourWas) await run(s.settle ?? 150);
          hourWas = hour;
          await s.stage?.();
          await dressed();
        } catch (e) {
          say(`${s.name}: its setting up failed: ${(e as Error).message}`);
        }
      },
      after: (t, st) => {
        after?.(t, st);
        look(t, len, s);
        hush();
        const c = (s.plates ?? []).find(([from, until]) => t >= from && t < until);
        if (c) {
          plate.querySelector('span')!.textContent = c[2];
          show(plate, t - c[0], Math.min(ease((t - c[0]) / 0.3), ease((c[1] - t) / 0.3)));
        } else plate.style.display = 'none';
        const l = s.line;
        if (l && t >= l[0] && t < l[1]) {
          line.querySelector('span')!.textContent = l[2];
          show(line, t - l[0], Math.min(ease((t - l[0]) / 0.5), ease((l[1] - t) / 0.4)));
        } else line.style.display = 'none';
      },
    });
  };

  // ------------------------------------------------------------ scouting the places
  if (SCOUT) {
    // (the house measured by rays: where its walls are open, and where its stair is)
    const dirOf = (lx: number, lz: number) => H(lx, lz, 0).sub(H(0, 0, 0)).normalize();
    const openAlong = (name: string, from: (u: number) => THREE.Vector3, dir: THREE.Vector3, u0: number, u1: number) => {
      const open: string[] = [];
      for (let u = u0; u <= u1; u += 0.25) {
        const o = from(u);
        if (!physics.raycast({ x: o.x, y: o.y, z: o.z }, { x: dir.x, y: dir.y, z: dir.z }, 3.5, SOLID_GROUPS)) open.push(u.toFixed(2));
      }
      say(name + ' open at: ' + open.join(' '));
    };
    for (const [lvl, y] of [] as [string, number][]) {
      openAlong(lvl + ' west wall (z)', (z) => H(-2.0, z, y), dirOf(-1, 0), -7, 7);
      openAlong(lvl + ' east wall (z)', (z) => H(2.0, z, y), dirOf(1, 0), -7, 7);
      openAlong(lvl + ' south wall (x)', (x) => H(x, -5.0, y), dirOf(0, -1), -5, 5);
      openAlong(lvl + ' north wall (x)', (x) => H(x, 5.0, y), dirOf(0, 1), -5, 5);
    }
    const rows: string[] = ['floors: [ = no upper floor over it; the number is the ground floor height in dm'];
    for (let x = -4.5; x <= 4.5; x += 0.5) {
      let r = '';
      for (let z = -7; z <= 7; z += 0.5) {
        const up = under(H(x, z, UP + 1.0), 0.2, 1.4), lo = under(H(x, z, 1.0), 0.2, 1.4);
        r += (up === null ? '[' : ' ') + (lo === null ? '  .' : String(Math.round((lo - house.floorY) * 10)).padStart(3));
      }
      rows.push('x=' + x.toFixed(1).padStart(4) + ' ' + r);
    }
    for (const r of rows) say(r);
    const look1 = (name: string, p: THREE.Vector3, l: THREE.Vector3, hour = DAY, fov = 60) => add(2, { name, hour, cam: () => ({ p, l, fov }), setup: () => { lamp.intensity = hour > 0.6 ? 6 : 0; carStopped(); } });
    look1('house-street', K(-20, -3, 1.6), SILL, DUSK);
    look1('dusk-76', K(-20, -3, 1.6), SILL, 0.76);
    look1('dusk-80', K(-20, -3, 1.6), SILL, 0.8);
    look1('house-front', FRONT(0, 2, 1.6), H(-3.9, -2.4, 1.2), DAY);
    look1('ground-in', H(-6.5, -2.4, 1.6), H(2, 0, 1.2));
    look1('ground-left', H(-2.5, -2.4, 1.6), H(0, -6, 1.2));
    look1('ground-right', H(-2.5, -2.4, 1.6), H(0, 6, 1.2));
    look1('ground-back', H(-2.5, -2.4, 1.6), H(3.9, -2.4, 1.2));
    look1('ground-mid', H(0, 0, 1.6), H(-3.9, -2.4, 1.2));
    look1('up-room', H(2.5, 0, UP + 1.6), SILL);
    look1('up-door', H(-1, -4.5, UP + 1.6), H(3.9, 0, UP + 1.2));
    look1('up-back', H(3, 4, UP + 1.6), H(-3, -4, UP + 1.2));
    look1('nest', NEST.clone().setY(NEST.y + 1.1), BAG);
    look1('well', WELL.clone().add(V(5, 1.6, 5)), WELL.clone().setY(WELL.y + 0.8));
    look1('hq', at(hq, 3, 26, 1.4), at(hq, 0, 8, 1.4));
    look1('edge', EDGE.clone().addScaledVector(ACROSS, 20).setY(EDGE.y + 2), EDGE.clone().addScaledVector(IN, 10));
    look1('fire', FIRE.p.clone().add(V(4, 1.4, 4)), FIRE.p.clone().setY(FIRE.p.y + 0.5), NIGHT);
    look1('vault', F(0.6, 0.8, UNDER.floor + 1.4), F(-2.0, -0.9, UNDER.floor + 0.8));
    look1('gas', GASAT.clone().addScaledVector(V(-GASAT.x, 0, -GASAT.z).normalize(), GAS.radius + 60).setY(S.ground(GASAT.x, GASAT.z) + 30), GASAT.clone().setY(GASAT.y + 10));
    total = cur;
    return shots;
  }

  // ============================================================ ACT ONE: THE WINDOW (dusk, Kamenka)
  // ------------------------------------------------------------ 1. the street at dusk, one window lit: the title
  add(4, {
    name: 'card',
    m: 'box',
    hour: DUSK,
    settle: 220,
    fadeOut: 0.4,
    setup: () => {
      lamp.intensity = 6;
      carAway();
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, BAG), 'camper');
      A(VOLKOV).aim = true;
    },
    cam: (t) => {
      const k = ease(t / 4);
      return hand({ p: K(-26 + k * 3, -2.4, 1.5 + k * 0.2), l: SILL, fov: 34 }, t, 0.25);
    },
    after: (t) => {
      if (t < 3.7) show(title, t, 1 - ease((t - 3.1) / 0.5));
      else title.style.display = 'none';
    },
  });

  // ------------------------------------------------------------ 2. Mira comes down the street and kneels to a bag on the road
  const miraWalk = walk([K(-30, -2.4), K(-16, -2.8), K(-2, -3.4), K(7.4, -3.6)], 1.55, -1.0);
  const miraAt = (t: number) => {
    const a = A(MIRA);
    if (t < miraWalk.dur - 1.0) {
      put(a, miraWalk, t);
      a.crouch = false;
    } else {
      // (down on one knee at the bag, going through it)
      const q = miraWalk.at(miraWalk.dur);
      a.pos.copy(q.p);
      a.yaw = yawTo(q.p, BAG);
      a.sprint = false;
      a.crouch = true;
    }
  };
  add(6, {
    name: 'mira',
    m: 'box',
    hour: DUSK,
    fadeIn: 0.4,
    setup: () => {
      lamp.intensity = 6;
      carAway();
      cast(MIRA, miraWalk.at(-1).p, miraWalk.at(-1).yaw, 'mira0');
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, BAG), 'camper');
      A(VOLKOV).aim = true;
    },
    lead: (t) => miraAt(t),
    tick: (t) => {
      miraAt(t);
      fillOn(A(MIRA).pos, A(MIRA).pos.clone().addScaledVector(DOWN, -4), 3.2);
    },
    cam: (t) => {
      // (behind her left shoulder, carried along; the lit window ahead of her over the roofs)
      const m = A(MIRA).rp.pos as THREE.Vector3;
      const p = m.clone().addScaledVector(DOWN, -3.6).addScaledVector(RIGHT, -1.4);
      p.y = S.ground(p.x, p.z) + 1.7;
      const l = m.clone().setY(m.y + 1.2).addScaledVector(DOWN, 3);
      return hand({ ...follow(p, l, t, 5), fov: 40 }, t, 0.35);
    },
    plates: [[0.8, 3.6, 'Kamenka · a bag left on the road']],
  });

  // ------------------------------------------------------------ 3. through the camper's scope: the crosshair settles on her back
  let fired1 = false;
  add(6, {
    name: 'scope-1',
    m: 'box',
    under: true,
    hud: true,
    bars: false,
    hour: DUSK,
    setup: async () => {
      lamp.intensity = 6;
      carAway();
      fired1 = false;
      cast(MIRA, miraWalk.at(99).p, 0, 'mira0');
      miraAt(99);
      const to = A(MIRA).chest();
      nestFor(to);
      camperOut();
      eyes(NEST, yawTo(NEST, to) + 0.05, Math.atan2(to.y - (NEST.y + 1.1), Math.hypot(to.x - NEST.x, to.z - NEST.z)) - 0.02, ['mosin', ['ammo_762', 10]], 'primary', { mosin: ['pu_scope'] });
      await run(20);
      S.key('Mouse2', true);
      await run(40);
    },
    tick: (t, _S, dt) => {
      miraAt(99);
      const a = A(MIRA);
      if (a.alive) aim(a.chest().clone().add(V(0, 0.05, 0)), 1.6, dt);
      breathe(t, 1.2);
      if (!fired1 && t > 3.4) {
        fired1 = true;
        S.tap('Mouse0', 40);
      }
      if (fired1 && a.alive && t > 3.48) {
        const dir = a.pos.clone().sub(NEST).setY(0).normalize();
        a.hurt(100, dir);
        if (a.alive) a.die(dir);
        g.hud.feed(killLine(VOLKOV, MIRA, ITEMS.mosin.name, NEST, a.pos), true);
      }
    },
    after: (t) => {
      if (t > 5.4) S.key('Mouse2', false);
    },
  });

  // ------------------------------------------------------------ 4. Dmitri at the well: a helmet found, a dance, the second shot
  const WELL_STAND = WELL.clone().addScaledVector(V(NEST.x - WELL.x, 0, NEST.z - WELL.z).normalize(), -1.4);
  let fired2 = false;
  add(8, {
    name: 'well',
    m: 'box',
    under: true,
    hour: DUSK,
    setup: async () => {
      lamp.intensity = 6;
      carAway();
      fired2 = false;
      cast(MIRA, miraWalk.at(99).p, 0, 'mira0');
      miraAt(99);
      A(MIRA).die(DOWN);
      cast(DMITRI, WELL_STAND, yawTo(WELL_STAND, WELL), 'dmitri0');
      A(DMITRI).crouch = true;
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, WELL_STAND), 'camper');
      A(VOLKOV).aim = true;
    },
    tick: (t, _S, dt) => {
      const d = A(DMITRI);
      fillOn(WELL_STAND, WELL_STAND.clone().addScaledVector(V(WELL_STAND.x - NEST.x, 0, WELL_STAND.z - NEST.z).normalize(), 4), 3);
      if (t > 1.6 && d.crouch) {
        d.crouch = false;
        void g.wear(d.rp.avatar, ['life_vest', 'helmet_m1']);
      }
      if (t > 2.2 && !d.dance && d.alive) dance(d, 'balloon');
      if (t > 1.6 && d.alive) turn(d, yawTo(WELL_STAND, K(-20, -2)), 2.5, dt);
      const v = A(VOLKOV);
      if (v.alive) v.face(d.alive ? d.chest() : d.pos);
      if (!fired2 && t > 6.2) {
        fired2 = true;
        v.fireAt(d.chest(), 0);
      }
      if (fired2 && d.alive && t > 6.26) {
        dance(d, null);
        const dir = d.pos.clone().sub(NEST).setY(0).normalize();
        d.hurt(100, dir);
        if (d.alive) d.die(dir);
      }
    },
    cam: (t) => {
      // (low in the street beyond him, the house's lit window over his shoulder)
      const away = V(WELL_STAND.x - NEST.x, 0, WELL_STAND.z - NEST.z).normalize();
      const p = WELL_STAND.clone().addScaledVector(away, 3.8).addScaledVector(V(-away.z, 0, away.x), 1.6);
      p.y = S.ground(p.x, p.z) + 1.0 + ease(t / 8) * 0.3;
      return hand({ p, l: WELL_STAND.clone().setY(WELL_STAND.y + 1.1), fov: 50 }, t, 0.3);
    },
    plates: [[6.6, 8, killLine(VOLKOV, DMITRI, ITEMS.mosin.name, NEST, WELL_STAND).toUpperCase()]],
  });

  // ------------------------------------------------------------ 5. Kestrel in the police car, the windscreen starred
  /** the car's way: down the street at speed, then braking to a stop nosed into the verge below the house */
  const carAt = (t: number) => {
    // (up the middle of the street toward the house at 15 m/s; from the shot it slows at 5 m/s/s, drifting to the verge below the house)
    const ran = Math.min(t, BRAKE_T), tb = Math.max(0, t - BRAKE_T), tStop = CAR_V / BRAKE_A, tbb = Math.min(tb, tStop);
    const s = 74 - (CAR_V * ran + CAR_V * tbb - 0.5 * BRAKE_A * tbb * tbb);
    const v = t < BRAKE_T ? CAR_V : Math.max(0, CAR_V - BRAKE_A * tb);
    const sStop = 74 - (CAR_V * BRAKE_T + 0.5 * CAR_V * tStop);
    const drift = (ss: number) => 0.8 + ease(clamp01((sStop + 14 - ss) / 14)) * 3.0;
    const p = K(s, drift(s)), ahead = K(s - 2, drift(s - 2));
    return { p, yaw: yawTo(p, ahead), v: DOWN.clone().multiplyScalar(-v), speed: v, s };
  };
  let fired3 = false;
  add(6, {
    name: 'car',
    m: 'box',
    under: true,
    hit: 0.6,
    hour: DUSK,
    setup: () => {
      lamp.intensity = 6;
      fired3 = false;
      const c = carAt(-1);
      cast(KESTREL, c.p, c.yaw, 'kestrel0');
      seat(A(KESTREL), car(), 0);
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, K(30, 1)), 'camper');
      A(VOLKOV).aim = true;
      cast(MIRA, miraWalk.at(99).p, 0, 'mira0');
      miraAt(99);
      A(MIRA).die(DOWN);
    },
    lead: (t) => {
      const c = carAt(t);
      drive(c.p, c.yaw, c.v);
      A(KESTREL).pos.copy(c.p);
    },
    tick: (t) => {
      const c = carAt(t);
      drive(c.p, c.yaw, c.v);
      A(KESTREL).pos.copy(c.p);
      A(KESTREL).yaw = c.yaw;
      const v = A(VOLKOV);
      const glass = c.p.clone().setY(c.p.y + 1.25).addScaledVector(DOWN, -1.3);
      v.face(glass);
      if (!fired3 && t > BRAKE_T) {
        fired3 = true;
        v.fireAt(glass, 0);
      }
    },
    cam: (t) => {
      // (low on the left verge below the house, the car coming at the lens and passing close, panned with)
      const c = carAt(t);
      const p = K(22, -4.4, 0.9);
      const l = c.p.clone().setY(c.p.y + 1.0);
      return hand({ p, l, fov: 40 + ease((t - 3) / 2) * 12 }, t, 0.3);
    },
  });
  add(4, {
    name: 'car-stop',
    m: 'box',
    under: true,
    chain: true,
    hour: DUSK,
    setup: () => {
      lamp.intensity = 6;
      const c = carAt(6);
      cast(KESTREL, c.p, c.yaw, 'kestrel0');
      seat(A(KESTREL), car(), 0);
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, c.p), 'camper');
      A(VOLKOV).aim = true;
      cast(MIRA, miraWalk.at(99).p, 0, 'mira0');
      miraAt(99);
      A(MIRA).die(DOWN);
    },
    lead: (t) => {
      const c = carAt(6 + t);
      drive(c.p, c.yaw, c.v);
      A(KESTREL).pos.copy(c.p);
    },
    tick: (t) => {
      const c = carAt(6 + t);
      drive(c.p, c.yaw, c.v);
      A(KESTREL).pos.copy(c.p);
      A(KESTREL).yaw = c.yaw;
    },
    cam: (t) => {
      // (from the balcony's height, the car rolling to its stop below)
      const c = carAt(6 + t);
      return hand({ ...follow(SILL.clone().addScaledVector(RIGHT, -1.2).setY(SILL.y + 0.3), c.p.clone().setY(c.p.y + 0.8), t, 4), fov: 42 }, t, 0.3);
    },
    plates: [[1.2, 4, killLine(VOLKOV, KESTREL, ITEMS.mosin.name, NEST, carAt(99).p).toUpperCase()]],
  });

  // ------------------------------------------------------------ 6. the window, from the street: the same window, three times
  add(5, {
    name: 'window',
    m: 'box',
    lift: true,
    hour: DUSK,
    fadeOut: 1.0,
    setup: () => {
      lamp.intensity = 6;
      carStopped();
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, K(-50, 0)), 'camper');
      A(VOLKOV).aim = true;
    },
    cam: (t) => {
      const k = ease(t / 5);
      const p = K(-3 + k * 1.5, -3.4 + k * 0.6, 1.5);
      return hand({ p, l: SILL.clone().setY(SILL.y - 0.2), fov: 36 - k * 4 }, t, 0.25);
    },
    line: [1.2, 4.2, 'The same window. Three times.'],
  });

  // ============================================================ ACT TWO: THE EDGE
  // ------------------------------------------------------------ 7. a new life walks in off the edge of the map, with nothing
  const miraIn = walk([EDGE.clone().addScaledVector(IN, -2), EDGE.clone().addScaledVector(IN, 14), EDGE.clone().addScaledVector(IN, 30).addScaledVector(ACROSS, 2)], 1.5, -1.2);
  const dmitriIn = walk([EDGE.clone().addScaledVector(IN, 22).addScaledVector(ACROSS, 9), EDGE.clone().addScaledVector(IN, 30).addScaledVector(ACROSS, 5)], 0.9, -1.2);
  let called: Record<string, boolean> = {};
  const callOnce = (key: string, a: Actor, id: string) => {
    if (called[key]) return;
    called[key] = true;
    a.call(id);
  };
  add(8, {
    name: 'edge',
    m: 'dread',
    hour: DAY,
    settle: 200,
    fadeIn: 1.0,
    setup: () => {
      called = {};
      cast(MIRA, miraIn.at(-1).p, miraIn.at(-1).yaw, 'fresh');
      cast(DMITRI, dmitriIn.at(-1).p, dmitriIn.at(-1).yaw, 'fresh');
    },
    lead: (t) => {
      put(A(MIRA), miraIn, t);
      put(A(DMITRI), dmitriIn, t);
    },
    tick: (t, _S, dt) => {
      const m = A(MIRA), d = A(DMITRI);
      if (t < 3.6) put(m, miraIn, t);
      else {
        // (they have seen each other: both stop where they are and turn, a glance, not a spin)
        const q = miraIn.at(Math.min(t, 3.6));
        m.pos.copy(q.p);
        m.sprint = false;
        turn(m, yawTo(m.pos, d.pos), 3, dt);
      }
      if (t < 3.4) put(d, dmitriIn, t);
      else {
        const q = dmitriIn.at(Math.min(t, 3.4));
        d.pos.copy(q.p);
        d.sprint = false;
        turn(d, yawTo(d.pos, m.pos), 3, dt);
      }
      if (t > 4.0) callOnce('dontshoot', d, 'dontshoot');
      if (t > 5.4) callOnce('friendly', m, 'friendly');
      if (t > 6.7) callOnce('sorry', d, 'sorry');
    },
    cam: (t) => {
      // (a long lens from ahead of them: the two walking in at it, the edge of the ground behind them)
      const m = A(MIRA).rp.pos as THREE.Vector3, d = A(DMITRI).rp.pos as THREE.Vector3;
      const mid = m.clone().add(d).multiplyScalar(0.5);
      const p = EDGE.clone().addScaledVector(IN, 48 - t * 0.4).addScaledVector(ACROSS, -4);
      p.y = S.ground(p.x, p.z) + 1.7;
      return hand({ ...follow(p, mid.clone().setY(mid.y + 1.1), t, 4), fov: 28 }, t, 0.3);
    },
    plates: [[0.8, 3.8, 'A new life · the edge of the map · nothing in hand']],
  });

  // ------------------------------------------------------------ 8. Kestrel limps up; three nods
  const kestrelIn = walk([EDGE.clone().addScaledVector(IN, 6).addScaledVector(ACROSS, -8), EDGE.clone().addScaledVector(IN, 24).addScaledVector(ACROSS, 1)], 1.0, -1.5, 1.2, 1.2);
  const PAIR = { mira: miraIn.at(3.6).p, dmitri: dmitriIn.at(3.4).p };
  add(7, {
    name: 'kestrel',
    m: 'dread',
    hour: DAY,
    setup: () => {
      called = {};
      cast(MIRA, PAIR.mira, yawTo(PAIR.mira, PAIR.dmitri), 'fresh');
      cast(DMITRI, PAIR.dmitri, yawTo(PAIR.dmitri, PAIR.mira), 'fresh');
      cast(KESTREL, kestrelIn.at(-1).p, kestrelIn.at(-1).yaw, 'fresh');
      A(KESTREL).more = F_LIMP;
    },
    lead: (t) => put(A(KESTREL), kestrelIn, t),
    tick: (t, _S, dt) => {
      const k = A(KESTREL), m = A(MIRA), d = A(DMITRI);
      const q = put(k, kestrelIn, t);
      k.sprint = false;
      if (t > 1.2) {
        turn(m, yawTo(m.pos, k.pos), 2.5, dt);
        turn(d, yawTo(d.pos, k.pos), 2.5, dt);
      }
      if (q.v < 0.05 && t > 2) turn(k, yawTo(k.pos, m.pos.clone().add(d.pos).multiplyScalar(0.5)), 2.5, dt);
      if (t > 2.4) callOnce('help', k, 'help');
      if (t > 4.3) callOnce('yes1', m, 'yes');
      if (t > 5.1) callOnce('yes2', d, 'yes');
      if (t > 5.9) callOnce('yes3', k, 'yes');
    },
    cam: (t) => {
      // (from beyond the pair, Kestrel coming in between them)
      const k = A(KESTREL).rp.pos as THREE.Vector3;
      const mid = PAIR.mira.clone().add(PAIR.dmitri).multiplyScalar(0.5);
      const p = mid.clone().addScaledVector(IN, 5.5).addScaledVector(ACROSS, -1.5);
      p.y = S.ground(p.x, p.z) + 1.4;
      const l = mid.clone().lerp(k, 0.5).setY(mid.y + 1.1);
      return hand({ ...follow(p, l, t, 4), fov: 40 }, t, 0.3);
    },
    plates: [[0.6, 3.4, 'Broken leg · a limp until it is set']],
  });

  // ------------------------------------------------------------ 9. the map: where he is
  add(2, {
    name: 'map',
    m: 'dread',
    hud: true,
    bars: false,
    hour: DAY,
    setup: async () => {
      eyes(PAIR.mira, yawTo(PAIR.mira, PAIR.dmitri), 0, [], null);
      cast(DMITRI, PAIR.dmitri, yawTo(PAIR.dmitri, PAIR.mira), 'fresh');
      await run(10);
      g.toggleMap(true);
      await run(10);
    },
  });

  // ------------------------------------------------------------ 10. gearing up: Mira out of the police HQ with the AR
  const hqWalk = walk([at(hq, -1, 9.5), at(hq, -0.5, 16), at(hq, -1.6, 27)], 1.7, -1.2);
  add(4, {
    name: 'hq',
    fadeIn: 0.3,
    fadeOut: 0.3,
    m: 'march',
    hit: 0.9,
    hour: DAY,
    setup: () => { cast(MIRA, hqWalk.at(-1).p, hqWalk.at(-1).yaw, 'mira'); },
    lead: (t) => put(A(MIRA), hqWalk, t),
    tick: (t) => put(A(MIRA), hqWalk, t),
    cam: (t) => {
      const m = A(MIRA).rp.pos as THREE.Vector3;
      const p = at(hq, 1.2, 27.5, 1.3);
      return hand({ ...follow(p, m.clone().setY(m.y + 1.2), t, 5), fov: 36 }, t, 0.3);
    },
    plates: [[0.5, 3.6, 'Police HQ · where the AR-15 is found']],
  });

  // ------------------------------------------------------------ 11. Dmitri into the gas in a mask
  const GASIN = V(-GASAT.x, 0, -GASAT.z).normalize().negate();
  const gasWalk = walk([GASAT.clone().addScaledVector(GASIN, -(GAS.radius + 42)), GASAT.clone().addScaledVector(GASIN, -(GAS.radius + 10))], 1.6, -1.2);
  add(4, {
    name: 'gas',
    fadeIn: 0.3,
    fadeOut: 0.3,
    m: 'march',
    hour: DAY,
    setup: () => { cast(DMITRI, gasWalk.at(-1).p, gasWalk.at(-1).yaw, 'dmitri'); },
    lead: (t) => put(A(DMITRI), gasWalk, t),
    tick: (t) => put(A(DMITRI), gasWalk, t),
    cam: (t) => {
      const d = A(DMITRI).rp.pos as THREE.Vector3;
      const side = V(-GASIN.z, 0, GASIN.x);
      const p = d.clone().addScaledVector(GASIN, -3.4).addScaledVector(side, 1.6);
      p.y = S.ground(p.x, p.z) + 1.3;
      return hand({ ...follow(p, d.clone().setY(d.y + 1.3).addScaledVector(GASIN, 6), t, 5), fov: 44 }, t, 0.35);
    },
    plates: [[0.5, 3.6, 'The Chemical Works · no mask, no way in']],
  });

  // ------------------------------------------------------------ 12. Kestrel takes the MD-500 off the hospital roof
  const roofP = V(ROOF.x, ROOF.y, ROOF.z), padP = V(PAD.x, PAD.y, PAD.z);
  const toPad = padP.clone().sub(roofP).setY(0).normalize();
  const heliYaw = Math.atan2(-toPad.x, -toPad.z);
  /** up off the roof, then away toward the fort */
  const liftAt = (t: number) => {
    const k = clamp01(t / 5);
    const up = ease(k) * 16, fwd = Math.max(0, t - 1.5) ** 2 * 1.1;
    return roofP.clone().addScaledVector(toPad, fwd).setY(roofP.y + up);
  };
  add(4, {
    name: 'lift',
    fadeIn: 0.3,
    m: 'march',
    hour: DAY,
    setup: () => {
      cast(KESTREL, roofP, heliYaw, 'kestrel');
      seat(A(KESTREL), md500(), 0);
    },
    stage: async () => {
      await run(30, (k) => void fly(md500(), liftAt(-0.5 + k / 60), heliYaw, 0, 0, new THREE.Vector3(), 1));
    },
    lead: (t) => fly(md500(), liftAt(t), heliYaw, -0.04 * clamp01(t / 2), 0, new THREE.Vector3(), 1),
    tick: (t) => {
      const p = liftAt(t), q = liftAt(t + 0.1);
      fly(md500(), p, heliYaw, -0.06 * clamp01((t - 1) / 2), 0, q.sub(p).multiplyScalar(10), 1);
      A(KESTREL).pos.copy(p);
    },
    cam: (t) => {
      const p = liftAt(t);
      const side = V(-toPad.z, 0, toPad.x);
      const c = roofP.clone().addScaledVector(side, 11).addScaledVector(toPad, -4).setY(roofP.y + 1.6);
      return hand({ ...follow(c, p.clone().setY(p.y + 1.0), t, 5), fov: 46 }, t, 0.35);
    },
    plates: [[0.5, 3.6, 'The hospital roof · an MD-500']],
  });

  // ------------------------------------------------------------ 13. over the fort, down onto its pad
  const landAt = (t: number) => {
    // (coming down the last 40 m to the pad over 6 s, flaring)
    const k = ease(clamp01(t / 5.5));
    const from = padP.clone().addScaledVector(toPad, -60).setY(padP.y + 17);
    return from.lerp(padP.clone().setY(padP.y + 0.05), k);
  };
  add(5, {
    name: 'fort',
    m: 'march',
    hour: DAY,
    setup: () => {
      padHeliAway();
      cast(KESTREL, landAt(0), heliYaw, 'kestrel');
      seat(A(KESTREL), md500(), 0);
    },
    stage: async () => {
      await run(30, (k) => void fly(md500(), landAt(-0.5 + k / 60), heliYaw, 0.1, 0, new THREE.Vector3(), 1));
    },
    lead: (t) => fly(md500(), landAt(t), heliYaw, 0.1, 0, new THREE.Vector3(), 1),
    tick: (t) => {
      const p = landAt(t), q = landAt(t + 0.1);
      fly(md500(), p, heliYaw, 0.1 * (1 - ease(t / 4.5)), 0, q.sub(p).multiplyScalar(10), 1);
      A(KESTREL).pos.copy(p);
    },
    cam: (t) => {
      // (from beyond the pad, the fort's hill behind it: it comes down into the picture with the fort over it)
      const away = padP.clone().sub(F(0, 0, 0)).setY(0).normalize();
      const c = padP.clone().addScaledVector(away, 38).setY(padP.y + 7 + t * 0.2);
      const h = landAt(t);
      return hand({ ...follow(c, h.clone().lerp(padP, 0.35).setY(h.y * 0.6 + padP.y * 0.4 + 1), t, 5), fov: 46 }, t, 0.3);
    },
    plates: [[0.6, 3.8, 'Orlinoye · the fort on the rim']],
  });

  // ------------------------------------------------------------ 14. the armoury in the vaults: a frag from the cases
  const ARM = F(-1.6, -0.6, UNDER.floor);
  add(4, {
    name: 'vault',
    fadeIn: 0.3,
    fadeOut: 0.3,
    m: 'march',
    lift: true,
    hour: DAY,
    setup: () => {
      padHeliAway();
      vaultLamp.position.copy(F(1.2, 1.6, UNDER.floor + 2.2));
      vaultLamp.intensity = 5;
      cast(KESTREL, ARM, yawTo(ARM, F(-2.3, -0.2, UNDER.floor)), 'kestrel');
      A(KESTREL).crouch = true;
    },
    tick: (t, _S, dt) => {
      const k = A(KESTREL);
      if (t > 1.8) k.crouch = false;
      if (t > 2.0) turn(k, yawTo(ARM, F(2, 3, UNDER.floor)), 2.2, dt);
    },
    cam: (t) => {
      const k = ease(t / 4);
      const p = F(1.6 - k * 0.6, 2.4 - k * 0.5, UNDER.floor + 1.3);
      return hand({ p, l: ARM.clone().setY(ARM.y + 1.0), fov: 42 }, t, 0.3);
    },
    plates: [[0.5, 3.6, 'The vaults · frag grenades, army places only']],
  });

  // ------------------------------------------------------------ 15. night, a fire in the wood: the three sat round it
  const fireSeat = (k: number) => {
    const a = k * 2.1 + 0.4;
    return FIRE.p.clone().add(V(Math.sin(a) * 1.35, 0, Math.cos(a) * 1.35)).setY(S.ground(FIRE.p.x + Math.sin(a) * 1.35, FIRE.p.z + Math.cos(a) * 1.35));
  };
  const lightFire = () => {
    if (FIRE.i >= 0) g.fires.set(FIRE.i, 900);
  };
  const sitAll = () => {
    const looks: Look[] = ['mira', 'dmitri', 'kestrel'];
    [MIRA, DMITRI, KESTREL].forEach((i, k) => {
      const p = fireSeat(k);
      cast(i, p, yawTo(p, FIRE.p), looks[k]);
      A(i).more = F_SIT | (i === KESTREL ? F_LIMP : 0);
    });
  };
  add(6, {
    name: 'camp',
    fadeIn: 0.4,
    m: 'camp',
    hit: 0.5,
    hour: NIGHT,
    settle: 240,
    setup: () => {
      lightFire();
      sitAll();
    },
    cam: (t) => {
      // (a slow arc round the fire at the height of their eyes)
      const a = 1.9 + t * 0.09;
      const p = FIRE.p.clone().add(V(Math.sin(a) * 4.2, 1.15, Math.cos(a) * 4.2));
      return hand({ p, l: FIRE.p.clone().setY(FIRE.p.y + 0.7), fov: 42 }, t, 0.25);
    },
    plates: [[0.8, 4.6, 'A fire by the cabins · a hot meal, a splint']],
  });

  // ------------------------------------------------------------ 16. a blood bag run in by the fire, through Dmitri's eyes
  add(5, {
    name: 'blood',
    m: 'camp',
    under: true,
    hud: true,
    bars: false,
    hour: NIGHT,
    setup: async () => {
      lightFire();
      sitAll();
      A(DMITRI).hide();
      const p = fireSeat(1);
      eyes(p, yawTo(p, FIRE.p) + 0.35, -0.2, [], null);
      g.player.crouched = true;
      handLamp.intensity = 1.2;
      const v = g.player.vitals;
      if (v) {
        v.health = 52;
        if ('blood' in v) v.blood = 4100;
        v.bleeding = false;
      }
      const bagItem = makeItem('blood_bag');
      if (g.inv.add(bagItem)) say('blood: no room for the bag');
      g.takeUp(bagItem);
      await run(45);
      S.key('Mouse0', true);
      await run(8);
      if (!g.use) say('blood: the bag was never begun on');
    },
    after: (t) => {
      if (t > 4.9) S.key('Mouse0', false);
    },
    plates: [[0.4, 4.4, `Blood bag · ${(ITEMS as Any).blood_bag?.use?.blood ?? 1500} ml back in ${(ITEMS as Any).blood_bag?.use?.over ?? 20} s`]],
  });

  // ------------------------------------------------------------ 17. the plan
  const planBoard = Gx('x17-plan', `
    <div class="p17-kick">THE PLAN · AT FIRST LIGHT</div>
    <div class="p17-row"><b>Mira</b><span>The street · the bait</span><b>Kestrel</b><span>Across the street · a frag under the balcony</span><b>Dmitri</b><span>The front door · the stair</span></div>`);
  add(4, {
    name: 'plan',
    m: 'camp',
    lift: true,
    hour: NIGHT,
    fadeOut: 0.8,
    setup: () => {
      lightFire();
      sitAll();
    },
    cam: (t) => {
      const a = 2.45 + t * 0.05;
      const p = FIRE.p.clone().add(V(Math.sin(a) * 5.0, 1.6, Math.cos(a) * 5.0));
      return hand({ p, l: FIRE.p.clone().setY(FIRE.p.y + 0.8), fov: 40 }, t, 0.25);
    },
    after: (t) => show(planBoard, t, Math.min(ease((t - 0.3) / 0.5), 1 - ease((t - 3.4) / 0.5))),
  });

  // ============================================================ ACT THREE: THE WINDOW AGAIN (dawn)
  // ------------------------------------------------------------ 18. Mira the bait: a burst at the window, a leg taken, prone behind the car
  const BAIT = K(-18, -5.4);
  const crawl = walk([BAIT, K(-14, -2.2), K(-10, 1.2)], 0.8, 4.2, 0.6, 0.8);
  let legShot = false, bursts = 0;
  add(7, {
    name: 'bait',
    m: 'tight',
    hit: 1,
    hour: DAWN,
    settle: 220,
    fadeIn: 0.8,
    setup: () => {
      legShot = false;
      bursts = 0;
      carStopped();
      cast(MIRA, BAIT, yawTo(BAIT, SILL), 'mira');
      A(MIRA).aim = true;
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, BAIT), 'camper');
      A(VOLKOV).aim = true;
    },
    tick: (t, _S, dt) => {
      const m = A(MIRA), v = A(VOLKOV);
      if (t > 0.6 && t < 1.9 && bursts < 9 && t > 0.6 + bursts * 0.14) {
        bursts++;
        m.fireAt(SILL.clone().add(V(0, 0.3, 0)), 0.03);
      }
      if (!legShot && t > 2.8) {
        legShot = true;
        v.fireAt(m.pos.clone().setY(m.pos.y + 0.45), 0);
        m.hurt(28, m.pos.clone().sub(NEST).setY(0).normalize());
        m.more = F_LIMP;
        m.aim = false;
      }
      if (legShot && t > 3.6) {
        // (down flat, and away behind the car)
        m.more = F_PRONE | F_LIMP;
        put(m, crawl, t);
        m.sprint = false;
      } else if (legShot) {
        m.aim = false;
        turn(m, yawTo(m.pos, K(-10, 1.2)), 3, dt);
      }
    },
    cam: (t) => {
      // (behind her right shoulder; the balcony up the street ahead)
      const m = A(MIRA).rp.pos as THREE.Vector3;
      const low = t > 3.6;
      const p = m.clone().addScaledVector(DOWN, -2.6).addScaledVector(RIGHT, 1.3);
      p.y = S.ground(p.x, p.z) + (low ? 0.9 : 1.7);
      const l = low ? m.clone().setY(m.y + 0.5).addScaledVector(DOWN, 2) : SILL.clone().lerp(m.clone().setY(m.y + 1.3), 0.35);
      return hand({ ...follow(p, l, t, 3.5), fov: 48 }, t, 0.45);
    },
    plates: [[3.2, 6.4, 'A leg shot · broken · down flat and crawling']],
  });

  // ------------------------------------------------------------ 19. Kestrel cooks the frag below the balcony, through her own eyes
  const THROW = K(9, -4.2);
  let pulled = false, thrown = false, boom = false, lastNade: THREE.Vector3 | null = null;
  /** the frag seen to go off (its fuse caught at nought, or it simply gone): the camper within its reach is hurt and dazed */
  const boomCheck = () => {
    const nade = S.myNade();
    if (nade) lastNade = nade.pos.clone();
    if (!thrown || boom || !((nade && nade.fuse <= 0.06) || (!nade && lastNade))) return;
    boom = true;
    const v = A(VOLKOV), where = nade ? nade.pos : lastNade!;
    if (v.alive && where.distanceTo(v.chest()) < 10) {
      v.hurt(55, v.pos.clone().sub(where).setY(0).normalize());
      v.aim = false;
      v.crouch = true;
    }
    say(`the frag went off ${where.distanceTo(BALC).toFixed(1)} m from the window, ${(where.y - NEST.y).toFixed(1)} m over the balcony's floor`);
  };
  add(6, {
    name: 'cook',
    m: 'tight',
    under: true,
    hud: true,
    bars: false,
    hour: DAWN,
    setup: async () => {
      pulled = thrown = boom = false;
      lastNade = null;
      carStopped();
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, BAIT), 'camper');
      A(VOLKOV).aim = true;
      cast(MIRA, crawl.at(99).p, 0, 'mira');
      A(MIRA).more = F_PRONE | F_LIMP;
      eyes(THROW, yawTo(THROW, SILL), 0.1, ['frag'], null);
      g.takeUp([...g.inv.carried()].find((i: Any) => i.id === 'frag'));
      await run(40);
    },
    tick: (t, _S, dt) => {
      // (the view brought up to the window as the fuse runs; let go a little high, so it carries in)
      // (a lob at the balcony: the rail turns it down, and it goes off at the foot of the wall under him, well within its reach; the balcony itself, a metre deep ten metres off, is no target for a thing that bounces)
      aim(SILL.clone().add(V(0, 2.6, 0)), 2.2, dt);
      breathe(t, 0.6);
      if (t > 2.0 && !pulled) {
        pulled = true;
        S.key('Mouse0', true);
      }
      if (t > 4.5 && !thrown) {
        thrown = true;
        S.key('Mouse0', false);
      }
      boomCheck();
    },
  });

  // ------------------------------------------------------------ 20. the blast from the street
  add(4, {
    name: 'blast',
    m: 'tight',
    under: true,
    chain: true,
    hour: DAWN,
    setup: () => {
      carStopped();
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, BAIT), 'camper');
      A(VOLKOV).aim = true;
      cast(KESTREL, THROW, yawTo(THROW, SILL), 'kestrel');
      A(KESTREL).crouch = true;
    },
    tick: () => boomCheck(),
    cam: (t) => {
      const p = K(-14, -4.5, 1.4);
      return hand({ p, l: SILL.clone().setY(SILL.y + 0.4), fov: 30 - ease(t / 3) * 3 }, t, 0.5);
    },
  });

  // ------------------------------------------------------------ 21. Dmitri in at the front door and up the stair, through his eyes
  /** the way in and up, by the house's own measure, found by rays (the scout): in at the front door in the -x wall, across the room, up the first flight along +z at x 2, round the landing, back along -z at x 3.25, out into the room */
  const STAIR: [number, number, number][] = [[-7.5, -2.4, 0], [-3.0, -2.4, 0], [0.5, -1.2, 0], [2.0, 0.2, 0], [2.0, 3.5, 0], [3.0, 3.9, 0], [3.25, 2.4, 0], [3.25, 0.8, 0], [1.5, -0.8, 0], [-0.4, -2.4, 0]];
  let stairK = 0;
  add(7, {
    name: 'stairs',
    m: 'tight',
    hud: true,
    bars: false,
    hour: DAWN,
    setup: async () => {
      stairK = 0;
      carStopped();
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, BAIT), 'camper');
      A(VOLKOV).crouch = true;
      A(VOLKOV).hurt(55, V(1, 0, 0));
      openDoors(H(-3.9, -2.4, 1), 3);
      camperOut();
      const p0 = H(STAIR[0][0], STAIR[0][1], 0), p1 = H(STAIR[1][0], STAIR[1][1], 0);
      p0.y = S.ground(p0.x, p0.z);
      eyes(p0, yawTo(p0, p1), 0, ['hatchet'], 'melee');
      handLamp.intensity = 2.5;
      await run(20);
      S.key('KeyW', true);
    },
    tick: (t, _S, dt) => {
      const pl = g.player, p = pl.pos as THREE.Vector3;
      while (stairK < STAIR.length - 1) {
        const w = H(STAIR[stairK + 1][0], STAIR[stairK + 1][1], 0);
        if (Math.hypot(w.x - p.x, w.z - p.z) < 0.9) stairK++;
        else break;
      }
      const w = H(STAIR[Math.min(stairK + 1, STAIR.length - 1)][0], STAIR[Math.min(stairK + 1, STAIR.length - 1)][1], 0);
      const want = Math.atan2(-(w.x - p.x), -(w.z - p.z));
      let d = want - pl.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      pl.yaw += d * gain(4, dt);
      pl.pitch += ((stairK >= 3 && stairK < 7 ? 0.22 : 0.02) - pl.pitch) * gain(3, dt);
      S.key('KeyW', stairK < STAIR.length - 1);
      void t;
    },
    after: () => {
      if (stairK >= STAIR.length - 1) S.key('KeyW', false);
    },
  });

  // ------------------------------------------------------------ 22. at the top: one swing
  const TOP = H(-1.2, -3.0, UP), DOORWAY = H(-3.5, -4.5, UP);
  let swung = false, swungAt = 0, pastDoor = false;
  add(4, {
    name: 'swing',
    m: 'tight',
    hit: 1,
    under: true,
    hud: true,
    bars: false,
    hour: DAWN,
    setup: async () => {
      swung = pastDoor = false;
      carStopped();
      camperOut();
      cast(VOLKOV, NEST, yawTo(NEST, BAIT), 'camper');
      A(VOLKOV).crouch = true;
      A(VOLKOV).hurt(55, V(1, 0, 0));
      eyes(TOP, yawTo(TOP, DOORWAY), -0.05, ['hatchet'], 'melee');
      handLamp.intensity = 2.5;
      await run(30);
      S.key('KeyW', true);
    },
    tick: (t, _S, dt) => {
      const v = A(VOLKOV), p = g.player.pos as THREE.Vector3;
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      // (through the doorway first, then at him)
      if (!pastDoor && Math.hypot(DOORWAY.x - p.x, DOORWAY.z - p.z) < 0.7) pastDoor = true;
      if (!pastDoor) aim(DOORWAY.clone().setY(p.y + 1.5), 5, dt);
      else if (v.alive) aim(v.chest(), 5, dt);
      else aim(v.pos.clone().setY(v.pos.y + 0.35), 3, dt);
      S.key('KeyW', d > 1.1 && !swung);
      if (v.alive) turn(v, yawTo(v.pos, p), t > 0.4 ? 4 : 0, dt);
      // (within arm's length, the game's own swing lands on him: the kill below is only in case it did not)
      if (!swung && (d <= 1.15 || (t > 3.4 && d < 1.6))) {
        swung = true;
        swungAt = t;
        S.key('KeyW', false);
        S.tap('Mouse0', 60);
        say(`the swing at ${d.toFixed(2)} m`);
      }
      if (swung && v.alive && t > swungAt + 0.6) {
        const dir = v.pos.clone().sub(p).setY(0).normalize();
        v.hurt(200, dir, true);
        if (v.alive) v.die(dir);
        g.hud.feed(`${NAME(DMITRI)} killed ${NAME(VOLKOV)} · ${ITEMS.hatchet.name}`, true);
      }
    },
  });

  // ------------------------------------------------------------ 23. the tag
  add(5, {
    name: 'tag',
    fadeIn: 0.3,
    fadeOut: 0.3,
    m: 'tour',
    hour: DAWN,
    setup: () => {
      carStopped();
      cast(VOLKOV, NEST, yawTo(NEST, TOP), 'camper');
      A(VOLKOV).die(V(NEST.x - TOP.x, 0, NEST.z - TOP.z).normalize());
      camperOut();
      const p = H(-4.2, -2.1, NEST.y - house.floorY);
      cast(DMITRI, p, yawTo(p, NEST), 'dmitri');
      A(DMITRI).crouch = true;
    },
    cam: (t) => {
      // (low along the balcony's planks: the body, Dmitri down at it, the rail on one side and the lit room on the other)
      const k = ease(t / 5);
      const p = H(-4.25, 0.6 - k * 0.5, NEST.y - house.floorY + 0.75 + k * 0.1);
      return hand({ p, l: NEST.clone().setY(NEST.y + 0.55), fov: 44 }, t, 0.3);
    },
    plates: [[0.8, 4.4, `${NAME(VOLKOV)}'s dog tag · taken · held, it pays`]],
  });

  // ------------------------------------------------------------ 24. the street below the balcony: a dance, and Mira's thanks
  const DANCE = { d: FRONT(-2, 1.5), k: FRONT(1.5, 0.5), m: FRONT(-4.2, 2.6) };
  const danceAll = () => {
    cast(DMITRI, DANCE.d, yawTo(DANCE.d, K(-30, -8)), 'dmitri');
    dance(A(DMITRI), 'bhangra');
    cast(KESTREL, DANCE.k, yawTo(DANCE.k, K(-30, -8)), 'kestrel');
    dance(A(KESTREL), 'shuffle');
    cast(MIRA, DANCE.m, yawTo(DANCE.m, DANCE.d), 'mira');
    A(MIRA).more = F_LIMP;
  };
  add(6, {
    name: 'dance',
    fadeIn: 0.3,
    m: 'groove',
    hit: 1,
    hour: DAY,
    settle: 200,
    setup: () => {
      called = {};
      carStopped();
      danceAll();
    },
    tick: (t) => {
      if (t > 0.8) callOnce('thanks1', A(MIRA), 'thanks');
      if (t > 3.8) callOnce('thanks2', A(MIRA), 'thanks');
    },
    cam: (t) => {
      // (low in the street, the three before the house, the balcony over them; a slow slide to the right)
      const k = ease(t / 6);
      const p = K(1.5 + k * 1.2, -4.2 + k * 1.0, 1.1);
      return hand({ p, l: DANCE.d.clone().lerp(DANCE.k, 0.4).setY(DANCE.d.y + 1.3), fov: 44 }, t, 0.3);
    },
    plates: [[0.6, 3.2, 'Bhangra · Shuffle · thanks from the splint']],
  });

  // ------------------------------------------------------------ 25. what a tag pays
  const payBoard = Gx('x14-board', `
    <div class="b14-kick">A DOG TAG, TAKEN AND HELD, PAYS SOL · ON CHAIN · READ ${LIVE.since === '8 OCT 2026' ? '16 OCT 2026' : ''}</div>
    <div class="b14-big"><b data-n="sol">0.00</b><small>SOL PAID OUT</small></div>
    <div class="b14-row"><span><b data-n="tags">0</b> tags since ${LIVE.since}</span><span><b data-n="wallets">0</b> wallets</span><span>a tag <b>${LIVE.tagPays}</b> to <b>${LIVE.tagMax} SOL</b></span></div>`);
  const count = (to: number, t: number, from: number, over: number, dp = 0) => (to * ease((t - from) / over)).toFixed(dp);
  add(4, {
    name: 'paid',
    m: 'paid',
    hit: 0.8,
    chain: true,
    hour: DAY,
    fadeOut: 0.8,
    setup: () => {
      carStopped();
      danceAll();
    },
    cam: (t) => {
      const k = ease(t / 4);
      const p = K(2.7 + k * 0.8, -3.2 + k * 0.6, 1.1);
      return hand({ p, l: DANCE.d.clone().lerp(DANCE.k, 0.4).setY(DANCE.d.y + 1.3), fov: 44 }, t, 0.3);
    },
    after: (t) => {
      show(payBoard, t, Math.min(ease(t / 0.4), 1 - ease((t - 3.4) / 0.4)));
      const set = (k: string, v: string) => (payBoard.querySelector(`[data-n="${k}"]`)!.textContent = v);
      set('sol', count(LIVE.sol, t, 0.2, 2.0, 2));
      set('tags', count(LIVE.paid, t, 0.4, 2.0));
      set('wallets', count(LIVE.wallets, t, 0.6, 1.8));
    },
  });

  // ============================================================ ACT FOUR: THE TWIST (dusk)
  // ------------------------------------------------------------ 26. the same window, lit
  add(4, {
    name: 'again',
    m: 'box',
    hit: 0.5,
    hour: DUSK,
    settle: 220,
    fadeIn: 1.0,
    setup: () => {
      lamp.intensity = 6;
      carStopped();
      camperOut();
      cast(KESTREL, NEST, yawTo(NEST, BAG), 'camper');
      A(KESTREL).aim = true;
      cast(VOLKOV, miraWalk.at(99).p, yawTo(miraWalk.at(99).p, BAG), 'volkov0');
      A(VOLKOV).crouch = true;
    },
    cam: (t) => {
      const k = ease(t / 4);
      return hand({ p: K(-30 + k * 2, 2.2 - k * 0.4, 1.4), l: SILL, fov: 32 }, t, 0.25);
    },
    line: [0.8, 3.4, 'Dusk, again.'],
  });

  // ------------------------------------------------------------ 27. through Kestrel's scope: somebody at the bag. It is Volkov.
  let fired4 = false;
  add(7, {
    name: 'scope-2',
    m: 'box',
    under: true,
    hud: true,
    bars: false,
    hour: DUSK,
    dark: 5.05,
    setup: async () => {
      lamp.intensity = 6;
      carStopped();
      fired4 = false;
      const p = miraWalk.at(99).p;
      cast(VOLKOV, p, yawTo(p, BAG), 'volkov0');
      A(VOLKOV).crouch = true;
      const to = A(VOLKOV).chest();
      nestFor(to);
      camperOut();
      eyes(NEST, yawTo(NEST, to) - 0.06, Math.atan2(to.y - (NEST.y + 1.1), Math.hypot(to.x - NEST.x, to.z - NEST.z)) + 0.03, ['mosin', ['ammo_762', 10]], 'primary', { mosin: ['pu_scope'] });
      await run(20);
      S.key('Mouse2', true);
      await run(40);
    },
    tick: (t, _S, dt) => {
      const v = A(VOLKOV);
      if (v.alive) aim(v.chest().clone().add(V(0, 0.05, 0)), 1.3, dt);
      breathe(t, 1.2);
      if (!fired4 && t > 5.0) {
        fired4 = true;
        S.tap('Mouse0', 40);
      }
    },
    line: [5.6, 7, 'Every window has somebody in it.'],
  });

  // ------------------------------------------------------------ 28. what is coming, and the end
  const coming = Gx('x17-coming', `
    <div class="c17-kick">COMING TO THE ZONE · PLANNED, NOT IN THE GAME YET</div>
    <div class="c17-list"><span>Attics</span><span>Animals in the woods</span><span>Rain and cold</span><span>A desert and its ruins</span><span>Ladders · a radio tower</span><span>Battle royale · wagers in SOL</span></div>
    <div class="c17-note">THE ROADMAP · ZONAPVP.FUN/CHANGELOG</div>`);
  add(5, {
    name: 'coming',
    m: 'next',
    hit: 0.8,
    hour: DUSK,
    fadeIn: 0.6,
    setup: () => {
      lamp.intensity = 6;
      carStopped();
      camperOut();
      cast(KESTREL, NEST, yawTo(NEST, BAG), 'camper');
      A(KESTREL).aim = true;
    },
    cam: (t) => {
      const k = ease(t / 5);
      return hand({ p: K(-16 + k * 2, -5 + k * 0.6, 1.6 + k * 0.4), l: SILL.clone().setY(SILL.y - 1.0), fov: 40 }, t, 0.25);
    },
    after: (t) => show(coming, t, Math.min(ease((t - 0.3) / 0.5), 1 - ease((t - 4.4) / 0.5))),
  });
  const endCard = Gx('x12-end', `
    <div class="c12-list"><span>PVP SURVIVAL</span><span>DOG TAGS PAY SOL</span><span>FREE IN YOUR BROWSER</span></div>
    <div class="c12-name">ZONA <em>PvP</em></div>
    <div class="c12-url">WWW.ZONAPVP.FUN</div>`);
  add(5, {
    name: 'end',
    m: 'end',
    hit: 1.2,
    hour: DUSK,
    fadeOut: 1.4,
    setup: () => {
      lamp.intensity = 6;
      carStopped();
      camperOut();
      cast(KESTREL, NEST, yawTo(NEST, BAG), 'camper');
      A(KESTREL).aim = true;
    },
    cam: (t) => {
      const k = ease(t / 5);
      return hand({ p: K(-14 + k * 1.5, -4.4 + k * 0.4, 2.0 + k * 0.5), l: SILL.clone().setY(SILL.y - 1.2), fov: 40 }, t, 0.2);
    },
    after: (t) => {
      if (t > 0.4) show(endCard, t - 0.4, ease((t - 0.4) / 0.6));
      else endCard.style.display = 'none';
    },
  });

  total = cur;
  say(`${shots.length} shots, ${total.toFixed(1)} s, ${ROWS.length} bars of score`);
  return shots;
}
