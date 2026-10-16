// THE PASS through the ridge, and its caves, as a plan (plan v5, the owner, 2026-10-16: "shelves that line the inside the
// canyon walls where cave entrences and exits are like terraces ... best loot in the center of the bottom of thhe
// canyon"). Pure, for the game and the server: the shape of the pass's walls, every cave as a run of galleries, what
// stops a body in them, where their mouths open the ground, where the loot lies, how dark it is in them, and where
// the rock pieces that dress the walls and line the caves stand. src/world/caves.ts draws it. Not placed: the
// world's generator carves the pass (it may carve it by `passProfile`) and says where its floor is.
//
// The pass's own measure: `s` metres along its middle line from its east mouth, `t` metres across it (north of the
// line is +), heights over its floor. Across, from the middle: the floor, then on each wall three shelves at
// SHELVES' heights, each reached by a steep riser (a face, dressed with cliff pieces so that it reads sheer), and past
// the third the ridge's own face. A cave's mouth is in a riser, at the foot of it, on the shelf below: its galleries
// run into the wall under the shelves above, never up through the ground over them.

export type V2 = [number, number];
export type V3 = [number, number, number];

/** The pass: its middle line (east to west), and its floor's height along it (the world's to say). */
export interface Pass {
  line: V2[];
  floor: (s: number) => number;
}

/** The pass the plan is laid for (plan v5: ~(-2030, -470) to ~(-2510, -446)), a gentle bend in it, its floor level. */
export function passOf(floor: (s: number) => number = () => 0): Pass {
  const a: V2 = [-2030, -470], b: V2 = [-2510, -446], line: V2[] = [];
  for (let i = 0; i <= 8; i++) {
    const k = i / 8, ux = b[0] - a[0], uz = b[1] - a[1], len = Math.hypot(ux, uz);
    // (a long S: some 14 m either side of the straight)
    const off = 14 * Math.sin(k * Math.PI * 2);
    line.push([a[0] + ux * k - (uz / len) * off, a[1] + uz * k + (ux / len) * off]);
  }
  return { line, floor };
}

/** The walls' shape, metres: the floor's half width, each shelf's height and depth, a riser's run for each metre it rises. */
export const PASS_SHAPE = {
  floor: 20,
  shelves: [
    { up: 8, deep: 6 },
    { up: 18, deep: 6 },
    { up: 30, deep: 5 },
  ],
  riser: 0.25,
  /** the ridge's face past the last shelf: its run for a metre's rise, and how high it goes over the floor */
  face: 0.55,
  crest: 75,
};

/** The edges across, from the middle, of each piece of the wall: [t at a riser's foot, t at its top] and the shelf's back. */
export function passEdges() {
  const out: { foot: number; top: number; from: number; to: number; back: number }[] = [];
  let t = PASS_SHAPE.floor, y = 0;
  for (const sh of PASS_SHAPE.shelves) {
    const top = t + (sh.up - y) * PASS_SHAPE.riser;
    out.push({ foot: t, top, from: y, to: sh.up, back: top + sh.deep });
    t = top + sh.deep;
    y = sh.up;
  }
  return out;
}

/** How high the ground is over the pass's floor `t` metres across from its middle (either way): its terraces. */
export function passProfile(t: number): number {
  const a = Math.abs(t), E = passEdges();
  if (a <= PASS_SHAPE.floor) return 0;
  for (const e of E) {
    if (a < e.top) return e.from + ((a - e.foot) / (e.top - e.foot)) * (e.to - e.from);
    if (a <= e.back) return e.to;
  }
  const last = E[E.length - 1];
  return Math.min(PASS_SHAPE.crest, last.to + (a - last.back) / PASS_SHAPE.face);
}

/** A point of the pass's line, and the way along it there, at `s` metres from its east end. */
export function alongPass(p: Pass, s: number): { x: number; z: number; ux: number; uz: number } {
  let left = Math.max(0, s);
  for (let i = 0; i + 1 < p.line.length; i++) {
    const [ax, az] = p.line[i], [bx, bz] = p.line[i + 1], len = Math.hypot(bx - ax, bz - az);
    if (left <= len || i + 2 === p.line.length) {
      const k = Math.min(1, left / len);
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, ux: (bx - ax) / len, uz: (bz - az) / len };
    }
    left -= len;
  }
  return { x: p.line[0][0], z: p.line[0][1], ux: 1, uz: 0 };
}

