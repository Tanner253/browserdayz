// The squad's map: a poster. The valley as a printed survey sheet, lying on a table, written
// over by the people who mean to get into Bunker 17 with it, and what they had on the table
// that night. Not part of the built site (poster.html is not in the build).
//
//   /poster.html                      1920 x 1080, with the name on it
//   /poster.html?w=3840&h=2160        the size it is kept at (scripts/poster.mjs photographs it)
//   &title=0                          the picture alone
//   &film=1                           the table filmed: a camera goes over the sheet, cut to a score, the name at the end
//                                     (an MP4, sent to the receiver as `post` names it)
//   &film=menu                        the same passes with nothing over them and no sound, for the game's menu
//   &post=name                        sends the picture to the receiver on 5199 (for looking at while working;
//                                     &fmt=png sends it whole, for keeping)
//
// The sheet is drawn from the game's own world (the same heights, trees, road and buildings
// the map in the game is drawn from), so every place on it is where it is in the game. What
// is written on it is half the rules of the game (they are true: where the masks are, what
// the keycard does, how far a shot carries) and half a story.
// The things on the table are the game's own models; the hand is cut from one of the infected.
// The bottles, their caps and the cigarettes are turned shapes made here (the game has none).

import * as THREE from 'three';
import { assets } from '../core/assets';
import { proceduralParts } from '../game/procedural';
import { BUILDING_FOOTPRINT, WORLD_SIZE, generateWorld, heightAt, playOutline, type World } from '../world/worldgen';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') ?? 1920), H = +(q.get('h') ?? 1080);
const TITLE = q.get('title') !== '0';
const num = (k: string, d: number) => (q.has(k) ? +q.get(k)! : d);

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
type G = CanvasRenderingContext2D;
const sheetOf = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

// ------------------------------------------------------------------ the sheet

/** the sheet in pixels; the valley printed on it from (OX, OY), N across: three pixels to the metre */
const PW = 3400, PH = 3560, OX = 164, OY = 150, N = 3072, S = N / WORLD_SIZE;
const X = (wx: number) => OX + (wx + WORLD_SIZE / 2) * S, Y = (wz: number) => OY + (wz + WORLD_SIZE / 2) * S;
/** the sheet on the table, metres */
const PAPER_W = 0.95, PAPER_H = (PAPER_W * PH) / PW, PAPER_YAW = 0.045;

const INK = '#23201b', BLUE = '#1e3a78', RED = '#a8241c', GREEN = '#23893a', PENCIL = '#4a4a4a';
const TYPE = '"Special Elite", "Courier New", monospace';
const MARKER = '"Permanent Marker", "Segoe Print", cursive', ROUGH = '"Rock Salt", "Segoe Print", cursive';
const PEN = '"Reenie Beanie", "Ink Free", cursive';

function printSheet(world: World): HTMLCanvasElement {
  const c = sheetOf(PW, PH), g = c.getContext('2d')!;
  const rnd = rng(1717);
  g.fillStyle = '#d8cfb4';
  g.fillRect(0, 0, PW, PH);
  // ---- the ground: tinted by its height, shaded as if lit from the north-west, with a line every five metres up
  const R = 1024, hs = new Float32Array(R * R);
  let lo = 1e9, hi = -1e9;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    const h = heightAt(world.surface, -WORLD_SIZE / 2 + x + 0.5, -WORLD_SIZE / 2 + y + 0.5);
    hs[y * R + x] = h;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const img = new ImageData(R, R);
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    const i = y * R + x, h = hs[i], x1 = Math.min(R - 1, x + 1), y1 = Math.min(R - 1, y + 1);
    const k = clamp((h - lo) / (hi - lo), 0, 1);
    const s = clamp(0.5 - (hs[y1 * R + x1] - hs[Math.max(0, y - 1) * R + Math.max(0, x - 1)]) * 0.055, 0.1, 0.95);
    const m = 0.7 + 0.46 * s;
    let r = lerp(198, 226, k) * m, gg = lerp(206, 203, k) * m, b = lerp(170, 152, k) * m;
    const c5 = Math.floor(h / 5), right = Math.floor(hs[y * R + x1] / 5), down = Math.floor(hs[y1 * R + x] / 5);
    if (c5 !== right || c5 !== down) {
      const t = Math.max(c5, right, down) % 5 === 0 ? 0.66 : 0.36;
      r = lerp(r, 124, t);
      gg = lerp(gg, 86, t);
      b = lerp(b, 52, t);
    }
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  const relief = sheetOf(R, R);
  relief.getContext('2d')!.putImageData(img, 0, 0);
  g.imageSmoothingQuality = 'high';
  g.drawImage(relief, OX, OY, N, N);
  // ---- woods: a green wash, a mark for every tree
  g.save();
  g.beginPath();
  g.rect(OX, OY, N, N);
  g.clip();
  for (const t of world.trees) {
    if (t.kind.startsWith('bush')) continue;
    g.fillStyle = 'rgba(74, 112, 62, 0.15)';
    g.beginPath();
    g.arc(X(t.x), Y(t.z), 3.3 * S, 0, 7);
    g.fill();
  }
  g.fillStyle = 'rgba(40, 70, 38, 0.42)';
  for (const t of world.trees) {
    if (t.kind.startsWith('bush')) continue;
    g.beginPath();
    g.arc(X(t.x), Y(t.z), 0.75 * S, 0, 7);
    g.fill();
  }
  // ---- the road
  const pts = world.road.points;
  g.lineJoin = g.lineCap = 'round';
  for (const [w, col] of [[world.road.width + 2.6, '#6e3526'], [world.road.width - 0.4, '#e6d2a4']] as [number, string][]) {
    g.strokeStyle = col;
    g.lineWidth = w * S;
    g.beginPath();
    for (let i = 0; i < pts.length; i += 3) (i ? g.lineTo : g.moveTo).call(g, X(pts[i]), Y(pts[i + 2]));
    g.stroke();
  }
  // ---- buildings, black as they are printed; the works' tanks and chimney
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
    g.arc(X(s.x), Y(s.z), Math.max(1.4, s.r) * S, 0, 7);
    g.fill();
  }
  // ---- the grid, a hundred metres to the square
  g.strokeStyle = 'rgba(34, 52, 104, 0.33)';
  g.lineWidth = 1.6;
  for (let i = 0; i <= 10; i++) {
    const p = -500 + i * 100;
    g.beginPath();
    g.moveTo(X(p), OY);
    g.lineTo(X(p), OY + N);
    g.moveTo(OX, Y(p));
    g.lineTo(OX + N, Y(p));
    g.stroke();
  }
  // ---- where the valley was shut: the line nobody crosses
  g.strokeStyle = 'rgba(160, 36, 28, 0.85)';
  g.lineWidth = 6;
  g.setLineDash([30, 14, 6, 14]);
  for (const a of playOutline()) {
    g.beginPath();
    g.arc(X(a.x), Y(a.z), a.r * S, a.from, a.to);
    g.stroke();
  }
  g.setLineDash([]);
  g.restore();
  // ---- the frame and what is printed round it
  g.strokeStyle = INK;
  g.lineWidth = 5;
  g.strokeRect(OX, OY, N, N);
  g.lineWidth = 1.5;
  g.strokeRect(OX - 16, OY - 16, N + 32, N + 32);
  const type = (text: string, x: number, y: number, size: number, o: { align?: CanvasTextAlign; color?: string; gap?: number; alpha?: number; font?: string } = {}) => {
    g.save();
    g.font = `${size}px ${o.font ?? TYPE}`;
    g.textAlign = o.align ?? 'center';
    g.textBaseline = 'middle';
    (g as unknown as { letterSpacing: string }).letterSpacing = `${o.gap ?? 0}px`;
    g.globalAlpha = o.alpha ?? 0.9;
    g.fillStyle = o.color ?? INK;
    g.fillText(text, x, y);
    g.restore();
  };
  for (let i = 0; i < 10; i++) {
    type(String(62 + i), X(-450 + i * 100), OY - 50, 34, { color: '#223468' });
    type(String(41 - i), OX - 62, Y(-450 + i * 100), 34, { color: '#223468' });
    type(String(62 + i), X(-450 + i * 100), OY + N + 46, 34, { color: '#223468' });
    type(String(41 - i), OX + N + 62, Y(-450 + i * 100), 34, { color: '#223468' });
  }
  // the places: a halo of bare paper under each name, as a printer leaves
  const place = (text: string, wx: number, wz: number, size: number, gap = 3) => {
    g.save();
    g.font = `${size}px ${TYPE}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    (g as unknown as { letterSpacing: string }).letterSpacing = `${gap}px`;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(222, 213, 186, 0.78)';
    g.lineWidth = size * 0.3;
    g.strokeText(text, X(wx), Y(wz));
    g.fillStyle = INK;
    g.globalAlpha = 0.93;
    g.fillText(text, X(wx), Y(wz));
    g.restore();
  };
  const P = (name: string) => world.pois.find((p) => p.name === name)!;
  for (const p of world.pois) {
    if (p.name === 'Bunker 17') continue; // (no printer ever set that name on a sheet: it is written on by hand)
    if (p.name === 'Zelenaya Dolina') place('ZELENAYA DOLINA', p.x - 4, p.z - 96, 66, 8);
    else if (p.name === 'Military Checkpoint') place('MILITARY CHECKPOINT', p.x - 18, p.z + 52, 46, 5);
    else if (p.name === 'Chemical Works') place('CHEMICAL WORKS', p.x + 6, p.z + 112, 50, 6);
    else place(p.name, p.x, p.z + 30, 31, 1);
  }
  type('QUARANTINE LINE  ·  NO EXIT', X(0), Y(-416), 34, { color: '#9c231b', gap: 10 });
  type('QUARANTINE LINE  ·  NO EXIT', X(96), Y(418), 34, { color: '#9c231b', gap: 10 });
  // the foot of the sheet
  const fy = OY + N + 150;
  type('ZELENAYA DOLINA VALLEY', OX, fy, 74, { align: 'left', gap: 6 });
  type('GENERAL STAFF SURVEY   SHEET Z-17   1 : 1000', OX, fy + 78, 38, { align: 'left', gap: 2 });
  type('CONTOURS AT 5 m    GRID 100 m    QUARANTINE EDITION, CORRECTED BY HAND', OX, fy + 132, 30, { align: 'left', gap: 1, alpha: 0.8 });
  // a bar of two hundred metres
  const bx = OX + N - 760, by = fy + 30;
  g.fillStyle = INK;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#d8cfb4' : INK;
    g.fillRect(bx + i * 50 * S, by, 50 * S, 16);
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.strokeRect(bx + i * 50 * S, by, 50 * S, 16);
  }
  type('0', bx, by - 24, 30);
  type('100', bx + 100 * S, by - 24, 30);
  type('200 m', bx + 200 * S, by - 24, 30);
  // north
  g.save();
  g.translate(OX + N - 110, fy + 84);
  g.strokeStyle = g.fillStyle = INK;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, 52);
  g.lineTo(0, -52);
  g.stroke();
  g.beginPath();
  g.moveTo(0, -72);
  g.lineTo(-17, -30);
  g.lineTo(17, -30);
  g.fill();
  g.restore();
  type('N', OX + N - 110, fy + 160, 40);
  // the stamp
  g.save();
  g.translate(OX + 470, OY + 190);
  g.rotate(-0.12);
  g.globalAlpha = 0.62;
  g.strokeStyle = g.fillStyle = '#a3251c';
  g.lineWidth = 9;
  g.strokeRect(-330, -74, 660, 148);
  g.lineWidth = 3;
  g.strokeRect(-314, -58, 628, 116);
  g.font = `700 104px "Stardos Stencil", ${TYPE}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  (g as unknown as { letterSpacing: string }).letterSpacing = '12px';
  g.fillText('RESTRICTED', 6, 8);
  g.restore();
  // (the stamp was not pressed evenly)
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.restore();
  void rnd;
  void P;
  return c;
}

