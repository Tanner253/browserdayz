// The twelfth film: thirty seconds of what is new (2026-10-14). Asked for as "a 30 second trailer of the new additions,
// castle heli etc..." Made the way the others were, and largely out of them: the fort by night, its wall and the frag
// thrown off it from the tenth (shots10.ts), the Arena's round from the eleventh (shots11.ts), copied as they are; its
// own, the MD-500 on the hospital roof lifting off and flying for the mountain (flown along a line as another game's
// helicopter is shown, its rotor at full speed), the Apache's supply drop, the site's door, the end card.
//
//   roof 0-2 · lift 2-5 · flight 5-8 · drop 8-12 · fort 12-15 · wall 15-18 · round one 18-19.2 · gate 19.2-21 ·
//   victory 21-23 · door 23-25 · end 25-30
//
// Its score is the ninth film's band (music9.ts), fifteen bars of two seconds.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import { scoreMusic9, type Row9 } from './music9';
import { physics, SOLID_GROUPS } from '../core/physics';
import { CASTLE, CASTLE_SCALE, UNDER, castleAt, castleLocal, inCastle, moundTop, type FortPlace } from '../sim/castle';
import { NADE, THROWN } from '../sim/grenades';
import { HELI, heliSpots } from '../sim/heli';
import { flightTimes, planFlight, type Flight } from '../sim/airdrop';
import { F_AIM, F_LIGHT } from '../net/protocol';
import { ArenaHud } from '../ui/arena-hud';
import { WORLD_SIZE } from '../world/worldgen/places';

/** how long the film is, seconds: said when its shots have been laid out */
let total = 0;
export const seconds12 = () => total;
/** its score: the ninth film's band, a bar of two seconds to each row */
const ROWS: Row9[] = [
  { kind: 'card', lift: 1 }, { kind: 'tour', hit: 1 }, { kind: 'tour', build: 0.6 }, { kind: 'groove', hit: 1 }, { kind: 'groove' },
  { kind: 'groove', build: 0.8, lift: 1 }, { kind: 'board', hit: 1.2 }, { kind: 'board' }, { kind: 'tight', hit: 1 }, { kind: 'tight', build: 0.7 },
  { kind: 'tight', build: 1, lift: 1 }, { kind: 'paid', hit: 1.2 }, { kind: 'paid' }, { kind: 'next' }, { kind: 'end', hit: 1 },
];
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic9(ctx, out, ROWS);

