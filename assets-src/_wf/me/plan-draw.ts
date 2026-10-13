// npx tsx assets-src/_wf/me/plan-draw.ts <hospital|police_hq> <out dir>
// A building of several floors, drawn flat from its plan (src/world/big-buildings.ts) with nothing rendered: each
// floor from above (walls, their doors and windows, the stairwells, every piece of furniture at its real size and
// turn, the places for things), and its four sides as they stand (every window and door, floor over floor). And it
// is checked by rule: furniture standing in a wall, in another piece, or in a doorway; a wall that ends in a window.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { assets } from '../../../src/core/assets';
import { flatsPlan, hospitalLobbyPlan, hospitalPlan, hospitalWingPlan, policeCellsPlan, policeGaragePlan, policeHqPlan } from '../../../src/world/big-buildings';
import type { Furn, Opening, WallDef } from '../../../src/world/buildings';

const [which = 'hospital', out = 'assets-src/_wf/me/out-plan'] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync('public/assets/manifest.json', 'utf8')) as { models: Record<string, { min: number[]; max: number[] }> };
(assets as { manifest: unknown }).manifest = manifest;
const PLANS = { flats: () => flatsPlan('brick_ext', 'roof_tiles', 'floor_wood'), hospital: hospitalPlan, hospital_wing: hospitalWingPlan, hospital_lobby: hospitalLobbyPlan, police_hq: policeHqPlan, police_cells: policeCellsPlan, police_garage: policeGaragePlan };
if (!(which in PLANS)) throw new Error(`no plan called ${which}: ${Object.keys(PLANS).join(', ')}`);
const bp = PLANS[which as keyof typeof PLANS]();
const joined = new Set<string>(bp.joined ?? []);
fs.mkdirSync(out, { recursive: true });
const T = 0.2, hw = bp.w / 2, hd = bp.d / 2;
const S = Math.min(26, Math.floor(1500 / (bp.w + 5))), M = Math.round(2.6 * S);
const W = Math.round(bp.w * S + M * 2), H = Math.round(bp.d * S + M * 2);
// (the front, +z, is drawn at the top)
const X = (x: number) => M + (x + hw) * S, Y = (z: number) => M + (hd - z) * S;

type Seg = { ax: number; az: number; bx: number; bz: number; along: 'x' | 'z'; ops: Opening[]; name: string };
const segs = (walls: WallDef[]): Seg[] => walls.map((w, k) => {
  const [a, b] = w.side === 'front' ? [[-hw, hd - T / 2], [hw, hd - T / 2]] : w.side === 'back' ? [[-hw, -hd + T / 2], [hw, -hd + T / 2]] : w.side === 'left' ? [[-hw + T / 2, -hd], [-hw + T / 2, hd]] : w.side === 'right' ? [[hw - T / 2, -hd], [hw - T / 2, hd]] : [w.from!, w.to!];
  const along = Math.abs(a[0] - b[0]) > Math.abs(a[1] - b[1]) ? 'x' : 'z';
  return { ax: Math.min(a[0], b[0]), az: Math.min(a[1], b[1]), bx: Math.max(a[0], b[0]), bz: Math.max(a[1], b[1]), along, ops: w.openings, name: w.side === 'inner' ? `inner ${k} (${a.join(', ')} to ${b.join(', ')})` : w.side };
});
/** the solid lengths of a wall: what is left of it between its doors and gaps (windows are wall, to whatever stands on the floor) */
const solid = (s: Seg) => {
  const [lo, hi] = s.along === 'x' ? [s.ax, s.bx] : [s.az, s.bz];
  const cuts = s.ops.filter((o) => o.kind === 'door' || o.kind === 'gap').map((o) => [Math.min(o.a, o.b), Math.max(o.a, o.b)]).sort((p, q) => p[0] - q[0]);
  const parts: [number, number][] = [];
  let from = lo;
  for (const [a, b] of cuts) {
    if (a > from) parts.push([from, Math.min(a, hi)]);
    from = Math.max(from, b);
  }
  if (from < hi) parts.push([from, hi]);
  return parts;
};
type Poly = [number, number][];
const rect = (x0: number, z0: number, x1: number, z1: number): Poly => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const foot = (f: Furn): Poly => {
  const e = manifest.models[f.id], k = f.scale ?? 1;
  if (!e) return rect(f.x - 0.2, f.z - 0.2, f.x + 0.2, f.z + 0.2);
  const hx = ((e.max[0] - e.min[0]) / 2) * k, hz = ((e.max[2] - e.min[2]) / 2) * k, c = Math.cos(f.rot), s = Math.sin(f.rot);
  return ([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]] as Poly).map(([lx, lz]) => [f.x + lx * c + lz * s, f.z - lx * s + lz * c]);
};
/** how far two shapes are into each other (0: they do not touch): the least they would have to be moved apart */
const into = (A: Poly, B: Poly) => {
  let least = Infinity;
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length], nx = z1 - z0, nz = x0 - x1, l = Math.hypot(nx, nz) || 1;
    const pr = (Q: Poly) => Q.map(([x, z]) => (x * nx + z * nz) / l);
    const a = pr(A), b = pr(B), o = Math.min(Math.max(...a), Math.max(...b)) - Math.max(Math.min(...a), Math.min(...b));
    if (o <= 0) return 0;
    least = Math.min(least, o);
  }
  return least;
};

