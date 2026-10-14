// The thirteenth film: thirty seconds of the Arena, and the wagers coming to it (2026-10-14). Asked for as "a new
// trailer for arena, and the wager match functionality thats coming how itll work"; its board said yes to. The match
// is the eleventh film's (shots11.ts), copied as it is; then WAGERS, COMING SOON, and how they will work, in four
// steps on screens made in the Arena's look (none is in the game yet, and each says so), with the owner's rules:
// 7.5% of the pot to the platform, 0.02 to 0.25 SOL a player, 1v1 to 3v3, the winning side splitting the pot.
//
//   title 0-2 · round one 2-3.2 · gate 3.2-5 · wall 5-6 · victory 6-8 · stamp 8-10 · host 10-13 · challenge 13-16 ·
//   play 16-20 · win 20-25 · end 25-30
//
// Its score is the ninth film's band (music9.ts), fifteen bars of two seconds.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import { scoreMusic9, type Row9 } from './music9';
import { physics, SOLID_GROUPS } from '../core/physics';
import { CASTLE, CASTLE_SCALE, UNDER, castleAt, castleLocal, moundTop, type FortPlace } from '../sim/castle';
import { F_AIM, F_LIGHT } from '../net/protocol';
import { ArenaHud } from '../ui/arena-hud';