// ------------------------------------------------------------------ what was written on it

interface Ink { color: string; width: number; alpha?: number; wob?: number }

/** a line drawn by hand through these points: not straight, not even, and gone over where the pen dragged */
function line(g: G, rnd: () => number, pts: [number, number][], o: Ink, closed = false) {
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = o.color;
  for (let pass = 0; pass < 2; pass++) {
    const wob = (o.wob ?? o.width * 0.35) * (pass ? 0.6 : 1);
    const p = pts.map(([x, y]) => [x + (rnd() - 0.5) * 2 * wob, y + (rnd() - 0.5) * 2 * wob] as [number, number]);
    g.globalAlpha = (o.alpha ?? 0.85) * (pass ? 0.45 : 1);
    g.lineWidth = o.width * (pass ? 0.7 : 1);
    g.beginPath();
    g.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length - 1; i++) g.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    const end = p[p.length - 1];
    g.lineTo(end[0], end[1]);
    if (closed) g.closePath();
    g.stroke();
  }
  g.restore();
}

/** a ring drawn round something, the hand going round more than once */
function ring(g: G, rnd: () => number, cx: number, cy: number, r: number, o: Ink, turns = 1.25, squash = 1) {
  const pts: [number, number][] = [];
  const a0 = rnd() * 6.28, n = Math.round(26 * turns);
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * turns * 6.283, rr = r * (1 + (i / n - 0.5) * 0.12 + (rnd() - 0.5) * 0.05);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * squash]);
  }
  line(g, rnd, pts, o);
}

/** an arrow: a line through the points, and a head on the last of them */
function arrow(g: G, rnd: () => number, pts: [number, number][], o: Ink, head = 5) {
  line(g, rnd, pts, o);
  const [ax, ay] = pts[pts.length - 2], [bx, by] = pts[pts.length - 1];
  const a = Math.atan2(by - ay, bx - ax), L = o.width * head;
  for (const s of [-1, 1]) line(g, rnd, [[bx, by], [bx - Math.cos(a + s * 0.5) * L * 0.6, by - Math.sin(a + s * 0.5) * L * 0.6], [bx - Math.cos(a + s * 0.48) * L, by - Math.sin(a + s * 0.48) * L]], o);
}

/**
 * Words written by hand: every letter a little off the line and a little turned.
 * @returns how wide they came out
 */
function hand(g: G, rnd: () => number, text: string, x: number, y: number, o: { font: string; size: number; color: string; rot?: number; alpha?: number; align?: 'left' | 'center'; bold?: boolean; under?: number }) {
  g.save();
  g.translate(x, y);
  g.rotate((o.rot ?? 0) + (rnd() - 0.5) * 0.012);
  g.globalCompositeOperation = 'multiply';
  g.font = `${o.bold ? '700 ' : ''}${o.size}px ${o.font}`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = o.color;
  const wide = g.measureText(text).width;
  let cx = o.align === 'center' ? -wide / 2 : 0;
  for (const ch of text) {
    const w = g.measureText(ch).width;
    g.save();
    g.translate(cx + w / 2, (rnd() - 0.5) * o.size * 0.07);
    g.rotate((rnd() - 0.5) * 0.07);
    const k = 1 + (rnd() - 0.5) * 0.08;
    g.scale(k, k);
    g.globalAlpha = (o.alpha ?? 0.88) * (0.82 + rnd() * 0.18);
    g.fillText(ch, -w / 2, 0);
    g.restore();
    cx += w;
  }
  g.restore();
  for (let u = 0; u < (o.under ?? 0); u++) {
    const c = Math.cos(o.rot ?? 0), s = Math.sin(o.rot ?? 0), x0 = o.align === 'center' ? -wide / 2 : 0, yy = o.size * (0.16 + u * 0.13);
    line(g, rnd, [[x + x0 * c - yy * s, y + x0 * s + yy * c], [x + (x0 + wide / 2) * c - (yy + 4) * s, y + (x0 + wide / 2) * s + (yy + 4) * c], [x + (x0 + wide) * c - yy * s, y + (x0 + wide) * s + yy * c]], { color: o.color, width: o.size * 0.07, alpha: o.alpha ?? 0.85 });
  }
  return wide;
}

/** where the gas lies, from the game's own measure of it */
const GAS = { x: -368, z: 368, r: 96 };

