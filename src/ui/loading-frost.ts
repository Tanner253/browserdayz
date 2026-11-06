// The frost on the loading screen's letters, for November (the owner, 2026-11-06: "its no longer halloween, we are in
// november! new loading page"; the plan, first snow, is progress/november-loading/plan.png). The letters are drawn again
// on a canvas over the title: rime creeping up from their feet, snow laid on every surface that faces up (as deep as it
// is flat), icicles under every flat one that faces down, and frost blooming where a click lands. All of it is found in
// the letters' own pixels, so ZONA, ARENA and BATTLE ROYALE are frosted alike. Drawn once a layout; a bloom redraws it
// only while it grows or fades.

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
type Rand = () => number;

/** a bloom: where (canvas px), its own pattern, when it landed, and when it began to go */
interface Bloom { x: number; y: number; seed: number; t0: number; gone?: number }
/** the most blooms at once (the oldest fades), and how long one takes to grow and to fade (ms) */
const MOST = 8, GROW = 700, FADE = 1400;

/** a frost fern: a stem with leaves off it at 60 degrees, each shorter toward its tip; `grow` of its length drawn */
function fern(c: CanvasRenderingContext2D, R: Rand, x: number, y: number, a: number, len: number, alpha: number, grow = 1, thick = 0.9) {
  c.strokeStyle = `rgba(242,248,255,${alpha.toFixed(3)})`;
  c.lineCap = 'round';
  const step = (len * grow) / 6;
  let px = x, py = y;
  for (let k = 0; k < 6; k++) {
    const nx = px + Math.cos(a) * step, ny = py + Math.sin(a) * step, leaf = len * grow * 0.32 * (1 - k / 6);
    c.lineWidth = thick * (1 - k / 8);
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(nx, ny);
    for (const side of [-1, 1]) {
      const b = a + side * 1.05, l = leaf * (0.6 + R() * 0.5);
      c.moveTo(nx, ny);
      c.lineTo(nx + Math.cos(b) * l, ny + Math.sin(b) * l);
    }
    c.stroke();
    px = nx;
    py = ny;
    a += (R() - 0.5) * 0.25;
  }
}

/** an icicle: thick at its root, a little uneven, clear ice lit from the left, a lump of ice where it hangs */
function icicle(c: CanvasRenderingContext2D, R: Rand, x: number, y: number, len: number, w: number) {
  const tip = x + (R() - 0.5) * w * 0.6, b = (R() - 0.5) * w * 0.4;
  const p = new Path2D();
  p.moveTo(x - w / 2, y - 1);
  p.quadraticCurveTo(x - w * 0.35 + b, y + len * 0.4, tip, y + len);
  p.quadraticCurveTo(x + w * 0.3 + b, y + len * 0.35, x + w / 2, y - 1);
  p.closePath();
  const g = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, 'rgba(170,200,224,0.75)');
  g.addColorStop(0.35, 'rgba(248,252,255,0.97)');
  g.addColorStop(1, 'rgba(150,182,210,0.7)');
  c.fillStyle = g;
  c.fill(p);
  c.fillStyle = 'rgba(236,244,250,0.95)';
  c.beginPath();
  c.ellipse(x, y, w * 0.8, w * 0.35, 0, 0, Math.PI * 2);
  c.fill();
  return tip;
}

/** surfaces a column at a time, joined into runs left to right where they meet within 2 px */
function runs(by: Map<number, number[]>, W: number) {
  const done: [number, number][][] = [];
  let live: [number, number][][] = [];
  for (let x = 0; x <= W; x++) {
    const ys = by.get(x) ?? [], used = new Set<number>(), next: [number, number][][] = [];
    for (const run of live) {
      const last = run[run.length - 1][1];
      let best = -1, bd = 3;
      ys.forEach((y, k) => {
        if (!used.has(k) && Math.abs(y - last) < bd) (bd = Math.abs(y - last)), (best = k);
      });
      if (best >= 0) {
        used.add(best);
        run.push([x, ys[best]]);
        next.push(run);
      } else done.push(run);
    }
    ys.forEach((y, k) => used.has(k) || next.push([[x, y]]));
    live = next;
  }
  return done;
}

