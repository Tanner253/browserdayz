// The bot check's 360-degree course: the yard, the six figures the server walks and shows, and the judge of a go.
// (2026-10-15: "bots are making it inside the game past our bot checks ... a full 360 degree
// course requiring movement to hit targets to avoid obstacles etc.. runs on the server to make sure it cannot be
// cheated"). The strip it replaces (./range.ts) was dealt as one number, and from that number the game worked out
// the whole range itself: where every figure would be at every moment and where it could be seen from. A script in
// the page knew the answer before the first shot, and a wave of them walked through it.
//
// Here the game is told only the yard: its walls, its hut, its catwalk and its blocks, turned to a way the server
// picks. The six figures are the server's. It walks them with stops and turns of its own choosing, from a plan the
// game never sees, and tells the game of a figure only once its own line of sight, from where the player says they
// stand, reaches it (`CourseJudge.reveal`). It judges every shot against the figure as it was, and counts none
// sooner than a fifth of a second after that figure first came into sight. And the yard is the server's too: a
// telling of somebody inside a wall, through one, outside the yard or hanging in the air is something that could
// not be so. The rest of the judging (sights on the figure, an aim that travelled, the bot signature) is the
// strip's, carried over.
//
// The yard's own measures, metres: x to the right, y up from its floor, z towards the player's back as they start
// (they start at the middle looking along -z, "north"). The plan below is drawn in that frame; the server turns it
// about the middle by `turn` for each go, and everything said over the wire is in the turned frame.

/** a block of the yard, square to the plan: from x0 to x1, z0 to z1, its foot to its top */
export interface Block { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; kind: 'wall' | 'block' | 'hut' | 'roof' | 'deck' | 'plinth' }
/** a figure's lane: it walks between the two ends at the height `y` (the plinth's top, for the far one); `peek`: it crouches behind cover and comes up for moments */
export interface Lane { a: [number, number]; b: [number, number]; y: number; speed: [number, number]; rest: [number, number]; peek?: boolean; /** somebody with their hands up, not to be shot */ civ?: true }

/** the yard: its radius to the inside of the ring wall, the ring's height, the eye of somebody standing */
export const YARD = { r: 22, ring: 3, thick: 0.5, eye: 1.62 };
/** the ramp up to the catwalk: from its foot at x1 (floor) to its head at x0 (the deck's top), across z0 to z1 */
export const RAMP = { x0: -6.5, x1: -1.5, z0: 3.9, z1: 6.1, top: 1.8 };

const box = (x0: number, x1: number, z0: number, z1: number, y1: number, kind: Block['kind'], y0 = 0): Block => ({ x0, x1, z0, z1, y0, y1, kind });

/** The yard as drawn on the plan the owner said yes to (progress/botcheck/zona-plan-botcheck.png). */
export const BLOCKS: Block[] = [
  // the wall to the north, figure 1 behind it
  box(-4, 4, -7.4, -6.6, 2.5, 'wall'),
  // a block of cover to the north-west
  box(-7.7, -5.7, -5.2, -3.2, 2, 'block'),
  // the hut, 5 by 4: a door in its west wall, a window in its north wall, a roof
  box(7.5, 7.8, -3, -2.75, 2.5, 'hut'),
  box(7.5, 7.8, -1.55, 1, 2.5, 'hut'),
  box(7.5, 7.8, -2.75, -1.55, 2.5, 'hut', 2.1),
  box(7.8, 9.65, -3, -2.7, 2.5, 'hut'),
  box(11, 12.5, -3, -2.7, 2.5, 'hut'),
  box(9.65, 11, -3, -2.7, 1, 'hut'),
  box(9.65, 11, -3, -2.7, 2.5, 'hut', 1.9),
  box(12.2, 12.5, -2.7, 1, 2.5, 'hut'),
  box(7.8, 12.2, 0.7, 1, 2.5, 'hut'),
  box(7.5, 12.5, -3, 1, 2.7, 'roof', 2.5),
  // the catwalk, 1.8 m up, and the wall beyond it that only its height sees over (a head's height and to the east
  // of the plan as drawn: drawn at 1.4 m and ending at x -6, it let a standing figure be seen from the middle)
  box(-15.5, -6.5, 3.75, 6.25, 1.8, 'deck'),
  box(-16, -3, 8.9, 9.5, 1.8, 'wall'),
  // the block figure 5 crouches behind
  box(5.25, 7.25, 7.75, 9.75, 1.4, 'block'),
  // the plinth outside the ring that figure 6 walks on
  box(-24.5, -18.5, -23, -19.7, 3.5, 'plinth'),
];