function writeOn(c: HTMLCanvasElement, world: World) {
  const g = c.getContext('2d')!, rnd = rng(4099);
  const P = (name: string) => world.pois.find((p) => p.name === name)!;
  const bunker = P('Bunker 17'), town = P('Zelenaya Dolina'), post = P('Military Checkpoint');
  const police = world.buildings.find((b) => b.type === 'police')!;
  const red = (w: number): Ink => ({ color: RED, width: w, alpha: 0.86 });
  const marker = (text: string, wx: number, wz: number, size: number, o: { rot?: number; color?: string; under?: number; align?: 'left' | 'center'; font?: string } = {}) => hand(g, rnd, text, X(wx), Y(wz), { font: o.font ?? MARKER, size, color: o.color ?? RED, rot: o.rot, under: o.under, align: o.align });
  const pen = (text: string, wx: number, wz: number, size = 64, o: { rot?: number; color?: string; under?: number; font?: string; align?: 'left' | 'center' } = {}) => hand(g, rnd, text, X(wx), Y(wz), { font: o.font ?? PEN, size, color: o.color ?? BLUE, rot: o.rot, under: o.under, align: o.align, alpha: 0.9 });

  // ---- the gas: hatched in over the works with a highlighter, and a skull by it
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.beginPath();
  g.arc(X(GAS.x), Y(GAS.z), GAS.r * S, 0, 7);
  g.clip();
  g.strokeStyle = 'rgba(214, 196, 40, 0.5)';
  g.lineWidth = 15;
  g.lineCap = 'round';
  for (let d = -GAS.r * 2; d < GAS.r * 2; d += 13) {
    g.beginPath();
    g.moveTo(X(GAS.x + d - 100) + rnd() * 8, Y(GAS.z + 100));
    g.lineTo(X(GAS.x + d + 100) + rnd() * 8, Y(GAS.z - 100));
    g.stroke();
  }
  g.restore();
  ring(g, rnd, X(GAS.x), Y(GAS.z), GAS.r * S, { color: '#8a7a10', width: 7, alpha: 0.8 }, 1.1);
  marker('GAS', GAS.x - 62, GAS.z - 34, 150, { rot: -0.08 });
  // a skull, as anybody draws one
  {
    const sx = X(GAS.x + 58), sy = Y(GAS.z - 46);
    ring(g, rnd, sx, sy, 40, red(7), 1.1, 0.92);
    line(g, rnd, [[sx - 24, sy + 34], [sx - 22, sy + 62], [sx + 22, sy + 62], [sx + 24, sy + 34]], red(7));
    for (const dx of [-8, 8]) line(g, rnd, [[sx + dx, sy + 44], [sx + dx, sy + 62]], red(4));
    for (const dx of [-15, 15]) ring(g, rnd, sx + dx, sy - 2, 9, red(8), 1.4);
  }
  marker('NO MASK = DEAD', GAS.x - 132, GAS.z - 122, 62, { rot: -0.05, under: 1 });
  marker('KEYCARD', GAS.x + 112, GAS.z - 44, 84, { color: BLUE, rot: -0.03, under: 1 });
  arrow(g, rnd, [[X(GAS.x + 108), Y(GAS.z - 52)], [X(GAS.x + 92), Y(GAS.z - 40)], [X(GAS.x + 74), Y(GAS.z - 14)]], { color: BLUE, width: 7 });
  pen('is in the gas. so are the suits', GAS.x + 114, GAS.z - 18, 62, { rot: -0.03 });
  pen('(orange. they do not need air)', GAS.x + 116, GAS.z + 5, 54, { rot: -0.03, color: INK });

  // ---- the town and the police station
  ring(g, rnd, X(police.x), Y(police.z), 15 * S, { color: BLUE, width: 6 }, 1.3);
  arrow(g, rnd, [[X(police.x - 96), Y(police.z + 36)], [X(police.x - 56), Y(police.z + 34)], [X(police.x - 19), Y(police.z + 10)]], { color: BLUE, width: 5 });
  pen('GAS MASKS — police stn', police.x - 268, police.z + 40, 70, { rot: 0.02, under: 1 });
  pen('1 each. go in quiet.', police.x - 256, police.z + 65, 58, { rot: 0.02 });
  pen('a shot carries 125 m', -396, -52, 60, { color: INK, rot: -0.04 });
  pen('and then they ALL come', -390, -28, 60, { color: INK, rot: -0.04 });

  // ---- the checkpoint
  ring(g, rnd, X(post.x), Y(post.z), 34 * S, { color: BLUE, width: 5 }, 1.2, 0.8);
  pen('rifles, plates, helmets', post.x - 84, post.z - 55, 60, { rot: -0.03 });
  pen('TOWER: somebody is always up it', post.x - 96, post.z - 33, 52, { rot: -0.03, color: INK });

  // ---- the way: out of the town, round by the east, up to the door
  const way: [number, number][] = [[town.x + 2, town.z + 62], [town.x + 70, town.z + 78], [150, 78], [226, 40], [276, -30], [296, -120], [292, -200], [304, -262]];
  arrow(g, rnd, way.map(([x, z]) => [X(x), Y(z)]), { color: GREEN, width: 20, alpha: 0.74, wob: 5 }, 4.2);
  marker('ON FOOT', 168, 122, 70, { color: GREEN, rot: -0.2 });
  pen('the card will not ride. NO JEEP', 142, 150, 54, { rot: -0.2, color: INK });
  pen('holster up = you run faster', 318, -34, 52, { rot: 1.32, color: INK });
  pen('stay OFF the road', 228, 8, 52, { rot: -0.72 });

  // ---- the bunker
  for (let i = 0; i < 2; i++) ring(g, rnd, X(bunker.x), Y(bunker.z), (27 + i * 5) * S, red(11), 1.3);
  line(g, rnd, [[X(bunker.x - 9), Y(bunker.z - 9)], [X(bunker.x + 9), Y(bunker.z + 9)]], red(12));
  line(g, rnd, [[X(bunker.x + 9), Y(bunker.z - 9)], [X(bunker.x - 9), Y(bunker.z + 9)]], red(12));
  marker('BUNKER 17', bunker.x - 318, bunker.z - 78, 132, { rot: -0.035, under: 2 });
  arrow(g, rnd, [[X(bunker.x - 96), Y(bunker.z - 84)], [X(bunker.x - 58), Y(bunker.z - 74)], [X(bunker.x - 34), Y(bunker.z - 40)]], red(9));
  let ly = bunker.z - 38;
  for (const [t, col] of [
    ['door wants a LVL 1 card — and KEEPS it', BLUE],
    ['1 card = 1 trip down. make it count', BLUE],
    ['no light at all in there. bring lamps', INK],
    ['gas inside too. masks stay ON', INK],
  ] as [string, string][]) {
    pen(t, bunker.x - 330, ly, 60, { rot: -0.02, color: col });
    ly += 24;
  }
  marker('LVL 2 — SEALED', bunker.x - 330, ly + 14, 58, { rot: -0.02 });
  marker('LVL 3 ???', bunker.x - 150, ly + 16, 58, { rot: 0.03 });
  hand(g, rnd, 'the CURE is down there', X(bunker.x - 318), Y(ly + 62), { font: ROUGH, size: 54, color: RED, rot: -0.03, under: 2 });

  // ---- top left, where there is nothing but hill: what they are going on
  let ty = -470;
  const note = (t: string, o: { color?: string; size?: number; font?: string } = {}) => {
    pen(t, -492, ty, o.size ?? 58, { color: o.color ?? INK, font: o.font, rot: 0.012 });
    ty += 25;
  };
  ty = -388;
  note("Volkov's last tape —", { color: BLUE, size: 64 });
  note('“Batch 17 holds. It is under the');
  note(' hill, east of the valley. If you');
  note(' can hear this, it WORKS.”');
  ty += 6;
  hand(g, rnd, 'if he is right, this ENDS', X(-488), Y(ty + 10), { font: ROUGH, size: 44, color: RED, rot: 0.01, under: 1 });
  // the days, counted
  {
    const x0 = X(-486), y0 = Y(ty + 44);
    for (let k = 0; k < 17; k++) {
      const x = x0 + k * 17 + Math.floor(k / 5) * 26;
      if (k % 5 === 4) line(g, rnd, [[x - 78, y0 + 40], [x + 4, y0 + 2]], { color: PENCIL, width: 4, alpha: 0.8 });
      else line(g, rnd, [[x, y0], [x + 3, y0 + 44]], { color: PENCIL, width: 4, alpha: 0.8 });
    }
    hand(g, rnd, 'days', x0 + 410, y0 + 40, { font: PEN, size: 54, color: PENCIL });
  }

  // ---- bottom right: who is going, and what with
  let ky = 344;
  const kx = 332;
  marker('WHO', kx, ky, 64, { color: INK, under: 1 });
  ky += 34;
  for (const [name, gone] of [['Misha', true], ['Anya', true], ['Kostya', false], ['Lev', false], ['me', false]] as [string, boolean][]) {
    const w = pen(name, kx + 4, ky, 60, { color: INK });
    if (gone) line(g, rnd, [[X(kx) - 4, Y(ky) - 14], [X(kx) + w / 2, Y(ky) - 20], [X(kx) + w + 16, Y(ky) - 12]], red(6));
    ky += 23;
  }
  ky = 344;
  const kx2 = 410;
  marker('KIT', kx2, ky, 64, { color: INK, under: 1 });
  ky += 34;
  for (const [what, have] of [['mask', true], ['lamp', true], ['injector x3', true], ['12 ga', true], ['LVL 1 CARD', true]] as [string, boolean][]) {
    const bx = X(kx2), by = Y(ky) - 34, card = what.startsWith('LVL');
    line(g, rnd, [[bx, by], [bx + 30, by + 1], [bx + 31, by + 31], [bx + 1, by + 30], [bx, by]], { color: INK, width: 4 });
    if (have) line(g, rnd, [[bx + 4, by + 14], [bx + 13, by + 27], [bx + 40, by - 12]], { color: card ? RED : BLUE, width: card ? 8 : 6 });
    pen(what, kx2 + 15, ky, card ? 62 : 58, { color: card ? RED : INK });
    ky += 23;
  }
  pen('the card cost us Anya.', kx + 2, 494, 58, { color: INK, rot: -0.02 });
  // ---- across the bottom
  hand(g, rnd, 'TRUST NOBODY AT THE DOOR', X(-214), Y(466), { font: ROUGH, size: 64, color: RED, rot: -0.012, under: 1 });
  pen('whoever opens it is carrying everything they own', -208, 493, 54, { color: INK, rot: -0.012 });
}

/** what years in a pack and one night on a table did to it */
function wear(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!, rnd = rng(77);
  g.save();
  g.globalCompositeOperation = 'multiply';
  // handled, everywhere
  for (let i = 0; i < 46; i++) {
    const x = rnd() * PW, y = rnd() * PH, r = 160 + rnd() * 520;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(128, 104, 70, ${0.05 + rnd() * 0.1})`);
    rg.addColorStop(1, 'rgba(128, 104, 70, 0)');
    g.fillStyle = rg;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // its edges
  for (const [x0, y0, x1, y1] of [[0, 0, 0, 1], [0, 0, 1, 0], [1, 0, -1, 0], [0, 1, 0, -1]] as number[][]) {
    const lg = g.createLinearGradient(x0 * PW, y0 * PH, x0 * PW + x1 * 190, y0 * PH + y1 * 190);
    lg.addColorStop(0, 'rgba(96, 74, 44, 0.5)');
    lg.addColorStop(1, 'rgba(96, 74, 44, 0)');
    g.fillStyle = lg;
    g.fillRect(0, 0, PW, PH);
  }
  // where a bottle stood, more than once
  const stood = (cx: number, cy: number, r: number, a: number) => {
    for (let pass = 0; pass < 3; pass++) {
      g.strokeStyle = `rgba(122, 84, 34, ${a * (0.5 + rnd() * 0.5)})`;
      g.lineWidth = 5 + rnd() * 9;
      g.beginPath();
      const from = rnd() * 6.28;
      g.ellipse(cx + (rnd() - 0.5) * 6, cy + (rnd() - 0.5) * 6, r, r * (0.97 + rnd() * 0.05), 0, from, from + 3.6 + rnd() * 2.6);
      g.stroke();
    }
    const rg = g.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    rg.addColorStop(0, 'rgba(150, 110, 50, 0)');
    rg.addColorStop(1, `rgba(150, 110, 50, ${a * 0.3})`);
    g.fillStyle = rg;
    g.beginPath();
    g.arc(cx, cy, r, 0, 7);
    g.fill();
  };
  stood(X(-250), Y(-210), 112, 0.5);
  stood(X(-214), Y(-190), 112, 0.34);
  stood(X(120), Y(300), 112, 0.42);
  stood(X(-420), Y(60), 112, 0.3);
  // something spilt and wiped
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(120, 86, 40, ${0.1 + rnd() * 0.16})`;
    g.beginPath();
    g.arc(X(-330) + (rnd() - 0.5) * 420, Y(-170) + (rnd() - 0.5) * 260, 4 + rnd() * 20, 0, 7);
    g.fill();
  }
  g.restore();
  // ---- the folds: it was carried folded in nine
  g.save();
  for (const [vertical, at] of [[true, PW / 3], [true, (PW * 2) / 3], [false, PH / 3], [false, (PH * 2) / 3]] as [boolean, number][]) {
    const L = vertical ? PH : PW;
    const path = () => {
      g.beginPath();
      for (let t = 0; t <= L; t += 60) {
        const o = at + (rnd() - 0.5) * 5;
        if (vertical) (t ? g.lineTo : g.moveTo).call(g, o, t);
        else (t ? g.lineTo : g.moveTo).call(g, t, o);
      }
    };
    g.globalCompositeOperation = 'multiply';
    g.strokeStyle = 'rgba(92, 72, 44, 0.3)';
    g.lineWidth = 22;
    g.filter = 'blur(7px)';
    path();
    g.stroke();
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(244, 238, 220, 0.72)';
    g.lineWidth = 3.5;
    path();
    g.stroke();
  }
  // (and where two folds cross, the print is rubbed away)
  for (const x of [PW / 3, (PW * 2) / 3]) for (const y of [PH / 3, (PH * 2) / 3]) {
    const rg = g.createRadialGradient(x, y, 0, x, y, 46);
    rg.addColorStop(0, 'rgba(240, 233, 214, 0.9)');
    rg.addColorStop(1, 'rgba(240, 233, 214, 0)');
    g.fillStyle = rg;
    g.fillRect(x - 46, y - 46, 92, 92);
  }
  g.restore();
}