/** A spot given in the pass's measure (s along, t across, y over the floor), in the world's. */
export function passWorld(p: Pass, s: number, t: number, y: number): V3 {
  const o = alongPass(p, s);
  // (north of the line is +t: the line runs west, so north is to its right, (uz, -ux))
  return [o.x + o.uz * t, p.floor(s) + y, o.z - o.ux * t];
}

/** How long the pass's middle line is. */
export const passLength = (p: Pass) => p.line.reduce((sum, q, i) => (i ? sum + Math.hypot(q[0] - p.line[i - 1][0], q[1] - p.line[i - 1][1]) : 0), 0);

/**
 * A cave: the way through it, a node at each bend, in the pass's measure (s, t, y over the floor), how wide and how
 * high it is there; whether its first and last nodes are mouths (on a riser: the ground opened there); and what is
 * in it. The galleries between nodes are straight; at a node the walls go round.
 */
export interface Cave {
  name: string;
  what: string;
  nodes: { s: number; t: number; y: number; w: number; h: number }[];
  mouths: ('first' | 'last')[];
  /** where the loot lies: the node it is near, and how many places */
  loot: { at: number; n: number }[];
  /** old timber standing in it, a frame every few metres (a mine's adit) */
  timbered?: boolean;
}

const E = passEdges();
/** the foot of a riser on one wall (its mouth stands back in it by half a metre) */
const mouthT = (k: number, side: 1 | -1) => side * (E[k].foot + 0.5);

/** The caves, each unlike the others. */
export const CAVES: Cave[] = [
  {
    name: 'the hall',
    what: 'from the floor into a hall under the north wall, high enough to echo: the place to hold, and to be held in',
    nodes: [
      { s: 232, t: mouthT(0, 1), y: 0, w: 5, h: 4.5 },
      { s: 233, t: 30, y: 0, w: 6, h: 5.5 },
      { s: 240, t: 42, y: 0.5, w: 15, h: 10 },
      { s: 250, t: 48, y: 1, w: 9, h: 6 },
    ],
    mouths: ['first'],
    loot: [{ at: 2, n: 4 }, { at: 3, n: 2 }],
  },
  {
    name: 'the climb',
    what: 'in at the floor of the south wall, up inside it, out on the first shelf: the way up nobody watching the shelves sees',
    nodes: [
      { s: 150, t: mouthT(0, -1), y: 0, w: 4, h: 3.6 },
      { s: 151, t: -31, y: 0.3, w: 4.5, h: 4 },
      { s: 172, t: -34, y: 7.6, w: 4, h: 3.6 },
      { s: 179, t: mouthT(1, -1), y: 8, w: 4, h: 3.6 },
    ],
    mouths: ['first', 'last'],
    loot: [{ at: 1, n: 1 }],
  },
  {
    name: 'the squeeze',
    what: 'a narrow way in from the second shelf of the north wall, a body wide, to a cache room behind it',
    nodes: [
      { s: 305, t: mouthT(2, 1), y: 18, w: 3, h: 3 },
      { s: 305, t: 43, y: 18, w: 1.6, h: 2.3 },
      { s: 308, t: 47, y: 18, w: 1.6, h: 2.3 },
      { s: 310, t: 52, y: 18.2, w: 7, h: 4.2 },
    ],
    mouths: ['first'],
    loot: [{ at: 3, n: 3 }],
  },
  {
    name: 'the traverse',
    what: 'from the first shelf to the second on the north wall, climbing inside it: in on one shelf, out on the next',
    nodes: [
      { s: 92, t: mouthT(1, 1), y: 8, w: 4, h: 3.6 },
      { s: 92, t: 34, y: 8, w: 4.5, h: 4 },
      { s: 116, t: 41, y: 17.5, w: 4, h: 3.6 },
      { s: 121, t: mouthT(2, 1), y: 18, w: 4, h: 3.6 },
    ],
    mouths: ['first', 'last'],
    loot: [{ at: 1, n: 1 }, { at: 2, n: 1 }],
  },
  {
    name: 'the long way',
    what: 'from the third shelf of the south wall through the ridge to its west face over the desert: the way round the pass',
    nodes: [
      { s: 200, t: -(E[2].back - 0.2), y: 30, w: 3.6, h: 3.4 },
      { s: 204, t: -57, y: 30, w: 4, h: 3.6 },
      { s: 260, t: -64, y: 28, w: 3.6, h: 3.4 },
      { s: 300, t: -66, y: 27, w: 10, h: 6 },
      { s: 350, t: -70, y: 24.5, w: 3.6, h: 3.4 },
      { s: 392, t: -74, y: 22, w: 3.6, h: 3.4 },
      { s: 400, t: -74, y: 22, w: 3.6, h: 3.4 },
    ],
    mouths: ['first', 'last'],
    loot: [{ at: 3, n: 3 }],
  },
  {
    name: 'the adit',
    what: 'an old mine driven straight into the south wall from its second shelf, timbered, fallen in at its end',
    nodes: [
      { s: 382, t: mouthT(2, -1), y: 18, w: 3, h: 2.8 },
      { s: 382, t: -50, y: 18, w: 3, h: 2.8 },
      { s: 383, t: -62, y: 18.3, w: 3, h: 2.8 },
    ],
    mouths: ['first'],
    loot: [{ at: 2, n: 2 }],
    timbered: true,
  },
];