/** the six figures, in the order of the plan's numbers */
export const LANES: Lane[] = [
  { a: [-3, -12], b: [3.5, -12], y: 0, speed: [1.2, 2.4], rest: [0.2, 1.2] },
  { a: [-2, 16], b: [4.2, 16], y: 0, speed: [1.2, 2.4], rest: [0.2, 1.2] },
  { a: [9.2, -0.9], b: [11.6, -0.9], y: 0, speed: [0.8, 1.6], rest: [0.4, 1.4] },
  { a: [-14.2, 12.7], b: [-7.3, 12.7], y: 0, speed: [1.2, 2.4], rest: [0.2, 1.2] },
  { a: [6, 10.6], b: [7.4, 10.6], y: 0, speed: [0.6, 1.2], rest: [0.3, 1], peek: true },
  { a: [-23.7, -20.5], b: [-19.2, -22.2], y: 3.5, speed: [0.8, 1.6], rest: [0.5, 2] },
  // (somebody with their hands up, between the middle and figure 2: not to be shot. 2026-10-18: the programs that passed
  // that night fired at every figure the server showed them)
  { a: [-4, 11], b: [3, 11], y: 0, speed: [0.8, 1.4], rest: [0.5, 1.5], civ: true },
];
/** the figures to bring down, and the one with their hands up (on a course dealt with variety: see dealCourse) */
export const HOSTILES = LANES.filter((l) => !l.civ).length;
export const CIV = LANES.findIndex((l) => l.civ);

/**
 * The wall that slides to and fro outside the ring, in front of figure 6's plinth (2026-10-18, "cover that moves"):
 * where its middle goes between (x), how far it reaches (z0 to z1, its foot to its top), how wide it is, and how many
 * seconds it takes one way. Nobody can get to it (it is beyond the ring): it hides, and stops shots, and that is all.
 */
export const MOVER = { x: [-23.8, -17.2] as [number, number], z0: -18.7, z1: -18.2, y1: 5.4, w: 2.4, secs: 6 };
/** where the sliding wall is at `ms` into a go, as a block of the plan (null: the course has none) */
export function moverAt(c: Pick<Course, 'mover'>, ms: number): Block | null {
  if (c.mover < 0) return null;
  const p = (((ms / 1000 / MOVER.secs + c.mover) % 2) + 2) % 2, t = p < 1 ? p : 2 - p, cx = MOVER.x[0] + (MOVER.x[1] - MOVER.x[0]) * t;
  return { x0: cx - MOVER.w / 2, x1: cx + MOVER.w / 2, z0: MOVER.z0, z1: MOVER.z1, y0: 0, y1: MOVER.y1, kind: 'wall' };
}

/**
 * The yard's blocks with the north wall and the cover block to the north-west moved along (2026-10-18: "several yard
 * layouts instead of one turned around"): `shift` is the wall's step east and the block's step west and north-south,
 * metres, each within what leaves the way round the yard open (see test/course-player.ts).
 */
export function blocksOf(shift: readonly number[]): Block[] {
  const [wall, bx, bz] = [shift[0] ?? 0, shift[1] ?? 0, shift[2] ?? 0];
  return BLOCKS.map((b, i) => (i === 0 ? { ...b, x0: b.x0 + wall, x1: b.x1 + wall } : i === 1 ? { ...b, x0: b.x0 + bx, x1: b.x1 + bx, z0: b.z0 + bz, z1: b.z1 + bz } : b));
}

/** a figure, as the judge takes it: a post this thick, from the knee to the crown; crouched behind its block, to here */
const BODY = { r: 0.42, low: 0.25, high: 1.8, low_high: 1.2 };

// ------------------------------------------------------------------ dealing

/** one leg of a figure's walk: from `at` ms it goes from a to b, arriving at `to` ms, then stands until the next leg */
interface Leg { at: number; to: number; a: [number, number]; b: [number, number] }
/** a figure's walk for the whole go, and (a peeker) the moments it is up */
interface Walk { legs: Leg[]; up: [number, number][] }
/**
 * What is dealt: the way the yard is turned (radians), whether it is the plan's mirror (`flip`), how its two movable
 * blocks are moved (`shift`, and the blocks as they then stand), where in its slide the moving wall starts (`mover`,
 * -1: none), whether the one with their hands up is about (`civ`), and every figure's walk (the server's alone).
 */
export interface Course { turn: number; flip: boolean; shift: number[]; blocks: Block[]; mover: number; civ: boolean; walks: Walk[]; need: number; secs: number }

/** how long a go is, seconds, and how far ahead a figure's walk is planned (the go and a margin) */
export const SECS = 60;
const PLANNED = (SECS + 15) * 1000;

