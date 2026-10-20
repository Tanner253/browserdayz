// Where the big map's names go, so that none lies on another (the owner, 2026-10-19, of the whole map: "this map looks
// too busy can you open a 2nd path to make the UX better"). Placed by rank: the gas's words, as they warn; the towns;
// the places that matter (the bunker, the fort, the works, the army's and the police's); then the small places' marks,
// the towers and the cabins, whose names wait until the sheet is brought nearer (or one is pointed at, see bigmap.ts);
// and last the regions' big names, wherever near their own ground there is room. A name with no room where it stands is
// tried below its place, then beside its mark either way, then shortened; with none at all its mark stands alone.

import type { MenuSpot } from './hud';

/** a rectangle of the picture, pixels: west, north, east, south */
export type Box = [number, number, number, number];
/** words as they are to be written: where their baseline is, how they stand against it, their size (CSS pixels) */
export interface Name { text: string; x: number; y: number; align: CanvasTextAlign; size: number; weight: number }
/** a place's mark (its sign in a disc) where it is drawn, and its name if there is room for it */
export interface Mark { s: MenuSpot; x: number; y: number; r: number; size: number; name?: Name }
export interface Laid { marks: Mark[]; regions: (Name & { colour: string })[]; gas: (Name | null)[] }

/** the small places: a mark at any distance, a name only nearer */
const SMALL = new Set(['Watchtower', 'Hunting tower']);
/** said shorter where the whole will not go */
const SHORT: Record<string, string> = { 'Police headquarters': 'Police HQ', 'Military Checkpoint': 'Checkpoint', 'Police station': 'Police', 'Chemical Works': 'Works' };
/** how near the sheet is before the small places' names are written, and before the unnamed ones are marked at all */
const NAMES_AT = { pc: 1.8, touch: 2.6 }, MARKS_AT = { pc: 1.2, touch: 1.8 };

/** 0 a town, 1 a place that matters (named on the map at any distance), 2 a tower, a cabin, a clinic */
function rank(s: MenuSpot) {
  if (s.label && s.kind === 'town') return 0;
  if ((s.label && !SMALL.has(s.name)) || s.kind === 'police' || s.name === 'Hospital') return 1;
  return 2;
}