/** the best loot of all: on the pass's floor at its middle (~(-2270, -440)), among the rocks there */
export const FLOOR_CACHE = { s: 240, t: -6, n: 5, r: 7 };

/** A gallery: a straight run between two nodes, in the world's measure. */
export interface Gallery {
  cave: number;
  a: V3;
  b: V3;
  wa: number;
  wb: number;
  ha: number;
  hb: number;
}

/** The galleries of every cave, in the world. */
export function galleries(p: Pass): Gallery[] {
  const out: Gallery[] = [];
  CAVES.forEach((c, ci) => {
    for (let k = 0; k + 1 < c.nodes.length; k++) {
      const n0 = c.nodes[k], n1 = c.nodes[k + 1];
      out.push({ cave: ci, a: passWorld(p, n0.s, n0.t, n0.y), b: passWorld(p, n1.s, n1.t, n1.y), wa: n0.w, wb: n1.w, ha: n0.h, hb: n1.h });
    }
  });
  return out;
}

/** Where along a gallery a point is (0 to 1) and how far off its middle line, on the ground's plane. */
function onGallery(g: Gallery, x: number, z: number) {
  const ex = g.b[0] - g.a[0], ez = g.b[2] - g.a[2], L = ex * ex + ez * ez || 1e-9;
  const k = Math.max(0, Math.min(1, ((x - g.a[0]) * ex + (z - g.a[2]) * ez) / L));
  return { k, d: Math.hypot(x - g.a[0] - ex * k, z - g.a[2] - ez * k) };
}

/** Whether a point is in a cave, and in which (its gallery's floor and ceiling there): null outside every cave. */
export function caveAt(p: Pass, x: number, y: number, z: number, gs = galleries(p)): { cave: number; floor: number; ceiling: number; deep: number } | null {
  let best: { cave: number; floor: number; ceiling: number; deep: number } | null = null;
  for (const g of gs) {
    const { k, d } = onGallery(g, x, z), half = (g.wa + (g.wb - g.wa) * k) / 2 + 0.6;
    if (d > half) continue;
    const floor = g.a[1] + (g.b[1] - g.a[1]) * k, ceiling = floor + g.ha + (g.hb - g.ha) * k;
    if (y < floor - 1 || y > ceiling + 0.5) continue;
    // how far in from the nearest mouth, along the way (for how dark it is)
    const deep = distanceIn(p, g, k);
    if (!best || deep > best.deep) best = { cave: g.cave, floor, ceiling, deep };
  }
  return best;
}

/** Metres along a cave's way from its nearest mouth to a point a share `k` along one of its galleries. */
function distanceIn(p: Pass, g: Gallery, k: number): number {
  const c = CAVES[g.cave], gs = galleries(p).filter((q) => q.cave === g.cave), i = gs.indexOf(gs.find((q) => q.a[0] === g.a[0] && q.a[2] === g.a[2])!);
  const len = gs.map((q) => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1], q.b[2] - q.a[2]));
  const here = len.slice(0, i).reduce((a, b) => a + b, 0) + len[i] * k, total = len.reduce((a, b) => a + b, 0);
  return Math.min(c.mouths.includes('first') ? here : Infinity, c.mouths.includes('last') ? total - here : Infinity);
}