/** blood on the sheet, under and about the hand: `at` in the sheet's pixels */
function bleed(c: HTMLCanvasElement, at: [number, number], along: number) {
  const g = c.getContext('2d')!, rnd = rng(666);
  g.save();
  g.globalCompositeOperation = 'multiply';
  const [x, y] = at;
  for (let i = 0; i < 7; i++) {
    const r = 40 + rnd() * 80, px = x + (rnd() - 0.5) * 150, py = y + (rnd() - 0.5) * 110;
    const rg = g.createRadialGradient(px, py, r * 0.2, px, py, r);
    rg.addColorStop(0, 'rgba(150, 30, 22, 0.62)');
    rg.addColorStop(0.7, 'rgba(160, 44, 30, 0.42)');
    rg.addColorStop(1, 'rgba(160, 50, 34, 0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(px, py, r, 0, 7);
    g.fill();
  }
  // dragged: it was put down and pushed
  g.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    g.strokeStyle = `rgba(150, 34, 24, ${0.14 + rnd() * 0.3})`;
    g.lineWidth = 5 + rnd() * 20;
    const o = (rnd() - 0.5) * 150, L = 240 + rnd() * 360;
    g.beginPath();
    g.moveTo(x - Math.sin(along) * o, y + Math.cos(along) * o);
    g.lineTo(x + Math.cos(along) * L - Math.sin(along) * o * 0.7, y + Math.sin(along) * L + Math.cos(along) * o * 0.7);
    g.stroke();
  }
  // and what flew off it
  for (let i = 0; i < 90; i++) {
    const a = rnd() * 6.28, d = 150 + rnd() * rnd() * 620, r = 2 + rnd() * rnd() * 16;
    g.fillStyle = `rgba(140, 26, 18, ${0.45 + rnd() * 0.4})`;
    g.beginPath();
    g.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (1 + rnd()), r, a, 0, 7);
    g.fill();
  }
  g.restore();
}

/** where the sheet is not: its edges nibbled, a corner gone, a hole burnt through it */
function holes(burn: [number, number]): HTMLCanvasElement {
  const w = 850, h = Math.round((850 * PH) / PW), c = sheetOf(w, h), g = c.getContext('2d')!, rnd = rng(31);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#000';
  for (let i = 0; i < 70; i++) {
    const t = rnd(), side = Math.floor(rnd() * 4), r = 1 + rnd() * rnd() * rnd() * 16;
    const x = side === 0 ? t * w : side === 1 ? t * w : side === 2 ? 0 : w, y = side === 0 ? 0 : side === 1 ? h : t * h;
    g.beginPath();
    g.ellipse(x, y, r * (0.5 + rnd()), r, rnd() * 3, 0, 7);
    g.fill();
  }
  // a corner torn off
  g.beginPath();
  g.moveTo(w, h);
  g.lineTo(w - 74, h);
  for (let i = 0; i <= 8; i++) g.lineTo(w - 74 + (i / 8) * 74 + (rnd() - 0.5) * 7, h - (i / 8) * 58 + (rnd() - 0.5) * 7);
  g.lineTo(w, h - 58);
  g.fill();
  g.beginPath();
  g.arc((burn[0] / PW) * w, (burn[1] / PH) * h, 5.2, 0, 7);
  g.fill();
  return c;
}

// ------------------------------------------------------------------ the table

const UP = new THREE.Vector3(0, 1, 0);
/** a place on the sheet (in the valley's own metres) as a place on the table */
const onSheetXZ = (wx: number, wz: number): [number, number] => {
  const p = onSheet(wx, wz);
  return [p.x, p.z];
};
const onSheet = (wx: number, wz: number, lift = 0) => new THREE.Vector3((X(wx) / PW - 0.5) * PAPER_W, lift, (Y(wz) / PH - 0.5) * PAPER_H).applyAxisAngle(UP, PAPER_YAW);

function shadows(o: THREE.Object3D) {
  o.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true;
  });
  return o;
}

/** what a thing put down at a place comes to rest on: the wood, or the sheet where it lies (set once the sheet is laid) */
let paperMesh: THREE.Mesh | null = null;
const _ray = new THREE.Raycaster();
function ground(x: number, z: number) {
  if (!paperMesh) return 0;
  _ray.set(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
  const hit = _ray.intersectObject(paperMesh, false)[0];
  return hit ? Math.max(0, hit.point.y) : 0;
}

/** a model of the game's, stood on the table: turned, then let down until it touches */
async function thing(id: string, at: [number, number], turn: [number, number, number] = [0, 0, 0], o: { scale?: number; lift?: number } = {}) {
  const m = await assets.model(id);
  const g = new THREE.Group();
  g.add(m);
  g.rotation.set(turn[0], turn[1], turn[2], 'YXZ');
  g.scale.setScalar(o.scale ?? 1);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  g.position.set(at[0], ground(at[0], at[1]) - box.min.y + (o.lift ?? 0), at[1]);
  return shadows(g);
}

/** a beer bottle, turned: brown glass, a paper label gone soft */
function bottle(label: THREE.Texture) {
  const prof = [[0, 0], [0.027, 0], [0.0305, 0.004], [0.0305, 0.118], [0.029, 0.136], [0.0225, 0.162], [0.0158, 0.184], [0.0134, 0.2], [0.0132, 0.221], [0.0147, 0.2225], [0.0147, 0.229], [0.0118, 0.2296]].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), new THREE.MeshPhysicalMaterial({ color: 0x4a2408, roughness: 0.07, metalness: 0, transmission: 0.78, thickness: 0.012, ior: 1.5, attenuationColor: new THREE.Color(0x5c2c08), attenuationDistance: 0.03, envMapIntensity: 1.4, side: THREE.DoubleSide }));
  g.add(glass);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0309, 0.0309, 0.062, 40, 1, true, 0.4, 4.3), new THREE.MeshStandardMaterial({ map: label, roughness: 0.86, side: THREE.DoubleSide }));
  band.position.y = 0.074;
  g.add(band);
  return shadows(g);
}

function bottleLabel() {
  const c = sheetOf(512, 240), g = c.getContext('2d')!, rnd = rng(9);
  g.fillStyle = '#d9cfae';
  g.fillRect(0, 0, 512, 240);
  g.strokeStyle = '#7a1d16';
  g.lineWidth = 8;
  g.strokeRect(14, 14, 484, 212);
  g.fillStyle = '#7a1d16';
  g.font = `700 92px "Stardos Stencil", serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ПИВО', 256, 108);
  g.font = `30px ${TYPE}`;
  g.fillStyle = '#2a251e';
  g.fillText('DOLINA BREWERY  ·  0,5 L', 256, 184);
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(110, 90, 60, ${rnd() * 0.25})`;
    g.beginPath();
    g.arc(rnd() * 512, rnd() * 240, 10 + rnd() * 60, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a cigarette, lying along +x from its filter; `burnt` 0..1 of it gone to ash, `lit` with an ember */
function cigarette(burnt = 0, lit = false) {
  const g = new THREE.Group(), R = 0.0039, L = 0.058 * (1 - burnt), F = 0.024;
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 14), new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.9 }));
  paper.rotation.z = Math.PI / 2;
  paper.position.x = F + L / 2;
  const filter = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.01, R * 1.01, F, 14), new THREE.MeshStandardMaterial({ color: 0xb9813f, roughness: 0.85 }));
  filter.rotation.z = Math.PI / 2;
  filter.position.x = F / 2;
  const ash = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.82, R * 0.96, 0.008, 10), new THREE.MeshStandardMaterial({ color: lit ? 0x3a3632 : 0x77726a, roughness: 1, emissive: lit ? 0xff5a14 : 0, emissiveIntensity: lit ? 2.2 : 0 }));
  ash.rotation.z = Math.PI / 2;
  ash.position.x = F + L + 0.004;
  g.add(paper, filter, ash);
  g.position.y = R;
  const out = new THREE.Group();
  out.add(g);
  return shadows(out);
}

function cap() {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0132, 0.0152, 0.0062, 21, 1), new THREE.MeshStandardMaterial({ color: 0xb08a2c, metalness: 0.85, roughness: 0.38 }));
  m.position.y = 0.0031;
  const g = new THREE.Group();
  g.add(m);
  return shadows(g);
}

/**
 * A hand of the infected, off at the forearm. One of the game's own infected is stood as it
 * stands in the game and what hangs on its right forearm and hand, below the cut, is taken as
 * it is: skin, nails, the cuff of its sleeve. Laid along +x from the cut. (As the body was made, not as it stands
 * in the game: see below.)
 */