export class Frost {
  readonly canvas: HTMLCanvasElement;
  /** the letters and their rime; the snow and the ice over them */
  private base = document.createElement('canvas');
  private top = document.createElement('canvas');
  private letters: { x0: number; x1: number; top: number; base: number }[] = [];
  /** icicles' tips, canvas px, longest first */
  private tipList: { x: number; y: number; len: number }[] = [];
  private blooms: Bloom[] = [];
  private em = 0;
  private dpr = 1;
  private raf = 0;

  constructor(private title: HTMLElement, host: HTMLElement) {
    this.canvas = host.appendChild(document.createElement('canvas'));
  }

  /** found again from the letters as they now stand (a resize, the face come in, another title); false if there are none */
  layout(): boolean {
    const title = this.title, text = title.firstChild;
    if (!(text instanceof Text) || !text.data.trim()) return false;
    const cs = getComputedStyle(title), em = parseFloat(cs.fontSize), font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const tr = title.getBoundingClientRect();
    if (!tr.width) return false;
    const dpr = Math.min(2, devicePixelRatio || 1);
    // room about the letters for snow above and icicles below
    const padX = Math.ceil(em * 0.12), padT = Math.ceil(em * 0.15), padB = Math.ceil(em * 0.3);
    const W = Math.ceil(tr.width) + 2 * padX, H = Math.ceil(tr.height) + padT + padB;
    Object.assign(this.canvas.style, { left: `${title.offsetLeft - padX}px`, top: `${title.offsetTop - padT}px`, width: `${W}px`, height: `${H}px` });
    for (const c of [this.canvas, this.base, this.top]) (c.width = W * dpr), (c.height = H * dpr);
    this.em = em;
    this.dpr = dpr;

    // each letter where the page set it (its box from the text itself, its baseline from the face's ascent)
    const range = document.createRange(), m0 = document.createElement('canvas').getContext('2d')!;
    m0.font = font;
    const at: { ch: string; x: number; y: number }[] = [];
    this.letters = [];
    for (let i = 0; i < text.length; i++) {
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const r = range.getBoundingClientRect(), ch = text.data[i], m = m0.measureText(ch);
      const fa = m.fontBoundingBoxAscent || em * 0.8, fd = m.fontBoundingBoxDescent || em * 0.2;
      const x = r.left - tr.left + padX, base = r.top - tr.top + (r.height * fa) / (fa + fd) + padT;
      if (!ch.trim()) continue;
      at.push({ ch, x, y: base });
      this.letters.push({ x0: x - m.actualBoundingBoxLeft, x1: x + m.actualBoundingBoxRight, top: base - m.actualBoundingBoxAscent, base });
    }
    const ink = (c: CanvasRenderingContext2D) => {
      c.font = font;
      c.fillStyle = '#e9e4d8';
      for (const L of at) c.fillText(L.ch, L.x, L.y);
    };

    // where the ink is, a pixel at a time: what faces up (empty above, ink below) and what faces down
    const sc = document.createElement('canvas');
    sc.width = W;
    sc.height = H;
    const s = sc.getContext('2d', { willReadFrequently: true })!;
    ink(s);
    const A = s.getImageData(0, 0, W, H).data, on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && A[(y * W + x) * 4 + 3] > 127;
    const ups = new Map<number, number[]>(), downs = new Map<number, number[]>();
    for (let x = 0; x < W; x++)
      for (let y = 1; y < H; y++) {
        const p = on(x, y - 1), q = on(x, y);
        if (!p && q) (ups.get(x) ?? ups.set(x, []).get(x)!).push(y);
        if (p && !q) (downs.get(x) ?? downs.set(x, []).get(x)!).push(y);
      }
    const room = (x: number, y: number, dir: number, most: number) => {
      let n = 0;
      while (n < most && !on(x, y + dir * (n + 1))) n++;
      return n;
    };
    const R = rng(7);

    // the letters, and rime on them only: a pale wash from the feet up, ferns rooted along the feet, a speckle of crystals
    const b = this.base.getContext('2d')!;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    ink(b);
    b.globalCompositeOperation = 'source-atop';
    for (const L of this.letters) {
      const g = b.createLinearGradient(0, L.base, 0, L.base - em * 0.42);
      g.addColorStop(0, 'rgba(206,226,240,0.95)');
      g.addColorStop(0.35, 'rgba(214,230,240,0.55)');
      g.addColorStop(1, 'rgba(214,230,240,0)');
      b.fillStyle = g;
      b.fillRect(L.x0 - 2, L.top - 2, L.x1 - L.x0 + 4, L.base - L.top + 4);
      for (let x = L.x0 + R() * 4; x < L.x1; x += em * (0.03 + R() * 0.04)) fern(b, R, x, L.base + 1, -Math.PI / 2 + (R() - 0.5) * 0.9, em * (0.08 + R() * R() * 0.22), 0.5);
      for (let k = 0; k < 70; k++) {
        b.fillStyle = `rgba(240,248,255,${(0.25 + R() * 0.45).toFixed(2)})`;
        b.fillRect(L.x0 + R() * (L.x1 - L.x0), L.base - Math.pow(R(), 1.8) * (L.base - L.top), 0.9, 0.9);
      }
    }
    b.globalCompositeOperation = 'source-over';

    // snow on whatever faces up: as deep as the surface is flat, lumpy, rounded off at its ends, never deeper than the room above
    const t = this.top.getContext('2d')!;
    t.setTransform(dpr, 0, 0, dpr, 0, 0);
    const T = em * 0.1;
    for (const run of runs(ups, W)) {
      const n = run.length;
      if (n < 3) continue;
      const ph = [R() * 9, R() * 9];
      const d = run.map(([x, y], k) => {
        const a = run[Math.max(0, k - 3)], c = run[Math.min(n - 1, k + 3)];
        const flat = Math.pow(clamp(1 - Math.abs((c[1] - a[1]) / Math.max(1, c[0] - a[0])) / 1.1, 0, 1), 1.5);
        const lump = 1 + 0.2 * Math.sin(x / (em * 0.07) + ph[0]) + 0.1 * Math.sin(x / (em * 0.025) + ph[1]);
        const end = Math.sqrt(clamp(Math.min(k + 1.5, n - k + 0.5) / (em * 0.05), 0, 1));
        return Math.min(T * flat * lump * end, room(x, y, -1, T * 2) * 0.6);
      });
      for (let k = 1; k < n - 1; k++) d[k] = (d[k - 1] + d[k] * 2 + d[k + 1]) / 4;
      if (Math.max(...d) < 1.2) continue;
      const path = new Path2D();
      path.moveTo(run[0][0] - 0.5, run[0][1] + 1.5);
      run.forEach(([x, y], k) => path.lineTo(x + 0.5, y - d[k]));
      for (let k = n - 1; k >= 0; k--) path.lineTo(run[k][0] + 0.5, run[k][1] + 1.5);
      path.closePath();
      // (its shadow on the letter first)
      t.save();
      t.translate(0, 2);
      t.filter = 'blur(1.5px)';
      t.fillStyle = 'rgba(20,32,44,0.45)';
      t.fill(path);
      t.restore();
      const hi = Math.min(...run.map(([, y], k) => y - d[k])), lo = Math.max(...run.map(([, y]) => y)) + 1.5;
      const g = t.createLinearGradient(0, hi, 0, lo);
      g.addColorStop(0, '#fbfdff');
      g.addColorStop(0.6, '#e6eef5');
      g.addColorStop(1, '#b9cad8');
      t.fillStyle = g;
      t.fill(path);
    }
    // icicles under whatever faces down and is flat, with room below them
    this.tipList = [];
    for (const run of runs(downs, W)) {
      const n = run.length;
      if (n < em * 0.05 || Math.abs(run[n - 1][1] - run[0][1]) / n > 0.3) continue;
      for (let k = Math.round(em * 0.02 + R() * em * 0.04); k < n - em * 0.02; k += Math.max(2, Math.round(em * (0.05 + R() * 0.07)))) {
        const [x, y] = run[k], free = room(x, y - 1, 1, em * 0.4);
        if (free < em * 0.1) continue;
        const len = Math.min(free * 0.55, em * (0.05 + Math.pow(R(), 1.6) * 0.17));
        this.tipList.push({ x: icicle(t, R, x, y, len, em * (0.022 + R() * 0.022)), y: y + len, len });
      }
    }
    this.tipList.sort((p, q) => q.len - p.len);
    // (a bloom stays where it fell on its letter; a new layout loses them)
    this.blooms = [];
    this.draw(performance.now());
    return true;
  }

