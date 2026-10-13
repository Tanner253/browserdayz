// The ninth film: "Nothing stays buried". Two minutes and twenty-four seconds (72 bars at 120 BPM), made the
// way the others were: the real game on a clock that only moves when the film says.
//
// It was asked for as a story and a tour in one: "we should tell a story. like how the player can watch another
// player running into the woods with high tier loot after exiting the bunker, then following them and watching
// them stash their stuff and bury it, the watcher then goes up and digs it up and steal their loot and dances";
// "comprehensive slow walkthroughs that pan through the map and show off the dynamicism of it like the spot under
// the staircase and the roof levels"; "new animations everything weve added, optimizations and expected results";
// "show off how much weve paid out and how much $$$ has been earned, sol is 107$ rn"; "we need NEW MUSIC".
//
// So: a card, then the story with hardly a word on it (a man comes up out of Bunker 17, is watched through
// binoculars from the rim, is followed through the wood, buries a case with a shovel and walks off; the watcher
// digs it up, opens it, and dances), then what has been added since the last film, set out as the eighth film
// set out its guns, which was the one people liked best: the hospital floor by floor and up to its roof, the
// police headquarters round its yard, the cupboard under the stairs with somebody in it, the village's new
// streets, the steel cabinets, a light on a rifle in a dark ward, the bot check shot in the game's own hands,
// what was measured before and after the work on stops, and what has been paid. Then what is next, the story's
// last word, and where it is played.
//
// What a film may not do, learnt from the eighth: nothing runs at any speed but its own (no shot has a `rate`),
// cuts are a beat apart at the least, and dark things are shown against something lighter.
//
// Every figure on the screen is read off the rules or the world as the film is made, except two sets that are
// written down here with where they are from: what the payouts page said on the day (LIVE: read it again before
// filming again), and what was measured before and after the work on stops (MEASURED: the changelog's figures).

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import { BAR9, scoreMusic9, type Kind9, type Row9 } from './music9';
import { audio } from '../core/audio';
import { ITEMS, makeItem, type ItemInstance } from '../sim/items';
import { Container } from '../sim/inventory';
import { BUNKER, bunkerAt, bunkerLocal } from '../sim/bunker';
import { BURY, noBurying } from '../sim/stash';
import { RangeJudge, STRIP, clearShot, figureAt, rangeOf } from '../sim/range';
import { BotCheck } from '../game/botcheck';
import { TOWN } from '../world/worldgen';
import { F_PRONE } from '../net/protocol';
import { CONTRACT, DISCORD, X_HANDLE } from '../ui/hud';

/** how long the film is, seconds: said when its shots have been laid out */
export let seconds9 = 0;
let ROWS: Row9[] = [];
/** its score, written to its own shots */
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic9(ctx, out, ROWS);

/**
 * What https://www.zonapvp.fun/api/cashins?format=json said when this was filmed (a read; never /api/tick), and the
 * price of a SOL that day as the film was asked to reckon it ("sol is 107$ rn").
 * paidSol and paidTags are the page's own totals; wallets, top and days are counted from its rows.
 */
const LIVE = {
  on: '12 OCT 2026',
  usd: 107,
  paidTags: 111,
  paidSol: 2.245,
  wallets: 23,
  tagSol: 0.02,
  top: 0.245,
  treasury: 0.678,
  days: [['8 OCT', 0.02], ['9 OCT', 0.38], ['10 OCT', 0.46], ['11 OCT', 0.66], ['12 OCT', 0.725]] as [string, number][],
};
/** Measured on one laptop (an RTX 3070 Ti), the same scripted session before and after: the changelog's figures of 11 and 12 Oct 2026. */
const MEASURED: { what: string; unit: string; was: number; now: number; d: number }[] = [
  { what: 'THE FIRST LAMP LIT STOPPED THE GAME FOR', unit: 's', was: 4.6, now: 0.1, d: 1 },
  { what: 'NIGHTFALL STOPPED IT FOR', unit: 's', was: 4.0, now: 0.05, d: 2 },
  { what: 'A RUNNER ON A BAD CONNECTION STOOD STILL IN', unit: '% OF FRAMES', was: 13, now: 0.5, d: 1 },
  { what: 'FETCHED BEFORE THE MENU', unit: 'MB', was: 133, now: 73, d: 0 },
];

/**
 * Two other cuts of it, by the address (scripts/film.mjs --web, --menu):
 *   web   the whole film as the site shows it, smaller and lighter: with no grain laid over it (grain is what a
 *         small file has least room for);
 *   menu  the pictures the main menu plays between its own scenes (public/menu/story.mp4): eight shots of it with
 *         none of its words, bands, cards or flashes, and no sound that anybody hears.
 */