/**
 * A course for one go: the yard turned at random, and each figure's walk from end to end of its lane with stops,
 * every leg's end and pace and every stop's length its own throw of the dice. `rnd` is the server's own dice; the
 * game is never told a walk.
 */
export function dealCourse(rnd: () => number, vary = false): Course {
  const span = (r: [number, number]) => r[0] + rnd() * (r[1] - r[0]);
  const walks = LANES.map((l) => {
    const legs: Leg[] = [];
    let t = 0, at: [number, number] = [l.a[0] + (l.b[0] - l.a[0]) * rnd(), l.a[1] + (l.b[1] - l.a[1]) * rnd()];
    while (t < PLANNED) {
      // (somewhere else along the lane, at least a third of it away: a figure that shuffles on a spot is a figure standing still)
      let k = rnd();
      const here = Math.hypot(at[0] - l.a[0], at[1] - l.a[1]) / Math.max(0.01, Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]));
      if (Math.abs(k - here) < 0.33) k = here < 0.5 ? Math.min(1, here + 0.33 + rnd() * 0.3) : Math.max(0, here - 0.33 - rnd() * 0.3);
      const b: [number, number] = [l.a[0] + (l.b[0] - l.a[0]) * k, l.a[1] + (l.b[1] - l.a[1]) * k];
      const go = (Math.hypot(b[0] - at[0], b[1] - at[1]) / span(l.speed)) * 1000;
      legs.push({ at: t, to: t + go, a: at, b });
      t += go + span(l.rest) * 1000;
      at = b;
    }
    const up: [number, number][] = [];
    if (l.peek) for (let u = 1500 + rnd() * 2000; u < PLANNED; ) {
      const long = 2500 + rnd() * 1000;
      up.push([u, u + long]);
      u += long + 2500 + rnd() * 1500;
    }
    return { legs, up };
  });
  const turn = rnd() * Math.PI * 2;
  // (the variety after everything else, so that a course dealt without it is the course it always was)
  if (!vary) return { turn, flip: false, shift: [0, 0, 0], blocks: BLOCKS, mover: -1, civ: false, walks, need: HOSTILES, secs: SECS };
  const flip = rnd() < 0.5, shift = [+(rnd() * 1.5).toFixed(2), +(-rnd()).toFixed(2), +((rnd() - 0.5) * 1).toFixed(2)];
  return { turn, flip, shift, blocks: blocksOf(shift), mover: +(rnd() * 2).toFixed(3), civ: true, walks, need: HOSTILES, secs: SECS };
}

/** Where figure `i` is at `ms` into the go, in the plan's frame: its feet, its pace, and whether it is up (always, but for a peeker). */
export function walkAt(c: Course, i: number, ms: number): { x: number; y: number; z: number; vx: number; vz: number; up: boolean } {
  const w = c.walks[i], l = LANES[i];
  let leg = w.legs[0];
  for (const g of w.legs) if (g.at <= ms) leg = g;
  const k = leg.to > leg.at ? Math.min(1, Math.max(0, (ms - leg.at) / (leg.to - leg.at))) : 1, moving = ms >= leg.at && ms < leg.to;
  const secs = Math.max(0.001, (leg.to - leg.at) / 1000);
  return {
    x: leg.a[0] + (leg.b[0] - leg.a[0]) * k,
    y: l.y,
    z: leg.a[1] + (leg.b[1] - leg.a[1]) * k,
    vx: moving ? (leg.b[0] - leg.a[0]) / secs : 0,
    vz: moving ? (leg.b[1] - leg.a[1]) / secs : 0,
    up: !l.peek || w.up.some(([a, b]) => ms >= a && ms < b),
  };
}

// ------------------------------------------------------------------ the turned frame

/** a point of the yard (as said over the wire) in the plan's frame, and back; `flip`: the yard is the plan's mirror, east for west, and then turned */
export function toPlan(turn: number, x: number, z: number, flip = false): [number, number] {
  const c = Math.cos(turn), s = Math.sin(turn);
  return [(flip ? -1 : 1) * (x * c - z * s), x * s + z * c];
}
export function fromPlan(turn: number, x: number, z: number, flip = false): [number, number] {
  const c = Math.cos(turn), s = Math.sin(turn), px = flip ? -x : x;
  return [px * c + z * s, -px * s + z * c];
}
/** a turn of the head in the yard as one in the plan (the game's own turn: none is along -z, a turn to the left is more) */
export const yawToPlan = (turn: number, yaw: number, flip = false) => (flip ? turn - yaw : yaw - turn);

// ------------------------------------------------------------------ what stands in the way