/**
 * How dark it is at a point in the caves, 0 to 1 (the day's light as good as gone): nothing at a mouth, all of it some
 * fifteen metres in. As the bunker and the cellars are dark (the game takes the darkest of them: `atmo.cover.ground`).
 */
export function caveDark(p: Pass, x: number, y: number, z: number, gs?: Gallery[]): number {
  const c = caveAt(p, x, y, z, gs);
  if (!c) return 0;
  const t = Math.min(1, Math.max(0, (c.deep - 2) / 13));
  return t * t * (3 - 2 * t);
}

/** A box that stops a body and a shot: its middle, its half sizes, its turn about the upright. */
export interface CaveBox {
  c: V3;
  h: V3;
  rot: number;
  /** its tilt about its own across, radians (a gallery that climbs) */
  pitch?: number;
}

/**
 * What stops a body in the caves: each gallery's floor and ceiling (tilted with it where it climbs) and its two walls;
 * and at every bend a ring of walls round the node, left open toward the galleries that meet there (a wall straight
 * across where a gallery would have gone on).
 */
export function caveSolids(p: Pass): CaveBox[] {
  const out: CaveBox[] = [], T = 0.6;
  const gs = galleries(p);
  for (const g of gs) {
    const ex = g.b[0] - g.a[0], ez = g.b[2] - g.a[2], run = Math.hypot(ex, ez), rise = g.b[1] - g.a[1];
    const rot = Math.atan2(ex, ez), pitch = -Math.atan2(rise, run), len = Math.hypot(run, rise), w = Math.max(g.wa, g.wb), h = Math.min(g.ha, g.hb);
    const mid: V3 = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2, (g.a[2] + g.b[2]) / 2];
    const side: V2 = [ez / run, -ex / run];
    out.push({ c: [mid[0], mid[1] - T, mid[2]], h: [w / 2 + T, T, len / 2], rot, pitch });
    out.push({ c: [mid[0], mid[1] + h + T, mid[2]], h: [w / 2 + T, T, len / 2], rot, pitch });
    for (const k of [-1, 1]) {
      const off = (Math.min(g.wa, g.wb) / 2 + T) * k;
      out.push({ c: [mid[0] + side[0] * off, mid[1] + h / 2 + 0.2, mid[2] + side[1] * off], h: [T, h / 2 + 0.8, len / 2], rot, pitch });
    }
  }
  // the bends: a ring of eight walls round each node, open toward its galleries (and at a mouth toward the outside)
  CAVES.forEach((c, ci) => c.nodes.forEach((n, k) => {
    const here = passWorld(p, n.s, n.t, n.y), ways: number[] = [];
    for (const j of [k - 1, k + 1]) if (j >= 0 && j < c.nodes.length) {
      const q = passWorld(p, c.nodes[j].s, c.nodes[j].t, c.nodes[j].y);
      ways.push(Math.atan2(q[0] - here[0], q[2] - here[2]));
    }
    // (a mouth is open outward, away from the gallery it begins)
    if ((k === 0 && c.mouths.includes('first')) || (k === c.nodes.length - 1 && c.mouths.includes('last'))) ways.push(ways[0] + Math.PI);
    const r = n.w / 2 + T;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, open = ways.some((w) => Math.abs(Math.atan2(Math.sin(a - w), Math.cos(a - w))) < 0.55);
      if (open) continue;
      // (a plank along the ring: its length across the way out from the node, its thickness along it)
      out.push({ c: [here[0] + Math.sin(a) * r, here[1] + n.h / 2, here[2] + Math.cos(a) * r], h: [r * 0.42, n.h / 2 + 0.8, T], rot: a });
    }
    out.push({ c: [here[0], here[1] + n.h + T, here[2]], h: [r, T, r], rot: 0 });
    out.push({ c: [here[0], here[1] - T, here[2]], h: [r, T, r], rot: 0 });
    void ci;
  }));
  return out;
}

/**
 * Where each mouth opens the ground: a rectangle on the ground's plane (its middle, its turn, its half sizes, as the
 * terrain's wells take them: src/world/terrain.ts openWells), from a metre out on the shelf in front of the riser to
 * the riser's top, a mouth's width across: only the riser's own face is opened (never the shelf above), and a lintel
 * of rock over the cave's roof closes the riser above the opening (see rockPieces). Its floor is the cave's at the mouth.
 */
