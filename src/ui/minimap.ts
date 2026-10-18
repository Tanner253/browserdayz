// A small map in the corner of the screen: the ground, the forest, the road, the buildings,
// and an arrow for where you are and which way you face. North is up. Nobody else is on
// it, with one exception: whoever carries a tag they took is shown to everyone for a few
// seconds, every half minute (see ping). M opens the sheet itself, large: that is another thing (bigmap.ts).

import { playEdge } from '../world/outline';
import { ZONA_VOID } from '../sim/items';
import { BUILDING_FOOTPRINT, CELL, SEA_LEVEL, SQUARE_HALF, WORLD_NX, WORLD_NZ, WORLD_X0, WORLD_X1, WORLD_Z0, WORLD_Z1, type World } from '../world/worldgen';
import { gasClouds, type GasZone } from '../sim/gas';
import { HELI } from '../sim/heli';
import { POLICE_CAR } from '../sim/vehicles';
import { bookmark, bookmarkRev, distanceText, drawLabel, drawPin } from './bookmark';

/**
 * The colours of the vehicles' marks (the owner, 2026-10-18: "make uaz car icon green and the heli icon black with white
 * window on the map"): the UAZ grass green, stronger than the second tier's mint; the police car blue, under a bar of red
 * and blue lights; the helicopter black, its window white, and edged in white so that it shows on a dark roof.
 */
export const UAZ_FILL = '#5cb82e', POLICE_FILL = '#3a63d8', LIGHTS = ['#e8352e', '#56c8ff'], HELI_FILL = '#141414', HELI_EDGE = '#f2efe6';

/**
 * A vehicle's mark, on either map and in the sheet's legend, by its kind (the `k` of a VehicleInfo): the UAZ a block
 * with a wheel at each end, the police car the same in blue with its lights on the roof, a helicopter side on, its
 * rotor over its cabin, a tail boom to its fin and skids under it (the owner, 2026-10-18: "we need a heli icon too and
 * a icon to differ the police and uac spawns"). `h`: its size on the sheet.
 */
