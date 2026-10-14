// The tenth film: twenty seconds of the fort. Made the way the others were: the real game on a clock that only
// moves when the film says.
//
// It was asked for as "a 20 second trailer showing off the castle and slow flying through dynamic parts of the
// build and showing good pvp angles we built". So: one slow flight through the parts of the fort that move a
// fight, each seen from where somebody would fight from. Six shots:
//   1  the front over the snow, with its name                                          0 to 3 s, by day
//   2  up the ramp and through the gate, behind two who are storming it                3 to 6
//   3  in at the breach, off the lip of the hole in the north walk (the drop a player
//      can take) and down it into the cistern, behind one who takes it                 6 to 11, and under
//   4  the vaults: the armoury, its grille and its lantern                             11 to 13
//   5  the wall over the way in, over a defender's shoulder, and up beside the tower    13 to 16, by night
//   6  what burns before the gate with the gate behind it, up to the whole of the
//      fort under its mast's light, and where it is played                              16 to 20
//
// WHERE EVERYTHING IS. The fort is turned and its ground reshaped from time to time, and this film must come out
// right without a line of it changing. So nothing here is a place in the world. Every lens, mark and body is
// said in the fort's own measure (`F`: x toward the gate, z toward the steep side, y over the terrace, as
// src/sim/castle.ts says them) or is found from the world as the film is made (the ground by a ray, the way in
// from `world.paths`, the trees from `world.trees`).
//
// What a film may not do, learnt from the eighth and the ninth: nothing runs at any speed but its own (no shot
// has a `rate`); whoever is in a shot is moving when it opens (`lead`); a lens goes along a rail at a speed that
// is said in metres a second, and is told to whoever films it (the `[tr]` lines).
//
// DAY AND NIGHT. It was asked for both, "so we get an atmosphereic feel": the front, the gate and the breach by
// day; under the terrace it is always night, with the fort's own lanterns; and it comes out again into the night,
// for the wall over the way in and for the last shot, the gate seen over what burns before it. The hour is the
// game's own, held (`hourHeld`), and nothing is brightened: what lights the night is the fort's fires and lamps,
// the mast's red light, and the torches on the guns of whoever comes.
//
// Its score is its own (music10.ts): slow and grand, written to the moments these shots make.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import { describe10, scoreMusic10, type Marks10 } from './music10';
import { physics, SOLID_GROUPS } from '../core/physics';
import { CASTLE, CASTLE_SCALE, UNDER, castleAt, castleLocal, inCastle, moundTop, type FortPlace } from '../sim/castle';
import { POST } from '../sim/castle-post';
import { NADE, THROWN } from '../sim/grenades';
import { F_AIM, F_LIGHT } from '../net/protocol';

/** how long the film is, seconds: said when its shots have been laid out */
let total = 0;
export const seconds10 = () => total;
/** the moments of the film its score is written to: said by the shots as they are laid out */
const MARKS: Marks10 = { under: 8, out: 13, wide: 16, home: 18, end: 20 };
/** its score, written to its own shots */
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic10(ctx, out, MARKS);