const floors: { name: string; walls: WallDef[]; furniture: Furn[]; loot: [number, number, number][]; h: number }[] = [
  { name: 'ground', walls: bp.walls, furniture: bp.furniture, loot: bp.loot, h: bp.h },
  ...(bp.levels ?? []).map((l, k) => ({ name: `floor ${k + 1}`, walls: l.walls, furniture: l.furniture, loot: l.loot, h: l.h })),
  ...(bp.upper ? [{ name: 'floor 1', walls: bp.upper.walls, furniture: bp.upper.furniture, loot: bp.upper.loot, h: bp.upper.h }] : []),
  ...(bp.deck ? [{ name: 'roof', walls: bp.deck.walls, furniture: bp.deck.furniture, loot: bp.deck.loot, h: bp.deck.h }] : []),
];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let report = '';
const say = (s: string) => {
  report += s + '\n';
  console.log(s);
};
for (const [fi, fl] of floors.entries()) {
  const ss = segs(fl.walls.filter((w) => fl.name !== 'roof' || w.side === 'inner'));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Arial" font-size="9"><rect width="100%" height="100%" fill="#f4f1e6"/>`;
  // the grid the windows stand on, if the plan says one (every 3.2 m from the middle)
  for (let gx = -Math.floor(hw / 3.2) * 3.2; gx <= hw; gx += 3.2) svg += `<line x1="${X(gx)}" y1="${M - 12}" x2="${X(gx)}" y2="${H - M + 12}" stroke="#c9c2a8" stroke-dasharray="3 5"/><text x="${X(gx) + 2}" y="${M - 14}" fill="#8a8468">${gx.toFixed(1)}</text>`;
  for (let gz = Math.ceil(-hd); gz <= hd; gz += 2) svg += `<text x="6" y="${Y(gz) + 3}" fill="#8a8468">z ${gz}</text>`;
  if (bp.stairs) svg += `<rect x="${X(bp.stairs.x0)}" y="${Y(Math.max(bp.stairs.foot, bp.stairs.top))}" width="${(bp.stairs.x1 - bp.stairs.x0) * S}" height="${Math.abs(bp.stairs.top - bp.stairs.foot) * S}" fill="#d9d2ba" stroke="#8a8468"/><text x="${X((bp.stairs.x0 + bp.stairs.x1) / 2)}" y="${Y((bp.stairs.foot + bp.stairs.top) / 2)}" text-anchor="middle" fill="#6b654e">stairs</text>`;
  for (const wl of bp.wells ?? []) svg += `<rect x="${X(wl.x0)}" y="${Y(Math.max(wl.land, wl.far))}" width="${(wl.x1 - wl.x0) * S}" height="${Math.abs(wl.far - wl.land) * S}" fill="#d9d2ba" stroke="#8a8468"/><text x="${X((wl.x0 + wl.x1) / 2)}" y="${Y((wl.land + wl.far) / 2)}" text-anchor="middle" fill="#6b654e">stairs</text>`;
  for (const es of bp.escapes ?? []) {
    // (the landing at the doors, the two flights, the landing half way: as the generator lays them)
    const along = es.side === 'left' || es.side === 'right', o = es.side === 'left' || es.side === 'back' ? -1 : 1, base = es.side === 'left' ? -hw : es.side === 'right' ? hw : es.side === 'front' ? hd : -hd;
    const box = (a0: number, a1: number, fill: string, label = '') => {
      const lo = es.at + es.dir * a0, hi = es.at + es.dir * a1, [u0, u1] = [Math.min(lo, hi), Math.max(lo, hi)], [v0, v1] = [Math.min(base, base + o * 2), Math.max(base, base + o * 2)];
      const r = along ? rect(v0, u0, v1, u1) : rect(u0, v0, u1, v1);
      svg += `<rect x="${X(r[0][0])}" y="${Y(r[2][1])}" width="${(r[1][0] - r[0][0]) * S}" height="${(r[2][1] - r[0][1]) * S}" fill="${fill}" fill-opacity="0.5" stroke="#333"/>` + (label ? `<text x="${X((r[0][0] + r[1][0]) / 2)}" y="${Y((r[0][1] + r[2][1]) / 2) + 3}" text-anchor="middle" font-size="7" fill="#111">${label}</text>` : '');
    };
    if (fi === 0 || fi <= es.floors || (es.roof && fl.name === 'roof')) {
      box(-0.85, 0.85, fi === 0 ? '#bbb' : '#7d8a94', fi === 0 ? '' : 'landing');
      box(0.85, 3.25, '#a9b4bc', 'stairs');
      box(3.25, 4.25, '#7d8a94');
    }
  }
  const walls: Poly[] = [], doors: { p: Poly; name: string }[] = [];
  for (const s of ss) {
    for (const [a, b] of solid(s)) {
      const r = s.along === 'x' ? rect(a, s.az - T / 2, b, s.az + T / 2) : rect(s.ax - T / 2, a, s.ax + T / 2, b);
      walls.push(r);
      svg += `<rect x="${X(r[0][0])}" y="${Y(r[2][1])}" width="${(r[1][0] - r[0][0]) * S}" height="${(r[2][1] - r[0][1]) * S}" fill="#2b2a26"/>`;
    }
    for (const o of s.ops) {
      const a = Math.min(o.a, o.b), b = Math.max(o.a, o.b);
      const r = s.along === 'x' ? rect(a, s.az - T / 2, b, s.az + T / 2) : rect(s.ax - T / 2, a, s.ax + T / 2, b);
      const col = o.kind === 'window' ? '#5aa7d6' : o.kind === 'grille' ? '#b0582a' : o.kind === 'door' ? '#c9a23c' : 'none';
      if (col !== 'none') svg += `<rect x="${X(r[0][0])}" y="${Y(r[2][1])}" width="${(r[1][0] - r[0][0]) * S}" height="${(r[2][1] - r[0][1]) * S}" fill="${col}" opacity="${o.kind === 'door' ? 0.55 : 0.9}"/>`;
      // (a doorway, and a pace either side of it: nothing stands there)
      if (o.kind === 'door' || o.kind === 'gap') doors.push({ p: s.along === 'x' ? rect(a + 0.08, s.az - 0.75, b - 0.08, s.az + 0.75) : rect(s.ax - 0.75, a + 0.08, s.ax + 0.75, b - 0.08), name: `${o.kind} ${a.toFixed(1)}..${b.toFixed(1)} in ${s.name}` });
    }
    // a wall that meets an outside wall inside one of its windows
    for (const t of ss) {
      if (t === s || t.along === s.along || !['front', 'back', 'left', 'right'].includes(t.name)) continue;
      const at = s.along === 'z' ? s.ax : s.az, reaches = s.along === 'z' ? (Math.abs(s.az - t.az) < 0.5 || Math.abs(s.bz - t.az) < 0.5) : (Math.abs(s.ax - t.ax) < 0.5 || Math.abs(s.bx - t.ax) < 0.5);
      if (!reaches) continue;
      for (const o of t.ops) if (o.kind === 'window' && at > Math.min(o.a, o.b) - 0.12 && at < Math.max(o.a, o.b) + 0.12) say(`  ${fl.name}: ${s.name} ends in a window of the ${t.name} wall (${Math.min(o.a, o.b).toFixed(1)}..${Math.max(o.a, o.b).toFixed(1)})`);
    }
  }
  const feet = fl.furniture.map((f) => ({ f, p: foot(f), y: f.y ?? 0 }));
  for (const [k, a] of feet.entries()) {
    let bad = '';
    // (what hangs on a wall or from the ceiling stands on nothing)
    const hung = a.y > 0.4;
    for (const w of walls) {
      const d = into(a.p, w);
      if (d > 0.04) bad = `in a wall by ${(d * 100).toFixed(0)} cm`;
    }
    if (!hung) for (const dr of doors) if (into(a.p, dr.p) > 0.06) bad ||= `in the way of a ${dr.name}`;
    if (!hung) for (const [j, b] of feet.entries()) if (j > k && b.y <= 0.4 && Math.abs(a.y - b.y) < 0.3 && into(a.p, b.p) > 0.05 && a.f.id !== 'folded_blanket' && b.f.id !== 'folded_blanket') bad ||= `in ${b.f.id} at ${b.f.x}, ${b.f.z}`;
    // what stands against an outside wall across one of its windows, and is taller than the sill
    const e = manifest.models[a.f.id];
    const tall = a.y + (e ? (e.max[1] - Math.min(0, e.min[1])) * (a.f.scale ?? 1) : 0);
    if (!hung && fl.name !== 'roof') for (const t of ss) {
      if (!['front', 'back', 'left', 'right'].includes(t.name)) continue;
      for (const o of t.ops) {
        if (o.kind !== 'window' || tall < o.bottom + 0.35) continue;
        const lo = Math.min(o.a, o.b), hi = Math.max(o.a, o.b);
        const strip = t.along === 'x' ? rect(lo + 0.15, t.az - 0.75, hi - 0.15, t.az + 0.75) : rect(t.ax - 0.75, lo + 0.15, t.ax + 0.75, hi - 0.15);
        if (into(a.p, strip) > 0.12) bad ||= `across a window of the ${t.name} wall (${lo.toFixed(1)}..${hi.toFixed(1)}), ${tall.toFixed(2)} m tall, sill ${o.bottom}`;
      }
    }
    const lim = (side: string, half: number) => (joined.has(side) ? half + 0.01 : half - T + 0.03);
    if (Math.max(...a.p.map((q) => q[0])) > lim('right', hw) || Math.min(...a.p.map((q) => q[0])) < -lim('left', hw) || Math.max(...a.p.map((q) => q[1])) > lim('front', hd) || Math.min(...a.p.map((q) => q[1])) < -lim('back', hd)) bad ||= 'through an outside wall';
    if (bad) say(`  ${fl.name}: ${a.f.id} at ${a.f.x}, ${a.f.z} is ${bad}`);
    const col = bad ? '#d62a1a' : hung ? '#7a56b8' : /bed/.test(a.f.id) ? '#3d7a4a' : /shel|case|cabinet|locker/i.test(a.f.id) ? '#8a5a2b' : '#4b6f9a';
    svg += `<polygon points="${a.p.map(([x, z]) => `${X(x).toFixed(1)},${Y(z).toFixed(1)}`).join(' ')}" fill="${col}" fill-opacity="${hung ? 0.25 : 0.5}" stroke="${col}" stroke-width="${bad ? 2 : 1}"/>`;
    svg += `<text x="${X(a.f.x)}" y="${Y(a.f.z) + 3}" text-anchor="middle" font-size="7" fill="#111">${esc(a.f.id.replace(/_0?1$/, '').replace(/^(hospital|painted_wooden|metal_office|steel_frame|wooden)_/, '').slice(0, 11))}</text>`;
  }
  for (const [x, y, z] of fl.loot) svg += `<circle cx="${X(x)}" cy="${Y(z)}" r="2.2" fill="${y < 0.1 ? '#e0b400' : '#19a04b'}" stroke="#000" stroke-width="0.4"/>`;
  svg += `<text x="${M}" y="16" font-size="13" fill="#222">${esc(which)} · ${fl.name} · ${fl.furniture.length} things, ${fl.loot.length} places · front (the street) at the top</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, `${which}-plan-${fi}-${fl.name.replace(' ', '')}.png`));
}

// ---- its four sides
const storeys = [{ y: 0, h: bp.h, walls: bp.walls }, ...(bp.levels ?? []).reduce<{ y: number; h: number; walls: WallDef[] }[]>((acc, l) => {
  const prev = acc.length ? acc[acc.length - 1] : { y: 0, h: bp.h };
  acc.push({ y: prev.y + prev.h + 0.2, h: l.h, walls: l.walls });
  return acc;
}, [])];
const top = storeys[storeys.length - 1].y + storeys[storeys.length - 1].h + 0.2 + (bp.deck?.parapet ?? 0);
const PAINT: Record<string, string> = { hosp_ext: '#d8cc9e', ochre_ext: '#cfa862', trim_white: '#ece8da', plinth: '#8c8a82', brick_ext: '#9a5a44', concrete: '#a9a8a2', roof_iron: '#5f6a6e', steel: '#6d7478', planks: '#7a5a38', wood: '#7a5a38' };
const paint = (k: string) => PAINT[k] ?? '#b9b2a0';
const dress = bp.dress, outside = (bp.fittings ?? []).filter((f) => f.level === 0).flatMap((f) => f.list);
for (const side of ['front', 'back', 'left', 'right'] as const) {
  const long = side === 'front' || side === 'back', len = long ? bp.w : bp.d, E = Math.min(30, Math.floor(1400 / (len + 8)));
  const skyTop = top + 5.5, w = Math.round((len + 8) * E + 80), h = Math.round((skyTop + 1.2) * E + 50);
  // (seen from outside: the front with -x at the left, the back with +x at the left)
  const ex = (v: number) => 40 + 4 * E + (side === 'front' || side === 'right' ? v + len / 2 : len / 2 - v) * E, ey = (y: number) => h - 20 - (y + 1.2) * E;
  const box = (a: number, b2: number, y0: number, y1: number, fill: string, extra = '') => `<rect x="${Math.min(ex(a), ex(b2))}" y="${ey(y1)}" width="${Math.abs(ex(b2) - ex(a))}" height="${(y1 - y0) * E}" fill="${fill}" ${extra}/>`;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Arial" font-size="10"><rect width="100%" height="100%" fill="#dfe6ea"/><rect x="0" y="${ey(0)}" width="${w}" height="${h}" fill="#7f8a62"/>`;
  // what stands behind the face and over it (the far side's things are left out): the roof's boxes, where they rise over the wall round it
  const roofY = storeys[storeys.length - 1].y + storeys[storeys.length - 1].h + 0.2;
  for (const f of bp.deck?.boxes ?? []) {
    const [a, b2] = long ? [f.x0, f.x1] : [f.z0, f.z1];
    svg += box(a, b2, roofY + f.y0, roofY + f.y1, paint(f.key), 'stroke="#555" stroke-width="0.5" opacity="0.9"');
  }
  svg += box(-len / 2, len / 2, 0, top, paint(bp.ext), 'stroke="#333"');
  // the things that stand outside against the other sides, seen end on
  const here = (f: { x0: number; x1: number; z0: number; z1: number }) => (side === 'front' ? f.z1 > hd : side === 'back' ? f.z0 < -hd : side === 'left' ? f.x0 < -hw : f.x1 > hw);
  for (const f of outside) if (!here(f)) {
    const [a, b2] = long ? [f.x0, f.x1] : [f.z0, f.z1];
    if (Math.min(a, b2) < -len / 2 - 0.05 || Math.max(a, b2) > len / 2 + 0.05 || f.y1 > top) svg += box(a, b2, Math.min(a, b2) < -len / 2 - 0.05 || Math.max(a, b2) > len / 2 + 0.05 ? Math.max(f.y0, -0.3) : top, f.y1, paint(f.key), 'stroke="#555" stroke-width="0.5"');
  }
  if (dress?.plinth) svg += box(-len / 2, len / 2, 0, dress.plinth.h, paint(dress.plinth.key));
  if (dress?.bands) {
    for (const st of storeys.slice(1)) svg += box(-len / 2, len / 2, st.y - 0.26, st.y + 0.04, paint(dress.bands), 'stroke="#99937c" stroke-width="0.5"');
    svg += box(-len / 2, len / 2, roofY - 0.3, roofY + 0.05, paint(dress.bands), 'stroke="#99937c" stroke-width="0.5"');
    svg += box(-len / 2, len / 2, top - 0.1, top + 0.06, paint(dress.bands), 'stroke="#99937c" stroke-width="0.5"');
  }
  for (const at of dress?.piers?.[side] ?? []) svg += box(at - dress!.piers!.w / 2, at + dress!.piers!.w / 2, dress?.plinth?.h ?? 0, top, paint(dress!.piers!.key), 'stroke="#99937c" stroke-width="0.5"');
  for (const st of storeys) {
    for (const o of st.walls.find((q) => q.side === side)?.openings ?? []) {
      const lo = Math.min(o.a, o.b), hi = Math.max(o.a, o.b);
      svg += box(lo, hi, st.y + o.bottom, st.y + o.top, o.kind === 'door' ? '#5b4630' : o.kind === 'gap' ? '#222' : '#2f4f66', 'stroke="#111"');
      if (o.kind === 'window' && dress?.trim) svg += box(lo - 0.12, hi + 0.12, st.y + o.top, st.y + o.top + 0.17, paint(dress.trim), 'stroke="#99937c" stroke-width="0.5"') + box(lo - 0.1, hi + 0.1, st.y + o.bottom - 0.125, st.y + o.bottom - 0.044, paint(dress.trim), 'stroke="#99937c" stroke-width="0.5"');
      if (o.boards) for (let k = 0; k < 5; k++) svg += box(lo - 0.16, hi + 0.16, st.y + o.bottom + ((o.top - o.bottom) * (k + 0.2)) / 5, st.y + o.bottom + ((o.top - o.bottom) * (k + 0.8)) / 5, '#7a5a38', 'stroke="#3c2a16" stroke-width="0.5"');
      if (o.bars) for (let k = 1; k < 9; k++) svg += `<line x1="${ex(lo + ((hi - lo) * k) / 9)}" y1="${ey(st.y + o.top)}" x2="${ex(lo + ((hi - lo) * k) / 9)}" y2="${ey(st.y + o.bottom)}" stroke="#15181a" stroke-width="1.4"/>`;
    }
  }
  // what stands against this side
  for (const f of outside) if (here(f)) {
    const [a, b2] = long ? [f.x0, f.x1] : [f.z0, f.z1];
    svg += box(a, b2, Math.max(f.y0, -0.3), f.y1, paint(f.key), 'stroke="#444" stroke-width="0.6"');
  }
  if (bp.sign && side === 'front') svg += box(bp.sign.x - 2.2, bp.sign.x + 2.2, bp.sign.y - 0.42, bp.sign.y + 0.42, bp.sign.board ?? '#ddd', 'stroke="#333"') + `<text x="${ex(bp.sign.x)}" y="${ey(bp.sign.y) + 4}" text-anchor="middle" font-size="${Math.round(E * 0.5)}" fill="${bp.sign.ink ?? '#222'}">${esc(bp.sign.text)}</text>`;
  svg += `<text x="40" y="14" font-size="13" fill="#222">${esc(which)} · ${side}, from outside</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, `${which}-side-${side}.png`));
}
fs.writeFileSync(path.join(out, `${which}-report.txt`), report || 'nothing found\n');
console.log(`${which}: ${floors.length} floors drawn into ${out}${report ? '' : '; nothing found by rule'}`);
