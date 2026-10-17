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

/** Where on the pass a point is: how far along its middle line (s) and how far across, north positive (t). */
export function passAt(p: Pass, x: number, z: number): { s: number; t: number } {
  let best = Infinity, out = { s: 0, t: 0 }, sum = 0;
  for (let i = 0; i + 1 < p.line.length; i++) {
    const [ax, az] = p.line[i], [bx, bz] = p.line[i + 1], len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    const along = Math.max(0, Math.min(len, (x - ax) * ux + (z - az) * uz)), px = ax + ux * along, pz = az + uz * along, d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      out = { s: sum + along, t: (x - px) * uz - (z - pz) * ux };
    }
    sum += len;
  }
  return out;
}

/**
 * The ground over the pass at a world point, as the plan has it: the pass's floor where it is along, and its terraces
 * across (passProfile). What the world's ground is to be carved to, and what the caves are carved under.
 */
export function passGround(p: Pass, x: number, z: number): number {
  const at = passAt(p, x, z);
  return p.floor(at.s) + passProfile(at.t);
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
      { s: 179, t: -32.5, y: 8, w: 4, h: 3.6 },
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
      // (in under the third shelf before it climbs: climbing under the second, its roof would break out onto it)
      { s: 98, t: 44, y: 8.5, w: 4, h: 3.6 },
      { s: 116, t: 44, y: 17.5, w: 4, h: 3.6 },
      { s: 121, t: 44, y: 18, w: 4, h: 3.6 },
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
      { s: 200, t: -57, y: 30, w: 4, h: 3.6 },
      // (straight across the pass's sharp bend, 225 to 330 along: this far out on its inside the pass's measure folds,
      // and a way laid by it, at 260 and 300, turned back 173 degrees under itself)
      { s: 225, t: -62, y: 28.5, w: 3.6, h: 3.4 },
      { s: 330, t: -67, y: 26, w: 10, h: 6 },
      { s: 350, t: -70, y: 24.5, w: 3.6, h: 3.4 },
      { s: 392, t: -74, y: 22, w: 3.6, h: 3.4 },
      // (out where the ridge's face is at its floor, over a ledge and the desert: at 400 along the face stood 24 m on,
      // and the mouth was a hole 38 m down in its rock)
      { s: 432, t: -74, y: 21.8, w: 3.6, h: 3.4 },
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
  /** whether its first or last end is a cave's mouth */
  aMouth: boolean;
  bMouth: boolean;
  /** how much rock there is over its roof: the least, along it and across all its width, under the plan's terraces */
  cover: number;
}

/** The galleries of every cave, in the world. */
const laidOut = new WeakMap<Pass, Gallery[]>();
export function galleries(p: Pass): Gallery[] {
  // (worked out once for a pass: asked of every frame, by how dark it is, and of every point of the carved rock)
  const known = laidOut.get(p);
  if (known) return known;
  const out: Gallery[] = [];
  laidOut.set(p, out);
  CAVES.forEach((c, ci) => {
    for (let k = 0; k + 1 < c.nodes.length; k++) {
      const n0 = c.nodes[k], n1 = c.nodes[k + 1];
      // (the rock over it, across all its width and a metre past, from a few metres in from a mouth: what is over a
      // mouth is the face it is in)
      let cover = Infinity;
      const run = Math.hypot(n1.s - n0.s, n1.t - n0.t), side = (n1.s - n0.s) / run;
      for (let i = 0; i <= 16; i++) {
        const q = i / 16, t = n0.t + (n1.t - n0.t) * q, y = n0.y + (n1.y - n0.y) * q, w = n0.w + (n1.w - n0.w) * q, h = n0.h + (n1.h - n0.h) * q;
        if ((k === 0 && c.mouths.includes('first') && q * run < 4) || (k + 2 === c.nodes.length && c.mouths.includes('last') && (1 - q) * run < 4)) continue;
        for (const across of [-1, 0, 1]) cover = Math.min(cover, passProfile(t + across * side * (w / 2 + 1)) - y - h);
      }
      out.push({ cave: ci, a: passWorld(p, n0.s, n0.t, n0.y), b: passWorld(p, n1.s, n1.t, n1.y), wa: n0.w, wb: n1.w, ha: n0.h, hb: n1.h, aMouth: k === 0 && c.mouths.includes('first'), bMouth: k + 2 === c.nodes.length && c.mouths.includes('last'), cover });
    }
  });
  return out;
}