  /** icicles' tips in the host's px, longest first */
  tips() {
    const l = parseFloat(this.canvas.style.left) || 0, tp = parseFloat(this.canvas.style.top) || 0;
    return this.tipList.map((p) => ({ x: l + p.x, y: tp + p.y, len: p.len }));
  }

  /** frost blooms where the pointer is, if it is on the letters; on one of them somewhere if not */
  bloomAt(cx: number, cy: number) {
    if (!this.letters.length) return;
    const r = this.canvas.getBoundingClientRect(), x = cx - r.left, y = cy - r.top, R = Math.random;
    const over = x >= 0 && y >= 0 && x <= r.width && y <= r.height;
    const L = over
      ? this.letters.reduce((a, c) => (Math.abs((c.x0 + c.x1) / 2 - x) < Math.abs((a.x0 + a.x1) / 2 - x) ? c : a))
      : this.letters[Math.floor(R() * this.letters.length)];
    const bx = over ? clamp(x, L.x0 + 2, L.x1 - 2) : L.x0 + (0.2 + R() * 0.6) * (L.x1 - L.x0);
    const by = over ? clamp(y, L.top + 2, L.base - 2) : L.top + (0.2 + R() * 0.6) * (L.base - L.top);
    this.bloom(bx, by, Math.floor(R() * 1e9));
  }

