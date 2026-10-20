// The twenty-first film, 70 s: "Walk east" (2026-10-19, boarded in marketing/plan-x-media.html, the owner: "Yes, build
// it as planned"). One life from the far west beach at dawn to a lit town at night: a look round on the sand, a run to
// the river and a drink from it, Bereg's UAZ, the road east past Peski, Karavan and Blokpost, the map's tiers from west
// to east at dusk, out of the pass at night with Pokrov's lamps ahead, and its lit lane on foot.
// The owner on the films before it: "i just hate how unnatrual you make". So everything here moves as people move
// (src/trailer/human.ts): the player by his own keys and a hand on the mouse, the jeep by its own wheel and pedals,
// every outside lens carried by somebody (braced, on foot, from a car, a drone), nothing faster than the game lets it
// go; each shot prints how fast everything in it went. Cut on what happens, not on the bar. music17's band under it.
//   node scripts/film.mjs --cut 21
import * as THREE from 'three';
import type { Shot, Stage } from './director';
import { scoreMusic17, type Kind17, type Row17 } from './music17';
import { BRACED, DRONE, FROM_A_CAR, Hand, ON_FOOT, Operator, Speeds, wrap, yawTo } from './human';
import { DESERT_TIERS } from '../sim/desert';
import { physics } from '../core/physics';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const ROWS: Row17[] = [];
let total = 0;
export const seconds21 = () => total;
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic17(ctx, out, ROWS);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
/** forward and right for a yaw, as the game reckons it */
const fwdOf = (yaw: number) => V(-Math.sin(yaw), 0, -Math.cos(yaw));
const rightOf = (yaw: number) => V(Math.cos(yaw), 0, -Math.sin(yaw));