/** a world point's x and z */
const xzOf = (v: V3): [number, number] => [v[0], v[2]];

/** Where along a gallery a point is (0 to 1) and how far off its middle line, on the ground's plane. */
function onGallery(g: Gallery, x: number, z: number) {
  const ex = g.b[0] - g.a[0], ez = g.b[2] - g.a[2], L = ex * ex + ez * ez || 1e-9;
  const k = Math.max(0, Math.min(1, ((x - g.a[0]) * ex + (z - g.a[2]) * ez) / L));
  return { k, d: Math.hypot(x - g.a[0] - ex * k, z - g.a[2] - ez * k) };
}

/**
 * metres more round each gallery that whatever holds nobody under the ground takes in (caveAt's `more`): the carved
 * rock stands out up to 1.7 m past a gallery's measure in the hall (src/world/cave-carve.ts: its roughing, its flared
 * mouths), and at 0.6 a body in a hollow of it was "under the ground", lifted out after 2 s and its tags voided
 */
export const CAVE_MARGIN = 1.6;

/**
 * Where a line on the ground's plane (ax, az to bx, bz) passes over a cave: the stretches of it (shares of the way
 * along, 0 to 1) within a gallery's half width and two metres of one, each with the highest roof under it, as high as
 * its rock may be carved (1.5 m over the plan's, a mouth's flare taken in). For whatever stands down into the rock
 * along that line and is to stop over the caves: the ridge's wall that cannot be seen (src/game/game.ts), which cut
 * down through the long way and stopped a body at its first mouth (2026-10-16).
 */
export function caveSpansUnder(p: Pass, ax: number, az: number, bx: number, bz: number, gs = galleries(p)): { from: number; to: number; roof: number }[] {
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5)), out: { from: number; to: number; roof: number }[] = [];
  let run: { from: number; to: number; roof: number } | null = null;
  for (let i = 0; i <= n; i++) {
    const q = i / n, x = ax + (bx - ax) * q, z = az + (bz - az) * q;
    let roof = -Infinity;
    for (const g of gs) {
      const { k, d } = onGallery(g, x, z);
      if (d > (g.wa + (g.wb - g.wa) * k) / 2 + 2) continue;
      const fa = g.aMouth ? MOUTH_FLARE : 1, fb = g.bMouth ? MOUTH_FLARE : 1;
      roof = Math.max(roof, g.a[1] + g.ha * fa + 1.5, g.b[1] + g.hb * fb + 1.5);
    }
    if (roof === -Infinity) {
      run = null;
      continue;
    }
    // (each stretch reaching half a step past its last point either way)
    if (!run) out.push((run = { from: Math.max(0, q - 0.5 / n), to: q, roof }));
    run.to = Math.min(1, q + 0.5 / n);
    run.roof = Math.max(run.roof, roof);
  }
  return out;
}

/**
 * A wall along a line `L` metres long standing down into the rock, cut where caves pass under it (caveSpansUnder): each
 * part's metres along the line and how low it reaches (`deep` where no cave is under it; a metre over the roof where
 * one is). Its two ends reach `join` metres on, to meet the next line's wall; its parts meet each other end to end.
 */
export function wallParts(L: number, spans: { from: number; to: number; roof: number }[], deep: number, join: number): { from: number; to: number; foot: number }[] {
  const out: { from: number; to: number; foot: number }[] = [];
  let at = 0;
  for (const sp of spans) {
    if (sp.from > at) out.push({ from: at * L, to: sp.from * L, foot: deep });
    out.push({ from: sp.from * L, to: sp.to * L, foot: sp.roof + 1 });
    at = sp.to;
  }
  if (at < 1) out.push({ from: at * L, to: L, foot: deep });
  out[0].from -= join;
  out[out.length - 1].to += join;
  return out;
}