/** How far along a ray (in the plan's frame) a block is met (Infinity: it is not). */
function blockAlong(b: Block, o: readonly number[], d: readonly number[]): number {
  let near = 0, far = Infinity;
  const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
      continue;
    }
    let t0 = (lo[i] - o[i]) / d[i], t1 = (hi[i] - o[i]) / d[i];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return Infinity;
  }
  return near;
}

/** How far along a ray the ring wall is met, below its top (Infinity: it is not, within `upTo`). */
function ringAlong(o: readonly number[], d: readonly number[], upTo: number): number {
  // (the ray leaves the circle of the yard where |o + d t| = r on the level)
  const a = d[0] * d[0] + d[2] * d[2];
  if (a < 1e-12) return Infinity;
  const b = 2 * (o[0] * d[0] + o[2] * d[2]), cc = o[0] * o[0] + o[2] * o[2] - YARD.r * YARD.r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return Infinity;
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  if (t <= 0 || t > upTo) return Infinity;
  return o[1] + d[1] * t < YARD.ring ? t : Infinity;
}

/** Whatever stands nearest along a ray, in the plan's frame, out to `upTo`: the ring, the blocks, and the moving wall where it is. */
export function solidAlong(o: readonly number[], d: readonly number[], upTo = Infinity, blocks: readonly Block[] = BLOCKS, mover: Block | null = null): number {
  let t = ringAlong(o, d, upTo);
  for (const b of blocks) t = Math.min(t, blockAlong(b, o, d));
  if (mover) t = Math.min(t, blockAlong(mover, o, d));
  return t;
}
/** how many of the lanes are walked on a course: the one with their hands up only where there is variety */
export const figuresOf = (c: Pick<Course, 'civ'>) => (c.civ ? LANES.length : HOSTILES);

/** How far along a ray a figure standing at (x, y, z) is met (Infinity: it is not). */
function bodyAlong(x: number, y: number, z: number, up: boolean, o: readonly number[], d: readonly number[]): number {
  const dx = d[0], dz = d[2], flat = dx * dx + dz * dz;
  if (flat < 1e-9) return Infinity;
  const t = ((x - o[0]) * dx + (z - o[2]) * dz) / flat;
  if (t <= 0) return Infinity;
  const px = o[0] + dx * t - x, pz = o[2] + dz * t - z, h = o[1] + d[1] * t - y;
  if (px * px + pz * pz > BODY.r * BODY.r || h < BODY.low || h > (up ? BODY.high : BODY.low_high)) return Infinity;
  return t;
}

/** Which standing figure a shot (in the plan's frame) lands on at `ms` (-1: none; something stood in the way, or it went by). */
export function shotLands(c: Course, o: readonly number[], d: readonly number[], ms: number, down: ReadonlySet<number> = new Set()): number {
  let best = -1, at = solidAlong(o, d, Infinity, c.blocks, moverAt(c, ms));
  for (let i = 0; i < figuresOf(c); i++) {
    if (down.has(i)) continue;
    const p = walkAt(c, i, ms), t = bodyAlong(p.x, p.y, p.z, p.up, o, d);
    if (t < at) {
      at = t;
      best = i;
    }
  }
  return best;
}

/** Is any part of figure `i` to be seen from an eye at (ex, ey, ez), in the plan's frame, at `ms`? */
export function inSight(c: Course, i: number, ex: number, ey: number, ez: number, ms: number): boolean {
  const p = walkAt(c, i, ms), top = p.up ? 1.7 : 1.1, dx = p.x - ex, dz = p.z - ez, flat = Math.hypot(dx, dz) || 1;
  // (the crown, the chest and the hips, and the chest's two sides)
  const side = [-dz / flat, dx / flat];
  for (const [s, h] of [[0, top], [0, 1.0], [0, 0.6], [0.3, 1.0], [-0.3, 1.0]] as const) {
    if (!p.up && h > top) continue;
    const tx = p.x + side[0] * s, ty = p.y + h, tz = p.z + side[1] * s, v = [tx - ex, ty - ey, tz - ez], len = Math.hypot(v[0], v[1], v[2]);
    if (len < 1e-6) return true;
    const dir = [v[0] / len, v[1] / len, v[2] / len];
    if (solidAlong([ex, ey, ez], dir, len, c.blocks, moverAt(c, ms)) >= len) return true;
  }
  return false;
}

// ------------------------------------------------------------------ the ground under them

/** inside a block's foot on the level, by more than `by` */
const within = (b: Block, x: number, z: number, by = 0) => x > b.x0 + by && x < b.x1 - by && z > b.z0 + by && z < b.z1 - by;

