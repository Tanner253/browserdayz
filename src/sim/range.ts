// The bot check (2026-10-12: "lets build our own bot detector... a firing range... they must shoot targets over a
// period of a few seconds in order to prove human... the targets should move, and have obstacles in front of them so
// that you have to move around to shoot them... no ip can reach the server and join the game without passing").
//
// A range is dealt by the server, a different one every time: walls of cover standing in different places, and
// figures that walk to and fro behind them, each at its own pace. Some of the figures cannot be seen at all from
// where the player starts: there is no standing still and no one place to shoot them all from. Whoever asks to
// play shoots them; and it is the SERVER that says whether they did. The game that is asking says only where it
// stands, where it looks, and each shot it fires: the server works out for itself, from the range it dealt, where
// each figure was at that moment, whether a wall was in the way, whether the shot was fired from where the player
// had walked to and along where they were looking, and whether the looking was a person's (an aim that had been
// travelling, not one that stood on a spot or came from nowhere). Nothing a game says of its own shooting is taken.
//
// This file is the range itself and the judging of it, with nothing of the game or the server in it: both use it,
// and so does the test (test/range.test.ts).
//
// The range's own measures, metres: x to the right, y up, the player looking along -z. The player keeps to the
// strip behind the line (z from 0 to 6); the cover stands from 6 to 11 metres down the range; the figures walk
// between 13 and 24.

export interface Cover { x: number; z: number; w: number; d: number; h: number }
export interface Figure { x: number; z: number; reach: number; secs: number; start: number }
export interface RangeSpec { seed: number; turn: number; cover: Cover[]; figures: Figure[]; need: number; secs: number }

/** half the width of the strip the player keeps to, how deep it is, and where they start on it */
export const STRIP = { half: 10, deep: 6, start: [0, 3] as [number, number] };
/** how far down the range the back wall stands, and how high the eye of somebody standing is */
export const BACK = 27, EYE = 1.62;
/** a figure, as the judge takes it: a post this thick, from the knee to the crown */
const BODY = { r: 0.42, low: 0.25, high: 1.8 };

