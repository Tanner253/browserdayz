// The loading screen's blood and the part of its motion that answers the player. The owner, 2026-10-20: "can we
// animate the loading screen, the icon background pulsing (yellow) and the white mask puffing green smoke. the zona
// letters with blood splatter on them or something? interactive". The sign's breath and the mask's gas are CSS loops
// (src/ui/style.css, run by the compositor, so they keep moving while the start stalls the page); here the blood is
// laid on the letters and runs off them, the mark leans toward the pointer, and a click or tap sends a burst of gas
// and a fresh splash. Nothing here runs once the screen has gone.

import { loadingPumpkins } from './loading-pumpkins';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** where along a letter (0..1 of its ink) a foot stands that blood can run down and drip off */
const FEET: Record<string, number[]> = { Z: [0.3, 0.55, 0.78], O: [0.5], N: [0.11, 0.89], A: [0.11, 0.89], R: [0.12, 0.86], E: [0.22, 0.6] };

/** a splash: on letter `i`, at `u` across its ink and `v` down from its top to the baseline, `r` em across; one with
 * a `run` runs down to the foot at `u` and hangs a drip that long (em: under 0.2, short of the line below) */
interface Splash { i: number; u: number; v: number; r: number; seed: number; run?: number; drip?: HTMLElement }

/** what the screen opens with, a splash at a time: a drip off the Z, a spray on the O, a run down the N, a drop off the A */
const FIRST: Splash[] = [
  { i: 0, u: 0.3, v: 0.84, r: 0.12, seed: 11, run: 0.19 },
  { i: 1, u: 0.74, v: 0.24, r: 0.1, seed: 23 },
  { i: 2, u: 0.11, v: 0.32, r: 0.085, seed: 37, run: 0.15 },
  { i: 3, u: 0.89, v: 0.8, r: 0.07, seed: 41, run: 0.09 },
];
/** at most this many splashes and drips at once: past them the oldest fades */
const MOST = 12, MOST_DRIPS = 6;

const BLOOD = '#760b0a', CORE = '#4c0505';

interface Fit {
  /** each letter's ink, left to right and its top, in the title's box (px) */
  letters: { x0: number; x1: number; top: number; ch: string }[];
  base: number;
  em: number;
  w: number;
  h: number;
  /** the title's box within the blood layer's */
  dx: number;
  dy: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = (v: number) => v.toFixed(1);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const nearest = (list: number[], u: number) => list.reduce((b, x) => (Math.abs(x - u) < Math.abs(b - u) ? x : b), list[0]);

/** a closed curve through the points */
function smooth(p: [number, number][]) {
  const n = p.length;
  let d = `M${f1(p[0][0])} ${f1(p[0][1])}`;
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n], e = p[(i + 2) % n];
    d += `C${f1(b[0] + (c[0] - a[0]) / 6)} ${f1(b[1] + (c[1] - a[1]) / 6)} ${f1(c[0] - (e[0] - b[0]) / 6)} ${f1(c[1] - (e[1] - b[1]) / 6)} ${f1(c[0])} ${f1(c[1])}`;
  }
  return `${d}Z`;
}

/** where a splash lands, px in the title's box */
function spot(s: Splash, fit: Fit) {
  const L = fit.letters[s.i % fit.letters.length];
  const feet = FEET[L.ch];
  const u = s.run && feet ? nearest(feet, s.u) : s.u;
  return { x: L.x0 + u * (L.x1 - L.x0), y: L.top + s.v * (fit.base - L.top), r: s.r * fit.em };
}