/** the height of the ramp's slope at a place, or -1 off it */
export function rampAt(x: number, z: number): number {
  if (x < RAMP.x0 || x > RAMP.x1 || z < RAMP.z0 || z > RAMP.z1) return -1;
  return (RAMP.top * (RAMP.x1 - x)) / (RAMP.x1 - RAMP.x0);
}

/** What somebody whose feet are at height `y` has under them at a place (the plan's frame): the floor, the ramp, or the top of a block they are up on. */
export function floorAt(x: number, y: number, z: number, blocks: readonly Block[] = BLOCKS): number {
  let f = Math.max(0, rampAt(x, z));
  for (const b of blocks) if (b.kind !== 'roof' && within(b, x, z, -0.25) && b.y1 <= y + 0.4) f = Math.max(f, b.y1);
  return f;
}

/** Is a body with its feet at (x, y, z) inside something solid? (a body is a post from a little over its feet to its head) */
export function inSolid(x: number, y: number, z: number, blocks: readonly Block[] = BLOCKS): boolean {
  return blocks.some((b) => within(b, x, z, 0.1) && b.y1 > y + 0.3 && b.y0 < y + 1.6);
}

/** Does a step from one place to another, on the level, pass through a wall? (a wall that stands from the foot to over the head of both ends) */
export function through(ax: number, ay: number, az: number, bx: number, by: number, bz: number, blocks: readonly Block[] = BLOCKS): boolean {
  for (const b of blocks) {
    if (!(b.y0 < Math.min(ay, by) + 0.5 && b.y1 > Math.max(ay, by) + 0.6)) continue;
    // (a slab test on the level, against the block drawn in by a tenth: a body brushing a corner has not gone through it)
    let t0 = 0, t1 = 1;
    const o = [ax, az], d = [bx - ax, bz - az], lo = [b.x0 + 0.1, b.z0 + 0.1], hi = [b.x1 - 0.1, b.z1 - 0.1];
    let hit = true;
    for (let k = 0; k < 2 && hit; k++) {
      if (Math.abs(d[k]) < 1e-9) {
        if (o[k] < lo[k] || o[k] > hi[k]) hit = false;
        continue;
      }
      let u0 = (lo[k] - o[k]) / d[k], u1 = (hi[k] - o[k]) / d[k];
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0);
      t1 = Math.min(t1, u1);
      if (t0 > t1) hit = false;
    }
    if (hit) return true;
  }
  return false;
}

// ------------------------------------------------------------------ the judging

interface Seen { ms: number; x: number; y: number; z: number; yaw: number; pitch: number }

const angle = (a: Seen, b: Seen) => {
  const dy = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
  return Math.hypot(dy * Math.cos(a.pitch), b.pitch - a.pitch);
};
/** which way somebody looking with this turn and this tilt is looking (the game's own: no turn is along -z, and a turn to the left is more) */
export const lookOf = (yaw: number, pitch: number): [number, number, number] => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

/** what the game is shown of a figure: its number, its feet in the yard's frame, its pace, whether it is up */
export type Sighting = [number, number, number, number, number, number, 0 | 1];

/** a shot is judged against the figure as it was this long ago, and as it is: what the game showed was that old (ms) */
const REWIND = [0, 120, 240];
/** no shot at a figure counts sooner than this after the server first showed it (ms): "No shot counts sooner than 0.2 s after that figure came into your sight" */
const SEEN_FIRST = 200;
/** a figure that has gone out of sight is still shown this long (ms), so that it does not flicker at a wall's edge */
const LINGER = 800;
/**
 * More shots in a go than anybody fires, and the go is over (the owner, 2026-10-16: "we need harder to hit shots").
 * Six figures to bring down: the four people who passed on 2026-10-16 fired 9, 9, 22 and 45 rounds; the swarm's
 * programs that hour fired 63 to 160 a go, spraying at the figures' places as the server told them. It was 180.
 */
const SHOTS = 90;
/**
 * Shots landed by the course and refused by the judge in one go, and it carries the bot signature (see `signed`).
 * It was 4 for the two minutes after the release of 2026-10-16 15:43 UTC: Survivor955, a person on an RTX 5070 who
 * had passed with 11 shots an hour before, failed a go with 21 shots, 10 landed, 6 counted and 4 refused (a quick
 * hand flicks onto a figure faster than the sights-on-it rule allows). The four people of the sample had had none;
 * the swarm's programs 4 to 20. Twelve: a third of the programs' goes, and no person seen yet.
 */
const REFUSED = 12;

/**
 * What a go is judged by besides the course itself, set on the host (server/botrules.ts, BOT_RULES: kept off the public
 * code). `hits` and `aim`: a go with that many shots landed by the course, and that share of every shot fired landed, is
 * too sure for a hand (2026-10-18: every program that passed that night landed 11 to 17 with almost nothing missed,
 * every person 6 to 10 and missed a lot). `wrong`: things said that could not be so that a go may have and pass (the
 * programs passed with 1 or 2; no person that night had one). LOOSE is the judging before them.
 */