/** a dice that falls the same way for the same number, wherever it is thrown */
function dice(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where a figure is, `ms` after the range began: to and fro along its lane, slowing as it turns. */
export function figureAt(f: Figure, ms: number): { x: number; z: number; vx: number } {
  const a = (ms / 1000 / f.secs + f.start) * Math.PI * 2;
  return { x: f.x + Math.sin(a) * f.reach, z: f.z, vx: ((Math.cos(a) * f.reach * Math.PI * 2) / f.secs) };
}

/** How far along a ray a wall is met (Infinity: it is not). */
function wallAlong(c: Cover, o: readonly number[], d: readonly number[]): number {
  let near = 0, far = Infinity;
  const lo = [c.x - c.w / 2, 0, c.z - c.d / 2], hi = [c.x + c.w / 2, c.h, c.z + c.d / 2];
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

/** How far along a ray a figure standing at (x, z) is met (Infinity: it is not): the ray's nearest pass by the post it is taken for. */
function bodyAlong(x: number, z: number, o: readonly number[], d: readonly number[]): number {
  // (nearest on the level first: the post is upright)
  const dx = d[0], dz = d[2], flat = dx * dx + dz * dz;
  if (flat < 1e-9) return Infinity;
  const t = ((x - o[0]) * dx + (z - o[2]) * dz) / flat;
  if (t <= 0) return Infinity;
  const px = o[0] + dx * t - x, pz = o[2] + dz * t - z, y = o[1] + d[1] * t;
  if (px * px + pz * pz > BODY.r * BODY.r || y < BODY.low || y > BODY.high) return Infinity;
  return t;
}

/**
 * A shot from `o` along `d` (a length of one), `ms` after the range began: which figure it lands on, of those
 * still standing (-1: none; a wall stood in the way, or it went by).
 */
export function shotLands(spec: RangeSpec, o: readonly number[], d: readonly number[], ms: number, down: ReadonlySet<number> = new Set()): number {
  let wall = Infinity;
  for (const c of spec.cover) wall = Math.min(wall, wallAlong(c, o, d));
  let best = -1, at = wall;
  spec.figures.forEach((f, i) => {
    if (down.has(i)) return;
    const p = figureAt(f, ms), t = bodyAlong(p.x, p.z, o, d);
    if (t < at) {
      at = t;
      best = i;
    }
  });
  return best;
}

/** By how much a shot goes wide of each figure (metres, on the level, where it passes nearest), and how far along it the first wall is: for finding out why a shot was not counted. */
export function shotMisses(spec: RangeSpec, o: readonly number[], d: readonly number[], ms: number): string {
  let wall = Infinity;
  for (const c of spec.cover) wall = Math.min(wall, wallAlong(c, o, d));
  return `wall at ${wall === Infinity ? 'none' : wall.toFixed(1)}; ` + spec.figures.map((f, i) => {
    const p = figureAt(f, ms), flat = d[0] * d[0] + d[2] * d[2], t = ((p.x - o[0]) * d[0] + (p.z - o[2]) * d[2]) / flat;
    return `${i}: wide ${Math.hypot(o[0] + d[0] * t - p.x, o[2] + d[2] * t - p.z).toFixed(2)} at ${t.toFixed(1)} m, height ${(o[1] + d[1] * t).toFixed(2)}`;
  }).join('; ');
}

/** Is there a clear shot at a figure's chest from where an eye is, at a moment: no wall in the way, and no other figure? */
export function clearShot(spec: RangeSpec, i: number, ex: number, ez: number, ms: number, down: ReadonlySet<number> = new Set()): boolean {
  const p = figureAt(spec.figures[i], ms), v = [p.x - ex, 1.2 - EYE, p.z - ez];
  const len = Math.hypot(v[0], v[1], v[2]);
  return shotLands(spec, [ex, EYE, ez], [v[0] / len, v[1] / len, v[2] / len], ms, down) === i;
}

/** the moments a range is tried at when it is dealt: ten, over its first eight seconds (it is dealt on the server's one thread, with everybody's game waiting on it: no more is tried than tells a fair range from an unfair one) */
const MOMENTS = Array.from({ length: 10 }, (_, k) => k * 800);
/** and the places on the strip it is tried from */
const PLACES: [number, number][] = [];
for (let x = -STRIP.half + 1; x <= STRIP.half - 1; x += 1.5) for (const z of [1.5, 4.5]) PLACES.push([x, z]);
/** how many of those moments there is a clear shot at each figure from a place on the strip */
function clearFrom(spec: RangeSpec, ex: number, ez: number): number[] {
  return spec.figures.map((_, i) => MOMENTS.reduce((n, ms) => n + (clearShot(spec, i, ex, ez, ms) ? 1 : 0), 0));
}

/** The range a number gives at its `turn`th trying: as the dice fall, fair or not. */
function laid(seed: number, turn: number): RangeSpec {
  const r = dice((seed ^ 0x9e3779b9) + turn * 7919);
  const cover: Cover[] = [];
  // three or four walls: one always before the start, so that what walks behind it is hidden from there
  const walls = 3 + (r() < 0.5 ? 1 : 0);
  const slots = [-1, 0, 1, walls === 4 ? (r() < 0.5 ? -2 : 2) : 0].slice(0, walls);
  slots.forEach((s, k) => {
    const w = 3.2 + r() * 3.2;
    cover.push({ x: k === 1 ? (r() - 0.5) * 2.4 : s * (4.6 + r() * 1.6) + (r() - 0.5) * 1.2, z: -(6.5 + r() * 4.5), w, d: 0.5 + r() * 0.5, h: 2.5 });
  });
  // (Shuffled by hand. Left to the language's own sorting with a dice for a rule, the order came out one way on the
  // server and another in a browser, which sort differently: the game showed two figures walking each in the
  // other's lane, and nobody could have hit either where the judge had them.)
  const lanes = [-13.5, -16.5, -19.5, -22.5];
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  const figures: Figure[] = lanes.map((z) => ({ x: (r() - 0.5) * 12, z, reach: 1.4 + r() * 2.2, secs: 3 + r() * 2.6, start: r() }));
  // (All of them, in half a minute. 2026-10-12, an hour after it went in asking for three in forty seconds: "the
  // user has 30 seconds to kill all the bots".)
  return { seed, turn, cover, figures, need: figures.length, secs: 30 };
}

/**
 * Is a range a fair one and a hard one? Two of its figures at least are not to be had from where the player
 * starts, at any moment; there is no one place they can all be had from; and each is fairly to be had, from a
 * good many places at a good many moments (a figure that shows for an instant through one chink is a minute's
 * waiting, and nobody's idea of a check).
 */
function fair(spec: RangeSpec): boolean {
  // (looked at closely, the one place: every quarter of a second of the first eight)
  const hidden = spec.figures.filter((_, i) => !Array.from({ length: 32 }, (__, k) => k * 250).some((ms) => clearShot(spec, i, STRIP.start[0], STRIP.start[1], ms))).length;
  if (hidden < 2) return false;
  const chances = spec.figures.map(() => 0);
  for (const [x, z] of PLACES) {
    const s = clearFrom(spec, x, z);
    s.forEach((n, i) => (chances[i] += n));
    if (s.every((n) => n > 0)) return false;
  }
  return chances.every((n) => n >= 20);
}

/** how many times a number is tried before the plain range is given for it */
const TRIES = 400;
/** the plain range: never yet needed in a million numbers, and there so that nobody is ever left with none */
const plain = (seed: number): RangeSpec => ({
  seed,
  turn: TRIES,
  cover: [{ x: 0, z: -8, w: 5, d: 0.6, h: 2.5 }, { x: -6.5, z: -9, w: 4, d: 0.6, h: 2.5 }, { x: 6.5, z: -7, w: 4, d: 0.6, h: 2.5 }],
  figures: [{ x: 0, z: -16.5, reach: 1.6, secs: 4, start: 0 }, { x: -9, z: -13.5, reach: 1.5, secs: 3.5, start: 0.3 }, { x: 9, z: -19.5, reach: 1.5, secs: 4.4, start: 0.6 }, { x: 0, z: -22.5, reach: 1.4, secs: 5, start: 0.1 }],
  need: 4,
  secs: 30,
});

/**
 * The dealing of a range for a number, a trying at a time: tried and tried again, the same way for the same
 * number, until it is fair. (A trying is half a thousandth of a second and there may be a hundred of them: the
 * server deals its ranges ahead, one trying between other things, and not in the moment somebody asks to come in.)
 */
export function* dealing(seed: number): Generator<void, RangeSpec> {
  for (let turn = 0; turn < TRIES; turn++) {
    const spec = laid(seed, turn);
    if (fair(spec)) return spec;
    yield;
  }
  return plain(seed);
}

/**
 * The range for a number: dealt whole, now; or, told at which trying the dealing ended (the server says, with the
 * number), laid straight out with nothing tried.
 */
export function rangeOf(seed: number, turn?: number): RangeSpec {
  if (turn !== undefined) return turn >= TRIES || turn < 0 ? plain(seed) : laid(seed, Math.floor(turn));
  const deal = dealing(seed);
  for (;;) {
    const step = deal.next();
    if (step.done) return step.value;
  }
}

// ------------------------------------------------------------------ the judging

interface Seen { ms: number; x: number; z: number; yaw: number; pitch: number }

const angle = (a: Seen, b: Seen) => {
  const dy = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
  return Math.hypot(dy * Math.cos(a.pitch), b.pitch - a.pitch);
};
/** which way somebody looking with this turn and this tilt is looking (the game's own: no turn is along -z, and a turn to the left is more) */
export const lookOf = (yaw: number, pitch: number): [number, number, number] => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

/**
 * The judge of one go at a range. It is told what the game says (where it stands and looks, and each shot) with
 * the time the game put to it and the time it reached here, and keeps count of the figures brought down.
 */
export class RangeJudge {
  readonly down = new Set<number>();
  private trail: Seen[] = [];
  private walked = 0;
  private turned = 0;
  private shots = 0;
  private lastShot = -1e9;
  private lastDown = -1e9;
  private landed = 0;
  /** things said that could not be so (a leap across the strip, a time that runs backwards): three, and the go is over */
  wrong = 0;
  /** why the last shot that landed was not counted, if it was not: for the test, and for the server's log */
  why = '';

  constructor(readonly spec: RangeSpec) {}

  /** the time a game puts to a thing has to be one it could have been said at: not after now, and not long before */
  private timely(ms: number, now: number) {
    return Number.isFinite(ms) && ms <= now + 150 && ms >= now - 3000;
  }

  /** Where the game says its player stands and looks, at `ms` by its own count; `now` is the server's count. */
  seen(ms: number, x: number, z: number, yaw: number, pitch: number, now: number) {
    if (![x, z, yaw, pitch].every(Number.isFinite) || !this.timely(ms, now)) return void this.wrong++;
    const last = this.trail[this.trail.length - 1];
    if (last && ms <= last.ms) return;
    // (kept to the strip: what is said of anywhere else is not where they are)
    if (Math.abs(x) > STRIP.half + 1.5 || z < -1.5 || z > STRIP.deep + 1.5) return void this.wrong++;
    const here: Seen = { ms, x, z, yaw, pitch: Math.max(-1.5, Math.min(1.5, pitch)) };
    if (last) {
      const secs = (ms - last.ms) / 1000, far = Math.hypot(x - last.x, z - last.z);
      // (nobody covers ground faster than a sprint: a little over, for a report that came late and one that came early)
      if (far > 11 * secs + 0.6) return void this.wrong++;
      this.walked += far;
      this.turned += angle(last, here);
    }
    this.trail.push(here);
    if (this.trail.length > 240) this.trail.shift();
  }

  /**
   * A shot the game says it fired. @returns the figure it brought down, or -1: it landed on none, or it landed and
   * is not counted (see `why`).
   */
  shot(ms: number, o: readonly number[], d: readonly number[], now: number): number {
    this.why = '';
    if (![...o, ...d].every(Number.isFinite) || o.length !== 3 || d.length !== 3 || !this.timely(ms, now)) return (this.wrong++, -1);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 0.5) return (this.wrong++, -1);
    const dir = [d[0] / len, d[1] / len, d[2] / len];
    this.shots++;
    // (no gun there fires faster)
    if (ms - this.lastShot < 70) return -1;
    this.lastShot = ms;
    const hit = shotLands(this.spec, o, dir, ms, this.down);
    if (hit < 0) return -1;
    this.landed++;
    // ---- it landed, by the range. Was it fired by the player the game has been telling of?
    const lately = this.trail.filter((s) => s.ms <= ms + 40 && s.ms >= ms - 3000);
    const before = lately.filter((s) => s.ms >= ms - 600);
    const at = before[before.length - 1];
    if (!at || ms - at.ms > 350) return (this.why = 'nothing was said of where they stood when it was fired', -1);
    if (Math.hypot(o[0] - at.x, o[2] - at.z) > 1.6 || o[1] < 0.5 || o[1] > 2.1) return (this.why = 'it was not fired from where they stood', -1);
    const look = lookOf(at.yaw, at.pitch);
    // (six degrees between the two: what a gun throws wide of where it is pointed, and a little for the turn of the head since it was last told)
    if (look[0] * dir[0] + look[1] * dir[1] + look[2] * dir[2] < Math.cos(0.105)) return (this.why = 'it was not fired the way they were looking', -1);
    // ---- and was the looking a person's? An aim that has been travelling, by somebody who had time to see.
    if (ms < 700) return (this.why = 'no one has seen and aimed in that time', -1);
    if (ms - this.lastDown < 220) return (this.why = 'no one goes from one to the next that fast', -1);
    if (before.length < 4) return (this.why = 'too little was said of the moments before it', -1);
    let travel = 0, most = 0;
    for (let i = 1; i < lately.length; i++) {
      const a = angle(lately[i - 1], lately[i]);
      travel += a;
      if (lately[i].ms >= ms - 600) most = Math.max(most, a / Math.max(0.001, (lately[i].ms - lately[i - 1].ms) / 1000));
    }
    // (Somebody who has come to a new place and found a figure has turned to do it: half a degree in the three
    // seconds before a shot is less than anybody's, and a hand may then be quite still while a figure walks into
    // the sights. And no hand goes round faster than four turns a second.)
    if (travel < 0.01) return (this.why = 'the aim stood dead still before it', -1);
    if (most > 25) return (this.why = 'the aim came round faster than a hand can', -1);
    // ---- and were the sights ON it? (2026-10-12, the first hour: "they did not have to kill all the bots, they
    // just moved left and right and it passed". Whatever landed was counted, so a rifle held down and swept
    // along the range brought figures down by the dozen rounds. A shot is somebody's who had the figure in
    // their sights when they fired: for the tenth of a second and more before it, each time the game told
    // where they were looking, the look passed within the width of a doorway of where the figure then was.)
    // (On a machine that draws slowly less is told in that time: then it is the last three tellings, however long ago.)
    const near = before.filter((s) => s.ms >= ms - 170), held = near.length >= 3 ? near : before.slice(-3);
    for (const s of held) {
      const p = figureAt(this.spec.figures[hit], s.ms), l = lookOf(s.yaw, s.pitch), flat = l[0] * l[0] + l[2] * l[2];
      const t = flat > 1e-9 ? ((p.x - s.x) * l[0] + (p.z - s.z) * l[2]) / flat : -1;
      if (t <= 0 || Math.hypot(s.x + l[0] * t - p.x, s.z + l[2] * t - p.z) > 0.8) return (this.why = 'the sights were not on it before it was fired', -1);
    }
    this.down.add(hit);
    this.lastDown = ms;
    return hit;
  }

  /** how the go went, in a line: for the server's log */
  get report() {
    return `${this.down.size} of ${this.spec.need} down, ${this.shots} shots (${this.landed} landed by the range), ${this.trail.length} tellings of where they stood, walked ${this.walked.toFixed(1)} m, turned ${((this.turned * 180) / Math.PI).toFixed(0)} degrees, ${this.wrong} things said that could not be so${this.why ? `; the last shot not counted: ${this.why}` : ''}`;
  }

  /** every figure down, by somebody who walked the strip and looked about it: a person */
  get passed() {
    return this.wrong < 3 && this.down.size >= this.spec.need && this.walked >= 1 && this.turned >= 0.15;
  }

  /** over, and not passed: the time is up, too much was said that could not be so, or more was fired than anybody fires */
  failed(now: number) {
    // (and nobody who is aiming fires four magazines in half a minute)
    return !this.passed && (now > this.spec.secs * 1000 + 1500 || this.wrong >= 3 || this.shots > 120);
  }
}
