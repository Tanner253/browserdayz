// A small map in the corner of the screen: the ground, the forest, the road, the buildings,
// and an arrow for where you are and which way you face. North is up. Nobody else is on
// it, with one exception: whoever carries a tag they took is shown to everyone for a few
// seconds, every half minute (see ping). M opens it large, with the places named.

import { BUILDING_FOOTPRINT, PLAY_RADIUS, WORLD_RES, WORLD_SIZE, type World } from '../world/worldgen';

/** pixels of the drawn map per metre of world */
const SCALE = 1;
/** metres across shown in the corner */
const SPAN = 260;
/** seconds a tag carrier's mark stays on the map */
const PING_LIFE = 12;

export class Minimap {
  root: HTMLDivElement;
  big = false;
  private base: HTMLCanvasElement;
  private view: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private last = { x: 1e9, z: 1e9, yaw: 9, big: false };
  private world: World;
  /** where tag carriers were last seen, and when (seconds, performance clock) */
  private pings: { x: number; z: number; at: number }[] = [];
  /** when this player was last shown to everyone else */
  private marked = -1e9;
  /** supply drops standing in the world */
  private drops: { x: number; z: number }[] = [];

  constructor(world: World) {
    this.world = world;
    this.base = this.draw(world);
    this.root = document.createElement('div');
    this.root.className = 'hud-minimap';
    this.view = document.createElement('canvas');
    this.root.appendChild(this.view);
    this.root.insertAdjacentHTML('beforeend', '<b>N</b><span><kbd>M</kbd> map</span>');
    this.ctx = this.view.getContext('2d')!;
    this.resize();
  }

  /** the whole map, drawn once */
  private draw(world: World): HTMLCanvasElement {
    const N = Math.round(WORLD_SIZE * SCALE);
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    // the ground: lighter where it is high, shaded on the slopes that face away from the light
    const img = g.createImageData(N, N);
    const H = world.heights, R = WORLD_RES;
    const at = (px: number, py: number) => {
      const gx = Math.min(R - 1, Math.max(0, Math.round((px / N) * (R - 1)))), gz = Math.min(R - 1, Math.max(0, Math.round((py / N) * (R - 1))));
      return H[gz * R + gx];
    };
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < H.length; i += 7) {
      lo = Math.min(lo, H[i]);
      hi = Math.max(hi, H[i]);
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const h = at(x, y);
        const k = (h - lo) / Math.max(1, hi - lo);
        const shade = clamp(0.5 + (at(x + 2, y + 2) - at(x - 2, y - 2)) * -0.06, 0.25, 0.85);
        const i = (y * N + x) * 4;
        img.data[i] = (62 + k * 70) * (0.55 + shade * 0.8);
        img.data[i + 1] = (72 + k * 62) * (0.55 + shade * 0.8);
        img.data[i + 2] = (44 + k * 40) * (0.55 + shade * 0.8);
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const X = (wx: number) => (wx + WORLD_SIZE / 2) * SCALE, Y = (wz: number) => (wz + WORLD_SIZE / 2) * SCALE;
    // forest
    g.fillStyle = 'rgba(24, 44, 22, 0.5)';
    for (const t of world.trees) {
      if (t.kind.startsWith('bush')) continue;
      g.beginPath();
      g.arc(X(t.x), Y(t.z), 2.4 * SCALE, 0, Math.PI * 2);
      g.fill();
    }
    // the road
    const pts = world.road.points;
    g.lineJoin = g.lineCap = 'round';
    for (const [w, col] of [[world.road.width + 3, 'rgba(20, 20, 18, 0.55)'], [world.road.width, '#9a9486']] as [number, string][]) {
      g.strokeStyle = col;
      g.lineWidth = w * SCALE;
      g.beginPath();
      for (let i = 0; i < pts.length; i += 3) {
        if (i === 0) g.moveTo(X(pts[i]), Y(pts[i + 2]));
        else g.lineTo(X(pts[i]), Y(pts[i + 2]));
      }
      g.stroke();
    }
    // buildings: their real footprints, the police station picked out
    for (const b of world.buildings) {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      g.save();
      g.translate(X(b.x), Y(b.z));
      g.rotate(-b.rot);
      g.fillStyle = 'rgba(0, 0, 0, 0.5)';
      g.fillRect((-w / 2 - 1) * SCALE, (-d / 2 - 1) * SCALE, (w + 2) * SCALE, (d + 2) * SCALE);
      g.fillStyle = b.type === 'police' ? '#6f9bd6' : b.type === 'guardpost' ? '#b9a26a' : '#d6c9a8';
      g.fillRect((-w / 2) * SCALE, (-d / 2) * SCALE, w * SCALE, d * SCALE);
      g.restore();
    }
    // where the map ends
    g.strokeStyle = 'rgba(240, 220, 160, 0.55)';
    g.lineWidth = 2;
    g.setLineDash([10, 8]);
    g.beginPath();
    g.arc(X(0), Y(0), PLAY_RADIUS * SCALE, 0, Math.PI * 2);
    g.stroke();
    return c;
  }