async function severedHand(roll: number, pitch: number) {
  const gl = await assets.loadGLTF('assets/characters/zombie_male.glb');
  const sc = gl.scene;
  const at = (name: string) => {
    const p = new THREE.Vector3();
    sc.traverse((o) => {
      if (o.name === name) o.getWorldPosition(p);
    });
    return p;
  };
  // (how long its forearm really is: measured while it stands as it stands in the game)
  const mixer = new THREE.AnimationMixer(sc), idle = gl.animations.find((a) => a.name === 'idle');
  if (idle) {
    mixer.clipAction(idle).play();
    mixer.setTime(1.4);
  }
  sc.updateMatrixWorld(true);
  const forearm = at('hand_r').distanceTo(at('lowerarm_r'));
  mixer.stopAllAction();
  // then as it was made: arms out, hand flat, fingers straight. (Standing, the infected hold the thumb straight
  // down from the palm, and a hand laid on a table stood on it.) The measure it is in then is not metres, so it
  // is brought back to the length of that forearm.
  sc.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.pose();
  });
  sc.updateMatrixWorld(true);
  const wrist = at('hand_r'), elbow = at('lowerarm_r');
  const k = forearm / wrist.distanceTo(elbow);
  const axis = elbow.clone().sub(wrist).normalize(), CUT = 0.115 / k;
  const out = new THREE.Group(), v = new THREE.Vector3();
  // (the middle of its palm: half way from the wrist to the middle of the row of knuckles, first finger to little.
  // Not the middle of what hangs on the hand's own bone: that takes in the ball of the thumb, and is off to that side.)
  const palm = new THREE.Object3D(), palmLo = new THREE.Vector3(1e9, 1e9, 1e9), palmHi = new THREE.Vector3(-1e9, -1e9, -1e9);
  out.add(palm);
  const rim: THREE.Vector3[] = [];
  const found: { mesh: THREE.Mesh; reach: number; rim: THREE.Vector3[] }[] = [];
  sc.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.skeleton.update();
    const arm = new Set(m.skeleton.bones.map((b, i) => (/^(lowerarm|hand|thumb|index|middle|ring|pinky).*_r$/.test(b.name) ? i : -1)).filter((i) => i >= 0));
    const handBone = m.skeleton.bones.findIndex((b) => b.name === 'hand_r');
    const geo = m.geometry, P = geo.getAttribute('position'), J = geo.getAttribute('skinIndex'), Wt = geo.getAttribute('skinWeight'), U = geo.getAttribute('uv'), I = geo.getIndex();
    const map = new Int32Array(P.count).fill(-1), pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const edge: THREE.Vector3[] = [];
    let reach = Infinity;
    const take = (i: number) => {
      if (map[i] !== -1) return map[i];
      let w = 0;
      for (let k = 0; k < 4; k++) if (arm.has(J.getComponent(i, k))) w += Wt.getComponent(i, k);
      if (w < 0.5) return (map[i] = -2);
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      const d = v.clone().sub(wrist).dot(axis);
      if (d > CUT || v.distanceTo(wrist) > 0.27 / k || v.clone().sub(wrist).projectOnPlane(axis).length() > 0.13 / k) return (map[i] = -2);
      if (d > CUT - 0.012 / k) edge.push(v.clone());
      reach = Math.min(reach, d);
      let own = 0;
      for (let c = 0; c < 4; c++) if (J.getComponent(i, c) === handBone) own += Wt.getComponent(i, c);
      if (own > 0.75) {
        palmLo.min(v);
        palmHi.max(v);
      }
      map[i] = pos.length / 3;
      pos.push(v.x, v.y, v.z);
      uv.push(U.getX(i), U.getY(i));
      return map[i];
    };
    const n = I ? I.count : P.count;
    for (let t = 0; t < n; t += 3) {
      const a = take(I ? I.getX(t) : t), b = take(I ? I.getX(t + 1) : t + 1), cc = take(I ? I.getX(t + 2) : t + 2);
      if (a >= 0 && b >= 0 && cc >= 0) idx.push(a, b, cc);
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const from = m.material as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshStandardMaterial({ map: from.map, normalMap: from.normalMap, roughnessMap: from.roughnessMap, roughness: from.roughness, color: from.color, alphaTest: from.alphaTest, side: THREE.DoubleSide });
    found.push({ mesh: new THREE.Mesh(g, mat), reach, rim: edge });
  });
  // (A loose sleeve ended on this forearm, and the cut went through the end of it: a ring of cloth wider than the
  // arm, on which the whole thing stood with the hand in the air. Only what reaches down into the hand is kept.)
  void palmLo;
  void palmHi;
  palm.position.copy(wrist).lerp(at('index_01_r').add(at('pinky_01_r')).multiplyScalar(0.5), num('pl', 0.5));
  for (const f of found) {
    if (f.reach > -0.05 / k) continue;
    out.add(f.mesh);
    rim.push(...f.rim);
  }
  // the cut: meat, and the two bones of a forearm (no wider than the arm itself: the rim of a loose sleeve is no measure of it)
  const mid = rim.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(Math.max(1, rim.length));
  const wide = Math.min(0.034 / k, rim.reduce((s, p) => s + p.clone().sub(mid).projectOnPlane(axis).length(), 0) / Math.max(1, rim.length));
  const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis);
  const gore = new THREE.Group();
  const meat = new THREE.Mesh(new THREE.SphereGeometry(wide, 20, 14), new THREE.MeshStandardMaterial({ color: 0x3a0505, roughness: 0.2 }));
  meat.scale.set(0.3, 1, 1);
  meat.quaternion.copy(face);
  meat.position.copy(mid).addScaledVector(axis, -0.006 / k);
  gore.add(meat);
  for (const s of [-1, 1]) {
    const bone = new THREE.Mesh(new THREE.CylinderGeometry(wide * 0.2, wide * 0.24, 0.022 / k, 10), new THREE.MeshStandardMaterial({ color: 0xcfc4a6, roughness: 0.6 }));
    bone.quaternion.copy(face).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
    bone.position.copy(mid).addScaledVector(axis, 0.002 / k).add(new THREE.Vector3(0, 0, s * wide * 0.36).applyQuaternion(face));
    gore.add(bone);
  }
  // laid down: the forearm along the table, the cut at the origin
  const lay = new THREE.Group();
  out.position.copy(mid).multiplyScalar(-1);
  const turn = new THREE.Group();
  turn.add(out);
  turn.quaternion.setFromUnitVectors(axis.clone().multiplyScalar(-1), new THREE.Vector3(1, 0, 0));
  turn.scale.setScalar(k);
  const rolled = new THREE.Group();
  rolled.add(turn);
  rolled.rotation.set(roll, 0, 0, 'ZXY');
  lay.add(rolled);
  lay.updateMatrixWorld(true);
  // Tipped until the arm and the hand both lie on the table (an arm is thicker than a hand: laid level by its
  // bones, the hand hung off the end of it in the air). Every point of it is tried at each angle, half a degree apart.
  const pts: THREE.Vector3[] = [];
  out.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const P = m.geometry.getAttribute('position');
    for (let i = 0; i < P.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld));
  });
  const long = pts.reduce((x, p) => Math.max(x, p.x), 0);
  const low = (a: number, from: number, to: number) => {
    const c = Math.cos(a), sn = Math.sin(a);
    let y = Infinity;
    for (const p of pts) if (p.x >= from && p.x < to) y = Math.min(y, p.x * sn + p.y * c);
    return y;
  };
  let tip = 0, off = Infinity;
  for (let a = -0.4; a <= 0.4; a += 0.008) {
    const d = Math.abs(low(a, 0, long * 0.38) - low(a, long * 0.5, long));
    if (d < off) [tip, off] = [a, d];
  }
  rolled.rotation.set(roll, 0, tip + pitch, 'ZXY');
  lay.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(lay, true);
  rolled.position.y = -box.min.y;
  (window as unknown as { handSeat: unknown }).handSeat = { tip: +tip.toFixed(3), offMm: +(off * 1000).toFixed(1), longCm: +(long * 100).toFixed(1), pieces: found.map((f) => [+(f.reach * k * 100).toFixed(1), f.mesh.geometry.getAttribute('position').count]), kept: out.children.length };
  out.add(gore);
  lay.userData.palm = palm;
  return shadows(lay);
}

// ------------------------------------------------------------------ the picture

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = q.get('tm') === 'aces' ? THREE.ACESFilmicToneMapping : q.get('tm') === 'agx' ? THREE.AgXToneMapping : THREE.NeutralToneMapping;
renderer.toneMappingExposure = num('ex', 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

await assets.init();
await Promise.all(['64px "Special Elite"', '64px "Permanent Marker"', '64px "Rock Salt"', '64px "Reenie Beanie"', '700 64px "Caveat"', '700 64px "Stardos Stencil"', '700 64px "Barlow Condensed"', '600 64px "Barlow Condensed"'].map((f) => document.fonts.load(f).catch(() => [])));
const world = generateWorld();

// ---- the sheet
const sheet = printSheet(world);
writeOn(sheet, world);
wear(sheet);
/** where the cigarette burnt through */
const BURN: [number, number] = [X(-96), Y(-440)];
bleed(sheet, [X(num('bx', 436)), Y(num('bz', 128))], 0.1);
{
  // the burn: a brown ring round a hole
  const g = sheet.getContext('2d')!;
  g.save();
  g.globalCompositeOperation = 'multiply';
  const rg = g.createRadialGradient(BURN[0], BURN[1], 14, BURN[0], BURN[1], 74);
  rg.addColorStop(0, 'rgba(20, 12, 6, 1)');
  rg.addColorStop(0.45, 'rgba(92, 56, 22, 0.8)');
  rg.addColorStop(1, 'rgba(120, 90, 50, 0)');
  g.fillStyle = rg;
  g.fillRect(BURN[0] - 80, BURN[1] - 80, 160, 160);
  g.restore();
}
(window as unknown as { sheet: HTMLCanvasElement }).sheet = sheet;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
{
  const pm = new THREE.PMREMGenerator(renderer);
  const hdr = await assets.hdri(assets.manifest.hdri.env);
  scene.environment = pm.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = num('env', 0.16);
}

// the table: old boards
{
  const t = assets.pbr('weathered_planks');
  for (const m of [t.map, t.normalMap, t.armMap]) {
    if (!m) continue;
    m.wrapS = m.wrapT = THREE.RepeatWrapping;
    m.repeat.set(3.2, 2.4);
    m.needsUpdate = true;
  }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.armMap, aoMap: t.armMap, roughness: 1, color: 0x9a8468 }));
  top.rotation.y = Math.PI / 2 + 0.02;
  top.receiveShadow = true;
  scene.add(top);
}

// the sheet on it: not quite flat
{
  const tex = new THREE.CanvasTexture(sheet);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const alpha = new THREE.CanvasTexture(holes(BURN));
  const geo = new THREE.PlaneGeometry(PAPER_W, PAPER_H, 150, 156).rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position'), rnd = rng(5);
  const waves = Array.from({ length: 7 }, () => [rnd() * 6.28, 3 + rnd() * 9, rnd() * 6.28, 3 + rnd() * 9, 0.0006 + rnd() * 0.0011]);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), u = x / PAPER_W + 0.5, v = z / PAPER_H + 0.5;
    let y = 0.0016;
    for (const [a, fx, b, fz, amp] of waves) y += amp * (1 + Math.sin(a + x * fx) * Math.sin(b + z * fz));
    // each fold stands up a little, or lies in a little
    for (const [t, sgn] of [[u * 3 - 1, 1], [u * 3 - 2, -1], [v * 3 - 1, -1], [v * 3 - 2, 1]] as [number, number][]) y += (sgn > 0 ? 0.0075 : -0.0009) * Math.exp(-(t * t) / 0.006);
    // two corners that will not lie down
    for (const [cu, cv, lift] of [[0, 0, 0.03], [1, 0, 0.02], [0, 1, 0.012]] as number[][]) {
      const d = Math.hypot((u - cu) * PAPER_W, (v - cv) * PAPER_H);
      if (d < 0.17) y += lift * (1 - d / 0.17) ** 2;
    }
    pos.setY(i, Math.max(0.0007, y));
  }
  geo.computeVertexNormals();
  const paper = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, alphaMap: alpha, alphaTest: 0.5, roughness: 0.93, metalness: 0, side: THREE.DoubleSide }));
  paper.rotation.y = PAPER_YAW;
  paper.castShadow = paper.receiveShadow = true;
  scene.add(paper);
  paper.updateMatrixWorld(true);
  paperMesh = paper;
}