const ASKED = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const SCOUT = ASKED.has('scout');

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Extra = {
  fadeIn?: number; fadeOut?: number; flash?: number;
  /** the hour of the game's day it is filmed at (unsaid: morning) */
  hour?: number;
  /** words at the foot of the picture: from, until, what */
  plates?: [number, number, string][];
  /** how many frames nobody sees are run when the hour has been turned to, before its people are put out (unsaid: two and a half seconds' worth) */
  settle?: number;
  /** its people put where they are a second before it opens, and that second run where nobody sees: after the hour has been turned to */
  stage?: () => void | Promise<void>;
};

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any, world = S.world as Any;
  const place = world.castle as FortPlace | null;
  if (!place) throw new Error('the map has no fort');
  const FP: FortPlace = place;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  document.body.classList.add('tr-cut10', 'tr-cut11', 'tr-cut12');
  const overlay = document.getElementById('tr-overlay')!;
  const say = (...a: unknown[]) => console.log('[tr] cut 12:', ...a);

  // ------------------------------------------------------------ the fort's own measure
  const K = CASTLE_SCALE, C = CASTLE, U = UNDER;
  /** a spot of the fort, by its own measure: x toward the gate, z toward the steep side, y over the terrace */
  const F = (x: number, z: number, y = 0) => {
    const [wx, wy, wz] = castleAt(FP, x, z, y);
    return new THREE.Vector3(wx, wy, wz);
  };
  /** so many metres of the world, in the fort's measure (a body is no bigger for the fort's being bigger) */
  const m = (metres: number) => metres / K;
  /** a lens at the height of an eye over a floor, in the fort's measure */
  const EYE = m(1.5);
  /** what is underfoot at a spot: the top of whatever stops a body under it (the ground, the ramp's boards, a floor), looked for from so far over it to so far under */
  const under = (p: THREE.Vector3, up = 1.2, far = 30): number | null => {
    const hit = physics.raycast({ x: p.x, y: p.y + up, z: p.z }, { x: 0, y: -1, z: 0 }, up + far, SOLID_GROUPS);
    return hit ? p.y + up - hit.toi : null;
  };
  /** a spot outside the walls, so far over whatever the ground is there: said in the fort's measure, stood on the world */
  const G = (x: number, z: number, up = 0) => {
    const p = F(x, z, 0), y = under(p, 30, 90) ?? S.ground(p.x, p.z);
    return p.setY(y + up);
  };
  const yawTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
  const P = C.parapet, ex = C.hx + P.thick / 2, gz = (C.gate.z0 + C.gate.z1) / 2;
  const RUN = Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2), rx = ex + RUN;
  /** how high the ramp's boards are at a spot along it, over the terrace */
  const rampY = (x: number) => -C.ramp.drop * clamp01((x - ex) / RUN);
  const UF = U.floor;
  /** how high the rubble under the breach lies at a spot along the wall, over the terrace: on the way up it */
  const moundAt = (x: number, z = -11.6) => moundTop('fan', x, z);
  /** a lens carried at a man's eye over the boards of the ramp and the paving; and one over the cistern's water */
  const H = m(1.55), WATER = UF + m(1.4);


  // ------------------------------------------------------------ rails: a lens goes along a line at a speed that is said
  interface Rail { len: number; at: (s: number) => THREE.Vector3 }
  const rail = (pts: THREE.Vector3[]): Rail => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    c.arcLengthDivisions = 800;
    const len = c.getLength();
    return { len, at: (s) => c.getPointAt(clamp01(s / len)) };
  };
  /**
   * How far along a rail a lens is, `t` seconds into a shot of `secs`: its speed follows `shape` (how fast at each
   * share of the shot, as a share of its fastest: straight lines between, so its speed never jumps) and the whole
   * of the rail is gone along. `top` is that fastest, metres a second.
   */
  const pace = (len: number, secs: number, shape: [number, number][]) => {
    const v = (u: number) => {
      if (u <= shape[0][0]) return shape[0][1];
      for (let k = 1; k < shape.length; k++) if (u <= shape[k][0]) return shape[k - 1][1] + ((shape[k][1] - shape[k - 1][1]) * (u - shape[k - 1][0])) / (shape[k][0] - shape[k - 1][0]);
      return shape[shape.length - 1][1];
    };
    const N = 800, acc = [0];
    for (let i = 1; i <= N; i++) acc.push(acc[i - 1] + (v((i - 1) / N) + v(i / N)) / 2 / N);
    const top = len / (acc[N] * secs);
    return {
      top,
      speed: (t: number) => v(clamp01(t / secs)) * top,
      at: (t: number) => {
        const u = clamp01(t / secs) * N, i = Math.min(N - 1, Math.floor(u));
        return ((acc[i] + (acc[i + 1] - acc[i]) * (u - i)) / acc[N]) * len;
      },
    };
  };
  /** what a lens looks at through a shot: a line through these places, gone along evenly (it is turning when the shot opens, and when it ends) */
  const gaze = (pts: THREE.Vector3[]) => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    return (u: number) => c.getPoint(clamp01(u));
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

  // ------------------------------------------------------------ the look
  const piece = (cls: string) => {
    const el = document.createElement('div');
    el.className = cls;
    overlay.appendChild(el);
    return el;
  };
  const grain = piece('tr-grain4'), black = piece('tr-black4'), white = piece('tr-flash4');
  piece('tr-vig4');
  let frame = 0;
  const look = (t: number, len: number, o: Extra) => {
    frame++;
    grain.style.transform = `translate(${((frame * 73) % 97) - 48}px, ${((frame * 41) % 89) - 44}px)`;
    const a = o.fadeIn ? 1 - ease(t / o.fadeIn) : 0, z = o.fadeOut ? ease((t - (len - o.fadeOut)) / o.fadeOut) : 0;
    black.style.opacity = String(Math.max(a, z));
    white.style.opacity = String(o.flash ? Math.max(0, 1 - t / 0.08) * o.flash : 0);
  };
  const gfx: HTMLElement[] = [];
  const Gx = (cls: string, html: string) => {
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
  // its words: the name on the first frame, a plate at the foot of the picture where a part is named, the address
  const plate = Gx('x10-plate', '<span></span>');

  // ------------------------------------------------------------ people, and frames nobody sees
  const A = (i: number) => S.actors[i];
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
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
  /** somebody of the cast stood on a floor (which is not always the ground's) */
  const dressing: Promise<unknown>[] = [];
  const stand = (a: Actor, p: THREE.Vector3, yaw: number, weapon: string | null = null, gear: string[] = [], mods: string[] = []) => {
    a.place(p.x, p.z, yaw, weapon, gear);
    a.pos.y = p.y;
    if (weapon && mods.length) a.rp.setWeapon(weapon, mods);
    dressing.push(Promise.resolve(g.wear(a.rp.avatar, gear)).catch(() => {}));
    return a;
  };
  /** everybody stood since the last time has on what they wear. (It is put on when its models have come, which is a moment after it is asked for: on the first frame of a shot a man was seen without his pack and his helmet, and had them on the next.) */
  const dressed = async () => {
    let done = false;
    void Promise.all(dressing.splice(0)).then(() => (done = true));
    // (the game's clock runs while it is put on, a frame at a time: nobody is moving yet, and nothing is filmed)
    for (let i = 0; i < 90 && !done; i++) {
      await run(1);
      await wait(12);
    }
    if (!done) say('somebody is not dressed yet as the shot opens');
  };
  /** what the cast wear and carry, and what is thrown: fetched before anything is filmed */
  const THINGS = ['armor_vest', 'helmet_m1', 'sack_pack', 'chest_rig', 'patrol_cap', 'camping_pack', 'soft_vest', 'boonie_hat', 'life_vest', 'helmet_k63', 'heavy_armor', 'ak', 'ar15', 'mpa', 'mosin', 'frag', 'gun_light'];
  /** whoever is in the air: said so in their pose, as a game says it of a player who is falling (the director says of everybody that their feet are on something) */
  const flying = new Set<Actor>();
  for (const a of S.actors) {
    const own = a.push.bind(a);
    a.push = (ago = 0) => {
      if (!flying.has(a)) return own(ago);
      a.rp.push([a.pos.x, a.pos.y, a.pos.z, a.yaw, a.pitch, (a.aim ? F_AIM : 0) | a.more], performance.now() + ago);
    };
  }
  const reset = () => {
    flying.clear();
    for (const a of S.actors) {
      a.dance = a.surrender = a.crouch = a.aim = a.sprint = false;
      a.more = 0;
      a.foe = null;
      a.rp.avatar.clearWounds();
      a.hide();
    }
    S.parkMe();
    S.clean();
    hush();
  };

  // ------------------------------------------------------------ the fort got ready: its stone made, its pictures come
  let warmed = false;
  const warm = async () => {
    if (warmed) return;
    warmed = true;
    const site = g.castle as Any;
    if (!site) throw new Error('the game has made no fort');
    site.finish?.();
    // (sent for now, and come while the lens goes round: a model comes only while the game's clock runs, and waited for with the clock stopped, they held the whole film up)
    const come = new Set<string>();
    for (const id of THINGS) void Promise.resolve(g.loot.models.get(id)).then(() => come.add(id), () => {});
    const TOUR: [THREE.Vector3, THREE.Vector3][] = [
      [G(34, gz, 2), F(ex, gz, 2)], [F(8, -2, EYE), F(4, -6, 1)], [F(3, -7.4, EYE), F(-3, -7.2, 0)], [F(-1.2, -7.3, UF + EYE), F(4, -6.5, UF + 1)],
      [F(-1.1, 6.2, UF + EYE), F(-1.4, 1, UF + 1)], [F(6.3, 4.5, UF + EYE), F(12, 4.5, UF + 0.6)], [G(2, -22, 1.7), F(-4.5, -10.4, 0)], [F(8.6, -8.7, C.tower.deck + EYE), F(16, gz, -1)], [F(-3, -2.8, C.keep.roof + EYE), F(2.6, 2.6, 9.6)],
    ];
    const t0 = clock.real.now();
    // (the lens is taken round it where nobody sees: whatever is made or sent for when an eye first comes to a part of it is then here)
    for (let lap = 0; lap < 2; lap++) {
      for (const [p, l] of TOUR) {
        S.cam = { p, l, fov: 50 };
        await run(24);
        await wait(120);
      }
      for (let i = 0; i < 100 && site.state !== 'near'; i++) {
        await run(6);
        await wait(100);
      }
    }
    // (what is near is looked for every eight seconds of the game's clock, and its own pictures sent for then: see src/game/near.ts)
    S.cam = { p: TOUR[1][0], l: TOUR[1][1], fov: 50 };
    await run(60 * 9);
    const maps = () => (site.sharp as THREE.Material[]).map((q) => (q as Any).map?.uuid ?? '').join('|');
    let was = maps(), quiet = 0, changed = 0;
    for (let i = 0; i < 80 && quiet < 14; i++) {
      await run(12);
      await wait(150);
      const now = maps();
      if (now === was) quiet++;
      else {
        quiet = 0;
        changed++;
        was = now;
      }
    }
    S.cam = null;
    if (come.size < THINGS.length) say(`not come yet: ${THINGS.filter((id) => !come.has(id)).join(', ')}`);
    say(`the fort is ${site.state} (${JSON.stringify(site.counts)}); its pictures changed ${changed} times while it was waited for; ${((clock.real.now() - t0) / 1000).toFixed(1)} s`);
  };

  // ------------------------------------------------------------ the set
  const shots: Shot[] = [];
  const DAY = 0.3, NIGHT = 0.8;
  let cur = 0, hourWas = -1;
  /** a shot of so many seconds */
  const add = (len: number, s: Omit<Shot, 'start' | 'end'> & Extra) => {
    const setup = s.setup, after = s.after, start = cur;
    cur += len;
    shots.push({
      bars: true,
      ...s,
      start,
      end: start + len,
      setup: async (st) => {
        for (const el of gfx) el.style.display = 'none';
        try {
          g.hourHeld = hourWas < 0 ? DAY : hourWas;
          await warm();
          reset();
          // (the hour is turned to where nobody sees: the lamps come on or go out, and the eye settles to the light)
          const hour = s.hour ?? DAY;
          g.hourHeld = hour;
          await setup?.(st);
          if (s.cam) S.cam = s.cam(0, st);
          if (hour !== hourWas) await run(s.settle ?? 150);
          hourWas = hour;
          await s.stage?.();
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
          show(plate, t - c[0], Math.min(ease((t - c[0]) / 0.25), ease((c[1] - t) / 0.2)));
        } else plate.style.display = 'none';
      },
    });
  };
  /** a lens flown along a rail: where it goes (made when the shot is set up: the fort is there by then), how its speed runs, what it looks at */
  const fly = (secs: number, o: { rail: () => THREE.Vector3[]; shape: [number, number][]; gaze: () => THREE.Vector3[]; fov: number | [number, number]; hand?: number; seed?: number }) => {
    let R: Rail | null = null, pc: ReturnType<typeof pace> | null = null, gz2: ((u: number) => THREE.Vector3) | null = null;
    const make = (label: string) => {
      R = rail(o.rail());
      pc = pace(R.len, secs, o.shape);
      gz2 = gaze(o.gaze());
      say(`${label}: a rail of ${R.len.toFixed(1)} m in ${secs} s: ${pc.speed(0).toFixed(1)} m/s as it opens, ${pc.top.toFixed(1)} at its fastest, ${pc.speed(secs).toFixed(1)} as it ends`);
    };
    const cam = (t: number): CamPose => {
      const s = pc!.at(Math.max(0, t)), fov = typeof o.fov === 'number' ? o.fov : o.fov[0] + (o.fov[1] - o.fov[0]) * clamp01(t / secs);
      return hand({ p: R!.at(s), l: gz2!(t / secs), fov }, t, o.hand ?? 0.35, o.seed ?? 0);
    };
    return { make, cam, at: (t: number) => R!.at(pc!.at(Math.max(0, t))), speed: (t: number) => pc!.speed(t) };
  };

  // ------------------------------------------------------------ a walk round its places, a still of each
  const scout = () => {
    const T = C.tower, D = T.deck, ROOF = C.keep.roof, DUSK = 0.733;
    /** each: what it is, where the lens is, what it looks at, how wide, and the hour (unsaid: morning). Made when it is filmed: the fort's own stone is there to be stood on by then. */
    const poses: [string, () => THREE.Vector3, () => THREE.Vector3, number?, number?][] = [
      ['front 60', () => G(60, gz, 2.5), () => F(ex, gz, m(3)), 30],
      ['ramp, two thirds up', () => F(12.6, gz, rampY(12.6) + H), () => F(7, gz - 0.4, m(2.4)), 46],
      ['in the gate', () => F(9.6, gz - 0.25, H), () => F(6, gz - 1.5, m(2.4)), 46],
      ['inside the gate, up at the doorway landing', () => F(8.2, gz - 0.4, H), () => F(5.9, 0, 3 + m(1.2)), 46],
      ['at the east lip of the hole', () => F(0.5, -7.2, 0.75), () => F(-1.6, -7.25, -3.4)],
      ['in the cistern, under the hole, looking east', () => F(-1.2, -7.3, WATER), () => F(5, -7, -2.8)],
      ['breach from outside, at its head', () => F(-5.2, -12, EYE), () => F(-2, -7.7, -0.8)],
      ['breach from outside, along the wall from the east', () => F(-1, -11.6, moundAt(-1) + EYE), () => F(-4.5, -10.2, 0.8)],
      ['in the gap, toward the hole', () => F(-4.6, -10.6, EYE), () => F(-1.6, -7.7, -2)],
      ['at the north-west lip', () => F(-2.9, -8.2, EYE - 0.1), () => F(-0.6, -7.5, -4)],
      ['in the mouth, north strip', () => F(-1.7, -7.75, -1), () => F(3, -7.3, -2.9)],
      ['in the cistern at -0.3, looking east', () => F(-0.3, -7.45, WATER), () => F(6, -6.6, -2.7)],
      ['in the cistern at 1.4, looking east', () => F(1.4, -7.4, WATER), () => F(6, -6.6, -2.7)],
      ['cistern, south aisle from its east end', () => F(4.4, -5.2, WATER), () => F(-6, -6.6, UF + 0.6)],
      ['armoury from inside, the grille', () => F(2.4, 2.7, UF + EYE), () => F(-2.6, -0.6, UF + 1)],
      ['armoury from inside, toward its door', () => F(1.6, -0.9, UF + EYE), () => F(-1.5, 3.6, UF + 1)],
      ['breach from below', () => G(3, -22, 1.6), () => F(-4.5, -10.4, 0)],
      ['tower top, the nest', () => F(8.6, -8.7, D + EYE), () => F(12.5, -12.8, 5.2)],
      ['tower top, down on the ramp', () => F(9, -9.6, D + m(2.2)), () => F(15.5, gz, -1)],
      ['wall crane, half way', () => F(7.4, -7.7, 5.5), () => F(15.5, gz, -1)],
      ['wall crane, its end', () => F(8.5, -9, 7.9), () => F(16, gz, -1.2)],
      ['keep doorway landing, down on the gate', () => F(6.2, 0.2, 3 + EYE), () => F(9.5, gz, m(1.2))],
      ['before the ramp, low: where the last shot opens', () => G(rx + 12, gz + 4, 1.2), () => F(ex, gz, m(2.2)), 40],
      ['before the ramp, risen: where it ends', () => G(rx + 17, gz + 5.5, 6.5), () => F(4, 0, 6), 40],
      // by night
      ['NIGHT before the ramp, low', () => G(rx + 12, gz + 4, 1.2), () => F(ex, gz, m(2.2)), 40, NIGHT],
      ['NIGHT before the ramp, risen', () => G(rx + 17, gz + 5.5, 6.5), () => F(4, 0, 6), 40, NIGHT],
      ['NIGHT the gate wall, behind the bags', () => F(7.9, -6.6, 1.9), () => F(14.5, gz, -0.8), 50, NIGHT],
      ['NIGHT wall crane, half way', () => F(7.4, -7.7, 5.5), () => F(15.5, gz, -1), 50, NIGHT],
      ['NIGHT wall crane, its end', () => F(8.5, -9, 7.9), () => F(16, gz, -1.2), 50, NIGHT],
      ['NIGHT inside the gate', () => F(8, gz - 0.5, H), () => F(5.6, -6.5, m(1.6)), 46, NIGHT],
      ['NIGHT north walk', () => F(5.2, -7.5, EYE), () => F(0.5, -7.2, 0.2), 50, NIGHT],
      ['NIGHT keep roof', () => F(-3.1, -2.8, ROOF + EYE), () => F(2.6, 2.6, 9.6), 50, NIGHT],
      ['NIGHT high, from behind', () => F(-30, 26, 30), () => F(0, 0, 8), 44, NIGHT],
      ['NIGHT breach from outside', () => F(-5.2, -12, EYE), () => F(-2, -7.7, -0.8), 50, NIGHT],
      ['NIGHT fallen wall from inside', () => F(6.3, 4.5, UF + EYE), () => F(12, 4.5, UF + 0.6), 50, NIGHT],
      ['0.745 high, from the gate side', () => F(30, -28, 30), () => F(0, 0, 8), 44, 0.745],
      ['0.755 high, from the gate side', () => F(30, -28, 30), () => F(0, 0, 8), 44, 0.755],
      ['0.745 the gate wall, behind the bags', () => F(7.9, -6.6, 1.9), () => F(14.5, gz, -0.8), 50, 0.745],
      ['0.755 the gate wall, behind the bags', () => F(7.9, -6.6, 1.9), () => F(14.5, gz, -0.8), 50, 0.755],
      ['DUSK front 46', () => G(46, gz, 2.2), () => F(ex, gz, m(3)), 38, DUSK],
      ['0.755 front 46', () => G(46, gz, 2.2), () => F(ex, gz, m(3)), 38, 0.755],
    ];
    // (a pose is three frames of a draft, and begins on a frame: said as film.mjs says a frame's time, or a pose is filmed a frame late)
    const PER = 3, FPS = 30;
    poses.forEach(([label, at, to, fov, hour], i) => {
      let pose: CamPose = { p: new THREE.Vector3(), l: new THREE.Vector3(0, 0, -1), fov: fov ?? 50 };
      shots.push({
        name: `scout ${i}`,
        start: (i * PER) / FPS,
        end: ((i + 1) * PER) / FPS,
        bars: false,
        setup: async () => {
          g.hourHeld = DAY;
          await warm();
          reset();
          g.hourHeld = hour ?? DAY;
          pose = { p: at(), l: to(), fov: fov ?? 50 };
          S.cam = pose;
          await run(hour ? 150 : 40);
          await wait(60);
          const [lx, lz, ly] = castleLocal(FP, pose.p.x, pose.p.y, pose.p.z);
          say(`${String(i).padStart(2, '0')} at ${((i * PER) / FPS).toFixed(2)} s: ${label} (lens at ${lx.toFixed(1)}, ${lz.toFixed(1)}, ${ly.toFixed(1)} of the fort)`);
        },
        cam: () => pose,
        after: () => hush(),
      });
    });
    total = (poses.length * PER) / FPS;
    return shots;
  };
  if (SCOUT) return scout();

  // ============================================================ THE FILM
  // ------------------------------------------------------------ the two who storm the gate
  // One way each, from the open ground before the ramp, up its boards, through the gate's passage (past the leaf
  // that still hangs) and on inside: the first to the north along the east walk, the second to the leaf's foot.
  // Where each is on it is a matter of the clock alone, so any shot can pick them up at any second.
  let ways: Rail[] = [];
  const makeWays = () => {
    const up = (z: number) => [G(rx + 10, z - 0.2), G(rx + 5.5, z - 0.1), G(rx + 1.6, z), F(rx - 1, z, rampY(rx - 1)), F(14.5, z, rampY(14.5)), F(11.5, z, rampY(11.5))];
    ways = [
      rail([...up(gz - 0.42), F(ex, gz - 0.3), F(9.3, gz - 0.3), F(8.4, gz - 0.45), F(7.3, gz - 0.75), F(6.8, -3.5), F(6.9, -5.1), F(7.2, -7.2)]),
      rail([...up(gz + 0.42), F(ex + 0.3, gz + 0.1), F(9.4, gz - 0.2), F(8.5, gz + 0.1), F(7.9, gz + 0.7), F(7.7, gz + 1.25)]),
    ];
  };
  /** how far along a way the foot of the ramp is (where the fort's x is the ramp's end): found once for each way */
  const feet = new Map<Rail, number>();
  const footOf = (R: Rail) => {
    let s = feet.get(R);
    if (s !== undefined) return s;
    for (s = 0; s < R.len; s += 0.05) {
      const p = R.at(s);
      if (castleLocal(FP, p.x, p.y, p.z)[0] <= rx) break;
    }
    feet.set(R, s);
    return s;
  };
  /** a shot of somebody's, as the game shows one it is told of: from the eye, the flash at the end of the barrel that is drawn */
  const fire = (a: Actor, at: THREE.Vector3) => {
    if (!a.weapon || !a.alive) return;
    const o = a.eye();
    g.weapons.remoteShot(o, at.clone().sub(o).normalize(), a.weapon, false, a.rp.muzzle(), a.rp);
  };
  /** somebody put on a way, so far along it, facing the way it goes */
  const onWay = (a: Actor, R: Rail, s: number) => {
    const c = Math.min(R.len - 0.05, Math.max(0, s)), p = R.at(c), q = R.at(Math.min(R.len, c + 0.45)), b = R.at(Math.max(0, c - 0.45));
    a.pos.copy(p);
    a.yaw = yawTo(b, q);
    a.pitch = 0;
    return s >= R.len - 0.05;
  };
  /** the two of them as they are `t` seconds after the first of them was `back` metres short of where the ramp's boards begin, going at `v` */
  const storm = (t: number, v: number, back: number, o: { light?: boolean } = {}) => {
    for (const k of [0, 1]) {
      const a = A(k), R = ways[k], done = onWay(a, R, footOf(R) - back - k * 1.9 + v * t);
      a.sprint = v > 5 && !done;
      a.aim = false;
      a.crouch = done && k === 1;
      // (one torch between them: two, on snow, were one glare)
      a.more = o.light && k === 0 ? F_LIGHT : 0;
    }
  };



  // ============================================================ THE ELEVENTH FILM
  // ------------------------------------------------------------ the match: two against two, on the Assault loadout
  /** the Arena's loadout as it hands it out: the AR-15 with what is fitted to it, no suppressor (arena/rules.ts) */
  const GUN = 'ar15', MODS = ['red_dot', 'foregrip', 'gun_light'];
  /** blue: Volkov and Mira, who come up the ramp; red: Kestrel, on the tower, and Bear, who holds the keep's landing */
  const RED = [2, 5];
  const sides = (): [string, string] => [`${A(0).name} & ${A(1).name}`, `${A(2).name} & ${A(5).name}`];
  /** the scoreboard at the end, five rounds to three: every kill somebody's death, and each round won is a whole side down */
  const board = () => [
    { name: A(0).name, ours: true, kills: 7, deaths: 3 }, { name: A(1).name, ours: true, kills: 4, deaths: 4 },
    { name: A(2).name, ours: false, kills: 5, deaths: 6 }, { name: A(5).name, ours: false, kills: 2, deaths: 5 },
  ];
  // the Arena's own screen over the film: made by each shot that has it, taken away by those that do not
  let screen: ArenaHud | null = null;
  const arena = (on: boolean) => {
    if (on && !screen) screen = new ArenaHud(overlay, false, false);
    if (!on && screen) {
      screen.destroy();
      screen = null;
    }
    return screen;
  };
  const says = (phase: 'live' | 'gap' | 'over', round: number, us: number, them: number, won?: boolean) =>
    arena(true)!.score({ t: 'score', round, us, them, first: 5, up: [2, phase === 'live' ? 2 : 0], phase, ...(won === undefined ? {} : { won }), sides: sides(), board: board() });
  /** its banners and kill feed come and go by the film's clock: told a frame has gone by (its own figures: full health, a full magazine) */
  const beat = () => screen?.tick(100, GUN, 31, 31, false, false);


  // ============================================================ THE TWELFTH FILM
  // its words: the name on the first frame, the door's own picture, and the end card
  const title12 = Gx('x12-title', `
    <div class="t12-kick">ZONA &nbsp;·&nbsp; PVP SURVIVAL SHOOTER</div>
    <div class="t12-name">WHAT'S NEW</div>`);
  const door12 = Gx('x12-door', '<img src="/changelog/media/door-pvp.jpg" alt="">');
  const card12 = Gx('x12-end', `
    <div class="c12-list"><span>HELICOPTERS</span><span>ORLINOYE</span><span>FRAG GRENADES</span><span>THE ARENA</span></div>
    <div class="c12-name">ZONA <em>PvP</em></div>
    <div class="c12-url">WWW.ZONAPVP.FUN</div>`);
  /** the Zone's look of the two who storm the gate (the tenth film's) */
  const STORM = [{ weapon: 'ak', gear: ['armor_vest', 'helmet_m1', 'sack_pack'] }, { weapon: 'ar15', gear: ['chest_rig', 'patrol_cap', 'camping_pack'] }];
  /** blue's two, `T` seconds into their run: on the open ground before the ramp (the tenth film's charge) */
  const blue = (T: number) => storm(T - 3, 3.4, -8.6);

  // ------------------------------------------------------------ the helicopter on the hospital's roof, and its flight
  /** the MD-500 that stands on the hospital's roof (src/sim/heli.ts, heliSpots: the roof's is the first) */
  const roof = () => heliSpots(world)[0];
  const md500 = () => {
    const r = roof();
    let best: Any = null, d = 1e9;
    for (const j of (g.garage.jeeps as Map<number, Any>).values()) {
      if (j.kind !== HELI.kind) continue;
      const e = Math.hypot(j.pos.x - r.x, j.pos.z - r.z);
      if (e < d) {
        d = e;
        best = j;
      }
    }
    if (!best) throw new Error('no helicopter stands on the hospital roof');
    return best;
  };
  /** where it goes: up off the roof, nose round toward the mountain and on toward it, low over the town; as a state a game would be told of it (its rotor at full speed) */
  let flightPath: Rail | null = null, heading = 0;
  const makeFlight = () => {
    const r = roof();
    // (the most open way off the roof: of sixteen, the one whose ground rises least over its first 250 m, inside the
    // map; the draft's, toward the fort, flew into a wooded hill)
    let best = 0, rise = Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      if (Math.max(Math.abs(r.x + dx * 300), Math.abs(r.z + dz * 300)) > WORLD_SIZE / 2 - 40) continue;
      let top = -Infinity;
      for (let s = 20; s <= 250; s += 10) top = Math.max(top, S.ground(r.x + dx * s, r.z + dz * s) - r.y);
      if (top < rise) {
        rise = top;
        best = a;
      }
    }
    const toFort = new THREE.Vector3(Math.sin(best), 0, Math.cos(best));
    heading = Math.atan2(-toFort.x, -toFort.z);
    // (out of the roof's reach, never lower than so far over the ground under it: the draft's flew into a wooded hill)
    const at = (along: number, up: number, over = 0) => {
      const x = r.x + toFort.x * along, z = r.z + toFort.z * along;
      return new THREE.Vector3(x, Math.max(r.y + up, S.ground(x, z) + over), z);
    };
    flightPath = rail([at(0, 0.02), at(0, 2.5), at(1.5, 7), at(8, 13, 20), at(30, 22, 32), at(70, 30, 42), at(120, 36, 48), at(175, 40, 52)]);
  };
  /** how far along its way it is, seconds after it lifts: slow off the roof, then at a cruise */
  const flown = (T: number) => (T <= 0 ? 0 : T < 3 ? 2.2 * T * T * 0.5 + 1.2 * T : 2.2 * 4.5 + 1.2 * 3 + (T - 3) * 22);
  const fly12 = (T: number) => {
    const h = md500(), s = Math.min(flightPath!.len, flown(T)), p = flightPath!.at(s), q = flightPath!.at(Math.min(flightPath!.len, s + 1));
    // (nose down as it goes, as the rotor tips it forward; level while it rises)
    const pitch = -Math.min(0.2, Math.max(0, (T - 1.5) * 0.12)), quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, heading, 0, 'YXZ'));
    const v = q.clone().sub(p).multiplyScalar(22);
    const st = [p.x, p.y, p.z, quat.x, quat.y, quat.z, quat.w, v.x, v.y, v.z, 1, T > 0 ? 0.7 : 0.35];
    if (h.mode !== 'follow') {
      h.place(st);
      h.mode = 'follow';
    }
    h.push(st, performance.now(), performance.now());
    return p;
  };

  // ============================================================ 1. the MD-500 on the hospital's roof, the rotor coming up: WHAT'S NEW
  add(2, {
    name: 'roof',
    hour: DAY,
    settle: 200,
    setup: () => makeFlight(),
    stage: async () => {
      await run(40, () => void fly12(-1));
    },
    lead: () => void fly12(-1),
    tick: () => void fly12(-1),
    cam: (t) => {
      const r = roof(), a = heading + 2.1 + t * 0.12;
      return hand({ p: new THREE.Vector3(r.x + Math.sin(a) * 9.5, r.y + 3.4, r.z + Math.cos(a) * 9.5), l: new THREE.Vector3(r.x, r.y + 1.2, r.z), fov: 48 }, t, 0.3);
    },
    after: (t) => {
      if (t < 1.8) show(title12, t, 1 - ease((t - 1.5) / 0.3));
      else title12.style.display = 'none';
    },
  });

  // ============================================================ 2. it lifts off, and goes
  add(3, {
    name: 'lift',
    hour: DAY,
    setup: () => makeFlight(),
    stage: async () => {
      await run(40, (k) => void fly12(-1 + k / 60));
    },
    lead: (t) => void fly12(t),
    tick: (t) => void fly12(t),
    // (from the roof's corner, low: it rises out of the picture's middle and away over the town)
    cam: (t) => {
      const r = roof(), p = fly12(t), a = heading + Math.PI * 0.82;
      return hand({ p: new THREE.Vector3(r.x + Math.sin(a) * 11, r.y + 1.6, r.z + Math.cos(a) * 11), l: p.clone().setY(p.y + 1.2), fov: 50 }, t, 0.35);
    },
  });

  // ============================================================ 3. over the town toward the mountain, behind it
  add(3, {
    name: 'flight',
    hour: DAY,
    setup: () => makeFlight(),
    stage: async () => {
      await run(40, (k) => void fly12(3 + (-1 + k / 60)));
    },
    lead: (t) => void fly12(3 + t),
    tick: (t) => void fly12(3 + t),
    // (behind it and over it, looking on past it: the land going by under it, and the far hills)
    cam: (t) => {
      const p = fly12(3 + t), back = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
      return hand({ p: p.clone().addScaledVector(back, 16).setY(p.y + 5), l: p.clone().addScaledVector(back, -90).setY(p.y - 10), fov: 52 }, t, 0.4);
    },
  });

  // ============================================================ 4. the Apache brings a supply drop: the crate under its canopy
  /**
   * Where it comes down: open ground in the green near the hospital, the spot within 160 m of its roof farthest from
   * any tree, with no roof over or beside it, near level (the draft's spot was in the snowy wood, the lens under a pine).
   */
  const openGround = () => {
    const r = roof(), R = 160;
    const trees = ((world.trees ?? []) as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush') && Math.hypot(t.x - r.x, t.z - r.z) < R + 50);
    const clear = (x: number, z: number) => trees.reduce((d, t) => Math.min(d, Math.hypot(t.x - x, t.z - z)), 50);
    const bare = (x: number, z: number) => {
      const gy = S.ground(x, z), h = under(new THREE.Vector3(x, gy, z), 80, 5);
      return h === null || h < gy + 0.6;
    };
    const level = (x: number, z: number) => Math.abs(S.ground(x + 8, z) - S.ground(x - 8, z)) < 2.5 && Math.abs(S.ground(x, z + 8) - S.ground(x, z - 8)) < 2.5;
    let best = { x: r.x, z: r.z, d: -1 };
    for (let x = r.x - R; x <= r.x + R; x += 4)
      for (let z = r.z - R; z <= r.z + R; z += 4) {
        const e = Math.hypot(x - r.x, z - r.z);
        if (e > R || e < 30) continue;
        const d = clear(x, z);
        if (d <= best.d || !level(x, z) || ![[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]].every(([a, b]) => bare(x + a, z + b))) continue;
        best = { x, z, d };
      }
    say(`drop: open ground ${best.d.toFixed(0)} m from the nearest tree, ${Math.hypot(best.x - r.x, best.z - r.z).toFixed(0)} m from the hospital roof`);
    return new THREE.Vector3(best.x, S.ground(best.x, best.z), best.z);
  };
  let flight: Flight | null = null, side = new THREE.Vector3();
  add(4, {
    name: 'drop',
    hour: DAY,
    // (planned before the lens is first asked where it is; begun once the shot is set)
    setup: () => {
      const at = openGround();
      const f = planFlight((x, z) => S.ground(x, z), { x: at.x, y: at.y, z: at.z }, 'drop-film12', () => S.rnd());
      // (it is shown a second before the crate leaves the Apache, and the canopy opens two seconds after that)
      f.age = Math.max(0, flightTimes(f).release - 1);
      flight = f;
      // (the lens beside it in the air, side on to its way in; of the two sides, the one from which it looks toward the fort and its mountain)
      const way = new THREE.Vector3(f.x - f.fx, 0, f.z - f.fz).normalize(), across = new THREE.Vector3(-way.z, 0, way.x), toFort = F(0, 0).sub(at).setY(0).normalize();
      side = across.dot(toFort) < 0 ? across : across.negate();
    },
    stage: async () => {
      // (The Apache's model is fetched and made ready a moment after a flight is said, and the draft's first frames
      // went without it: a flight is said first and cleared once it has its model; the one filmed, said after it, has
      // it at once. That one is begun a second early, and the second run unseen.)
      const hung = () => (g.airdrops.list()[0]?.heli.mount.children.length ?? 0) > 3;
      const until = async (most: number) => {
        let n = 0;
        for (; n < most && !hung(); n++) {
          await run(1);
          await wait(12);
        }
        return n;
      };
      g.airdrops.clear();
      g.flightBegun({ ...flight!, uid: 'drop-film12-first' });
      await until(240);
      g.airdrops.clear();
      flight!.age -= 1;
      g.flightBegun(flight!);
      const n = await until(60);
      if (!hung()) say('drop: the Apache has no model yet as the shot opens');
      await run(Math.max(0, 60 - n));
    },
    // (from 50 m off, a little under the Apache: it in the middle, the crate leaving it and its canopy opening, the land far under them)
    cam: (t) => {
      const f = flight!, a = side.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.25 - t * 0.06);
      return hand({ p: new THREE.Vector3(f.x + a.x * 50, f.hold - 6, f.z + a.z * 50), l: new THREE.Vector3(f.x, f.hold - 1.5 - t * 2.4, f.z), fov: 42 }, t, 0.3);
    },
  });


  // ============================================================ 6. by night: what burns before the gate, the gate behind it; up, to the whole of it; and where it is played
  /**
   * The jeep that burns before the ramp, if the world has it: found as the film is made (a fire the game keeps
   * there, or a thing there that says by its name what it is). Until it has been built there is none, and the
   * shot is the gate by night with its own fire.
   */
  const burning = (): THREE.Vector3 | null => {
    const foot = F(rx, gz, rampY(rx)), near = (p: { x: number; z: number }) => {
      const d = Math.hypot(p.x - foot.x, p.z - foot.z);
      return d > 1 && d < 42 && !inCastle(FP, p.x, FP.y, p.z);
    };
    // (the game's own word for it, where the game has one: `wreck`, the jeep that burns before the gate, which the fort places by its own measure. See src/sim/wreck-fire.ts.)
    const w = (g.wreck as Any)?.spot as { x: number; y: number; z: number } | undefined;
    if (w) return new THREE.Vector3(w.x, w.y, w.z);
    let found: THREE.Vector3 | null = null;
    (g.s.r.scene as THREE.Scene).traverse((o) => {
      if (found || !/jeep|uaz|burn/i.test(o.name)) return;
      const p = o.getWorldPosition(new THREE.Vector3());
      if (near(p)) found = p;
    });
    return found;
  };
  const last = () => {
    const fire = burning(), gateAt = F(ex, gz, m(2.3));
    if (fire) say(`high: something burns before the ramp, ${Math.hypot(fire.x - F(rx, gz).x, fire.z - F(rx, gz).z).toFixed(1)} m from its foot`);
    else say('high: nothing burns before the ramp in this world yet: the gate by night, with its own fire');
    // (the lens opens low, a few paces beyond the fire from the gate and a little to one side of the line between them, and goes up and back)
    const jeep = fire ?? G(rx + 4.5, gz + 3.6), away = jeep.clone().sub(gateAt).setY(0).normalize(), side = new THREE.Vector3(away.z, 0, -away.x);
    const at = (back: number, off: number, up: number) => {
      const p = jeep.clone().addScaledVector(away, back).addScaledVector(side, off);
      return p.setY((under(p.clone().setY(FP.y), 40, 120) ?? S.ground(p.x, p.z)) + up);
    };
    return { pts: [at(8, 2.2, 1.25), at(9.6, 2.9, 2.3), at(11.6, 3.8, 3.2), at(13.6, 4.8, 4.1)], gaze: [gateAt.clone().lerp(jeep, 0.25).setY(gateAt.y - 0.6), gateAt.clone().lerp(jeep, 0.1), gateAt.clone().setY(gateAt.y + 0.9), F(C.keep.x1 + 1, gz * 0.5, m(2.9))] };
  };
  let lastSite: ReturnType<typeof last> | null = null;
  const high = fly(4, {
    rail: () => (lastSite ??= last()).pts,
    shape: [[0, 0.5], [0.3, 1], [1, 0.85]],
    gaze: () => (lastSite ??= last()).gaze,
    fov: [40, 52],
    hand: 0.25,
  });
  add(3, {
    name: 'fort',
    hour: NIGHT,
    setup: () => {
      arena(false);
      high.make('high');
    },
    cam: (t) => high.cam(t),
  });

  // ============================================================ 5. by night: the wall over the way in, over a defender's shoulder, and up beside the tower
  // (No higher than where the ramp is seen whole between the tower and the gate: from over the tower its own top is all there is to see.)
  const WALL_AT = F(9.05, -5.35, 0), RAMP_AT = () => F(14.8, gz, rampY(14.8));
  const wall = fly(3, {
    rail: () => [F(7.9, -6.6, 1.9), F(7.7, -6.75, 2.7), F(7.4, -6.9, 3.9), F(7.1, -7, 5.1)],
    shape: [[0, 0.75], [0.3, 1], [1, 0.8]],
    gaze: () => [F(14, gz + 0.2, -0.6), F(15, gz, -0.9), F(15.8, gz - 0.4, -1.1), F(16.6, gz - 1, -1.3)],
    fov: 50,
  });
  let thrown = false;
  /** a grenade thrown as the game throws one it is told of: from the hand, at an arm's speed along the eye and a little up, with what is left of its fuse; and the arm */
  const lob = (a: Actor, at: THREE.Vector3, left: number) => {
    const o = new THREE.Vector3(a.pos.x, a.pos.y + 1.62, a.pos.z), flat = Math.hypot(at.x - o.x, at.z - o.z), h = at.y - o.y;
    // (how far down the eye looks for it to come down there: found, as whoever throws one finds it)
    const miss = (pitch: number) => {
      const t = flat / (NADE.speed * Math.cos(pitch));
      return (NADE.speed * Math.sin(pitch) + NADE.lift) * t - 0.5 * NADE.fall * t * t - h;
    };
    let lo = -1.2, hi = 0.5;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (miss(mid) < 0) lo = mid;
      else hi = mid;
    }
    const pitch = (lo + hi) / 2, yaw = yawTo(o, at);
    a.yaw = yaw;
    a.pitch = pitch;
    const v = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(NADE.speed);
    v.y += NADE.lift;
    g.grenades.throw(o.addScaledVector(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), 0.35), v, left, false, 'frag');
    a.rp.avatar.swing(true);
    say(`wall: a frag thrown ${flat.toFixed(1)} m and ${(-h).toFixed(1)} m down, the eye ${Math.round((-pitch * 180) / Math.PI)} degrees under level, ${left} s of its ${THROWN.frag?.fuse ?? '?'} left`);
  };
  const night = (t: number) => {
    storm(t, 2.6, 1.5, { light: true });
    // the one on the wall watches them come
    if (!thrown) A(5).face(A(0).rp.pos.clone().setY(A(0).rp.pos.y + 1.2));
  };
  add(3, {
    name: 'wall',
    hour: NIGHT,
    setup: () => {
      makeWays();
      wall.make('wall');
    },
    stage: async () => {
      for (const k of [0, 1]) stand(A(k), ways[k].at(0), 0, STORM[k].weapon, STORM[k].gear, ['gun_light']);
      const wy = under(WALL_AT.clone(), 1.5, 3) ?? WALL_AT.y;
      stand(A(5), WALL_AT.clone().setY(wy), yawTo(WALL_AT, RAMP_AT()), null, ['heavy_armor', 'helmet_k63']);
      thrown = false;
      await dressed();
      await run(36, (k) => night(-1 + k / 60));
    },
    lead: (t) => night(t),
    tick: (t) => {
      night(t);
      if (!thrown && t >= 0.4) {
        thrown = true;
        lob(A(5), RAMP_AT(), 2);
      }
    },
    cam: (t) => wall.cam(t),
  });

  // ============================================================ 2. high behind the fort: red's two from their end; ROUND 1
  const RED_FROM = () => [G(-30, -1.6), G(-30.5, 1.9)], RED_TO = () => [G(-17, -2.8), G(-17.5, 3.1)];
  let redWay: THREE.Vector3[][] = [];
  /** red's two, `t` seconds into the shot: going at a run from behind the back wall toward the fort's foot */
  const reds = (t: number) => {
    RED.forEach((k, i) => {
      const a = A(k), [f, to] = redWay[i], u = clamp01(((t + 1.2) * 5.6) / f.distanceTo(to));
      a.pos.lerpVectors(f, to, u);
      a.pos.y = under(a.pos.clone().setY(FP.y), 40, 120) ?? S.ground(a.pos.x, a.pos.z);
      a.yaw = yawTo(f, to);
      a.sprint = u < 1;
      a.aim = false;
    });
  };
  const back = fly(1.2, {
    rail: () => [F(-32, 23, 27), F(-30.5, 24, 26.4)],
    shape: [[0, 1], [1, 1]],
    gaze: () => [F(-6, 2, 4), F(-4, 1, 4.5)],
    fov: 42,
    hand: 0.2,
  });
  add(1.2, {
    name: 'round one',
    bars: false,
    hour: DAY,
    setup: () => {
      const f = RED_FROM(), to = RED_TO();
      redWay = [[f[0], to[0]], [f[1], to[1]]];
      back.make('back');
    },
    stage: async () => {
      RED.forEach((k, i) => stand(A(k), redWay[i][0], 0, GUN, [], MODS));
      await dressed();
      await run(36, (k) => reds(-1 + k / 60));
      says('live', 1, 0, 0);
    },
    lead: (t) => reds(t),
    tick: (t) => reds(t),
    cam: (t) => back.cam(t),
    after: () => beat(),
  });

  // ============================================================ 3. up the ramp behind blue, into the gate: the one on the landing falls
  const gate = fly(1.8, {
    rail: () => [F(17, gz, rampY(17) + H), F(14.4, gz, rampY(14.4) + H), F(11.8, gz - 0.3, rampY(11.8) + H), F(10.2, gz - 0.7, H), F(9.2, gz - 0.78, H), F(8.5, gz - 0.7, H + 0.05)],
    shape: [[0, 1], [0.65, 1], [1, 0.7]],
    gaze: () => [F(9, gz - 0.3, m(2)), F(7, gz - 0.4, m(2.4)), F(6, gz + 0.6, m(3.4)), F(5.9, 0.1, 3 + m(1.1))],
    fov: 46,
  });
  const fired = new Set<string>();
  /** once at its moment, whichever frame first passes it */
  const once = (key: string, t: number, at: number, fn: () => void) => {
    if (t >= at && !fired.has(key)) {
      fired.add(key);
      fn();
    }
  };
  /** the gate, `t` seconds into its shot: blue's two on the ramp, Bear on the landing with his rifle on them; Mira sees him and fires first */
  const inGate = (t: number) => {
    blue(3 + t);
    const bear = A(5), mira = A(1), on = A(0).rp.pos;
    if (bear.alive) bear.face(new THREE.Vector3(on.x, on.y + 1.2, on.z));
    if (t > 1.05) mira.face(bear.alive ? bear.chest() : bear.pos.clone().setY(bear.pos.y + 0.4));
    mira.aim = t > 1.1;
    // (Bear's one shot goes high; Mira's three do not)
    once('bear', t, 1.15, () => fire(bear, A(0).chest().add(new THREE.Vector3(0, 1.6, 0))));
    for (const [i, at] of [1.26, 1.37, 1.48].entries()) once(`mira${i}`, t, at, () => fire(mira, bear.chest()));
    once('down', t, 1.5, () => {
      bear.die(bear.chest().sub(mira.eye()).normalize());
      screen?.kill({ t: 'kill', by: mira.name, who: bear.name, w: GUN, head: false, ours: true, me: false });
    });
  };
  add(1.8, {
    name: 'gate',
    bars: false,
    hour: DAY,
    setup: () => {
      makeWays();
      gate.make('gate');
      fired.clear();
    },
    stage: async () => {
      for (const k of [0, 1]) stand(A(k), ways[k].at(0), 0, GUN, [], MODS);
      const at = F(C.keep.x1 + 0.85, 0.15, C.keep.floors[1]);
      stand(A(5), at, yawTo(at, F(ex - 1, gz, 0)), GUN, [], MODS);
      A(5).aim = true;
      await dressed();
      await run(36, (k) => inGate(-1 + k / 60));
      fired.clear();
      says('live', 1, 0, 0);
    },
    lead: (t) => inGate(t),
    tick: (t) => inGate(t),
    cam: (t) => gate.cam(t),
    after: () => beat(),
  });

  // ============================================================ 6. the front from the open ground: VICTORY, the scoreboard
  // (the two seconds of the cut ROUND WON with it; blue's two stood out of sight in the yard, not left mid-run on the ramp)
  add(2, {
    name: 'victory',
    bars: false,
    hour: DAY,
    stage: async () => {
      stand(A(0), F(5.4, gz - 1.6, 0), 0, GUN, [], MODS);
      stand(A(1), F(4.9, gz + 0.9, 0), 0, GUN, [], MODS);
      await dressed();
      await run(20);
      says('over', 8, 5, 3, true);
    },
    cam: (t) => hand({ p: G(rx + 17 - t * 0.5, gz + 5.5, 6.5), l: F(4, 0, 6), fov: 40 }, t, 0.25),
    after: () => beat(),
  });

  // ============================================================ the door: the site asks which game, and the Arena's own picture of it
  add(2, {
    name: 'door',
    hour: DAY,
    setup: () => {
      arena(false);
    },
    cam: (t) => hand({ p: G(rx + 12, gz + 4, 1.2), l: F(ex, gz, m(2.2)), fov: 40 }, t, 0.2),
    after: (t) => show(door12, t, ease(t / 0.25)),
  });

  // ============================================================ the end card: what is new, and where
  add(5, {
    name: 'end',
    hour: DAY,
    fadeOut: 0.4,
    setup: () => {
      arena(false);
    },
    cam: (t) => hand({ p: G(rx + 17, gz + 5.5, 6.5 + t * 0.2), l: F(4, 0, 6), fov: 40 }, t, 0.2),
    after: (t) => show(card12, t, ease(t / 0.35)),
  });

  // ------------------------------------------------------------ the length, from the shots
  total = cur;
  say(`${shots.length} shots, ${total.toFixed(1)} s: ${shots.map((q) => `${q.name} ${q.start}-${q.end}`).join(', ')}`);
  return shots;
}