/** a splash drawn: a body thrown out the way it was hit, a darker heart, droplets flung on, and its run to the foot */
function draw(s: Splash, fit: Fit) {
  const R = rng(s.seed), { x, y, r } = spot(s, fit), em = fit.em;
  const dir = R() * Math.PI * 2;
  const body: [number, number][] = [], core: [number, number][] = [];
  for (let k = 0, n = 18; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (R() - 0.5) * 0.25;
    let d = r * (0.78 + R() * 0.3) * (1 + 0.35 * Math.max(0, Math.cos(a - dir)));
    if (R() < 0.28) d *= 1.3 + R() * 0.5;
    body.push([x + Math.cos(a) * d, y + Math.sin(a) * d]);
    core.push([x + Math.cos(a) * d * 0.5, y + Math.sin(a) * d * 0.5]);
  }
  let out = `<path d="${smooth(body)}" fill="${BLOOD}"/><path d="${smooth(core)}" fill="${CORE}" opacity="0.7"/>`;
  for (let k = 0, m = 7 + Math.floor(R() * 8); k < m; k++) {
    const a = R() < 0.3 ? R() * Math.PI * 2 : dir + (R() - 0.5) * 2.2;
    const d = r * (1.25 + R() * 2.2);
    const sz = Math.max(r * 0.03, r * (0.05 + R() * 0.16) * (1.6 - d / (r * 3.5)));
    const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
    out += `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(sz * (1.2 + R() * 0.9))}" ry="${f1(sz)}" transform="rotate(${Math.round((a * 180) / Math.PI)} ${f1(cx)} ${f1(cy)})" fill="${BLOOD}"/>`;
  }
  if (s.run) {
    // down the face, gathering at the foot before it drips
    const w0 = 0.026 * em, w1 = 0.05 * em, b = fit.base + 2;
    const wob = (R() - 0.5) * 0.02 * em;
    out += `<path d="M${f1(x - w0 / 2)} ${f1(y)}Q${f1(x - w0 / 2 + wob)} ${f1((y + b) / 2)} ${f1(x - w1 / 2)} ${f1(b)}L${f1(x + w1 / 2)} ${f1(b)}Q${f1(x + w0 / 2 + wob)} ${f1((y + b) / 2)} ${f1(x + w0 / 2)} ${f1(y)}Z" fill="${BLOOD}"/>`;
    out += `<ellipse cx="${f1(x)}" cy="${f1(fit.base - 0.03 * em)}" rx="${f1(0.055 * em)}" ry="${f1(0.04 * em)}" fill="${BLOOD}"/>`;
  }
  return out;
}