export interface Limits { hits: number; aim: number; wrong: number }
export const LOOSE: Limits = { hits: Infinity, aim: 2, wrong: 2 };

/**
 * The judge of one go at the course. It is told what the game says (where it stands and looks, and each shot), with
 * the time the game put to it and the server's own, says what the game is to be shown, and keeps count of the
 * figures brought down. Everything is said in the yard's (turned) frame; the judge turns it to the plan's.
 */
export class CourseJudge {
  readonly down = new Set<number>();
  private trail: Seen[] = [];
  private walked = 0;
  private turned = 0;
  private shots = 0;
  private lastShot = -1e9;
  private lastDown = -1e9;
  private landed = 0;
  private aloft = 0;
  /** when the server first showed each figure, and last had it in sight (its own count, ms) */
  private shown: number[] = LANES.map(() => -1);
  /** a counted shot landed on the one with their hands up: the go is over */
  civShot = false;
  /** one has landed on them already: the first is a warning (see `shot`) */
  civWarned = false;
  private seenAt: number[] = LANES.map(() => -1e9);
  /** things said that could not be so (inside a wall, through one, out of the yard, in the air, a leap, a time that runs backwards): three, and the go is over */
  wrong = 0;
  /** why the last shot that landed was not counted, or the last thing that could not be so: for the test and the log */
  why = '';

  /**
   * @param sign what is done with a go that carries the bot signature: see RangeJudge.signed
   * @param limits see Limits
   */
  constructor(readonly course: Course, readonly sign: 'enforce' | 'watch' | 'off' = 'off', readonly limits: Limits = LOOSE) {}

  private timely(ms: number, now: number) {
    return Number.isFinite(ms) && ms <= now + 1000 && ms >= now - 5000;
  }

  /** when the last thing that could not be so was counted (the game's count, ms) */
  private badAt = -1e9;

  /** Something that could not be so: counted once a second at most, so that one glitch of a game's is one thing and not twenty. */
  private bad(why: string, ms = this.badAt + 1000) {
    this.why = why;
    if (ms - this.badAt < 1000) return;
    this.badAt = ms;
    this.wrong++;
  }

  /** Where the game says its player's feet are and where they look, at `ms` by its own count; `now` is the server's. */
  seen(ms: number, x: number, y: number, z: number, yaw: number, pitch: number, now: number) {
    if (![x, y, z, yaw, pitch].every(Number.isFinite) || !this.timely(ms, now)) return this.bad('a time or a place that is no time or place');
    const last = this.trail[this.trail.length - 1];
    if (last && ms <= last.ms) return;
    const { turn, flip, blocks } = this.course, [px, pz] = toPlan(turn, x, z, flip);
    const here: Seen = { ms, x: px, y, z: pz, yaw: yawToPlan(turn, yaw, flip), pitch: Math.max(-1.5, Math.min(1.5, pitch)) };
    // (the yard is the server's: in it, out of the walls, on something)
    if (Math.hypot(px, pz) > YARD.r - 0.1 || y < -0.5 || y > 4.5) return this.bad('out of the yard', ms);
    if (inSolid(px, y, pz, blocks)) return this.bad('inside a wall', ms);
    if (last) {
      const secs = (ms - last.ms) / 1000, far = Math.hypot(px - last.x, pz - last.z);
      // (A leap, or a step through a wall: counted, and where they now are is where they are from now on. Kept to
      // the last good place instead, every telling after it was the same leap again, and one glitch ended the go.)
      const leap = far > 11 * secs + 0.6, wall = !leap && through(last.x, last.y, last.z, px, y, pz, blocks);
      if (leap || wall) {
        this.bad(leap ? 'a leap faster than anybody runs' : 'through a wall', ms);
        this.aloft = 0;
        this.trail.push(here);
        return;
      }
      // (Up off what is under them: a jump is back down inside a second. Hanging a second and a half is not a jump.)
      const over = y - floorAt(px, y, pz, blocks);
      if (y < floorAt(px, y + 0.4, pz, blocks) - 0.4) return this.bad('down in the floor', ms);
      this.aloft = over > 0.6 ? this.aloft + (ms - last.ms) : 0;
      if (this.aloft > 1500) {
        this.aloft = 0;
        return this.bad('hanging in the air', ms);
      }
      this.walked += far;
      this.turned += angle(last, here);
    }
    this.trail.push(here);
    if (this.trail.length > 400) this.trail.shift();
  }