/** the middle of Pokrov's lane, between its two rows of lamps (west-towns.ts townLamps) */
const LANE = 34.5;
const DAWN = 0.27, MORNING = 0.3, DUSK = 0.735, NIGHT = 0.775;

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  const say = (s: string) => console.log(`[tr] ${s}`);
  document.body.classList.add('tr-cut21');
  const overlay = document.getElementById('tr-overlay')!;
  const piece = (cls: string, html = '') => {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    el.style.display = 'none';
    overlay.appendChild(el);
    return el;
  };
  const grain = piece('tr-grain4'), black = piece('tr-black4');
  piece('tr-vig4');
  grain.style.display = '';
  black.style.display = '';
  overlay.querySelector('.tr-vig4')!.removeAttribute('style');
  const title = piece('x21-title', '<img src="/brand/zona-mark.svg" alt=""><b>WALK <em>EAST</em></b><i>start on the coast</i>');
  const chip = piece('x21-chip', '<b></b><i></i>');
  const end = piece('x21-end', '<img src="/brand/zona-mark.svg" alt=""><b>WALK <em>EAST</em></b><p><span>PVP SURVIVAL</span><span>DOG TAGS PAY SOL</span><span>FREE IN YOUR BROWSER</span></p><u>zonapvp.fun</u>');
  // (a pointer as the system draws one, moved by the film's own hand: see `pointer`)
  const cursor = piece('x21-cursor', '<svg viewBox="0 0 16 24" width="16" height="24"><path d="M1 1 L1 19 L5.6 14.8 L8.6 21.8 L11.4 20.6 L8.5 13.8 L14.6 13.8 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>');
  const show = (el: HTMLElement, o: number) => {
    el.style.display = o > 0.002 ? '' : 'none';
    el.style.opacity = o.toFixed(3);
  };
  // (?bare=1: the pictures with no words over them, for the cards made from them)
  const BARE = new URLSearchParams(location.search).has('bare');
  const chipSay = (t: number, from: number, to: number, big: string, small: string) => {
    const o = BARE ? 0 : t < from || t > to ? 0 : Math.min(ease((t - from) / 0.35), ease((to - t) / 0.35));
    if (o <= 0) return void (chip.style.display = 'none');
    chip.querySelector('b')!.textContent = big;
    chip.querySelector('i')!.textContent = small;
    show(chip, o);
    chip.style.transform = `translateX(${((1 - o) * -24).toFixed(1)}px)`;
  };
  /** something done once in a shot, the first frame at or past `at` (a frame's time is never a whole number to wait for) */
  const fired = new Set<string>();
  const when = (t: number, at: number, key: string, fn: () => void) => {
    if (t >= at && !fired.has(key)) {
      fired.add(key);
      fn();
    }
  };
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());

  /** frames nobody sees or hears */
  const run = async (frames: number, each?: (k: number) => void) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      each?.(i);
      for (const a of S.actors) a.push();
      clock.advance(1000 / 60);
      if (i % 20 === 19) await wait(8);
    }
    S.mute = false;
  };

  // ------------------------------------------------------------ the player: his legs and his hand
  const P = () => g.player as Any;
  const eye = () => {
    const p = P().pos as THREE.Vector3;
    return V(p.x, p.y + 1.62, p.z);
  };
  const hand = new Hand(21, eye);
  /** a way on foot: a smooth line through points, walked (Alt), jogged, or sprinted, let go of a little before its end */
  interface Way { c: THREE.CatmullRomCurve3; len: number; stop: number; sprint: boolean; walk: boolean }
  let way: Way | null = null;
  const lay = (pts: THREE.Vector3[], o: { stop?: number; sprint?: boolean; walk?: boolean } = {}): Way => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    c.arcLengthDivisions = 400;
    return { c, len: c.getLength(), stop: o.stop ?? 0.5, sprint: !!o.sprint, walk: !!o.walk };
  };
  const along = (w: Way, p: THREE.Vector3) => {
    let best = 1e9, bu = 0;
    for (let i = 0; i <= 200; i++) {
      const q = w.c.getPointAt(i / 200), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < best) { best = d; bu = i / 200; }
    }
    return bu * w.len;
  };
  /** the point a runner's eyes are on: a few metres on along his way, at about the height of his eyes */
  const ahead = (m: number) => () => {
    const w = way!, s = Math.min(w.len, along(w, P().pos) + m), q = w.c.getPointAt(s / w.len);
    return V(q.x, S.ground(q.x, q.z) + 1.35, q.z);
  };
  /** the keys a player holds to go along it; the metres still to go */
  const legs = () => {
    if (!way) return Infinity;
    const left = way.len - along(way, P().pos);
    S.key('KeyW', left > way.stop);
    S.key('ShiftLeft', way.sprint && left > 5);
    S.key('AltLeft', way.walk && left > way.stop);
    return left;
  };
  /** the view where the hand has it */
  const look = (t: number, dt: number) => {
    const a = hand.update(t, dt);
    P().yaw = a.yaw;
    P().pitch = Math.max(-1.3, Math.min(1.3, a.pitch));
  };
  const pl = (x: number, z: number) => V(x, S.ground(x, z), z);

  // ------------------------------------------------------------ the jeep, its wheel and its pedals
  const roadPts = (i: number) => {
    const p = S.world.roads[i].points as Float32Array, out: THREE.Vector3[] = [];
    for (let k = 0; k < p.length; k += 3) out.push(V(p[k], p[k + 1], p[k + 2]));
    return out;
  };
  const nearest = (pts: THREE.Vector3[], x: number, z: number) => {
    let best = 1e18, bi = 0;
    pts.forEach((q, i) => {
      const d = (q.x - x) ** 2 + (q.z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    });
    return bi;
  };
  // the way east: from Bereg up its road to the main road, then the main road east through the pass to Pokrov
  const ROUTE = (() => {
    const r18 = roadPts(18).reverse(), r9 = roadPts(9).reverse();
    const tail = r9.slice(nearest(r9, r18[r18.length - 1].x, r18[r18.length - 1].z) + 1);
    return [...r18, ...tail.slice(0, nearest(tail, -1700, 33) + 1)];
  })();
  const R = (x: number, z: number) => nearest(ROUTE, x, z);
  let J: Any = null, at = 0, cruise = 13, stopAt = Infinity;
  const pickJeep = () => {
    const all = [...g.garage.jeeps.values()].filter((j: Any) => !j.wreck);
    const by = (j: Any) => Math.hypot(j.pos.x + 3536, j.pos.z + 364) + (j.kind ? 1e4 : 0);
    all.sort((a: Any, b: Any) => by(a) - by(b));
    J = all[0];
    if (!J) throw new Error('no jeep in the world');
    say(`the jeep: kind ${J.kind ?? 0}, from ${Math.round(J.pos.x)},${Math.round(J.pos.z)}`);
  };
  /** the jeep stood at a point of the way, facing along it, going at v */
  const putJeep = (k: number, v: number) => {
    const a = ROUTE[k], b = ROUTE[Math.min(ROUTE.length - 1, k + 3)], yaw = yawTo(a, b), f = fwdOf(yaw);
    J.place([a.x, a.y + 0.85, a.z, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2), f.x * v, 0, f.z * v, 0, 0]);
    J.hp = 5400;
    J.fuel = 40;
    at = k;
  };
  /** at the wheel: sat in from its door */
  const board = () => {
    if (g.garage.ride) return;
    const door = J.point(-1.9, 0, 0.2, new THREE.Vector3());
    S.me(door.x, door.z, J.yaw, 0);
    g.garage.use(J);
    if (!g.garage.ride) say('could not get in');
  };
  const dist2 = (a: THREE.Vector3, b: THREE.Vector3) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  /**
   * A driver on a keyboard: the side the road goes is held while it goes on, a lift off the throttle for a bend taken
   * too fast, and the brake brought on early enough to stop where he means to (a jeep's brake gives about 5 m/s²).
   */
  const wheel = () => {
    if (!J || !g.garage.ride) return;
    while (at < ROUTE.length - 2 && dist2(ROUTE[at + 1], J.pos) < dist2(ROUTE[at], J.pos)) at++;
    let k = at, d = 0;
    const want = 6 + Math.abs(J.speed) * 0.6;
    while (k < ROUTE.length - 1 && d < want) {
      d += flat(ROUTE[k], ROUTE[k + 1]);
      k++;
    }
    const err = wrap(yawTo(J.pos, ROUTE[k]) - J.yaw);
    S.key('KeyA', err > 0.035);
    S.key('KeyD', err < -0.035);
    let left = Infinity;
    if (stopAt < ROUTE.length) {
      left = 0;
      for (let i = at; i < stopAt; i++) left += flat(ROUTE[i], ROUTE[i + 1]);
      if (at >= stopAt) left = 0;
    }
    const v = Math.abs(J.speed), stopping = left < (v * v) / 10 + 2.5, hot = Math.abs(err) > 0.35 && v > 8;
    S.key('KeyW', !hot && !stopping && v < cruise);
    S.key('KeyS', (hot || stopping) && v > 0.6);
  };

  // ------------------------------------------------------------ the pointer on the map: a hand moves it
  const mouse = { x: 640, y: 420, fx: 640, fy: 420, tx: 640, ty: 420, t0: 0, dur: 0.01, on: null as Element | null };
  const pointTo = (t: number, x: number, y: number) => {
    const d = Math.hypot(x - mouse.x, y - mouse.y);
    Object.assign(mouse, { fx: mouse.x, fy: mouse.y, tx: x, ty: y, t0: t, dur: 0.16 + 0.11 * Math.log2(1 + d / 12) });
  };
  const pointer = (t: number) => {
    const u = clamp01((t - mouse.t0) / mouse.dur), s = u * u * u * (10 - 15 * u + 6 * u * u);
    // (a hand's path bows a little off the straight line, and comes in a hair past the mark)
    const bow = Math.sin(u * Math.PI) * 0.06, dx = mouse.tx - mouse.fx, dy = mouse.ty - mouse.fy;
    mouse.x = mouse.fx + dx * s * 1.02 - dy * bow;
    mouse.y = mouse.fy + dy * s * 1.02 + dx * bow;
    if (u >= 1) {
      mouse.x = mouse.tx;
      mouse.y = mouse.ty;
    }
    const r = overlay.getBoundingClientRect();
    cursor.style.left = `${(mouse.x - r.left).toFixed(1)}px`;
    cursor.style.top = `${(mouse.y - r.top).toFixed(1)}px`;
    // what is under it hears it come and go, as the page would from a real one
    const under = [...document.querySelectorAll('[data-tier], .hm-way')].find((b) => {
      const q = b.getBoundingClientRect();
      return mouse.x >= q.left && mouse.x <= q.right && mouse.y >= q.top && mouse.y <= q.bottom;
    }) ?? null;
    if (under !== mouse.on) {
      mouse.on?.dispatchEvent(new PointerEvent('pointerleave'));
      under?.dispatchEvent(new PointerEvent('pointerenter'));
      mouse.on = under;
    }
  };
  const mid = (el: Element | null | undefined) => {
    const q = el?.getBoundingClientRect();
    return q ? [q.left + q.width * 0.55, q.top + q.height * 0.6] : [640, 360];
  };

  // ------------------------------------------------------------ how fast everything went
  const speeds = new Speeds();
  let lastShot = '';
  const tally = (t: number) => {
    if (g.garage.ride && J) speeds.note('jeep', t, J.pos);
    else speeds.note('player', t, P().pos);
    if (S.cam) speeds.note('lens', t, S.cam.p);
  };

  // ------------------------------------------------------------ the set
  let warmed = false;
  const warm = async () => {
    if (warmed) return;
    warmed = true;
    try { localStorage.setItem('zona-howto-seen', '1'); } catch { /* */ }
    (document.querySelector('.howto-ok') as HTMLElement | null)?.click();
    pickJeep();
    // every place looked at once, so nothing is drawn for the first time in a shot
    const t0 = clock.real.now();
    for (const [x, z, lx, lz] of [[-3596, -352, -3620, -370], [-3570, -400, -3560, -425], [-3546, -392, -3536, -366], [-3500, -30, -3470, 70], [-3150, -20, -2930, 0], [-2800, -190, -2500, -300], [-1998, -404, -2080, -432], [-2022, -270, -1950, 40], [-1930, 38, -1850, 36]]) {
      S.cam = { p: V(x, S.ground(x, z) + 2, z), l: V(lx, S.ground(lx, lz) + 1.5, lz), fov: 50 };
      await run(90);
      await wait(150);
    }
    S.cam = null;
    say(`the set is ready; ${((clock.real.now() - t0) / 1000).toFixed(1)} s`);
  };
  const reset = () => {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'AltLeft', 'KeyF', 'Mouse0', 'Mouse2']) S.key(k, false);
    if (g.map?.open) g.toggleMap(false);
    // (out without the door's sound; and the seat let go, which only a told getting out does: a seat left taken
    // sent the next get-in to a passenger's, and the jeep sat still)
    if (g.garage.ride) g.garage.out(false);
    if (J) J.seats.fill(null);
    way = null;
    stopAt = Infinity;
    cruise = 13;
    for (const el of [chip, end, cursor, title]) el.style.display = 'none';
    mouse.on = null;
    fired.clear();
  };
  /** fresh off the beach: what the game gives a new life (enter.ts freshKit), nothing in the hands */
  const fresh = () => {
    S.kit(['beans', 'thermos', 'bandage']);
    S.hold(null);
  };

  const shots: Shot[] = [];
  let cur = 0, hourWas = -1;
  interface Extra {
    hour: number;
    /** seconds of the start's black, and of the end's */
    fadeIn?: number;
    fadeOut?: number;
    /** what moves (the clock running) before its first frame: its own tick, said at times before 0 */
    leadTick?: boolean;
  }
  const add = (len: number, s: Omit<Shot, 'start' | 'end'> & Extra) => {
    const start = cur, setup = s.setup, after = s.after, tick = s.tick;
    cur += len;
    total = cur;
    let lt = -1;
    shots.push({
      bars: false,
      ...s,
      start,
      end: start + len,
      setup: async (st) => {
        if (lastShot) say(`${lastShot}: ${speeds.report()}`);
        lastShot = s.name;
        try {
          g.hourHeld = hourWas < 0 ? s.hour : hourWas;
          await warm();
          reset();
          g.hourHeld = s.hour;
          if (s.hour !== hourWas) await run(150);
          hourWas = s.hour;
          await setup?.(st);
          lt = -1;
        } catch (e) {
          say(`${s.name}: its setting up failed: ${(e as Error).message}`);
        }
      },
      lead: s.leadTick === false ? undefined : (t, st) => {
        const dt = lt < -0.9 ? 1 / 60 : t - lt;
        lt = t;
        tick?.(t, st, dt);
      },
      tick: (t, st, dt) => {
        lt = t;
        tick?.(t, st, dt);
      },
      after: (t, st) => {
        after?.(t, st);
        tally(t);
        hush();
        const a = s.fadeIn ? 1 - ease(t / s.fadeIn) : 0, z = s.fadeOut ? ease((t - (len - s.fadeOut)) / s.fadeOut) : 0;
        black.style.opacity = String(Math.max(a, z));
        if (start + len >= total - 1e-6 && t > len - 0.05) say(`${s.name}: ${speeds.report()}`);
      },
    } as Shot);
  };
  /** the score: what each stretch of it plays, two-second bars, a blow where a stretch begins */
  const scoreRows = (parts: [Kind17, number][]) => {
    for (const [kind, bars] of parts) for (let b = 0; b < bars; b++) ROWS.push({ kind, hit: b === 0 ? 0.8 : undefined, build: bars > 1 ? b / (bars - 1) : undefined, lift: b === bars - 1 ? 1 : undefined });
  };

  // ============================================================ 1 · dawn, the far west beach (braced on the sand behind him)
  {
    // (the sea is a hundred metres on west of where the game sets a new life down: so the lens stands on its side of
    // him, and he is seen looking back at it and then going off inland, the way the film goes)
    const start = pl(-3610, -360), lensAt = V(-3621.5, S.ground(-3621.5, -364) + 1.3, -364);
    const op = new Operator(BRACED, 1, 32);
    add(5.5, {
      name: 'beach',
      hour: DAWN,
      leadTick: false,
      setup: async () => {
        fresh();
        S.me(start.x, start.z, -1.57, -0.04);
        P().vitals.water = 34;
        hand.set(-1.57 - 0.25, -0.03);
        way = null;
        await run(30);
        op.reset(lensAt, eye().setY(eye().y + 0.45));
      },
      tick: (t, _S, dt) => {
        when(t, 0.45, 'sea', () => hand.look(t, V(-3700, -15, -392)));
        when(t, 1.75, 'land', () => hand.look(t, V(-3560, S.ground(-3560, -412) + 1.4, -412)));
        if (t > 2.4 && !way) {
          way = lay([P().pos.clone(), pl(-3598, -373), pl(-3586, -386), pl(-3572, -400)]);
          hand.look(t, ahead(7), true);
        }
        legs();
        look(t, dt);
      },
      cam: (t) => op.update(t, lensAt, eye().setY(eye().y + 0.45)),
      after: (t) => show(title, t < 3.4 ? 1 : 1 - ease((t - 3.4) / 1)),
    });
  }

  // ============================================================ 2 · down to the river, and a drink (his own eyes, one take)
  {
    let bank = V(0, 0, 0), water = V(0, 0, 0), drankAt = -1, arrived = -1;
    add(8.5, {
      name: 'river',
      hud: true,
      hour: MORNING,
      setup: async () => {
        fresh();
        // the bank: from the river's middle out to the first dry ground, and a step on (as drink-look.js found it)
        const x = -3566;
        let z = -425.7;
        while (P().water(x, z) && z < -400) z += 0.25;
        bank = pl(x - 1, z + 0.7);
        water = V(x - 2.5, -14.8, z - 2.2);
        const p0 = pl(-3583, -401);
        S.me(p0.x, p0.z, yawTo(p0, bank), -0.04);
        P().vitals.water = 24;
        hand.set(yawTo(p0, bank) + 0.12, -0.05);
        way = lay([p0, pl(-3577, -407), pl(-3571, -412.5), bank], { stop: 0.35 });
        hand.look(-0.5, ahead(7), true, 0);
        drankAt = arrived = -1;
      },
      tick: (t, _S, dt) => {
        const left = legs();
        when(t, 1.5, 'down', () => hand.look(t, V(-3612, -14.9, -425)));
        when(t, 2.3, 'on', () => hand.look(t, ahead(7), true));
        if (left < 1.6 && arrived < 0) {
          arrived = t;
          hand.look(t, water);
        }
        if (arrived > 0 && drankAt < 0 && t > arrived + 0.85) {
          drankAt = t;
          S.tap('KeyF', 120);
        }
        if (drankAt > 0) when(t, drankAt + 4.1, 'up', () => hand.look(t, V(-3536, S.ground(-3536, -366) + 2.2, -366)));
        look(t, dt);
      },
    });
  }

  // ============================================================ 3 · up to Bereg's UAZ (on foot behind him)
  {
    const op = new Operator(ON_FOOT, 3, 46);
    let door = V(0, 0, 0), gotIn = -1, at0 = -1;
    const heading = () => {
      const w = way!, s = along(w, P().pos), q = w.c.getTangentAt(Math.min(0.999, s / w.len));
      return Math.atan2(-q.x, -q.z);
    };
    add(5, {
      name: 'jeep',
      hour: MORNING,
      setup: async () => {
        fresh();
        // the jeep where Bereg's stands, turned to face up its road
        const k = R(-3540, -366);
        J.place([-3535.5, ROUTE[k].y + 0.85, -366, 0, Math.sin(Math.PI / 2), 0, Math.cos(Math.PI / 2), 0, 0, 0, 0, 0]);
        await run(20);
        door = J.point(-1.9, 0, 0.2, new THREE.Vector3());
        const p0 = pl(-3549, -386.5);
        S.me(p0.x, p0.z, yawTo(p0, door), -0.05);
        way = lay([p0, pl(-3545.5, -378), door.clone().setY(S.ground(door.x, door.z))], { stop: 0.6 });
        hand.set(yawTo(p0, door), -0.05);
        hand.look(-0.5, ahead(6), true, 0);
        gotIn = at0 = -1;
        const f = fwdOf(yawTo(p0, door)), r = rightOf(yawTo(p0, door));
        op.reset(p0.clone().addScaledVector(f, -6).addScaledVector(r, -2.2).setY(p0.y + 1.55), eye(), f.clone().multiplyScalar(3.8));
      },
      tick: (t, _S, dt) => {
        if (gotIn < 0) {
          const left = legs();
          if (left < 0.9 && at0 < 0) at0 = t;
          if (at0 > 0 && t > at0 + 0.35) {
            gotIn = t;
            for (const k of ['KeyW', 'ShiftLeft', 'AltLeft']) S.key(k, false);
            g.garage.use(J);
          }
        }
        if (gotIn < 0) look(t, dt);
      },
      cam: (t) => {
        const p = P().pos as THREE.Vector3, yaw = way && gotIn < 0 ? heading() : yawTo(p, door), f = fwdOf(yaw), r = rightOf(yaw);
        const want = p.clone().addScaledVector(f, -5.5).addScaledVector(r, -2.0);
        want.y = Math.max(S.ground(want.x, want.z), p.y) + 1.55;
        return op.update(t, want, p.clone().addScaledVector(f, 2.5).setY(p.y + 1.2));
      },
    });
  }

  // ============================================================ 4 · off up the road (the game's own view from behind)
  add(5, {
    name: 'drive-off',
    hud: true,
    hour: MORNING,
    setup: async () => {
      fresh();
      const k = R(-3540, -350);
      putJeep(k, 0);
      await run(10);
      board();
      await run(20);
      putJeep(k, 5);
      cruise = 12;
    },
    tick: () => wheel(),
  });

  // ============================================================ 5 · past Peski (from a car alongside, on its far side)
  {
    const op = new Operator(FROM_A_CAR, 5, 40);
    add(5.5, {
      name: 'peski',
      hour: MORNING,
      setup: async () => {
        fresh();
        const k = R(-3545, 0);
        putJeep(k, 0);
        await run(10);
        board();
        await run(10);
        putJeep(k, 12.5);
        cruise = 14;
        const f = fwdOf(J.yaw), r = rightOf(J.yaw);
        op.reset(J.pos.clone().addScaledVector(r, -7).addScaledVector(f, 2).setY(J.pos.y + 0.5), J.pos, f.clone().multiplyScalar(12.5));
      },
      tick: () => wheel(),
      cam: (t) => {
        const f = fwdOf(J.yaw), r = rightOf(J.yaw);
        const want = J.pos.clone().addScaledVector(r, -7).addScaledVector(f, 2.2);
        want.y = Math.max(S.ground(want.x, want.z) + 1.3, J.pos.y + 0.45);
        return op.update(t, want, J.pos.clone().addScaledVector(f, 0.6).setY(J.pos.y + 0.35));
      },
      after: (t) => chipSay(t, 1.0, 4.4, 'PESKI', `tier ${DESERT_TIERS.Peski} · the desert`),
    });
  }

  // ============================================================ 6 · the desert road, Karavan and Blokpost ahead (a drone)
  {
    const op = new Operator(DRONE, 6, 52);
    add(5.5, {
      name: 'desert',
      hour: MORNING + 0.04,
      setup: async () => {
        fresh();
        const k = R(-3200, -52);
        putJeep(k, 0);
        await run(10);
        board();
        await run(10);
        putJeep(k, 13.5);
        cruise = 14;
        const f = fwdOf(J.yaw), r = rightOf(J.yaw);
        op.reset(J.pos.clone().addScaledVector(f, -15).addScaledVector(r, -6).setY(J.pos.y + 15), J.pos.clone().addScaledVector(f, 30), f.clone().multiplyScalar(13.5));
      },
      tick: () => wheel(),
      cam: (t) => {
        const f = fwdOf(J.yaw), r = rightOf(J.yaw);
        return op.update(t, J.pos.clone().addScaledVector(f, -15).addScaledVector(r, -6).setY(J.pos.y + 15), J.pos.clone().addScaledVector(f, 30));
      },
      after: (t) => chipSay(t, 1.0, 4.5, 'KARAVAN · BLOKPOST', `tier ${DESERT_TIERS.Karavan} · tier ${DESERT_TIERS.Blokpost}`),
    });
  }

  // ============================================================ 7 · dusk, pulled over: the map, west to east
  {
    let opened = -1, shut = -1, planned = false;
    const plan: [number, () => Element | null][] = [];
    add(8.5, {
      name: 'map',
      hud: true,
      hour: DUSK,
      fadeOut: 0.45,
      leadTick: false,
      setup: async () => {
        fresh();
        // the jeep left on the verge, and him beside it looking on east along the road
        const k = R(-2800, -186), a = ROUTE[k], b = ROUTE[k + 4], yaw = yawTo(a, b), r = rightOf(yaw), f = fwdOf(yaw);
        const jp = a.clone().addScaledVector(r, 3.2).addScaledVector(f, 3);
        J.place([jp.x, S.ground(jp.x, jp.z) + 0.85, jp.z, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2), 0, 0, 0, 0, 0]);
        const me = a.clone().addScaledVector(r, 1.0).addScaledVector(f, -1.5);
        S.me(me.x, me.z, yaw - 0.12, -0.02);
        hand.set(yaw - 0.12, -0.02);
        opened = shut = -1;
        planned = false;
        plan.length = 0;
        mouse.x = mouse.tx = mouse.fx = 700;
        mouse.y = mouse.ty = mouse.fy = 470;
        await run(30);
      },
      tick: (t, _S, dt) => {
        when(t, 0.35, 'east', () => hand.look(t, V(-2500, S.ground(-2500, -300) + 30, -300)));
        if (t > 1.0 && opened < 0) {
          opened = t;
          g.toggleMap(true);
        }
        if (shut < 0 && t > 7.1) {
          shut = t;
          g.toggleMap(false);
        }
        look(t, dt);
      },
      after: (t) => {
        // (the map's own words for its tiers: src/ui/bigmap.ts, the title of .hm-tiers)
        if (opened > 0) chipSay(t, opened + 1.4, Math.min(7.0, opened + 5.8), 'WORSE LOOT WEST, BETTER EAST', 'the coast is tier 1 · the bunker tier 5');
        if (opened < 0 || shut > 0) {
          cursor.style.display = 'none';
          return;
        }
        // the pointer: in from where it was left, along the tiers from the west, a rest on each to read it, and on east
        if (!planned) {
          planned = true;
          const tiers = [...document.querySelectorAll('[data-tier]')], ways = [...document.querySelectorAll('.hm-tiers .hm-way')];
          const at0 = opened + 0.75;
          plan.push([at0, () => ways[0] ?? null]);
          tiers.forEach((b, i) => plan.push([at0 + 0.6 + i * 0.82, () => b]));
          plan.push([at0 + 0.6 + tiers.length * 0.82, () => ways[1] ?? null]);
          say(`the map: ${tiers.length} tier buttons, ${ways.length} ends`);
        }
        while (plan.length && plan[0][0] <= t) {
          const [, el] = plan.shift()!;
          const [x, y] = mid(el());
          pointTo(t, x, y);
        }
        if (t > opened + 0.6) {
          cursor.style.display = '';
          pointer(t);
        }
      },
    });
  }

  // ============================================================ 8 · night, up the road from the pass: the lights ahead (the game's own view)
  add(5.5, {
    name: 'lights',
    hud: true,
    hour: NIGHT,
    fadeIn: 0.6,
    setup: async () => {
      fresh();
      const k = R(-2022, -280);
      putJeep(k, 0);
      await run(10);
      board();
      await run(10);
      putJeep(k, 12);
      cruise = 13;
    },
    tick: () => wheel(),
    after: (t) => chipSay(t, 1.0, 5.0, 'POKROV', 'its lamps seen from 1.6 km'),
  });

  // ============================================================ 9 · and in under them (braced at the lane's west end)
  {
    const lensAt = V(-1893, S.ground(-1893, LANE - 1) + 1.5, LANE - 1);
    const op = new Operator(BRACED, 9, 36);
    add(5.5, {
      name: 'arrive',
      hour: NIGHT,
      setup: async () => {
        fresh();
        const k = R(-1958, 39.5);
        putJeep(k, 0);
        await run(10);
        board();
        await run(10);
        putJeep(k, 9);
        cruise = 9;
        stopAt = R(-1912, 40);
        op.reset(lensAt, J.pos.clone().setY(J.pos.y + 0.5));
      },
      tick: () => wheel(),
      cam: (t) => op.update(t, lensAt, J.pos.clone().setY(J.pos.y + 0.5)),
    });
  }

  // ============================================================ 10 · Pokrov's lane: out, a gun up, on foot (his own eyes)
  {
    let out = -1, drawn = -1;
    add(9, {
      name: 'street',
      hud: true,
      hour: NIGHT,
      setup: async () => {
        S.kit(['beans', 'thermos', 'bandage', 'm9', ['ammo_9mm', 15]]);
        S.hold(null);
        // (where the jeep came to a stop in the shot before)
        const k = R(-1912, 40);
        putJeep(k, 0);
        await run(10);
        board();
        await run(40);
        stopAt = k;
        out = drawn = -1;
      },
      tick: (t, _S, dt) => {
        if (out < 0) {
          wheel();
          if (t > 0.35 && Math.abs(J.speed) < 0.25) {
            out = t;
            for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) S.key(k, false);
            g.garage.out();
            const p = P().pos as THREE.Vector3, yaw = J.yaw;
            // (how far the houses are either side of him, by the physics: the lane is walked down its middle)
            const reach = (dz: number) => physics.raycast({ x: p.x + 4, y: p.y + 1.2, z: p.z }, { x: 0, y: 0, z: dz }, 30)?.toi ?? 30;
            say(`out of the jeep at ${p.x.toFixed(1)},${p.z.toFixed(1)}: houses ${reach(1).toFixed(1)} m to +z, ${reach(-1).toFixed(1)} m to -z; the jeep at ${J.pos.x.toFixed(1)},${J.pos.z.toFixed(1)}`);
            hand.set(yaw + 0.25, -0.02);
            hand.look(t + 0.05, V(-1860, S.ground(-1860, LANE) + 2.2, LANE), false, 0.15);
            way = lay([p.clone(), pl(p.x + 5, LANE + 1), pl(p.x + 14, LANE), pl(-1868, LANE)], { walk: true, stop: 0.4 });
          }
          return;
        }
        if (drawn < 0 && t > out + 0.5) {
          drawn = t;
          S.hold('holster', true);
        }
        if (t > out + 1.4) legs();
        when(t, out + 3.0, 'tavern', () => hand.look(t, V(-1884, S.ground(-1884, 28) + 2.6, 28)));
        when(t, out + 3.9, 'lane', () => hand.look(t, ahead(9), true));
        look(t, dt);
      },
    });
  }

  // ============================================================ 11 · the lane at night, him in it, the end card (braced)
  {
    const lensAt = V(-1846, S.ground(-1846, LANE - 1) + 1.5, LANE - 1);
    const op = new Operator(BRACED, 11, 38);
    add(6.5, {
      name: 'end',
      hour: NIGHT,
      setup: async () => {
        S.kit(['beans', 'thermos', 'bandage', 'm9', ['ammo_9mm', 15]]);
        S.hold('holster');
        const p0 = pl(-1867, LANE);
        S.me(p0.x, p0.z, yawTo(p0, lensAt), -0.05);
        hand.set(yawTo(p0, lensAt), -0.05);
        way = lay([p0, pl(-1860, LANE), pl(-1852, LANE)], { walk: true, stop: 0.5 });
        hand.look(-0.3, ahead(9), true, 0);
        op.reset(lensAt, eye());
      },
      tick: (t, _S, dt) => {
        legs();
        look(t, dt);
      },
      cam: (t) => op.update(t, lensAt, eye().setY(eye().y - 0.3)),
      after: (t) => show(end, ease((t - 1.3) / 0.9)),
    });
  }

  // the score, under the shots: dawn and the river quiet, the band for the road, dusk uneasy, night building to the end
  scoreRows([['camp', 7], ['march', 3], ['groove', 8], ['sneak', 4], ['dread', 5], ['tight', 5], ['end', 3]]);
  if (Math.abs(ROWS.length * 2 - total) > 0.01) say(`the score is ${ROWS.length * 2} s and the film ${total} s`);
  say(`${shots.length} shots, ${total.toFixed(1)} s, ${ROWS.length} bars of score, the way east ${ROUTE.length} points`);
  return shots;
}