/** trailer.html?cut=10&scout=1: not the film but a walk round its places, a still of each (to choose where a lens goes) */
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
  /** moments of the score that this shot makes, seconds into it (see Marks10) */
  marks?: Partial<Marks10>;
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
  document.body.classList.add('tr-cut10');
  const overlay = document.getElementById('tr-overlay')!;
  const say = (...a: unknown[]) => console.log('[tr] cut 10:', ...a);

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
  const UF = U.floor, CF = UF - U.cistern.deep;
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
  const name = Gx('x10-name', `
    <div class="n10-kick">ZONA &nbsp;·&nbsp; THE MOUNTAIN FORT</div>
    <div class="n10-name">${POST.name.toUpperCase()}</div>
    <div class="n10-line">THE EAGLE'S NEST</div>`);
  const plate = Gx('x10-plate', '<span></span>');
  const end = Gx('x10-end', `
    <div class="e10-logo">ZONA</div>
    <div class="e10-url">WWW.ZONAPVP.FUN</div>`);

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
    for (const k of Object.keys(s.marks ?? {}) as (keyof Marks10)[]) MARKS[k] = start + s.marks![k]!;
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
  const STORM = [{ weapon: 'ak', gear: ['armor_vest', 'helmet_m1', 'sack_pack'] }, { weapon: 'ar15', gear: ['chest_rig', 'patrol_cap', 'camping_pack'] }];
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

  // ============================================================ 1. the front, with its name: the first frame is the picture the film is known by
  /**
   * Where the first frame is taken from, and the few metres the lens then goes. Looked for when the film is made, in
   * the world as it then is: on the way in (`world.paths`: the track that comes to the ramp's foot), where the gate
   * is ahead and the ramp is seen; or, in a world whose way in does not look at the front, on the open ground before
   * the gate, at a place the gate, both its towers, the keep over them and the ramp are all seen from with no tree's
   * boughs across any of them. As square on to the gate as there is. Then toward the ramp's foot.
   */
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
  /** when the film is so far in, how far the two have gone (they are on the open ground before the ramp as it opens, and half way up it three seconds in) */
  const charge = (T: number) => storm(T - 3, 3.4, -8.6);
  add(3, {
    name: 'front',
    hour: DAY,
    // (long enough for what burns before the gate to be burning: its flames are fed up from nothing when an eye first comes)
    settle: 420,
    setup: () => {
      makeWays();
      front.make('front');
    },
    stage: async () => {
      for (const k of [0, 1]) stand(A(k), ways[k].at(0), 0, STORM[k].weapon, STORM[k].gear);
      await dressed();
      await run(36, (k) => charge(-1 + k / 60));
    },
    lead: (t) => charge(t),
    tick: (t) => charge(t),
    cam: (t) => front.cam(t),
    after: (t) => {
      if (t < 2.4) show(name, t, 1 - ease((t - 1.9) / 0.5));
      else name.style.display = 'none';
    },
  });

  // ============================================================ 2. up the ramp and through the gate, behind the two
  const gate = fly(3, {
    rail: () => [F(17, gz, rampY(17) + H), F(14.4, gz, rampY(14.4) + H), F(11.8, gz - 0.3, rampY(11.8) + H), F(10.2, gz - 0.7, H), F(9.2, gz - 0.78, H), F(8.5, gz - 0.7, H + 0.05)],
    shape: [[0, 1], [0.65, 1], [1, 0.7]],
    gaze: () => [F(9, gz - 0.3, m(2)), F(7, gz - 0.4, m(2.4)), F(6, gz + 0.6, m(3.4)), F(5.9, 0.1, 3 + m(1.1))],
    fov: 46,
  });
  let held = false;
  /** the gate, `t` seconds into its shot: the two on the ramp, and the one on the landing with his rifle on whoever is nearest him */
  const inGate = (t: number) => {
    charge(3 + t);
    const d = A(5), on = A(0).rp.pos;
    d.face(new THREE.Vector3(on.x, on.y + 1.2, on.z));
    // (the second of the two, in at the gate, has seen him)
    if (t > 2.2) A(1).face(d.chest());
    A(1).aim = t > 2.3;
  };
  add(3, {
    name: 'gate',
    hour: DAY,
    setup: () => {
      makeWays();
      gate.make('gate');
    },
    stage: async () => {
      for (const k of [0, 1]) stand(A(k), ways[k].at(0), 0, STORM[k].weapon, STORM[k].gear);
      // and one who holds the keep's doorway, on its landing over the gate: three metres up, a few paces from whoever comes in
      const at = F(C.keep.x1 + 0.85, 0.15, C.keep.floors[1]);
      stand(A(5), at, yawTo(at, F(ex - 1, gz, 0)), 'mosin', ['heavy_armor', 'helmet_k63']);
      A(5).aim = true;
      held = false;
      await dressed();
      await run(36, (k) => inGate(-1 + k / 60));
    },
    lead: (t) => inGate(t),
    tick: (t) => {
      inGate(t);
      // (one round down at the gate as they come through it, wide: a fight glimpsed)
      if (!held && t >= 2.45) {
        held = true;
        fire(A(5), A(1).chest().add(new THREE.Vector3(0, 0.2, 0.9)));
      }
    },
    cam: (t) => gate.cam(t),
  });

  // ============================================================ 3. the breach, the drop, the cistern: a way in that is not the gate
  /** when the lens is under the terrace, seconds into the shot */
  const UNDER_AT = 2;
  const drop = fly(5, {
    rail: () => [F(-5.2, -12, EYE), F(-4.6, -10.6, EYE), F(-3.7, -9, EYE), F(-2.9, -8.2, EYE - 0.1), F(-2.15, -7.8, 0.5), F(-1.6, -7.7, -1), F(-1.05, -7.55, -2.3), F(-0.2, -7.4, WATER), F(0.9, -7.35, WATER), F(1.8, -7.35, WATER)],
    shape: [[0, 1], [0.42, 1], [0.58, 0.85], [0.74, 0.5], [1, 0.42]],
    gaze: () => [F(-1.2, -7.3, 0.9), F(-1.4, -7.5, -0.6), F(-0.8, -7.5, -3.6), F(2.6, -7.3, -2.9), F(5.5, -6.8, -2.7)],
    fov: 50,
  });
  // the one who drops: along the head of the rubble from the east, in at the breach, off the lip of the hole, and down
  /** where he comes down: in the corner of the hole, clear of where the lens comes down it */
  const LAND = () => F(-2.05, -7.95, CF);
  let dropWay: Rail | null = null;
  const LIP = 0.7, FALL = Math.sqrt((2 * (0 - CF) * K) / 9.81);
  const dropper = (t: number) => {
    const a = A(2), R = dropWay!, lip = R.len;
    const land = LAND();
    if (t < LIP) {
      // (at a run, and down to a walk for the last steps to the edge)
      const left = LIP - t, s = lip - (left < 0.6 ? 2 * left + (left * left * 2.2) / 1.2 : 2 * 0.6 + (0.36 * 2.2) / 1.2 + (left - 0.6) * 4.2);
      onWay(a, R, s);
      a.sprint = false;
      a.crouch = false;
      a.aim = false;
      flying.delete(a);
    } else if (t < LIP + FALL) {
      const k = t - LIP, from = R.at(lip - 0.05);
      a.pos.set(from.x + ((land.x - from.x) * k) / FALL, from.y - 0.5 * 9.81 * k * k, from.z + ((land.z - from.z) * k) / FALL);
      a.yaw = yawTo(from, land);
      flying.add(a);
    } else {
      // (down: on one knee for a breath, then up with the gun to the dark end)
      a.pos.copy(land);
      flying.delete(a);
      a.crouch = t < LIP + FALL + 0.45;
      a.aim = !a.crouch;
      a.face(F(4.3, -7.3, CF + m(1.2)));
      a.more = F_LIGHT;
    }
  };
  // the one below: at the dark end of the aisle, who turns to the splash
  const below = (t: number) => {
    const a = A(3), at = F(4.2, -7.35, CF), heard = LIP + FALL + 0.15;
    a.pos.copy(at);
    const away = yawTo(at, F(5.2, -5.4, CF)), toward = yawTo(at, LAND()), k = ease((t - heard) / 0.55);
    a.yaw = away + Math.atan2(Math.sin(toward - away), Math.cos(toward - away)) * k;
    a.aim = k > 0.9;
    a.more = F_LIGHT;
  };
  let shotsFired = 0;
  add(5, {
    name: 'drop',
    hour: DAY,
    marks: { under: UNDER_AT },
    setup: () => drop.make('drop'),
    stage: async () => {
      dropWay = rail([F(1.2, -11.7, moundAt(1.2)), F(-1.6, -11.6, moundAt(-1.6)), F(-3.3, -11.3, 0), F(-4.2, -10.3, 0), F(-3.5, -9, 0), F(-2.5, -8.05, 0)]);
      stand(A(2), dropWay.at(0), 0, 'mpa', ['soft_vest', 'boonie_hat', 'sack_pack'], ['gun_light']);
      stand(A(3), F(4.2, -7.35, CF), 0, 'ak', ['life_vest', 'helmet_k63'], ['gun_light']);
      shotsFired = 0;
      await dressed();
      await run(36, (k) => {
        dropper(-1 + k / 60);
        below(-1 + k / 60);
      });
    },
    lead: (t) => {
      dropper(t);
      below(t);
    },
    tick: (t) => {
      dropper(t);
      below(t);
      // a fight glimpsed: three rounds from the one who dropped, two back
      const from = LIP + FALL + 0.75, due = [from, from + 0.14, from + 0.28, from + 0.5, from + 0.72];
      while (shotsFired < due.length && t >= due[shotsFired]) {
        const mine = shotsFired < 3, a = A(mine ? 2 : 3), b = A(mine ? 3 : 2);
        // (wide of each other, and over: nobody is hit, in a film that keeps no score)
        fire(a, b.chest().add(new THREE.Vector3(0, 0.95, mine ? 0.5 : -0.5)));
        shotsFired++;
      }
    },
    cam: (t) => drop.cam(t),
    plates: [[0.2, 1.35, 'THE BREACH'], [1.7, 2.9, 'THE DROP']],
  });

  // ============================================================ 4. the vaults: the armoury, its grille and its lantern
  // (From inside it, looking at the one door it has: whoever is in here sees who comes, and can be shut in.)
  const arm = fly(2, {
    rail: () => [F(0.55, -1.2, UF + EYE), F(0.15, -0.45, UF + EYE), F(-0.2, 0.3, UF + EYE)],
    shape: [[0, 1], [1, 0.9]],
    gaze: () => [F(-1.3, 3.3, UF + 1.2), F(-1.2, 3.35, UF + 1.25), F(-1.1, 3.4, UF + 1.3)],
    fov: 50,
  });
  // somebody comes in by it: along the passage, past the grille, his gun and its torch before him
  let armWay: Rail | null = null;
  const comer = (t: number) => {
    const a = A(4);
    onWay(a, armWay!, 1.75 + 1.5 * t);
    a.aim = true;
    a.more = F_LIGHT;
  };
  add(2, {
    name: 'armoury',
    hour: DAY,
    setup: () => arm.make('armoury'),
    stage: async () => {
      armWay = rail([F(-1.1, 6.6, UF), F(-1.1, 4.6, UF), F(-0.95, 3.3, UF), F(-0.5, 2.3, UF), F(0.25, 1.5, UF)]);
      stand(A(4), armWay.at(0), 0, 'ak', ['armor_vest', 'helmet_m1', 'camping_pack'], ['gun_light']);
      await dressed();
      await run(36, (k) => comer(-1 + k / 60));
    },
    lead: (t) => comer(t),
    tick: (t) => comer(t),
    cam: (t) => arm.cam(t),
    plates: [[0.2, 1.8, 'THE VAULTS']],
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
    marks: { out: 0 },
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
  const HOME_AT = 2;
  add(4, {
    name: 'high',
    hour: NIGHT,
    marks: { wide: 0, home: HOME_AT },
    fadeOut: 0.35,
    setup: () => high.make('high'),
    cam: (t) => high.cam(t),
    after: (t) => {
      if (t >= HOME_AT) show(end, t - HOME_AT, ease((t - HOME_AT) / 0.3));
      else end.style.display = 'none';
    },
  });

  // ------------------------------------------------------------ the score, from the shots
  total = cur;
  MARKS.end = total;
  say(`${shots.length} shots, ${total.toFixed(1)} s: ${shots.map((q) => `${q.name} ${q.start}-${q.end}`).join(', ')}`);
  say(`the fort is at ${FP.x.toFixed(1)}, ${FP.z.toFixed(1)}, its terrace at ${FP.y.toFixed(1)}, turned ${((FP.rot * 180) / Math.PI).toFixed(1)} degrees`);
  for (const line of describe10(MARKS)) say(`score: ${line}`);
  return shots;
}