/** Whether a point is in a cave, and in which (its gallery's floor and ceiling there): null outside every cave. */
export function caveAt(p: Pass, x: number, y: number, z: number, gs = galleries(p), more = 0): { cave: number; floor: number; ceiling: number; deep: number } | null {
  // (`more`: metres more either way to take in. The carved rock's walls stand out past a gallery's measure, a metre and
  // a half in a hall: whatever holds nobody under the ground must not hold a body that stands in a hollow of them)
  let best: { cave: number; floor: number; ceiling: number; deep: number } | null = null;
  for (const g of gs) {
    const { k, d } = onGallery(g, x, z), half = (g.wa + (g.wb - g.wa) * k) / 2 + 0.6 + more;
    if (d > half) continue;
    const floor = g.a[1] + (g.b[1] - g.a[1]) * k, ceiling = floor + g.ha + (g.hb - g.ha) * k;
    if (y < floor - 1 - more || y > ceiling + 0.5 + more) continue;
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

/**
 * metres out over the shelf in front of a riser's foot that a mouth opens the ground: the terrain's riser spreads its
 * foot over a cell of its net (two metres), and opened a metre out, what was left of it stood in front of the mouth's
 * set-back face up to 1.8 m high, sharp-edged where it was cut (2026-10-16)
 */
export const MOUTH_OUT = 2.5;

/**
 * Where each mouth opens the ground: a rectangle on the ground's plane (its middle, its turn, its half sizes, as the
 * terrain's wells take them: src/world/terrain.ts openWells), from MOUTH_OUT out on the shelf in front of the riser to
 * the riser's top, a mouth's width across: only the riser's own face is opened (never the shelf above); the carved
 * rock (src/world/cave-carve.ts) is the face there, the opening in it and the shelf in front. Its floor is the cave's.
 */
export function caveMouths(p: Pass): { cave: number; x: number; z: number; rot: number; hx: number; hz: number; floor: number }[] {
  const out: { cave: number; x: number; z: number; rot: number; hx: number; hz: number; floor: number }[] = [];
  CAVES.forEach((c, ci) => {
    for (const which of c.mouths) {
      const n = which === 'first' ? c.nodes[0] : c.nodes[c.nodes.length - 1], m = which === 'first' ? c.nodes[1] : c.nodes[c.nodes.length - 2];
      const a = passWorld(p, n.s, n.t, n.y), b = passWorld(p, m.s, m.t, m.y), ux = b[0] - a[0], uz = b[2] - a[2], len = Math.hypot(ux, uz);
      // (from MOUTH_OUT in front of it to just short of the riser's top, or three metres in where it is in the ridge's own face)
      const k = E.findIndex((e) => Math.abs(Math.abs(n.t) - e.foot) < 1), back = MOUTH_OUT, deep = k >= 0 ? Math.max(0.4, E[k].top - E[k].foot - 0.7) : 3, cx = a[0] + (ux / len) * ((deep - back) / 2), cz = a[2] + (uz / len) * ((deep - back) / 2);
      // (as wide as the entrance is flared out, set back in the face (src/world/cave-carve.ts CARVE.flare), and a metre more:
      // the carving rounds and roughs the flare a little past it, and at 0.5 the riser beside it stood proud, a wedge)
      out.push({ cave: ci, x: cx, z: cz, rot: Math.atan2(ux, uz), hx: (n.w / 2) * MOUTH_FLARE + 1, hz: (deep + back) / 2, floor: a[1] });
    }
  });
  return out;
}

/** how much wider and taller than its gallery a cave's entrance is at the face, narrowing to it a few metres in: an alcove it is set back in */
export const MOUTH_FLARE = 1.4;

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
  /** rubble: drawn by its light copy, near only, and not solid (it is walked over) */
  small?: boolean;
}

/**
 * The rock pieces as they came, metres: how tall and how long each is, and how far in front of its origin its face
 * stands (its origin is at its foot; its face looks along its own +z), and how far its rock goes back behind it.
 * Measured on the models.
 */
export const ROCKS: Record<string, { tall: number; long: number; front: number; back: number }> = {
  namaqualand_cliff_02: { tall: 7.2, long: 20.2, front: 2.2, back: 4.4 },
  mountainside: { tall: 10.5, long: 10.2, front: 1.5, back: 3.7 },
  namaqualand_cliff_01: { tall: 5, long: 8.3, front: 0.8, back: 3.6 },
  namaqualand_boulder_02: { tall: 0.9, long: 2.5, front: 0.6, back: 0.6 },
  namaqualand_boulder_03: { tall: 1.5, long: 2.4, front: 1.5, back: 1.5 },
  namaqualand_boulder_04: { tall: 1.9, long: 2.5, front: 1.2, back: 1.2 },
  namaqualand_boulder_05: { tall: 0.5, long: 1.4, front: 0.35, back: 0.35 },
};
/** what dresses a riser and the ridge's face */
const FACES = ['namaqualand_cliff_02', 'mountainside', 'namaqualand_cliff_01'].map((id) => ({ id, ...ROCKS[id] }));

/** A small number that is the same every time for the same place (so the walls are laid the same in every game). */
const hash = (a: number, b: number) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * The pass's walls, dressed: every riser on both walls faced with cliff pieces along its length, each tall enough to
 * reach the shelf above and stood a little back into it, its face toward the pass, the pieces overlapping; none
 * across a cave's mouth (the mouth is the carved rock's own: src/world/cave-carve.ts). Past the third shelf, the
 * ridge's face, with the biggest.
 */