  /**
   * What the game is to be shown now (`now`: the server's count of the go, ms): each figure the player has in sight
   * from where they last said they stood, or would have with half a step either way (so that nothing comes into view
   * late on a slow line), or had in sight a moment ago.
   */
  reveal(now: number): Sighting[] {
    const at = this.trail[this.trail.length - 1];
    if (!at) return [];
    const out: Sighting[] = [];
    const ey = at.y + YARD.eye;
    for (let i = 0; i < figuresOf(this.course); i++) {
      const p = walkAt(this.course, i, now);
      const dx = p.x - at.x, dz = p.z - at.z, flat = Math.hypot(dx, dz) || 1, sx = (-dz / flat) * 0.5, sz = (dx / flat) * 0.5;
      const sees = inSight(this.course, i, at.x, ey, at.z, now) || inSight(this.course, i, at.x + sx, ey, at.z + sz, now) || inSight(this.course, i, at.x - sx, ey, at.z - sz, now) || inSight(this.course, i, at.x, ey, at.z, now + 150);
      if (sees) {
        this.seenAt[i] = now;
        if (this.shown[i] < 0) this.shown[i] = now;
      }
      if (now - this.seenAt[i] > LINGER && !sees) continue;
      const [wx, wz] = fromPlan(this.course.turn, p.x, p.z, this.course.flip), [vx, vz] = fromPlan(this.course.turn, p.vx, p.vz, this.course.flip);
      out.push([i, +wx.toFixed(3), p.y, +wz.toFixed(3), +vx.toFixed(3), +vz.toFixed(3), p.up ? 1 : 0]);
    }
    return out;
  }

