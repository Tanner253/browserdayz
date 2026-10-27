// The death screen's map (the owner, 2026-10-25: "when the player dies and goes to respawn we should show the map and
// their spawn locations/options like rust does so the player can pick their spawn"): the map's own sheet about where
// they fell and their beds, each a pin with its name and whether it is ready, and the map's edge as the one other
// choice. A pin, or its line under the map, is clicked to pick it; Respawn then wakes them there
// (src/game/building/beds.ts, which feeds this).

import { distanceText, drawLabel, drawPin } from './bookmark';

/** a place to wake: a bed, by `key` ('' is the map's edge, which is not on the map) */
export interface SpawnSpot {
  key: string;
  x: number;
  z: number;
  name: string;
  ready: boolean;
  /** "Ready", "Ready · 2 left", or how long until it is */
  state: string;
}

/** the sheet drawn into a canvas, k pixels a metre with x, z at its middle (BigMap.paintSheet) */
type Paint = (g: CanvasRenderingContext2D, W: number, H: number, x: number, z: number, k: number) => void;

export class SpawnMap {
  readonly root = document.createElement('div');
  /** the one picked ('': the map's edge) */
  picked = '';
  private canvas = document.createElement('canvas');
  private list = document.createElement('div');
  private pins: { key: string; px: number; py: number }[] = [];
  private shown = '';

  constructor(private paint: Paint) {
    this.root.className = 'dead-map';
    this.list.className = 'dead-spots';
    this.root.append(this.canvas, this.list);
    // (a click within a fingertip of a pin's head picks it: the head stands above the place)
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect(), s = this.canvas.width / r.width;
      const x = (e.clientX - r.left) * s, y = (e.clientY - r.top) * s;
      const hit = this.pins.find((p) => Math.hypot(p.px - x, p.py - 22 * s - y) < 22 * s);
      if (hit) this.pick(hit.key);
    });
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && !b.disabled) this.pick(b.dataset.key ?? '');
    });
  }

  private spots: SpawnSpot[] = [];
  private me = { x: 0, z: 0 };

  private pick(key: string) {
    this.picked = key;
    this.shown = '';
    this.draw(this.spots, this.me);
  }

  /**
   * The next choice that is ready, along the list (the map's edge first), by A and D (2026-10-27, the owner: "a AND d
   * buttons to move selected sleeping spot, space to confirm (in the event mouse is disconnected from the ui and still
   * attached to thegame behind the ui)")
   */
  step(by: 1 | -1) {
    const keys = ['', ...this.spots.filter((s) => s.ready).map((s) => s.key)];
    this.pick(keys[(keys.indexOf(this.picked) + by + keys.length) % keys.length]);
  }

  /** drawn again: the beds as they are now (a picked one no longer ready goes back to the map's edge) */
  draw(spots: SpawnSpot[], me: { x: number; z: number }) {
    this.spots = spots;
    this.me = me;
    if (this.picked && !spots.some((s) => s.key === this.picked && s.ready)) this.picked = '';
    this.drawList();
    const c = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(2, Math.round(c.clientWidth * dpr)), H = Math.max(2, Math.round(c.clientHeight * dpr));
    if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
    const g = c.getContext('2d');
    if (!g) return;
    // (about where they fell and every bed, with room round them: a kilometre across at the least)
    let x0 = me.x, x1 = me.x, z0 = me.z, z1 = me.z;
    for (const s of spots) (x0 = Math.min(x0, s.x)), (x1 = Math.max(x1, s.x)), (z0 = Math.min(z0, s.z)), (z1 = Math.max(z1, s.z));
    const span = Math.max(1000, (x1 - x0) * 1.3, ((z1 - z0) * 1.3 * W) / H), k = W / span;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = (x: number) => W / 2 + (x - cx) * k, sy = (z: number) => H / 2 + (z - cz) * k;
    this.paint(g, W, H, cx, cz, k);
    const u = dpr;
    // where they fell: a cross
    g.strokeStyle = '#d2311b';
    g.lineWidth = 3 * u;
    const fx = sx(me.x), fz = sy(me.z), a = 6 * u;
    g.beginPath();
    g.moveTo(fx - a, fz - a);
    g.lineTo(fx + a, fz + a);
    g.moveTo(fx + a, fz - a);
    g.lineTo(fx - a, fz + a);
    g.stroke();
    drawLabel(g, 'You fell here', fx, fz + 18 * u, 13 * u);
    this.pins = [];
    for (const s of spots) {
      const px = sx(s.x), py = sy(s.z), on = s.key === this.picked;
      drawPin(g, px, py, (on ? 9 : 7) * u, { fill: s.ready ? (on ? '#f0c419' : '#4caf50') : '#7d8a99', edge: '#1d1b16', halo: on ? '#fff8e0' : '#e8e4d8' });
      drawLabel(g, `${s.name} · ${s.state}`, px, py + 15 * u, 13 * u);
      this.pins.push({ key: s.key, px, py });
    }
  }

  private drawList() {
    const far = (s: SpawnSpot) => distanceText(Math.hypot(s.x - this.me.x, s.z - this.me.z));
    const line = (key: string, name: string, small: string, ready: boolean) =>
      `<button class="dead-bed${key === this.picked ? ' on' : ''}" data-key="${key}"${ready ? '' : ' disabled'}>${name} <small>${small}</small></button>`;
    const html = [line('', 'Random start', 'the map’s edge', true), ...this.spots.map((s) => line(s.key, s.name, `${far(s)} · ${s.state}`, s.ready))].join('');
    if (html === this.shown) return;
    this.shown = html;
    this.list.innerHTML = html;
  }
}
