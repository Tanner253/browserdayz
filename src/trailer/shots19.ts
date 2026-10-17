// The nineteenth film, 15 seconds: "One way through" (2026-10-17, boarded in marketing/plan-map3-trailers.html). The
// pass and its caves on foot: the title over its east mouth, a survivor past Zastava's slabs, the floor between
// walls a hundred metres high, a shelf with the canyon below, a cave mouth, inside by torchlight, the new towns in three
// looks, the end card. Cut 16's band, its parts in a new order.   node scripts/film.mjs --cut 19
import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import { BAR16, scoreMusic16, type Part16 } from './music16';
import { CAVES, passWorld } from '../sim/pass';
import { passPlan } from '../world/worldgen';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const BARS: Part16[] = [];
let total = 0;
export const seconds19 = () => total;
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic16(ctx, out, BARS);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const P = (s: number, t: number, y: number) => V(...passWorld(passPlan, s, t, y));

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  document.body.classList.add('tr-cut16', 'tr-hud-off');
  const overlay = document.getElementById('tr-overlay')!;
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
  const title = Gx('x16-card x18-title', `<img src="/brand/zona-mark.svg" alt=""><i>THE PASS</i><b>ONE WAY <em>THROUGH</em></b>`);
  const cap = Gx('x16-cap', '<i></i><b></b><span></span>');
  const caption = (t: number, from: number, to: number, kick: string, big: string, small: string) => {
    if (t < from || t >= to) return;
    cap.querySelector('i')!.textContent = kick;
    cap.querySelector('b')!.textContent = big;
    cap.querySelector('span')!.textContent = small;
    show(cap, t - from, Math.min(ease((t - from) / 0.3), ease((to - t) / 0.25)));
  };
  const end = Gx('x16-end', `<img src="/brand/zona-mark.svg" alt=""><b>FIVE NEW TOWNS · ONE PASS · <em>SIX CAVES</em></b><div>zonapvp.fun</div><p>play free in your browser · follow on X <strong>@zonaSOL_</strong></p>`);
  let frame = 0;
  const look = (t: number, len: number, fadeIn = 0, fadeOut = 0, flash = 0) => {
    frame++;
    grain.style.transform = `translate(${((frame * 73) % 97) - 48}px, ${((frame * 41) % 89) - 44}px)`;
    const a = fadeIn ? 1 - ease(t / fadeIn) : 0, z = fadeOut ? ease((t - (len - fadeOut)) / fadeOut) : 0;
    black.style.opacity = String(Math.max(a, z));
    white.style.opacity = String(flash ? Math.max(0, 1 - t / 0.12) * flash : 0);
  };
  const A = (): Actor => S.actors[0];
  const run = async (frames: number) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      for (const a of S.actors) a.push();
      clock.advance(1000 / 60);
      if (i % 20 === 19) await wait(8);
    }
    S.mute = false;
  };
  const hour = async (h: number) => {
    g.hourHeld = h;
    await run(30);
  };
  /** the survivor put at `p` facing `to`, walking (`walk`) along the way the shot moves them */
  const stand = (p: THREE.Vector3, to: THREE.Vector3) => {
    const a = A(), yaw = Math.atan2(-(to.x - p.x), -(to.z - p.z));
    a.place(p.x, p.z, yaw, null, ['boonie_hat', 'sack_pack']);
    (a.rp as Any).snaps.length = 0;
    a.rp.pos.copy(a.pos);
    a.push(-200);
    a.push(0);
  };
  /** each frame of a shot: the survivor moved from `a` to `b` over its length, on the ground */
  const walk = (a: THREE.Vector3, b: THREE.Vector3, len: number) => (t: number) => {
    const k = clamp01(t / len), x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
    const actor = A() as Any;
    actor.pos.set(x, S.ground(x, z), z);
    actor.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    actor.moving = true;
  };
  /** the torch inside the cave: a lamp carried with the camera */
  const torch = new THREE.SpotLight(0xfff1d6, 0, 26, 0.42, 0.55, 1.2);
  torch.visible = false;
  g.s.r.scene.add(torch, torch.target);

  const shots: Shot[] = [];
  let cur = 0;
  const add = (bars: number, part: Part16, s: Omit<Shot, 'start' | 'end'> & { fadeIn?: number; fadeOut?: number; flash?: number; words?: (t: number) => void }) => {
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
        for (const a of S.actors) a.hide();
        torch.visible = false;
        torch.intensity = 0;
        S.parkMe();
        await setup?.(st);
      },
      after: (t) => {
        for (const el of gfx) el.style.display = 'none';
        s.words?.(t);
        look(t, len, s.fadeIn ?? 0, s.fadeOut ?? 0, s.flash ?? 0);
      },
    } as Shot);
  };
  const fly = (a: THREE.Vector3, b: THREE.Vector3, la: THREE.Vector3, lb: THREE.Vector3, len: number, fov = 50) => (t: number): CamPose => {
    const k = ease(t / len), d = Math.sin(t * 1.9) * 0.03;
    return { p: a.clone().lerp(b, k).add(V(0, d, 0)), l: la.clone().lerp(lb, k), fov };
  };

  // 1 · the title over the pass's east mouth
  add(1, 'open', {
    name: 'title',
    setup: () => hour(0.42),
    cam: fly(P(-30, 0, 40), P(10, 0, 30), P(120, 0, 10), P(160, 0, 8), BAR16, 50),
    words: (t) => show(title, t, Math.min(ease(t / 0.25), ease((BAR16 - t) / 0.3))),
  });
  // 2 · Zastava: a survivor past the slabs and the booth
  const z0 = S.at(-1935, -470), z1 = S.at(-1985, -462);
  add(1, 'pulse', {
    name: 'zastava',
    setup: async () => { stand(z0, z1); await run(20); },
    tick: walk(z0, z1, BAR16),
    cam: fly(S.at(-1950, -448, 2.2), S.at(-1962, -452, 2), S.at(-1960, -470, 1.2), S.at(-1985, -466, 1.4), BAR16, 46),
    words: (t) => caption(t, 0.2, BAR16 - 0.05, 'ZASTAVA', 'THE POST AT THE MOUTH', 'whoever goes west comes through here'),
  });
  // 3 · the pass floor: the survivor small between walls a hundred metres high
  const f0 = P(200, -4, 0), f1 = P(225, -4, 0);
  add(1, 'drop', {
    name: 'floor',
    flash: 0.5,
    setup: async () => { stand(f0, f1); await run(20); },
    tick: walk(f0, f1, BAR16),
    cam: fly(P(247, 3, 1.3), P(241, 3, 1.4), P(195, -2, 16), P(205, -2, 12), BAR16, 62),
    words: (t) => caption(t, 0.2, BAR16 - 0.05, 'THE PASS', 'WALLS 100 M HIGH', 'shelves up both sides'),
  });
  // 4 · on a shelf, the canyon falling away below
  add(1, 'drop', {
    name: 'shelf',
    cam: fly(P(170, -17, 21), P(195, -17, 21), P(260, -4, 4), P(285, 0, 2), BAR16, 56),
    words: (t) => caption(t, 0.2, BAR16 - 0.05, 'THE SHELVES', 'GO HIGH', 'ramps between them, caves behind them'),
  });
  // 5 · a cave mouth: the survivor goes in
  const c = CAVES[0], n0 = c.nodes[0], n1 = c.nodes[Math.min(1, c.nodes.length - 1)];
  const m0 = P(n0.s, n0.t * 0.55, 0), m1 = P(n0.s, n0.t, 0);
  add(1, 'tense', {
    name: 'mouth',
    setup: async () => { stand(m0, m1); await run(20); },
    tick: walk(m0, m1, BAR16 * 0.9),
    cam: fly(P(n0.s - 9, n0.t * 0.2, n0.y + 2.2), P(n0.s - 6, n0.t * 0.3, n0.y + 2), P(n0.s, n0.t, n0.y + 1.6), P(n0.s, n0.t * 1.05, n0.y + 1.5), BAR16, 50),
    words: (t) => caption(t, 0.2, BAR16 - 0.05, 'SIX CAVES', 'IN THE WALLS', 'the best of the pass is in them'),
  });
  // 6 · inside by torchlight
  const n2 = c.nodes[Math.min(2, c.nodes.length - 1)], ahead = P(n2.s, n2.t, n2.y + 0.8);
  const i0 = P(n1.s, n1.t, n1.y + 1.6), i1 = i0.clone().lerp(P(n2.s, n2.t, n2.y + 1.6), 0.25);
  add(1, 'tense', {
    name: 'inside',
    setup: async () => { torch.visible = true; await run(10); },
    tick: (t) => {
      const k = ease(t / BAR16), p = i0.clone().lerp(i1, k);
      torch.intensity = 60 * Math.min(1, t / 0.15);
      torch.position.copy(p).add(V(0.25, -0.15, 0));
      torch.target.position.copy(ahead);
    },
    cam: fly(i0, i1, ahead, ahead, BAR16, 58),
    words: (t) => caption(t, 0.2, BAR16 - 0.05, 'BRING A LIGHT', 'DARK INSIDE', 'tier 4 in the caves · tier 5 on the floor'),
  });
  // 7 · the new towns in three looks
  const towns: [string, number, number, number, number][] = [['POKROV', -1800, -40, -1840, -68], ['LIPKI', -1150, 300, -1180, 315], ['ZAVOD', -2690, -360, -2725, -392]];
  add(2, 'lift', {
    name: 'towns',
    setup: () => hour(0.44),
    cam: (t) => {
      const i = Math.min(2, Math.floor((t / (2 * BAR16)) * 3)), [, x, z, lx, lz] = towns[i], k = ((t / (2 * BAR16)) * 3) % 1;
      return { p: S.at(x + k * 4, z, 3 + k), l: S.at(lx, lz, 5), fov: 50 };
    },
    words: (t) => {
      const i = Math.min(2, Math.floor((t / (2 * BAR16)) * 3));
      caption(t, 0.05, 2 * BAR16 - 0.05, 'NEW TOWNS', towns[i][0], 'five towns and a post in the west');
    },
  });
  // 8 · the end card
  add(1, 'end', {
    name: 'end',
    cam: fly(P(380, 0, 30), P(420, 0, 60), P(520, 0, 0), P(560, 0, 0), BAR16, 50),
    fadeOut: 0.3,
    words: (t) => show(end, t, Math.min(ease(t / 0.3), 1)),
  });
  return shots;
}
