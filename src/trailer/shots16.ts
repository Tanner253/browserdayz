// The sixteenth film: "This week in ZONA", for X (2026-10-15). Asked for as "we need a marketing post for our X some
// video trailer", the board marketing/plan-film-16.html said yes to with "make sure its powerful marketing / We need
// new music". The five things that went live this week, each in the real game: a controller, the pack's emotes and
// the sixteen-slot wheel, the bot check's course (judged by the server's own judge, run in the page: every figure that
// falls was brought down by the rules the live server keeps), the faster loading (the changelog's measured figures).
//
//   card 0-2 · controller 2-7 · dance 7-11 · wheel 11-14 · course from above 14-16 · course 16-18 · catwalk side 18-20 ·
//   loading 20-23 · end 23-26   (bars of BAR16, 1.714 s)
//
// Its score is its own (music16.ts), laid bar by bar from the shots' parts.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import { BAR16, scoreMusic16, type Part16 } from './music16';
import { EMOTE, EMOTE_SHIFT } from '../sim/emotes';
import { makeItem, makeMag } from '../sim/items';
import { CourseJudge, LANES, YARD, dealCourse, floorAt, fromPlan, inSight, inSolid, toPlan, walkAt, type Course } from '../sim/course';
import { TOWN } from '../world/worldgen';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const BARS: Part16[] = [];
let total = 0;
export const seconds16 = () => total;
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic16(ctx, out, BARS);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  const say = (...a: unknown[]) => console.log('[tr] cut 16:', ...a);
  document.body.classList.add('tr-cut16');
  const overlay = document.getElementById('tr-overlay')!;

  // ------------------------------------------------------------ places
  const T = TOWN, ul = Math.hypot(T.street[0], T.street[1]), ux = T.street[0] / ul, uz = T.street[1] / ul;
  /** a place in Kamenka: so far down its street, so far to the right of it, so high over the ground */
  const K = (along: number, right = 0, up = 0) => S.at(T.x + ux * along + uz * right, T.z + uz * along - ux * right, up);
  const yawTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
  /** a lens held in a hand */
  const hand = (pose: CamPose, t: number, amp = 1): CamPose => {
    const n = (f: number, ph: number) => Math.sin(t * f + ph) * 0.6 + Math.sin(t * f * 2.3 + ph * 1.7) * 0.4;
    return { ...pose, p: pose.p.clone().add(V(n(1.9, 0.3) * 0.014 * amp, n(2.3, 1.1) * 0.011 * amp, n(1.7, 2.2) * 0.014 * amp)), l: pose.l.clone().add(V(n(2.9, 4.1) * 0.02 * amp, n(3.3, 5.2) * 0.016 * amp, n(2.6, 0.7) * 0.02 * amp)) };
  };

  // ------------------------------------------------------------ the look: grain, a fade, a white blow, and the boards
  const piece = (cls: string, html = '') => {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    overlay.appendChild(el);
    return el;
  };
  const grain = piece('tr-grain4'), black = piece('tr-black4'), white = piece('tr-flash4');
  piece('tr-vig4');
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
  const card = Gx('x16-card', `<img src="/brand/zona-mark.svg" alt=""><i>ZONA · THIS WEEK</i><b>PLAY IT YOUR <em>WAY</em></b><p>${['CONTROLLER', '28 EMOTES', '16-SLOT WHEEL', 'NEW BOT CHECK', 'FASTER LOADING'].map((c) => `<span>${c}</span>`).join('')}</p>`);
  const cap = Gx('x16-cap', '<i></i><b></b><span></span>');
  const caption = (t: number, from: number, to: number, kick: string, big: string, small: string) => {
    if (t < from || t >= to) return;
    cap.querySelector('i')!.textContent = kick;
    cap.querySelector('b')!.textContent = big;
    cap.querySelector('span')!.textContent = small;
    show(cap, t - from, Math.min(ease((t - from) / 0.3), ease((to - t) / 0.25)));
  };
  // the controller, drawn: its parts lit as they are used (the layout as Settings, Controls has it)
  const pad = Gx('x16-pad', `<svg viewBox="0 0 300 200"><path class="body" d="M78 26 h144 c26 0 42 13 51 40 l22 78 c8 29 -4 46 -25 46 c-17 0 -26 -12 -37 -30 l-12 -20 h-142 l-12 20 c-11 18 -20 30 -37 30 c-21 0 -33 -17 -25 -46 l22 -78 c9 -27 25 -40 51 -40 z"/>
    <rect class="k l2" x="60" y="8" width="40" height="14" rx="5"/><rect class="k r2" x="200" y="8" width="40" height="14" rx="5"/>
    <circle class="k ls" cx="105" cy="122" r="19"/><circle class="k rs" cx="195" cy="122" r="19"/>
    <circle class="k fa" cx="240" cy="56" r="8"/><circle class="k fa" cx="225" cy="71" r="8"/><circle class="k fa" cx="255" cy="71" r="8"/><circle class="k fa" cx="240" cy="86" r="8"/>
    <path class="k dp" d="M52 64 h10 v-10 h10 v10 h10 v10 h-10 v10 h-10 v-10 h-10 z"/></svg><em>L2 aim</em><em>R2 fire</em><em>L stick move</em>`);
  const board = Gx('x16-board', `<i>MEASURED · LOADING</i><b>FASTER IN, <em>FASTER BACK</em></b>
    <div class="row"><span>First visit, ready to play</span><div class="bar"><u class="a"></u><u class="b"></u></div><strong><s>42.2 s</s> 39.4 s</strong></div>
    <div class="row"><span>Coming back</span><div class="bar"><u class="a"></u><u class="b"></u></div><strong><s>22.9 s</s> 18.6 s</strong></div>
    <small>one laptop · a line held to 50 Mbit/s · two loads each · as the changelog has it</small>`);
  const end = Gx('x16-end', `<img src="/brand/zona-mark.svg" alt=""><b>PLAY FREE IN YOUR <em>BROWSER</em></b><div>zonapvp.fun</div><p>follow the build on X · <strong>@zonaSOL_</strong></p>`);
  let frame = 0;
  const look = (t: number, len: number, fadeIn = 0, fadeOut = 0, flash = 0) => {
    frame++;
    grain.style.transform = `translate(${((frame * 73) % 97) - 48}px, ${((frame * 41) % 89) - 44}px)`;
    const a = fadeIn ? 1 - ease(t / fadeIn) : 0, z = fadeOut ? ease((t - (len - fadeOut)) / fadeOut) : 0;
    black.style.opacity = String(Math.max(a, z));
    white.style.opacity = String(flash ? Math.max(0, 1 - t / 0.12) * flash : 0);
  };

  // ------------------------------------------------------------ people, and frames nobody sees
  const A = (i: number) => S.actors[i];
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
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
  const reset = () => {
    for (const a of S.actors) {
      a.dance = a.surrender = a.crouch = a.aim = a.sprint = false;
      (a as Any).more = 0;
      a.foe = null;
      a.hide();
    }
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Mouse0', 'Mouse2', 'AltLeft', 'KeyT']) S.key(k, false);
    g.wheelOn = false;
  };
  /** one of the cast stood in the street, dancing one of the pack's movements (or not) */
  const dancer = (i: number, p: THREE.Vector3, yaw: number, emote: string | null, gear: string[]) => {
    const a: Actor = A(i);
    a.place(p.x, p.z, yaw, null, gear);
    if (emote) {
      a.dance = true;
      (a as Any).more = (EMOTE[emote]?.n ?? 0) << EMOTE_SHIFT;
    }
    (a.rp as Any).snaps.length = 0;
    a.rp.pos.copy(a.pos);
    a.push(-200);
    a.push(0);
  };
  /** the course's rifle in the hands, as the bot check gives it */
  const rifle = () => {
    g.inv.clear();
    g.quick = [null, null, null, null];
    g.inv.add(Object.assign(makeItem('ar15'), { mag: 'mag_ar', loaded: 31, mods: ['red_dot'] }));
    for (let k = 0; k < 2; k++) g.inv.add(makeMag('mag_ar', 30));
    g.inventoryChanged();
    S.hold('primary');
  };

  // ------------------------------------------------------------ the set
  const shots: Shot[] = [];
  let cur = 0;
  const add = (bars: number, part: Part16, s: Omit<Shot, 'start' | 'end'> & { hud?: boolean; fadeIn?: number; fadeOut?: number; flash?: number; words?: (t: number) => void }) => {
    const len = bars * BAR16, start = cur;
    for (let b = 0; b < bars; b++) BARS.push(part);
    cur += len;
    total = cur;
    const setup = s.setup;
    shots.push({
      bars: true,
      ...s,
      start,
      end: start + len,
      setup: async (st) => {
        for (const el of gfx) el.style.display = 'none';
        document.body.classList.toggle('tr-hud-off', !s.hud);
        try {
          g.hourHeld = 0.3;
          reset();
          await setup?.(st);
          if (s.cam) S.cam = s.cam(0, st);
        } catch (e) {
          say(`${s.name}: its setting up failed: ${(e as Error).message}`);
        }
      },
      after: (t, st) => {
        for (const el of gfx) el.style.display = 'none';
        s.after?.(t, st);
        s.words?.(t);
        look(t, len, s.fadeIn, s.fadeOut, s.flash);
        hush();
      },
    });
  };

  // ------------------------------------------------------------ 1. the card, over Kamenka from the air (the first frame is the picture the film is known by)
  const centre = K(0, 0, 4);
  const over = (k: number): CamPose => {
    const a = Math.atan2(-ux, -uz) + 0.55 + k * 0.5, r = 300 - k * 90;
    return { p: V(T.x + Math.sin(a) * r, centre.y + 150 - k * 50, T.z + Math.cos(a) * r), l: centre, fov: 31 };
  };
  add(2, 'open', {
    name: 'card',
    setup: async () => {
      S.parkMe();
      await run(120, () => (S.cam = over(0)));
    },
    cam: (t) => over(t / (2 * BAR16) * 0.5),
    words: (t) => show(card, t + 1),
    fadeOut: 0.15,
  });

  // ------------------------------------------------------------ 2. a controller: first person through the crossroads, the pad's parts lit as they are used
  const cross = S.at(30, 10);
  add(5, 'pulse', {
    name: 'controller',
    hud: true,
    flash: 0.6,
    setup: async () => {
      S.me(cross.x, cross.z, 0.5);
      rifle();
      S.cam = null;
      await run(60);
    },
    cam: () => null,
    tick: (t) => {
      const b = t / BAR16;
      // walking up the street with the stick, then the sights up with the left trigger, and three shots with the right
      S.key('KeyW', b < 2.6);
      S.key('Mouse2', b >= 2.8);
      g.player.yaw = 0.5 + Math.sin(t * 0.55) * 0.18;
      g.player.pitch = -0.04 + Math.sin(t * 0.8) * 0.02;
      for (const at of [3.5, 3.85, 4.2]) if (b >= at && b < at + 0.06) S.key('Mouse0', true);
      if (![3.5, 3.85, 4.2].some((at) => b >= at && b < at + 0.06)) S.key('Mouse0', false);
    },
    words: (t) => {
      const b = t / BAR16;
      show(pad, t, Math.min(ease(t / 0.4), ease((5 * BAR16 - t) / 0.3)));
      pad.classList.toggle('ls-on', b < 2.6);
      pad.classList.toggle('l2-on', b >= 2.8);
      pad.classList.toggle('r2-on', [3.5, 3.85, 4.2].some((at) => b >= at && b < at + 0.18));
      caption(t, 0.35, 5 * BAR16 - 0.1, 'NEW THIS WEEK', 'PLAY WITH A CONTROLLER', 'PlayStation or Xbox · buttons where Call of Duty has them · Settings, Controls');
    },
  });

  // ------------------------------------------------------------ 3. the pack's emotes in Kamenka's street, and a call
  const lens = (t: number): CamPose => {
    const k = ease(t / (4 * BAR16));
    return hand({ p: K(7 + k * 7, -0.6 - k * 0.8, 1.55), l: K(21, 0.2, 1.15), fov: 40 - k * 4 }, t, 0.6);
  };
  add(4, 'drop', {
    name: 'dance',
    flash: 1,
    setup: async () => {
      S.parkMe();
      const face = yawTo(K(21, 0), K(9, 0));
      dancer(0, K(20, -2.4), face + 0.25, 'balloon', ['boonie_hat', 'life_vest']);
      dancer(1, K(21.5, 0.2), face, 'bhangra', ['gasmask', 'sack_pack']);
      dancer(2, K(20.4, 2.6), face - 0.25, 'shuffle', ['life_vest']);
      dancer(3, K(17.5, 4.4), face - 0.6, null, ['boonie_hat']);
      await run(150);
    },
    cam: (t) => lens(t),
    cues: [{ at: 1.3 * BAR16, fn: () => A(3).call('here') }],
    words: (t) => caption(t, 0.3, 4 * BAR16 - 0.1, 'NEW THIS WEEK', '28 EMOTES', 'danced on your own survivor · everybody near sees them'),
  });

  // ------------------------------------------------------------ 4. the wheel: first person, T held, the inner ring and then the outer
  add(3, 'drop', {
    name: 'wheel',
    hud: true,
    setup: async () => {
      const p = K(10, 0);
      S.me(p.x, p.z, yawTo(K(10, 0), K(21, 0)), -0.05);
      g.inv.clear();
      g.inventoryChanged();
      S.hold(null);
      dancer(1, K(21.5, 0.2), yawTo(K(21, 0), K(9, 0)), 'bhangra', ['gasmask', 'sack_pack']);
      S.cam = null;
      await run(40);
      S.key('KeyT', true);
      await run(4);
    },
    cam: () => null,
    tick: (t) => {
      // round the inner ring, then out to the outer, coming to rest on Thanks
      const k = t / (3 * BAR16), at = g.wheelAt as THREE.Vector2;
      if (!at) return;
      const r = k < 0.45 ? 0.42 : 0.42 + 0.38 * ease((k - 0.45) / 0.2), a = -0.3 + k * 2.2;
      at.set(Math.sin(a) * r, -Math.cos(a) * r);
      if (k > 0.97) {
        g.wheelOn = false;
        S.key('KeyT', false);
      }
    },
    words: (t) => caption(t, 0.3, 3 * BAR16 - 0.1, 'HOLD T', '16 SLOTS, TWO RINGS', 'set them in the game · click on the wheel to edit'),
  });

  // ------------------------------------------------------------ 5. the bot check's course: judged as the server judges it
  let course: Course | null = null, judge: CourseJudge | null = null;
  const sent: Any[] = [];
  const netSend = g.net.send.bind(g.net);
  /** the course dealt and stood, the game told what the server would tell it */
  const stand = async () => {
    if (course) return;
    let seed = 20261015;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    course = dealCourse(rnd);
    judge = new CourseJudge(course);
    // (what the game says to the server goes to the server's own judge, here in the page)
    g.net.send = (m: Any) => {
      sent.push(m);
      if (!judge || !course) return netSend(m);
      const bc = g.botCheck, now = bc?.ms ?? 0;
      if (m.t === 'r') judge.seen(m.n, m.p[0], m.p[1], m.p[2], m.p[3], m.p[4], now);
      else if (m.t === 'rs') {
        const hit = judge.shot(m.n, m.o, m.d, now);
        if (hit >= 0) {
          bc?.hit(hit);
          say(`figure ${hit + 1} down at ${(m.n / 1000).toFixed(2)} s (${judge.down.size} of ${course.need})`);
        } else if (judge.why) say(`a shot not counted: ${judge.why}`);
      }
    };
    await g.onRange(course.turn, 1, course.need, course.secs);
    for (let k = 0; k < 300 && !g.botCheck?.begun; k++) await run(1);
    say(`the course stands: ${g.botCheck?.begun ? 'begun' : 'NOT begun'}, turned ${course.turn.toFixed(2)}`);
  };
  /** each frame on the course: the game shown what the server would show it */
  const feed = (all = false) => {
    const bc = g.botCheck;
    if (!bc || !course || !judge) return;
    const ms = bc.ms;
    if (all) {
      bc.sighted(course.walks.map((_: unknown, i: number) => {
        const q = walkAt(course!, i, ms), [x, z] = fromPlan(course!.turn, q.x, q.z);
        return [i, x, q.y, z, 0, 0, q.up ? 1 : 0];
      }));
    } else bc.sighted(judge.reveal(ms));
  };
  const floor = () => g.botCheck?.h?.floor ?? 0;
  /** a figure's chest, in the world, at a moment of the go */
  const chest = (i: number, ms: number) => {
    const q = walkAt(course!, i, ms), [x, z] = fromPlan(course!.turn, q.x, q.z);
    return V(x, floor() + q.y + (q.up ? 1.25 : 0.75), z);
  };
  /** somewhere on the course from which figure `i` is in sight at `ms`, so far off: [x, feet over the floor, z] in the plan's frame */
  const spotFor = (i: number, ms: number, near: number, far: number): [number, number, number] | null => {
    let best: [number, number, number] | null = null, bestD = Infinity;
    for (let x = -YARD.r + 2; x <= YARD.r - 2; x += 1) for (let z = -YARD.r + 2; z <= YARD.r - 2; z += 1) {
      if (Math.hypot(x, z) > YARD.r - 2) continue;
      const y = floorAt(x, 0, z);
      if (inSolid(x, y, z)) continue;
      const q = walkAt(course!, i, ms), d = Math.hypot(q.x - x, q.z - z);
      if (d < near || d > far) continue;
      if (!inSight(course!, i, x, y + YARD.eye, z, ms) || !inSight(course!, i, x, y + YARD.eye, z, ms + 1500)) continue;
      const score = Math.abs(d - (near + far) / 2);
      if (score < bestD) (bestD = score), (best = [x, y, z]);
    }
    return best;
  };
  /** a first-person go at one figure: stood where it can be seen, the sights brought onto it, two shots */
  const goAt = (name: string, figure: number, kick: string, big: string, small: string) => {
    let aimFrom: { yaw: number; pitch: number } | null = null, startMs = 0;
    add(2, 'tense', {
      name,
      hud: true,
      setup: async () => {
        await stand();
        // (a judge of its own for each go: where the last left off is no leap of this one's)
        const was = judge!.down;
        judge = new CourseJudge(course!);
        for (const d of was) judge.down.add(d);
        const ms = (g.botCheck?.ms ?? 0) + 2600;
        const spot = spotFor(figure, ms, 7, 15) ?? spotFor(figure, ms, 4, 19);
        if (!spot) say(`${name}: no place found from which figure ${figure + 1} is in sight`);
        const [x, y, z] = spot ?? [0, 0, 0];
        const [wx, wz] = fromPlan(course!.turn, x, z), aim = chest(figure, ms);
        S.me(wx, wz, yawTo(V(wx, 0, wz), aim) + 0.35, 0, floor() + y);
        rifle();
        S.cam = null;
        await run(30, () => feed());
        aimFrom = { yaw: g.player.yaw, pitch: g.player.pitch };
        startMs = g.botCheck?.ms ?? 0;
        say(`${name}: from ${x}, ${z} (plan) at figure ${figure + 1}, ${Math.hypot(walkAt(course!, figure, ms).x - x, walkAt(course!, figure, ms).z - z).toFixed(1)} m`);
      },
      cam: () => null,
      tick: (t) => {
        feed();
        const ms = g.botCheck?.ms ?? startMs, c = chest(figure, ms), eye = g.s.r.camera.position as THREE.Vector3;
        const yaw = Math.atan2(-(c.x - eye.x), -(c.z - eye.z)), pitch = Math.atan2(c.y - eye.y, Math.hypot(c.x - eye.x, c.z - eye.z));
        // the sights brought onto it over a second, eased, then held on it as it walks
        const k = ease(t / 1.0), f = aimFrom ?? { yaw, pitch };
        const dy = Math.atan2(Math.sin(yaw - f.yaw), Math.cos(yaw - f.yaw));
        g.player.yaw = f.yaw + dy * k;
        g.player.pitch = f.pitch + (pitch - f.pitch) * k;
        S.key('Mouse2', t > 0.5);
        const fire = [1.45, 1.75].some((at) => t >= at && t < at + 0.05);
        S.key('Mouse0', fire);
      },
      words: (t) => caption(t, 0.25, 2 * BAR16 - 0.1, kick, big, small),
    });
  };
  // from above first: the whole yard, every figure shown
  add(2, 'tense', {
    name: 'course from above',
    flash: 0.8,
    setup: async () => {
      await stand();
      g.player.setFly?.(true);
      S.me(0, 0, 0, 0, floor() + 0.05);
      g.inv.clear();
      g.inventoryChanged();
      S.hold(null);
      await run(30, () => feed(true));
    },
    cam: (t) => {
      const k = ease(t / (2 * BAR16)), f = floor();
      const a = 0.4 + k * 0.5, r = 26 - k * 6;
      return { p: V(Math.sin(a) * r, f + 34 - k * 10, Math.cos(a) * r), l: V(0, f, 0), fov: 46 };
    },
    tick: () => feed(true),
    words: (t) => caption(t, 0.25, 2 * BAR16 - 0.1, 'NEW THIS WEEK', 'A HARDER BOT CHECK', 'a 360° course · six figures behind walls · the server judges every shot'),
  });
  goAt('course, a figure', 0, 'BOTS OUT', 'PLAYERS IN', 'sights on it, then fire: the server counts it');
  goAt('course, another', 3, 'BOTS OUT', 'PLAYERS IN', 'walk the yard to find them: a minute for all six');

  // ------------------------------------------------------------ 6. the loading, measured; then the end
  const after = (t: number, len: number) => {
    const k = ease(t / len);
    return { p: K(-40 + k * 12, -60, 95 - k * 10), l: K(10, 0, 0), fov: 34 } as CamPose;
  };
  add(3, 'lift', {
    name: 'loading',
    flash: 0.7,
    setup: async () => {
      const bc = g.botCheck;
      if (bc) {
        bc.end();
        g.botCheck = null;
      }
      g.net.send = netSend;
      g.player.setFly?.(false);
      g.player.god = false;
      S.parkMe();
      await run(120, () => (S.cam = after(0, 1)));
    },
    cam: (t) => after(t, 3 * BAR16),
    words: (t) => {
      const k = ease((t - 0.3) / 1.4);
      board.style.setProperty('--k', k.toFixed(3));
      show(board, t, Math.min(ease(t / 0.35), ease((3 * BAR16 - t) / 0.25)));
    },
  });
  add(3, 'end', {
    name: 'end',
    flash: 1,
    setup: async () => {
      S.parkMe();
      await run(60, () => (S.cam = { p: V(0, 520, 380), l: V(0, 0, -60), fov: 42 }));
    },
    cam: (t) => ({ p: V(Math.sin(t * 0.05) * 30, 520 - t * 6, 380 - t * 8), l: V(0, 0, -60), fov: 42 }),
    words: (t) => show(end, t, ease(t / 0.4)),
    fadeOut: 0.6,
  });

  say(`${shots.length} shots, ${total.toFixed(2)} s, ${BARS.length} bars; the course has ${LANES.length} figures`);
  void toPlan;
  return shots;
}
