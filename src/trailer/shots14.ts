// The fourteenth film: "What goes up" (2026-10-14). About two minutes, the real game on a clock that only moves when
// the film says, as the others were. Asked for as "we should choreograph a story and make a short film with in game
// footage etc showing off in game mechanics"; its board (marketing/plan-film-10.html) was said yes to, with "stick
// together" for its ending.
//
// The story: a supply drop falls by the fort. A pair in a jeep and a lone pilot race for it. The pilot is shot out of
// the sky and the crash brings the infected; one of the pair is bleeding and the other keeps them alive; they take the
// pilot's tag and are paid. Then what is so of the game today, and what is next, and where it is played.
//
// Its people: Volkov and Mira, the pair (the cast's first two); Sable, the pilot (the seventh, added for this film).
// Every figure on the screen is read off the rules or the world as the film is made, or written below with where
// it is from. Nothing runs at any speed but its own.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import { scoreMusic14, type Kind14, type Row14 } from './music14';
import { physics, SOLID_GROUPS } from '../core/physics';
import { CASTLE, castleAt, type FortPlace } from '../sim/castle';
import { WORLD_SIZE } from '../world/worldgen/places';
import { HELI, heliSpots } from '../sim/heli';
import { flightTimes, planFlight, type Flight } from '../sim/airdrop';
import { ITEMS, makeItem } from '../sim/items';
import { SEATS_OF } from '../game/garage';
import { RIDE_HEIGHT } from '../sim/vehicles';

