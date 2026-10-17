// The eighteenth film, 15 seconds: "The zone has grown" (2026-10-17, the owner: "a cinematic trailer showing off the
// new POI's caves and geography and map increase etc.. marketing", boarded in marketing/plan-map3-trailers.html).
// The size and the ground, from the air: the title over Kamenka, the map growing from the old square to the whole
// world, low over the green west and Ozerki's lake, skimming the swamp past Mokroye, a helicopter clearing the red
// ridge, over the canyon country, Kalat at evening with the sea beyond, the end card. Every place the world's own;
// the numbers the world's (4.6 km by 1.5 km, the old square 1.5 km). Cut 16's band, its parts in a new order.
//   node scripts/film.mjs --cut 18
import * as THREE from 'three';
import type { CamPose, Shot, Stage } from './director';
import { BAR16, scoreMusic16, type Part16 } from './music16';
import { HELI } from '../sim/heli';
import { WORLD_X0, WORLD_X1, WORLD_Z0, WORLD_Z1, SQUARE_HALF } from '../world/worldgen';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const BARS: Part16[] = [];
let total = 0;
export const seconds18 = () => total;
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic16(ctx, out, BARS);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lerpV = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, k);
/** the world's own measures, said as the film says them */
const KM_WIDE = ((WORLD_X1 - WORLD_X0) / 1000).toFixed(1), KM_OLD = ((2 * SQUARE_HALF) / 1000).toFixed(1), TIMES = Math.round((WORLD_X1 - WORLD_X0) / (2 * SQUARE_HALF));

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
  const title = Gx('x16-card x18-title', `<img src="/brand/zona-mark.svg" alt=""><i>NEW MAP</i><b>THE ZONE HAS <em>GROWN</em></b>`);
  const map = Gx('x18-map', `<div class="sheet"><img src="/changelog/media/map3-whole.jpg" alt=""><div class="old"></div></div><div class="words"><i>THE MAP</i><b>${TIMES}× <em>BIGGER</em></b><span>${KM_OLD} km square → ${KM_WIDE} km wide</span></div>`);
  const cap = Gx('x16-cap', '<i></i><b></b><span></span>');
  const caption = (t: number, from: number, to: number, kick: string, big: string, small: string) => {
    if (t < from || t >= to) return;
    cap.querySelector('i')!.textContent = kick;
    cap.querySelector('b')!.textContent = big;
    cap.querySelector('span')!.textContent = small;
    show(cap, t - from, Math.min(ease((t - from) / 0.3), ease((to - t) / 0.25)));
  };
  const end = Gx('x16-end', `<img src="/brand/zona-mark.svg" alt=""><b>THE ZONE HAS <em>GROWN</em></b><div>zonapvp.fun</div><p>play free in your browser · follow on X <strong>@zonaSOL_</strong></p>`);
  let frame = 0;
  const look = (t: number, len: number, fadeIn = 0, fadeOut = 0, flash = 0) => {
    frame++;
    grain.style.transform = `translate(${((frame * 73) % 97) - 48}px, ${((frame * 41) % 89) - 44}px)`;
    const a = fadeIn ? 1 - ease(t / fadeIn) : 0, z = fadeOut ? ease((t - (len - fadeOut)) / fadeOut) : 0;
    black.style.opacity = String(Math.max(a, z));
    white.style.opacity = String(flash ? Math.max(0, 1 - t / 0.12) * flash : 0);
  };
  const run = async (frames: number) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      clock.advance(1000 / 60);
      if (i % 20 === 19) await wait(8);
    }
    S.mute = false;
  };
  /** a camera flown from `a` to `b`, looking from `la` to `lb`, eased; the lens drifting a little as a hand holds it */
  const fly = (a: THREE.Vector3, b: THREE.Vector3, la: THREE.Vector3, lb: THREE.Vector3, len: number, fov = 52) => (t: number): CamPose => {
    const k = ease(t / len), d = Math.sin(t * 1.7) * 0.05;
    return { p: lerpV(a, b, k).add(V(0, d, 0)), l: lerpV(la, lb, k), fov };
  };
  const at = (x: number, z: number, up = 0) => S.at(x, z, up);
  /** the hour the shot is filmed at, and a breath for the light to settle */
  const hour = async (h: number) => {
    g.hourHeld = h;
    await run(30);
  };

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

  // 1 · the title over Kamenka, the camera pulling back and away west
  add(1, 'open', {
    name: 'title',
    setup: () => hour(0.36),
    cam: fly(at(700, 330, 16), at(760, 300, 60), at(600, 380, 4), at(520, 380, 2), BAR16, 50),
    words: (t) => show(title, t, Math.min(ease(t / 0.25), ease((BAR16 - t) / 0.3))),
  });
  // 2 · the map: the old square lit, then the whole sheet
  add(1, 'pulse', {
    name: 'map',
    cam: () => ({ p: at(-380, -380, 400), l: at(-380, -381, 0), fov: 30 }),
    words: (t) => {
      const k = ease((t - 0.35) / (BAR16 - 0.9));
      show(map, t, 1);
      map.style.setProperty('--k', k.toFixed(3));
    },
  });
  // 3 · low over the green west to Ozerki's lake
  const lake = (g.s.world.water?.lakes ?? []).find((l: Any) => !l.swamp && /ozerki/i.test(l.name ?? '')) ?? (g.s.world.water?.lakes ?? []).find((l: Any) => !l.swamp);
  const lc = lake ? lake.outline.reduce((s: number[], p: number[]) => [s[0] + p[0] / lake.outline.length, s[1] + p[1] / lake.outline.length], [0, 0]) : [-1340, 190];
  add(1, 'drop', {
    name: 'west',
    flash: 0.6,
    setup: () => hour(0.4),
    cam: fly(at(lc[0] + 260, lc[1] + 120, 38), at(lc[0] + 60, lc[1] + 20, 24), at(lc[0], lc[1], 0), at(lc[0] - 160, lc[1] - 30, 0), BAR16, 58),
    words: (t) => caption(t, 0.2, BAR16 - 0.05, 'THE GREEN WEST', 'A RIVER, A LAKE, FIVE TOWNS', 'Ozerki on its lake'),
  });
  // 4 · skimming the swamp past Mokroye
  const swamp = (g.s.world.water?.lakes ?? []).find((l: Any) => l.swamp);
  const sl = swamp?.level ?? 17.4;
  add(1, 'drop', {
    name: 'swamp',
    cam: fly(V(-1700, sl + 5, 640), V(-1800, sl + 3, 600), V(-1860, sl + 1, 580), V(-1900, sl + 1.5, 570), BAR16, 60),
    words: (t) => caption(t, 0.2, BAR16 - 0.05, 'THE SWAMP', 'MOKROYE', 'a hamlet the water took'),
  });
  // 5 · a helicopter climbs the red ridge and clears its crest
  let heli: Any = null;
  const ridgeZ = 150, from = at(-1960, ridgeZ, 30), crest = at(-2258, ridgeZ, 0);
  add(2, 'lift', {
    name: 'ridge',
    setup: async () => {
      let d = 1e9;
      for (const j of (g.garage.jeeps as Map<number, Any>).values()) {
        if (j.kind !== HELI.kind) continue;
        const e = Math.hypot(j.pos.x - from.x, j.pos.z - from.z);
        if (e < d) [heli, d] = [j, e];
      }
      await run(10);
    },
    tick: (t) => {
      if (!heli) return;
      const k = t / (2 * BAR16), p = lerpV(V(from.x, crest.y - 20, from.z), V(crest.x - 30, crest.y + 34, crest.z), ease(k));
      const st = (q: THREE.Quaternion) => [p.x, p.y, p.z, q.x, q.y, q.z, q.w, -22, 8, 0, 1, 0.7];
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, Math.PI / 2, 0.05, 'YXZ'));
      if (heli.mode !== 'follow') { heli.place(st(q)); heli.mode = 'follow'; }
      heli.push(st(q), performance.now(), performance.now());
    },
    cam: () => {
      const p = heli?.pos ?? from;
      return { p: V(p.x + 46, p.y + 6, p.z + 30), l: V(p.x - 20, p.y + 2, p.z), fov: 46 };
    },
    words: (t) => caption(t, 0.2, 2 * BAR16 - 0.05, 'THE RIDGE', 'FLY OVER IT', 'or find the one way through'),
  });
  // 6 · over the canyon country, the pass far below
  add(1, 'lift', {
    name: 'canyon',
    cam: fly(at(-2560, -240, 85), at(-2470, -330, 70), at(-2380, -440, 0), at(-2300, -450, 0), BAR16, 55),
    words: (t) => caption(t, 0.2, BAR16 - 0.05, 'THE PASS', 'ONE WAY THROUGH', 'six caves in its walls'),
  });
  // 7 · the desert at evening: Kalat's citadel, the sea beyond
  add(1, 'drop', {
    name: 'desert',
    setup: () => hour(0.71),
    cam: fly(at(-3080, 150, 26), at(-3150, 175, 18), at(-3248, 112, 8), at(-3300, 140, 6), BAR16, 50),
    words: (t) => caption(t, 0.2, BAR16 - 0.05, 'THE DESERT', 'KALAT', 'a ruined town · the sea beyond'),
  });
  // 8 · the end card
  add(1, 'end', {
    name: 'end',
    cam: fly(at(-3300, 260, 60), at(-3420, 260, 80), at(-3700, 200, 0), at(-3800, 200, 0), BAR16, 50),
    fadeOut: 0.3,
    words: (t) => show(end, t, Math.min(ease(t / 0.3), 1)),
  });
  void WORLD_Z0;
  void WORLD_Z1;
  return shots;
}
