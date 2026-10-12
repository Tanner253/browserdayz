// The map, opened large (M): a sheet as an army prints one. Pale paper, the ground's shape in brown contour
// lines every five metres (every fifth one heavier), the woods tinted green, the roads and every building in
// black, a grid of hundred-metre squares lettered across and numbered down, a scale and a north point.
//
// It can be looked into: the wheel (or two fingers) brings it nearer about wherever it is pointed at, a drag
// moves it, and there are buttons for both and one that goes back to where you stand. It has a way out that can
// be seen (an X in its corner: asked for, for phones above all, which have no M and no Esc).
//
// And it says where things are to be had. Every building that has anything in it is outlined in the colour of
// the step of the map it is on (src/sim/tiers.ts), each step switched on and off from the bar along its top;
// pointed at, a building says what kind of thing is kept there: medical, military, what a house has. (Asked for:
// "allow the player to zoom in on the map and we should redo the map it doesnt look very official like a
// military map, lets add an x button", and "a filter overlay to the in game map to toggle the loot tier and
// locations so in game i can see where the good loot is". It had a dot for every place a thing can lie, a count
// of them on each button and a list of the things themselves, and was told: "we dont need an individual dot for
// each spawn simply list what category of loot exists at that building and make the building outline the color
// of the tier / dont need to list items or show how many spots spawn loot".)
//
// The small round map in the corner of the screen is another thing (minimap.ts) and is as it was.

import { breathe } from '../core/breathe';
import { TOUCH } from '../core/device';
import type { GasZone } from '../sim/gas';
import { TIERS, type Tier } from '../sim/tiers';
import { BUILDING_FOOTPRINT, WORLD_RES, WORLD_SIZE, playOutline, type World } from '../world/worldgen';
import type { MenuSpot } from './hud';

type Pt = { x: number; z: number };
/** what stands about the world now, as the corner map is told it */
export interface MapLive {
  jeeps: Pt[];
  wells: Pt[];
  traders: Pt[];
  drops: Pt[];
  pings: (Pt & { at: number })[];
}

/** metres between the lines of the grid, and between contour lines (every fifth is drawn heavier) */
const GRID = 100, CONTOUR = 5;
/** how near it can be brought: 1 is the whole sheet */
const NEAREST = 9;
const PAPER = [218, 212, 188], INK = '#1d1b16';
const TIER_IDS: Tier[] = [1, 2, 3, 4, 5];
const KEPT = 'zona.map';
/** a tier's colour on the sheet: its own, but for the first, which is a pale one made for a dark ground */
const onPaper = (t: Tier) => (t === 1 ? '#8d846c' : TIERS[t].colour);
/** what a kind of building is called */
const CALLED: Record<string, string> = {
  house_small: 'House', house_brick: 'Brick house', house_two: 'Two-floor house', townhouse: 'Brick townhouse', shanty: 'Plank house', cabin: 'Cabin', hut: 'Long hut',
  barn: 'Barn', shed: 'Shed', garage: 'Workshop', store: 'Shop', clinic: 'Clinic', police: 'Police station', police_hq: 'Police headquarters', hospital: 'Hospital', barracks: 'Barracks', guardpost: 'Guard post', tower: 'Watchtower', tent: 'Army tent',
};
/** the kinds of thing kept in a place, by what the place is said to be used for (what is not here says where a place is, not what is in it) */
const KIND: Record<string, string> = { Village: 'Residential', Town: 'Residential', Farm: 'Farm', Industrial: 'Industrial', Military: 'Military', Hunting: 'Hunting', Medic: 'Medical', Police: 'Police', Shop: 'Food and supplies', Bunker: 'Military' };

/** a building with something in it: where it stands, its step of the map, and the kinds of thing kept there */
interface Held { name: string; x: number; z: number; rot: number; w: number; d: number; tier: Tier; kinds: string[]; gas: boolean }

interface Shown { tiers: Tier[]; names: boolean; wells: boolean; cars: boolean; grid: boolean }

export class BigMap {
  root: HTMLDivElement;
  open = false;
  /** asked to be shut (its X, or a tap outside it) */
  onClose: () => void = () => {};
  /** everybody on the server, where they stand (an admin's map alone): each a dot with their name by it */
  private people: { x: number; z: number; name: string; dead?: boolean; faint?: boolean; staff?: boolean }[] = [];
  setPeople(list: BigMap['people']) {
    if (!list.length && !this.people.length) return;
    this.people = list;
    this.dirty = true;
  }
  /** a place on the sheet right-clicked (an admin goes there): null, and a right-click is nothing */
  onPick: ((x: number, z: number) => void) | null = null;
  private sheet: HTMLCanvasElement | null = null;
  /** pixels of the sheet to a metre: finer on a computer, which has the memory for it and looks closer */
  private S = TOUCH ? 1 : 2;
  private view: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tip: HTMLElement;
  private key: HTMLElement;
  private zoom = 1;
  private at: Pt = { x: 0, z: 0 };
  private me = { x: 0, z: 0, yaw: 0 };
  private dirty = true;
  private shown: Shown = { tiers: [...TIER_IDS], names: true, wells: true, cars: true, grid: true };
  /** fingers (or the mouse button) down on it, and how far apart two of them were */
  private down = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private dragged = 0;

