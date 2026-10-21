// The twenty-fifth film, about 29 s: the battle royale (2026-10-21, the owner: "i need a trailer for battle royale mode";
// boarded in marketing/plan-film-25.html). A real match, played on the film's own arena server (launch entry
// zona-arena-film: arena/server.ts with tools/br-film/vclock.mjs, whose clock moves on only as this page's does, frame
// by frame, and whose dice are seeded, so a take repeats). The page joins through the game's own way in; the six others
// are sockets this page moves itself (brbots.ts), as people move (human.ts): they wander the waiting area, vote, ride
// the plane, jump, fall and open their canopies, take guns off the ground, fight, knock and are knocked, and at the end
// leave. Nothing on the screen is anything but the game's own; the lobby's and the match's head counts are kept out of
// the picture (no player counts in a film). Restart zona-arena-film before every take (a fresh lobby).
//   node scripts/film.mjs --cut 25 --url "http://localhost:5173/tools/trailer.html?cut=25&wager=br&size=2&kills=1&loadout=FIND&arena=http://localhost:8095"
import * as THREE from 'three';
import type { Shot, Stage } from './director';
import { scoreMusic17, type Kind17, type Row17 } from './music17';
import { BrBot, F_GROUND, F_SPRINT, F_AIM } from './brbots';
import { DRONE, Hand, ON_FOOT, BRACED, Operator, Speeds, wrap, yawTo } from './human';
import { FLIGHT, MAPS, kindOf } from '../../arena/br/rules';
import { openDoor } from '../ui/door';
import { physics } from '../core/physics';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const ROWS: Row17[] = [];
let total = 0;
export const seconds25 = () => total;
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic17(ctx, out, ROWS);

