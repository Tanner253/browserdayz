// The twenty-fourth film, 26 s: "Under the hood" (2026-10-21, boarded in marketing/plan-film-24.html; the owner: "weve
// been doing a lot of behind the scenes work today.. people are wondering what progress is being made. make us look
// good"). Two days of work nobody sees, shown where it is felt: the woods the triangles came off (the forest spot of the
// measurements, x 350 z 140), the grass switched off for real in the pause menu, a walk into a room of loot with no
// stop, the measured numbers on a board, and the fair-play rules over a man watching Pokrov at dusk. Moved as films 21
// and 22 are (src/trailer/human.ts). Every figure is one measured (see FIGURES).   node scripts/film.mjs --cut 24
import * as THREE from 'three';
import type { Shot, Stage } from './director';
import { scoreMusic17, type Kind17, type Row17 } from './music17';
import { BRACED, DRONE, Hand, ON_FOOT, Operator, Speeds, yawTo } from './human';
import { loadGraphics, saveGraphics } from '../core/settings';
import { inZona } from '../world/zona';
import { physics } from '../core/physics';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const ROWS: Row17[] = [];
let total = 0;
export const seconds24 = () => total;
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic17(ctx, out, ROWS);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const fwdOf = (yaw: number) => V(-Math.sin(yaw), 0, -Math.cos(yaw));
const rightOf = (yaw: number) => V(Math.cos(yaw), 0, -Math.sin(yaw));

/**
 * Where every figure on the screen is from. The flight: the owner's recorded helicopter flight replayed
 * (assets-src/_wf/me/runs/owner-run-2.json, progress/flight-1021.log; 81.1 on 19 Oct, memory note canyon-stalls). The card:
 * the game on it at peak over the same 5.6-minute online route, live build then new (progress/perf-1021/report.md). The
 * load: commit ba2fae9 (178 -> 132 MB into the game, 240.5 -> 187.6 s on Fast 4G). Triangles: perf-1021/forest
 * (7.46M -> 5.99M in the forest, 2.87M -> 1.99M in the open). Loot: 9220e4a (stalls of 360-410 ms, none after). Cheat
 * scripts: c721b3e. Idle: 5f3844b (60 s). The rest: the changelog of 4a8f542.
 */
const FIGURES = { fps: 114.8, fpsWas: 81.1, gbLess: 1.24, gbWas: 6.19, gbNow: 4.94, loadSooner: 53, mbLess: 46 };