  private held: Held[] = [];

  constructor(
    private world: World,
    points: { x: number; z: number; tier?: Tier; usage: string[]; building: string }[],
    private spots: MenuSpot[],
    private gas: GasZone | null,
    private live: () => MapLive,
  ) {
    // every building, with the step its places are on (most of them) and the kinds of thing they are for
    const inside = new Map<string, typeof points>();
    for (const q of points) inside.set(q.building, [...(inside.get(q.building) ?? []), q]);
    const most = <T,>(list: T[]) => {
      const n = new Map<T, number>();
      for (const v of list) n.set(v, (n.get(v) ?? 0) + 1);
      return [...n].sort((a, b) => b[1] - a[1]).map(([v]) => v);
    };
    const kinds = (list: typeof points) => most(list.flatMap((q) => q.usage.map((u) => KIND[u]).filter(Boolean)));
    for (const b of world.buildings) {
      const list = inside.get(b.id);
      if (!list?.length) continue;
      inside.delete(b.id);
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      this.held.push({ name: CALLED[b.type] ?? 'Building', x: b.x, z: b.z, rot: b.rot, w, d, tier: most(list.map((q) => q.tier ?? 1))[0], kinds: kinds(list), gas: list.some((q) => q.usage.includes('Gas')) });
    }
    // (and what is in no building on the sheet, which is the bunker under its hill: marked where its way in is)
    const rest = [...inside.values()].flat();
    if (rest.length) {
      const tier = most(rest.map((q) => q.tier ?? 1))[0], at = spots.find((q) => q.tier === tier && q.label) ?? { x: rest[0].x, z: rest[0].z, name: 'Bunker' };
      this.held.push({ name: at.name, x: at.x, z: at.z, rot: 0, w: 14, d: 14, tier, kinds: kinds(rest), gas: false });
    }
    try {
      const was = JSON.parse(localStorage.getItem(KEPT) ?? 'null') as Partial<Shown> | null;
      if (was && Array.isArray(was.tiers)) this.shown = { ...this.shown, ...was, tiers: was.tiers.filter((t) => TIER_IDS.includes(t)) };
    } catch {
      /* nothing kept: everything shown */
    }
    this.root = document.createElement('div');
    this.root.className = 'hud-map';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="hm-sheet">
        <div class="hm-bar">
          <div class="hm-title"><b>ZONA</b><span>SHEET 1 · GRID ${GRID} M · CONTOURS ${CONTOUR} M</span></div>
          <div class="hm-tiers">${TIER_IDS.map((t) => `<button type="button" data-tier="${t}" style="--c:${TIERS[t].colour}"><i></i><span class="hm-long">Tier&nbsp;</span><span class="hm-short">T</span>${t}</button>`).join('')}</div>
          <div class="hm-show">
            <button type="button" data-show="names">Names</button>
            <button type="button" data-show="wells">Wells</button>
            <button type="button" data-show="cars">Cars</button>
            <button type="button" data-show="grid">Grid</button>
          </div>
          <div class="hm-zoom">
            <button type="button" data-zoom="-1" aria-label="Further off">−</button>
            <button type="button" data-zoom="1" aria-label="Nearer">+</button>
            <button type="button" data-zoom="0" aria-label="Where I am">Me</button>
          </div>
          <button type="button" class="hm-x" aria-label="Close the map">✕</button>
        </div>
        <div class="hm-view"><canvas></canvas><div class="hm-tip" hidden></div></div>
        <div class="hm-key"></div>
      </div>`;
    this.view = this.root.querySelector('canvas')!;
    this.g = this.view.getContext('2d')!;
    this.tip = this.root.querySelector('.hm-tip')!;
    this.key = this.root.querySelector('.hm-key')!;
    this.say(null);
    this.marks();

    this.root.querySelector('.hm-x')!.addEventListener('click', () => this.onClose());
    // (a press on the dark round the sheet is a way out too)
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.onClose();
    });
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-tier]')) {
      const t = Number(b.dataset.tier) as Tier;
      b.addEventListener('click', () => {
        this.shown.tiers = this.shown.tiers.includes(t) ? this.shown.tiers.filter((q) => q !== t) : [...this.shown.tiers, t];
        this.keep();
        this.say(t);
      });
      b.addEventListener('pointerenter', () => this.say(t));
      b.addEventListener('pointerleave', () => this.say(null));
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-show]')) {
      b.addEventListener('click', () => {
        const k = b.dataset.show as 'names' | 'wells' | 'cars' | 'grid';
        this.shown[k] = !this.shown[k];
        this.keep();
      });
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
      b.addEventListener('click', () => {
        const d = Number(b.dataset.zoom);
        if (d) this.nearer(d > 0 ? 1.6 : 1 / 1.6);
        else {
          this.at = { x: this.me.x, z: this.me.z };
          if (this.zoom < 2.5) this.zoom = 2.5;
          this.clamp();
        }
      });
    }

    const v = this.view;
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = v.getBoundingClientRect();
      this.nearer(e.deltaY < 0 ? 1.25 : 1 / 1.25, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }, { passive: false });
    v.addEventListener('pointerdown', (e) => {
      try {
        v.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that is already gone */
      }
      this.down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragged = 0;
      this.pinch = 0;
    });
    v.addEventListener('pointermove', (e) => {
      const was = this.down.get(e.pointerId), r = v.getBoundingClientRect();
      if (!was) return void this.point((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX - r.left, e.clientY - r.top);
      const k = this.perMetre() * (r.width / v.width);
      if (this.down.size === 1) {
        // one finger, or the mouse held down: the sheet goes with it
        this.at.x -= (e.clientX - was.x) / k;
        this.at.z -= (e.clientY - was.y) / k;
        this.dragged += Math.abs(e.clientX - was.x) + Math.abs(e.clientY - was.y);
      }
      was.x = e.clientX;
      was.y = e.clientY;
      if (this.down.size === 2) {
        // two fingers: nearer as they part, about the point between them
        const [a, b] = [...this.down.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0 && d > 0) this.nearer(d / this.pinch, ((a.x + b.x) / 2 - r.left) / r.width, ((a.y + b.y) / 2 - r.top) / r.height);
        this.pinch = d;
        this.dragged = 99;
      }
      this.clamp();
      this.tip.hidden = true;
    });
    const up = (e: PointerEvent) => {
      if (!this.down.delete(e.pointerId)) return;
      this.pinch = 0;
      // (a tap, on a phone: what is tapped says what it is, as a thing pointed at does)
      const r = v.getBoundingClientRect();
      if (this.dragged < 6 && e.type === 'pointerup') this.point((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX - r.left, e.clientY - r.top);
    };
    v.addEventListener('pointerup', up);
    v.addEventListener('pointercancel', up);
    v.addEventListener('pointerleave', () => (this.tip.hidden = true));
    v.addEventListener('contextmenu', (e) => {
      if (!this.onPick) return;
      e.preventDefault();
      const r = v.getBoundingClientRect(), k = this.perMetre();
      this.onPick(this.at.x + (((e.clientX - r.left) / r.width - 0.5) * v.width) / k, this.at.z + (((e.clientY - r.top) / r.height - 0.5) * v.height) / k);
    });
    window.addEventListener('resize', () => (this.dirty = true));
  }

  // ------------------------------------------------------------------ opened and shut

  /** @param x,z where the player stands: the sheet opens whole, and is brought near about there */
  show(x: number, z: number) {
    this.open = true;
    this.root.hidden = false;
    this.me.x = x;
    this.me.z = z;
    this.zoom = 1;
    this.at = { x: 0, z: 0 };
    this.down.clear();
    this.tip.hidden = true;
    this.sheet ??= this.print();
    this.press = null;
    this.dirty = true;
  }

  hide() {
    this.open = false;
    this.root.hidden = true;
  }

  private keep() {
    try {
      localStorage.setItem(KEPT, JSON.stringify(this.shown));
    } catch {
      /* a browser that keeps nothing */
    }
    this.marks();
    this.dirty = true;
  }

  /** the buttons say what is switched on */
  private marks() {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-tier]')) b.classList.toggle('on', this.shown.tiers.includes(Number(b.dataset.tier) as Tier));
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-show]')) b.classList.toggle('on', this.shown[b.dataset.show as 'names']);
  }

  /** the line under the sheet: what a step of the map is, or how the sheet is read */
  private say(t: Tier | null) {
    const T = t ? TIERS[t] : null;
    this.key.innerHTML = T
      ? `<b style="color:${T.colour}">${T.name}</b><span>${T.where}.</span>`
      : `<span>A building is outlined in the colour of its tier. ${TOUCH ? 'Tap' : 'Point at'} one for the kind of loot kept there. ${TOUCH ? 'Two fingers bring it nearer, one moves it.' : 'The wheel brings it nearer, a drag moves it.'}</span>`;
  }

  // ------------------------------------------------------------------ where things are on the screen

  /** pixels of the picture to a metre, as near as it is now */
  private perMetre() {
    return (Math.min(this.view.width, this.view.height) / WORLD_SIZE) * this.zoom;
  }

  /** brought nearer (or further) about a point of the picture, 0..1 each way */
  private nearer(by: number, u = 0.5, w = 0.5) {
    const W = this.view.width, H = this.view.height, k0 = this.perMetre();
    const wx = this.at.x + ((u - 0.5) * W) / k0, wz = this.at.z + ((w - 0.5) * H) / k0;
    this.zoom = Math.min(NEAREST, Math.max(1, this.zoom * by));
    const k = this.perMetre();
    this.at.x = wx - ((u - 0.5) * W) / k;
    this.at.z = wz - ((w - 0.5) * H) / k;
    this.clamp();
  }

  /** the sheet is not dragged off the picture */
  private clamp() {
    const k = this.perMetre(), halfW = this.view.width / 2 / k, halfH = this.view.height / 2 / k, edge = WORLD_SIZE / 2;
    this.at.x = halfW >= edge ? 0 : Math.min(edge - halfW, Math.max(-edge + halfW, this.at.x));
    this.at.z = halfH >= edge ? 0 : Math.min(edge - halfH, Math.max(-edge + halfH, this.at.z));
    this.dirty = true;
  }

  /** something pointed at (or tapped): the place nearest it, if one is near, says what it is */
  private point(u: number, w: number, left: number, top: number) {
    const W = this.view.width, H = this.view.height, k = this.perMetre();
    const wx = this.at.x + ((u - 0.5) * W) / k, wz = this.at.z + ((w - 0.5) * H) / k;
    // (within a finger's width of it on the screen, whatever that is in metres just now)
    const reach = (TOUCH ? 26 : 16) * (W / Math.max(1, this.view.clientWidth)) / k;
    // a building first: the one the point is in (or all but in), if its tier is being shown
    let house: Held | null = null, near = reach * 0.6;
    for (const h of this.held) {
      if (!this.shown.tiers.includes(h.tier)) continue;
      const dx = wx - h.x, dz = wz - h.z, c = Math.cos(h.rot), sn = Math.sin(h.rot);
      const lx = Math.abs(dx * c - dz * sn) - h.w / 2, lz = Math.abs(dx * sn + dz * c) - h.d / 2, out = Math.max(0, lx, lz);
      if (out < near) {
        near = out;
        house = h;
      }
    }
    if (house) {
      const T = TIERS[house.tier];
      this.tip.innerHTML = `<b>${house.name}</b><i style="color:${T.colour}">${T.name}</i><p class="finds">${house.kinds.join(' · ') || 'Odds and ends'}</p>${house.gas ? '<p>Under the gas: a mask is needed.</p>' : ''}`;
    } else {
      let best: MenuSpot | null = null, far = reach;
      for (const q of this.spots) {
        if (q.kind === 'spawn') continue;
        const d = Math.hypot(q.x - wx, q.z - wz);
        if (d < far) {
          far = d;
          best = q;
        }
      }
      if (!best) return void (this.tip.hidden = true);
      const T = best.tier ? TIERS[best.tier] : null;
      this.tip.innerHTML = `<b>${best.name}</b>${T ? `<i style="color:${T.colour}">${T.name}</i>` : ''}<p>${best.tip}</p>`;
    }
    this.tip.hidden = false;
    const box = this.view.getBoundingClientRect();
    this.tip.style.left = `${Math.min(box.width - 290, Math.max(8, left + 16))}px`;
    this.tip.style.top = `${Math.min(box.height - 150, Math.max(8, top + 14))}px`;
  }

  // ------------------------------------------------------------------ the sheet, printed once

  /** the sheet as it is being printed ahead of the first time it is asked for (see `ahead`) */
  private press: Generator<void, HTMLCanvasElement> | null = null;

  /**
   * The sheet is printed before anybody opens the map, a strip of it in each frame's spare time. Printed whole
   * the first time M was pressed, it was a quarter of a second in which nothing moved (257 and 284 ms measured).
   */
  ahead() {
    if (this.sheet || this.press) return;
    const press = (this.press = this.printing());
    void (async () => {
      for (;;) {
        await breathe();
        // (opened before it was done: it was finished there and then, in `print`)
        if (this.press !== press) return;
        const step = press.next();
        if (!step.done) continue;
        this.sheet = step.value;
        this.press = null;
        this.dirty = true;
        return;
      }
    })();
  }

  /** the sheet whole, now: what is left of it, if it was being printed ahead */
  private print(): HTMLCanvasElement {
    const press = this.press ?? this.printing();
    for (;;) {
      const step = press.next();
      if (step.done) return step.value;
    }
  }

  private *printing(): Generator<void, HTMLCanvasElement> {
    const world = this.world, S = this.S, N = Math.round(WORLD_SIZE * S);
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    const img = g.createImageData(N, N), D = img.data;
    const H = world.heights, R = WORLD_RES;
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < H.length; i += 5) {
      lo = Math.min(lo, H[i]);
      hi = Math.max(hi, H[i]);
    }
    // the ground's height under every point of a row of the sheet
    const row = (py: number, out: Float32Array) => {
      const fz = (Math.min(N - 1, py) / (N - 1)) * (R - 1), z0 = Math.min(R - 2, fz | 0), tz = fz - z0;
      for (let px = 0; px <= N; px++) {
        const fx = (Math.min(N - 1, px) / (N - 1)) * (R - 1), x0 = Math.min(R - 2, fx | 0), tx = fx - x0, i = z0 * R + x0;
        out[px] = (H[i] * (1 - tx) + H[i + 1] * tx) * (1 - tz) + (H[i + R] * (1 - tx) + H[i + R + 1] * tx) * tz;
      }
    };
    let cur = new Float32Array(N + 1), next = new Float32Array(N + 1);
    row(0, cur);
    for (let y = 0; y < N; y++) {
      row(y + 1, next);
      for (let x = 0; x < N; x++) {
        const h = cur[x], hr = cur[x + 1], hd = next[x];
        // paper, a little lighter where the ground is high, and lit from the north-west so that its shape reads
        const k = (h - lo) / Math.max(1, hi - lo);
        const lit = Math.min(1.1, Math.max(0.8, 1 + (hr - h + (hd - h)) * S * 0.16)) * (0.93 + k * 0.09);
        let r = PAPER[0] * lit, gr = PAPER[1] * lit, b = PAPER[2] * lit;
        // a contour: where the height passes a multiple of five metres between this point and the next
        const a = Math.floor(h / CONTOUR), ar = Math.floor(hr / CONTOUR), ad = Math.floor(hd / CONTOUR);
        if (a !== ar || a !== ad) {
          const level = Math.max(a, ar, ad) * CONTOUR;
          const w = level % (CONTOUR * 5) === 0 ? 0.82 : 0.4;
          r += (132 - r) * w;
          gr += (92 - gr) * w;
          b += (52 - b) * w;
        }
        const i = (y * N + x) * 4;
        D[i] = r;
        D[i + 1] = gr;
        D[i + 2] = b;
        D[i + 3] = 255;
      }
      const t = cur;
      cur = next;
      next = t;
      // (a strip of sixteen rows put down, and a pause)
      if ((y & 15) === 15 || y === N - 1) {
        const from = y - (y & 15);
        g.putImageData(img, 0, 0, 0, from, N, y - from + 1);
        yield;
      }
    }
    const X = (wx: number) => (wx + WORLD_SIZE / 2) * S, Y = (wz: number) => (wz + WORLD_SIZE / 2) * S;
    // the woods: green, deeper where the trees stand close
    g.fillStyle = 'rgba(92, 132, 66, 0.2)';
    let trees = 0;
    for (const t of world.trees) {
      if (t.kind.startsWith('bush')) continue;
      g.beginPath();
      g.arc(X(t.x), Y(t.z), 3.4 * S, 0, Math.PI * 2);
      g.fill();
      if (++trees % 400 === 0) yield;
    }
    yield;
    // the grid: hundred-metre squares
    g.strokeStyle = 'rgba(36, 58, 92, 0.3)';
    g.lineWidth = Math.max(1, S * 0.5);
    for (let m = 0; m <= WORLD_SIZE; m += GRID) {
      g.beginPath();
      g.moveTo(m * S, 0);
      g.lineTo(m * S, N);
      g.moveTo(0, m * S);
      g.lineTo(N, m * S);
      g.stroke();
    }
    // the roads: cased in black, filled the orange of a made road
    g.lineJoin = g.lineCap = 'round';
    for (const [extra, colour] of [[3, INK], [0, '#d9963f']] as [number, string][]) {
      for (const road of [world.road, ...world.roads]) {
        const pts = road.points;
        g.strokeStyle = colour;
        g.lineWidth = (road.width + extra) * S;
        g.beginPath();
        for (let i = 0; i < pts.length; i += 3) {
          if (i === 0) g.moveTo(X(pts[i]), Y(pts[i + 2]));
          else g.lineTo(X(pts[i]), Y(pts[i + 2]));
        }
        g.stroke();
      }
    }
    yield;
    // every building, by its own footprint
    g.fillStyle = INK;
    for (const b of world.buildings) {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      g.save();
      g.translate(X(b.x), Y(b.z));
      g.rotate(-b.rot);
      g.fillRect((-w / 2) * S, (-d / 2) * S, w * S, d * S);
      g.restore();
    }
    for (const s of world.solids) {
      g.beginPath();
      g.arc(X(s.x), Y(s.z), Math.max(1.2, s.r) * S, 0, Math.PI * 2);
      g.fill();
    }
    // the line round the Zona: tags are earned inside it
    g.strokeStyle = 'rgba(150, 38, 28, 0.85)';
    g.lineWidth = 1.6 * S;
    g.setLineDash([9 * S, 6 * S]);
    for (const a of playOutline()) {
      g.beginPath();
      g.arc(X(a.x), Y(a.z), a.r * S, a.from, a.to);
      g.stroke();
    }
    g.setLineDash([]);
    return c;
  }

  // ------------------------------------------------------------------ each frame it is open

  /** @param yaw the way the player faces, radians (0 = north, turning left is positive) */
  update(x: number, z: number, yaw: number) {
    if (!this.open || !this.sheet) return;
    const m = this.me, live = this.live(), now = performance.now() / 1000;
    if (Math.abs(m.x - x) > 0.3 || Math.abs(m.z - z) > 0.3 || Math.abs(m.yaw - yaw) > 0.02) this.dirty = true;
    m.x = x;
    m.z = z;
    m.yaw = yaw;
    const v = this.view, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(2, Math.round(v.clientWidth * dpr)), Hh = Math.max(2, Math.round(v.clientHeight * dpr));
    if (v.width !== W || v.height !== Hh) {
      v.width = W;
      v.height = Hh;
      this.clamp();
    }
    if (!this.dirty && !live.pings.length) return;
    this.dirty = false;
    const g = this.g, k = this.perMetre(), S = this.S, u = dpr;
    const sx = (wx: number) => W / 2 + (wx - this.at.x) * k, sy = (wz: number) => Hh / 2 + (wz - this.at.z) * k;
    const on = (px: number, py: number, r = 0) => px > -r && py > -r && px < W + r && py < Hh + r;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#15170f';
    g.fillRect(0, 0, W, Hh);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.setTransform(k / S, 0, 0, k / S, sx(-WORLD_SIZE / 2), sy(-WORLD_SIZE / 2));
    g.drawImage(this.sheet, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const text = (s: string, px: number, py: number, size: number, colour = INK, weight = 700) => {
      g.font = `${weight} ${Math.round(size * u)}px 'Barlow Condensed', 'Bahnschrift', sans-serif`;
      g.lineWidth = Math.max(2, size * u * 0.26);
      g.strokeStyle = 'rgba(226, 221, 200, 0.92)';
      g.lineJoin = 'round';
      g.strokeText(s, px, py);
      g.fillStyle = colour;
      g.fillText(s, px, py);
    };

    // the gas: the ground it lies on, hatched round
    if (this.gas) {
      const qx = sx(this.gas.x), qz = sy(this.gas.z), qr = this.gas.r * k;
      if (on(qx, qz, qr)) {
        g.beginPath();
        g.arc(qx, qz, qr, 0, Math.PI * 2);
        g.fillStyle = 'rgba(168, 190, 40, 0.3)';
        g.fill();
        g.setLineDash([7 * u, 5 * u]);
        g.lineWidth = 2 * u;
        g.strokeStyle = 'rgba(96, 112, 10, 0.95)';
        g.stroke();
        g.setLineDash([]);
        g.textAlign = 'center';
        text('GAS · MASK NEEDED', qx, qz + qr + 16 * u, 13, '#5c6a08');
      }
    }

    // what is kept where: each building that has anything in it, outlined in the colour of its step of the map
    if (this.shown.tiers.length) {
      const line = Math.max(2 * u, Math.min(4.5 * u, k * 1.1));
      for (const h of this.held) {
        if (!this.shown.tiers.includes(h.tier)) continue;
        const px = sx(h.x), py = sy(h.z), w = h.w * k, d = h.d * k;
        if (!on(px, py, Math.max(w, d) + line * 2)) continue;
        g.save();
        g.translate(px, py);
        g.rotate(-h.rot);
        // (a dark edge under the colour, so that a pale one is seen on paper; the colour laid over the building too, thinly)
        g.lineJoin = 'miter';
        g.strokeStyle = 'rgba(20, 18, 12, 0.9)';
        g.lineWidth = line + 2 * u;
        g.strokeRect(-w / 2 - line / 2, -d / 2 - line / 2, w + line, d + line);
        g.fillStyle = onPaper(h.tier);
        g.globalAlpha = 0.35;
        g.fillRect(-w / 2, -d / 2, w, d);
        g.globalAlpha = 1;
        g.strokeStyle = onPaper(h.tier);
        g.lineWidth = line;
        g.strokeRect(-w / 2 - line / 2, -d / 2 - line / 2, w + line, d + line);
        g.restore();
      }
    }

    // a well: a drop of water
    if (this.shown.wells) {
      const r = 6.5 * u;
      for (const t of live.wells) {
        const qx = sx(t.x), qz = sy(t.z);
        if (!on(qx, qz, r * 2)) continue;
        g.beginPath();
        g.moveTo(qx, qz - r * 1.5);
        g.bezierCurveTo(qx + r * 1.3, qz - r * 0.1, qx + r, qz + r, qx, qz + r);
        g.bezierCurveTo(qx - r, qz + r, qx - r * 1.3, qz - r * 0.1, qx, qz - r * 1.5);
        g.fillStyle = '#3f8fd0';
        g.fill();
        g.lineWidth = 1.6 * u;
        g.strokeStyle = INK;
        g.stroke();
      }
    }
    // the trader: a coin, where he stands
    for (const t of live.traders) {
      const qx = sx(t.x), qz = sy(t.z), r = 7 * u;
      if (!on(qx, qz, r)) continue;
      g.beginPath();
      g.arc(qx, qz, r, 0, Math.PI * 2);
      g.fillStyle = '#58b983';
      g.fill();
      g.lineWidth = 1.8 * u;
      g.strokeStyle = INK;
      g.stroke();
      g.beginPath();
      g.arc(qx, qz, r * 0.45, 0, Math.PI * 2);
      g.lineWidth = 1.3 * u;
      g.stroke();
    }
    // cars nobody is in: a block with a wheel at each end
    if (this.shown.cars) {
      const h = 4.2 * u;
      for (const j of live.jeeps) {
        const qx = sx(j.x), qz = sy(j.z);
        if (!on(qx, qz, h * 3)) continue;
        g.fillStyle = '#f2ecd6';
        g.strokeStyle = INK;
        g.lineWidth = 1.5 * u;
        g.beginPath();
        g.rect(qx - h * 1.5, qz - h * 0.75, h * 3, h * 1.5);
        g.fill();
        g.stroke();
        g.fillStyle = INK;
        g.beginPath();
        g.arc(qx - h * 0.85, qz + h * 0.85, h * 0.45, 0, Math.PI * 2);
        g.arc(qx + h * 0.85, qz + h * 0.85, h * 0.45, 0, Math.PI * 2);
        g.fill();
      }
    }
    // supply drops and helicopters down: a crate, for as long as it stands
    for (const d of live.drops) {
      const qx = sx(d.x), qz = sy(d.z), h = 7 * u;
      if (!on(qx, qz, h * 2)) continue;
      g.fillStyle = '#f39a2b';
      g.strokeStyle = INK;
      g.lineWidth = 1.8 * u;
      g.beginPath();
      g.rect(qx - h, qz - h * 0.8, h * 2, h * 1.6);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(qx - h, qz - h * 0.25);
      g.lineTo(qx + h, qz - h * 0.25);
      g.moveTo(qx, qz - h * 0.8);
      g.lineTo(qx, qz + h * 0.8);
      g.lineWidth = 1.2 * u;
      g.stroke();
    }
    // whoever carries a tag they took: a ring that beats, as on the corner map
    for (const p of live.pings) {
      const age = now - p.at, beat = (age * 1.4) % 1, qx = sx(p.x), qz = sy(p.z), r0 = 8 * u;
      g.lineWidth = 2.4 * u;
      g.strokeStyle = `rgba(214, 48, 24, ${0.9 * (1 - beat)})`;
      g.beginPath();
      g.arc(qx, qz, r0 * (0.6 + beat * 1.9), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgb(214, 48, 24)';
      g.beginPath();
      g.arc(qx, qz, r0 * 0.6, 0, Math.PI * 2);
      g.fill();
    }

    // the places, by name: the big ones always, the rest once the sheet is brought a little nearer
    if (this.shown.names) {
      g.textAlign = 'center';
      for (const s of this.spots) {
        if (s.kind === 'spawn' || s.kind === 'well') continue;
        if (!s.label && this.zoom < (TOUCH ? 2.6 : 1.5)) continue;
        const px = sx(s.x), py = sy(s.z);
        if (!on(px, py, 80 * u)) continue;
        text(s.name.toUpperCase(), px, py - 9 * u, (s.label ? 15 : 12.5) * (TOUCH ? 0.82 : 1), s.tier && this.shown.tiers.includes(s.tier) ? INK : '#3a372e', s.label ? 700 : 600);
      }
    }

    // the grid's letters and numbers, along the top and down the left of the picture
    if (this.shown.grid) {
      // (along the sheet's own edges where the whole of it is in the picture, and the picture's where it runs off it)
      const half = WORLD_SIZE / 2, x0 = Math.max(0, sx(-half)), x1 = Math.min(W, sx(half)), y0 = Math.max(0, sy(-half)), y1 = Math.min(Hh, sy(half));
      g.fillStyle = 'rgba(21, 23, 15, 0.82)';
      g.fillRect(x0, y0, x1 - x0, 17 * u);
      g.fillRect(x0, y0, 19 * u, y1 - y0);
      g.font = `700 ${Math.round(11 * u)}px 'JetBrains Mono', ui-monospace, monospace`;
      g.fillStyle = '#e9e4d8';
      g.textAlign = 'center';
      for (let i = 0; (i + 0.5) * GRID < WORLD_SIZE; i++) {
        const mid = -half + (i + 0.5) * GRID, px = sx(mid), py = sy(mid);
        if (px > x0 + 24 * u && px < x1 - 6 * u) g.fillText(String.fromCharCode(65 + i), px, y0 + 12.5 * u);
        if (py > y0 + 24 * u && py < y1 - 6 * u) g.fillText(String(i + 1), x0 + 9.5 * u, py + 4 * u);
      }
    }

    // a scale: a round number of metres, about a hand's width of the picture
    {
      const want = (150 * u) / k, steps = [10, 20, 50, 100, 200, 500], m = steps.reduce((p, q) => (Math.abs(q - want) < Math.abs(p - want) ? q : p)), len = m * k;
      const x1 = W - 18 * u, y1 = Hh - 18 * u;
      g.fillStyle = 'rgba(226, 221, 200, 0.9)';
      g.fillRect(x1 - len - 8 * u, y1 - 20 * u, len + 16 * u, 30 * u);
      g.strokeStyle = INK;
      g.lineWidth = 2 * u;
      g.beginPath();
      g.moveTo(x1 - len, y1 - 6 * u);
      g.lineTo(x1 - len, y1);
      g.lineTo(x1, y1);
      g.lineTo(x1, y1 - 6 * u);
      g.stroke();
      g.textAlign = 'center';
      g.font = `700 ${Math.round(11 * u)}px 'JetBrains Mono', ui-monospace, monospace`;
      g.fillStyle = INK;
      g.fillText(`${m} M`, x1 - len / 2, y1 - 7 * u);
      // and north
      const nx = W - 26 * u, ny = (this.shown.grid ? 17 : 0) * u + 34 * u;
      g.beginPath();
      g.moveTo(nx, ny - 18 * u);
      g.lineTo(nx + 7 * u, ny + 4 * u);
      g.lineTo(nx, ny - 2 * u);
      g.lineTo(nx - 7 * u, ny + 4 * u);
      g.closePath();
      g.fillStyle = INK;
      g.strokeStyle = 'rgba(226, 221, 200, 0.92)';
      g.lineWidth = 2.5 * u;
      g.stroke();
      g.fill();
      text('N', nx, ny + 17 * u, 12);
    }

    // everybody else, to an admin: a dot each, and their name
    for (const q of this.people) {
      const px = sx(q.x), py = sy(q.z);
      if (!on(px, py, 60 * u)) continue;
      g.globalAlpha = q.faint ? 0.6 : 1;
      g.beginPath();
      g.arc(px, py, 4.5 * u, 0, Math.PI * 2);
      g.lineWidth = 2.4 * u;
      g.strokeStyle = '#fff8e0';
      g.stroke();
      g.fillStyle = q.dead ? '#6b6b63' : q.staff ? '#7a3fd0' : '#1f5fd0';
      g.fill();
      text(q.name + (q.dead ? ' (dead)' : ''), px + 8 * u, py + 4 * u, 12, q.dead ? '#55554e' : INK, 600);
      g.globalAlpha = 1;
    }

    // you: an arrow pointing the way you face
    {
      const s = 11 * u;
      g.save();
      g.translate(sx(x), sy(z));
      g.rotate(-yaw);
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s * 0.62, s * 0.72);
      g.lineTo(0, s * 0.34);
      g.lineTo(-s * 0.62, s * 0.72);
      g.closePath();
      g.lineWidth = 4 * u;
      g.strokeStyle = '#fff8e0';
      g.stroke();
      g.fillStyle = '#d2311b';
      g.fill();
      g.lineWidth = 1.2 * u;
      g.strokeStyle = INK;
      g.stroke();
      g.restore();
    }
  }
}