  /** a bloom on letter `i`, `u` across it and `v` down it */
  bloomOn(i: number, u: number, v: number, seed: number) {
    const L = this.letters[i % Math.max(1, this.letters.length)];
    if (L) this.bloom(L.x0 + u * (L.x1 - L.x0), L.top + v * (L.base - L.top), seed);
  }

  private bloom(x: number, y: number, seed: number) {
    const now = performance.now(), live = this.blooms.filter((b) => b.gone === undefined);
    if (live.length >= MOST) live[0].gone = now;
    this.blooms.push({ x, y, seed, t0: now });
    this.tick();
  }

  private tick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.draw(performance.now())) this.tick();
    });
  }

  /** the picture as it stands at `now`; true while a bloom still moves */
  private draw(now: number): boolean {
    const c = this.canvas.getContext('2d')!, em = this.em;
    let moving = false;
    this.blooms = this.blooms.filter((b) => b.gone === undefined || now - b.gone < FADE);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.base, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    for (const b of this.blooms) {
      const p = clamp((now - b.t0) / GROW, 0, 1), grow = 1 - Math.pow(1 - p, 3);
      const fade = b.gone === undefined ? 1 : 1 - clamp((now - b.gone) / FADE, 0, 1);
      if (p < 1 || b.gone !== undefined) moving = true;
      const R = rng(b.seed), g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, em * 0.22 * grow + 0.1);
      g.addColorStop(0, `rgba(235,245,255,${(0.6 * fade).toFixed(3)})`);
      g.addColorStop(1, 'rgba(235,245,255,0)');
      c.fillStyle = g;
      c.fillRect(b.x - em * 0.3, b.y - em * 0.3, em * 0.6, em * 0.6);
      for (let k = 0, n = 7; k < n; k++) fern(c, R, b.x, b.y, (k / n) * Math.PI * 2 + R() * 0.5, em * (0.12 + R() * 0.1), 0.95 * fade, grow, 1.4);
    }
    c.globalCompositeOperation = 'source-over';
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.top, 0, 0);
    return moving;
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