function picture(list: Splash[], fit: Fit) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(fit.w)}" height="${Math.ceil(fit.h)}"><g opacity="0.95">${list.map((s) => draw(s, fit)).join('')}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function loadingFx(root: HTMLElement) {
  const mark = root.querySelector('.load-mark') as HTMLElement | null;
  const title = root.querySelector('.load-title') as HTMLElement | null;
  const blood = root.querySelector('.load-blood') as HTMLElement | null;
  if (!mark || !title || !blood) return;
  const gas = mark.querySelector('.lm-gas') as HTMLElement;
  const flash = mark.querySelector('.lm-flash') as HTMLElement;
  const horns = [...mark.querySelectorAll<HTMLElement>('.lm-h0, .lm-h1, .lm-h2')];
  const depth: [HTMLElement, number][] = [['.lm-front', 7], ['.lm-sign', 2.5], ['.lm-glow', -4]].map(([q, d]) => [mark.querySelector(q as string) as HTMLElement, d as number]);
  const shock = mark.querySelector('.lm-shock') as HTMLElement;
  const anchor = gas.appendChild(document.createElement('s'));
  const pumpkins = loadingPumpkins(title.parentElement as HTMLElement);
  const shown: Splash[] = [];
  /** splashes still fading in on a layer of their own, left out of the title's picture till they have */
  const landing = new Set<Splash>();
  let fit: Fit | null = null;
  let mid = { x: 0, y: 0 };

  const measure = (): Fit | null => {
    const text = title.firstChild;
    if (!(text instanceof Text) || !text.length) return null;
    const cs = getComputedStyle(title), em = parseFloat(cs.fontSize);
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const tr = title.getBoundingClientRect(), br = blood.getBoundingClientRect(), range = document.createRange();
    const letters: Fit['letters'] = [];
    let base = 0;
    for (let i = 0; i < text.length; i++) {
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const r = range.getBoundingClientRect(), ch = text.data[i], m = ctx.measureText(ch);
      const fa = m.fontBoundingBoxAscent || em * 0.8, fd = m.fontBoundingBoxDescent || em * 0.2;
      base = r.top - tr.top + (r.height * fa) / (fa + fd);
      if (ch.trim()) letters.push({ x0: r.left - tr.left - m.actualBoundingBoxLeft, x1: r.left - tr.left + m.actualBoundingBoxRight, top: base - m.actualBoundingBoxAscent, ch: ch.toUpperCase() });
    }
    if (!letters.length) return null;
    const mr = mark.getBoundingClientRect();
    mid = { x: mr.left + mr.width / 2, y: mr.top + mr.height / 2 };
    return { letters, base, em, w: tr.width, h: tr.height, dx: tr.left - br.left, dy: tr.top - br.top };
  };

  /** the blood settled on the letters, as the title's own background cut to its letters */
  const paint = () => {
    if (!fit) return;
    const on = shown.filter((s) => !landing.has(s));
    if (!on.length) {
      title.classList.remove('bled');
      title.style.backgroundImage = '';
      return;
    }
    title.classList.add('bled');
    title.style.backgroundImage = `${picture(on, fit)}, linear-gradient(var(--ink), var(--ink))`;
    title.style.backgroundSize = `${Math.ceil(fit.w)}px ${Math.ceil(fit.h)}px, 100% 100%`;
  };

  /** a copy of the letters carrying some blood of its own, to fade in or out over the title */
  const layer = (list: Splash[]) => {
    const lb = blood.appendChild(document.createElement('div'));
    lb.className = 'lb';
    lb.textContent = title.textContent;
    if (fit) {
      lb.style.backgroundImage = picture(list, fit);
      lb.style.backgroundSize = `${Math.ceil(fit.w)}px ${Math.ceil(fit.h)}px`;
    }
    return lb;
  };

  const placeDrip = (s: Splash) => {
    if (!fit || !s.drip || !s.run) return;
    const { x } = spot(s, fit), w = 0.05 * fit.em;
    s.drip.style.left = `${f1(fit.dx + x - w / 2)}px`;
    s.drip.style.top = `${f1(fit.dy + fit.base - 2)}px`;
    s.drip.style.width = `${f1(w)}px`;
  };

  const hangDrip = (s: Splash, delay: number) => {
    if (!fit || !s.run) return;
    const L = s.run * fit.em, w = 0.05 * fit.em, D = w * 1.75;
    const d = (s.drip = blood.appendChild(document.createElement('div')));
    d.className = 'ld';
    d.innerHTML = `<i class="ld-run" style="height:${f1(L)}px"></i><i class="ld-drop" style="width:${f1(D)}px;height:${f1(D * 1.15)}px;left:${f1((w - D) / 2)}px;top:${f1(L - D * 0.6)}px"></i>`;
    placeDrip(s);
    if (REDUCED) return;
    const t = { duration: 2200 + L * 110, delay, easing: 'cubic-bezier(.3,.55,.35,1)', fill: 'backwards' as const };
    (d.firstChild as HTMLElement).animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], t);
    (d.lastChild as HTMLElement).animate([{ transform: `translateY(${f1(-L)}px) scale(.55)` }, { transform: 'none' }], t);
  };

  /** the oldest splash (and its drip) fades off */
  const forget = (s: Splash) => {
    shown.splice(shown.indexOf(s), 1);
    paint();
    const going = [s.drip, REDUCED ? null : layer([s])].filter((e): e is HTMLElement => !!e);
    s.drip = undefined;
    for (const e of going) {
      if (REDUCED) e.remove();
      else e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1400, easing: 'ease-in' }).onfinish = () => e.remove();
    }
  };

  const splash = (s: Splash) => {
    if (!fit) return;
    if (s.run && shown.filter((o) => o.drip).length >= MOST_DRIPS) s.run = undefined;
    while (shown.length >= MOST) forget(shown[0]);
    shown.push(s);
    if (s.run) hangDrip(s, 500);
    if (REDUCED) return paint();
    // it lands on a copy of the letters, then settles into the title's own
    landing.add(s);
    const lb = layer([s]);
    lb.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 110, easing: 'ease-out' }).onfinish = () => {
      landing.delete(s);
      paint();
      lb.remove();
    };
  };

  const relayout = () => {
    fit = measure();
    if (!fit) return;
    paint();
    for (const s of shown) placeDrip(s);
    pumpkins?.place(fit.dx + fit.letters[0].x0, fit.dx + fit.letters[fit.letters.length - 1].x1, fit.dy + fit.base);
  };

  /** a splash where the pointer is, if it is on the letters; anywhere on them if not */
  const splashAt = (px: number, py: number) => {
    if (!fit) return;
    const tr = title.getBoundingClientRect(), R = Math.random;
    const over = px >= tr.left && px <= tr.right && py >= tr.top - 8 && py <= tr.bottom + 8;
    let i = Math.floor(R() * fit.letters.length), u = 0.2 + R() * 0.6, v = 0.15 + R() * 0.7;
    if (over) {
      const x = px - tr.left;
      i = fit.letters.reduce((b, L, k) => (Math.abs((L.x0 + L.x1) / 2 - x) < Math.abs((fit!.letters[b].x0 + fit!.letters[b].x1) / 2 - x) ? k : b), 0);
      const L = fit.letters[i];
      u = clamp((x - L.x0) / (L.x1 - L.x0), 0.08, 0.92);
      v = clamp((py - tr.top - L.top) / (fit.base - L.top), 0.08, 0.95);
    }
    const s: Splash = { i, u, v, r: 0.06 + R() * 0.05, seed: Math.floor(R() * 1e9) };
    if (FEET[fit.letters[i].ch] && R() < 0.55) {
      s.v = Math.max(v, 0.3);
      s.run = 0.06 + R() * 0.12;
    }
    splash(s);
  };

  /** a burst of gas from the filter, and the sign flares */
  const burst = () => {
    if (REDUCED || anchor.childElementCount > 30) return;
    const R = Math.random;
    for (let k = 0; k < 10; k++) {
      // as the breath's puffs go (src/ui/style.css): out to a side on one layer, up on the other, rolling; up only
      const u = anchor.appendChild(document.createElement('u'));
      const p = u.appendChild(document.createElement('i'));
      p.className = 'lm-burst';
      p.style.backgroundPosition = `${Math.floor(R() * 4) * 33.333}% 0`;
      const side = k % 2 ? 1 : -1, t = { duration: 2300 + R() * 900, delay: k * 45, fill: 'backwards' as const };
      u.animate([{ translate: '0 0' }, { translate: `${f1(side * (34 + R() * 46))}px 0` }], { ...t, easing: 'cubic-bezier(.15,.6,.3,1)' });
      p.animate([{ translate: '0 0' }, { translate: `0 ${f1(-(50 + R() * 70))}px` }], { ...t, easing: 'cubic-bezier(.4,.05,.55,.95)' });
      p.animate([{ rotate: '0deg', scale: '0.5' }, { rotate: `${Math.round(side * (60 + R() * 80))}deg`, scale: (1.5 + R() * 0.5).toFixed(2) }], { ...t, easing: 'cubic-bezier(.2,.6,.4,1)' });
      p.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.06 }, { opacity: 0.55, offset: 0.35 }, { opacity: 0 }], t).onfinish = () => u.remove();
    }
    // and the sign's horns lash, with a flash and a ring
    flash.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0 }], { duration: 1100, easing: 'ease-out' });
    horns.forEach((h, k) =>
      h.animate([{ rotate: '0deg', scale: '1' }, { rotate: '-16deg', scale: '0.86', offset: 0.3 }, { rotate: '8deg', scale: '1.1', offset: 0.65 }, { rotate: '0deg', scale: '1' }], { duration: 900, delay: k * 50, easing: 'ease-in-out' }),
    );
    shock.animate([{ opacity: 0.9, transform: 'scale(.35)' }, { opacity: 0, transform: 'scale(1.45)' }], { duration: 800, delay: 260, easing: 'ease-out' });
  };

  // the lean: turned toward the pointer by at most 6°, the mask shifted 7 px its way, the glow behind 4 px the other
  let raf = 0, px = 0, py = 0, back = 0;
  const lean = (x: number, y: number) => {
    px = x;
    py = y;
    if (raf || REDUCED) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const dx = clamp((px - mid.x) / (innerWidth / 2), -1, 1), dy = clamp((py - mid.y) / (innerHeight / 2), -1, 1);
      mark.style.rotate = `${(dx * 6).toFixed(2)}deg`;
      for (const [el, d] of depth) el.style.translate = `${(dx * d).toFixed(1)}px ${(dy * d * 0.7).toFixed(1)}px`;
      pumpkins?.lean(dx, dy);
    });
  };
  const home = () => lean(mid.x, mid.y);

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') lean(e.clientX, e.clientY);
  };
  const onOut = (e: MouseEvent) => {
    if (!e.relatedTarget) home();
  };
  const onDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('button, a') || pumpkins?.hit(e.target)) return;
    if (e.pointerType !== 'mouse') {
      // a touch leans it that way for a moment
      lean(e.clientX, e.clientY);
      clearTimeout(back);
      back = window.setTimeout(home, 900);
    }
    burst();
    splashAt(e.clientX, e.clientY);
  };
  let pending = 0;
  const onResize = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(relayout);
  };
  const fontsDone = () => onResize();
  const titled = new MutationObserver(onResize);

  let on = false;
  const attach = () => {
    if (on) return;
    on = true;
    addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseout', onOut);
    root.addEventListener('pointerdown', onDown);
    addEventListener('resize', onResize);
    document.fonts?.addEventListener('loadingdone', fontsDone);
    titled.observe(title, { childList: true, characterData: true, subtree: true });
  };
  const detach = () => {
    if (!on) return;
    on = false;
    removeEventListener('pointermove', onMove);
    document.removeEventListener('mouseout', onOut);
    root.removeEventListener('pointerdown', onDown);
    removeEventListener('resize', onResize);
    document.fonts?.removeEventListener('loadingdone', fontsDone);
    titled.disconnect();
    cancelAnimationFrame(raf);
    raf = 0;
  };
  attach();

  // the screen gone (faded out: Game's start adds `done`), it is taken out of the page, and every loop with it;
  // back if it is shown again (a lost picture says so on it)
  let offT = 0;
  new MutationObserver(() => {
    const done = root.classList.contains('done'), off = root.classList.contains('off');
    if (done && !off && !offT)
      offT = window.setTimeout(() => {
        offT = 0;
        if (!root.classList.contains('done')) return;
        root.classList.add('off');
        detach();
      }, 1000);
    if (!done) {
      clearTimeout(offT);
      offT = 0;
      if (off) {
        root.classList.remove('off');
        attach();
      }
    }
  }).observe(root, { attributes: true, attributeFilter: ['class'] });

  // the blood comes once the letters are in their own face (measured in a stand-in they would sit wrong)
  let begun = false;
  const begin = () => {
    if (begun) return;
    begun = true;
    relayout();
    FIRST.forEach((s, k) => (REDUCED ? splash({ ...s }) : setTimeout(() => splash({ ...s }), 250 + k * 420)));
  };
  void (document.fonts?.ready ?? Promise.resolve()).then(begin);
  setTimeout(begin, 3000);
}