  /** A shot the game says it fired, from `o` along `d` (the yard's frame, height from its floor). @returns the figure it brought down, or -1 (see `why`). */
  shot(ms: number, o: readonly number[], d: readonly number[], now: number): number {
    this.why = '';
    if (![...o, ...d].every(Number.isFinite) || o.length !== 3 || d.length !== 3 || !this.timely(ms, now)) return (this.wrong++, -1);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 0.5) return (this.wrong++, -1);
    const { turn, flip } = this.course, [ox, oz] = toPlan(turn, o[0], o[2], flip), [dx, dz] = toPlan(turn, d[0] / len, d[2] / len, flip);
    const po = [ox, o[1], oz], dir = [dx, d[1] / len, dz];
    this.shots++;
    if (ms - this.lastShot < 70) return -1;
    this.lastShot = ms;
    // (against the figures as they are and as they were a moment ago: what the game showed was that old)
    let hit = -1, back = 0;
    for (const r of REWIND) {
      hit = shotLands(this.course, po, dir, ms - r, this.down);
      if (hit >= 0) {
        back = r;
        break;
      }
    }
    if (hit < 0) return -1;
    // (the one with their hands up, walked in front of a figure that was being aimed at: in the way, a miss, and not
    // counted as landed either, where it would go towards the bot signature. What ends the go is shooting them when
    // nobody else was along the line.)
    if (hit === CIV && shotLands(this.course, po, dir, ms - back, new Set([...this.down, CIV])) >= 0) return (this.why = 'somebody with their hands up was in the way', -1);
    this.landed++;
    if (this.shown[hit] < 0 || ms - back < this.shown[hit] + SEEN_FIRST) return (this.why = 'it had not been in sight long enough to be seen', -1);
    const lately = this.trail.filter((s) => s.ms <= ms + 40 && s.ms >= ms - 3000);
    const before = lately.filter((s) => s.ms >= ms - 600);
    const at = before[before.length - 1];
    if (!at || ms - at.ms > 350) return (this.why = 'nothing was said of where they stood when it was fired', -1);
    if (Math.hypot(po[0] - at.x, po[2] - at.z) > 1.6 || po[1] < at.y + 0.2 || po[1] > at.y + 2.1) return (this.why = 'it was not fired from where they stood', -1);
    const look = lookOf(at.yaw, at.pitch);
    if (look[0] * dir[0] + look[1] * dir[1] + look[2] * dir[2] < Math.cos(0.105)) return (this.why = 'it was not fired the way they were looking', -1);
    if (ms < 700) return (this.why = 'no one has seen and aimed in that time', -1);
    if (ms - this.lastDown < 220) return (this.why = 'no one goes from one to the next that fast', -1);
    if (before.length < 4) return (this.why = 'too little was said of the moments before it', -1);
    let travel = 0, most = 0;
    for (let i = 1; i < lately.length; i++) {
      const a = angle(lately[i - 1], lately[i]);
      travel += a;
      if (lately[i].ms >= ms - 600) most = Math.max(most, a / Math.max(0.001, (lately[i].ms - lately[i - 1].ms) / 1000));
    }
    if (travel < 0.01) return (this.why = 'the aim stood dead still before it', -1);
    if (most > 25) return (this.why = 'the aim came round faster than a hand can', -1);
    // (the sights on it for the tenth of a second and more before it, each time the game said where they looked)
    const near = before.filter((s) => s.ms >= ms - 170), held = near.length >= 3 ? near : before.slice(-3);
    for (const s of held) {
      const p = walkAt(this.course, hit, s.ms - back), l = lookOf(s.yaw, s.pitch), flat = l[0] * l[0] + l[2] * l[2];
      const t = flat > 1e-9 ? ((p.x - s.x) * l[0] + (p.z - s.z) * l[2]) / flat : -1;
      if (t <= 0 || Math.hypot(s.x + l[0] * t - p.x, s.z + l[2] * t - p.z) > 0.8) return (this.why = 'the sights were not on it before it was fired', -1);
    }
    // (aimed at, held on and shot: the one with their hands up. Not one of the figures, and the go is over)
    // (Once is a warning, and the go goes on; the second time it is over. Real players fired at them on their first sight
    // of the yard, go after go, and were turned away for it: of the goes failed on 2026-10-19 nearly every one was this,
    // one player failing sixteen. A program that fires at whatever moves fires at them twice.)
    if (hit === CIV) {
      if (!this.civWarned) {
        this.civWarned = true;
        return (this.why = 'shot somebody with their hands up, once: a warning', -1);
      }
      this.civShot = true;
      return (this.why = 'shot somebody with their hands up', -1);
    }
    this.down.add(hit);
    this.lastDown = ms;
    return hit;
  }

  /**
   * The bot signature, as on the strip (RangeJudge.signed): '' when the go does not carry it. Two of its shapes:
   * 2026-10-15's, shots landed and not counted with a body that turned far more than it walked; and 2026-10-16's,
   * REFUSED and more shots landed by the course and not counted, whatever the body did. That day's swarm (Merric635,
   * Brambl116 ...) walked and turned like anybody (8 to 24 degrees a metre) and landed 10 to 26 shots a go of which
   * 4 to 20 were refused (the sights not on the figure before, or not fired the way they looked: a program aiming off
   * the figures' places as the server tells them); the four people who passed in the same hour had none refused.
   */
  get signed(): string {
    const refused = this.landed - this.down.size, per = (this.turned * 180) / Math.PI / Math.max(1, this.walked);
    if (refused >= REFUSED) return `the bot signature (${refused} shots landed by the course and not counted)`;
    return refused >= 2 && per >= 25 ? `the bot signature (${refused} shots landed and not counted, ${per.toFixed(0)} degrees turned for every metre walked)` : '';
  }

  /** more landed, and less missed, than a hand does (see Limits): '' when not */
  get tooSure(): string {
    return this.landed >= this.limits.hits && this.landed >= this.limits.aim * this.shots ? `too sure for a hand (${this.landed} of ${this.shots} shots landed)` : '';
  }

  /** how the go went, in a line: for the server's log */
  get report() {
    const signed = this.sign !== 'off' && this.down.size >= this.course.need ? this.signed : '';
    const sure = this.down.size >= this.course.need ? this.tooSure : '';
    return `${this.civShot ? 'shot somebody with their hands up; ' : this.civWarned ? 'shot somebody with their hands up once; ' : ''}${this.down.size} of ${this.course.need} down, ${this.shots} shots (${this.landed} landed by the course), ${this.trail.length} tellings of where they stood, walked ${this.walked.toFixed(1)} m, turned ${((this.turned * 180) / Math.PI).toFixed(0)} degrees, ${this.wrong} things said that could not be so${this.why ? `; the last: ${this.why}` : ''}${signed ? `; ${signed}${this.sign === 'watch' ? ' (watched, not refused)' : ''}` : ''}${sure ? `; ${sure}` : ''}`;
  }

  /** every figure down, by somebody who walked the yard and looked about it, said nothing that could not be so, and missed like a person: a person */
  get passed() {
    return !this.civShot && this.wrong <= this.limits.wrong && this.down.size >= this.course.need && this.walked >= 1 && this.turned >= 0.15 && !(this.sign === 'enforce' && this.signed) && !this.tooSure;
  }

  /** over, and not passed: the time is up, more was said that could not be so than a go may have, more was fired than anybody fires, or every figure is down and it did not pass */
  failed(now: number) {
    return !this.passed && (this.civShot || now > this.course.secs * 1000 + 1500 || this.wrong > this.limits.wrong || this.shots > SHOTS || this.down.size >= this.course.need);
  }
}