const Q = new URLSearchParams(location.search);
const ARENA = Q.get('arena') ?? 'http://localhost:8095';
const VCLOCK = 'http://127.0.0.1:8096';
const MAP = Number(Q.get('kills') ?? 1);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const fwdOf = (yaw: number) => V(-Math.sin(yaw), 0, -Math.cos(yaw));
const rightOf = (yaw: number) => V(Math.cos(yaw), 0, -Math.sin(yaw));
/** the towns of the middle map a landing is picked from (src/sim/desert.ts and the green west's places) */
const TOWNS: [string, number, number][] = [['Ozerki', -1250, -200], ['Lipki', -1150, 300], ['Mokroye', -1855, 585], ['Zastava', -1965, -452], ['Pokrov', -1850, -30]];

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  const say = (s: string) => console.log(`[tr] ${s}`);
  document.body.classList.add('tr-cut21', 'tr-br25');
  const m = MAPS[MAP];

  // ------------------------------------------------------------ the server's clock, moved on with this page's
  let owed = 0;
  const advance = clock.advance.bind(clock);
  clock.advance = (ms: number) => {
    owed += ms;
    advance(ms);
  };
  const flush = async () => {
    if (owed <= 0) return;
    const ms = owed;
    owed = 0;
    try { await fetch(`${VCLOCK}/advance?ms=${ms.toFixed(3)}`); } catch (e) { say(`the server's clock did not answer: ${(e as Error).message}`); }
    // (what the server sent in that time comes in over the sockets: a moment for it to)
    await wait(3);
  };
  S.onFrame = async () => {
    await flush();
  };

  // ------------------------------------------------------------ the overlay
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
  const title = piece('x21-title', '<img src="/brand/zona-mark.svg" alt=""><b>BATTLE <em>ROYALE</em></b><i>new in ZONA</i>');
  const chip = piece('x21-chip', '<b></b><i></i>');
  const end = piece('x21-end', '<img src="/brand/zona-mark.svg" alt=""><b>BATTLE <em>ROYALE</em></b><p><span>SOLO · DUO · SQUAD</span><span>ONE CIRCLE OF GAS</span><span>FREE IN YOUR BROWSER</span></p><u>zonapvp.fun/battleroyale</u>');
  const cursor = piece('x21-cursor', '<svg viewBox="0 0 16 24" width="16" height="24"><path d="M1 1 L1 19 L5.6 14.8 L8.6 21.8 L11.4 20.6 L8.5 13.8 L14.6 13.8 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>');
  const show = (el: HTMLElement, o: number) => {
    el.style.display = o > 0.002 ? '' : 'none';
    el.style.opacity = o.toFixed(3);
  };
  const chipSay = (t: number, from: number, to: number, big: string, small: string) => {
    const o = t < from || t > to ? 0 : Math.min(ease((t - from) / 0.3), ease((to - t) / 0.3));
    if (o <= 0) return void (chip.style.display = 'none');
    chip.querySelector('b')!.textContent = big;
    chip.querySelector('i')!.textContent = small;
    show(chip, o);
  };
  const hush = () => document.querySelectorAll('.hud-notes > *').forEach((e) => e.remove());

  // ------------------------------------------------------------ the hero: his legs and his hand
  const P = () => g.player as Any;
  const eye = () => {
    const p = P().pos as THREE.Vector3;
    return V(p.x, p.y + 1.62, p.z);
  };
  const hand = new Hand(25, eye);
  let goal: THREE.Vector3 | null = null, goalStop = 0.6, walk = false, sprint = false;
  const legs = () => {
    if (!goal) {
      for (const k of ['KeyW', 'ShiftLeft', 'AltLeft']) S.key(k, false);
      return Infinity;
    }
    const p = P().pos as THREE.Vector3, left = Math.hypot(goal.x - p.x, goal.z - p.z);
    S.key('KeyW', left > goalStop);
    S.key('ShiftLeft', sprint && left > 5);
    S.key('AltLeft', walk && left > goalStop);
    return left;
  };
  const look = (t: number, dt: number) => {
    const a = hand.update(t, dt);
    P().yaw = a.yaw;
    P().pitch = Math.max(-1.45, Math.min(1.3, a.pitch));
  };
  const br = () => g.br as Any;
  const remoteOf = (b: BrBot) => g.remotes.get(b.id) as Any;
  /** where a bot's body is drawn (its RemotePlayer, a little behind what it says), chest high */
  const chestOf = (b: BrBot) => {
    const r = remoteOf(b);
    const p = r ? (r.pos as THREE.Vector3) : V(b.pose[0], b.pose[1], b.pose[2]);
    return V(p.x, p.y + 1.25, p.z);
  };

  // ------------------------------------------------------------ the others: six sockets, moved as people move
  const url = `${ARENA.replace(/^http/, 'ws')}/battleroyale?size=2&kills=${MAP}&loadout=FIND`;
  const NAMES = ['Mira', 'Volkov', 'Kestrel', 'Oksana', 'Bear', 'Dmitri'];
  const bots: BrBot[] = [];
  const [MIRA, VOLKOV, KESTREL] = [0, 1, 2];
  interface Plan { goal: THREE.Vector3 | null; speed: number; air: 'plane' | 'fall' | 'chute' | null; vel: THREE.Vector3; land: THREE.Vector3; jumpAt: number; yaw: number; gunAsked: number; shootAt: number; left: boolean; wantGun: boolean; claim: number; looked: number }
  const plans: Plan[] = [];
  const serverNow = () => br()?.now ?? Date.now();
  const planeAt = (t: number) => {
    const p = br()?.plane;
    if (!p) return null;
    const dx = p.b[0] - p.a[0], dz = p.b[1] - p.a[1], L = Math.hypot(dx, dz), s = Math.max(0, ((t - p.t0) / 1000) * p.speed);
    return V(p.a[0] + (dx / L) * s, p.y, p.a[1] + (dz / L) * s);
  };
  const phase = () => br()?.phase as string | undefined;
  /** the guns lying on the ground, as the hero's game knows them */
  const guns = () => [...(br()?.ground?.values() ?? [])].filter((q: Any) => q.item && kindOf(q.item.id) === 'gun') as Any[];
  const drive = (dt: number) => {
    const ph = phase();
    bots.forEach((b, i) => {
      const pl = plans[i];
      if (!b.open || pl.left || b.id < 0) return;
      // in the plane: where the plane is, until its own moment to jump
      if (ph === 'plane' && pl.air === 'plane') {
        const at = planeAt(serverNow());
        if (!at) return;
        b.move(at.x, at.y - 7, at.z, 0, 0, 0);
        if (serverNow() >= pl.jumpAt) {
          b.br({ k: 'jump' });
          b.br({ k: 'air', s: 'fall' });
          pl.air = 'fall';
          const p = br().plane, L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
          pl.vel.set(((p.b[0] - p.a[0]) / L) * p.speed * 0.5, 0, ((p.b[1] - p.a[1]) / L) * p.speed * 0.5);
        }
        return;
      }
      if (pl.air === 'fall' || pl.air === 'chute') {
        // falling toward its own landing: steered as a player steers, the canopy at the height the game opens it
        const p = V(b.pose[0], b.pose[1], b.pose[2]), to = pl.land.clone().sub(p).setY(0), chute = pl.air === 'chute';
        const across = chute ? FLIGHT.chuteGlide : FLIGHT.steer, want = to.length() > 1 ? to.normalize().multiplyScalar(Math.min(across, to.length())) : V(0, 0, 0);
        const k = Math.min(1, dt * (chute ? 2 : 1.2));
        pl.vel.x += (want.x - pl.vel.x) * k;
        pl.vel.z += (want.z - pl.vel.z) * k;
        pl.vel.y += ((chute ? -FLIGHT.chuteFall : -FLIGHT.fall) - pl.vel.y) * Math.min(1, dt * 2.5);
        p.addScaledVector(pl.vel, dt);
        const floor = S.ground(p.x, p.z), up = p.y - floor;
        pl.yaw = Math.abs(pl.vel.x) + Math.abs(pl.vel.z) > 0.5 ? Math.atan2(-pl.vel.x, -pl.vel.z) : pl.yaw;
        if (!chute && up < FLIGHT.open) {
          pl.air = 'chute';
          b.br({ k: 'air', s: 'chute' });
        }
        if (up < 1.4) {
          pl.air = null;
          p.y = floor + 0.05;
          b.br({ k: 'air', s: null });
        }
        b.move(p.x, p.y, p.z, pl.yaw, 0, pl.air ? 0 : F_GROUND);
        return;
      }
      // on its feet: toward its goal at its pace, turning as a person does, a gun taken when one is in reach
      const p = V(b.pose[0], b.pose[1], b.pose[2]);
      if (b.put) {
        p.set(b.put[0], b.put[1], b.put[2]);
        b.put = null;
      }
      let flags = F_GROUND;
      if (pl.goal) {
        const to = pl.goal.clone().sub(p).setY(0), d = to.length();
        if (d > 0.4) {
          const v = Math.min(pl.speed, d * 1.5);
          p.addScaledVector(to.normalize(), v * dt);
          pl.yaw += wrap(Math.atan2(-to.x, -to.z) - pl.yaw) * Math.min(1, dt * 5);
          if (v > 5) flags |= F_SPRINT;
        }
      }
      p.y = S.ground(p.x, p.z);
      if (b.w && kindOf(b.w) === 'gun' && serverNow() < pl.shootAt + 900) flags |= F_AIM;
      b.move(p.x, p.y, p.z, pl.yaw, 0, flags);
      // a gun in its slots is the one in its hands
      const gun = (b.me?.slots ?? []).find((s: Any) => s && kindOf(s.id) === 'gun');
      b.w = gun ? gun.id : (b.me?.slots?.[0]?.id ?? null);
      if (gun) pl.wantGun = false;
      if (pl.wantGun && !gun && serverNow() - pl.looked > 500) {
        // (the nearest gun lying within 150 m that no other of them is going for, looked for again twice a second)
        pl.looked = serverNow();
        const taken = new Set(plans.filter((o) => o !== pl).map((o) => o.claim));
        const q = guns().filter((x) => !taken.has(x.id) && Math.hypot(x.x - p.x, x.z - p.z) < 150).sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
        pl.claim = q ? q.id : -1;
        if (q) pl.goal = V(q.x, 0, q.z);
      }
      if (!gun && serverNow() - pl.gunAsked > 700) {
        const near = guns().filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 3);
        if (near.length) {
          pl.gunAsked = serverNow();
          b.br({ k: 'take', id: near[0].id, slot: 1 });
        }
      }
    });
  };
  /** a bot's goal set to the nearest gun lying within `r` of a point (it takes it on arrival) */
  const toGun = (i: number, at: THREE.Vector3, r = 60, speed = 4) => {
    const q = guns().filter((x) => Math.hypot(x.x - at.x, x.z - at.z) < r).sort((a, b2) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b2.x - at.x, b2.z - at.z))[0];
    plans[i].goal = q ? V(q.x, 0, q.z) : at.clone();
    plans[i].speed = speed;
    return q;
  };
  const fireAt = (i: number, to: THREE.Vector3, miss: number) => {
    const b = bots[i], pl = plans[i];
    if (!b.w || kindOf(b.w) !== 'gun') return;
    const o = V(b.pose[0], b.pose[1] + 1.5, b.pose[2]), d = to.clone().sub(o);
    d.x += (S.rnd() - 0.5) * miss;
    d.y += (S.rnd() - 0.5) * miss * 0.5;
    d.z += (S.rnd() - 0.5) * miss;
    pl.yaw = Math.atan2(-d.x, -d.z);
    pl.shootAt = serverNow();
    b.fire([o.x, o.y, o.z], [d.x, d.y, d.z]);
  };

  /** frames nobody sees: the page and the server moved on together, the others driven, the hero's own `each` */
  const run = async (frames: number, each?: (k: number) => void, step = 1 / 60) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      each?.(i);
      drive(step);
      for (const a of S.actors) a.push();
      clock.advance(1000 * step);
      await flush();
    }
    S.mute = false;
  };
  const until = async (ok: () => boolean, most: number, each?: (k: number) => void, step = 1 / 60) => {
    for (let i = 0; i < most && !ok(); i++) await run(1, each ? () => each(i) : undefined, step);
    return ok();
  };

  // ------------------------------------------------------------ the shots
  const speeds = new Speeds();
  const fired = new Set<string>();
  const when = (t: number, at: number, key: string, fn: () => void) => {
    if (t >= at && !fired.has(key)) {
      fired.add(key);
      fn();
    }
  };
  const shots: Shot[] = [];
  let cur = 0;
  interface Extra { fadeIn?: number; fadeOut?: number }
  const add = (len: number, s: Omit<Shot, 'start' | 'end'> & Extra) => {
    const start = cur, setup = s.setup, after = s.after, tick = s.tick;
    cur += len;
    total = cur;
    let lt = -1;
    shots.push({
      bars: false,
      chain: shots.length > 0,
      ...s,
      start,
      end: start + len,
      setup: async (st) => {
        say(`${s.name}: setting up at the match's ${phase() ?? 'start'}`);
        try {
          for (const el of [chip, title, end, cursor]) el.style.display = 'none';
          await setup?.(st);
        } catch (e) {
          say(`${s.name}: its setting up failed: ${(e as Error).message}`);
        }
        lt = -1;
      },
      lead: (t, st) => {
        const dt = lt < -0.9 ? 1 / 60 : t - lt;
        lt = t;
        drive(dt);
        tick?.(t, st, dt);
      },
      tick: (t, st, dt) => {
        lt = t;
        drive(dt);
        tick?.(t, st, dt);
      },
      after: (t, st) => {
        after?.(t, st);
        speeds.note('hero', t, P().pos);
        if (S.cam) speeds.note('lens', t, S.cam.p);
        hush();
        const a = s.fadeIn ? 1 - ease(t / s.fadeIn) : 0, z = s.fadeOut ? ease((t - (len - s.fadeOut)) / s.fadeOut) : 0;
        black.style.opacity = String(Math.max(a, z));
        if (t > len - 0.05 && !fired.has(`said ${s.name}`)) {
          fired.add(`said ${s.name}`);
          say(`${s.name}: ${speeds.report()} · phase ${phase()}`);
        }
      },
    } as Shot);
  };

  // the pointer, moved by a hand (as in shots21 and shots24)
  const mouse = { x: 640, y: 420, fx: 640, fy: 420, tx: 640, ty: 420, t0: 0, dur: 0.01 };
  const pointTo = (t: number, el: Element | null) => {
    const q = el?.getBoundingClientRect(), r = overlay.getBoundingClientRect();
    const x = q ? q.left + q.width * 0.5 - r.left : 640, y = q ? q.top + q.height * 0.45 - r.top : 360;
    const d = Math.hypot(x - mouse.x, y - mouse.y);
    Object.assign(mouse, { fx: mouse.x, fy: mouse.y, tx: x, ty: y, t0: t, dur: 0.16 + 0.11 * Math.log2(1 + d / 12) });
  };
  const pointer = (t: number) => {
    const u = clamp01((t - mouse.t0) / mouse.dur), s2 = u * u * u * (10 - 15 * u + 6 * u * u);
    const bow = Math.sin(u * Math.PI) * 0.06, dx = mouse.tx - mouse.fx, dy = mouse.ty - mouse.fy;
    mouse.x = u >= 1 ? mouse.tx : mouse.fx + dx * s2 * 1.02 - dy * bow;
    mouse.y = u >= 1 ? mouse.ty : mouse.fy + dy * s2 * 1.02 + dx * bow;
    cursor.style.left = `${mouse.x.toFixed(1)}px`;
    cursor.style.top = `${mouse.y.toFixed(1)}px`;
  };

  // ============================================================ 1 · the main menu, three modes (0-2.5 s)
  let door: Promise<unknown> | null = null;
  add(2.5, {
    name: 'door',
    hud: true,
    setup: async () => {
      try { localStorage.setItem('zona-howto-seen', '1'); } catch { /* */ }
      (document.querySelector('.start-name') as HTMLInputElement | null)?.setAttribute('value', 'Sable');
      const nm = document.querySelector('.start-name') as HTMLInputElement | null;
      if (nm) nm.value = 'Sable';
      door = openDoor();
      void door;
      Object.assign(mouse, { x: 520, y: 520, fx: 520, fy: 520, tx: 520, ty: 520 });
      await run(30);
    },
    after: (t) => {
      chipSay(t, 0.15, 2.4, 'BATTLE ROYALE', 'new in ZONA');
      when(t, 0.9, 'to br', () => pointTo(t, document.querySelector('.door-card.br')));
      when(t, 1.6, 'hover', () => document.querySelector('.door-card.br')?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true })));
      cursor.style.display = '';
      pointer(t);
    },
  });

  // ============================================================ 2 · the lobby: the waiting area, the vote (2.5-5.5 s)
  add(3, {
    name: 'lobby',
    hud: true,
    setup: async () => {
      // (the door's Battle Royale taken: the menu goes, and the game's own way in)
      (document.querySelector('.door-card.br') as HTMLElement | null)?.click();
      await run(20);
      document.getElementById('door')?.remove();
      void g.join();
      await until(() => !!br()?.me && g.started, 600);
      say(`joined: phase ${phase()} at ${P().pos.x.toFixed(0)},${P().pos.z.toFixed(0)}`);
      for (const n of NAMES) {
        bots.push(new BrBot(url, n, 25));
        plans.push({ goal: null, speed: 1.7, air: null, vel: V(0, 0, 0), land: V(0, 0, 0), jumpAt: 0, yaw: 0, gunAsked: 0, shootAt: -1e9, left: false, wantGun: false, claim: -1, looked: 0 });
        await run(8);
      }
      await until(() => bots.every((b) => b.id >= 0 && b.lobby), 300);
      // wandering the waiting area, some to the guns lying in it
      const w = m.wait;
      bots.forEach((_, i) => {
        const a = (i / bots.length) * Math.PI * 2;
        if (i % 2 === 0) toGun(i, V(w.x + Math.cos(a) * 12, 0, w.z + Math.sin(a) * 12), 30, 1.9);
        else plans[i].goal = V(w.x + Math.cos(a) * w.r * 0.6, 0, w.z + Math.sin(a) * w.r * 0.6);
        plans[i].speed = 1.6 + (i % 3) * 0.6;
      });
      await run(240);
      // the hero a few steps in, looking about him
      const p = P().pos as THREE.Vector3;
      hand.set(P().yaw, -0.05);
      goal = V(w.x, 0, w.z);
      walk = true;
      sprint = false;
      say(`the lobby: ${bots.filter((b) => b.w && kindOf(b.w) === 'gun').length} of the others with guns; the hero at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
    },
    tick: (t, _S, dt) => {
      legs();
      const near = bots.map((b) => chestOf(b)).sort((a, b2) => a.distanceTo(eye()) - b2.distanceTo(eye()));
      when(t, 0.1, 'look a', () => near[0] && hand.look(t, near[0]));
      when(t, 1.1, 'look b', () => near[1] && hand.look(t, near[1]));
      when(t, 1.2, 'bots vote', () => bots.slice(1).forEach((b) => b.br({ k: 'vote', yes: true })));
      when(t, 2.1, 'vote', () => S.tap('KeyV'));
      look(t, dt);
    },
    after: (t) => chipSay(t, 0.3, 2.9, 'THE LOBBY', 'fight while you wait · vote to start'),
  });

  // ============================================================ 3 · the plane over the map, the others jumping (5.5-9 s)
  const op3 = new Operator(DRONE, 3, 46);
  let town: [string, number, number] = TOWNS[0], landAt = V(0, 0, 0);
  add(3.5, {
    name: 'plane',
    setup: async () => {
      goal = null;
      legs();
      await until(() => phase() === 'plane' && !!br()?.plane, 60 * 20);
      // the town nearest the plane's line, where everybody of this film lands
      const p = br().plane, ax = p.a[0], az = p.a[1], dx = p.b[0] - ax, dz = p.b[1] - az, L = Math.hypot(dx, dz);
      const off = (x: number, z: number) => Math.abs(((x - ax) * dz - (z - az) * dx) / L);
      town = TOWNS.filter(([, x, z]) => x > m.x0 + 60 && x < m.x1 - 60 && z > m.z0 + 60 && z < m.z1 - 60).sort((a, b2) => off(a[1], a[2]) - off(b2[1], b2[2]))[0];
      // (on dry ground, by a gun: Ozerki's middle is its lake)
      // (and in the open: a gun under a roof is a landing on the roof)
      const open = (q: Any) => !physics.raycast({ x: q.x, y: q.y + 0.6, z: q.z }, { x: 0, y: 1, z: 0 }, 25);
      const dry = guns().filter((q) => !P().water(q.x, q.z) && open(q) && Math.hypot(q.x - town[1], q.z - town[2]) < 260).sort((a, c) => Math.hypot(a.x - town[1], a.z - town[2]) - Math.hypot(c.x - town[1], c.z - town[2]));
      landAt = dry[0] ? V(dry[0].x + 3.5, 0, dry[0].z + 1.5) : V(town[1], 0, town[2]);
      const along = ((landAt.x - ax) * dx + (landAt.z - az) * dz) / L, atT = p.t0 + (along / p.speed) * 1000;
      say(`the plane: ${town[0]}'s ${dry[0]?.item.id ?? 'middle'} at ${landAt.x.toFixed(0)},${landAt.z.toFixed(0)} is ${off(landAt.x, landAt.z).toFixed(0)} m off its line, over it ${((atT - serverNow()) / 1000).toFixed(1)} s from now; ${dry.length} dry guns about`);
      bots.forEach((_, i) => {
        plans[i].air = 'plane';
        plans[i].jumpAt = atT - 2500 + i * 650;
        const a = i * 1.7;
        plans[i].land = V(landAt.x + Math.cos(a) * (18 + i * 9), 0, landAt.z + Math.sin(a) * (18 + i * 9));
        if (P().water(plans[i].land.x, plans[i].land.z)) plans[i].land = landAt.clone().add(V(Math.cos(a) * 8, 0, Math.sin(a) * 8));
      });
      // seen from a drone ahead of the plane, a little off its line, as it comes over the town
      await until(() => serverNow() > atT - 5200, 60 * 60, undefined, 1 / 30);
      const now = planeAt(serverNow())!, f = V(dx / L, 0, dz / L), side = V(-f.z, 0, f.x);
      const lensAt = now.clone().addScaledVector(f, 120).addScaledVector(side, 70).setY(now.y - 40);
      op3.reset(lensAt, now);
      (op3 as Any).at = lensAt;
    },
    cam: (t) => {
      const at = planeAt(serverNow());
      const look = at ? at.clone().setY(at.y - 12) : V(town[1], 300, town[2]);
      return op3.update(t, (op3 as Any).at, look);
    },
    after: (t) => chipSay(t, 0.4, 3.2, 'THE PLANE', 'jump where you like'),
  });

  // ============================================================ 4 · his jump, the fall, the canopy (9-12.5 s)
  add(3.5, {
    name: 'fall',
    hud: true,
    setup: async () => {
      // out when the landing is under him, then down head first toward it (W), unseen till the last of the dive
      const target = landAt.clone();
      await until(() => {
        const at = planeAt(serverNow());
        return !!at && Math.hypot(at.x - target.x, at.z - target.z) < 140;
      }, 60 * 40, undefined, 1 / 30);
      S.tap('Space');
      await run(10);
      hand.set(P().yaw, -0.9);
      await until(() => P().pos.y - S.ground(P().pos.x, P().pos.z) < 160 || !br()?.air, 60 * 30, () => {
        const p = P().pos as THREE.Vector3;
        hand.set(yawTo(p, target), -1.0);
        P().yaw = hand.yaw;
        P().pitch = hand.pitch;
        S.key('KeyW', Math.hypot(target.x - p.x, target.z - p.z) > 20);
      }, 1 / 30);
      say(`the fall: ${(P().pos.y - S.ground(P().pos.x, P().pos.z)).toFixed(0)} m over the ground, ${Math.hypot(target.x - P().pos.x, target.z - P().pos.z).toFixed(0)} m from the landing`);
    },
    tick: (t, _S, dt) => {
      const p = P().pos as THREE.Vector3, target = landAt;
      S.key('KeyW', br()?.air === 'fall' && Math.hypot(target.x - p.x, target.z - p.z) > 15);
      when(t, 0.0, 'down', () => hand.look(t, target.clone().setY(S.ground(target.x, target.z)), true, 0));
      when(t, 1.9, 'chute', () => br()?.air === 'fall' && S.tap('Space'));
      when(t, 2.3, 'up', () => hand.look(t, eye().addScaledVector(fwdOf(P().yaw), 40).setY(eye().y - 25)));
      look(t, dt);
    },
    after: (t) => chipSay(t, 2.4, 3.4, 'THE CANOPY', ''),
  });

  // ============================================================ 5 · down, and a gun off the ground (12.5-16 s)
  let gun: Any = null;
  add(3.5, {
    name: 'loot',
    hud: true,
    setup: async () => {
      S.key('KeyW', false);
      await until(() => !br()?.air, 60 * 40, () => {
        const p = P().pos as THREE.Vector3, target = landAt;
        P().yaw = yawTo(p, target);
        S.key('KeyW', Math.hypot(target.x - p.x, target.z - p.z) > 8);
      }, 1 / 30);
      S.key('KeyW', false);
      await run(40);
      say(`down at ${P().pos.x.toFixed(1)},${P().pos.y.toFixed(1)},${P().pos.z.toFixed(1)}; air ${br()?.air} phase ${phase()} fly ${P().flying ?? P().fly} paused ${g.paused}`);
      // the nearest gun lying round him, and a walk to it
      const p = P().pos as THREE.Vector3;
      gun = guns().sort((a, b2) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b2.x - p.x, b2.z - p.z))[0] ?? null;
      if (!gun) throw new Error('no gun on the ground near him');
      say(`the loot: a ${gun.item.id} ${Math.hypot(gun.x - p.x, gun.z - p.z).toFixed(1)} m off`);
      // (walked most of the way unseen, a few metres left for the shot)
      goal = V(gun.x, 0, gun.z);
      goalStop = 5.5;
      walk = false;
      await until(() => legs() <= 5.6, 60 * 30, () => {
        P().yaw = yawTo(P().pos, goal!);
      });
      say(`walked to the gun: ${legs().toFixed(1)} m left, at ${P().pos.x.toFixed(1)},${P().pos.z.toFixed(1)}, W ${g.input.held('KeyW')}`);
      goalStop = 1.0;
      walk = true;
      hand.set(yawTo(P().pos, goal), -0.35);
      hand.look(-0.2, () => V(gun.x, gun.y + 0.1, gun.z), true, 0);
      // the others land round about, and go for guns of their own
      plans.forEach((pl) => {
        pl.wantGun = true;
        pl.speed = 4;
      });
    },
    tick: (t, _S, dt) => {
      const left = legs(), has = () => (br()?.me?.slots ?? []).some((q: Any) => q && kindOf(q.id) === 'gun');
      if (left <= 1.3) {
        when(t, 1.0, 'take', () => S.tap('KeyF'));
        when(t, 1.9, 'take again', () => !has() && S.tap('KeyF'));
      }
      look(t, dt);
    },
    after: (t) => chipSay(t, 0.4, 3.3, 'LAND · LOOT', 'six slots · rarity by colour'),
  });

  // ============================================================ 6 · the circle closing, its gas (16-19 s)
  const op6 = new Operator(DRONE, 6, 50);
  const BEAR = 4;
  /** the circle as it is at a moment of the server's clock */
  const circleAt = (t: number) => {
    const z = br()?.zone;
    if (!z) return null;
    const k = clamp01((t - z.t0) / (z.t1 - z.t0));
    return { x: z.a.x + (z.b.x - z.a.x) * k, z: z.a.z + (z.b.z - z.a.z) * k, r: z.a.r + (z.b.r - z.a.r) * k };
  };
  add(3, {
    name: 'circle',
    setup: async () => {
      goal = null;
      legs();
      // on until the second circle is closing in: him and the others kept inside it, Mira by him, Bear brought to
      // just inside the wall where the drone will look
      const shotAt = () => {
        const z = br()?.zone;
        return z && z.phase >= 1 ? z.t0 + (z.t1 - z.t0) * 0.3 : Infinity;
      };
      let lane: { e: THREE.Vector3; out: THREE.Vector3 } | null = null;
      await until(() => serverNow() >= shotAt(), 60 * 400, () => {
        const z = br()?.zone;
        if (!z) return;
        const c = V(z.b.x, 0, z.b.z), p = P().pos as THREE.Vector3;
        if (Math.hypot(c.x - p.x, c.z - p.z) > z.b.r * 0.35) {
          P().yaw = yawTo(p, c);
          S.key('KeyW', true);
        } else S.key('KeyW', false);
        plans.forEach((pl, i) => {
          if (pl.wantGun || pl.left) return;
          if (i === MIRA) pl.goal = p.clone().addScaledVector(rightOf(P().yaw), 5);
          else if (i !== BEAR || !lane) pl.goal = c.clone().add(V(Math.cos(i * 1.9) * z.b.r * 0.3, 0, Math.sin(i * 1.9) * z.b.r * 0.3));
          pl.speed = 4.5;
        });
        // twenty seconds before the shot: where the wall will be, and Bear sent to just inside it
        const at = shotAt();
        if (!lane && at < Infinity && serverNow() > at - 32000) {
          const c2 = circleAt(at)!, out = V(p.x - c2.x, 0, p.z - c2.z).normalize();
          lane = { e: V(c2.x, 0, c2.z).addScaledVector(out, c2.r), out };
          plans[BEAR].wantGun = false;
          plans[BEAR].goal = lane.e.clone().addScaledVector(out, -7);
          plans[BEAR].speed = 11;
        }
      }, 1 / 30);
      S.key('KeyW', false);
      const c = circleAt(serverNow())!, p = P().pos as THREE.Vector3;
      const ln = lane as { e: THREE.Vector3; out: THREE.Vector3 } | null, out = ln?.out ?? V(p.x - c.x, 0, p.z - c.z).normalize(), side = V(-out.z, 0, out.x);
      const edge = V(c.x, 0, c.z).addScaledVector(out, c.r);
      const lensAt = edge.clone().addScaledVector(out, -30).addScaledVector(side, -12);
      lensAt.y = S.ground(lensAt.x, lensAt.z) + 26;
      (op6 as Any).along = edge.clone().addScaledVector(side, 70).addScaledVector(out, 6);
      (op6 as Any).at = lensAt;
      (op6 as Any).edge = edge;
      op6.reset(lensAt, edge.clone().setY(S.ground(edge.x, edge.z) + 4));
      // Bear runs in from the wall, under the lens
      plans[BEAR].goal = V(c.x, 0, c.z);
      plans[BEAR].speed = 5.2;
      const bear = V(bots[BEAR].pose[0], 0, bots[BEAR].pose[2]);
      say(`the circle: phase ${br().zone.phase}, ${c.r.toFixed(0)} m across its middle; Bear ${Math.hypot(bear.x - edge.x, bear.z - edge.z).toFixed(0)} m from the wall, ${bots[BEAR].w ?? 'empty-handed'}; him ${Math.hypot(edge.x - p.x, edge.z - p.z).toFixed(0)} m in`);
    },
    cam: (t) => {
      const e = (op6 as Any).along as THREE.Vector3, b = chestOf(bots[BEAR]);
      const look = e.clone().setY(S.ground(e.x, e.z) + 5).lerp(b, 0.25);
      return op6.update(t, ((op6 as Any).at as THREE.Vector3).clone().add(V(0, 0.5 * t, 0)), look);
    },
    after: (t) => chipSay(t, 0.4, 2.8, 'ONE CIRCLE OF GAS', 'it closes in · stay inside'),
  });

  // ============================================================ 7 · a fight: Volkov round a corner, knocked, finished (19-22.5 s)
  add(3.5, {
    name: 'fight',
    hud: true,
    setup: async () => {
      // the two of the other team brought to him (no faster than a run), Mira at his side; Kestrel's rounds on Mira
      plans.forEach((pl) => (pl.wantGun = false));
      // (his gun in his hands: the key of its slot)
      const k = (br()?.me?.slots ?? []).findIndex((q: Any) => q && kindOf(q.id) === 'gun');
      if (k >= 0) {
        S.tap(`Digit${k + 1}`);
        await run(40);
      }
      const p = P().pos as THREE.Vector3, f = fwdOf(P().yaw);
      plans[MIRA].goal = p.clone().addScaledVector(rightOf(P().yaw), 4).addScaledVector(f, -2);
      plans[VOLKOV].goal = p.clone().addScaledVector(f, 26).addScaledVector(rightOf(P().yaw), 6);
      plans[KESTREL].goal = p.clone().addScaledVector(f, 30).addScaledVector(rightOf(P().yaw), -10);
      for (const i of [MIRA, VOLKOV, KESTREL]) plans[i].speed = 6;
      await run(60 * 8, undefined, 1 / 30);
      for (const i of [VOLKOV, KESTREL]) plans[i].speed = 2.2;
      // Kestrel puts Mira down (the server judges every round)
      await until(() => !!bots[MIRA].me?.knocked, 60 * 12, (k) => { if (k % 10 === 0) fireAt(KESTREL, chestOf(bots[MIRA]), 0.08); }, 1 / 30);
      say(`the fight: Mira ${bots[MIRA].me?.knocked ? 'knocked' : 'still up'}; Volkov ${bots[VOLKOV].w ?? 'empty-handed'}, Kestrel ${bots[KESTREL].w ?? 'empty-handed'}; the hero's slots ${(br()?.me?.slots ?? []).map((q: Any) => q?.id ?? '-').join(' ')}, in hand ${g.inv?.inHand?.id ?? g.weapons?.held?.id ?? '?'}`);
      hand.set(P().yaw, -0.02);
    },
    tick: (t, _S, dt) => {
      const vol = chestOf(bots[VOLKOV]);
      when(t, 0.2, 'see', () => hand.look(t, () => chestOf(bots[VOLKOV]), true));
      // Volkov shoots back, wide; the hero puts rounds on him, a tap at a time, as a player does
      if (Math.floor(t * 3) !== Math.floor((t - dt) * 3)) fireAt(VOLKOV, eye().add(V(0, 4.5, 0)).addScaledVector(rightOf(P().yaw), 3.5), 0.3);
      S.key('Mouse0', t > 0.75 && (Math.floor(t * 7) % 2 === 0) && !!bots[VOLKOV].me && !bots[VOLKOV].over);
      plans[VOLKOV].goal = vol.clone().add(V(Math.sin(t * 1.3) * 2, 0, 0));
      look(t, dt);
    },
    after: (t) => chipSay(t, 0.3, 3.2, 'KNOCK THEM DOWN', 'then finish them'),
  });

  // ============================================================ 8 · Mira got up: F held, 10 s (22.5-25.5 s, two halves)
  add(1.6, {
    name: 'revive',
    hud: true,
    setup: async () => {
      S.key('Mouse0', false);
      // Kestrel's team out of the way (he leaves the match), then to Mira where she lies
      bots[KESTREL].br({ k: 'leave' });
      plans[KESTREL].left = true;
      const mira = () => V(bots[MIRA].pose[0], 0, bots[MIRA].pose[2]);
      goal = mira();
      goalStop = 1.6;
      walk = false;
      await until(() => legs() <= 1.8, 60 * 12, () => {
        goal = mira();
        P().yaw = yawTo(P().pos, goal);
      });
      S.key('KeyW', false);
      goal = null;
      hand.set(yawTo(P().pos, mira()), -0.6);
      await run(10);
    },
    tick: (t, _S, dt) => {
      when(t, 0.15, 'F', () => S.key('KeyF', true));
      look(t, dt);
    },
    after: (t) => chipSay(t, 0.25, 1.6, 'GET THEM UP', 'hold F · 10 s'),
  });
  add(1.4, {
    name: 'revived',
    hud: true,
    setup: async () => {
      // (the 10 s held through: the start and the end of it shown)
      await run(60 * 7);
    },
    tick: (t, _S, dt) => {
      when(t, 0.9, 'up', () => S.key('KeyF', false));
      look(t, dt);
    },
  });

  // ============================================================ 9 · the last team standing: #1 (25.5-29.5 s)
  add(4, {
    name: 'win',
    hud: true,
    setup: async () => {
      // the rest out of the match (each leaves it), and the end as the game shows it
      bots.forEach((b, i) => {
        if (i !== MIRA && !plans[i].left) {
          b.br({ k: 'leave' });
          plans[i].left = true;
        }
      });
      await until(() => !!br()?.ended || phase() === 'over', 60 * 10);
      await run(30);
      say(`the end: ${phase()} ended ${br()?.ended}`);
    },
    after: (t) => show(end, ease((t - 2.1) / 0.6)),
  });

  const parts: [Kind17, number][] = [['card', 1], ['sneak', 2], ['groove', 4], ['tour', 2], ['tight', 3], ['paid', 1], ['end', 2]];
  for (const [kind, bars] of parts) for (let b = 0; b < bars; b++) ROWS.push({ kind, hit: b === 0 ? 0.8 : undefined, build: bars > 1 ? b / (bars - 1) : undefined, lift: b === bars - 1 ? 1 : undefined });
  if (Math.abs(ROWS.length * 2 - total) > 1.01) say(`the score is ${ROWS.length * 2} s and the film ${total} s`);
  say(`${shots.length} shots, ${total.toFixed(1)} s on map ${m.name}`);
  void BRACED;
  void ON_FOOT;
  return shots;
}