/** how long the film is, seconds: said when its shots have been laid out */
let total = 0;
export const seconds13 = () => total;
/** its score: the ninth film's band, a bar of two seconds to each row */
const ROWS: Row9[] = [
  { kind: 'card', lift: 1 }, { kind: 'tight', hit: 1 }, { kind: 'tight', build: 0.8, lift: 1 }, { kind: 'board', hit: 1.2 }, { kind: 'paid', hit: 1.2 },
  { kind: 'tour', hit: 1 }, { kind: 'tour' }, { kind: 'groove', build: 0.6 }, { kind: 'tight', hit: 1 }, { kind: 'tight', build: 1, lift: 1 },
  { kind: 'paid', hit: 1.2 }, { kind: 'paid' }, { kind: 'next' }, { kind: 'next' }, { kind: 'end', hit: 1 },
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
  document.body.classList.add('tr-cut10', 'tr-cut11', 'tr-cut13');
  const overlay = document.getElementById('tr-overlay')!;
  const say = (...a: unknown[]) => console.log('[tr] cut 13:', ...a);

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
  const trunks = ((world.trees ?? []) as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush'));
  /** no tree stands within its own branches' reach of the line from one place to another (a ray finds trunks; the eye finds the boughs) */
  const open = (a: THREE.Vector3, b: THREE.Vector3, reach: number) => {
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
    for (const t of trunks) {
      const k = clamp01(((t.x - a.x) * dx + (t.z - a.z) * dz) / len2);
      if (Math.hypot(a.x + dx * k - t.x, a.z + dz * k - t.z) < reach) return false;
    }
    return true;
  };

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

  // ------------------------------------------------------------ where the first frame is taken from (the tenth film's)
  const frontSite = () => {
    const foot = F(rx, gz, rampY(rx)), gateAt = F(ex + 1.6, gz, m(2.2)), rampAt = F(rx - 2, gz, rampY(rx - 2) + m(1.3));
    const marks = [gateAt, F(C.hx + 4.6, -C.hz, 3.5), F(C.hx + 4.6, C.hz, 2.5), F(C.keep.x1 + 1.2, 0, C.keep.band + 2.5), rampAt];
    const axis = F(1, 0).sub(F(0, 0)).setY(0).normalize();
    let best: { eye: THREE.Vector3; d: number; frontal: number; on: boolean } | null = null, top = -1e9;
    const judge = (p: THREE.Vector3, on: boolean) => {
      const d = Math.hypot(p.x - foot.x, p.z - foot.z);
      if (d < 26 || d > 52) return;
      const gy = under(p.clone().setY(FP.y), 40, 120) ?? S.ground(p.x, p.z), eye = new THREE.Vector3(p.x, gy + 2.1, p.z);
      const frontal = -gateAt.clone().sub(eye).setY(0).normalize().dot(axis);
      // (not from the side, and not from over it)
      if (frontal < (on ? 0.9 : 0.75) || eye.y > FP.y + 5) return;
      // (On the way in, the way itself is the clearing: the gate and the ramp are seen along it, and what stands either
      // side of it frames them. Off it, the whole of the front must be seen, with no tree's boughs across any of it.)
      if (on ? !(S.clearLine(eye, gateAt) && S.clearLine(eye, rampAt)) : !(marks.every((mk) => S.clearLine(eye, mk)) && marks.slice(0, 4).every((mk) => open(eye, mk, 3.4)))) return;
      const s = frontal * 34 - Math.abs(d - 38) * 0.4 + (on ? 30 : 0);
      if (s > top) {
        top = s;
        best = { eye, d, frontal, on };
      }
    };
    // THE WAY IN: whichever of the world's ways comes to the foot of the ramp (the cart track up the shoulder of the hill, since the fort was turned to face it)
    for (const w of (world.paths ?? []) as { line: [number, number][] }[]) {
      if (!w.line.some(([x, z]) => Math.hypot(x - foot.x, z - foot.z) < 16)) continue;
      for (let k = 0; k + 1 < w.line.length; k++) {
        const [ax, az] = w.line[k], [bx, bz] = w.line[k + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
        for (let i = 0; i < n; i++) judge(new THREE.Vector3(ax + ((bx - ax) * i) / n, 0, az + ((bz - az) * i) / n), true);
      }
    }
    // and, where no way looks at the front, the open ground before the gate
    if (!best) for (let r = 26; r <= 50; r += 2) for (let a = -48; a <= 48; a += 6) judge(F(rx + m(r) * Math.cos((a * Math.PI) / 180), gz + m(r) * Math.sin((a * Math.PI) / 180)), false);
    if (!best) {
      say('front: no place before the gate sees the whole of the front through the trees: the lens stands straight out from it');
      best = { eye: G(rx + m(40), gz, 2.1), d: 40, frontal: 1, on: false };
    }
    const b = best, toFoot = foot.clone().sub(b.eye).setY(0).normalize();
    // (the lens goes toward the ramp's foot, a man's height and a half over whatever the ground is)
    const pts = [0, 2.6, 5.2, 7.8].map((k) => {
      const p = b.eye.clone().addScaledVector(toFoot, k);
      return p.setY((under(p.clone().setY(FP.y), 40, 120) ?? S.ground(p.x, p.z)) + 2.1 - k * 0.03);
    });
    const left = new THREE.Vector3(toFoot.z, 0, -toFoot.x), mid = F(C.keep.x1, gz, m(4.6));
    say(`front: the lens stands ${b.d.toFixed(0)} m from the ramp's foot${b.on ? ', on the way in' : ''}, ${Math.round((Math.acos(Math.min(1, b.frontal)) * 180) / Math.PI)} degrees off square to the gate, ${(b.eye.y - FP.y).toFixed(1)} m ${b.eye.y > FP.y ? 'over' : 'under'} the terrace`);
    // (it looks to the left of the fort while the name is up on that side, and comes round to the gate)
    return { pts, gaze: [mid.clone().addScaledVector(left, b.d * 0.31), mid.clone().addScaledVector(left, b.d * 0.2), mid.clone().addScaledVector(left, b.d * 0.09)] };
  };
  let site: ReturnType<typeof frontSite> | null = null;
  const front = fly(3, {
    rail: () => (site ??= frontSite()).pts,
    shape: [[0, 0.12], [0.4, 1], [1, 1]],
    gaze: () => (site ??= frontSite()).gaze,
    fov: 41,
    hand: 0.25,
  });
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

  // its words: the name on the first frame, and the end card
  const title = Gx('x11-title', `
    <div class="t11-kick">ZONA PvP &nbsp;·&nbsp; TEAM MATCHES</div>
    <div class="t11-name">ARE<span>NA</span></div>
    <div class="t11-line">TEAM AGAINST TEAM AT THE FORT</div>`);

  // ============================================================ 1. the front, ARENA on it; blue's two up the open ground
  /** blue's two, `T` seconds into the film: on the open ground before the ramp as it opens (the tenth film's charge) */
  const blue = (T: number) => storm(T - 3, 3.4, -8.6);
  add(2, {
    name: 'title',
    hour: DAY,
    settle: 420,
    setup: () => {
      arena(false);
      makeWays();
      front.make('front');
    },
    stage: async () => {
      for (const k of [0, 1]) stand(A(k), ways[k].at(0), 0, GUN, [], MODS);
      await dressed();
      await run(36, (k) => blue(-1 + k / 60));
    },
    lead: (t) => blue(t),
    tick: (t) => blue(t),
    cam: (t) => front.cam(t),
    after: (t) => {
      if (t < 1.8) show(title, t, 1 - ease((t - 1.5) / 0.3));
      else title.style.display = 'none';
    },
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

  // ============================================================ 4. on the wall over the gate, over red's shoulder: his rifle on blue down the ramp
  // (the tenth film's own place for it: its defender stood here, and its lens rose behind him; see shots10.ts)
  const WALL_AT = F(9.05, -5.35, 0), RAMP_AT = () => F(14.8, gz, rampY(14.8));
  const wall = fly(1, {
    rail: () => [F(7.9, -6.6, 1.9), F(7.7, -6.75, 2.5)],
    shape: [[0, 1], [1, 1]],
    gaze: () => [F(14, gz + 0.2, -0.6), F(15, gz, -0.9)],
    fov: 50,
  });
  /** Kestrel on the wall walk over the gate, his rifle on blue's two coming up the ramp: two shots */
  const onWall = (t: number) => {
    blue(4.4 + t);
    const k = A(2), them = A(0).rp.pos.clone().setY(A(0).rp.pos.y + 1.2);
    k.face(them);
    k.aim = true;
    once('k0', t, 0.2, () => fire(k, them));
    once('k1', t, 0.48, () => fire(k, them));
  };
  add(1, {
    name: 'wall',
    bars: false,
    hour: DAY,
    setup: () => {
      makeWays();
      wall.make('wall');
      fired.clear();
    },
    stage: async () => {
      for (const k of [0, 1]) stand(A(k), ways[k].at(0), 0, GUN, [], MODS);
      const wy = under(WALL_AT.clone(), 1.5, 3) ?? WALL_AT.y;
      stand(A(2), WALL_AT.clone().setY(wy), yawTo(WALL_AT, RAMP_AT()), GUN, [], MODS);
      await dressed();
      await run(36, (k) => onWall(-1 + k / 60));
      fired.clear();
    },
    lead: (t) => onWall(t),
    tick: (t) => onWall(t),
    cam: (t) => wall.cam(t),
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

  // ============================================================ THE WAGERS: how they will work
  // (None of it is in the game yet, and every screen of it says so. The owner's rules for them, 2026-10-14: 7.5% of the
  // pot to the platform, 0.02 to 0.25 SOL a player, 1v1 to 3v3, every player stakes and the winning side splits. The
  // film's example is a 2v2 at 0.1 SOL each, and its sums are made here, not typed.)
  const FEE = 0.075, STAKE = 0.1, SIDE = 2, POT = STAKE * SIDE * 2, WON = POT * (1 - FEE);
  const sol = (x: number) => `${+x.toFixed(3)} SOL`;
  const SOON = '<span class="w13-soon">COMING SOON</span>';
  const stamp = Gx('x13-stamp', '<div class="w13-stamp">WAGERS<small>COMING SOON</small></div><div class="w13-line">STAKE SOL ON YOUR ARENA MATCHES</div>');
  const host = Gx('x13-pan', '');
  const chal = Gx('x13-pan', '');
  const potChip = Gx('x13-pot', `<span class="w13-step">3 · PLAY</span><b>POT ${sol(POT)}</b>`);
  const win = Gx('x13-pan', '');
  const card13 = Gx('x13-end', `
    <div class="c13-name">ARE<span>NA</span></div>
    <div class="c13-stamp">WAGERS COMING SOON</div>
    <div class="c13-how">1V1 TO 3V3 &nbsp;·&nbsp; 0.02 TO 0.25 SOL A PLAYER &nbsp;·&nbsp; WINNERS SPLIT THE POT, LESS 7.5%</div>
    <div class="c13-url">ZONAPVP.FUN/ARENA</div>`);
  /** a row of a panel: what, and how much */
  const row = (what: string, much: string, cls = '') => `<div class="w13-r ${cls}"><span>${what}</span><span>${much}</span></div>`;
  /** the rows of a panel that come one at a time: shown from their moments on */
  const rowsFrom = (el: HTMLElement, t: number, at: number[]) =>
    el.querySelectorAll<HTMLElement>('.w13-r').forEach((r, i) => r.style.setProperty('--r', ease((t - (at[i] ?? 0)) / 0.25).toFixed(3)));

  /** blue's two out of sight in the yard, standing: wherever the film is not looking at them */
  const aside = async () => {
    stand(A(0), F(5.4, gz - 1.6, 0), 0, GUN, [], MODS);
    stand(A(1), F(4.9, gz + 0.9, 0), 0, GUN, [], MODS);
    await dressed();
  };
  /** a slow circuit round the fort from high up, the fort kept to the right of the picture (the Arena menu's own, src/game/game/drops.ts) */
  const circuit = (a: number): CamPose => {
    const x = FP.x + Math.cos(a) * 80, z = FP.z + Math.sin(a) * 80, ground = FP.y - 8;
    const p = new THREE.Vector3(x, Math.max(ground + 44, S.ground(x, z) + 30), z);
    const fx = FP.x - x, fz = FP.z - z, len = Math.hypot(fx, fz) || 1;
    // (the menu's 52 m aside left the fort at the picture's very edge on a film's frame: 30)
    return { p, l: new THREE.Vector3(FP.x + (fz / len) * 30, ground + 7, FP.z - (fx / len) * 30), fov: 50 };
  };

  // ============================================================ 8. WAGERS, COMING SOON: the stamp comes down on the fort
  add(2, {
    name: 'stamp',
    hour: DAY,
    setup: () => {
      arena(false);
    },
    stage: async () => {
      await aside();
      await run(20);
    },
    cam: (t) => hand({ p: G(rx + 26 - t * 0.6, gz + 7, 9), l: F(4, 0, 6), fov: 42 }, t, 0.2),
    // (it comes down out of the camera, big, and lands a sixth of a second in, on the beat)
    after: (t) => {
      const k = ease(t / 0.16);
      show(stamp, t, Math.min(1, t / 0.08));
      stamp.style.setProperty('--s', (2.4 - 1.4 * k).toFixed(3));
      stamp.style.setProperty('--l', ease((t - 0.5) / 0.3).toFixed(3));
    },
  });

  // ============================================================ 9. 1 · HOST: the size, the rounds, the loadout, the stake
  add(3, {
    name: 'host',
    hour: DAY,
    bars: false,
    setup: () => {
      arena(false);
      host.innerHTML = `${SOON}<div class="w13-h">1 · <b>HOST</b></div>${row('Match', `${SIDE}v${SIDE} · first to 5`)}${row('Loadout', 'Assault')}${row('Stake a player', sol(0.02), 'w13-stake')}<div class="w13-hint">0.02 to 0.25 SOL a player</div><div class="w13-go">Host wager</div>`;
    },
    stage: async () => {
      await aside();
      await run(20);
    },
    cam: (t) => circuit(2.2 + t * 0.05),
    // (the stake is turned up to its 0.1, and the match is hosted)
    after: (t) => {
      show(host, t, ease(t / 0.3));
      rowsFrom(host, t, [0.2, 0.35, 0.5]);
      const v = 0.02 + (STAKE - 0.02) * ease((t - 0.8) / 0.8);
      (host.querySelector('.w13-stake span:last-child') as HTMLElement).textContent = sol(Math.round(v * 100) / 100);
      host.querySelector('.w13-go')!.classList.toggle('on', t > 2.1 && t < 2.35);
    },
  });

  // ============================================================ 10. 2 · CHALLENGE: it is listed; each who joins puts the stake in
  add(3, {
    name: 'challenge',
    hour: DAY,
    bars: false,
    setup: () => {
      arena(false);
      chal.innerHTML = `${SOON}<div class="w13-h">2 · <b>CHALLENGE</b></div>${row(`${A(0).name}'s match`, `${SIDE}v${SIDE} · first to 5`)}${row('Stake', `${sol(STAKE)} each`)}${row('Players', '1 / 4', 'w13-n')}${row('Pot', sol(STAKE), 'w13-pot')}<div class="w13-go">Join · pay ${sol(STAKE)}</div>`;
    },
    stage: async () => {
      await aside();
      await run(20);
    },
    cam: (t) => circuit(2.2 + (3 + t) * 0.05),
    // (three come in, one at a time, and the pot goes up by a stake each time)
    after: (t) => {
      show(chal, t, ease(t / 0.3));
      rowsFrom(chal, t, [0.2, 0.3, 0.4, 0.5]);
      const n = 1 + [0.7, 1.3, 1.9].filter((at) => t >= at).length;
      (chal.querySelector('.w13-n span:last-child') as HTMLElement).textContent = `${n} / ${SIDE * 2}`;
      (chal.querySelector('.w13-pot span:last-child') as HTMLElement).textContent = sol(STAKE * n);
      chal.querySelector('.w13-go')!.classList.toggle('on', t > 0.6 && t < 0.85);
      chal.classList.toggle('full', n === SIDE * 2);
    },
  });

  // ============================================================ 11. 3 · PLAY: the match as it is now, the pot on the score bar
  /** blue's two at a run up the open ground to the ramp, `t` seconds into the shot */
  const charge = (t: number) => storm(t, 6.2, 22);
  add(4, {
    name: 'play',
    hour: DAY,
    bars: false,
    setup: () => {
      makeWays();
    },
    stage: async () => {
      for (const k of [0, 1]) stand(A(k), ways[k].at(0), 0, GUN, [], MODS);
      await dressed();
      await run(36, (k) => charge(-1 + k / 60));
      says('live', 4, 2, 1);
    },
    lead: (t) => charge(t),
    tick: (t) => charge(t),
    // (close behind them as they run at the gate, a little to one side: the draft's lens stood by the ramp's foot,
    // and the burning jeep filled the picture)
    cam: (t) => {
      const mid = A(0).pos.clone().add(A(1).pos).multiplyScalar(0.5), gate = F(ex, gz, m(1.5));
      const dir = gate.clone().sub(mid).setY(0).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
      const p = mid.clone().addScaledVector(dir, -5.5).addScaledVector(side, 1.4).setY(mid.y + 2.1);
      return hand({ p, l: mid.clone().addScaledVector(dir, 14).setY(mid.y + 1.6), fov: 52 }, t, 0.35);
    },
    after: (t) => {
      beat();
      show(potChip, t, ease((t - 0.2) / 0.3));
    },
  });

  // ============================================================ 12. 4 · WIN THE POT: the winning side splits it, less the platform's 7.5%
  add(5, {
    name: 'win',
    hour: DAY,
    bars: false,
    setup: () => {
      arena(false);
      win.innerHTML = `${SOON}<div class="w13-h">4 · <b>WIN THE POT</b></div>${row('Pot', sol(POT))}${row(`Platform ${+(FEE * 100).toFixed(1)}%`, `−${sol(POT * FEE)}`)}${row('To the winners', sol(WON), 'w13-big')}${row(`Each of ${SIDE}`, `+${sol(WON / SIDE)}`, 'w13-big w13-gold')}<div class="w13-hint">Paid to your wallet by itself</div>`;
    },
    stage: async () => {
      await aside();
      await run(20);
    },
    cam: (t) => hand({ p: G(rx + 12, gz + 4, 1.2 + t * 0.12), l: F(ex, gz, m(2.2)), fov: 40 }, t, 0.2),
    after: (t) => {
      show(win, t, ease(t / 0.3));
      rowsFrom(win, t, [0.4, 0.9, 1.5, 2.2]);
      win.querySelector('.w13-hint')!.classList.toggle('on', t > 2.9);
    },
  });

  // ============================================================ 13. the end card: what the Arena is, what is coming, and where
  add(5, {
    name: 'end',
    hour: DAY,
    fadeOut: 0.4,
    setup: () => {
      arena(false);
    },
    stage: async () => {
      await aside();
      await run(20);
    },
    cam: (t) => circuit(3.4 + t * 0.04),
    after: (t) => show(card13, t, ease(t / 0.35)),
  });

  // ------------------------------------------------------------ the length, from the shots
  total = cur;
  say(`${shots.length} shots, ${total.toFixed(1)} s: ${shots.map((q) => `${q.name} ${q.start}-${q.end}`).join(', ')}`);
  return shots;
}