export function vehicleMark(g: CanvasRenderingContext2D, qx: number, qz: number, h: number, k: number | undefined, ink: string, line: number) {
  g.strokeStyle = ink;
  g.lineWidth = line;
  g.lineJoin = 'round';
  if (k === HELI.kind) {
    g.beginPath();
    g.moveTo(qx - 2.1 * h, qz - 1.15 * h);
    g.lineTo(qx + 1.3 * h, qz - 1.15 * h);
    g.moveTo(qx - 0.4 * h, qz - 1.15 * h);
    g.lineTo(qx - 0.4 * h, qz - 0.7 * h);
    g.moveTo(qx - 1.3 * h, qz + 1.05 * h);
    g.lineTo(qx + 0.5 * h, qz + 1.05 * h);
    g.moveTo(qx - 0.95 * h, qz + 0.55 * h);
    g.lineTo(qx - 0.95 * h, qz + 1.05 * h);
    g.moveTo(qx + 0.15 * h, qz + 0.55 * h);
    g.lineTo(qx + 0.15 * h, qz + 1.05 * h);
    g.moveTo(qx + 2.3 * h, qz - 0.95 * h);
    g.lineTo(qx + 2.3 * h, qz);
    // (black edged in white, as the body is: dark alone was lost on the dark of the legend and of a roof)
    g.strokeStyle = HELI_EDGE;
    g.lineWidth = line * 2.6;
    g.stroke();
    g.strokeStyle = HELI_FILL;
    g.lineWidth = line * 1.1;
    g.stroke();
    g.strokeStyle = HELI_EDGE;
    g.lineWidth = line;
    g.fillStyle = HELI_FILL;
    g.beginPath();
    g.moveTo(qx + 0.4 * h, qz - 0.35 * h);
    g.lineTo(qx + 2.3 * h, qz - 0.55 * h);
    g.lineTo(qx + 2.3 * h, qz - 0.2 * h);
    g.lineTo(qx + 0.4 * h, qz + 0.25 * h);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.ellipse(qx - 0.4 * h, qz - 0.05 * h, 1.1 * h, 0.72 * h, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // its window, at the nose
    g.fillStyle = HELI_EDGE;
    g.beginPath();
    g.ellipse(qx - 0.95 * h, qz - 0.22 * h, 0.42 * h, 0.3 * h, 0, 0, Math.PI * 2);
    g.fill();
    return;
  }
  const police = k === POLICE_CAR.kind;
  if (police) {
    const w = 0.75 * h, top = qz - 1.3 * h, tall = 0.55 * h;
    g.fillStyle = LIGHTS[0];
    g.fillRect(qx - w, top, w, tall);
    g.fillStyle = LIGHTS[1];
    g.fillRect(qx, top, w, tall);
    g.strokeRect(qx - w, top, 2 * w, tall);
  }
  g.fillStyle = police ? POLICE_FILL : UAZ_FILL;
  g.beginPath();
  g.rect(qx - h * 1.5, qz - h * 0.75, h * 3, h * 1.5);
  g.fill();
  g.stroke();
  g.fillStyle = ink;
  g.beginPath();
  g.arc(qx - h * 0.85, qz + h * 0.85, h * 0.45, 0, Math.PI * 2);
  g.arc(qx + h * 0.85, qz + h * 0.85, h * 0.45, 0, Math.PI * 2);
  g.fill();
}

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
  private last = { x: 1e9, z: 1e9, yaw: 9, big: false, pin: -1 };
  private world: World;
  /** where tag carriers were last seen, and when (seconds, performance clock) */
  private pings: { x: number; z: number; at: number }[] = [];
  /** when this player was last shown to everyone else */
  private marked = -1e9;
  /** supply drops standing in the world */
  private drops: { x: number; z: number }[] = [];
  private traders: { x: number; z: number }[] = [];
  private wells: { x: number; z: number }[] = [];
  /** vehicles nobody is in */
  private jeeps: { x: number; z: number; k?: number }[] = [];
  private jeepKey = '';
  /** where gas lies: every place under it */
  private gases: GasZone[] = [];
  /** the bookmark when it is out of the corner view: an arrow outside the ring, pointing the way to it */
  private pinOff: HTMLElement;

  constructor(world: World) {
    this.world = world;
    this.gases = gasClouds(world);
    this.base = this.draw(world);
    this.root = document.createElement('div');
    this.root.className = 'hud-minimap';
    this.view = document.createElement('canvas');
    this.root.appendChild(this.view);
    this.root.insertAdjacentHTML('beforeend', '<b>N</b><span><kbd>M</kbd> map</span><i class="hud-mm-pin" hidden><svg viewBox="-10 -10 20 20"><path d="M0,-9 L5.6,6.5 L0,3 L-5.6,6.5 Z"/></svg><em></em></i>');
    this.pinOff = this.root.querySelector('.hud-mm-pin')!;
    this.ctx = this.view.getContext('2d')!;
    this.resize();
  }

  /** everybody else, where an admin with names on is shown them (empty for anybody else) */
  private people: { x: number; z: number; name: string; dead?: boolean }[] = [];
  setPeople(list: { x: number; z: number; name: string; dead?: boolean }[]) {
    if (!list.length && !this.people.length) return;
    this.people = list;
    // (drawn again at the next look, though the player has not moved)
    this.last.x = 1e9;
  }

  /** what stands about the world now, as this map has been told it: the sheet opened large (bigmap.ts) shows the same */
  get live() {
    return { jeeps: this.jeeps, wells: this.wells, traders: this.traders, drops: this.drops, pings: this.pings };
  }

  /**
   * the square (the map as it was, where everybody starts) as it was drawn once: for the menu's map sheet, which
   * shows the same picture. The ground west of it is ground only as yet (2026-10-16).
   */
  poster(): HTMLCanvasElement {
    if (this.square) return this.square;
    const c = (this.square = document.createElement('canvas'));
    c.width = c.height = Math.round(2 * SQUARE_HALF * SCALE);
    c.getContext('2d')!.drawImage(this.base, (-SQUARE_HALF - WORLD_X0) * SCALE, (-SQUARE_HALF - WORLD_Z0) * SCALE, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }
  private square: HTMLCanvasElement | null = null;

  /** the whole map, drawn once */
  private draw(world: World): HTMLCanvasElement {
    const NW = Math.round((WORLD_X1 - WORLD_X0) * SCALE), NH = Math.round((WORLD_Z1 - WORLD_Z0) * SCALE);
    const c = document.createElement('canvas');
    c.width = NW;
    c.height = NH;
    const g = c.getContext('2d')!;
    // the ground: lighter where it is high, shaded on the slopes that face away from the light; the sea blue, darker
    // where it is deeper
    const img = g.createImageData(NW, NH);
    const H = world.heights, per = SCALE * CELL;
    const at = (px: number, py: number) => {
      const gx = Math.min(WORLD_NX - 1, Math.max(0, Math.round(px / per))), gz = Math.min(WORLD_NZ - 1, Math.max(0, Math.round(py / per)));
      return H[gz * WORLD_NX + gx];
    };
    // (how high and low the ground goes, read over the square, so that its colours are what they were before the
    // world grew west)
    let lo = 1e9, hi = -1e9;
    const ox = (-SQUARE_HALF - WORLD_X0) / CELL, oz = (-SQUARE_HALF - WORLD_Z0) / CELL, side = (2 * SQUARE_HALF) / CELL + 1;
    for (let i = 0; i < side * side; i += 7) {
      const h = H[(oz + Math.floor(i / side)) * WORLD_NX + ox + (i % side)];
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    for (let y = 0; y < NH; y++) {
      for (let x = 0; x < NW; x++) {
        const h = at(x, y);
        const i = (y * NW + x) * 4;
        if (h < SEA_LEVEL) {
          const deep = clamp((SEA_LEVEL - h) / 25, 0, 1);
          img.data[i] = 64 - deep * 34;
          img.data[i + 1] = 104 - deep * 44;
          img.data[i + 2] = 118 - deep * 30;
          img.data[i + 3] = 255;
          continue;
        }
        const k = clamp((h - lo) / Math.max(1, hi - lo), 0, 1);
        const shade = clamp(0.5 + (at(x + 2, y + 2) - at(x - 2, y - 2)) * -0.06, 0.25, 0.85);
        // (the desert of the west sand-coloured, its rock red: World.sand)
        const sand = world.sand ? world.sand[(Math.min(WORLD_NZ - 1, Math.max(0, Math.round(y / per))) * WORLD_NX + Math.min(WORLD_NX - 1, Math.max(0, Math.round(x / per)))) * 4] / 255 : 0;
        const lit = 0.55 + shade * 0.8;
        // (in the big map's colours, 2026-10-17: deep green country, olive up the hills, golden sand, the canyon's red
        // where the desert is steep, snow on the peaks)
        const steep = Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1));
        let r = (74 + k * 58) * (1 - sand) + 214 * sand, gg = (118 + k * 22) * (1 - sand) + 172 * sand, b = (50 + k * 26) * (1 - sand) + 104 * sand;
        if (sand > 0.3 && steep > 6 * per) [r, gg, b] = [r + (168 - r) * 0.7, gg + (80 - gg) * 0.7, b + (48 - b) * 0.7];
        if (h > 132) [r, gg, b] = [r + (234 - r) * clamp((h - 132) / 12, 0, 1), gg + (237 - gg) * clamp((h - 132) / 12, 0, 1), b + (240 - b) * clamp((h - 132) / 12, 0, 1)];
        img.data[i] = r * lit;
        img.data[i + 1] = gg * lit;
        img.data[i + 2] = b * lit;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const X = (wx: number) => (wx - WORLD_X0) * SCALE, Y = (wz: number) => (wz - WORLD_Z0) * SCALE;
    // forest
    g.fillStyle = 'rgba(24, 44, 22, 0.5)';
    for (const t of world.trees) {
      if (t.kind.startsWith('bush')) continue;
      g.beginPath();
      g.arc(X(t.x), Y(t.z), 2.4 * SCALE, 0, Math.PI * 2);
      g.fill();
    }
    // the road
    g.lineJoin = g.lineCap = 'round';
    for (const road of [world.road, ...world.roads]) {
    const pts = road.points;
    for (const [w, col] of [[road.width + 3, 'rgba(20, 20, 18, 0.55)'], [road.width, '#9a9486']] as [number, string][]) {
      g.strokeStyle = col;
      g.lineWidth = w * SCALE;
      g.beginPath();
      for (let i = 0; i < pts.length; i += 3) {
        if (i === 0) g.moveTo(X(pts[i]), Y(pts[i + 2]));
        else g.lineTo(X(pts[i]), Y(pts[i + 2]));
      }
      g.stroke();
    }
    }
    // buildings: their real footprints, the police station picked out
    for (const b of world.buildings) {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      g.save();
      g.translate(X(b.x), Y(b.z));
      g.rotate(-b.rot);
      g.fillStyle = 'rgba(0, 0, 0, 0.5)';
      g.fillRect((-w / 2 - 1) * SCALE, (-d / 2 - 1) * SCALE, (w + 2) * SCALE, (d + 2) * SCALE);
      g.fillStyle = b.type === 'police' || b.type === 'police_hq' ? '#6f9bd6' : b.type === 'guardpost' || b.type === 'barracks' || b.type === 'tower' ? '#b9a26a' : b.type === 'clinic' || b.type === 'hospital' ? '#d99a92' : '#d6c9a8';
      g.fillRect((-w / 2) * SCALE, (-d / 2) * SCALE, w * SCALE, d * SCALE);
      g.restore();
    }
    // where the map ends: one line round the valley and all that has been added to it, and a glow of its colour
    // along the inside of it, so that the little of it the corner shows still says which side is in. (It was a
    // dashed arc for each round: "i dont like the segmented circles". The sheet opened large draws the same line.)
    g.beginPath();
    // (no line while the Zona voids nothing: ZONA_VOID, off until there are bases)
    for (const ring of ZONA_VOID ? playEdge() : []) {
      g.moveTo(X(ring[0].x), Y(ring[0].z));
      for (let i = 1; i < ring.length - 1; i++) g.lineTo(X(ring[i].x), Y(ring[i].z));
      g.closePath();
    }
    g.save();
    g.clip('evenodd');
    g.strokeStyle = 'rgba(240, 220, 160, 0.04)';
    for (let k = 1; k <= 6; k++) {
      g.lineWidth = k * 4 * SCALE;
      g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(240, 220, 160, 0.75)';
    g.lineWidth = 1.5 * SCALE;
    g.stroke();
    // the chimney and the tanks of the works
    g.fillStyle = '#8f8a7c';
    for (const s of world.solids) {
      g.beginPath();
      g.arc(X(s.x), Y(s.z), Math.max(1.2, s.r) * SCALE, 0, Math.PI * 2);
      g.fill();
    }
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

  /**
   * Every vehicle nobody is in, whatever its game is doing with it (an admin's, one left rolling, a helicopter): where
   * to go to find one (the owner, 2026-10-18: "we need to mark all vehicles on the map even admin spawned ones"). One
   * that somebody is in is not shown, the map being no way of following people; but to an admin it is (the owner:
   * "maintain whatever functionality we currently have. admin can see all obviously").
   */
  setJeeps(at: { x: number; z: number; k?: number }[]) {
    const key = at.map((j) => `${Math.round(j.x)},${Math.round(j.z)},${j.k ?? 0}`).join(';');
    if (key === this.jeepKey) return;
    this.jeepKey = key;
    this.jeeps = at;
    this.last.x = 1e9;
  }

  /** Where a trader stands: a coin on the map, always. */
  setTraders(at: { x: number; z: number }[]) {
    this.traders = at;
    this.last.x = 1e9;
  }

  /** Where the wells are: a drop of water on the map, always. */
  setWells(at: { x: number; z: number }[]) {
    this.wells = at;
    this.last.x = 1e9;
  }

  /** Supply drops, marked for as long as they stand. */
  setDrops(at: { x: number; z: number }[]) {
    this.drops = at;
    // drawn again at the next update, wherever the player is
    this.last.x = 1e9;
  }

  private drawnAt = 0;

  /** @param yaw the way the player faces, radians (0 = north, turning left is positive) */
  update(x: number, z: number, yaw: number) {
    const l = this.last;
    const now = performance.now() / 1000;
    if (this.pings.length && now - this.pings[0].at > PING_LIFE) this.pings = [];
    const live = this.pings.length > 0 || now - this.marked < PING_LIFE + 0.2;
    this.root.classList.toggle('marked', now - this.marked < PING_LIFE);
    // redrawn only when something on it has moved a pixel's worth (or a mark is pulsing)
    if (!live && Math.abs(l.x - x) < 0.35 && Math.abs(l.z - z) < 0.35 && Math.abs(l.yaw - yaw) < 0.012 && l.big === this.big && l.pin === bookmarkRev()) return;
    // (and no more than thirty times a second: flying or turning it was drawn and sent to the card every frame, 2026-10-18)
    if (l.big === this.big && now - this.drawnAt < 1 / 30) return;
    this.drawnAt = now;
    l.x = x;
    l.z = z;
    l.yaw = yaw;
    l.big = this.big;
    l.pin = bookmarkRev();
    const g = this.ctx, W = this.view.width;
    const span = this.big ? Math.max(WORLD_X1 - WORLD_X0, WORLD_Z1 - WORLD_Z0) : SPAN;
    const k = W / span;
    // the middle of the picture: you, or (opened large) the middle of the map
    const cx = this.big ? (WORLD_X0 + WORLD_X1) / 2 : x, cz = this.big ? (WORLD_Z0 + WORLD_Z1) / 2 : z;
    // (what is beyond the map's edge: the grey of the mountains that close it, not black. The fort stands sixty
    // metres from the east edge, and half of this was a black hole there.)
    g.fillStyle = '#6b685d';
    g.fillRect(0, 0, W, W);
    const sx = (cx - span / 2 - WORLD_X0) * SCALE, sz = (cz - span / 2 - WORLD_Z0) * SCALE;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, sx, sz, span * SCALE, span * SCALE, 0, 0, W, W);
    const px = (x - cx + span / 2) * k, pz = (z - cz + span / 2) * k;
    // the gas: the ground it lies on, hatched round
    for (const gas of this.gases) {
      const qx = (gas.x - cx + span / 2) * k, qz = (gas.z - cz + span / 2) * k, qr = gas.r * k;
      if (qx > -qr && qz > -qr && qx < W + qr && qz < W + qr) {
        g.save();
        g.beginPath();
        g.arc(qx, qz, qr, 0, Math.PI * 2);
        g.fillStyle = 'rgba(178, 198, 52, 0.26)';
        g.fill();
        g.setLineDash([W / 80, W / 120]);
        g.lineWidth = Math.max(1.5, W / 380);
        g.strokeStyle = 'rgba(218, 236, 98, 0.92)';
        g.stroke();
        g.restore();
        if (this.big) {
          g.font = `700 ${Math.round(W / 66)}px 'Barlow Condensed', 'Bahnschrift', sans-serif`;
          g.textAlign = 'center';
          g.fillStyle = 'rgba(0, 0, 0, 0.7)';
          g.fillText('GAS · MASK NEEDED', qx + 1, qz + W / 38 + 1);
          g.fillStyle = '#e4f07a';
          g.fillText('GAS · MASK NEEDED', qx, qz + W / 38);
        }
      }
    }
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
    // vehicles nobody is in (vehicleMark)
    for (const j of this.jeeps) {
      const qx = (j.x - cx + span / 2) * k, qz = (j.z - cz + span / 2) * k;
      if (qx < 0 || qz < 0 || qx > W || qz > W) continue;
      const h = this.big ? W / 150 : W / 32;
      vehicleMark(g, qx, qz, h, j.k, 'rgba(0, 0, 0, 0.9)', Math.max(1.2, h * 0.3));
    }
    // a well: a drop of water
    for (const t of this.wells) {
      const qx = (t.x - cx + span / 2) * k, qz = (t.z - cz + span / 2) * k;
      if (qx < 0 || qz < 0 || qx > W || qz > W) continue;
      const r = this.big ? W / 110 : W / 26;
      g.beginPath();
      g.moveTo(qx, qz - r * 1.5);
      g.bezierCurveTo(qx + r * 1.3, qz - r * 0.1, qx + r, qz + r, qx, qz + r);
      g.bezierCurveTo(qx - r, qz + r, qx - r * 1.3, qz - r * 0.1, qx, qz - r * 1.5);
      g.fillStyle = '#6fb6e6';
      g.fill();
      g.lineWidth = Math.max(1.2, r * 0.3);
      g.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      g.stroke();
    }
    // the trader: a coin, where he stands
    for (const t of this.traders) {
      const qx = (t.x - cx + span / 2) * k, qz = (t.z - cz + span / 2) * k;
      if (qx < 0 || qz < 0 || qx > W || qz > W) continue;
      const r = this.big ? W / 95 : W / 22;
      g.beginPath();
      g.arc(qx, qz, r, 0, Math.PI * 2);
      g.fillStyle = '#7fd4a0';
      g.fill();
      g.lineWidth = Math.max(1.5, r * 0.3);
      g.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      g.stroke();
      g.beginPath();
      g.arc(qx, qz, r * 0.45, 0, Math.PI * 2);
      g.lineWidth = Math.max(1, r * 0.24);
      g.strokeStyle = '#17402a';
      g.stroke();
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
    // everybody else, for an admin with names on (the owner, 2026-10-16: "for admins the minimap preview should show
    // other players if nametags toggle is on, currently only shows in the main map"): a dot each, the dead grey
    for (const q of this.people) {
      const qx = (q.x - cx + span / 2) * k, qz = (q.z - cz + span / 2) * k;
      if (qx < 0 || qz < 0 || qx > W || qz > W) continue;
      const r = this.big ? W / 140 : W / 40;
      g.beginPath();
      g.arc(qx, qz, r, 0, Math.PI * 2);
      g.fillStyle = q.dead ? '#8a8a82' : '#4f8fff';
      g.fill();
      g.lineWidth = Math.max(1, r * 0.35);
      g.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      g.stroke();
      if (this.big) {
        g.font = `600 ${Math.round(W / 75)}px 'Barlow Condensed', 'Bahnschrift', sans-serif`;
        g.textAlign = 'center';
        g.fillStyle = 'rgba(0, 0, 0, 0.7)';
        g.fillText(q.name, qx + 1, qz - r * 1.6 + 1);
        g.fillStyle = '#dfe8ff';
        g.fillText(q.name, qx, qz - r * 1.6);
      }
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
    // the player's own bookmark (bookmark.ts), in the player's own yellow: in view, a pin where it is and how far;
    // out of it, an arrow outside the ring the way to go, the distance just inside (see `pointTo`)
    const pin = bookmark();
    let out = false;
    if (pin) {
      const qx = (pin.x - cx + span / 2) * k, qz = (pin.z - cz + span / 2) * k, r = this.big ? W / 110 : W / 30;
      const far = distanceText(Math.hypot(pin.x - x, pin.z - z)), fs = this.big ? W / 70 : W / 13;
      // (out of view is when the pin's head would touch the ring, which stands above the place it marks)
      out = !this.big && Math.hypot(qx - W / 2, qz - r * 1.9 - W / 2) > W / 2 - r * 1.4;
      if (out) this.pointTo(qx - W / 2, qz - W / 2, far);
      else {
        drawPin(g, qx, qz, r, { fill: '#ffd35a', edge: 'rgba(0, 0, 0, 0.85)' });
        drawLabel(g, far, qx, qz + fs * 1.05, fs);
      }
    }
    this.pinOff.hidden = !out;
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

  /** the arrow outside the ring, set the way (dx, dz) points from the middle, and the distance inside the ring by it */
  private pointTo(dx: number, dz: number, far: string) {
    const a = Math.atan2(dz, dx), R = this.root.clientWidth / 2;
    const at = (rad: number) => `left:calc(50% + ${(Math.cos(a) * rad).toFixed(1)}px);top:calc(50% + ${(Math.sin(a) * rad).toFixed(1)}px)`;
    const svg = this.pinOff.firstElementChild as SVGElement, em = this.pinOff.lastElementChild as HTMLElement;
    svg.setAttribute('style', `${at(R + 9)};transform:translate(-50%,-50%) rotate(${(a + Math.PI / 2).toFixed(3)}rad)`);
    em.setAttribute('style', at(R - 22));
    em.textContent = far;
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