// ---- what is on the table. (x to the right, z toward whoever is looking; the sheet is about a metre across)
/** where the knife stands (in the palm of the hand) */
const STAB = new THREE.Vector3();
const add = (o: THREE.Object3D) => (scene.add(o), o);
const label = bottleLabel();
{
  const b1 = bottle(label);
  b1.position.set(-0.69, 0, -0.3);
  b1.rotation.y = 1.9;
  add(b1);
  const b2 = bottle(label);
  b2.position.set(-0.78, 0, -0.16);
  b2.rotation.y = 0.3;
  add(b2);
  // one on its side, empty
  const b3 = bottle(label);
  b3.rotation.set(0, -0.5, Math.PI / 2, 'YXZ');
  b3.position.set(-0.52, 0.0305, -0.63);
  add(b3);
  for (const [x, z, r] of [[-0.62, -0.12, 0.3], [-0.58, -0.42, 2.1], [-0.72, 0.02, 1]] as number[][]) {
    const c = cap();
    c.position.set(x, 0, z);
    c.rotation.y = r;
    if (r > 2) c.rotation.x = Math.PI;
    if (r > 2) c.position.y = 0.0062;
    add(c);
  }
}
add(await thing('cigarette_pack', [-0.6, 0.3], [Math.PI / 2, 0.5, 0]));
add(await thing('can_rusted', [-0.74, 0.2], [0, 1, 0], { scale: 0.62 }));
{
  // put out in the can, and one left burning on the edge of the sheet
  const rnd = rng(3);
  for (let i = 0; i < 6; i++) {
    const c = cigarette(0.55 + rnd() * 0.3);
    c.position.set(-0.74 + (rnd() - 0.5) * 0.04, 0.062 + rnd() * 0.01, 0.2 + (rnd() - 0.5) * 0.04);
    c.rotation.set(0, rnd() * 6.28, 0.5 + rnd() * 0.7, 'YXZ');
    add(c);
  }
  const lit = cigarette(0.3, true);
  const at = new THREE.Vector3((BURN[0] / PW - 0.5) * PAPER_W, 0.004, (BURN[1] / PH - 0.5) * PAPER_H).applyAxisAngle(UP, PAPER_YAW);
  lit.position.set(at.x - 0.05, at.y, at.z - 0.022);
  lit.rotation.y = -0.45;
  add(lit);
  const ember = new THREE.PointLight(0xff6a1e, 0.05, 0.25);
  ember.position.set(at.x, 0.012, at.z);
  add(ember);
  const two = cigarette(0);
  two.position.set(-0.56, 0, 0.4);
  two.rotation.y = 2.2;
  add(two);
}
const torch = await thing('vintage_flashlight', [num('fx', -0.7), num('fz', 0.02)], [0, num('ty', 1.75), 0]);
add(torch);
add(await thing('old_gas_mask', [num('mpx', 0.66), num('mpz', -0.34)], [num('mx', -Math.PI / 2), num('my', 2.4), num('mz', 0)], { scale: num('ms', 0.72) }));
add(await thing('desert_eagle', [0.68, 0.5], [Math.PI / 2, 2.9, 0]));
add(await thing('ammo_box', [0.9, 0.3], [0, 0.4, 0]));
{
  const rnd = rng(12);
  for (let i = 0; i < 7; i++) add(await thing('round_50', [0.54 + rnd() * 0.2, 0.34 + rnd() * 0.1], [0, rnd() * 6.28, 0]));
  for (let i = 0; i < 5; i++) add(await thing('shell_12', [0.56 + rnd() * 0.22, -0.06 + rnd() * 0.1], [0, rnd() * 6.28, 0]));
  add(await thing('shell_12', [0.585, -0.13], [Math.PI / 2, 0, 0]));
}
add(await thing('seadogs_compass', onSheetXZ(-452, -70), [0, 2.4, 0], { lift: 0.001 }));
add(await thing('syringe', [0.42, 0.53], [0, 1.1, 0]));
add(await thing('digital_wrist_watch', [-0.3, 0.54], [0, 0.4, 0]));
add(await thing('binoculars', [0.16, -0.66], [0, 1.2, 0]));
add(await thing('vintage_radio_transceiver', [-0.2, -0.86], [0, 0.15, 0], { scale: 0.7 }));
{
  // tags taken off two who did not come back, and the card that cost one of them
  const lie = (parts: ReturnType<typeof proceduralParts>, x: number, z: number, r: number, lift = 0, scale = 1) => {
    const inner = new THREE.Group();
    for (const p of parts) inner.add(new THREE.Mesh(p.geometry, p.material));
    // (whichever way it was made, its thin way is turned up)
    const size = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3());
    if (size.x <= size.y && size.x <= size.z) inner.rotation.z = Math.PI / 2;
    else if (size.z <= size.y) inner.rotation.x = Math.PI / 2;
    const g = new THREE.Group();
    g.add(inner);
    g.rotation.y = r;
    // (a tag is as long as a thumb, whatever measure it was made in)
    g.scale.setScalar(scale * (parts[0].name === 'dogtag' ? 0.052 / Math.max(size.x, size.y, size.z) : 1));
    g.updateMatrixWorld(true);
    g.position.set(x, ground(x, z) - new THREE.Box3().setFromObject(g, true).min.y + lift, z);
    add(shadows(g));
  };
  const tags = proceduralParts('@dogtag');
  lie(tags, 0.3, 0.468, 0.4, 0.0015);
  lie(tags, 0.335, 0.49, 1.9, 0.004);
  const [cx, cz] = onSheetXZ(476, 300);
  lie(proceduralParts('@keycard'), cx, cz, num('cr', 0.5), 0.002);
}
// the hand: off the edge of the sheet, its fingers on the valley
{
  const hand = await severedHand(num('hr', Math.PI), num('hp', 0));
  hand.position.set(num('hx', 0.53), 0.003, num('hz', 0.07));
  hand.rotation.y = num('hy', Math.PI - 0.22);
  add(hand);
  // the knife: through the middle of its palm and into the wood under the sheet, pinning it there
  {
    hand.updateMatrixWorld(true);
    // The middle of its palm, measured on the hand itself as it lies (its bones are no guide: they were brought
    // to this body from another, and run along the edge of the hand). Across: the middle of its four fingers,
    // taken a little way past the knuckles, where there is no thumb. Along: half way from the wrist to the knuckles.
    const WRIST = 0.11, KNUCKLES = 0.112;
    const back = new THREE.Matrix4().copy(hand.matrixWorld).invert(), hv = new THREE.Vector3();
    let z0 = Infinity, z1 = -Infinity;
    hand.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry.getAttribute('uv') || m.geometry.getAttribute('position').count < 200) return;
      const P = m.geometry.getAttribute('position');
      for (let i = 0; i < P.count; i++) {
        hv.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld).applyMatrix4(back);
        if (hv.x < WRIST + KNUCKLES + 0.006 || hv.x > WRIST + KNUCKLES + 0.03) continue;
        z0 = Math.min(z0, hv.z);
        z1 = Math.max(z1, hv.z);
      }
    });
    const palm = new THREE.Vector3(WRIST + KNUCKLES * num('pl', 0.5), 0, Number.isFinite(z0) ? (z0 + z1) / 2 + num('pz', 0) : 0).applyMatrix4(hand.matrixWorld);
    const knife = await assets.model('fish_knife');
    const g = new THREE.Group();
    g.add(knife);
    const box = new THREE.Box3().setFromObject(knife);
    // (it is made point up: turned over, and its point put a finger deep in the wood; it leans the way it was driven)
    knife.rotation.z = Math.PI;
    knife.position.y = box.max.y - num('kd', 0.02);
    g.rotation.set(num('kx', -0.2), num('ky', 0.5), num('kz', 0.16), 'YXZ');
    g.position.set(palm.x, 0.002, palm.z);
    add(shadows(g));
    // where it goes into the palm, found by looking down on the hand
    _ray.set(new THREE.Vector3(palm.x, 0.5, palm.z), new THREE.Vector3(0, -1, 0));
    const top = _ray.intersectObject(hand, true)[0];
    const y = top ? top.point.y : palm.y;
    // (it leans, and its blade is not in the line of its handle: so where the blade is at that height is found from
    // the blade itself, and the knife moved by as much as that is off the middle of the palm)
    g.updateMatrixWorld(true);
    const through = new THREE.Vector3(), vv = new THREE.Vector3(), lo = new THREE.Vector3(1e9, 1e9, 1e9), hi = new THREE.Vector3(-1e9, -1e9, -1e9);
    let n = 0;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const P = m.geometry.getAttribute('position');
      for (let i = 0; i < P.count; i++) {
        m.getVertexPosition(i, vv).applyMatrix4(m.matrixWorld);
        if (Math.abs(vv.y - y) < 0.012) {
          lo.min(vv);
          hi.max(vv);
          n++;
        }
      }
    });
    if (n) {
      through.copy(lo).add(hi).multiplyScalar(0.5);
      g.position.x += palm.x - through.x;
      g.position.z += palm.z - through.z;
    }
    STAB.set(palm.x, y, palm.z);
    (window as unknown as { stab: unknown }).stab = { offMm: n ? +(Math.hypot(palm.x - through.x, palm.z - through.z) * 1000).toFixed(1) : null, points: n, palm: [+palm.x.toFixed(3), +y.toFixed(3), +palm.z.toFixed(3)] };
    const wound = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 10), new THREE.MeshPhysicalMaterial({ color: 0x2a0303, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 }));
    wound.scale.set(1.25, 0.16, 1);
    wound.position.set(palm.x + 0.002, y + 0.0006, palm.z + 0.001);
    wound.rotation.y = 0.7;
    add(wound);
    const run = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), wound.material);
    run.scale.set(3.4, 0.14, 0.8);
    run.position.set(palm.x + 0.012, y - 0.0012, palm.z + 0.016);
    run.rotation.y = -0.9;
    add(run);
  }
  // what ran out of it, on the wood: dark and wet, thin at its edge
  const c = sheetOf(512, 512), cg = c.getContext('2d')!, rnd = rng(21);
  cg.filter = 'blur(5px)';
  cg.fillStyle = '#fff';
  cg.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * 6.283, r = 150 * (0.7 + rnd() * 0.32) * (1 + 0.32 * Math.cos(a - 0.4));
    (i ? cg.lineTo : cg.moveTo).call(cg, 256 + Math.cos(a) * r, 256 + Math.sin(a) * r);
  }
  cg.fill();
  for (let i = 0; i < 22; i++) {
    const a = rnd() * 6.283, d = 170 + rnd() * 70;
    cg.beginPath();
    cg.arc(256 + Math.cos(a) * d, 256 + Math.sin(a) * d, 3 + rnd() * 12, 0, 7);
    cg.fill();
  }
  const shape = new THREE.CanvasTexture(c);
  const wet = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x1c0202, roughness: 0.07, metalness: 0, alphaMap: shape, transparent: true, opacity: 0.94, clearcoat: 1, clearcoatRoughness: 0.05 }));
  wet.position.set(num('hx', 0.53) + 0.035, 0.0007, num('hz', 0.07) + 0.01);
  wet.rotation.y = 0.6;
  wet.receiveShadow = true;
  add(wet);
}