const ASKED = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const WEB = ASKED.has('web'), MENU = ASKED.has('menu');
const MENU_SHOTS = ['bunker-out', 'wood', 'bury-far', 'bury-near', 'dance', 'hospital', 'roof', 'hq'];
const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
const bars = (n: number) => n * BAR9;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Build = { id: string; type: string; x: number; z: number; rot: number; floorY: number };
type Extra = {
  /** which part of the score plays under it, with a blow as it begins, the air rising out of it, and whether the band stands back */
  m: Kind9; hit?: number; lift?: number; under?: boolean;
  g?: string | null; fadeIn?: number; fadeOut?: number; flash?: number; hour?: number;
  word?: [string, string]; chip?: [string, string]; grid?: number;
  /** words at the foot of the picture: from, until, what */
  caps?: [number, number, string][];
};

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any, world = S.world as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  document.body.classList.add('tr-cut8', 'tr-cut9');
  if (WEB) document.body.classList.add('tr-web');
  if (MENU) document.body.classList.add('tr-menu9');
  const scene = g.s.r.scene as THREE.Scene, camera = g.s.r.camera as THREE.PerspectiveCamera;
  const P = (x: number, z: number, up = 0) => S.at(x, z, up);
  const say = (...a: unknown[]) => console.log('[tr] cut 9:', ...a);

  // ------------------------------------------------------------ places
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
  const yawTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
  const hosp = one('hospital'), hq = one('police_hq');
  const village = world.pois[0] as { x: number; z: number };
  // (the floors of the hospital, above its ground floor: 3.2 m of room and a slab of 0.2, then 3.0 and a slab, twice)
  const FLOOR1 = 3.4, ROOF = 9.8, BALCONY = 3.4, HQ_ROOF = 6.4, HQ_TERRACE = 3.4;
  const T = TOWN, ul = Math.hypot(T.street[0], T.street[1]), ux = T.street[0] / ul, uz = T.street[1] / ul;
  /** a place in Kamenka: so far down its street, so far to the right of it */
  const K = (along: number, right = 0, up = 0) => P(T.x + ux * along + uz * right, T.z + uz * along - ux * right, up);
  const trunks = (world.trees as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush'));
  const rocks = (world.rocks ?? []) as { x: number; z: number }[];
  const nearCount = (list: { x: number; z: number }[], x: number, z: number, r: number) => {
    let n = 0;
    for (const o of list) if (Math.abs(o.x - x) < r && Math.abs(o.z - z) < r && Math.hypot(o.x - x, o.z - z) < r) n++;
    return n;
  };

  // the bunker, by its own measure (right, forward): forward is the way out
  const BP = g.bunker.place as { x: number; y: number; z: number; rot: number };
  if (!BP) throw new Error('the map has no bunker');
  /** the ground at a place, or the pad that lies over the bunker's pit there */
  const groundY = (x: number, z: number) => {
    const [r, f] = bunkerLocal(BP, x, 0, z), pad = BUNKER.pad;
    return Math.abs(r) <= pad.r && f <= pad.front && f >= pad.back ? BP.y + pad.top : S.ground(x, z);
  };
  const BK = (r: number, f: number, up = 0) => {
    const [x, , z] = bunkerAt(BP, r, f);
    return new THREE.Vector3(x, groundY(x, z) + up, z);
  };
  const OUT_YAW = Math.atan2(-Math.sin(BP.rot), -Math.cos(BP.rot));
  const COURT = { f: (BUNKER.hut.front + BUNKER.court.front) / 2 + 0.1, side: BUNKER.court.open };

  // ------------------------------------------------------------ the story's ground: where he runs to, and who watches from where
  /** nothing stands on it for a step or two round, it is near enough level, there is wood about it, and a spade may be put into it */
  const glade = (() => {
    let best: THREE.Vector3 | null = null, score = -1e9;
    for (let R = 84; R <= 150; R += 6) {
      for (let a = -0.5; a <= 2.3; a += 0.1) {
        // (a: round from straight out toward the side the yard opens to)
        const p = BK(Math.sin(a) * R * COURT.side, COURT.f + Math.cos(a) * R);
        if (nearCount(trunks, p.x, p.z, 2.5) || nearCount(rocks, p.x, p.z, 3.5)) continue;
        let lo = 1e9, hi = -1e9;
        for (let k = 0; k < 8; k++) {
          const h = S.ground(p.x + Math.cos(k * 0.785) * 2.5, p.z + Math.sin(k * 0.785) * 2.5);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
        // (the wood round the bunker is on a hillside, and thick: a place where a man can stand and a spade go in is all that is asked)
        if (hi - lo > 1.3) continue;
        if (noBurying(p.x, p.y, p.z, p.y, world.pois, world.buildings)) continue;
        const wood = nearCount(trunks, p.x, p.z, 20);
        if (wood < 5) continue;
        const s = Math.min(wood, 26) - (hi - lo) * 8 - Math.abs(a - 0.9) * 4 - Math.abs(R - 110) * 0.05;
        if (s > score) {
          score = s;
          best = p;
        }
      }
    }
    if (!best) throw new Error('no glade near the bunker to bury anything in');
    return best;
  })();
  const GATE = BK(COURT.side * (BUNKER.court.r + 1.9), COURT.f);
  /**
   * The man's whole way, where his feet are sixty times a second from the moment he starts up the bunker's stair: up
   * it and across the hut to its door at a walk, slower through the yard with his rifle swung to one side and the
   * other, through the gap in its wall and up to a run, round whatever stands in his way through the wood, and down
   * to a walk for the last steps into the glade. One line from end to end, and evened out: he never turns on the
   * spot, and what the trees push him about by is a man's weaving and not a machine's.
   */
  const STAIR = { from: 11.6, speed: 2.4 }, LOOK = { secs: 1.6, wide: 0.6 };
  const TRACK = (() => {
    const xs: number[] = [], zs: number[] = [], yaws: number[] = [], vs: number[] = [];
    for (let f = STAIR.from; f < BUNKER.hut.front + 0.2; f += STAIR.speed / 60) {
      const [x, , z] = bunkerAt(BP, 0, f);
      xs.push(x);
      zs.push(z);
      yaws.push(OUT_YAW);
      vs.push(STAIR.speed);
    }
    const door = xs.length, marks = [BK(0, COURT.f + 0.2), GATE, glade];
    let x = xs[door - 1], z = zs[door - 1], m = 0, gate = door;
    for (let k = 0; k < 60 * 120; k++) {
      const tt = (xs.length - door) / 60, to = marks[m], dx = to.x - x, dz = to.z - z, d = Math.hypot(dx, dz);
      if (m < 2 && d < 0.9) {
        m++;
        if (m === 2) gate = xs.length;
        continue;
      }
      if (d < 0.25) break;
      // how fast: all but stopped while he looks about him, then up to a run; and down to a walk for the last steps
      let v = tt < LOOK.secs ? 2.3 - 1.4 * Math.sin((Math.PI * tt) / LOOK.secs) : Math.min(5.6, 2.3 + (tt - LOOK.secs) * 3.6);
      if (m === 2) v = Math.min(v, 1.3 + d * 1.15);
      let vx = dx / d, vz = dz / d;
      if (m === 2 && d > 3) {
        for (const list of [trunks, rocks]) {
          for (const o of list) {
            if (Math.abs(o.x - x) > 3.4 || Math.abs(o.z - z) > 3.4) continue;
            const ox = x - o.x, oz = z - o.z, od = Math.hypot(ox, oz);
            if (od > 3.4 || od < 1e-3) continue;
            const w = Math.pow(1 - od / 3.4, 1.5) * 2.4;
            vx += (ox / od) * w;
            vz += (oz / od) * w;
          }
        }
      }
      const n = Math.hypot(vx, vz) || 1;
      x += (vx / n) * (v / 60);
      z += (vz / n) * (v / 60);
      xs.push(x);
      zs.push(z);
      yaws.push(0);
      vs.push(v);
    }
    const n = xs.length;
    for (let pass = 0; pass < 3; pass++) {
      for (const arr of [xs, zs]) {
        const was = arr.slice();
        for (let i = door + 6; i < n - 6; i++) {
          let sum = 0;
          for (let j = -6; j <= 6; j++) sum += was[i + j];
          arr[i] = sum / 13;
        }
      }
    }
    // (he faces the way he is going, as it now is; in the yard, with the look about him laid over that)
    for (let i = door; i < n; i++) {
      const a = Math.max(door - 1, i - 5), b = Math.min(n - 1, i + 5), tt = (i - door) / 60;
      const far = Math.hypot(xs[b] - xs[a], zs[b] - zs[a]);
      const way = far > 0.02 ? Math.atan2(-(xs[b] - xs[a]), -(zs[b] - zs[a])) : yaws[i - 1];
      yaws[i] = way + (tt < LOOK.secs ? Math.sin((tt / LOOK.secs) * Math.PI * 2) * LOOK.wide * Math.sin((Math.PI * tt) / LOOK.secs) : 0);
    }
    // (and the last second of it he turns no more: his feet are as good as still)
    for (let i = n - 40; i < n; i++) yaws[i] = yaws[n - 41];
    const far = [0];
    for (let i = 1; i < n; i++) far.push(far[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
    return { xs, zs, yaws, vs, far, n, door, gate };
  })();
  // the story's clock, seconds: when he is at the hut's door, when he is running, when he is in the glade
  const T_OUT = TRACK.door / 60, T_RUN = T_OUT + LOOK.secs + 0.5, T_THERE = TRACK.n / 60;
  /** which way he faces when he has stopped: the way he came */
  const DIG_YAW = TRACK.yaws[TRACK.n - 1];
  const digDir = new THREE.Vector3(-Math.sin(DIG_YAW), 0, -Math.cos(DIG_YAW)), digRight = new THREE.Vector3(digDir.z, 0, -digDir.x);
  /** where he stops */
  const STOOD = P(TRACK.xs[TRACK.n - 1], TRACK.zs[TRACK.n - 1]);
  /** where the case is put down, and so where it is buried */
  const CASE = P(STOOD.x + digDir.x * 0.9, STOOD.z + digDir.z * 0.9);
  /**
   * Where the man from the bunker is, `t` seconds after he started up its stair. Read BETWEEN the places of his way,
   * not at the nearest of them: a shot that begins a whole number of sixtieths along it asked for place n and a
   * hair, or n less a hair, as the arithmetic fell, and so stood him on the same place for two frames and then
   * moved him two ("the scene from 15 seconds to 20 seconds is laggy": one frame in four of it was the frame before).
   */
  const runner = (t: number): { p: THREE.Vector3; yaw: number; run: boolean; aim: boolean } => {
    const k = Math.max(0, Math.min(TRACK.n - 1.0001, t * 60)), i = Math.floor(k), f = k - i;
    const x = lerp(TRACK.xs[i], TRACK.xs[i + 1], f), z = lerp(TRACK.zs[i], TRACK.zs[i + 1], f);
    // (on the stair he is under the pad still: it comes up from the first level to the hut's floor)
    const along = bunkerLocal(BP, x, 0, z)[1], head = BUNKER.stair.foot + BUNKER.stair.run;
    const y = i < TRACK.door && along < head ? BP.y - (BUNKER.depth * (head - along)) / BUNKER.stair.run : groundY(x, z);
    return {
      p: new THREE.Vector3(x, y, z),
      yaw: TRACK.yaws[i] + wrap(TRACK.yaws[i + 1] - TRACK.yaws[i]) * f,
      run: lerp(TRACK.vs[i], TRACK.vs[i + 1], f) > 4.6 && t * 60 < TRACK.n - 1,
      // (his rifle is up from the door until he has looked about him)
      aim: k > TRACK.door - 40 && k < TRACK.door + LOOK.secs * 60 + 10,
    };
  };
  /** how far from the glade he is, along his way, at a moment of the story */
  const toGo = (t: number) => TRACK.far[TRACK.n - 1] - TRACK.far[Math.max(0, Math.min(TRACK.n - 1, Math.round(t * 60)))];
  /** where on his way he was, so many metres short of the glade */
  const short = (m: number) => {
    let i = TRACK.n - 1;
    while (i > TRACK.gate && TRACK.far[TRACK.n - 1] - TRACK.far[i] < m) i--;
    return { p: P(TRACK.xs[i], TRACK.zs[i]), yaw: TRACK.yaws[i], k: i };
  };
  // The rim the watcher stands on: on the side the yard opens to (its wall hides the door from the other side), round
  // toward the back from the way the man runs, with the gap in the wall and the first of his run in view, and a
  // little above them (tall grass is looked over, not through; from the mountain behind, a man is a speck under trees).
  const RIM = (() => {
    const up = (p: THREE.Vector3) => p.clone().add(new THREE.Vector3(0, 1.2, 0));
    const marks = [up(GATE), up(runner(T_RUN + 0.8).p), up(runner(T_RUN + 2.2).p)];
    /** no tree stands within its own branches' reach of the line from one place to another (a ray finds trunks; the eye finds the boughs) */
    const open = (a: THREE.Vector3, b: THREE.Vector3, reach: number) => {
      const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
      for (const t of trunks) {
        const k = Math.min(1, Math.max(0, ((t.x - a.x) * dx + (t.z - a.z) * dz) / len2));
        if (Math.hypot(a.x + dx * k - t.x, a.z + dz * k - t.z) < reach) return false;
      }
      return true;
    };
    let best: THREE.Vector3 | null = null, top = -1e9;
    for (let R = 26; R <= 85; R += 4) {
      for (let a = 1.2; a <= 2.9; a += 0.1) {
        const p = BK(Math.sin(a) * R * COURT.side, COURT.f + Math.cos(a) * R);
        const eye = p.clone().setY(p.y + 1.62);
        if (!marks.every((mk) => S.clearLine(eye, mk) && open(eye, mk, 4.2))) continue;
        const s = -Math.abs(p.y - BP.y - 6) * 0.5 - Math.abs(R - 46) * 0.12;
        if (s > top) {
          top = s;
          best = p;
        }
      }
    }
    if (!best) say('no place on the rim sees the whole of it: the watcher stands out in the hollow');
    return best ?? BK(26 * COURT.side, COURT.f + 34);
  })();
  // the tree the watcher is behind while the case goes under: back the way they both came, with the place in view
  const HIDE = (() => {
    const back = short(22).p, want = new THREE.Vector3(back.x - CASE.x, 0, back.z - CASE.z).normalize();
    let best: THREE.Vector3 | null = null, score = -1e9;
    for (const t of trunks) {
      const dx = t.x - CASE.x, dz = t.z - CASE.z, d = Math.hypot(dx, dz);
      if (d < 15 || d > 30) continue;
      const along = (dx * want.x + dz * want.z) / d;
      if (along < 0.5) continue;
      // (a step behind it and half a one to its side: an eye round the trunk)
      const p = P(t.x + (dx / d) * 0.95 + (dz / d) * 0.55, t.z + (dz / d) * 0.95 - (dx / d) * 0.55);
      if (!S.clearLine(p.clone().setY(p.y + 1.05), CASE.clone().setY(CASE.y + 0.9)) || !S.clearLine(p.clone().setY(p.y + 1.05), glade.clone().setY(glade.y + 1.4))) continue;
      const s = along * 10 - Math.abs(d - 21);
      if (s > score) {
        score = s;
        best = p;
      }
    }
    if (!best) say('no tree to hide behind with the glade in view: the watcher is in the open');
    return best ?? P(CASE.x + want.x * 20, CASE.z + want.z * 20);
  })();
  say(`the glade is ${Math.hypot(glade.x - BP.x, glade.z - BP.z).toFixed(0)} m from the bunker (${nearCount(trunks, glade.x, glade.z, 20)} trees within 20 m); the run is ${(T_THERE - T_RUN).toFixed(1)} s; the rim is ${Math.hypot(RIM.x - BP.x, RIM.z - BP.z).toFixed(0)} m off and ${(RIM.y - BP.y).toFixed(1)} m up; the hide is ${Math.hypot(HIDE.x - CASE.x, HIDE.z - CASE.z).toFixed(0)} m from the case`);

  // ------------------------------------------------------------ the look
  const overlay = document.getElementById('tr-overlay')!;
  const piece = (cls: string) => {
    const el = document.createElement('div');
    el.className = cls;
    overlay.appendChild(el);
    return el;
  };
  const grain = piece('tr-grain4'), black = piece('tr-black4'), white = piece('tr-flash4'), grid = piece('x8-grid');
  piece('tr-vig4');
  const GRADES = ['cold', 'warm', 'war', 'gold', 'dust', 'dim', 'dim5', 'gas'];
  const grade = (name: string | null) => { for (const n of GRADES) document.body.classList.toggle(`tr-g-${n}`, n === name); };
  let frame = 0;
  const look = (t: number, len: number, o: Extra) => {
    frame++;
    grain.style.transform = `translate(${((frame * 73) % 97) - 48}px, ${((frame * 41) % 89) - 44}px)`;
    const a = o.fadeIn ? 1 - ease(t / o.fadeIn) : 0, z = o.fadeOut ? ease((t - (len - o.fadeOut)) / o.fadeOut) : 0;
    black.style.opacity = String(Math.max(a, z));
    white.style.opacity = String(o.flash ? Math.max(0, 1 - t / 0.08) * o.flash : 0);
    grid.style.setProperty('--o', String(o.grid ?? 0));
  };
  /** a lens held in a hand */
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
  /** a lens carried slowly along a line of places, looking at one place or a little ahead of itself */
  const glide = (pts: THREE.Vector3[], k: number, to: THREE.Vector3 | null, fov: number, ahead = 0.16): CamPose => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), e = ease(k) * 0.999;
    const p = curve.getPointAt(e);
    return { p, l: to ?? curve.getPointAt(Math.min(1, e + ahead)).add(curve.getTangentAt(e).multiplyScalar(4)), fov };
  };

  // ------------------------------------------------------------ the film's own graphics
  const gfx: HTMLElement[] = [];
  const G = (cls: string, html: string) => {
    const el = document.createElement('div');
    el.className = `tr-gfx ${cls}`;
    el.innerHTML = html;
    el.style.display = 'none';
    overlay.appendChild(el);
    gfx.push(el);
    return el;
  };
  const show = (el: HTMLElement, t: number, o = 1) => {
    el.style.display = '';
    el.style.setProperty('--t', t.toFixed(3));
    el.style.setProperty('--o', o.toFixed(3));
  };
  const chip = G('x8-chip', '<b></b><span></span>'), word = G('x8-word', '<b></b><span></span>'), cap = G('x9-cap', '<span></span>');
  const mark = G('x8-mark', 'ZONA <i>·</i> NOTHING STAYS BURIED');
  /** a thing named at the foot of the picture, with what there is to say of it */
  const spec = (idx: string, name: string, rows: [string, string][]) => G('x8-spec x9-spec', `
    <div class="s8-idx">${idx}</div>
    <div class="s8-name">${name}</div>
    <div class="s8-rows">${rows.map(([k, v]) => `<i>${k}</i><span>${v}</span>`).join('')}</div>`);
  const money = (sol: number) => `$${Math.round(sol * LIVE.usd)}`;

  // ------------------------------------------------------------ hands, pockets, people
  const give = (id: string, set: Partial<ItemInstance> = {}, qty?: number) => {
    const it = makeItem(id, qty) as ItemInstance;
    Object.assign(it, set);
    if (g.inv.add(it)) throw new Error(`no room for the ${id}`);
    return it;
  };
  /** the player stood somewhere with a pack and a hat, whole, and nothing in the hands */
  const me = (p: THREE.Vector3, yaw: number, pitch = 0, floor = false, worn: string[] = ['camping_pack', 'boonie_hat']) => {
    S.me(p.x, p.z, yaw, pitch, floor ? p.y : undefined);
    if (g.use) g.breakOff();
    g.emptyHands();
    const neck = g.inv.neck;
    g.inv.clear();
    g.inv.neck = neck;
    g.inv.hot = [];
    for (const id of worn) give(id);
    g.inventoryChanged();
    g.lit = false;
  };
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
  /** a key put down or let go, said to the game only when it changes (said again while it is down, it is a fresh press) */
  const held = new Set<string>();
  const key = (code: string, down: boolean) => {
    if (held.has(code) === down) return;
    if (down) held.add(code);
    else held.delete(code);
    S.key(code, down);
  };
  /** the first-person eyes brought round to a point, a part of the way each frame */
  // (`k` is how much of the way in a thirtieth of a second: what the drafts are taken at. Taken at sixty, a part of
  // the way each frame was twice as quick a turn of the head as the one that had been looked at.)
  let DT = 1 / 60;
  const gain = (k: number, dt = DT) => 1 - Math.pow(1 - k, dt * 30);
  const eyes = (to: THREE.Vector3, per = 0.2) => {
    const p = g.player, c = camera.position, k = gain(per);
    p.yaw += wrap(Math.atan2(-(to.x - c.x), -(to.z - c.z)) - p.yaw) * k;
    p.pitch += (Math.atan2(to.y - c.y, Math.hypot(to.x - c.x, to.z - c.z)) - p.pitch) * k;
  };
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
  const A = (i: number) => S.actors[i];
  /** somebody of the cast stood on a floor (which is not always the ground's) */
  const stand = (a: Actor, p: THREE.Vector3, yaw: number, weapon: string | null = null, gear: string[] = [], mods: string[] = []) => {
    a.place(p.x, p.z, yaw, weapon, gear);
    a.pos.y = p.y;
    if (weapon && mods.length) a.rp.setWeapon(weapon, mods);
    return a;
  };
  const doors = (g.s.buildings.doors ?? []) as { pivot: THREE.Object3D; open: boolean; setOpen(open: boolean, swing?: number): void; toggle(from?: THREE.Vector3): void }[];
  const doorPos = new THREE.Vector3();
  const doorNear = (p: THREE.Vector3, reach = 1.3) => {
    let best: (typeof doors)[number] | null = null, far = reach;
    for (const d of doors) {
      const q = d.pivot.getWorldPosition(doorPos), dist = Math.hypot(q.x - p.x, q.z - p.z);
      if (dist < far && Math.abs(q.y - p.y) < 2.2) {
        far = dist;
        best = d;
      }
    }
    return best;
  };
  /** every door of a place stood open, for a lens that is carried through it (and shut again after) */
  let opened: (typeof doors)[number][] = [];
  const openAll = (p: THREE.Vector3, reach: number) => {
    for (const d of doors) {
      const q = d.pivot.getWorldPosition(doorPos);
      if (!d.open && Math.hypot(q.x - p.x, q.z - p.z) < reach) {
        d.setOpen(true);
        opened.push(d);
      }
    }
  };

  // ------------------------------------------------------------ the case, and what is in it
  const IN_THE_CASE: [string, Partial<ItemInstance>?][] = [
    ['ak', { mag: 'drum_ak', loaded: 76, mods: ['red_dot', 'suppressor_739'] }], ['deagle', { mag: 'mag_deagle', loaded: 8 }], ['armor_vest'], ['helmet_k63'], ['keycard'],
    ['drum_ak', { rounds: 75 }], ['pu_scope'], ['gasmask'], ['firstaid'], ['stim'], ['stim'], ['grenade'], ['box_739'], ['box_50'],
  ];
  /** the case as it lies on the ground, full */
  const fullCase = () => {
    const it = makeItem('stash_kit', 1) as ItemInstance, [w, h] = ITEMS.stash_kit.stash ?? [8, 6];
    const c = new Container('film', 'film', w, h, [], true);
    for (const [id, set] of IN_THE_CASE) {
      if (!ITEMS[id]) continue;
      c.add(Object.assign(makeItem(id) as ItemInstance, set ?? {}));
    }
    it.cargo = (c.serialize().items as Any[]).map(({ x, y, rot, ...item }) => ({ item, x, y, rot }));
    return it;
  };
  let lying: string | null = null, under: Any = null;
  /** the case put down in the glade */
  const layCase = () => {
    const l = g.economy.drop(fullCase(), CASE.x, CASE.y + 0.02, CASE.z, DIG_YAW + 0.5);
    lying = l.uid;
    return l;
  };
  /** the case under the ground there, as the game leaves one when a shovel has been at it */
  const buryCase = async () => {
    const l = lying ? g.economy.take(lying) : null, item = (l?.item ?? fullCase()) as ItemInstance;
    lying = null;
    const st = g.newStash({ uid: l?.uid ?? `film_${Math.round(performance.now())}`, x: CASE.x, y: S.ground(CASE.x, CASE.z), z: CASE.z, rot: DIG_YAW + 0.5, item: 'stash_kit', buried: true });
    const items = (item.cargo ?? []).map((q: Any) => ({ ...q.item, x: q.x, y: q.y, rot: q.rot }));
    if (items.length) st.container.load({ items });
    under = st;
    await g.loot.addStash(st);
    return st;
  };
  const clearCase = () => {
    if (lying && g.economy.loot.has(lying)) g.economy.take(lying);
    lying = null;
    if (under && g.loot.stashes.includes(under)) g.loot.removeStash(under);
    under = null;
    // (and whatever the digging of it up left lying)
    for (const l of [...g.economy.loot.values()] as Any[]) if (l.item?.id === 'stash_kit' && Math.hypot(l.x - CASE.x, l.z - CASE.z) < 6) g.economy.take(l.uid);
  };

  // ------------------------------------------------------------ the bot check, played here with nobody to ask
  let range: { bc: Any; judge: RangeJudge; spec: ReturnType<typeof rangeOf>; floor: number } | null = null;
  const laid: string[] = [];
  const reset = () => {
    for (const a of S.actors) {
      a.dance = a.surrender = a.crouch = a.aim = a.sprint = false;
      a.more = 0;
      a.foe = null;
      a.rp.avatar.clearWounds();
      a.hide();
    }
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Mouse0', 'Mouse2', 'AltLeft', 'KeyI', 'KeyR', 'KeyC']) S.key(k, false);
    held.clear();
    if (g.invUI.isOpen) g.toggleInventory(false);
    if (range) {
      range.bc.end();
      g.botCheck = null;
      g.player.god = false;
      range = null;
    }
    g.glass = 0;
    lamp.intensity = 0;
    if (g.hold) g.setHold(null);
    if (g.player.prone) g.player.setProne(false);
    for (const d of opened) d.setOpen(false);
    opened = [];
    for (const uid of laid.splice(0)) if (g.economy.loot.has(uid)) g.economy.take(uid);
    clearCase();
    me(P(-380, -380), 0);
    S.clean();
    hush();
  };

  // ------------------------------------------------------------ the set
  const shots: Shot[] = [];
  const plan: { at: number; len: number; x: Extra }[] = [];
  const WORD = 0.36;
  let cur = 0;
  const add = (len: number, s: Omit<Shot, 'start' | 'end'> & Extra) => {
    const L = bars(len), setup = s.setup, after = s.after, tick = s.tick, start = cur;
    cur += len;
    plan.push({ at: start, len, x: s });
    shots.push({
      // (the black bands over and under a picture are the story's: what is set out as a sheet has its words at the edges)
      bars: false,
      ...s,
      start: bars(start),
      end: bars(start + len),
      tick: (t, st, dt) => {
        DT = dt;
        tick?.(t, st, dt);
      },
      setup: async (st) => {
        DT = 1 / 60;
        grade(s.g ?? null);
        for (const el of gfx) el.style.display = 'none';
        g.hourHeld = s.hour ?? 0.3;
        if (s.chip) {
          chip.querySelector('b')!.textContent = s.chip[0];
          chip.querySelector('span')!.textContent = s.chip[1];
        }
        try {
          await setup?.(st);
        } catch (e) {
          say(`${s.name}: its setting up failed: ${(e as Error).message}`);
        }
      },
      after: (t, st) => {
        after?.(t, st);
        look(t, L, MENU ? { m: s.m, grid: 0 } : s);
        // (the menu's cut is its pictures and nothing else)
        if (MENU) return;
        if (s.chip) {
          show(chip, t);
          show(mark, t);
        }
        const w = s.word && t < WORD ? s.word : null;
        word.style.display = w ? '' : 'none';
        if (w) {
          word.querySelector('b')!.textContent = w[0];
          word.querySelector('span')!.textContent = w[1];
          word.style.setProperty('--k', (1.06 - (t / WORD) * 0.06).toFixed(3));
        }
        const c = (s.caps ?? []).find(([from, until]) => t >= from && t < until);
        if (c) {
          cap.querySelector('span')!.innerHTML = c[2];
          show(cap, t - c[0], Math.min(ease((t - c[0]) / 0.3), ease((c[1] - t) / 0.25)));
        } else cap.style.display = 'none';
      },
    });
  };

  // ============================================================ the card: the first frame is the picture the film is known by
  const hospPlaces = (g.s.buildings.lootPoints as { building: string }[]).filter((p) => p.building.startsWith('hospital')).length;
  const card = G('x8-card x9-card', `
    <div class="k8-kick">THE WORLD UPDATE &nbsp;·&nbsp; LIVE NOW &nbsp;·&nbsp; FREE IN YOUR BROWSER</div>
    <div class="k8-logo">ZONA</div>
    <div class="k8-line">NOTHING STAYS BURIED</div>
    <div class="k8-tiles">
      <div><b>${money(LIVE.paidSol)}</b><span>PAID TO PLAYERS</span></div>
      <div><b>${LIVE.paidTags}</b><span>DOG TAGS CASHED</span></div>
      <div><b>${builds.length}</b><span>BUILDINGS TO SEARCH</span></div>
      <div><b>${g.s.buildings.lootPoints.length}</b><span>PLACES THINGS ARE LEFT</span></div>
    </div>`);
  /** the hospital from over the street before it, the lens coming down and in */
  const hospHigh = (k: number): CamPose => ({ p: at(hosp, lerp(-34, -26, k), lerp(58, 50, k), lerp(27, 22, k)), l: at(hosp, 0, 4, 5), fov: 34 });
  add(2, {
    name: 'card',
    m: 'card',
    hour: 0.66,
    g: 'gold',
    setup: async () => {
      reset();
      S.cam = hospHigh(0);
      await run(30);
      S.cam = null;
    },
    cam: (t) => hand(hospHigh(t / bars(2)), t, 0.3),
    after: (t) => show(card, t + 1),
    lift: 0.8,
  });

  // ============================================================ the story
  const RUNNER_GEAR = ['heavy_armor', 'helmet_k63', 'camping_pack'];
  const R0 = () => A(0);
  /** the man from the bunker put where the story has him */
  const runnerNow = (t: number) => {
    const a = R0(), q = runner(t);
    a.pos.copy(q.p);
    a.yaw = q.yaw;
    a.sprint = q.run;
    a.aim = q.aim;
    a.crouch = false;
    a.pitch = 0;
    return q;
  };
  const story = (t0: number) => {
    reset();
    const q = runner(t0);
    stand(R0(), q.p, q.yaw, 'ak', RUNNER_GEAR, ['red_dot']);
  };

  /** a second of the story run where nobody sees it, up to the frames before a shot's first: whoever is moving when it opens has been moving */
  const upTo = (t0: number, each?: (t: number) => void) => run(36, (k) => {
    runnerNow(t0 - 1 + k / 60);
    each?.(t0 - 1 + k / 60);
  });

  // ---- 1. he comes up out of the bunker
  // (seen from out through the gap in the yard's wall: he comes out of the door into the yard, and then at the lens)
  const OUT0 = T_OUT - 0.9;
  const outCam = (t: number): CamPose => {
    const yard = BK(0, COURT.f, 1.3), body = R0().rp.pos as THREE.Vector3, chest = new THREE.Vector3(body.x, Math.max(body.y, BP.y) + 1.25, body.z);
    return { p: BK(COURT.side * 9.6, COURT.f + 1.5, 1.2), l: yard.clone().lerp(chest, ease((t - T_OUT + 0.7) / 1.1)), fov: 36 };
  };
  // (The hut is a dark thing in a hollow, and a man in black coming out of it was a shadow leaving a shadow. A lamp of
  // the film's hangs over its door for this one shot, as the bunker's own hangs over the door at the stair's foot.)
  const lamp = new THREE.PointLight(0xffd29a, 0, 22, 1.5);
  lamp.position.copy(BK(COURT.side * 1.3, BUNKER.hut.front + 1.5, 2.5));
  scene.add(lamp);
  add(3, {
    name: 'bunker-out',
    m: 'dread',
    hour: 0.64,
    g: 'cold',
    fadeIn: 0.5,
    caps: [[0.4, 2.8, 'BUNKER 17 &nbsp;·&nbsp; THE BEST LOOT IN THE ZONE'], [3.1, 5.8, 'HE GOT OUT ALIVE, AND HE GOT OUT <b>RICH</b>']],
    setup: async () => {
      story(OUT0 - 1);
      lamp.intensity = 90;
      await upTo(OUT0);
    },
    lead: (t) => { runnerNow(OUT0 + t); },
    bars: true,
    tick: (t) => { runnerNow(OUT0 + t); },
    cam: (t) => hand(outCam(OUT0 + t), t, 0.7),
  });

  // ---- 2. and is watched
  const GLASS0 = T_OUT + 0.2;
  /** the glasses kept on him by a hand that is not quite still */
  const watch = (t: number) => {
    const b = R0().rp.pos as THREE.Vector3;
    eyes(new THREE.Vector3(b.x + Math.sin(t * 1.9) * 0.14, Math.max(b.y, BP.y - 0.4) + 1.2 + Math.sin(t * 2.7 + 1) * 0.09, b.z), 0.1);
  };
  add(3, {
    name: 'glass',
    m: 'sneak',
    hit: 0.5,
    hud: true,
    hour: 0.64,
    g: 'cold',
    caps: [[0.6, 5.6, 'AND SOMEBODY <b>WATCHED HIM</b> DO IT']],
    setup: async () => {
      story(GLASS0 - 1);
      me(RIM, yawTo(RIM, BK(0, COURT.f)), -0.12);
      give('binoculars');
      give('shovel');
      await run(8, () => void runnerNow(GLASS0 - 1));
      g.glass = ITEMS.binoculars.look ?? 0.2;
      const q = runner(GLASS0 - 1);
      S.aimAt(q.p.clone().setY(Math.max(q.p.y, BP.y - 0.4) + 1.2));
      await upTo(GLASS0, (t) => watch(t - GLASS0));
      if (!g.glass) say('the binoculars did not stay up');
    },
    lead: (t) => {
      runnerNow(GLASS0 + t);
      watch(t);
    },
    tick: (t) => {
      runnerNow(GLASS0 + t);
      watch(t);
    },
    after: () => hush(),
  });

  // ---- 3. through the wood: beside him, and then behind him
  // Which four seconds of the run, and from how far to which side of him: wherever no tree stands within its own
  // branches' reach of where the lens will be (the first cut of it went through a pine: a second of nothing but needles).
  const WOOD = (() => {
    const pines = trunks.filter((t) => t.kind.startsWith('pine'));
    let best = { mid: T_THERE - 8.4, off: 5, bad: [1e9, 1e9], score: 1e9 };
    for (let back = 6.4; back <= 12.01; back += 0.4) {
      for (const off of [5, 4.2, 3.4, 2.8]) {
        const bad = [0, 0];
        for (let t = T_THERE - back; t < T_THERE - back + 4.01; t += 0.1) {
          const at = runner(t).p, dir = runner(t + 0.75).p.sub(runner(t - 0.75).p).setY(0).normalize();
          [1, -1].forEach((side, k) => {
            const x = at.x + dir.z * off * side + dir.x * 2.6, z = at.z - dir.x * off * side + dir.z * 2.6;
            // (a pine's boughs reach four metres from its trunk and come down to the ground; a birch's are over a lens's head)
            if (nearCount(pines, x, z, 4.2) || nearCount(trunks, x, z, 1.8)) bad[k]++;
          });
        }
        const score = Math.min(bad[0], bad[1]) * 10 + Math.abs(off - 5) + Math.abs(back - 8.4) * 0.3;
        if (score < best.score) best = { mid: T_THERE - back, off, bad, score };
      }
    }
    return best;
  })();
  say(`the lens beside him: from ${(T_THERE - WOOD.mid).toFixed(1)} s short of the glade, ${WOOD.off} m off; moments with a tree on it, either side: ${WOOD.bad.join(' / ')} of 41`);
  const MID = WOOD.mid;
  // The lens beside him is carried by somebody running too: it follows where he is DRAWN (a body of the cast is shown a
  // tenth of a second behind where it is told to be) with a little weight of its own, keeps to the way he is going
  // as that is over a second and a half and not as it is this instant, and rides over the ground under itself.
  const rig = { at: new THREE.Vector3(), y: 0, t: -1e9, side: 1 };
  const beside = (t: number): CamPose => {
    const body = R0().rp.pos as THREE.Vector3, a = runner(t - 0.75).p, b = runner(t + 0.75).p, dir = b.sub(a).setY(0).normalize();
    const fresh = t < rig.t || t - rig.t > 0.5, dt = fresh ? 0 : t - rig.t;
    rig.t = t;
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    if (fresh) {
      rig.at.copy(body);
      // (from the side with no tree in the lens's way; or, where neither has one, the side the sun is on, so that he
      // is lit and not a shape against the sky: chosen once, as the shot opens)
      const sun = g.s.atmo.sunDir as THREE.Vector3;
      rig.side = WOOD.bad[0] !== WOOD.bad[1] ? (WOOD.bad[0] < WOOD.bad[1] ? 1 : -1) : side.x * sun.x + side.z * sun.z < 0 ? -1 : 1;
    } else rig.at.lerp(body, 1 - Math.exp(-dt / 0.14));
    const p = rig.at.clone().addScaledVector(side, WOOD.off * rig.side).addScaledVector(dir, 2.6);
    const want = Math.max(S.ground(p.x, p.z) + 1.35, rig.at.y + 1.0);
    rig.y = fresh ? want : rig.y + (want - rig.y) * (1 - Math.exp(-dt / 0.3));
    p.y = Math.max(rig.y, S.ground(p.x, p.z) + 0.7);
    return { p, l: rig.at.clone().addScaledVector(dir, 1.0).setY(rig.at.y + 1.2), fov: 42 };
  };
  add(2, {
    name: 'wood',
    m: 'sneak',
    hour: 0.65,
    g: 'warm',
    setup: async () => {
      story(MID - 1);
      rig.t = -1e9;
      await upTo(MID, (t) => { S.cam = beside(t); });
      S.cam = null;
    },
    lead: (t) => { runnerNow(MID + t); },
    bars: true,
    tick: (t) => { runnerNow(MID + t); },
    cam: (t) => hand(beside(MID + t), t, 0.9),
  });
  const FOLLOW0 = T_THERE - 3.4, BEHIND = 15;
  /** the follower's keys and eyes: he runs where the man ran, at the place on that way a few steps on from where he is himself */
  const chase = (t: number) => {
    runnerNow(FOLLOW0 + t);
    const body = R0().rp.pos as THREE.Vector3, p = g.player.pos as THREE.Vector3;
    let k = TRACK.gate, far = 1e9;
    for (let i = TRACK.gate; i < TRACK.n; i += 6) {
      const d = Math.hypot(TRACK.xs[i] - p.x, TRACK.zs[i] - p.z);
      if (d < far) {
        far = d;
        k = i;
      }
    }
    const on = Math.min(TRACK.n - 1, k + 90), there = new THREE.Vector3(TRACK.xs[on], 0, TRACK.zs[on]);
    there.y = S.ground(there.x, there.z) + 1.3;
    eyes(there.lerp(new THREE.Vector3(body.x, body.y + 1.1, body.z), 0.7), 0.12);
    key('KeyW', true);
    key('ShiftLeft', t < 3.2);
    if (t > 3.3) key('KeyC', true);
  };
  add(2, {
    name: 'follow',
    m: 'sneak',
    hud: true,
    hour: 0.65,
    g: 'warm',
    caps: [[0.5, 3.6, 'CLOSE ENOUGH TO SEE. &nbsp;FAR ENOUGH TO LIVE.']],
    after: () => hush(),
    setup: async () => {
      story(FOLLOW0 - 1);
      // (he is running when the shot opens, as the man ahead of him is: both from the frames before it)
      const from = short(toGo(FOLLOW0 - 0.4) + BEHIND);
      me(from.p, from.yaw);
      give('shovel');
      await upTo(FOLLOW0);
    },
    lead: (t) => chase(t),
    tick: (t) => chase(t),
  });

  // ---- 4. the case goes under
  // what he does in the glade, by the glade's own clock (seconds): looks over his shoulder, puts the case down, digs, turns, and goes
  const DIG = { glance: 1.5, down: 1.5, put: 1.95, up: 2.45, spade: 2.5, first: 2.9, every: 1.0, strokes: Math.round(BURY.seconds), turn: 0.7 };
  const DIG_DONE = DIG.first + DIG.strokes * DIG.every, DIG_AWAY = DIG_DONE + 0.5 + DIG.turn;
  let struck = -1, casePut = false, caseUnder = false;
  const AWAY = P(STOOD.x + digRight.x * 30 - digDir.x * 8, STOOD.z + digRight.z * 30 - digDir.z * 8), AWAY_YAW = yawTo(STOOD, AWAY);
  const burying = (u: number, dt = 1 / 60) => {
    const a = R0();
    a.sprint = a.aim = false;
    if (u < DIG_AWAY) a.pos.copy(STOOD);
    // (a look over his shoulder and back, not a turn on the spot; and when he goes, he comes round to it before he steps off)
    if (u < DIG.glance) a.yaw = DIG_YAW + 1.05 * Math.sin(Math.PI * ease(u / DIG.glance));
    else if (u < DIG_DONE + 0.5) a.yaw = DIG_YAW;
    else if (u < DIG_AWAY) a.yaw = DIG_YAW + wrap(AWAY_YAW - DIG_YAW) * ease((u - DIG_DONE - 0.5) / DIG.turn);
    a.pitch = u >= DIG.down && u < DIG_DONE + 0.4 ? -0.5 : 0;
    a.crouch = u >= DIG.down && u < DIG.up;
    if (u >= DIG.put && !casePut) {
      casePut = true;
      layCase();
      audio.land('dirt', 2.2);
    }
    if (u >= DIG.spade && a.weapon !== 'shovel' && u < DIG_DONE + 0.4) {
      a.weapon = 'shovel';
      a.rp.setWeapon('shovel', []);
      audio.equip('melee');
    }
    // (a stroke of the spade a second, as the game gives whoever digs; each is heard going in, and coming out with what it lifted)
    const n = Math.floor((u - DIG.first) / DIG.every);
    if (u >= DIG.first && n < DIG.strokes && n > struck) {
      struck = n;
      a.rp.swing();
    }
    if (struck >= 0 && u < DIG_DONE + 0.2) {
      const k = (u - DIG.first - struck * DIG.every) / DIG.every;
      if (k >= 0.3 && k < 0.3 + dt / DIG.every) audio.land('dirt', 3.2);
      if (k >= 0.7 && k < 0.7 + dt / DIG.every) audio.footstep('gravel', 1.4);
    }
    if (u >= DIG_DONE && !caseUnder) {
      caseUnder = true;
      void buryCase();
      audio.land('dirt', 2.6);
    }
    if (u >= DIG_DONE + 0.4 && a.weapon !== 'ak') {
      a.weapon = 'ak';
      a.rp.setWeapon('ak', ['red_dot']);
    }
    if (u >= DIG_AWAY) {
      a.go(AWAY.x, AWAY.z, 1.9, dt, false);
      a.yaw = AWAY_YAW;
    }
  };
  const fromHide = (u: number): CamPose => ({ p: HIDE.clone().setY(HIDE.y + 1.08), l: STOOD.clone().lerp(CASE, 0.5).setY(STOOD.y + lerp(1.15, 0.8, ease(u / 4))), fov: 10.5 });
  const bySpade = (u: number): CamPose => {
    const k = ease((u - 4) / 6), p = CASE.clone().addScaledVector(digRight, lerp(3.0, 2.5, k)).addScaledVector(digDir, lerp(2.4, 2.0, k));
    p.y = S.ground(p.x, p.z) + lerp(0.95, 0.8, k);
    return { p, l: STOOD.clone().lerp(CASE, 0.6).setY(STOOD.y + lerp(0.95, 0.7, k)), fov: 44 };
  };
  const dug = spec('NEW &nbsp;·&nbsp; STASHES', 'BURY IT', [
    ['WHAT', 'A CASE, A SUITCASE OR A BAG'],
    ['HOW', `${BURY.seconds} SECONDS WITH A SHOVEL`],
    ['WHERE', 'OUT IN THE COUNTRY, AWAY FROM WALLS'],
    ['KEPT', 'THROUGH EVERY RESTART OF THE SERVER'],
  ]);
  add(2, {
    name: 'bury-far',
    m: 'sneak',
    hour: 0.66,
    g: 'warm',
    caps: [[0.5, 3.6, 'HE THINKS HE IS <b>ALONE</b>']],
    setup: async () => {
      // (he comes into the glade in the frames before the shot, and has just stopped as it opens)
      story(T_THERE - 1.4);
      struck = -1;
      casePut = caseUnder = false;
      await upTo(T_THERE - 0.4);
    },
    lead: (t) => { runnerNow(T_THERE + t); },
    bars: true,
    tick: (t, _s, dt) => burying(t, dt),
    cam: (t) => hand(fromHide(Math.max(0, t)), t, 0.9),
  });
  add(3, {
    name: 'bury-near',
    m: 'dig',
    under: true,
    chain: true,
    hour: 0.66,
    g: 'warm',
    bars: true,
    tick: (t, _s, dt) => burying(4 + t, dt),
    cam: (t) => hand(bySpade(4 + t), t, 0.6),
    after: (t) => { if (t > 0.5) show(dug, t - 0.5, Math.min(ease((t - 0.5) / 0.25), ease((bars(3) - t) / 0.2))); },
  });

  // ---- 5. he goes, and never looks back
  const overShoulder = (t: number): CamPose => {
    const to = CASE.clone().sub(HIDE).setY(0).normalize(), right = new THREE.Vector3(-to.z, 0, to.x);
    return { p: HIDE.clone().addScaledVector(to, -1.5 - t * 0.05).addScaledVector(right, 0.5).setY(HIDE.y + 1.28), l: CASE.clone().setY(CASE.y + 0.5), fov: 30 };
  };
  const going = (dt: number) => {
    const a = R0();
    a.go(AWAY.x, AWAY.z, 1.9, dt, false);
    a.yaw = AWAY_YAW;
  };
  add(2, {
    name: 'gone',
    m: 'sneak',
    hour: 0.67,
    g: 'warm',
    caps: [[0.4, 3.6, 'HE NEVER LOOKED BACK']],
    setup: async () => {
      story(T_THERE + 1);
      await buryCase();
      struck = DIG.strokes;
      casePut = caseUnder = true;
      const a = R0();
      a.pos.copy(STOOD);
      a.yaw = AWAY_YAW;
      a.aim = false;
      me(HIDE, yawTo(HIDE, CASE), -0.05);
      give('shovel');
      g.takeUp(g.inv.find((i: ItemInstance) => i.id === 'shovel'));
      g.player.setCrouch(true);
      S.cam = overShoulder(0);
      await run(40, () => going(1 / 60));
      S.cam = null;
    },
    lead: () => going(1 / 60),
    bars: true,
    tick: (_t, _s, dt) => going(dt),
    cam: (t) => hand(overShoulder(t), t, 0.8),
  });

  // ---- 6. and it comes up again
  const FROM = CASE.clone().add(HIDE.clone().sub(CASE).setY(0).normalize().multiplyScalar(3.5));
  let began = false;
  add(4, {
    name: 'dig-up',
    m: 'dig',
    under: true,
    hud: true,
    hour: 0.67,
    g: 'warm',
    caps: [[2.0, 6.4, 'WHAT ONE SHOVEL BURIES, <b>ANOTHER DIGS UP</b>']],
    setup: async () => {
      reset();
      await buryCase();
      began = false;
      me(P(FROM.x, FROM.z), yawTo(FROM, CASE), -0.3);
      const spade = give('shovel');
      g.takeUp(spade);
      await run(50);
      if (g.weapons.equippedItem?.id !== 'shovel') say(`dig-up: the shovel is not in the hands (${g.weapons.equippedItem?.id ?? 'nothing is'})`);
    },
    tick: (t) => {
      key('KeyW', t > 0.15 && t < 0.62);
      eyes(CASE.clone().setY(CASE.y + 0.12), 0.14);
      if (t > 1.2 && t < 7.0) {
        key('Mouse0', true);
        if (!began && t > 1.35) {
          began = true;
          // (the left button, held over what is buried: the game begins it; if the eye was not on the place, it is begun for it)
          if (!g.use && under) {
            say('dig-up: the game did not begin the digging by the button: begun for it');
            g.dig(under);
          }
        }
      } else key('Mouse0', false);
    },
  });

  // ---- 7. what was in it
  let opened9 = false, taken = false, shown = false;
  add(3, {
    name: 'loot',
    m: 'loot',
    lift: 1,
    chain: true,
    hud: true,
    hour: 0.67,
    g: 'warm',
    setup: () => {
      opened9 = taken = shown = false;
    },
    tick: (t) => {
      const l = ([...g.economy.loot.values()] as Any[]).find((q) => q.item?.id === 'stash_kit' && Math.hypot(q.x - CASE.x, q.z - CASE.z) < 4);
      if (l && !taken) eyes(new THREE.Vector3(l.x, l.y + 0.15, l.z), 0.2);
      if (t > 0.5 && !taken) {
        taken = true;
        if (!l) return void say('loot: no case came up out of the ground');
        // (taken up, as F takes anything: into the pack, with everything that is in it)
        const it = g.economy.take(l.uid)?.item as ItemInstance | undefined;
        if (it && g.inv.add(it)) say('loot: no room in the pack for the case');
        audio.ui('pickup');
        g.inventoryChanged();
      }
      if (t > 1.1 && !opened9) {
        opened9 = true;
        g.toggleInventory(true);
      }
      if (t > 1.9 && !shown) {
        shown = true;
        const it = g.inv.find((i: ItemInstance) => i.id === 'stash_kit');
        if (!it) return void say('loot: the case is not in the pack');
        g.invUI.opened.add(it.uid);
        g.invUI.render();
        audio.ui('move');
      }
      if (shown) {
        const col = document.querySelector<HTMLElement>('.inv-cargo');
        if (col) col.scrollTop += (col.scrollHeight - col.clientHeight - col.scrollTop) * 0.1;
      }
    },
    caps: [[2.4, 5.8, 'EVERYTHING HE CARRIED OUT. &nbsp;<b>YOURS NOW.</b>']],
  });

  // ---- 8. finders keepers
  const round = (t: number): CamPose => {
    const a = DIG_YAW + 2.5 + t * 0.34, r = lerp(4.8, 3.8, ease(t / bars(3)));
    const p = g.player.pos as THREE.Vector3, c = new THREE.Vector3(p.x + Math.sin(a) * r, 0, p.z + Math.cos(a) * r);
    // (over the grass where the lens is, which is taller than a lens held at the chest)
    c.y = Math.max(S.ground(c.x, c.z) + 1.75, p.y + 1.5);
    return { p: c, l: new THREE.Vector3(p.x, p.y + 1.0, p.z), fov: 42 };
  };
  add(3, {
    name: 'dance',
    m: 'groove',
    hit: 0.9,
    hour: 0.69,
    g: 'gold',
    flash: 0.5,
    titles: [{ at: 0.35, until: 3.4, text: 'FINDERS KEEPERS', cls: 'gold' }],
    caps: [[3.7, 5.8, 'A SHOVEL IS ALL IT TAKES &nbsp;·&nbsp; ANYBODY&rsquo;S']],
    setup: async () => {
      reset();
      const spot = P(CASE.x - digDir.x * 0.2 + digRight.x * 1.3, CASE.z - digDir.z * 0.2 + digRight.z * 1.3);
      me(spot, DIG_YAW + 2.4, 0, false, ['camping_pack', 'helmet_k63', 'armor_vest']);
      give('ak', { mag: 'drum_ak', loaded: 76, mods: ['red_dot', 'suppressor_739'] });
      g.inventoryChanged();
      // (the case he emptied, lying where it came up)
      const l = g.economy.drop(makeItem('stash_kit', 1), CASE.x, CASE.y + 0.02, CASE.z, DIG_YAW + 0.5);
      laid.push(l.uid);
      S.cam = round(0);
      await run(30);
      g.emote('dance');
      await run(50);
      S.cam = null;
      if (g.hold !== 'dance') say(`dance: the player is not dancing (${g.hold ?? 'nothing held'})`);
    },
    bars: true,
    cam: (t) => hand(round(t), t, 0.6),
  });

  // ============================================================ what has been added: the map
  // ---- the hospital, from its gate
  const hospSpec = spec('NEW &nbsp;·&nbsp; KAMENKA', 'THE HOSPITAL', [
    ['FLOORS', 'THREE, AND A ROOF TO WALK ON'],
    ['LONG', '46 METRES &nbsp;·&nbsp; THE BIGGEST BUILDING IN THE ZONE'],
    ['INSIDE', `${hospPlaces} PLACES THINGS ARE LEFT`],
    ['WAYS UP', 'TWO STAIRS INSIDE, STEEL STAIRS OUTSIDE AT BOTH ENDS'],
  ]);
  const drive = [at(hosp, 0.4, 43, 1.7), at(hosp, 0.1, 37, 2.0), at(hosp, -0.6, 30, 2.8), at(hosp, -1.6, 24, 3.6)];
  add(2, {
    name: 'hospital',
    m: 'tour',
    hit: 1,
    hour: 0.2,
    flash: 0.5,
    grid: 0.35,
    chip: ['01', 'THE HOSPITAL'],
    word: ['BIGGER', 'THE MAP, SINCE THE LAST FILM'],
    setup: async () => {
      reset();
      S.cam = glide(drive, 0, at(hosp, 0, 8, 5), 40);
      await run(30);
      S.cam = null;
    },
    cam: (t) => hand(glide(drive, t / bars(2), at(hosp, 0, 8, lerp(4.2, 5.6, t / bars(2))), 40), t, 0.5),
    after: (t) => show(hospSpec, t, ease((t - WORD) / 0.25)),
  });
  // ---- floor by floor: each seen from a lens carried through it at a walk
  const FLOORS: { name: string; line: string; pts: THREE.Vector3[]; to: THREE.Vector3 | null; fov: number; len: number; open: THREE.Vector3 }[] = [
    { name: 'ward', line: 'FIRST FLOOR &nbsp;·&nbsp; THE WARDS', pts: [at(hosp, -19.2, 0.1, FLOOR1 + 1.5), at(hosp, -15, 0.3, FLOOR1 + 1.5), at(hosp, -11.2, 0.1, FLOOR1 + 1.55)], to: null, fov: 52, len: 2, open: at(hosp, -12, 0, FLOOR1) },
    { name: 'morgue', line: 'GROUND FLOOR &nbsp;·&nbsp; THE MORGUE', pts: [at(hosp, 2.1, -2.5, 1.55), at(hosp, 0.9, -3.3, 1.5), at(hosp, -0.3, -4.3, 1.45)], to: at(hosp, -7.6, -5.2, 0.9), fov: 50, len: 2, open: at(hosp, -2, -3, 0) },
  ];
  const floorTag = G('x9-floor', '<span></span>');
  for (const f of FLOORS) {
    add(f.len, {
      name: f.name,
      m: 'tour',
      hour: 0.2,
      grid: 0.35,
      chip: ['01', 'THE HOSPITAL'],
      setup: async () => {
        reset();
        openAll(f.open, 26);
        S.cam = glide(f.pts, 0, f.to, f.fov);
        await run(30);
        S.cam = null;
      },
      cam: (t) => hand(glide(f.pts, t / bars(f.len), f.to, f.fov), t, 0.45),
      after: (t) => {
        floorTag.querySelector('span')!.innerHTML = f.line;
        show(floorTag, t, Math.min(ease(t / 0.25), ease((bars(f.len) - t) / 0.2)));
      },
    });
  }
  // ---- the roof, and who is on it
  const NEST = at(hosp, -3.5, 6.2, ROOF), roofWalk = [at(hosp, -17.5, -0.4, ROOF + 1.6), at(hosp, -12, 2.2, ROOF + 1.65), at(hosp, -7.6, 3.6, ROOF + 2.1)];
  add(2, {
    name: 'roof',
    m: 'tour',
    hour: 0.24,
    grid: 0.35,
    chip: ['01', 'THE HOSPITAL'],
    setup: async () => {
      reset();
      const out = at(hosp, -3.5, 40, 0);
      stand(A(1), NEST, yawTo(NEST, out), 'mosin', ['boonie_hat'], ['pu_scope']);
      A(1).more = F_PRONE;
      A(1).aim = true;
      const by = at(hosp, -1.3, 5.6, ROOF);
      stand(A(2), by, yawTo(by, out) + 0.3, 'ak', ['helmet_k63', 'armor_vest']);
      A(2).crouch = true;
      S.cam = glide(roofWalk, 0, NEST.clone().setY(NEST.y + 0.5), 46);
      await run(40);
      S.cam = null;
    },
    cam: (t) => hand(glide(roofWalk, t / bars(2), NEST.clone().setY(NEST.y + 0.5), 46), t, 0.5),
    after: (t) => {
      floorTag.querySelector('span')!.innerHTML = 'THE ROOF &nbsp;·&nbsp; A RIFLE IS KEPT UP HERE';
      show(floorTag, t, Math.min(ease(t / 0.25), ease((bars(2) - t) / 0.2)));
    },
  });
  // ---- four levels to fight over
  const levels = spec('ONE BUILDING', 'FOUR LEVELS', [
    ['THE ROOF', '9.8 M UP'],
    ['THE BALCONY', 'OVER THE DOORS'],
    ['THE STEEL STAIRS', 'A DOOR ONTO THEM FROM EVERY FLOOR'],
    ['THE GROUND', 'WHERE YOU ARE SEEN FROM ALL OF THEM'],
  ]);
  // (from off its west end, where the steel stair is, with the front running away to the right: from the street its birches stand before it)
  const frontCam = (k: number): CamPose => ({ p: at(hosp, lerp(-39, -36, k), lerp(11.5, 10, k), lerp(6, 7.2, k)), l: at(hosp, -12, 4.5, 4.8), fov: 42 });
  add(2, {
    name: 'levels',
    m: 'board',
    hit: 0.6,
    hour: 0.24,
    flash: 0.25,
    grid: 0.35,
    chip: ['01', 'THE HOSPITAL'],
    setup: async () => {
      reset();
      const down = at(hosp, -25.5, 13, 0), up = at(hosp, -19.5, 7.1, ROOF), bal = at(hosp, -5.4, 10.9, BALCONY), land = at(hosp, -24.2, 0.3, FLOOR1 + 3.2), yard = at(hosp, -11, 15, 0);
      stand(A(0), down, yawTo(down, up), 'ak', ['helmet_k63', 'armor_vest'], ['red_dot']);
      stand(A(1), up, yawTo(up, down), 'mosin', ['boonie_hat'], ['pu_scope']);
      stand(A(2), bal, yawTo(bal, yard), 'mpa', ['patrol_cap', 'soft_vest']);
      stand(A(3), land, yawTo(land, yard), 'ar15', ['helmet_k63']);
      stand(A(4), yard, yawTo(yard, bal), 'm9', ['sack_pack']);
      A(0).crouch = A(4).crouch = true;
      A(0).foe = A(1);
      A(1).foe = A(0);
      A(2).foe = A(4);
      A(4).foe = A(2);
      for (const a of S.actors) {
        a.skill = 0.05;
        a.nextShot = 0.4 + S.rnd() * 0.8;
        a.hp = 1e9;
      }
      // (the fight is the film's to end: nobody in it is hit while it is looked at)
      S.cam = frontCam(0);
      await run(40);
      S.cam = null;
    },
    tick: (t) => {
      for (const a of S.actors) {
        const y = a.pos.y;
        a.think(t);
        a.pos.y = y;
      }
    },
    cam: (t) => hand(frontCam(t / bars(2)), t, 0.7),
    after: (t) => show(levels, t, ease(t / 0.25)),
  });

  // ---- the police headquarters, round its yard
  const hqSpec = spec('NEW &nbsp;·&nbsp; ZELENAYA DOLINA', 'POLICE HQ', [
    ['BUILT', 'IN THREE PARTS ROUND A YARD'],
    ['INSIDE', 'CELLS &nbsp;·&nbsp; AN ARMOURY &nbsp;·&nbsp; A GARAGE'],
    ['ROOFS', 'THREE, AND A STAIR TO EACH'],
    ['LOCKERS', 'STEEL ONES, TO BE SEARCHED'],
  ]);
  /** somebody walks in at the gate with three roofs looking down at them */
  const hqWalk = (dt: number) => {
    const yard = at(hq, 0.5, 14, 0);
    A(4).go(yard.x, yard.z, 1.7, dt);
    A(0).face(A(4).chest());
    A(2).face(A(4).chest());
  };
  const hqCam = (k: number): CamPose => {
    const a = lerp(-0.75, -0.1, ease(k)), r = lerp(52, 40, k);
    return { p: at(hq, Math.sin(a) * r, 8 + Math.cos(a) * r, lerp(31, 19, k)), l: at(hq, 0, 7, 3), fov: 34 };
  };
  add(3, {
    name: 'hq',
    m: 'board',
    hour: 0.52,
    flash: 0.5,
    grid: 0.35,
    chip: ['02', 'THE POLICE HEADQUARTERS'],
    setup: async () => {
      reset();
      const yard = at(hq, 0.5, 13, 0), roofA = at(hq, -6, 5.7, HQ_ROOF), roofB = at(hq, 8, 4.5, HQ_ROOF), terrace = at(hq, 9.8, 11, HQ_TERRACE), gate = at(hq, -1.2, 24, 0);
      stand(A(0), roofA, yawTo(roofA, gate), 'mosin', ['patrol_cap'], ['pu_scope']);
      stand(A(1), roofB, yawTo(roofB, gate), 'ak', ['helmet_k63', 'armor_vest']);
      stand(A(2), terrace, yawTo(terrace, yard), 'mpa', ['patrol_cap', 'soft_vest']);
      stand(A(3), yard, yawTo(yard, gate), 'ar15', ['helmet_k63', 'armor_vest']);
      stand(A(4), gate, yawTo(gate, yard), 'm9', ['sack_pack']);
      A(0).aim = A(2).aim = true;
      S.cam = hqCam(0);
      await run(40);
      S.cam = null;
    },
    lead: () => hqWalk(1 / 60),
    tick: (_t, _s, dt) => hqWalk(dt),
    cam: (t) => hand(hqCam(t / bars(3)), t, 0.5),
    after: (t) => show(hqSpec, t, ease(t / 0.25)),
  });

  // ---- under the stairs
  const two = (() => {
    const all = builds.filter((b) => b.type === 'house_two');
    if (!all.length) throw new Error('the map has no house of two floors');
    return all.sort((p, q) => Math.hypot(p.x - village.x, p.z - village.z) - Math.hypot(q.x - village.x, q.z - village.z))[0];
  })();
  const NOOK = at(two, 3.78, -2.68), NOOK_DOOR = at(two, 3.2, -2.75, 1.0), HALL = at(two, 0.2, -2.25), HALL0 = at(two, 0.1, 4.6), HALL1 = at(two, 0.2, 0.6), HEATER = at(two, -3, -2.5);
  const nookSpec = spec('IN EVERY HOUSE OF TWO FLOORS', 'UNDER THE STAIRS', [
    ['A CUPBOARD', 'WITH A DOOR THAT SHUTS'],
    ['ROOM FOR', 'ONE'],
    ['WHOEVER COMES IN', 'WALKS PAST IT'],
  ]);
  // (from the hall's back corner: the door he comes in by before the lens, the stair to its right, and the cupboard's door at the edge)
  const hallCam = (t: number): CamPose => ({ p: at(two, -0.5, -2.95, 2.3 - t * 0.04), l: at(two, 2.3, 0.3, 1.0), fov: 68 });
  const hunterIn = (t: number) => {
    // (in at the front door and down the hall, at a walk: he has heard something)
    const a = A(3), v = 2.0, d0 = HALL0.distanceTo(HALL1), d1 = HALL1.distanceTo(HALL), s = t * v;
    // (before the shot he is on his way to the door from outside it)
    const p = s < 0 ? HALL0.clone().lerp(HALL1, s / d0) : s < d0 ? HALL0.clone().lerp(HALL1, s / d0) : HALL1.clone().lerp(HALL, Math.min(1, (s - d0) / d1));
    a.pos.set(p.x, two.floorY, p.z);
    a.yaw = s < d0 + d1 ? yawTo(HALL0, HALL) : yawTo(HALL, HEATER);
    a.sprint = false;
    a.aim = true;
    return s >= d0 + d1;
  };
  add(1, {
    name: 'hall',
    m: 'tight',
    hit: 0.6,
    hour: 0.5,
    g: 'cold',
    flash: 0.4,
    grid: 0.25,
    chip: ['03', 'UNDER THE STAIRS'],
    setup: async () => {
      reset();
      doorNear(at(two, 0, 3.5, 1.0))?.setOpen(true);
      doorNear(NOOK_DOOR)?.setOpen(false);
      stand(A(3), HALL0, yawTo(HALL0, HALL), 'ak', ['helmet_k63', 'armor_vest']);
      S.cam = hallCam(0);
      await run(36, (k) => void hunterIn(-1 + k / 60));
      S.cam = null;
    },
    lead: (t) => { hunterIn(t); },
    tick: (t) => { hunterIn(t); },
    cam: (t) => hand(hallCam(t), t, 0.5),
  });
  let fired = false, nookOpen = false;
  add(2, {
    name: 'nook',
    m: 'tight',
    under: true,
    hud: true,
    hour: 0.5,
    g: 'cold',
    grid: 0.25,
    chip: ['03', 'UNDER THE STAIRS'],
    setup: async () => {
      reset();
      fired = nookOpen = false;
      doorNear(at(two, 0, 3.5, 1.0))?.setOpen(true);
      const door = doorNear(NOOK_DOOR);
      if (!door) say('nook: no door on the cupboard under the stairs was found');
      door?.setOpen(false);
      stand(A(3), HALL1, yawTo(HALL0, HALL), 'ak', ['helmet_k63', 'armor_vest']);
      me(new THREE.Vector3(NOOK.x, two.floorY, NOOK.z), yawTo(NOOK, NOOK_DOOR), 0, true);
      g.takeUp(give('benelli', { loaded: ITEMS.benelli.weapon?.capacity ?? 6 }));
      await run(50, (k) => void hunterIn(2 - 0.4 - (50 - k) / 60));
    },
    lead: (t) => { hunterIn(2 + t); },
    tick: (t) => {
      const a = A(3), there = hunterIn(2 + t);
      if (!a.alive) return;
      if (t > 1.0 && !nookOpen) {
        nookOpen = true;
        // (F on the door from inside, as anybody opens one: it swings away from whoever opens it)
        const door = doorNear(NOOK_DOOR);
        if (door && !door.open) {
          door.toggle(g.player.pos);
        }
      }
      // (he has heard the door, and begins to turn; he does not finish)
      if (there && t > 1.3) a.yaw = yawTo(HALL, HEATER) + ease((t - 1.3) / 0.9) * wrap(yawTo(HALL, NOOK) - yawTo(HALL, HEATER));
      if (t > 1.12) eyes(a.chest(), 0.22);
      key('KeyW', t > 1.2 && t < 1.42);
      if (t > 1.8 && !fired) {
        fired = true;
        S.tap('Mouse0', 90);
      }
      if (t > 1.92 && fired && a.alive) {
        a.die(a.pos.clone().sub(g.player.pos).setY(0).normalize());
        S.feedKill('You', a.name, ITEMS.benelli.name, a.pos.distanceTo(g.player.pos));
      }
    },
    after: (t) => { if (t > 2.3) show(nookSpec, t - 2.3, ease((t - 2.3) / 0.25)); },
  });

  // ---- the village's streets
  const villSpec = spec('ZELENAYA DOLINA', 'STREETS', [
    ['MORE', 'THIRTEEN BUILDINGS, AND A BLOCK OF FLATS'],
    ['LAID OUT', 'ON CROSS STREETS AND A BACK LANE'],
    ['BEHIND EVERY HOUSE', 'A FENCED YARD YOU CAN JUMP INTO'],
  ]);
  const villCam = (k: number): CamPose => {
    const a = lerp(2.3, 2.8, k);
    return { p: P(village.x + Math.sin(a) * 92, village.z + Math.cos(a) * 92, lerp(54, 46, k)), l: P(village.x, village.z, 3), fov: 38 };
  };
  add(2, {
    name: 'village',
    m: 'board',
    hour: 0.56,
    g: 'warm',
    flash: 0.5,
    grid: 0.35,
    chip: ['04', 'THE VILLAGE'],
    setup: async () => {
      reset();
      S.cam = villCam(0);
      await run(30);
      S.cam = null;
    },
    cam: (t) => hand(villCam(t / bars(2)), t, 0.4),
    after: (t) => show(villSpec, t, ease(t / 0.25)),
  });

  // ============================================================ what has been added: in the hands
  // ---- a steel cabinet, searched
  const cabinets = (g.loot.crates as Any[]).filter((c) => c.kind === 'med_cabinet');
  const cabinet = cabinets.filter((c) => Math.hypot(c.x - hosp.x, c.z - hosp.z) < 30 && Math.abs(c.y - hosp.floorY) < 1).sort((p, q) => Math.hypot(p.x - hosp.x, p.z - hosp.z) - Math.hypot(q.x - hosp.x, q.z - hosp.z))[0] ?? cabinets[0];
  say(`${cabinets.length} steel cabinets on the map (${[...new Set((g.loot.crates as Any[]).map((c) => c.kind))].join(' ')})`);
  const cabSpec = spec('NEW &nbsp;·&nbsp; SEARCH THEM', 'STEEL CABINETS', [
    ['ON THE MAP', `${cabinets.length}`],
    ['THE HOSPITAL', 'KEEPS FOUR TIMES THE MEDICINE IT DID'],
    ['THE POLICE', 'A THIRD MORE KIT IN THEIR LOCKERS'],
  ]);
  let searched = false;
  add(2, {
    name: 'cabinet',
    m: 'tour',
    hit: 0.6,
    hud: true,
    hour: 0.3,
    flash: 0.5,
    chip: ['05', 'CABINETS AND LOCKERS'],
    word: ['SEARCH', 'WHAT IS NEW TO THE HANDS'],
    setup: async () => {
      reset();
      searched = false;
      if (!cabinet) return void say('cabinet: there is no steel cabinet to search');
      const c = cabinet, front = new THREE.Vector3(Math.sin(c.rot), 0, Math.cos(c.rot));
      // (it is stood off from, on whichever side of it is open floor)
      let from = new THREE.Vector3(c.x + front.x * 1.5, c.y, c.z + front.z * 1.5);
      if (!S.clearLine(from.clone().setY(c.y + 1.5), new THREE.Vector3(c.x + front.x * 0.5, c.y + 1.2, c.z + front.z * 0.5))) from = new THREE.Vector3(c.x - front.x * 1.5, c.y, c.z - front.z * 1.5);
      c.container.load({ items: [] });
      for (const id of ['firstaid', 'bandage', 'stim', 'splint', 'bandage', 'stim', 'firstaid']) c.container.add(makeItem(id));
      c.known = true;
      me(from, yawTo(from, new THREE.Vector3(c.x, 0, c.z)), -0.08, true);
      await run(20);
    },
    tick: (t) => {
      if (!cabinet) return;
      eyes(new THREE.Vector3(cabinet.x, cabinet.y + 1.15, cabinet.z), 0.2);
      key('KeyW', t > 0.45 && t < 0.62);
      if (t > 1.1 && !searched) {
        searched = true;
        S.tap('KeyF');
      }
    },
    after: (t) => {
      if (t > 1.5 && t < 1.6 && !g.invUI.isOpen) say('cabinet: F did not open it');
      // (its figures while it is walked up to; then what is in it has the picture, and a line at the foot says the rest)
      if (t < 1.35) show(cabSpec, t, Math.min(ease((t - WORD) / 0.25), ease((1.35 - t) / 0.2)));
      else {
        cabSpec.style.display = 'none';
        floorTag.querySelector('span')!.innerHTML = `${cabinets.length} STEEL CABINETS &nbsp;·&nbsp; THE HOSPITAL KEEPS FOUR TIMES THE MEDICINE`;
        show(floorTag, t, ease((t - 1.5) / 0.25));
      }
    },
  });

  // ---- a light on every gun, in the ward after dark
  const lightSpec = spec('PRESS &nbsp;L', 'A LIGHT ON EVERY GUN', [
    ['FITS', 'THE AK, THE AR-15, THE SUBMACHINE GUN, THE PISTOLS'],
    ['AND', 'IT GIVES YOU AWAY AS FAR AS IT REACHES'],
  ]);
  const WARD0 = at(hosp, -19, 1.7, FLOOR1), WARD1 = at(hosp, -8, 1.7, FLOOR1);
  const wardDir = WARD1.clone().sub(WARD0).setY(0).normalize(), wardSide = new THREE.Vector3(wardDir.z, 0, -wardDir.x);
  /** the lamp carried down the ward at a walk that does not stop, and swept from the beds on one side to the beds on the other */
  const creep = (t: number) => {
    key('AltLeft', true);
    key('KeyW', true);
    const p = g.player.pos as THREE.Vector3, sway = Math.sin(t * 1.2) * 3.1;
    eyes(new THREE.Vector3(p.x + wardDir.x * 7 + wardSide.x * sway, hosp.floorY + FLOOR1 + 0.95, p.z + wardDir.z * 7 + wardSide.z * sway), 0.08);
  };
  add(2, {
    name: 'light',
    m: 'dread',
    hud: true,
    hour: 0.92,
    flash: 0.3,
    chip: ['06', 'AFTER DARK'],
    setup: async () => {
      reset();
      openAll(at(hosp, -12, 0, FLOOR1), 26);
      me(WARD0, yawTo(WARD0, WARD1), -0.03, true);
      g.takeUp(give('ak', { mag: 'mag_ak', loaded: 31, mods: ['gun_light', 'red_dot'] }));
      await run(55);
      if (!g.lit) S.tap('KeyL');
      await run(12);
      if (!g.lit) say('light: the light is not lit');
    },
    lead: (t) => creep(t),
    tick: (t) => creep(t),
    after: (t) => show(lightSpec, t, ease(t / 0.25)),
  });

  // ---- the bot check, shot
  // (of three hundred ranges, the one the film's own player is through soonest: see assets-src/_wf/me/range9.ts)
  const SEED = 9240;
  const botSpec = (() => {
    const sp = rangeOf(SEED);
    return spec('NEW &nbsp;·&nbsp; AT THE DOOR', 'THE BOT CHECK', [
      ['WHO', 'EVERYBODY, BEFORE THEY ARE LET IN'],
      ['WHAT', `${sp.need} FIGURES BEHIND WALLS &nbsp;·&nbsp; ${sp.secs} SECONDS`],
      ['JUDGED', 'BY THE SERVER, SHOT BY SHOT'],
      ['THE RANGE', 'A DIFFERENT ONE EVERY TIME'],
    ]);
  })();
  let aimFor = 0, target = -1, post: { x: number; z: number } | null = null, trigger = 0, blind = 0;
  add(4, {
    name: 'range',
    m: 'tight',
    hit: 0.8,
    under: true,
    hud: true,
    hour: 0.42,
    flash: 0.6,
    chip: ['07', 'THE BOT CHECK'],
    word: ['NO BOTS', 'EVERYBODY SHOOTS THEIR WAY IN'],
    setup: async () => {
      reset();
      aimFor = 0;
      target = -1;
      post = null;
      trigger = 0;
      const sp = rangeOf(SEED), judge = new RangeJudge(sp);
      let top = 0;
      for (let i = 0; i < world.heights.length; i += 7) top = Math.max(top, world.heights[i]);
      const floor = Math.round(top + 140);
      me(P(-380, -380), 0);
      g.takeUp(give('ar15', { mag: 'mag_ar', loaded: 31, mods: ['red_dot'] }));
      g.player.god = true;
      const bc: Any = new BotCheck({
        scene,
        atmo: g.s.atmo,
        camera,
        floor,
        place: (x, y, z) => g.player.spawn(x, y, z, 0),
        where: () => g.player.pos,
        // (what the game would tell a server, told to the server's own judge, here: a figure is down when the judge says so)
        send: (m: Any) => {
          if (m.t === 'r') judge.seen(m.n, m.p[0], m.p[1], m.p[2], m.p[3], m.n + 30);
          else if (m.t === 'rs') {
            const i = judge.shot(m.n, m.o, m.d, m.n + 35);
            if (i >= 0) {
              bc.hit(i);
              say(`range: figure ${i} down at ${(m.n / 1000).toFixed(2)} s (${judge.down.size} of ${sp.need})`);
            }
            // (all of them down, by somebody who walked and looked: the server would say so, and let them in)
            if (judge.passed) bc.passed();
            else if (judge.why) say(`range: a shot was not counted: ${judge.why}`);
          }
        },
        ready: (o) => g.s.r.ready(o),
        playing: () => true,
      });
      range = { bc, judge, spec: sp, floor };
      g.botCheck = bc;
      void bc.deal(SEED, sp.turn, 1);
      for (let k = 0; k < 400 && !bc.begun; k++) {
        await run(6);
        await wait(40);
      }
      if (!bc.begun) say('range: the range never stood');
      await run(30);
    },
    tick: (_t, _s, dt) => {
      if (!range) return;
      const { bc, spec: sp, floor } = range, ms = bc.ms as number, p = g.player.pos as THREE.Vector3;
      const down = new Set<number>(bc.fell as Set<number>);
      // (a figure that has walked behind a wall is given up for another, as anybody gives it up)
      if (target >= 0 && post && Math.hypot((post as { x: number; z: number }).x - p.x, (post as { x: number; z: number }).z - p.z) < 0.4) blind = clearShot(sp, target, p.x, p.z, ms, down) ? 0 : blind + dt;
      if (target < 0 || down.has(target) || blind > 0.6) {
        target = -1;
        post = null;
        blind = 0;
        let far = 1e9;
        // whoever can be had from where the player stands, now and for a moment yet; or else the nearest place a figure still standing can be had from, a little while from now
        sp.figures.forEach((_f, i) => {
          if (target < 0 && !down.has(i) && clearShot(sp, i, p.x, p.z, ms, down) && clearShot(sp, i, p.x, p.z, ms + 350, down)) {
            target = i;
            post = { x: p.x, z: p.z };
            far = 0;
          }
        });
        sp.figures.forEach((_f, i) => {
          if (down.has(i)) return;
          for (let x = -STRIP.half + 1; x <= STRIP.half - 1; x++) {
            for (const z of [1.5, 3, 4.5]) {
              const d = Math.hypot(x - p.x, z - p.z), then = ms + (d / 4) * 1000 + 500;
              if (d < far && clearShot(sp, i, x, z, then, down) && clearShot(sp, i, x, z, then + 250, down)) {
                far = d;
                target = i;
                post = { x, z };
              }
            }
          }
        });
        aimFor = 0;
      }
      const stop = () => { for (const c of ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'Mouse0', 'Mouse2']) key(c, false); };
      if (target < 0 || !post) return void stop();
      const at9 = post as { x: number; z: number }, dx = at9.x - p.x, dz = at9.z - p.z, there = Math.hypot(dx, dz) < 0.4;
      // (the eyes come round a part of the way each frame: aimed at where the figure will be when they have, they are on it)
      const kk = gain(0.2, dt), f = figureAt(sp.figures[target], ms + ((1 - kk) / kk) * dt * 1000), to = new THREE.Vector3(f.x, floor + 1.2, f.z);
      // (keys held as a player holds them: facing down the range, so A and D are along it)
      key('KeyD', !there && dx > 0.25);
      key('KeyA', !there && dx < -0.25);
      key('KeyS', !there && dz > 0.25);
      key('KeyW', !there && dz < -0.25);
      key('Mouse2', there);
      if (there) eyes(to, 0.2);
      else eyes(new THREE.Vector3(lerp(p.x, to.x, 0.5), floor + 1.3, p.z - 14), 0.12);
      const look = new THREE.Vector3();
      camera.getWorldDirection(look);
      // (how far off it the sights are is measured to where it is, not to where the eyes are being brought)
      const is = figureAt(sp.figures[target], ms), want = new THREE.Vector3(is.x, floor + 1.2, is.z).sub(camera.position).normalize(), off = Math.acos(Math.min(1, look.dot(want)));
      aimFor = there && off < 0.014 && clearShot(sp, target, p.x, p.z, ms, down) ? aimFor + dt : 0;
      // (the sights held on it for a quarter of a second, and then the trigger: the judge asks no less)
      if (trigger > 0) {
        trigger -= dt;
        key('Mouse0', trigger > 0.2);
      } else if (aimFor > 0.2) {
        trigger = 0.3;
        key('Mouse0', true);
      }
    },
    after: (t) => show(botSpec, t, ease((t - WORD) / 0.25)),
  });

  // ============================================================ what was measured, and what has been paid
  const smooth = G('x9-board smooth', `
    <div class="b9-kick">NOTHING LOOKS DIFFERENT &nbsp;·&nbsp; IT ONLY STOPPED STOPPING</div>
    <div class="b9-head">THE LONG STOPS ARE <b>GONE</b></div>
    <div class="b9-rows">${MEASURED.map((r) => `
      <div class="b9-row">
        <div class="r9-what">${r.what}</div>
        <div class="r9-bars">
          <div class="r9-bar was"><i></i><b>${r.was.toFixed(r.d === 2 ? 1 : r.d)}</b><span>${r.unit} &nbsp;BEFORE</span></div>
          <div class="r9-bar now" style="--w:${Math.max(0.012, r.now / r.was).toFixed(3)}"><i></i><b data-n="${r.now}" data-from="${r.was}" data-d="${r.d}">${r.was}</b><span>${r.unit} &nbsp;NOW</span></div>
        </div>
      </div>`).join('')}
    </div>
    <div class="b9-foot">WHAT YOU SHOULD SEE: NO FREEZE WHEN A LAMP COMES ON OR NIGHT FALLS, RUNNERS WHO RUN, A QUICKER FIRST LOAD.<br>MEASURED ON ONE LAPTOP (RTX 3070 TI), THE SAME SCRIPTED SESSION BEFORE AND AFTER. YOURS WILL DIFFER.</div>`);
  const street = (t: number): CamPose => {
    const along = lerp(-86, -34, t / bars(4));
    return { p: K(along, 1.2, 2.3), l: K(along + 26, 0, 1.8), fov: 48 };
  };
  add(4, {
    name: 'smooth',
    m: 'board',
    hit: 0.8,
    hour: 0.74,
    flash: 0.6,
    chip: ['08', 'SMOOTHER'],
    word: ['SMOOTHER', 'MEASURED BEFORE AND AFTER'],
    setup: async () => {
      reset();
      S.cam = street(0);
      await run(40);
      S.cam = null;
    },
    cam: (t) => hand(street(t), t, 0.5),
    after: (t) => {
      show(smooth, t, ease((t - WORD) / 0.3));
      smooth.querySelectorAll<HTMLElement>('.b9-row').forEach((row, k) => {
        const u = t - 0.9 - k * 0.55, e = ease(u / 0.8), b = row.querySelector<HTMLElement>('[data-n]')!;
        row.style.setProperty('--in', ease((t - 0.5 - k * 0.2) / 0.3).toFixed(3));
        row.style.setProperty('--k', e.toFixed(3));
        b.textContent = lerp(Number(b.dataset.from), Number(b.dataset.n), e).toFixed(Number(b.dataset.d));
      });
    },
  });

  const most = Math.max(...LIVE.days.map((d) => d[1]));
  const paid = G('x9-board paid', `
    <div class="b9-kick">PLAY TO EARN &nbsp;·&nbsp; PAID BY THE MACHINE</div>
    <div class="b9-money"><b data-n="${Math.round(LIVE.paidSol * LIVE.usd)}">$0</b><span>PAID TO<br>PLAYERS</span></div>
    <div class="b9-sub">${LIVE.paidSol} SOL &nbsp;·&nbsp; AT $${LIVE.usd} A SOL &nbsp;·&nbsp; AS OF ${LIVE.on}</div>
    <div class="b9-tiles">
      <div><b>${LIVE.paidTags}</b><span>DOG TAGS PAID FOR</span></div>
      <div><b>${LIVE.wallets}</b><span>WALLETS PAID</span></div>
      <div><b>$${(LIVE.tagSol * LIVE.usd).toFixed(2)}</b><span>A TAG &nbsp;·&nbsp; ${LIVE.tagSol} SOL</span></div>
      <div><b>${money(LIVE.top)}</b><span>THE BEST-PAID WALLET SO FAR</span></div>
    </div>
    <div class="b9-graph">
      <div class="g9-name">PAID EACH DAY</div>
      <div class="g9-bars">${LIVE.days.map(([day, sol]) => `<div style="--h:${((sol / most) * 100).toFixed(1)}%"><b>${money(sol)}</b><i></i><span>${day}</span></div>`).join('')}</div>
    </div>
    <div class="b9-foot">${money(LIVE.treasury)} MORE IS IN THE TREASURY NOW, FOR THE NEXT TAGS.<br>EVERY PAYMENT IS ON THE CHAIN. &nbsp;LOOK ANY OF THEM UP: <b>ZONAPVP.FUN/PAYOUTS</b></div>`);
  const high = (t: number, len: number): CamPose => {
    const a = lerp(0.5, 0.95, t / len);
    return { p: P(village.x + Math.sin(a) * 150, village.z + Math.cos(a) * 150, 58), l: P(village.x, village.z, 6), fov: 34 };
  };
  add(5, {
    name: 'paid',
    m: 'paid',
    hit: 1,
    hour: 0.66,
    g: 'gold',
    flash: 0.7,
    chip: ['09', 'PAID'],
    word: ['PAID', 'IN SOL · TO THE PLAYERS WHO TOOK THE TAGS'],
    setup: async () => {
      reset();
      S.cam = high(0, bars(5));
      await run(30);
      S.cam = null;
    },
    cam: (t) => high(t, bars(5)),
    after: (t) => {
      show(paid, t, ease((t - WORD) / 0.3));
      const n = paid.querySelector<HTMLElement>('.b9-money b')!;
      n.textContent = `$${Math.round(Number(n.dataset.n) * ease((t - 0.6) / 1.4))}`;
      paid.querySelectorAll<HTMLElement>('.b9-tiles > div').forEach((el, k) => el.style.setProperty('--in', ease((t - 2.0 - k * 0.3) / 0.3).toFixed(3)));
      paid.querySelectorAll<HTMLElement>('.g9-bars > div').forEach((el, k) => el.style.setProperty('--k', ease((t - 3.6 - k * 0.35) / 0.6).toFixed(3)));
      paid.querySelector<HTMLElement>('.b9-graph')!.style.setProperty('--in', ease((t - 3.3) / 0.3).toFixed(3));
      paid.querySelector<HTMLElement>('.b9-foot')!.style.setProperty('--in', ease((t - 6.2) / 0.4).toFixed(3));
    },
  });

  // ---- what is next: said by whoever builds it, and not in the game yet
  const NEXT = ['THE INDUSTRIAL ZONE &nbsp;·&nbsp; FOUR TIMES KAMENKA', 'LADDERS, AND A RADIO TOWER TO SHOOT FROM', 'THE ROAD ALL THE WAY ROUND, AND A BRIDGE'];
  const next = G('x9-next', `<div class="n9-kick">NEXT &nbsp;·&nbsp; BEING BUILT &nbsp;·&nbsp; NOT IN THE GAME YET</div>${NEXT.map((l) => `<div class="n9-line">${l}</div>`).join('')}`);
  const wild = (t: number): CamPose => {
    const k = t / bars(3);
    return { p: K(lerp(150, 120, k), lerp(-60, -40, k), lerp(68, 60, k)), l: K(260, 30, 10), fov: 38 };
  };
  add(3, {
    name: 'next',
    m: 'next',
    lift: 1,
    hour: 0.14,
    g: 'cold',
    flash: 0.5,
    setup: async () => {
      reset();
      S.cam = wild(0);
      await run(30);
      S.cam = null;
    },
    cam: (t) => wild(t),
    after: (t) => {
      show(next, t);
      next.querySelectorAll<HTMLElement>('.n9-line').forEach((el, k) => el.style.setProperty('--in', ease((t - 0.7 - k * 1.5) / 0.35).toFixed(3)));
    },
  });

  // ---- the story's last word
  const FAR = short(58).p;
  add(2, {
    name: 'sting',
    m: 'sting',
    hit: 1,
    hud: true,
    hour: 0.71,
    g: 'cold',
    flash: 0.5,
    caps: [[0.5, 3.7, 'SOMEBODY IS <b>ALWAYS</b> WATCHING']],
    setup: async () => {
      reset();
      const spot = P(CASE.x - digDir.x * 0.2 + digRight.x * 1.3, CASE.z - digDir.z * 0.2 + digRight.z * 1.3);
      stand(A(5), spot, DIG_YAW + 2.4, null, ['camping_pack', 'helmet_k63', 'armor_vest']);
      A(5).dance = true;
      laid.push(g.economy.drop(makeItem('stash_kit', 1), CASE.x, CASE.y + 0.02, CASE.z, DIG_YAW + 0.5).uid);
      // (from further back along the way they all came: the nearest place to that with the glade in view)
      let from = FAR;
      for (const m of [58, 50, 44, 38, 32, 26]) {
        const p = short(m).p;
        if (S.clearLine(p.clone().setY(p.y + 1.05), spot.clone().setY(spot.y + 1.2))) {
          from = p;
          break;
        }
      }
      me(from, yawTo(from, spot), 0);
      give('binoculars');
      g.player.setCrouch(true);
      await run(24);
      g.glass = ITEMS.binoculars.look ?? 0.2;
      S.aimAt(spot.clone().setY(spot.y + 1.1));
      await run(6);
    },
    tick: (t) => {
      // (a hand that is not quite still)
      eyes(A(5).pos.clone().setY(A(5).pos.y + 1.1 + Math.sin(t * 1.7) * 0.05), 0.06);
    },
  });

  // ---- where it is played
  const end = G('x8-end', `
    <div class="k8-logo">ZONA</div>
    <div class="k8-line">PLAY FREE IN YOUR BROWSER</div>
    <div class="k8-url">WWW.ZONAPVP.FUN</div>
    <div class="k8-rows"><span>X &nbsp;@${X_HANDLE}</span><span>DISCORD &nbsp;${DISCORD.replace('https://', '')}</span></div>
    <div class="k8-ca">${CONTRACT}</div>`);
  add(3, {
    name: 'end',
    m: 'end',
    hit: 1,
    hour: 0.7,
    g: 'gold',
    flash: 0.6,
    setup: async () => {
      reset();
      S.cam = hospHigh(1);
      await run(30);
      S.cam = null;
    },
    cam: (t) => hand(hospHigh(1 - (t / bars(3)) * 0.5), t, 0.3),
    after: (t) => show(end, t),
    fadeOut: 0.5,
  });

  if (MENU) {
    // the menu's cut: those shots and no others, one after another from nothing
    const picked = MENU_SHOTS.map((name) => {
      const shot = shots.find((q) => q.name === name);
      if (!shot) throw new Error(`the menu's cut wants a shot called ${name}, and there is none`);
      return shot;
    });
    let t = 0;
    for (const shot of picked) {
      const len = shot.end - shot.start;
      shot.start = t;
      shot.end = t + len;
      shot.bars = false;
      shot.titles = [];
      t += len;
    }
    seconds9 = t;
    ROWS = Array.from({ length: Math.round(t / BAR9) }, (): Row9 => ({ kind: 'card' }));
    say(`for the menu: ${picked.length} shots, ${t.toFixed(1)} s (${picked.map((q) => `${q.name} from ${q.start}`).join(', ')})`);
    return picked;
  }

  // ------------------------------------------------------------ the score, from the shots
  if (!Number.isInteger(cur)) throw new Error(`the film is ${cur} bars long: the score wants a whole number`);
  ROWS = Array.from({ length: cur }, (_, i) => {
    const s = plan.find((q) => i >= q.at && i < q.at + q.len)!;
    // (a part of the music is every shot in a row that asks for the same kind: how far into it this bar is)
    let a = plan.indexOf(s), z = a;
    while (a > 0 && plan[a - 1].x.m === s.x.m) a--;
    while (z < plan.length - 1 && plan[z + 1].x.m === s.x.m) z++;
    const from = plan[a].at, to = plan[z].at + plan[z].len;
    return {
      kind: s.x.m,
      hit: i === s.at ? s.x.hit : undefined,
      lift: i === Math.ceil(s.at + s.len) - 1 ? s.x.lift : undefined,
      build: to - from > 1 ? (i - from) / (to - from - 1) : 0,
      under: s.x.under,
    };
  });
  seconds9 = bars(cur);
  say(`${shots.length} shots, ${cur} bars, ${seconds9.toFixed(1)} s`);
  return shots;
}