export function caveMouths(p: Pass): { cave: number; x: number; z: number; rot: number; hx: number; hz: number; floor: number }[] {
  const out: { cave: number; x: number; z: number; rot: number; hx: number; hz: number; floor: number }[] = [];
  CAVES.forEach((c, ci) => {
    for (const which of c.mouths) {
      const n = which === 'first' ? c.nodes[0] : c.nodes[c.nodes.length - 1], m = which === 'first' ? c.nodes[1] : c.nodes[c.nodes.length - 2];
      const a = passWorld(p, n.s, n.t, n.y), b = passWorld(p, m.s, m.t, m.y), ux = b[0] - a[0], uz = b[2] - a[2], len = Math.hypot(ux, uz);
      // (from a metre out in front of it to the riser's top, or three metres in where it is in the ridge's own face)
      const k = E.findIndex((e) => Math.abs(Math.abs(n.t) - e.foot) < 1), back = 1, deep = k >= 0 ? E[k].top - E[k].foot + 0.3 : 3, cx = a[0] + (ux / len) * ((deep - back) / 2), cz = a[2] + (uz / len) * ((deep - back) / 2);
      out.push({ cave: ci, x: cx, z: cz, rot: Math.atan2(ux, uz), hx: n.w / 2 + 0.4, hz: (deep + back) / 2, floor: a[1] });
    }
  });
  return out;
}

/** Whether the ground is open at a point (a mouth over it): for physics.holes, beside the basements' wells. */
export function inMouth(mouths: ReturnType<typeof caveMouths>, x: number, z: number): boolean {
  for (const m of mouths) {
    const dx = x - m.x, dz = z - m.z, c = Math.cos(m.rot), sn = Math.sin(m.rot);
    if (Math.abs(dx * c - dz * sn) < m.hx && Math.abs(dx * sn + dz * c) < m.hz) return true;
  }
  return false;
}

/** The loot places of the caves (all of the fourth tier: caves are the second best there is) and the floor's cache (the fifth). */
export function caveLoot(p: Pass): { x: number; y: number; z: number; tier: 4 | 5; where: string }[] {
  const out: { x: number; y: number; z: number; tier: 4 | 5; where: string }[] = [];
  CAVES.forEach((c) => {
    for (const l of c.loot) {
      const n = c.nodes[l.at];
      for (let i = 0; i < l.n; i++) {
        // (round the node, against its walls: where a thing would be left, not in the way)
        const a = (i / Math.max(1, l.n)) * Math.PI * 2 + l.at, r = n.w / 2 - 0.7;
        const q = passWorld(p, n.s, n.t, n.y), o = alongPass(p, n.s);
        out.push({ x: q[0] + Math.cos(a) * r * o.ux - Math.sin(a) * r * o.uz * 0.6, y: q[1] + 0.02, z: q[2] + Math.cos(a) * r * o.uz + Math.sin(a) * r * o.ux * 0.6, tier: 4, where: c.name });
      }
    }
  });
  const F = FLOOR_CACHE;
  for (let i = 0; i < F.n; i++) {
    const a = (i / F.n) * Math.PI * 2, q = passWorld(p, F.s + Math.cos(a) * F.r, F.t + Math.sin(a) * F.r * 0.5, 0);
    out.push({ x: q[0], y: q[1] + 0.02, z: q[2], tier: 5, where: 'the pass floor' });
  }
  return out;
}

/** A rock piece stood in the pass or in a cave: which model, where its foot is, its turn and tilt, how big. */
export interface RockPiece {
  id: string;
  at: V3;
  turn: number;
  tilt: [number, number];
  scale: number;
  /** a cave's lining (drawn only near), not the pass's walls */
  inside?: boolean;
}

/** what dresses a riser and the ridge's face: these pieces, each with its height and length as it came (metres) */
const FACES: { id: string; tall: number; long: number }[] = [
  { id: 'namaqualand_cliff_02', tall: 7.2, long: 20.2 },
  { id: 'mountainside', tall: 10.5, long: 10.2 },
  { id: 'namaqualand_cliff_01', tall: 5, long: 8.3 },
];