/** how long the film is, seconds: said when its shots have been laid out */
let total = 0;
export const seconds14 = () => total;
/** its score, a bar of two seconds to each row, written from its own shots (see `add`) */
const ROWS: Row14[] = [];
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic14(ctx, out, ROWS);

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
  /** how many frames nobody sees are run when the hour has been turned to (unsaid: two and a half seconds' worth) */
  settle?: number;
  /** its people put where they are, after the hour has been turned to */
  stage?: () => void | Promise<void>;
  /** what the score plays under it (one kind for all its bars), and a blow as it opens */
  m?: Kind14;
  hit?: number;
  lift?: boolean;
  under?: boolean;
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
  const say = (...a: unknown[]) => console.log('[tr] cut 14:', ...a);

  // ------------------------------------------------------------ places
  /** a spot of the fort, by its own measure (x toward the gate, z toward the steep side, y over the terrace) */
  const F = (x: number, z: number, y = 0) => {
    const [wx, wy, wz] = castleAt(FP, x, z, y);
    return new THREE.Vector3(wx, wy, wz);
  };
  /** what is underfoot at a spot: the top of whatever stops a body under it, looked for from so far over it to so far under */
  const under = (p: THREE.Vector3, up = 1.2, far = 30): number | null => {
    const hit = physics.raycast({ x: p.x, y: p.y + up, z: p.z }, { x: 0, y: -1, z: 0 }, up + far, SOLID_GROUPS);
    return hit ? p.y + up - hit.toi : null;
  };
  /** a spot on the world, so far over whatever is under it */
  const G = (x: number, z: number, up = 0) => new THREE.Vector3(x, (under(new THREE.Vector3(x, S.ground(x, z), z), 60, 90) ?? S.ground(x, z)) + up, z);
  const yawTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
  // (the fort's own measures, as the tenth and twelfth films have them: its gate's middle, and where its ramp's boards begin)
  const C = CASTLE;
  const ex = C.hx + C.parapet.thick / 2, gz = (C.gate.z0 + C.gate.z1) / 2, rx = ex + Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2);
  /** a spot outside the fort's walls, by its measure, so far over whatever is there */
  const FG = (x: number, z: number, up = 0) => {
    const p = F(x, z, 0);
    return p.setY((under(p, 30, 90) ?? S.ground(p.x, p.z)) + up);
  };
  const spots = heliSpots(world);
  /** the MD-500 on the hospital's roof (the pilot's), and the pad below the fort where the other stands */
  const ROOF = spots[0], PAD = spots[1];
  if (!ROOF || !PAD) throw new Error('a helicopter spot is missing');
  /** the bridge: its two ends, its deck's height, and the way across it */
  const BR = world.bridges[0] as { ax: number; ay: number; az: number; bx: number; by: number; bz: number };
  const bridgeA = new THREE.Vector3(BR.ax, BR.ay, BR.az), bridgeB = new THREE.Vector3(BR.bx, BR.by, BR.bz);
  const across = bridgeB.clone().sub(bridgeA).setY(0).normalize(), northOfIt = new THREE.Vector3(-across.z, 0, across.x);

  // ------------------------------------------------------------ rails: a lens goes along a line at a speed that is said
  interface Rail { len: number; at: (s: number) => THREE.Vector3 }
  const rail = (pts: THREE.Vector3[]): Rail => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    c.arcLengthDivisions = 800;
    const len = c.getLength();
    return { len, at: (s) => c.getPointAt(clamp01(s / len)) };
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
  const plate = Gx('x10-plate', '<span></span>');
  const title = Gx('x12-title', `
    <div class="t12-kick">ZONA &nbsp;·&nbsp; PVP SURVIVAL SHOOTER</div>
    <div class="t12-name">WHAT GOES UP</div>`);

  // ------------------------------------------------------------ people, and frames nobody sees
  const A = (i: number) => S.actors[i];
  /** the cast: the pair, and the pilot */
  const VOLKOV = 0, MIRA = 1, SABLE = 6;
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
  /** how the three are dressed and armed, every time they are seen */
  const LOOK: Record<number, { weapon: string; gear: string[] }> = {
    [VOLKOV]: { weapon: 'ak', gear: ['armor_vest', 'helmet_m1', 'sack_pack'] },
    [MIRA]: { weapon: 'ar15', gear: ['chest_rig', 'patrol_cap', 'camping_pack'] },
    [SABLE]: { weapon: 'mpa', gear: ['soft_vest', 'boonie_hat'] },
  };
  const cast = (i: number, p: THREE.Vector3, yaw: number) => stand(A(i), p, yaw, LOOK[i].weapon, LOOK[i].gear);
  const THINGS = ['armor_vest', 'helmet_m1', 'sack_pack', 'chest_rig', 'patrol_cap', 'camping_pack', 'soft_vest', 'boonie_hat', 'ak', 'ar15', 'mpa', 'frag', 'binoculars', 'blood_bag'];
  /** who sits in a vehicle, and where: kept so, every frame, by whoever says so */
  const seat = (a: Actor, j: Any, k: number) => {
    (a.rp as Any).seat = { jeep: j, at: SEATS_OF[j.kind][k], how: null };
  };
  const reset = () => {
    for (const a of S.actors) {
      a.dance = a.surrender = a.crouch = a.aim = a.sprint = false;
      a.more = 0;
      a.foe = null;
      (a.rp as Any).seat = null;
      a.rp.avatar.clearWounds();
      a.hide();
    }
    g.glass = null;
    S.parkMe();
    S.clean();
    hush();
  };

  // ------------------------------------------------------------ the fort got ready: its stone made, its pictures come (the twelfth film's)
  let warmed = false;
  const warm = async () => {
    if (warmed) return;
    warmed = true;
    const site = g.castle as Any;
    site?.finish?.();
    // (the game's first look, the how-to-play, is not to cover a shot through the player's own eyes)
    try { localStorage.setItem('zona-howto-seen', '1'); } catch { /* */ }
    (document.querySelector('.howto-ok') as HTMLElement | null)?.click();
    for (const id of THINGS) void Promise.resolve(g.loot.models.get(id)).catch(() => {});
    const t0 = clock.real.now();
    for (const [p, l] of [[F(40, 0, 6), F(0, 0, 4)], [new THREE.Vector3(PAD.x + 30, PAD.y + 8, PAD.z + 30), new THREE.Vector3(PAD.x, PAD.y, PAD.z)]] as [THREE.Vector3, THREE.Vector3][]) {
      S.cam = { p, l, fov: 50 };
      await run(60 * 4);
      await wait(200);
    }
    for (let i = 0; i < 100 && site && site.state !== 'near'; i++) {
      await run(6);
      await wait(100);
    }
    S.cam = null;
    say(`the fort is ${site?.state}; ${((clock.real.now() - t0) / 1000).toFixed(1)} s`);
  };

  // ------------------------------------------------------------ the set
  const shots: Shot[] = [];
  const DAY = 0.3, DAWN = 0.27;
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
          g.hourHeld = hourWas < 0 ? DAY : hourWas;
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
          show(plate, t - c[0], Math.min(ease((t - c[0]) / 0.25), ease((c[1] - t) / 0.2)));
        } else plate.style.display = 'none';
      },
    });
  };

  // ------------------------------------------------------------ the helicopters
  const heliAt = (spot: { x: number; z: number }) => {
    let best: Any = null, d = 1e9;
    for (const j of (g.garage.jeeps as Map<number, Any>).values()) {
      if (j.kind !== HELI.kind) continue;
      const e = Math.hypot(j.pos.x - spot.x, j.pos.z - spot.z);
      if (e < d) [best, d] = [j, e];
    }
    return best;
  };
  /** the pilot's, from the hospital's roof; and the one on the pad, which is put out of the way where the pilot comes down */
  const md500 = () => heliAt(ROOF);
  const padHeli = () => heliAt(PAD);
  /** the helicopters put where they are told since the shot began (the first telling in a shot puts it there; the rest are followed) */
  const snapped = new Set<Any>();
  /** a helicopter told where it is, as another game's is shown: a state, its rotor at `rpm` (0..1) */
  const fly = (j: Any, p: THREE.Vector3, yaw: number, pitch = 0, roll = 0, v = new THREE.Vector3(), rpm = 1) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    const st = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, rpm, rpm > 0 ? 0.7 : 0];
    if (j.mode !== 'follow' || !snapped.has(j)) {
      snapped.add(j);
      j.place(st);
      j.mode = 'follow';
    }
    j.push(st, performance.now(), performance.now());
  };

  // ------------------------------------------------------------ the drop: where it comes down, by the fort's pad
  /** open ground within 110 m of the pad, as far from any tree as can be, level, with nothing built over it, and clear of the pad itself */
  let dropAt: THREE.Vector3 | null = null;
  const openGround = () => {
    if (dropAt) return dropAt;
    const R = 110;
    const trees = ((world.trees ?? []) as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush') && Math.hypot(t.x - PAD.x, t.z - PAD.z) < R + 50);
    const clear = (x: number, z: number) => trees.reduce((d, t) => Math.min(d, Math.hypot(t.x - x, t.z - z)), 50);
    const bare = (x: number, z: number) => {
      const gy = S.ground(x, z), h = under(new THREE.Vector3(x, gy, z), 80, 5);
      return h === null || h < gy + 0.6;
    };
    const level = (x: number, z: number) => Math.abs(S.ground(x + 8, z) - S.ground(x - 8, z)) < 2.5 && Math.abs(S.ground(x, z + 8) - S.ground(x, z - 8)) < 2.5;
    let best = { x: PAD.x, z: PAD.z, d: -1 };
    for (let x = PAD.x - R; x <= PAD.x + R; x += 4)
      for (let z = PAD.z - R; z <= PAD.z + R; z += 4) {
        const e = Math.hypot(x - PAD.x, z - PAD.z);
        if (e > R || e < 28) continue;
        const d = clear(x, z);
        if (d <= best.d || !level(x, z) || ![[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]].every(([a, b]) => bare(x + a, z + b))) continue;
        best = { x, z, d };
      }
    say(`drop: open ground ${best.d.toFixed(0)} m from the nearest tree, ${Math.hypot(best.x - PAD.x, best.z - PAD.z).toFixed(0)} m from the pad`);
    return (dropAt = new THREE.Vector3(best.x, S.ground(best.x, best.z), best.z));
  };
  /**
   * Where the pair see it from: open, level ground 220 to 420 m from where it comes down, from which an eye sees both
   * the sky over it and the ground it lands on, as far from any tree as can be (preferring the side away from the fort).
   */
  let lookoutAt: THREE.Vector3 | null = null;
  const lookout = () => {
    if (lookoutAt) return lookoutAt;
    const d = openGround(), sky = d.clone().setY(d.y + 45), low = d.clone().setY(d.y + 4), fort = F(0, 0);
    const trees = ((world.trees ?? []) as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush') && Math.hypot(t.x - d.x, t.z - d.z) < 480);
    let best: THREE.Vector3 | null = null, score = -Infinity;
    for (let r = 220; r <= 420; r += 20)
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * Math.PI * 2, x = d.x + Math.sin(a) * r, z = d.z + Math.cos(a) * r;
        if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_SIZE / 2 - 40) continue;
        const e = G(x, z, 1.6);
        if (Math.abs(S.ground(x + 4, z) - S.ground(x - 4, z)) > 1.6 || Math.abs(S.ground(x, z + 4) - S.ground(x, z - 4)) > 1.6) continue;
        if (!S.clearLine(e, sky) || !S.clearLine(e, low)) continue;
        const clear = trees.reduce((m2, t) => Math.min(m2, Math.hypot(t.x - x, t.z - z)), 30);
        if (clear < 6) continue;
        const s2 = clear + (Math.hypot(x - fort.x, z - fort.z) > Math.hypot(d.x - fort.x, d.z - fort.z) ? 8 : 0);
        if (s2 > score) [best, score] = [G(x, z), s2];
      }
    if (!best) {
      say('lookout: none found with a clear sight of the drop: 300 m south of it');
      best = G(d.x, d.z + 300);
    } else say(`lookout: ${best.distanceTo(d).toFixed(0)} m from the drop, ${score.toFixed(0)} in its score`);
    return (lookoutAt = best);
  };
  let flight: Flight | null = null;
  const beginDrop = async (early: number) => {
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
    g.flightBegun({ ...flight!, uid: 'drop-film14-first' });
    await until(240);
    g.airdrops.clear();
    flight!.age -= 1;
    g.flightBegun(flight!);
    const n = await until(60);
    if (!hung()) say('drop: the Apache has no model yet as the shot opens');
    await run(Math.max(0, 60 - n));
    void early;
  };
  const planDrop = (fromRelease: number) => {
    const at = openGround();
    const f = planFlight((x, z) => S.ground(x, z), { x: at.x, y: at.y, z: at.z }, 'drop-film14', () => S.rnd());
    f.age = Math.max(0, flightTimes(f).release + fromRelease);
    flight = f;
    return f;
  };

  // ------------------------------------------------------------ a walk round its places, a still of each (?scout)
  const scout = () => {
    const poses: [string, () => CamPose, number?][] = [
      ['card: before the ramp, by dawn', () => ({ p: FG(rx + 17, gz + 5.5, 4.5), l: F(4, 0, 6), fov: 42 }), DAWN],
      ['the drop spot, from 30 m', () => ({ p: G(openGround().x + 30, openGround().z + 10, 2), l: openGround().clone().setY(openGround().y + 1), fov: 50 })],
      ['lookout: toward the drop', () => ({ p: lookout().clone().setY(lookout().y + 1.6), l: openGround().clone().setY(openGround().y + 20), fov: 40 })],
      ['lookout: the drop, long', () => ({ p: lookout().clone().setY(lookout().y + 1.6), l: openGround().clone().setY(openGround().y + 8), fov: 7 })],
      ['bridge: from below, the deck', () => ({ p: bridgeA.clone().lerp(bridgeB, 0.5).addScaledVector(northOfIt, 40).setY(bridgeA.y - 6), l: bridgeA.clone().lerp(bridgeB, 0.5), fov: 50 })],
      ['roof: the MD-500', () => ({ p: new THREE.Vector3(ROOF.x + 7, ROOF.y + 2.5, ROOF.z + 7), l: new THREE.Vector3(ROOF.x, ROOF.y + 1, ROOF.z), fov: 48 })],
    ];
    const PER = 3, FPS = 30;
    poses.forEach(([label, pose, hour], i) => {
      let p: CamPose = { p: new THREE.Vector3(), l: new THREE.Vector3(0, 0, -1), fov: 50 };
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
          p = pose();
          S.cam = p;
          await run(hour ? 150 : 40);
          await wait(60);
          say(`${String(i).padStart(2, '0')} at ${((i * PER) / FPS).toFixed(2)} s: ${label}`);
        },
        cam: () => p,
        after: () => hush(),
      });
    });
    total = (poses.length * PER) / FPS;
    return shots;
  };
  if (SCOUT) return scout();

  // ============================================================ ACT 1: THE DROP
  // ------------------------------------------------------------ 1. Orlinoye in the snow at dawn: WHAT GOES UP
  add(4, {
    name: 'card',
    m: 'card',
    hour: DAWN,
    settle: 200,
    fadeIn: 0.6,
    cam: (t) => {
      // (before the ramp, rising: the tenth film's last look at it, by dawn)
      const k = ease(t / 4), p = FG(rx + 17 + k * 3, gz + 5.5 + k * 1.5, 4.5 + k * 3);
      return hand({ p, l: F(4, 0, 6 + k), fov: 42 }, t, 0.25);
    },
    after: (t) => {
      if (t < 3.6) show(title, t, Math.min(ease((t - 0.3) / 0.5), 1 - ease((t - 3.2) / 0.4)));
      else title.style.display = 'none';
    },
  });

  // ------------------------------------------------------------ 2. the Apache comes in low, and the crate's canopy opens
  let side = new THREE.Vector3();
  add(6, {
    name: 'apache',
    m: 'dread',
    hit: 1,
    setup: () => {
      const f = planDrop(-1.6);
      const way = new THREE.Vector3(f.x - f.fx, 0, f.z - f.fz).normalize(), cross = new THREE.Vector3(-way.z, 0, way.x), toFort = F(0, 0).sub(openGround()).setY(0).normalize();
      // (side on to its way in, from the side the fort is on: the fort behind it)
      side = cross.dot(toFort) < 0 ? cross : cross.negate();
    },
    stage: () => beginDrop(1),
    cam: (t) => {
      const f = flight!, a = side.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.2 - t * 0.05);
      return hand({ p: new THREE.Vector3(f.x + a.x * 55, f.hold - 8, f.z + a.z * 55), l: new THREE.Vector3(f.x, f.hold - 2 - t * 1.6, f.z), fov: 40 }, t, 0.3);
    },
    plates: [[1.2, 5.4, 'Supply drop · by helicopter']],
  });

  // ------------------------------------------------------------ 3. the pair at a lookout, the jeep beside them: they look up
  /** the jeep the pair drive: the nearest to the bridge */
  const jeepOf = () => {
    let best: Any = null, d = 1e9;
    for (const j of (g.garage.jeeps as Map<number, Any>).values()) {
      if (j.kind !== 0) continue;
      const e = Math.hypot(j.pos.x - bridgeA.x, j.pos.z - bridgeA.z);
      if (e < d) [best, d] = [j, e];
    }
    return best;
  };
  /** a jeep stood at a place, facing a way */
  const park = (j: Any, at: THREE.Vector3, yaw: number, v = 0) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    j.place([at.x, at.y + 0.86, at.z, q.x, q.y, q.z, q.w, -Math.sin(yaw) * v, 0, -Math.cos(yaw) * v, 0, v ? 1 : 0]);
  };
  /** the way from the lookout to the drop, and across it */
  const toDrop = () => openGround().clone().sub(lookout()).setY(0).normalize();
  const crossDrop = () => new THREE.Vector3(-toDrop().z, 0, toDrop().x);
  add(4, {
    name: 'lookout',
    m: 'dread',
    setup: () => {
      const e = lookout(), ahead = yawTo(e, openGround()), side = crossDrop(), back = toDrop().negate();
      park(jeepOf(), G(e.x + back.x * 4 + side.x * 3, e.z + back.z * 4 + side.z * 3), ahead + 0.4);
      cast(VOLKOV, G(e.x + side.x * 0.8, e.z + side.z * 0.8), ahead + 0.6);
      cast(MIRA, G(e.x - side.x * 0.8, e.z - side.z * 0.8), ahead - 0.5);
    },
    tick: (t) => {
      // (they turn to it as it is heard, and look up)
      const ahead = yawTo(lookout(), openGround());
      A(VOLKOV).yaw = ahead + 0.6 * (1 - ease(t / 1.4));
      A(VOLKOV).pitch = 0.18 * ease((t - 0.4) / 1.2);
      A(MIRA).yaw = ahead - 0.5 * (1 - ease((t - 0.5) / 1.2));
      A(MIRA).pitch = 0.22 * ease((t - 0.8) / 1.2);
    },
    cam: (t) => {
      // (behind them and low, the land falling away to the fort beyond)
      const e = lookout(), back = toDrop().negate(), side = crossDrop();
      return hand({ p: e.clone().addScaledVector(back, 4.8).addScaledVector(side, -1.4 + t * 0.12).setY(e.y + 1.35), l: openGround().clone().setY(openGround().y + 30), fov: 40 }, t, 0.5);
    },
  });

  // ------------------------------------------------------------ 4. through Mira's binoculars: the canopy coming down by the fort
  add(4, {
    name: 'glass',
    m: 'dread',
    hud: true,
    bars: false,
    setup: () => {
      planDrop(2.2);
      const e = lookout();
      S.me(e.x, e.z, yawTo(e, openGround()), 0.05, e.y);
      g.glass = (ITEMS as Any).binoculars?.look ?? null;
    },
    stage: () => beginDrop(1),
    tick: (t) => {
      // (held on the canopy as it comes down, a little behind it)
      const f = flight!, drop = openGround(), k = clamp01(t / 4);
      S.aimAt(new THREE.Vector3(drop.x, f.hold - 8 - (f.hold - drop.y - 10) * k * 0.45, drop.z));
    },
  });

  // ============================================================ ACT 2: THE RACE
  // ------------------------------------------------------------ 5. the jeep across the bridge
  // (across the deck from one end to the other in the shot, and no further: off its far end the jeep was put on
  // whatever a ray dropped there met first, and went up into the air)
  const ROAD_V = 10.5;
  const crossing = (t: number) => {
    const len = bridgeA.distanceTo(bridgeB), s = Math.min(len - 1, 1.5 + ROAD_V * t);
    return bridgeA.clone().addScaledVector(across, s).setY(bridgeA.y);
  };
  add(6, {
    name: 'road',
    m: 'tour',
    hit: 1,
    flash: 0.3,
    setup: () => {
      const j = jeepOf();
      cast(VOLKOV, crossing(0), 0);
      cast(MIRA, crossing(0), 0);
      seat(A(VOLKOV), j, 0);
      seat(A(MIRA), j, 1);
    },
    lead: (t) => park(jeepOf(), crossing(t), yawTo(bridgeA, bridgeB), ROAD_V),
    tick: (t) => park(jeepOf(), crossing(t), yawTo(bridgeA, bridgeB), ROAD_V),
    cam: (t) => {
      // (from below the deck's edge on the north side, panning with it, the drop behind it far off)
      const p = crossing(t), mid = bridgeA.clone().lerp(bridgeB, 0.5);
      return hand({ p: mid.clone().addScaledVector(northOfIt, 26).setY(mid.y - 2.5), l: p.clone().setY(p.y + 1), fov: 44 }, t, 0.3);
    },
    plates: [[0.6, 5, 'The road all the way round · and its bridge']],
  });

  // ------------------------------------------------------------ 6. the hospital's roof: the pilot gets in, the rotor comes up
  /** where the pilot's way goes: up off the roof, round to the fort, and on to it, high over the land between */
  let path: Rail | null = null;
  const makePath = () => {
    const r = new THREE.Vector3(ROOF.x, ROOF.y, ROOF.z), fort = F(0, 0), to = fort.clone().sub(r).setY(0).normalize();
    // (a helicopter's middle is RIDE_HEIGHT over its skids: put at the roof's height, its skids were in the roof)
    const at = (along: number, up: number, over = 0) => {
      const x = r.x + to.x * along, z = r.z + to.z * along;
      return new THREE.Vector3(x, Math.max(r.y + RIDE_HEIGHT + up, S.ground(x, z) + RIDE_HEIGHT + over), z);
    };
    path = rail([at(0, 0.02), at(0, 3), at(4, 9), at(20, 18, 30), at(70, 30, 45), at(160, 40, 55), at(320, 45, 60), at(520, 45, 60)]);
    say(`pilot's way: ${path.len.toFixed(0)} m`);
  };
  /** how far along it the pilot is, seconds after lifting: slow off the roof, then at a cruise of 28 m/s (100 km/h) */
  const flown = (T: number) => (T <= 0 ? 0 : T < 4 ? 3.5 * (T * T) / 8 * 4 / 4 + 0.6 * T : 3.5 * 2 + 2.4 + (T - 4) * 28);
  const pilotYaw = () => yawTo(new THREE.Vector3(ROOF.x, 0, ROOF.z), F(0, 0));
  const flyPilot = (T: number) => {
    const h = md500(), s = Math.min(path!.len, flown(T)), p = path!.at(s), q = path!.at(Math.min(path!.len, s + 1));
    const pitch = -Math.min(0.2, Math.max(0, (T - 2) * 0.1));
    fly(h, p, pilotYaw(), pitch, 0, q.clone().sub(p).multiplyScalar(28), T < -2 ? 0.2 : 1);
    return p;
  };
  add(4, {
    name: 'roof',
    m: 'tour',
    hit: 1,
    setup: () => {
      makePath();
      const h = md500();
      cast(SABLE, new THREE.Vector3(ROOF.x, ROOF.y, ROOF.z), pilotYaw());
      seat(A(SABLE), h, 0);
    },
    stage: async () => {
      await run(40, () => void flyPilot(-1));
    },
    lead: () => void flyPilot(-1),
    tick: () => void flyPilot(-1),
    cam: (t) => {
      const a = pilotYaw() + 2.3 + t * 0.1;
      return hand({ p: new THREE.Vector3(ROOF.x + Math.sin(a) * 8, ROOF.y + 2.2, ROOF.z + Math.cos(a) * 8), l: new THREE.Vector3(ROOF.x, ROOF.y + 1.1, ROOF.z), fov: 46 }, t, 0.3);
    },
    plates: [[0.5, 3.6, 'The MD-500 · hospital roof']],
  });

  // ------------------------------------------------------------ 7. it lifts off, and turns for the fort
  add(4, {
    name: 'lift',
    m: 'tour',
    setup: () => {
      makePath();
      cast(SABLE, new THREE.Vector3(ROOF.x, ROOF.y, ROOF.z), pilotYaw());
      seat(A(SABLE), md500(), 0);
    },
    stage: async () => {
      await run(40, (k) => void flyPilot(-1 + k / 60));
    },
    lead: (t) => void flyPilot(t),
    tick: (t) => void flyPilot(t),
    cam: (t) => {
      const p = flyPilot(t), a = pilotYaw() + Math.PI * 0.8;
      return hand({ p: new THREE.Vector3(ROOF.x + Math.sin(a) * 12, ROOF.y + 1.6, ROOF.z + Math.cos(a) * 12), l: p.clone().setY(p.y + 1.2), fov: 48 }, t, 0.35);
    },
  });

  // ------------------------------------------------------------ 8. over the land for the fort, the snow ahead
  add(4, {
    name: 'flight',
    m: 'tour',
    setup: () => {
      makePath();
      cast(SABLE, new THREE.Vector3(ROOF.x, ROOF.y, ROOF.z), pilotYaw());
      seat(A(SABLE), md500(), 0);
    },
    stage: async () => {
      await run(40, (k) => void flyPilot(6 + (-1 + k / 60)));
    },
    lead: (t) => void flyPilot(6 + t),
    tick: (t) => void flyPilot(6 + t),
    cam: (t) => {
      // (behind it and a little over it, looking on just past it: it in the middle, the land and the snow ahead)
      const p = flyPilot(6 + t), back = new THREE.Vector3(Math.sin(pilotYaw()), 0, Math.cos(pilotYaw()));
      return hand({ p: p.clone().addScaledVector(back, 12).setY(p.y + 1.8), l: p.clone().addScaledVector(back, -30).setY(p.y + 0.4), fov: 54 }, t, 0.4);
    },
    plates: [[0.5, 3.6, '100 km/h · 100 m over the ground at the most']],
  });

  // ------------------------------------------------------------ 9. the pair at the crate, down under its canopy
  /** where things stand by the crate: the jeep, the pair, and the way the pilot comes in (from the hospital's side) */
  const crate = () => openGround();
  const fromRoof = () => new THREE.Vector3(ROOF.x - crate().x, 0, ROOF.z - crate().z).normalize();
  const acrossRoof = () => new THREE.Vector3(-fromRoof().z, 0, fromRoof().x);
  // (by the ground's own height, not by what a ray dropped there meets: dropped where the helicopter hangs, it met the
  // helicopter, and the place it was to hang at rose every time it was asked, with the helicopter and the lens on it)
  const near = (back: number, side: number, up = 0) => {
    const c = crate(), f = fromRoof(), s = acrossRoof(), x = c.x - f.x * back + s.x * side, z = c.z - f.z * back + s.z * side;
    return new THREE.Vector3(x, S.ground(x, z) + up, z);
  };
  const pairAt = () => ({ volkov: near(1.4, 0.4), mira: near(2.4, -2.2), jeep: near(6.5, 3.2) });
  const landed = async () => {
    planDrop(45);
    await beginDrop(1);
  };
  add(4, {
    name: 'crate',
    m: 'sneak',
    hit: 1,
    setup: () => {
      const p = pairAt(), c = crate();
      park(jeepOf(), p.jeep, yawTo(p.jeep, c) + 0.6);
      cast(VOLKOV, p.volkov, yawTo(p.volkov, c));
      A(VOLKOV).crouch = true;
      cast(MIRA, p.mira, yawTo(c, p.mira));
      A(MIRA).aim = true;
    },
    stage: () => landed(),
    tick: (t) => {
      // (she watches the tree line, a slow look round)
      A(MIRA).yaw = yawTo(crate(), pairAt().mira) + Math.sin(t * 0.7) * 0.35;
    },
    cam: (t) => {
      const c = crate(), p = near(-3.5, 4.5 - t * 0.25, 0.9);
      return hand({ p, l: c.clone().setY(c.y + 0.6).lerp(pairAt().mira, 0.3), fov: 44 }, t, 0.6);
    },
    plates: [[0.6, 3.6, 'Two in a jeep · first to it']],
  });

  // ============================================================ ACT 3: SHOT DOWN
  // ------------------------------------------------------------ the pilot comes in to land
  /** where the pilot comes down to: 35 m off the crate toward the hospital, 22 m up, and how it comes there (seconds after the act opens) */
  const hover = () => near(-28, -8, 18);
  const inbound = (T: number) => {
    const h = hover(), f = fromRoof(), k = clamp01(T / 5);
    // (from 140 m out, slowing as it comes, down to its hover)
    const s = 140 * Math.pow(1 - k, 2), up = 24 * (1 - k);
    const p = h.clone().addScaledVector(f, s).setY(Math.max(h.y + up, S.ground(h.x + f.x * s, h.z + f.z * s) + 30 * (1 - k) + 18));
    return { p, v: f.clone().multiplyScalar(-2 * 140 * (1 - k) / 5) };
  };
  const pilotIn = (T: number) => {
    const { p, v } = inbound(T), yaw = yawTo(new THREE.Vector3(ROOF.x, 0, ROOF.z), crate()), flare = clamp01((T - 3) / 2);
    fly(md500(), p, yaw, -0.15 * (1 - flare) + 0.12 * flare * (1 - clamp01((T - 5) / 1)), 0, v);
    return p;
  };
  /** the pilot in his seat, seen to be there through the glass */
  const pilotAboard = () => {
    cast(SABLE, hover(), 0);
    seat(A(SABLE), md500(), 0);
  };
  /** the one on the pad is somewhere else for this */
  const clearPad = () => {
    const j = padHeli();
    if (j && j !== md500()) j.place([PAD.x, PAD.y - 60, PAD.z, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  };
  add(4, {
    name: 'inbound',
    m: 'tight',
    hit: 1.2,
    setup: () => {
      clearPad();
      const p = pairAt(), c = crate();
      park(jeepOf(), p.jeep, yawTo(p.jeep, c) + 0.6);
      cast(VOLKOV, p.volkov, yawTo(p.volkov, hover()));
      cast(MIRA, p.mira, yawTo(p.mira, hover()));
      pilotAboard();
    },
    stage: async () => {
      await landed();
      await run(30, (k) => void pilotIn(-0.5 + k / 60));
    },
    lead: (t) => void pilotIn(t),
    tick: (t) => {
      const h = pilotIn(t);
      // (they stand and turn to it; she brings her rifle up)
      A(VOLKOV).yaw = yawTo(A(VOLKOV).pos, h);
      A(VOLKOV).pitch = Math.atan2(h.y - A(VOLKOV).pos.y - 1.5, Math.hypot(h.x - A(VOLKOV).pos.x, h.z - A(VOLKOV).pos.z));
      A(MIRA).yaw = yawTo(A(MIRA).pos, h);
      A(MIRA).aim = t > 2;
    },
    cam: (t) => {
      // (low behind the pair, it coming in over them)
      const p = pairAt(), back = fromRoof().negate();
      return hand({ p: p.volkov.clone().addScaledVector(back, 4.2).addScaledVector(acrossRoof(), -3.4).setY(p.volkov.y + 1.0), l: pilotIn(t).clone().lerp(p.volkov.clone().setY(p.volkov.y + 2), 0.12), fov: 50 }, t, 0.6);
    },
    plates: [[0.8, 3.6, 'Coming in to land']],
  });

  // ------------------------------------------------------------ the AK: Volkov's burst, through his own eyes
  const eyes = (at: THREE.Vector3, k = 0.2) => {
    const p = g.player, cam = g.s.r.camera.position;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    p.yaw += wrap(Math.atan2(-(at.x - cam.x), -(at.z - cam.z)) - p.yaw) * k;
    p.pitch += (Math.atan2(at.y - cam.y, Math.hypot(at.x - cam.x, at.z - cam.z)) - p.pitch) * k;
  };
  let lastShot = -9;
  add(4, {
    name: 'burst',
    m: 'tight',
    hit: 1,
    hud: true,
    bars: false,
    flash: 0.4,
    setup: async () => {
      clearPad();
      pilotAboard();
      const p = pairAt();
      cast(MIRA, p.mira, yawTo(p.mira, hover()));
      A(MIRA).aim = true;
      S.kit(['ak']);
      S.hold('primary');
      const h = hover();
      S.me(p.volkov.x, p.volkov.z, yawTo(p.volkov, h), 0.4, p.volkov.y);
      lastShot = -9;
    },
    stage: async () => {
      await landed();
      await run(30, (k) => void pilotIn(5 + (-0.5 + k / 60)));
    },
    lead: (t) => void pilotIn(5 + t),
    tick: (t) => {
      const h = pilotIn(5 + t);
      eyes(h.clone().setY(h.y + 0.3), 0.3);
      // (a burst into the glass where the pilot sits)
      if (t > 1.6 && t < 3.2 && t - lastShot > 0.11) {
        lastShot = t;
        S.tap('Mouse0', 40);
      }
    },
  });

  // ------------------------------------------------------------ the pilot is hit: the glass, and he goes over in his seat
  let slumped = false;
  const slump = () => {
    if (slumped) return;
    slumped = true;
    const h = md500(), head = h.point(SEATS_OF[HELI.kind][0][0], SEATS_OF[HELI.kind][0][1] + 1.45, SEATS_OF[HELI.kind][0][2], new THREE.Vector3());
    g.effects.bleed?.(head, new THREE.Vector3(0, 0, 1), 1);
    A(SABLE).hide();
    void g.riders.add({ uid: 'film14-pilot', x: h.pos.x, y: h.pos.y, z: h.pos.z, rot: 0, name: A(SABLE).name, v: 0, ride: { i: h.i, seat: 0 } });
  };
  const unslump = () => {
    slumped = false;
    g.riders.remove('film14-pilot');
    g.removeCorpse?.('film14-pilot');
  };
  add(2, {
    name: 'hit',
    m: 'sting',
    hit: 1.4,
    setup: () => {
      clearPad();
      unslump();
      pilotAboard();
    },
    stage: async () => {
      await landed();
      await run(30, (k) => void pilotIn(9 + (-0.5 + k / 60)));
    },
    lead: (t) => void pilotIn(9 + t),
    tick: (t) => {
      pilotIn(9 + t);
      if (t > 0.45) slump();
    },
    cam: (t) => {
      // (close beside where the cockpit hangs, at the pilot's door: the pilot's door is on its left)
      const h = inbound(10).p, yaw = yawTo(new THREE.Vector3(ROOF.x, 0, ROOF.z), crate()), left = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)), fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      return hand({ p: h.clone().addScaledVector(left, 4.2).addScaledVector(fwd, 1.2).setY(h.y + 0.6), l: h.clone().addScaledVector(left, 0.36).addScaledVector(fwd, 0.75).setY(h.y + 0.25), fov: 38 }, t, 0.9);
    },
  });

  // ------------------------------------------------------------ it spins and falls, and goes up
  /** where it falls from, and how: it turns faster and faster, its nose going down, onto the snow 18 m on */
  /** where it would be, falling `T` seconds: 6 m a second off to the side away from the pair and their jeep, and down as anything falls */
  const fallAt = (T: number) => {
    const h = inbound(10).p, f = acrossRoof().negate();
    return h.clone().addScaledVector(f, 6 * T).setY(h.y - 0.5 * 9.81 * T * T);
  };
  /** when it meets the ground (the slope under it, wherever that is): found once */
  let FALL = 0;
  const fallTime = () => {
    if (FALL) return FALL;
    for (let T = 0; T < 5; T += 0.01) {
      const p = fallAt(T);
      if (p.y <= S.ground(p.x, p.z) + 0.95) return (FALL = T);
    }
    return (FALL = 2.1);
  };
  const falling = (T: number) => {
    const end = fallTime(), at = Math.min(T, end), k = clamp01(at / end), p = fallAt(at);
    const down = T >= end;
    if (down) p.y = S.ground(p.x, p.z) + 0.95;
    return { p, yaw: yawTo(new THREE.Vector3(ROOF.x, 0, ROOF.z), crate()) + 3.2 * at * at, pitch: -0.5 * k, roll: 0.45 * k, down };
  };
  let blown = false;
  const fall = (T: number) => {
    const s = falling(T), h = md500();
    fly(h, s.p, s.yaw, s.pitch, s.roll, new THREE.Vector3(), s.down ? 0 : 1);
    if (s.down && !blown) {
      blown = true;
      g.garage.blow(h, false);
    }
    return s.p;
  };
  add(4, {
    name: 'fall',
    m: 'sting',
    setup: () => {
      clearPad();
      blown = false;
      unslump();
      slump();
      const p = pairAt();
      cast(VOLKOV, p.volkov, yawTo(p.volkov, hover()));
      cast(MIRA, p.mira, yawTo(p.mira, hover()));
      A(VOLKOV).aim = A(MIRA).aim = true;
    },
    stage: () => landed(),
    lead: () => void fall(0),
    tick: (t) => {
      const h = fall(Math.max(0, t - 0.3));
      for (const i of [VOLKOV, MIRA]) A(i).yaw = yawTo(A(i).pos, h);
    },
    cam: (t) => {
      // (wide, from beside the pair: the whole fall and where it lands)
      const p = pairAt(), side = acrossRoof();
      return hand({ p: p.mira.clone().addScaledVector(side, -6).addScaledVector(fromRoof(), -3).setY(p.mira.y + 1.6), l: falling(Math.max(0, t - 0.3)).p.clone().lerp(hover(), 0.3), fov: 52 }, t, 0.8 + (blown ? 2.5 : 0));
    },
    plates: [[2.8, 3.9, 'Killed in the air · comes down with it']],
  });

  // ------------------------------------------------------------ the wreck burns: the pilot in his seat, then on the snow beside it
  const wreckAt = () => falling(fallTime()).p;
  /** where the game lays the pilot's body when it is down: beside the wreck, on the side toward the pair */
  const bodyAt = () => {
    const w = wreckAt().clone().addScaledVector(acrossRoof(), 3);
    return w.setY(S.ground(w.x, w.z));
  };
  const layBody = () => {
    const b = bodyAt();
    return g.addCorpse({ uid: 'film14-pilot', x: b.x, y: b.y, z: b.z, rot: yawTo(b, wreckAt()), name: A(SABLE).name, v: 0 }, 0);
  };
  let laid = false;
  add(4, {
    name: 'wreck',
    m: 'sting',
    setup: () => {
      clearPad();
      unslump();
      laid = false;
      blown = false;
      fall(fallTime());
      slump();
    },
    stage: () => landed(),
    tick: (t) => {
      fall(fallTime());
      // (down: laid on the ground beside the pilot's door, with all he carried, as the game does it)
      if (t > 1.2 && !laid) {
        laid = true;
        void layBody().then(() => g.riders.remove('film14-pilot'));
      }
    },
    cam: (t) => {
      // (from the pair's side, a little up: the wreck burning, and the body laid out beyond it)
      const w = wreckAt(), p = w.clone().addScaledVector(acrossRoof(), 8.5 - t * 0.35).addScaledVector(fromRoof(), 4);
      return hand({ p: p.setY(S.ground(p.x, p.z) + 2.2), l: w.clone().lerp(bodyAt(), 0.4).setY(w.y - 0.3), fov: 46 }, t, 0.4);
    },
  });

  // ------------------------------------------------------------ the infected: the fire has been heard
  const horde = g.horde as Any;
  const zeds: Any[] = [];
  let troupeMade = false;
  const troupe = async () => {
    if (troupeMade) return;
    troupeMade = true;
    horde.clear();
    if (!horde.director) horde.alone();
    const dir = horde.director;
    dir.bodies.clear();
    dir.due = [];
    dir.tick = () => ({ added: [], gone: [], owned: [] });
    const me = horde.host.me().id;
    for (let n = 0; n < 6; n++) {
      const i = 3100 + n, info = { i, s: [0, -300, 0, 0, 0, 0], hp: 90, own: me, h: [0, 0] };
      dir.bodies.set(i, { ...info, home: 0, diedAt: 0, heard: 0, struck: 0 });
      horde.add(info);
      zeds.push(horde.all.get(i));
    }
    for (let k = 0; k < 600 && zeds.some((z) => !z.ready || !z.mine); k++) await wait(25);
  };
  const putZ = (z: Any, at: THREE.Vector3, yaw: number, senses: boolean) => {
    if (!z) return;
    z.pos.copy(at);
    z.fallTo = at.y;
    z.home.copy(at);
    const body = horde.director.bodies.get(z.i);
    body.s[0] = at.x;
    body.s[1] = at.y;
    body.s[2] = at.z;
    body.heard = performance.now();
    z.mode = 0;
    z.after = 0;
    z.waitT = 999;
    z.yaw = yaw;
    z.gait = 0;
    z.stopT = 0;
    z.strikeAt = 0;
    z.seenAt = -1e9;
    z.lost();
    z._think ??= z.think;
    z.think = senses ? z._think : () => {};
    if (z.avatar.sick) z.avatar.sick.claw = -1;
  };
  const dropZ = (z: Any, from: THREE.Vector3) => {
    if (z.dead) return;
    const head = new THREE.Vector3(z.pos.x, z.pos.y + 1.55, z.pos.z), d = head.clone().sub(from).normalize();
    g.effects.bleed(head, d, 1);
    horde.director.hurt(z.i, 999, performance.now());
    z.die(2);
  };
  /** where they come from: the tree line beyond the wreck, five abreast, 26 to 32 m off the pair */
  const comeFrom = (n: number) => near(-26 - (n % 2) * 6, (n - 2) * 3.2);
  const loose = () => {
    zeds.forEach((z, n) => {
      if (n < 5) putZ(z, comeFrom(n), yawTo(comeFrom(n), pairAt().volkov), true);
      else putZ(z, new THREE.Vector3(0, -300, 0), 0, false);
    });
  };
  add(4, {
    name: 'horde',
    m: 'tight',
    hit: 1.2,
    setup: async () => {
      clearPad();
      fall(fallTime());
      await troupe();
      const p = pairAt();
      cast(VOLKOV, p.volkov, yawTo(p.volkov, comeFrom(2)));
      cast(MIRA, p.mira, yawTo(p.mira, comeFrom(2)));
      A(VOLKOV).aim = A(MIRA).aim = true;
      loose();
    },
    stage: () => landed(),
    tick: () => void fall(fallTime()),
    cam: (t) => {
      // (low behind the pair, the wreck burning on one side and them coming out of the smoke)
      const p = pairAt();
      return hand({ p: p.volkov.clone().addScaledVector(fromRoof(), 4).addScaledVector(acrossRoof(), 2.2).setY(p.volkov.y + 0.9), l: comeFrom(2).clone().setY(comeFrom(2).y + 1.2), fov: 50 }, t, 1);
    },
    plates: [[0.6, 3.6, 'The infected hear it go up']],
  });

  // ------------------------------------------------------------ Mira is hit, and bleeding; Volkov cooks a frag and throws it
  let thrown = false;
  add(4, {
    name: 'cook',
    m: 'tight',
    hit: 1,
    hud: true,
    bars: false,
    setup: async () => {
      clearPad();
      fall(fallTime());
      await troupe();
      const p = pairAt();
      cast(MIRA, p.mira, yawTo(p.mira, comeFrom(2)));
      A(MIRA).bleeding = true;
      A(MIRA).crouch = true;
      loose();
      S.kit(['frag']);
      S.me(p.volkov.x, p.volkov.z, yawTo(p.volkov, comeFrom(2)), 0.05, p.volkov.y);
      g.takeUp(g.inv.slots.primary ?? [...g.inv.carried()].find((i: Any) => i.id === 'frag'));
      thrown = false;
      await run(40);
      // (the pin out, and the fuse running in the hand: held a second and a half before it goes)
      S.key('Mouse0', true);
    },
    stage: () => landed(),
    tick: (t) => {
      fall(fallTime());
      eyes(comeFrom(2).clone().setY(comeFrom(2).y + 3.5), 0.15);
      if (t > 2.5 && !thrown) {
        thrown = true;
        S.key('Mouse0', false);
      }
      // (what is near where it goes off, goes down: the game's blast is the film's, for these)
      const nade = S.myNade();
      if (nade && nade.fuse <= 0.02) for (const z of zeds) if (!z.dead && z.pos.distanceTo(nade.pos) < 7) dropZ(z, nade.pos);
    },
    plates: [[0.3, 2.4, 'Frag grenade · cooked in the hand']],
  });

  // ------------------------------------------------------------ Mira runs a blood bag into her arm: through her own eyes
  add(6, {
    name: 'blood',
    m: 'board',
    hud: true,
    bars: false,
    setup: async () => {
      clearPad();
      fall(fallTime());
      const p = pairAt();
      cast(VOLKOV, p.volkov.clone().addScaledVector(acrossRoof(), 1.2), yawTo(p.volkov, comeFrom(2)));
      A(VOLKOV).aim = true;
      // (the infected the frag took are lying where it took them; the rest are gone)
      for (const z of zeds) if (!z.dead) putZ(z, new THREE.Vector3(0, -300, 0), 0, false);
      S.kit([]);
      S.me(p.mira.x, p.mira.z, yawTo(p.mira, wreckAt()) + 0.25, -0.12, p.mira.y);
      g.player.crouched = true;
      // (bleeding out, and the wound already dressed: a bag of blood is what is wanted)
      const v = g.player.vitals;
      if (v) {
        v.health = 46;
        if ('blood' in v) v.blood = 2600;
        v.bleeding = false;
      }
      const bag = makeItem('blood_bag');
      if (g.inv.add(bag)) say('blood: no room for the bag');
      g.takeUp(bag);
      await run(45);
      S.key('Mouse0', true);
      await run(8);
      if (!g.use) say('blood: the bag was never begun on');
    },
    after: (t) => {
      if (t > 5.9) S.key('Mouse0', false);
    },
    plates: [[0.4, 5.6, `Blood bag · ${(ITEMS as Any).blood_bag?.use?.blood ?? 1500} ml back in ${(ITEMS as Any).blood_bag?.use?.over ?? 20} s`]],
  });

  // ============================================================ ACT 4: THE PAYOFF
  // ------------------------------------------------------------ the pilot's tag
  add(4, {
    name: 'tag',
    m: 'loot',
    hit: 1,
    setup: async () => {
      clearPad();
      fall(fallTime());
      laid = false;
      await layBody();
      const b = bodyAt(), kneel = G(b.x + fromRoof().x * 1.1, b.z + fromRoof().z * 1.1), watch = G(b.x - acrossRoof().x * 1.4 - fromRoof().x * 2.2, b.z - acrossRoof().z * 1.4 - fromRoof().z * 2.2);
      cast(VOLKOV, kneel, yawTo(kneel, b));
      A(VOLKOV).crouch = true;
      cast(MIRA, watch, yawTo(b, watch));
      A(MIRA).aim = true;
    },
    tick: () => void fall(fallTime()),
    cam: (t) => {
      // (beyond the body from the wreck, low: the body, the one kneeling at it, the wreck burning behind)
      const b = bodyAt(), p = b.clone().addScaledVector(acrossRoof(), 4.2).addScaledVector(fromRoof(), -1.6 + t * 0.2);
      return hand({ p: p.setY(S.ground(p.x, p.z) + 1.3), l: b.clone().setY(b.y + 0.35).lerp(wreckAt(), 0.15), fov: 46 }, t, 0.5);
    },
    plates: [[0.5, 3.6, 'His dog tag · held 15:00, then cashed in']],
  });

  // ------------------------------------------------------------ the boards: paid, frames, the Arena, next
  /**
   * What https://www.zonapvp.fun/api/cashins?format=json said when this was made (a read; never /api/tick), 14 Oct 2026:
   * 181 tags cashed in, 160 of them paid, 3.095 SOL to 26 wallets. A tag pays 0.01 SOL and a wallet is paid when five are
   * due (the rule of five, since 14 Oct 02:20 UTC). Read it again before filming again.
   */
  const LIVE = { on: '14 OCT 2026', cashed: 181, paid: 160, sol: 3.095, wallets: 26, tag: 0.01, five: 5 };
  const count = (to: number, t: number, from: number, len: number, dp = 0) => (to * ease((t - from) / len)).toFixed(dp);
  const paidBoard = Gx('x14-board', `
    <div class="b14-kick">PAID TO PLAYERS · AS OF ${LIVE.on}</div>
    <div class="b14-big"><b data-n="sol">0</b><small>SOL</small></div>
    <div class="b14-row"><span><b data-n="paid">0</b> tags paid</span><span><b data-n="wallets">0</b> wallets</span><span>${LIVE.tag} SOL a tag · paid when ${LIVE.five} are due</span></div>`);
  add(4, {
    name: 'paid',
    m: 'paid',
    hit: 1.2,
    setup: () => {
      clearPad();
      fall(fallTime());
    },
    tick: () => void fall(fallTime()),
    cam: (t) => {
      const w = wreckAt();
      return { p: w.clone().add(new THREE.Vector3(14 - t, 9 + t * 0.6, 14)), l: w, fov: 50 };
    },
    after: (t) => {
      show(paidBoard, t, Math.min(ease(t / 0.3), 1 - ease((t - 3.7) / 0.3)));
      const set = (k: string, v: string) => (paidBoard.querySelector(`[data-n="${k}"]`)!.textContent = v);
      set('sol', count(LIVE.sol, t, 0.2, 2.2, 3));
      set('paid', count(LIVE.paid, t, 0.4, 2.2));
      set('wallets', count(LIVE.wallets, t, 0.6, 2));
    },
  });
  /** what was measured on 14 Oct 2026, online, on one laptop (the changelog's "Performance boost" and its card) */
  const MEASURED = [['Village crossroads', 84, 121], ['Hospital street', 62, 92], ['Police HQ', 73, 101]] as const;
  const framesBoard = Gx('x14-board', `
    <div class="b14-kick">FRAMES A SECOND · BEFORE AND AFTER · MEASURED ON ONE LAPTOP</div>
    <div class="b14-big"><b>+48</b><small>%</small></div>
    <div class="b14-row">${MEASURED.map(([n, a, b]) => `<span>${n} <b>${a} → ${b}</b></span>`).join('')}</div>`);
  add(4, {
    name: 'frames',
    m: 'board',
    setup: () => {
      clearPad();
    },
    cam: (t) => ({ p: FG(rx + 30 - t * 2, gz + 12, 8 + t), l: F(2, 0, 6), fov: 46 }),
    after: (t) => show(framesBoard, t, Math.min(ease(t / 0.3), 1 - ease((t - 3.7) / 0.3))),
  });
  const nextBoard = Gx('x14-board', `
    <div class="b14-kick">NEXT · PLANNED, NOT IN THE GAME YET</div>
    <div class="b14-list"><span>A cellar under almost every house</span><span>Attics</span><span>Animals and hunting</span><span>Weather</span></div>`);
  add(4, {
    name: 'next',
    m: 'next',
    hit: 1,
    hour: 0.72,
    cam: (t) => ({ p: FG(rx + 40 - t * 1.5, gz - 18, 14), l: F(0, 0, 8), fov: 44 }),
    after: (t) => show(nextBoard, t, Math.min(ease(t / 0.3), 1 - ease((t - 3.7) / 0.3))),
  });
  const endCard = Gx('x12-end', `
    <div class="c12-list"><span>HELICOPTERS</span><span>SUPPLY DROPS</span><span>THE INFECTED</span><span>DOG TAGS</span></div>
    <div class="c12-name">ZONA <em>PvP</em></div>
    <div class="c12-url">WWW.ZONAPVP.FUN</div>`);
  add(6, {
    name: 'end',
    m: 'end',
    hit: 1.2,
    hour: 0.72,
    fadeOut: 1.2,
    setup: () => {
      clearPad();
      fall(fallTime());
      // (the two of them going, the wreck burning behind them)
      const w = wreckAt();
      cast(VOLKOV, w.clone().addScaledVector(fromRoof(), -8).addScaledVector(acrossRoof(), 1), yawTo(w, pairAt().jeep));
      cast(MIRA, w.clone().addScaledVector(fromRoof(), -8).addScaledVector(acrossRoof(), -0.6), yawTo(w, pairAt().jeep));
    },
    tick: (t, _S, dt) => {
      fall(fallTime());
      for (const i of [VOLKOV, MIRA]) {
        const a = A(i), to = pairAt().jeep;
        if (a.pos.distanceTo(to) > 2) a.go(to.x + (i === MIRA ? -1.2 : 0), to.z, 1.4, dt);
      }
      void t;
    },
    cam: (t) => {
      const w = wreckAt();
      return hand({ p: w.clone().addScaledVector(acrossRoof(), 12).addScaledVector(fromRoof(), -6).setY(w.y + 2.2 + t * 0.3), l: w.clone().addScaledVector(fromRoof(), -9).setY(w.y + 1), fov: 46 }, t, 0.3);
    },
    after: (t) => {
      if (t > 1.6) show(endCard, t - 1.6, ease((t - 1.6) / 0.6));
      else endCard.style.display = 'none';
    },
  });

  total = cur;
  say(`${shots.length} shots, ${total.toFixed(1)} s, ${ROWS.length} bars of score`);
  return shots;
}