export function layNames(o: {
  spots: MenuSpot[];
  regions: { name: string; x: number; z: number; colour: string }[];
  gases: { x: number; z: number; r: number }[];
  /** world to picture */
  sx: (x: number) => number;
  sy: (z: number) => number;
  W: number;
  H: number;
  /** picture pixels to a CSS pixel, and to a metre */
  u: number;
  k: number;
  zoom: number;
  touch: boolean;
  names: boolean;
  /** what is on the picture already: the title, the compass, the legend, the grid's bands, the Zona's words */
  taken: Box[];
  /** how wide words are written, picture pixels */
  measure: (text: string, size: number, weight: number, spacing: number) => number;
}): Laid {
  const { sx, sy, u, zoom, measure } = o, taken = [...o.taken], small = o.touch ? 0.82 : 1;
  const out: Laid = { marks: [], regions: [], gas: o.gases.map(() => null) };
  // (and nothing over the picture's edge, where the frame is: HOSPITAL was cut in half there)
  const edge = 8 * u, hit = (b: Box, own?: Box) => b[0] < edge || b[1] < edge || b[2] > o.W - edge || b[3] > o.H - edge || taken.some((q) => q !== own && b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
  const on = (px: number, py: number, m: number) => px > -m && py > -m && px < o.W + m && py < o.H + m;
  /** the box words take, their dark halo in it */
  const boxOf = (n: Name, spacing = 0.08): Box => {
    const w = measure(n.text, n.size, n.weight, spacing), s = n.size * u, pad = s * 0.16 + 1.5 * u;
    const x0 = n.align === 'center' ? n.x - w / 2 : n.align === 'right' ? n.x - w : n.x;
    return [x0 - pad, n.y - s * 0.78 - pad, x0 + w + pad, n.y + s * 0.16 + pad];
  };
  const disc = (x: number, y: number, r: number): Box => [x - r - u, y - r - u, x + r + u, y + r + u];

  // the gas's words first, as they warn: under its ground, over it or beside it, and just GAS where those will not go
  o.gases.forEach((gz, i) => {
    const qx = sx(gz.x), qy = sy(gz.z), qr = gz.r * o.k;
    if (!on(qx, qy, Math.abs(qr))) return;
    const fit = ['GAS · MASK NEEDED', 'GAS']
      .flatMap((text): Name[] => [
        { text, x: qx, y: qy + qr + 16 * u, align: 'center', size: 13, weight: 700 },
        { text, x: qx, y: qy - qr - 8 * u, align: 'center', size: 13, weight: 700 },
        { text, x: qx + qr + 8 * u, y: qy + 4 * u, align: 'left', size: 13, weight: 700 },
        { text, x: qx - qr - 8 * u, y: qy + 4 * u, align: 'right', size: 13, weight: 700 },
      ])
      .find((n) => !hit(boxOf(n)));
    if (fit) {
      taken.push(boxOf(fit));
      out.gas[i] = fit;
    }
  });

  // the towns and the places that matter: the name over the place with its mark before it, or below, or beside the mark
  const big = o.names ? o.spots.filter((s) => rank(s) < 2 && on(sx(s.x), sy(s.z), 80 * u)) : [];
  big.sort((a, b) => rank(a) - rank(b) || Number(!!b.label) - Number(!!a.label));
  for (const s of big) {
    const px = sx(s.x), py = sy(s.z), size = (s.label ? 16 : 13) * small, h = size * u, r = size * 0.62 * u;
    const weight = s.label ? 700 : 600;
    const tries = (text: string): Mark[] => {
      const w = measure(text, size, weight, 0.08), above = py - 9 * u, below = py + 9 * u + h * 0.7;
      return [
        { s, x: px - w / 2 - r - 4 * u, y: above - h * 0.34, r, size, name: { text, x: px, y: above, align: 'center', size, weight } },
        { s, x: px - w / 2 - r - 4 * u, y: below - h * 0.34, r, size, name: { text, x: px, y: below, align: 'center', size, weight } },
        { s, x: px, y: py, r, size, name: { text, x: px + r + 4 * u, y: py + h * 0.34, align: 'left', size, weight } },
        { s, x: px, y: py, r, size, name: { text, x: px - r - 4 * u, y: py + h * 0.34, align: 'right', size, weight } },
      ];
    };
    const short = SHORT[s.name];
    const fit = [...tries(s.name.toUpperCase()), ...(short ? tries(short.toUpperCase()) : [])].find((m) => {
      const t = boxOf(m.name!), d = disc(m.x, m.y, m.r);
      return !hit(t) && !hit(d);
    });
    if (fit) {
      taken.push(boxOf(fit.name!), disc(fit.x, fit.y, fit.r));
      out.marks.push(fit);
    } else if (!hit(disc(px, py, r))) {
      taken.push(disc(px, py, r));
      out.marks.push({ s, x: px, y: py, r, size });
    }
  }

  // the small places: every mark that has room first, then the names beside them, nearer
  if (o.names) {
    const marks: Mark[] = [], discs: Box[] = [];
    const size = 13 * small, r = 7 * u * small, h = size * u;
    for (const s of o.spots) {
      if (rank(s) < 2 || s.kind === 'spawn' || s.kind === 'well') continue;
      if (!s.label && zoom < (o.touch ? MARKS_AT.touch : MARKS_AT.pc)) continue;
      const px = sx(s.x), py = sy(s.z), d = disc(px, py, r);
      if (!on(px, py, 20 * u) || hit(d)) continue;
      taken.push(d);
      discs.push(d);
      marks.push({ s, x: px, y: py, r, size });
    }
    if (zoom >= (o.touch ? NAMES_AT.touch : NAMES_AT.pc)) {
      for (const [i, m] of marks.entries()) {
        const own = discs[i], short = SHORT[m.s.name];
        const fit = [m.s.name, ...(short ? [short] : [])].flatMap((t) => [
          { text: t.toUpperCase(), x: m.x + m.r + 4 * u, y: m.y + h * 0.34, align: 'left' as const, size, weight: 600 },
          { text: t.toUpperCase(), x: m.x - m.r - 4 * u, y: m.y + h * 0.34, align: 'right' as const, size, weight: 600 },
        ]).find((n) => !hit(boxOf(n), own));
        if (fit) {
          taken.push(boxOf(fit));
          m.name = fit;
        }
      }
    }
    out.marks.unshift(...marks);
  }

  // the regions, large and faint, wherever near their own ground nothing is: at any distance but the nearest
  if (o.names && zoom < 5) {
    const size = Math.min(34, 20 + zoom * 4) * (o.touch ? 0.8 : 1), s = size * u;
    for (const g of o.regions) {
      const px = sx(g.x), py = sy(g.z);
      if (!on(px, py, 300 * u)) continue;
      const fit = [[0, 0], [0, -1.1], [0, 1.1], [-3, 0], [3, 0], [0, -2.2], [0, 2.2], [-3, -1.1], [3, 1.1]]
        .map(([dx, dy]): Name => ({ text: g.name, x: px + dx * s, y: py + dy * s, align: 'center', size, weight: 700 }))
        .find((n) => !hit(boxOf(n, 0.22)));
      if (fit) {
        taken.push(boxOf(fit, 0.22));
        out.regions.push({ ...fit, colour: g.colour });
      }
    }
  }
  return out;
}