const MORNING = 0.33, DUSK = 0.745;
const FOREST = { x: 350, z: 140, yaw: -2.1 }, FIELD = { x: -1400, z: -200 };

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
  piece('tr-grain4').style.display = '';
  piece('tr-vig4').style.display = '';
  const black = piece('tr-black4');
  black.style.display = '';
  const title = piece('x21-title', '<img src="/brand/zona-mark.svg" alt=""><b>UNDER THE <em>HOOD</em></b><i>this week in ZONA</i>');
  const chip = piece('x21-chip', '<b></b><i></i>');
  const board = piece('x23-board', `<i>Measured</i><div>
    <p><b>${FIGURES.fps} fps</b><span>the owner's recorded helicopter flight, replayed: ${FIGURES.fpsWas} on 19 Oct</span></p>
    <p><b>${FIGURES.gbLess} GB less</b><span>the game on the graphics card at peak: ${FIGURES.gbWas} → ${FIGURES.gbNow} GB</span></p>
    <p><b>${FIGURES.loadSooner} s sooner</b><span>into the game on Fast 4G, ${FIGURES.mbLess} MB less to load</span></p></div>`);
  const line = piece('x23-line', '<b></b>');
  const end = piece('x21-end x23-end', '<img src="/brand/zona-mark.svg" alt=""><b>UNDER THE <em>HOOD</em></b><h5>Also this week</h5><p><span>Rarer radios and heavy snipers</span><span>.50s weaker on helicopters</span><span>No more sticking to cars</span></p><u>zonapvp.fun/changelog</u>');
  const cursor = piece('x21-cursor', '<svg viewBox="0 0 16 24" width="16" height="24"><path d="M1 1 L1 19 L5.6 14.8 L8.6 21.8 L11.4 20.6 L8.5 13.8 L14.6 13.8 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>');
  const show = (el: HTMLElement, o: number) => {
    el.style.display = o > 0.002 ? '' : 'none';
    el.style.opacity = o.toFixed(3);
  };
  const chipSay = (t: number, from: number, to: number, big: string, small: string) => {
    const o = t < from || t > to ? 0 : Math.min(ease((t - from) / 0.35), ease((to - t) / 0.35));
    if (o <= 0) return void (chip.style.display = 'none');
    chip.querySelector('b')!.textContent = big;
    chip.querySelector('i')!.textContent = small;
    show(chip, o);
    chip.style.transform = `translateX(${((1 - o) * -24).toFixed(1)}px)`;
  };
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
  const fired = new Set<string>();
  const when = (t: number, at: number, key: string, fn: () => void) => {
    if (t >= at && !fired.has(key)) {
      fired.add(key);
      fn();
    }
  };
  const run = async (frames: number) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      for (const a of S.actors) a.push();
      clock.advance(1000 / 60);
      if (i % 20 === 19) await wait(8);
    }
    S.mute = false;
  };

  // ------------------------------------------------------------ him: his legs and his hand (as in shots21.ts)
  const P = () => g.player as Any;
  const eye = () => {
    const p = P().pos as THREE.Vector3;
    return V(p.x, p.y + 1.62, p.z);
  };
  const hand = new Hand(24, eye);
  interface Way { c: THREE.CatmullRomCurve3; len: number; stop: number; walk: boolean }
  let way: Way | null = null;
  const lay = (pts: THREE.Vector3[], o: { stop?: number; walk?: boolean } = {}): Way => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    c.arcLengthDivisions = 400;
    return { c, len: c.getLength(), stop: o.stop ?? 0.5, walk: !!o.walk };
  };
  const along = (w: Way, p: THREE.Vector3) => {
    let best = 1e9, bu = 0;
    for (let i = 0; i <= 200; i++) {
      const q = w.c.getPointAt(i / 200), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < best) { best = d; bu = i / 200; }
    }
    return bu * w.len;
  };
  const ahead = (m: number) => () => {
    const w = way!, s = Math.min(w.len, along(w, P().pos) + m), q = w.c.getPointAt(s / w.len);
    return V(q.x, S.ground(q.x, q.z) + 1.35, q.z);
  };
  const heading = () => {
    const w = way!, s = along(w, P().pos), q = w.c.getTangentAt(Math.min(0.999, s / w.len));
    return Math.atan2(-q.x, -q.z);
  };
  const legs = () => {
    if (!way) return Infinity;
    const left = way.len - along(way, P().pos);
    S.key('KeyW', left > way.stop);
    S.key('AltLeft', way.walk && left > way.stop);
    return left;
  };
  const look = (t: number, dt: number) => {
    const a = hand.update(t, dt);
    P().yaw = a.yaw;
    P().pitch = Math.max(-1.3, Math.min(1.3, a.pitch));
  };
  const pl = (x: number, z: number) => V(x, S.ground(x, z), z);

  // ------------------------------------------------------------ the pointer: a hand moves it (as on the map in shots21.ts)
  const mouse = { x: 640, y: 420, fx: 640, fy: 420, tx: 640, ty: 420, t0: 0, dur: 0.01 };
  const pointTo = (t: number, el: Element | null) => {
    const q = el?.getBoundingClientRect(), r = overlay.getBoundingClientRect();
    const x = q ? q.left + q.width * 0.5 - r.left : 640, y = q ? q.top + q.height * 0.55 - r.top : 360;
    const d = Math.hypot(x - mouse.x, y - mouse.y);
    Object.assign(mouse, { fx: mouse.x, fy: mouse.y, tx: x, ty: y, t0: t, dur: 0.16 + 0.11 * Math.log2(1 + d / 12) });
  };
  const pointer = (t: number) => {
    const u = clamp01((t - mouse.t0) / mouse.dur), s = u * u * u * (10 - 15 * u + 6 * u * u);
    const bow = Math.sin(u * Math.PI) * 0.06, dx = mouse.tx - mouse.fx, dy = mouse.ty - mouse.fy;
    mouse.x = u >= 1 ? mouse.tx : mouse.fx + dx * s * 1.02 - dy * bow;
    mouse.y = u >= 1 ? mouse.ty : mouse.fy + dy * s * 1.02 + dx * bow;
    cursor.style.left = `${mouse.x.toFixed(1)}px`;
    cursor.style.top = `${mouse.y.toFixed(1)}px`;
  };
  const click = (el: Element | null) => {
    if (!el) return say('nothing to click');
    cursor.classList.add('down');
    (el as HTMLElement).click();
    clock.real.setTimeout(() => cursor.classList.remove('down'), 120);
  };

  // ------------------------------------------------------------ how fast everything went
  const speeds = new Speeds();
  let lastShot = '';

  // ------------------------------------------------------------ the set
  const grassOn = (on: boolean) => {
    const gr = loadGraphics();
    if (gr.grass === on) return;
    gr.grass = on;
    saveGraphics(gr);
    g.applyGraphics(gr);
  };
  const doors = (g.s.buildings.doors ?? []) as { pivot: THREE.Object3D; open: boolean; setOpen(open: boolean): void }[];
  let warmed = false;
  const warm = async () => {
    if (warmed) return;
    warmed = true;
    try { localStorage.setItem('zona-howto-seen', '1'); } catch { /* */ }
    (document.querySelector('.howto-ok') as HTMLElement | null)?.click();
    for (const [x, z, lx, lz] of [[FOREST.x - 20, FOREST.z - 12, FOREST.x + 30, FOREST.z + 20], [FIELD.x, FIELD.z, FIELD.x + 60, FIELD.z + 30], [-1890, 34, -1895, 24], [-2045, -350, -1900, 34]]) {
      S.cam = { p: V(x, S.ground(x, z) + 2, z), l: V(lx, S.ground(lx, lz) + 1.5, lz), fov: 50 };
      await run(90);
      await wait(150);
    }
    S.cam = null;
  };
  const reset = () => {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'AltLeft', 'KeyF', 'Mouse0', 'Mouse2']) S.key(k, false);
    if (g.paused) g.unpause();
    document.body.classList.remove('tr-menu');
    if (P().crouched) P().setCrouch(false);
    grassOn(true);
    way = null;
    for (const el of [chip, title, board, line, end, cursor]) el.style.display = 'none';
    fired.clear();
  };

  const shots: Shot[] = [];
  let cur = 0, hourWas = -1;
  interface Extra { hour: number; fadeIn?: number; fadeOut?: number; leadTick?: boolean }
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
          if (!s.chain) reset();
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
        speeds.note('player', t, P().pos);
        if (S.cam) speeds.note('lens', t, S.cam.p);
        hush();
        const a = s.fadeIn ? 1 - ease(t / s.fadeIn) : 0, z = s.fadeOut ? ease((t - (len - s.fadeOut)) / s.fadeOut) : 0;
        black.style.opacity = String(Math.max(a, z));
        if (start + len >= total - 1e-6 && t > len - 0.05 && !fired.has('said')) {
          fired.add('said');
          say(`${s.name}: ${speeds.report()}`);
        }
      },
    } as Shot);
  };

  // ============================================================ 1 · the title, a drone easing back over the forest
  {
    const f = fwdOf(FOREST.yaw);
    const base = V(FOREST.x, S.ground(FOREST.x, FOREST.z) + 42, FOREST.z).addScaledVector(f, -20);
    const at = V(FOREST.x, 0, FOREST.z).addScaledVector(f, 150);
    at.y = S.ground(at.x, at.z) + 8;
    const op = new Operator(DRONE, 1, 50);
    const drone = (t: number) => base.clone().addScaledVector(f, -1.1 * Math.max(0, t)).add(V(0, 0.45 * Math.max(0, t), 0));
    add(3, {
      name: 'title',
      hour: MORNING,
      leadTick: false,
      setup: async () => {
        S.parkMe();
        op.reset(drone(0), at, f.clone().multiplyScalar(-1.1));
      },
      cam: (t) => op.update(t, drone(t), at),
      after: (t) => show(title, t < 2.2 ? 1 : 1 - ease((t - 2.2) / 0.7)),
    });
  }

  // ============================================================ 2 · through the woods on foot, a lens behind him
  {
    const op = new Operator(ON_FOOT, 2, 48);
    /** a line through the trees: from the spot, the heading with the most room either side of it for 30 m (and 7 behind, for the lens) */
    const corridor = () => {
      const trees = (S.world.trees as { x: number; z: number }[]).filter((q) => Math.hypot(q.x - FOREST.x, q.z - FOREST.z) < 45);
      let best = { a: FOREST.yaw, room: -1 };
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2, f = fwdOf(a);
        const ax = FOREST.x - f.x * 7, az = FOREST.z - f.z * 7, bx = FOREST.x + f.x * 30, bz = FOREST.z + f.z * 30;
        if (Math.abs(S.ground(bx, bz) - S.ground(ax, az)) > 5) continue;
        let room = 99;
        for (const q of trees) {
          const ex = bx - ax, ez = bz - az, u = clamp01(((q.x - ax) * ex + (q.z - az) * ez) / (ex * ex + ez * ez));
          room = Math.min(room, Math.hypot(q.x - ax - ex * u, q.z - az - ez * u));
        }
        if (room > best.room) best = { a, room };
      }
      return best;
    };
    let lane = { a: 0, room: 0 };
    add(4.5, {
      name: 'woods',
      hour: MORNING,
      setup: async () => {
        S.kit(['beans', 'thermos', 'bandage', 'mosin', ['ammo_762', 10]]);
        S.hold(null);
        lane = corridor();
        say(`the woods: heading ${lane.a.toFixed(2)}, ${lane.room.toFixed(1)} m clear of any trunk`);
        const f = fwdOf(lane.a), p0 = pl(FOREST.x, FOREST.z);
        S.me(p0.x, p0.z, lane.a, -0.04);
        way = lay([p0, pl(FOREST.x + f.x * 12, FOREST.z + f.z * 12), pl(FOREST.x + f.x * 29, FOREST.z + f.z * 29)]);
        hand.set(lane.a, -0.04);
        hand.look(-0.5, ahead(8), true, 0);
        op.reset(p0.clone().addScaledVector(f, -4.6).addScaledVector(rightOf(lane.a), 0.8).setY(p0.y + 1.6), eye(), f.clone().multiplyScalar(4));
      },
      tick: (t, _S, dt) => {
        legs();
        when(t, 2.2, 'glance', () => hand.look(t, eye().addScaledVector(fwdOf(lane.a + 0.9), 14).setY(eye().y + 1)));
        when(t, 2.9, 'on', () => hand.look(t, ahead(8), true));
        look(t, dt);
      },
      cam: (t) => {
        const p = P().pos as THREE.Vector3, yaw = heading(), f = fwdOf(yaw);
        const want = p.clone().addScaledVector(f, -4.6).addScaledVector(rightOf(yaw), 0.8);
        want.y = Math.max(S.ground(want.x, want.z), p.y) + 1.6;
        return op.update(t, want, p.clone().addScaledVector(f, 4).setY(p.y + 1.25));
      },
      after: (t) => chipSay(t, 0.6, 4.2, 'LIGHTER WOODS', '20% fewer triangles in the forest · 30% in the open'),
    });
  }

  // ============================================================ 3 · the meadow: Esc, Settings, Video, Grass off (his own eyes)
  {
    let paused = -1, planned = false;
    const plan: [number, () => void][] = [];
    add(4.5, {
      name: 'grass',
      hud: true,
      hour: MORNING,
      leadTick: false,
      setup: async () => {
        S.kit(['beans', 'thermos', 'bandage']);
        S.hold(null);
        const p0 = pl(FIELD.x, FIELD.z);
        S.me(p0.x, p0.z, 0.6, -0.06);
        hand.set(0.6, -0.06);
        paused = -1;
        planned = false;
        plan.length = 0;
        Object.assign(mouse, { x: 700, y: 430, fx: 700, fy: 430, tx: 700, ty: 430 });
        await run(30);
      },
      tick: (t, _S, dt) => {
        when(t, 0.3, 'drift', () => hand.look(t, eye().addScaledVector(fwdOf(0.35), 30).setY(eye().y - 1.2)));
        when(t, 0.55, 'esc', () => {
          paused = t;
          document.body.classList.add('tr-menu');
          g.pause();
        });
        look(t, dt);
      },
      after: (t) => {
        if (paused > 0 && !planned) {
          planned = true;
          // the pointer: to Settings, the Video page, Grass Off; then Esc and back to the field
          const at = (k: number, fn: () => void) => plan.push([paused + k, fn]);
          at(0.25, () => pointTo(t, document.querySelector('.start-tabs button[data-tab="gfx"]')));
          at(0.75, () => click(document.querySelector('.start-tabs button[data-tab="gfx"]')));
          at(0.95, () => pointTo(t, document.querySelector('.set-tabs button[data-set="video"]')));
          at(1.45, () => click(document.querySelector('.set-tabs button[data-set="video"]')));
          at(1.65, () => pointTo(t, document.querySelector('button[data-k="grass"][data-v="0"]')));
          at(2.25, () => click(document.querySelector('button[data-k="grass"][data-v="0"]')));
          at(2.6, () => {
            g.unpause();
            document.body.classList.remove('tr-menu');
          });
        }
        while (plan.length && plan[0][0] <= t) {
          const [k, fn] = plan.shift()!;
          void k;
          fn();
          // (a move begun now starts from where the pointer is this frame)
          mouse.t0 = t;
        }
        const menu = paused > 0 && g.paused;
        if (menu) {
          cursor.style.display = '';
          pointer(t);
        } else cursor.style.display = 'none';
        if (paused > 0 && !g.paused) chipSay(t, paused + 2.75, 4.5, 'GRASS: ON OR OFF', 'a new video setting · off for new players');
      },
    });
  }

  // ============================================================ 4 · into a room of loot at a walk, no stop (his own eyes)
  {
    let pick: { door: THREE.Vector3; inside: THREE.Vector3; loot: THREE.Vector3 } | null = null;
    add(3, {
      name: 'loot',
      hud: true,
      hour: MORNING,
      setup: async () => {
        S.kit(['beans', 'thermos', 'bandage']);
        S.hold(null);
        S.me(-1890, 34, Math.PI, 0);
        await run(120);
        // the house in Pokrov with the most loot lying in it, and its nearest door
        const items = [...g.loot.items.values()].map((w: Any) => V(w.loot.x, w.loot.y, w.loot.z));
        let best: { b: Any; n: number; c: THREE.Vector3 } | null = null;
        for (const b of S.world.buildings as Any[]) {
          if (!/^pokrov/.test(b.id)) continue;
          const near = items.filter((q) => Math.hypot(q.x - b.x, q.z - b.z) < 6 && q.y > b.floorY - 0.3 && q.y < b.floorY + 2.6);
          if (near.length && (!best || near.length > best.n)) best = { b, n: near.length, c: near.reduce((s, q) => s.add(q), V(0, 0, 0)).multiplyScalar(1 / near.length) };
        }
        if (!best) throw new Error('no loot lying in Pokrov');
        // its doors open, and the way in found by the physics: from where the loot is, low (under the window sills),
        // the one way out that nothing stops for 12 m is a doorway; outside that, the way in, clear to walk
        for (const d of doors) if (d.pivot.getWorldPosition(new THREE.Vector3()).distanceTo(best.c) < 9 && !d.open) d.setOpen(true);
        await run(30);
        let from = V(0, 0, 0), into: THREE.Vector3 | null = null, out = 0;
        for (const o of [V(best.b.x, 0, best.b.z), best.c.clone()]) for (let k = 0; k < 48 && !into; k++) {
          from = o.clone().setY(best.b.floorY + 0.6);
          const a = (k / 48) * Math.PI * 2, dir = V(Math.cos(a), 0, Math.sin(a));
          const hit = physics.raycast(from, dir, 12);
          if (!hit) {
            const back = physics.raycast(from.clone().addScaledVector(dir, 8), dir.clone().negate(), 8);
            out = back ? 8 - back.toi : 0;
            into = dir.clone().negate();
          }
        }
        if (!into) throw new Error(`no open way into ${best.b.id}`);
        const door = from.clone().addScaledVector(into, -Math.max(2.5, out + 0.4)).setY(best.b.floorY);
        pick = { door, inside: from.clone().addScaledVector(into, -1.2).setY(best.b.floorY), loot: best.c };
        say(`the loot: ${best.b.id} (${best.b.type}), ${best.n} things, the way in from ${door.x.toFixed(1)},${door.z.toFixed(1)}`);
        const p0 = door.clone().addScaledVector(into, -5);
        S.me(p0.x, p0.z, yawTo(p0, door), -0.08, S.ground(p0.x, p0.z));
        way = lay([p0, door, pick.inside], { walk: true, stop: 0.3 });
        hand.set(yawTo(p0, door), -0.08);
        hand.look(-0.5, ahead(4), true, 0);
      },
      tick: (t, _S, dt) => {
        legs();
        if (pick) when(t, 1.5, 'loot', () => hand.look(t, pick!.loot.clone().setY(pick!.loot.y + 0.2), true));
        look(t, dt);
      },
      after: (t) => chipSay(t, 0.3, 2.9, 'NO HITCH WHEN LOOT APPEARS', 'the 0.4 s stalls are gone'),
    });
  }

  // ============================================================ 5 · the numbers, over the meadow from a drone
  {
    const op = new Operator(DRONE, 5, 44);
    const base = V(FIELD.x - 30, S.ground(FIELD.x - 30, FIELD.z - 20) + 9, FIELD.z - 20);
    const at = V(FIELD.x + 40, S.ground(FIELD.x + 40, FIELD.z + 25) + 2, FIELD.z + 25);
    const drone = (t: number) => base.clone().add(V(0.9 * Math.max(0, t), 0.2 * Math.max(0, t), 0.6 * Math.max(0, t)));
    add(4, {
      name: 'board',
      hour: MORNING,
      leadTick: false,
      setup: async () => {
        S.parkMe();
        op.reset(drone(0), at, V(0.9, 0.2, 0.6));
      },
      cam: (t) => op.update(t, drone(t), at),
      after: (t) => {
        show(board, ease(t / 0.35));
        board.querySelectorAll('p').forEach((p, i) => {
          const o = ease((t - 0.35 - i * 0.55) / 0.35);
          (p as HTMLElement).style.opacity = o.toFixed(3);
          (p as HTMLElement).style.transform = `translateY(${((1 - o) * 14).toFixed(1)}px)`;
        });
      },
    });
  }

  // ============================================================ 6 · fair play: a man low on the bank at dusk, watching Pokrov (braced)
  {
    const town = V(-1900, S.ground(-1900, 34) + 4, 34);
    let at = V(0, 0, 0), yaw = 0, f = V(0, 0, -1), lensAt = V(0, 0, 0);
    /** a rise inside the Zona that sees Pokrov's lane over everything between: the highest of a ring of tries round the town */
    const rise = () => {
      let best: THREE.Vector3 | null = null;
      for (const r of [120, 160, 200, 250, 300]) for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, x = -1890 + Math.cos(a) * r, z = 34 + Math.sin(a) * r, h = S.ground(x, z);
        if (!inZona(x, z, 20) || h - S.ground(-1900, 34) < 2 || (best && h <= best.y)) continue;
        if (!S.clearLine(V(x, h + 1.3, z), town)) continue;
        best = V(x, h, z);
      }
      return best;
    };
    const op = new Operator(BRACED, 6, 40);
    const lines: [number, number, string][] = [[0.25, 1.75, 'PASTED CHEAT SCRIPTS NOW BAN WHOEVER RUNS THEM'], [1.75, 3.0, 'IDLE A MINUTE IN THE ZONA? YOUR TAG\'S CLOCK STOPS']];
    add(3, {
      name: 'fair',
      hour: DUSK,
      fadeIn: 0.3,
      setup: async () => {
        at = rise() ?? pl(-2046, -351);
        yaw = yawTo(at, town);
        f = fwdOf(yaw);
        lensAt = at.clone().addScaledVector(f, -3.4).addScaledVector(rightOf(yaw), -1.3).setY(at.y + 1.05);
        S.kit(['beans', 'bandage', 'mosin', ['ammo_762', 10]], { mosin: ['pu_scope'] });
        S.hold('primary');
        S.me(at.x, at.z, yaw, -0.03);
        P().setCrouch(true);
        hand.set(yaw - 0.06, -0.03);
        await run(40);
        say(`fair play: the man at ${at.x.toFixed(0)},${at.z.toFixed(0)}, ${(at.y - town.y + 4).toFixed(1)} m over the lane, ${inZona(at.x, at.z) ? 'inside' : 'OUTSIDE'} the Zona`);
        op.reset(lensAt, town);
      },
      tick: (t, _S, dt) => {
        when(t, 0.4, 'scan', () => hand.look(t, town.clone().add(V(14, -1, -10))));
        when(t, 2.0, 'back', () => hand.look(t, town));
        look(t, dt);
      },
      cam: (t) => op.update(t, lensAt, P().pos.clone().addScaledVector(f, 30).setY(P().pos.y + 1.2)),
      after: (t) => {
        const l = lines.find(([a, b]) => t >= a && t < b);
        if (!l) return void (line.style.display = 'none');
        line.querySelector('b')!.textContent = l[2];
        show(line, Math.min(ease((t - l[0]) / 0.25), ease((l[1] - t) / 0.2)));
      },
    });
    // ============================================================ 7 · and the end card over the last of it
    add(4, {
      name: 'end',
      hour: DUSK,
      chain: true,
      setup: async () => { /* (the same man, the same lens: carried on) */ },
      tick: (t, _S, dt) => look(t + 3, dt),
      cam: (t) => op.update(t + 3, lensAt, P().pos.clone().addScaledVector(f, 30).setY(P().pos.y + 1.2)),
      after: (t) => {
        line.style.display = 'none';
        show(end, ease((t - 0.2) / 0.6));
      },
    });
  }

  const parts: [Kind17, number][] = [['groove', 4], ['tour', 3], ['paid', 2], ['tight', 2], ['end', 2]];
  for (const [kind, bars] of parts) for (let b = 0; b < bars; b++) ROWS.push({ kind, hit: b === 0 ? 0.8 : undefined, build: bars > 1 ? b / (bars - 1) : undefined, lift: b === bars - 1 ? 1 : undefined });
  if (Math.abs(ROWS.length * 2 - total) > 0.01) say(`the score is ${ROWS.length * 2} s and the film ${total} s`);
  say(`${shots.length} shots, ${total.toFixed(1)} s`);
  return shots;
}