export function rockPieces(p: Pass, o: { ramps?: { side: number; level: number; along: V2 }[]; ground?: (x: number, z: number) => number } = {}): RockPiece[] {
  const out: RockPiece[] = [], L = passLength(p), mouths = caveMouths(p), gs = galleries(p), ramps = o.ramps ?? [];
  // (the walls as the world built them, when it is given: it rounds each riser, sets it back up the wall and lets it
  // wander (src/world/worldgen/west-relief.ts passWall), and a face stood by the plan's riser stood off the real one by
  // up to 3.5 m. So each riser is found where the ground crosses its middle height, near the plan's, and a face stood
  // there, its foot on the shelf in front; rubble on the ground where it falls)
  const G = o.ground, overFloor = (s: number, t: number) => (G ? G(...xzOf(passWorld(p, s, t, 0))) - passWorld(p, s, t, 0)[1] : 0);
  const crossing = (side: number, s: number, h: number, t0: number, t1: number) => {
    for (let t = t0; t <= t1; t += 0.25) if (overFloor(s, side * t) >= h) return t;
    return null;
  };
  const riserShift = (side: number, k: number, s: number) => {
    const e = E[k], plan = (e.foot + e.top) / 2, at = G ? crossing(side, s, (e.from + e.to) / 2, e.foot - 4, e.top + 6) : null;
    return at === null ? 0 : Math.max(-5, Math.min(5, at - plan));
  };
  // (the lowest ground three to six metres in front of a riser's middle: the shelf a face stands on)
  const shelfUnder = (side: number, k: number, s: number, dt: number) => {
    const e = E[k], mid = (e.foot + e.top) / 2 + dt;
    let low = Infinity;
    for (let u = 3; u <= 6; u += 1) low = Math.min(low, G!(...xzOf(passWorld(p, s, side * (mid - u), 0))));
    return low;
  };
  // (nothing stood on a ramp up a riser, the world's way from shelf to shelf (src/world/worldgen: passData().ramps),
  // nor across its foot or its top: it is walked)
  const onRamp = (side: number, level: number, s0: number, s1: number, more = 2) => ramps.some((r) => r.side === side && r.level === level && s1 + more > r.along[0] && s0 - more < r.along[1]);
  // (nor in front of a mouth, whose frame is its own: below)
  const atMouth = (x: number, z: number, more: number) => mouths.some((m) => Math.hypot(m.x - x, m.z - z) < m.hx + m.hz + more);
  // (a piece stood back into the rock is not to break into a cave behind it: its whole body, sampled, kept clear of
  // every gallery and the metre and more its walls are roughed by)
  const intoCave = (id: string, at: V3, turn: number, scale: number) => {
    const r = ROCKS[id], c = Math.cos(turn), sn = Math.sin(turn);
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 3; j++) for (let k = 0; k <= 4; k++) {
      const lx = (i / 4 - 0.5) * r.long * scale, lz = (-r.back + (j / 3) * (r.back + r.front)) * scale, y = at[1] + (k / 4) * r.tall * scale;
      const x = at[0] + lx * c + lz * sn, z = at[2] - lx * sn + lz * c;
      for (const g of gs) {
        const o = onGallery(g, x, z), w = g.wa + (g.wb - g.wa) * o.k, h = g.ha + (g.hb - g.ha) * o.k, floor = g.a[1] + (g.b[1] - g.a[1]) * o.k;
        if (o.d < w / 2 + 1.6 && y > floor - 0.8 && y < floor + h + 1.8) return true;
      }
    }
    return false;
  };
  for (const side of [1, -1] as const) {
    E.forEach((e, k) => {
      const tall = e.to - e.from;
      for (let s = 4, i = 0; s < L - 4; i++) {
        const f = FACES[Math.floor(hash(s, side * (k + 1)) * FACES.length)], scale = (tall / f.tall) * (1.05 + hash(s, k) * 0.25), half = (f.long * scale) / 2;
        // (stood a little further in or out, so that the faces do not run in a line; here and there a gap, as a wall
        // weathers: clusters, never a lattice)
        const dt = riserShift(side, k, s), t = side * (e.foot + (e.top - e.foot) * 0.5 + 0.7 + hash(k, s) * 1.2 + dt);
        const at = passWorld(p, s, t, e.from - 0.4), o = alongPass(p, s), gap = hash(s * 0.7, side * 3 + k) < 0.12;
        if (G) at[1] = shelfUnder(side, k, s, dt) - 0.4;
        // (and only where the world's riser stands as high as most of the plan's: at the pass's two ends its walls fall
        // away into the valley and the desert, and a face stood there stood free, its back in the air)
        const short = G && G(...xzOf(passWorld(p, s, side * (e.top + dt + 3), 0))) - at[1] < 0.6 * tall;
        if (!gap && !short && !onRamp(side, k, s - half, s + half) && !mouths.some((m) => Math.hypot(m.x - at[0], m.z - at[2]) < m.hx + f.long * scale * 0.35 + 3 && Math.abs(m.floor - at[1] - 0.4) < tall)) {
          // (its face toward the pass: the north wall's faces south, the south wall's north)
          const turn = Math.atan2(o.ux, o.uz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
          if (!intoCave(f.id, at, turn, scale)) out.push({ id: f.id, at, turn, tilt: [(hash(i, s) - 0.5) * 0.08, (hash(s, i) - 0.5) * 0.12], scale });
        }
        s += f.long * scale * (0.45 + hash(i, k + 7) * 0.3);
      }
      // Rubble and fallen blocks at the riser's foot and along its top's lip, in heaps where a face has shed them:
      // close in to the face (the shelf's middle, and the floor's, are for walking), none on a ramp or by a mouth.
      for (let s = 5, i = 0; s < L - 5; i++) {
        s += 4 + hash(i, side * 11 + k) * 9;
        if (hash(s * 0.31, k + side) < 0.45 || onRamp(side, k, s - 3, s + 3)) continue;
        for (const lip of [false, true]) {
          if (lip && (k === E.length - 1 || hash(s, k * 5 + 1) < 0.5)) continue;
          const t0 = (lip ? e.top + 0.6 : e.foot - 0.4) + riserShift(side, k, s), y0 = lip ? e.to : e.from, n = 2 + Math.floor(hash(s, i) * 4);
          for (let j = 0; j < n; j++) {
            const ds = (hash(j, s) - 0.5) * 5, dt = (lip ? 1 : -1) * hash(s, j + 3) * 1.1, big = j === 0 && hash(i, j + s) < 0.4;
            const at = passWorld(p, s + ds, side * (t0 + dt), y0 - 0.15);
            if (G) at[1] = G(at[0], at[2]) - 0.15;
            if (atMouth(at[0], at[2], 3)) continue;
            const id = big ? (hash(j, i) < 0.5 ? 'namaqualand_boulder_03' : 'namaqualand_boulder_04') : hash(j, i) < 0.6 ? 'namaqualand_boulder_05' : 'namaqualand_boulder_02';
            out.push({ id, at, turn: hash(s, j) * Math.PI * 2, tilt: [(hash(j, s + 1) - 0.5) * 0.4, (hash(s + 1, j) - 0.5) * 0.4], scale: big ? 0.9 + hash(i, j) * 0.7 : 0.35 + hash(j, i + 2) * 0.55, ...(big ? {} : { small: true }) });
          }
        }
      }
    });
    // the ridge's face over the third shelf: the biggest pieces, twice and three times their size
    const last = E[E.length - 1];
    for (let s = 6; s < L - 6; s += 26) {
      // (the face, too, stands back where the world built it: found where the ground is three metres over its foot)
      const face = G ? crossing(side, s, last.to + 3, last.back - 2, last.back + 12) : null, dt = face === null ? 0 : face - (last.back + 3 * PASS_SHAPE.face);
      if (G && face === null) continue;
      const at = passWorld(p, s, side * (last.back + 4 + dt), last.to - 1), o = alongPass(p, s), scale = 2.4 + hash(s, side) * 0.8;
      if (G) at[1] = Math.min(at[1], G(at[0], at[2]) - 1);
      // (none over a mouth in the face: its rock is the carved rock's there)
      const turn = Math.atan2(o.ux, o.uz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (mouths.some((m) => Math.hypot(m.x - at[0], m.z - at[2]) < m.hx + ROCKS.mountainside.long * scale * 0.6 && Math.abs(m.floor - at[1]) < 12)) continue;
      if (!intoCave('mountainside', at, turn, scale)) out.push({ id: 'mountainside', at, turn, tilt: [0, 0], scale });
    }
  }
  // Each mouth framed (the owner: the mouths "dont look right still or natural", holes punched in a wall): over it an
  // overhang of rock jutting out of the face, a fallen block either side of its sill, rubble in front of it but off
  // the way in; set back in its flared entrance (MOUTH_FLARE).
  for (const [mi, m] of mouths.entries()) {
    const c = CAVES[m.cave], n = Math.abs(passWorld(p, c.nodes[0].s, c.nodes[0].t, c.nodes[0].y)[0] - m.x) < 12 ? c.nodes[0] : c.nodes[c.nodes.length - 1];
    // (the way out of the mouth, and across it; the face's foot, the hole's front less its metres out in front)
    const ox = -Math.sin(m.rot), oz = -Math.cos(m.rot), ax = Math.cos(m.rot), az = -Math.sin(m.rot), w = n.w * MOUTH_FLARE, h = n.h * MOUTH_FLARE;
    const fx = m.x + ox * (m.hz - MOUTH_OUT - 1.5), fz = m.z + oz * (m.hz - MOUTH_OUT - 1.5), outward = Math.atan2(ox, oz);
    const R = ROCKS.namaqualand_cliff_01, rs = (w + 3) / R.long;
    out.push({ id: 'namaqualand_cliff_01', at: [fx - ox * R.back * rs * 0.55, m.floor + h - 0.2, fz - oz * R.back * rs * 0.55], turn: outward, tilt: [0.32, (hash(mi, 1) - 0.5) * 0.2], scale: rs });
    for (const sd of [-1, 1]) {
      if (hash(mi, sd + 3) < 0.25) continue;
      const d = w / 2 + 0.6 + hash(mi, sd) * 0.8, up = 0.8 + hash(sd, mi) * 1.6;
      out.push({ id: hash(mi, sd + 5) < 0.5 ? 'namaqualand_boulder_04' : 'namaqualand_boulder_03', at: [fx + ax * sd * d + ox * up, m.floor - 0.3, fz + az * sd * d + oz * up], turn: hash(sd, mi + 2) * Math.PI * 2, tilt: [(hash(mi, sd + 9) - 0.5) * 0.3, (hash(sd + 9, mi) - 0.5) * 0.3], scale: 1.1 + hash(mi, sd + 7) * 0.8 });
    }
    for (let j = 0; j < 6; j++) {
      // (to either side of the way in, never in it)
      const sd = j % 2 ? 1 : -1, across = sd * (0.9 + hash(j, mi) * (w / 2 + 0.6)), outThere = 0.3 + hash(mi, j) * 2.6;
      out.push({ id: hash(j, mi + 4) < 0.6 ? 'namaqualand_boulder_05' : 'namaqualand_boulder_02', at: [fx + ax * across + ox * outThere, m.floor - 0.12, fz + az * across + oz * outThere], turn: hash(j + 1, mi) * Math.PI * 2, tilt: [(hash(j, mi + 6) - 0.5) * 0.5, (hash(mi + 6, j) - 0.5) * 0.5], scale: 0.3 + hash(j, mi + 8) * 0.5, small: true });
    }
  }
  return out;
}