// ---- light: one lamp hung over the table, and the torch left on
{
  const lamp = new THREE.SpotLight(0xffc68a, num('lamp', 11.5), 6, 0.7, 0.95, 1.5);
  lamp.position.set(-0.3, 1.5, -0.42);
  lamp.target.position.set(0.02, 0, 0.04);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(4096, 4096);
  lamp.shadow.camera.near = 0.3;
  lamp.shadow.camera.far = 4;
  lamp.shadow.bias = -0.00012;
  lamp.shadow.normalBias = 0.004;
  lamp.shadow.radius = 5;
  scene.add(lamp, lamp.target);
  const beam = new THREE.SpotLight(0xdfe8ff, num('beam', 4.2), 3, num('bw', 0.34), 0.85, 1.2);
  beam.position.set(num('fx', -0.7) + 0.1, 0.08, num('fz', 0.02) - 0.08);
  beam.target.position.set(num('btx', 0.34), 0.0, num('btz', -0.3));
  beam.castShadow = true;
  beam.shadow.mapSize.set(2048, 2048);
  beam.shadow.camera.near = 0.05;
  beam.shadow.camera.far = 3;
  beam.shadow.bias = -0.0002;
  beam.shadow.normalBias = 0.004;
  beam.shadow.radius = 3;
  scene.add(beam, beam.target);
  scene.add(new THREE.HemisphereLight(0x7088b8, 0x2a1c10, num('fill', 0.42)));
  // (a cold light from behind and to the left, for the edges of glass and steel)
  const rim = new THREE.DirectionalLight(0x9db4e0, num('rim', 0.9));
  rim.position.set(-1.6, 0.7, -1.4);
  scene.add(rim);
}

const camera = new THREE.PerspectiveCamera(num('fov', 33), W / H, 0.05, 20);
camera.position.set(num('cx', -0.03), num('cy', 1.52), num('cz', 0.9));
camera.lookAt(num('tx', -0.05), 0, num('tz', 0.02));
scene.updateMatrixWorld(true);

/** the poster: one picture */
async function still() {
renderer.render(scene, camera);

// ---- the finish: the dark round the edge, grain, smoke off the one still burning, and the name
const out = sheetOf(W, H), g = out.getContext('2d')!;
g.drawImage(renderer.domElement, 0, 0);
{
  const k = W / 1920;
  // smoke
  const tip = new THREE.Vector3((BURN[0] / PW - 0.5) * PAPER_W, 0.012, (BURN[1] / PH - 0.5) * PAPER_H).applyAxisAngle(UP, PAPER_YAW).project(camera);
  const sx = (tip.x * 0.5 + 0.5) * W, sy = (-tip.y * 0.5 + 0.5) * H, rnd = rng(8);
  g.save();
  g.globalCompositeOperation = 'screen';
  g.filter = `blur(${5 * k}px)`;
  g.lineCap = 'round';
  for (let s = 0; s < 5; s++) {
    g.strokeStyle = `rgba(206, 212, 220, ${0.05 + rnd() * 0.05})`;
    g.lineWidth = (3 + rnd() * 9) * k;
    g.beginPath();
    g.moveTo(sx, sy);
    let x = sx, y = sy;
    const drift = (rnd() - 0.3) * 60 * k;
    for (let i = 1; i <= 9; i++) {
      const nx = sx + drift * (i / 9) ** 1.6 + Math.sin(i * 0.9 + s * 2) * (4 + i * 3.4) * k, ny = sy - i * 30 * k;
      g.quadraticCurveTo(x + (rnd() - 0.5) * 16 * k, (y + ny) / 2, nx, ny);
      x = nx;
      y = ny;
    }
    g.stroke();
  }
  g.restore();
  // the dark round the edge
  const vg = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.32, W * 0.5, H * 0.52, H * 1.06);
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.66)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  // grain
  const n = sheetOf(256, 256), ng = n.getContext('2d')!, nd = ng.createImageData(256, 256), nr = rng(2);
  for (let i = 0; i < nd.data.length; i += 4) {
    const v = 128 + (nr() - 0.5) * 70;
    nd.data[i] = nd.data[i + 1] = nd.data[i + 2] = v;
    nd.data[i + 3] = 255;
  }
  ng.putImageData(nd, 0, 0);
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.16;
  g.fillStyle = g.createPattern(n, 'repeat')!;
  g.scale(k, k);
  g.fillRect(0, 0, W / k, H / k);
  g.restore();
  if (TITLE) {
    // the name, bottom left, on its own dark
    const lg = g.createRadialGradient(W * 0.06, H * 0.96, 0, W * 0.06, H * 0.96, W * 0.5);
    lg.addColorStop(0, 'rgba(0, 0, 0, 0.92)');
    lg.addColorStop(0.45, 'rgba(0, 0, 0, 0.6)');
    lg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    const mark = new Image();
    mark.src = '/brand/zona-mark-plain.svg';
    await mark.decode().catch(() => {});
    const x0 = 70 * k, y0 = H - 236 * k;
    if (mark.naturalWidth) g.drawImage(mark, x0, y0 + 14 * k, 124 * k, 124 * k);
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#e9e4d8';
    g.font = `700 ${150 * k}px "Barlow Condensed", sans-serif`;
    (g as unknown as { letterSpacing: string }).letterSpacing = `${10 * k}px`;
    g.fillText('ZONA', x0 + 144 * k, y0 + 136 * k);
    g.font = `600 ${46 * k}px "Barlow Condensed", sans-serif`;
    (g as unknown as { letterSpacing: string }).letterSpacing = `${9 * k}px`;
    g.fillStyle = '#ffd35a';
    g.fillText('BUNKER 17 IS OPEN', x0 + 4 * k, y0 + 196 * k);
    g.font = `500 ${25 * k}px "Barlow Condensed", sans-serif`;
    (g as unknown as { letterSpacing: string }).letterSpacing = `${5 * k}px`;
    g.fillStyle = 'rgba(233, 228, 216, 0.82)';
    g.fillText('PVP SURVIVAL  ·  PLAY TO EARN  ·  ZONAPVP.FUN', x0 + 5 * k, y0 + 232 * k);
  }
}
renderer.domElement.remove();
document.body.appendChild(out);
const win = window as unknown as { posterDone: boolean; posterPNG: () => string };
win.posterPNG = () => out.toDataURL('image/png');
if (q.get('post')) {
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, q.get('fmt') === 'png' ? 'image/png' : 'image/jpeg', 0.93));
  if (blob) await fetch(`http://127.0.0.1:5199/?name=${q.get('post')}`, { method: 'POST', body: blob }).catch(() => {});
}
if (q.get('sheet')) {
  const blob = await new Promise<Blob | null>((r) => sheet.toBlob(r, 'image/jpeg', 0.9));
  if (blob) await fetch(`http://127.0.0.1:5199/?name=${q.get('sheet')}`, { method: 'POST', body: blob }).catch(() => {});
}
win.posterDone = true;
}

/**
 * The table filmed. A camera goes over the sheet close and low, as a lens on a slider would:
 * the note in the corner, the gas, the bunker, the knife through the hand; then the
 * whole table and the name. Eight bars of the trailers' score (written in code: src/trailer/music.ts),
 * a cut on every bar line. Drawn a frame at a time and put into an MP4 here in the page.
 * `film=menu`: the four passes alone, nothing written over them, no sound, to lie behind the game's menu.
 */