  private resize() {
    const css = this.big ? Math.round(Math.min(window.innerHeight, window.innerWidth) * 0.78) : 176;
    const px = Math.min(1400, Math.round(css * Math.min(2, window.devicePixelRatio || 1)));
    if (this.view.width !== px) this.view.width = this.view.height = px;
  }

  toggle(on?: boolean) {
    this.big = on ?? !this.big;
    this.root.classList.toggle('big', this.big);
    this.resize();
  }

  /**
   * Tag carriers, as the server last saw them. They pulse on the map for a few seconds and
   * fade: a place to go looking, not a tracker.
   * @param me this player is one of them
   */
  ping(at: { x: number; z: number }[], me: boolean) {
    const now = performance.now() / 1000;
    this.pings = at.map((p) => ({ ...p, at: now }));
    if (me) this.marked = now;
  }

  /** Supply drops, marked for as long as they stand. */
  setDrops(at: { x: number; z: number }[]) {
    this.drops = at;
    // drawn again at the next update, wherever the player is
    this.last.x = 1e9;
  }

  /** @param yaw the way the player faces, radians (0 = north, turning left is positive) */
  update(x: number, z: number, yaw: number) {
    const l = this.last;
    const now = performance.now() / 1000;
    if (this.pings.length && now - this.pings[0].at > PING_LIFE) this.pings = [];
    const live = this.pings.length > 0 || now - this.marked < PING_LIFE + 0.2;
    this.root.classList.toggle('marked', now - this.marked < PING_LIFE);
    // redrawn only when something on it has moved a pixel's worth (or a mark is pulsing)
    if (!live && Math.abs(l.x - x) < 0.35 && Math.abs(l.z - z) < 0.35 && Math.abs(l.yaw - yaw) < 0.012 && l.big === this.big) return;
    l.x = x;
    l.z = z;
    l.yaw = yaw;
    l.big = this.big;
    const g = this.ctx, W = this.view.width;
    const span = this.big ? WORLD_SIZE : SPAN;
    const k = W / span;
    // the middle of the picture: you, or (opened large) the middle of the map
    const cx = this.big ? 0 : x, cz = this.big ? 0 : z;
    g.fillStyle = '#1b1f17';
    g.fillRect(0, 0, W, W);
    const sx = (cx - span / 2 + WORLD_SIZE / 2) * SCALE, sz = (cz - span / 2 + WORLD_SIZE / 2) * SCALE;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, sx, sz, span * SCALE, span * SCALE, 0, 0, W, W);
    const px = (x - cx + span / 2) * k, pz = (z - cz + span / 2) * k;
    if (this.big) {
      // the places, by name
      g.font = `600 ${Math.round(W / 58)}px 'Barlow Condensed', 'Bahnschrift', sans-serif`;
      g.textAlign = 'center';
      for (const p of this.world.pois) {
        const lx = (p.x + span / 2) * k, lz = (p.z + span / 2) * k;
        g.fillStyle = 'rgba(0, 0, 0, 0.65)';
        g.fillText(p.name.toUpperCase(), lx + 1, lz - W / 70 + 1);
        g.fillStyle = '#f1e7c8';
        g.fillText(p.name.toUpperCase(), lx, lz - W / 70);
      }
    }
    // supply drops: a crate, there as long as the drop is; in the corner view one off the edge sits on the rim
    for (const d of this.drops) {
      let qx = (d.x - cx + span / 2) * k, qz = (d.z - cz + span / 2) * k;
      const r0 = this.big ? W / 80 : W / 19;
      let off = false;
      if (!this.big) {
        const dx = qx - W / 2, dz = qz - W / 2, dist = Math.hypot(dx, dz), rim = W / 2 - r0 * 1.2;
        if (dist > rim) {
          qx = W / 2 + (dx / dist) * rim;
          qz = W / 2 + (dz / dist) * rim;
          off = true;
        }
      }
      const h = r0 * (off ? 0.6 : 0.8);
      g.fillStyle = '#ffb347';
      g.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      g.lineWidth = Math.max(1.5, r0 * 0.22);
      g.beginPath();
      g.rect(qx - h, qz - h * 0.8, h * 2, h * 1.6);
      g.fill();
      g.stroke();
      // the lid and the straps: it reads as a crate, not a dot
      g.beginPath();
      g.moveTo(qx - h, qz - h * 0.25);
      g.lineTo(qx + h, qz - h * 0.25);
      g.moveTo(qx, qz - h * 0.8);
      g.lineTo(qx, qz + h * 0.8);
      g.lineWidth = Math.max(1, r0 * 0.14);
      g.stroke();
    }
    // tag carriers: a ring that beats, fading out; in the corner view one off the edge sits on the rim
    for (const p of this.pings) {
      const age = now - p.at;
      const fade = Math.min(1, age / 0.25) * (1 - smooth((age - (PING_LIFE - 3)) / 3));
      let qx = (p.x - cx + span / 2) * k, qz = (p.z - cz + span / 2) * k;
      const r0 = this.big ? W / 90 : W / 22;
      let off = false;
      if (!this.big) {
        const dx = qx - W / 2, dz = qz - W / 2, d = Math.hypot(dx, dz), rim = W / 2 - r0 * 1.3;
        if (d > rim) {
          qx = W / 2 + (dx / d) * rim;
          qz = W / 2 + (dz / d) * rim;
          off = true;
        }
      }
      const beat = (age * 1.4) % 1;
      g.lineWidth = Math.max(1.5, r0 * 0.28);
      g.strokeStyle = `rgba(255, 92, 60, ${0.9 * fade * (1 - beat)})`;
      g.beginPath();
      g.arc(qx, qz, r0 * (0.6 + beat * 1.9), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = `rgba(255, 92, 60, ${fade})`;
      g.strokeStyle = `rgba(0, 0, 0, ${0.8 * fade})`;
      g.lineWidth = Math.max(1, r0 * 0.2);
      g.beginPath();
      g.arc(qx, qz, r0 * (off ? 0.45 : 0.62), 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // you: an arrow pointing the way you face
    const s = this.big ? W / 70 : W / 13;
    g.save();
    g.translate(px, pz);
    g.rotate(-yaw);
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.62, s * 0.72);
    g.lineTo(0, s * 0.34);
    g.lineTo(-s * 0.62, s * 0.72);
    g.closePath();
    g.fillStyle = '#ffd35a';
    g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    g.lineWidth = Math.max(1.5, s * 0.16);
    g.stroke();
    g.fill();
    g.restore();
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** 0 below 0, 1 above 1, eased between */
function smooth(t: number) {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}