/** A small number that is the same every time for the same place (so the walls are laid the same in every game). */
const hash = (a: number, b: number) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * The pass's walls, dressed: every riser on both walls faced with cliff pieces along its length, each tall enough to
 * reach the shelf above and stood a little back into it, its face toward the pass, the pieces overlapping; none
 * across a cave's mouth (the mouth has its own). Past the third shelf, the ridge's face, with the biggest. And the
 * rocks lining each cave's galleries (its walls and its roof) and framing each mouth.
 */
export function rockPieces(p: Pass): RockPiece[] {
  const out: RockPiece[] = [], L = passLength(p), mouths = caveMouths(p);
  for (const side of [1, -1] as const) {
    E.forEach((e, k) => {
      const tall = e.to - e.from;
      for (let s = 4, i = 0; s < L - 4; i++) {
        const f = FACES[Math.floor(hash(s, side * (k + 1)) * FACES.length)], scale = (tall / f.tall) * (1.05 + hash(s, k) * 0.25);
        const t = side * (e.foot + (e.top - e.foot) * 0.5 + 1.2);
        const at = passWorld(p, s, t, e.from - 0.4), o = alongPass(p, s);
        if (!mouths.some((m) => Math.hypot(m.x - at[0], m.z - at[2]) < m.hx + f.long * scale * 0.35 && Math.abs(m.floor - at[1] - 0.4) < tall)) {
          // (its face toward the pass: north wall faces south, south wall faces north)
          const turn = Math.atan2(o.ux, o.uz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
          out.push({ id: f.id, at, turn, tilt: [(hash(i, s) - 0.5) * 0.08, 0], scale });
        }
        s += f.long * scale * 0.62;
      }
    });
    // the ridge's face over the third shelf: the biggest pieces, twice and three times their size
    const last = E[E.length - 1];
    for (let s = 6; s < L - 6; s += 26) {
      const at = passWorld(p, s, side * (last.back + 4), last.to - 1), o = alongPass(p, s);
      out.push({ id: 'mountainside', at, turn: Math.atan2(o.ux, o.uz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), tilt: [0, 0], scale: 2.4 + hash(s, side) * 0.8 });
    }
  }
  // each mouth's lintel: a cliff across the riser over the cave's roof, up to the shelf above
  for (const m of mouths) {
    const c = CAVES[m.cave], n = Math.abs(passWorld(p, c.nodes[0].s, c.nodes[0].t, c.nodes[0].y)[0] - m.x) < 8 ? c.nodes[0] : c.nodes[c.nodes.length - 1];
    const k = E.findIndex((e) => Math.abs(Math.abs(n.t) - e.foot) < 1), over = k >= 0 ? E[k].to - n.y - n.h : 6;
    if (over > 0.5) out.push({ id: 'namaqualand_cliff_01', at: [m.x, m.floor + n.h - 0.3, m.z], turn: m.rot + Math.PI, tilt: [0, 0], scale: Math.max(0.6, (over + 0.6) / 5), inside: false });
  }
  // the caves: rocks along both walls of every gallery, turned in, and laid over it for its roof
  for (const g of galleries(p)) {
    const ex = g.b[0] - g.a[0], ez = g.b[2] - g.a[2], run = Math.hypot(ex, ez), n = Math.max(1, Math.round(run / 5));
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n, w = g.wa + (g.wb - g.wa) * k, h = g.ha + (g.hb - g.ha) * k;
      const c: V3 = [g.a[0] + ex * k, g.a[1] + (g.b[1] - g.a[1]) * k, g.a[2] + ez * k], dir = Math.atan2(ex, ez);
      for (const side of [-1, 1]) {
        const sx = (ez / run) * side, sz = (-ex / run) * side, off = w / 2 + 0.9;
        out.push({ id: h > 5 ? 'mountainside' : 'rock_face_02', at: [c[0] + sx * off, c[1] - 0.6, c[2] + sz * off], turn: dir + (side > 0 ? -Math.PI / 2 : Math.PI / 2), tilt: [0, 0], scale: h > 5 ? h / 9 : Math.max(0.6, h / 4.2), inside: true });
      }
      // the roof: a cliff laid upside down over it
      out.push({ id: 'namaqualand_cliff_01', at: [c[0], c[1] + h + 2.6 * Math.max(0.5, w / 7), c[2]], turn: dir, tilt: [Math.PI, 0], scale: Math.max(0.5, w / 7), inside: true });
    }
  }
  return out;
}