async function film() {
  const PP = await import('postprocessing');
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const MENU = q.get('film') === 'menu';
  const FPS = num('fps', MENU ? 30 : 60), BAR = 1.875;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  interface Pass { bars: number; say?: string; at: (u: number) => { pos: THREE.Vector3; look: THREE.Vector3; fov: number; range: number } }
  // Each pass is over one corner of the sheet, from the south of it and well up, so that what is written there
  // stands the right way up and is all in the picture, sharp, for long enough to be read. (They were close and low
  // at first, a lens on a slider: handsome, and nobody could read a word.)
  const over = (x0: number, z0: number, x1: number, z1: number, high = 0.37, back = 0.27) => (u: number) => {
    const look = V(lerp(x0, x1, u), 0, lerp(z0, z1, u));
    return { pos: look.clone().add(V(0, lerp(high, high - 0.03, u), back)), look, fov: 40, range: 0.6 };
  };
  const passes: Pass[] = [
    // top left: what they are going on
    { bars: 2, say: 'ONE MAP.  ONE PLAN.', at: over(-0.33, -0.3, -0.2, -0.3) },
    // bottom left: the gas, the keycard, the masks
    { bars: 2, say: 'THE KEYCARD IS IN THE GAS', at: over(-0.3, 0.2, -0.15, 0.16) },
    // top right: the bunker, and everything they know of it
    { bars: 2, say: 'BUNKER 17', at: over(0.05, -0.29, 0.17, -0.28) },
    // the knife, and what it is through
    { bars: 1, say: 'TRUST NOBODY AT THE DOOR.', at: (u) => {
      const a = lerp(-1.5, -0.2, u), r = lerp(0.46, 0.34, u);
      return { pos: STAB.clone().add(V(Math.sin(a) * r, lerp(0.22, 0.15, u), Math.cos(a) * r)), look: STAB.clone().add(V(0.02, 0.04, 0)), fov: 32, range: 0.16 };
    } },
  ];
  // the whole table, and the name
  if (!MENU) passes.push({ bars: 1, at: (u) => ({ pos: V(-0.03, lerp(1.53, 1.47, u), 0.9), look: V(-0.05, 0, 0.02), fov: 33, range: 1.1 }) });
  const SECONDS = passes.reduce((n, p) => n + p.bars, 0) * BAR, FRAMES = Math.round(SECONDS * FPS);

  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = num('ex', 0.8);
  // (Glass that is seen through is drawn by a pass of its own, and inside this chain that pass left the whole
  // picture black whenever a bottle was in it: which is only the last shot, from over the table. Filmed, the
  // bottles are dark glass that is not seen through.)
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
    if (m && m.isMeshPhysicalMaterial && m.transmission > 0) {
      m.transmission = 0;
      m.transparent = true;
      m.opacity = 0.9;
      m.color.set(0x2a1405);
      m.needsUpdate = true;
    }
  });
  const composer = new PP.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 });
  composer.addPass(new PP.RenderPass(scene, camera));
  const dof = new PP.DepthOfFieldEffect(camera, { worldFocusDistance: 0.4, worldFocusRange: 0.15, bokehScale: num('bokeh', 2.4), resolutionScale: 0.75 });
  const soft = new PP.EffectPass(camera, dof);
  composer.addPass(soft);
  const grain = new PP.NoiseEffect({ blendFunction: PP.BlendFunction.OVERLAY, premultiply: false });
  grain.blendMode.opacity.value = 0.07;
  // (no glow is laid over it: one point of the picture that came out as no number at all was spread by the glow over the whole of the last shot)
  composer.addPass(new PP.EffectPass(camera, new PP.ToneMappingEffect({ mode: PP.ToneMappingMode.NEUTRAL }), new PP.VignetteEffect({ offset: 0.3, darkness: 0.66 }), grain));
  let lamp: THREE.SpotLight | null = null;
  scene.traverse((o) => {
    const l = o as THREE.SpotLight;
    if (l.isSpotLight && l.color.getHex() === 0xffc68a) lamp = l;
  });
  const lampAt = lamp ? (lamp as THREE.SpotLight).position.clone() : V(0, 1.5, 0);

  const out = sheetOf(W, H), g = out.getContext('2d')!;
  document.body.appendChild(out);
  renderer.domElement.style.display = 'none';
  const k = W / 1920;
  const mark = new Image();
  mark.src = '/brand/zona-mark-plain.svg';
  await mark.decode().catch(() => {});
  const gap = (px: number) => ((g as unknown as { letterSpacing: string }).letterSpacing = `${px * k}px`);

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, ...(MENU ? {} : { audio: { codec: 'aac' as const, sampleRate: 48000, numberOfChannels: 2 } }), fastStart: 'in-memory' });
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => console.error('[film] video', e.message) });
  venc.configure({ codec: 'avc1.64002A', width: W, height: H, bitrate: num('rate', MENU ? 3_600_000 : 16_000_000), framerate: FPS, latencyMode: 'quality', avc: { format: 'avc' } });
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const BARS_H = MENU ? 0 : Math.round((H - W / 2.39) / 2);

  for (let f = Math.round(num('from', 0) * FPS); f < Math.min(FRAMES, Math.round(num('to', 1e9) * FPS)); f++) {
    const t = f / FPS;
    let i = 0, t0 = 0;
    while (i < passes.length - 1 && t >= t0 + passes[i].bars * BAR) t0 += passes[i++].bars * BAR;
    const len = passes[i].bars * BAR, u = clamp((t - t0) / len, 0, 1), c = passes[i].at(u);
    camera.position.copy(c.pos);
    camera.fov = c.fov;
    camera.up.set(0, 1, 0);
    camera.lookAt(c.look);
    // (behind the menu, whose words have the left of the screen: what is looked at is put to the right of the middle)
    if (MENU) camera.setViewOffset(W, H, -W * 0.17, 0, W, H);
    camera.updateProjectionMatrix();
    dof.cocMaterial.worldFocusDistance = c.pos.distanceTo(c.look);
    dof.cocMaterial.worldFocusRange = c.range;
    // (from over the whole table everything is sharp: no lens is laid over that picture, and with one it came out black)
    soft.enabled = c.range < 1;
    // (the lamp hangs on a flex, and somebody knocked it)
    if (lamp) (lamp as THREE.SpotLight).position.set(lampAt.x + 0.04 * Math.sin(t * 1.9), lampAt.y, lampAt.z + 0.022 * Math.sin(t * 1.3 + 1));
    scene.updateMatrixWorld(true);
    composer.render(1 / FPS);
    g.globalAlpha = 1;
    g.drawImage(renderer.domElement, 0, 0);
    if (!MENU) {
      const last = i === passes.length - 1;
      // the band comes in on the third bar, and the picture jumps with it
      const hit = i === 0 ? 0 : (last || i === 1 ? 0.6 : 0.26) * Math.exp(-(t - t0) * 20);
      if (hit > 0.01) {
        g.fillStyle = `rgba(255, 244, 226, ${hit})`;
        g.fillRect(0, 0, W, H);
      }
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, BARS_H);
      g.fillRect(0, H - BARS_H, W, BARS_H);
      const say = passes[i].say;
      if (say) {
        const a = (i === 0 ? 1 : clamp((t - t0) / 0.16, 0, 1)) * clamp((t0 + len - t) / 0.16, 0, 1);
        g.globalAlpha = a;
        g.fillStyle = '#ffd35a';
        g.fillRect(96 * k, H - BARS_H - 118 * k, 7 * k, 58 * k);
        g.font = `600 ${58 * k}px "Barlow Condensed", sans-serif`;
        gap(7);
        g.textBaseline = 'alphabetic';
        g.shadowColor = 'rgba(0, 0, 0, 0.85)';
        g.shadowBlur = 18 * k;
        g.fillStyle = '#efe9da';
        g.fillText(say, 124 * k, H - BARS_H - 70 * k);
        g.shadowBlur = 0;
        g.globalAlpha = 1;
      }
      if (last) {
        const a = clamp((t - t0) / 0.14, 0, 1);
        g.globalAlpha = a;
        const lg = g.createRadialGradient(W * 0.08, H * 0.9, 0, W * 0.08, H * 0.9, W * 0.55);
        lg.addColorStop(0, 'rgba(0, 0, 0, 0.94)');
        lg.addColorStop(0.5, 'rgba(0, 0, 0, 0.6)');
        lg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = lg;
        g.fillRect(0, BARS_H, W, H - BARS_H * 2);
        const x0 = 96 * k, y0 = H - BARS_H - 300 * k;
        if (mark.naturalWidth) g.drawImage(mark, x0, y0 + 14 * k, 130 * k, 130 * k);
        g.textBaseline = 'alphabetic';
        g.fillStyle = '#e9e4d8';
        g.font = `700 ${158 * k}px "Barlow Condensed", sans-serif`;
        gap(10);
        g.fillText('ZONA', x0 + 150 * k, y0 + 142 * k);
        g.font = `600 ${50 * k}px "Barlow Condensed", sans-serif`;
        gap(9);
        g.fillStyle = '#ffd35a';
        g.fillText('BUNKER 17 IS OPEN', x0 + 4 * k, y0 + 206 * k);
        g.font = `500 ${28 * k}px "Barlow Condensed", sans-serif`;
        gap(5);
        g.fillStyle = 'rgba(233, 228, 216, 0.86)';
        g.fillText('PLAY NOW  ·  ZONAPVP.FUN', x0 + 5 * k, y0 + 250 * k);
        g.globalAlpha = 1;
      }
    }
    const frame = new VideoFrame(out, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 4) await pause(4);
    if (f % 30 === 0) await pause(0);
    // (stills on the way, to look at: ?stills=6)
    if (q.get('stills') && f % Math.max(1, Math.floor(FRAMES / +q.get('stills')!)) === Math.floor(FRAMES / +q.get('stills')! / 2)) {
      const b = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/jpeg', 0.88));
      if (b) await fetch(`http://127.0.0.1:5199/?name=${q.get('post') ?? 'film'}-s${Math.floor(f / Math.max(1, Math.floor(FRAMES / +q.get('stills')!)))}`, { method: 'POST', body: b }).catch(() => {});
    }
  }
  await venc.flush();
  if (!MENU) {
    // ---- the score: six bars, the band in on the third
    const { scoreMusic } = await import('../trailer/music');
    const SR = 48000, off = new OfflineAudioContext(2, Math.ceil(SECONDS * SR), SR);
    const bars = Math.round(SECONDS / BAR);
    scoreMusic(off, off.destination, {
      rows: Array.from({ length: bars }, (_, b) => [[38, 34, 41, 36][b % 4], b % 4 === 0, b === 0 ? 'tense' : b === 1 ? 'build' : b === bars - 1 ? 'end' : 'top'] as [number, boolean, 'tense' | 'build' | 'top' | 'end']),
      hits: [[2 * BAR, 1.15], [4 * BAR, 0.9], [6 * BAR, 0.95], [(bars - 1) * BAR, 1.25]],
      risers: [[0.25, 2 * BAR - 0.04, 1], [(bars - 2) * BAR + 0.7, (bars - 1) * BAR, 0.7]],
    });
    const buf = await off.startRendering();
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let n = 0; n < d.length; n++) d[n] = Math.tanh(d[n] * 1.15) * 0.97;
    }
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => console.error('[film] audio', e.message) });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 192_000 });
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let n = 0; n < buf.length; n += 4800) {
      const m = Math.min(4800, buf.length - n), data = new Float32Array(m * 2);
      data.set(L.subarray(n, n + m), 0);
      data.set(R.subarray(n, n + m), m);
      aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: m, numberOfChannels: 2, timestamp: Math.round((n * 1e6) / SR), data }));
      while (aenc.encodeQueueSize > 8) await pause(2);
    }
    await aenc.flush();
  }
  muxer.finalize();
  const bytes = new Uint8Array(muxer.target.buffer);
  const win = window as unknown as { posterDone: boolean; posterFilm: Uint8Array };
  win.posterFilm = bytes;
  if (q.get('post')) await fetch(`http://127.0.0.1:5199/?name=${q.get('post')}`, { method: 'POST', body: new Blob([bytes], { type: 'video/mp4' }) }).catch(() => {});
  console.log(`[film] ${SECONDS.toFixed(2)} s, ${FRAMES} frames, ${(bytes.length / 1048576).toFixed(1)} MB`);
  win.posterDone = true;
}

await (q.get('film') ? film() : still());
