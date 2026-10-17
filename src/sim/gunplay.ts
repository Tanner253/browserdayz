// How the guns shoot. One place for what each cartridge does in the air and what each gun does with it, read by
// the game (a bullet's flight, the kick, the cone a shot can land in, what its sights are set for) and by the
// server (what a hit at a distance does, and how fast a gun can hit). A gun added to the game is added here, or it
// does not fire.
//
// The cartridges' figures are their makers' published ones: the speed at the muzzle and the speed down range,
// from which comes how fast the air slows each. Nothing here is out of another game's files.

export const GRAVITY = 9.81;
/** a minute of angle, radians */
export const MOA = Math.PI / 180 / 60;

export interface Cartridge {
  name: string;
  /** the speed it leaves an ordinary barrel for it at, m/s */
  vel: number;
  /**
   * How the air slows it, 1/m: the drag goes by the square of the speed, so over level ground it keeps
   * e^(-drag x metres) of its speed. Worked from the two speeds in its table.
   */
  drag: number;
  /** what one of them does to a body with nothing on it, at the muzzle */
  damage: number;
  /** a shell: how many leave at once, and how wide they go (radians across) */
  pellets?: number;
  cone?: number;
}

export const CARTRIDGES: Record<string, Cartridge> = {
  // 9x19, 115 grain ball: 360 m/s at the muzzle, 312 at a hundred yards
  ammo_9mm: { name: '9x19', vel: 360, drag: 0.00156, damage: 34 },
  // .45 ACP, 230 grain ball: 255 m/s, 237 at a hundred yards. Slow, and nearly half as heavy again as it looks.
  ammo_45: { name: '.45 ACP', vel: 255, drag: 0.0008, damage: 46 },
  // .50 Action Express, 300 grain: 450 m/s, 378 at a hundred yards
  ammo_50: { name: '.50 AE', vel: 450, drag: 0.0019, damage: 58 },
  // 7.62x54R, 148 grain ball from a long barrel: 830 m/s, 622 at three hundred yards
  ammo_762: { name: '7.62x54R', vel: 830, drag: 0.00105, damage: 95 },
  // 7.62x39, 123 grain: 715 m/s, 480 at three hundred yards
  ammo_739: { name: '7.62x39', vel: 715, drag: 0.00145, damage: 52 },
  // 5.56x45, 62 grain from a rifle's barrel: 900 m/s, 645 at three hundred yards
  ammo_556: { name: '5.56x45', vel: 900, drag: 0.00122, damage: 42 },
  // 12 gauge, nine pellets of buckshot: 400 m/s, 278 at fifty yards. (They go wider than a real barrel throws
  // them: it is a gun for a corridor here, and has been since it was added.)
  ammo_12: { name: '12 gauge', vel: 400, drag: 0.008, damage: 14, pellets: 9, cone: 0.075 },
};

export interface Gun {
  /** what it fires (the same as its item says: a test holds the two together) */
  ammo: string;
  /** rounds a minute: an automatic's rate, or as fast as its trigger can be worked */
  rpm: number;
  /** worked by hand between shots: seconds from one shot to the next (what the server goes by) */
  cycle?: number;
  /** it goes on firing while the trigger is held, if it is set to */
  auto?: boolean;
  /** its barrel next to an ordinary one for its cartridge: the speed its rounds leave at, as a multiple */
  barrel: number;
  /** how true it shoots from a rest: the width of the cone its rounds go into, minutes of angle */
  moa: number;
  /** the cone from the hip, standing still: degrees across */
  hip: number;
  /** the kick: how far one shot throws the muzzle up, and across either way, degrees (standing, not aimed) */
  up: number;
  side: number;
  /** which way it walks across on the whole: -1 left .. 1 right */
  lean: number;
  /** the first shot of a string next to the ones after it (a heavy bolt carrier going home: more) */
  first: number;
  /** what is left of the kick once whoever is firing has leaned into a long string (a share of `up`) */
  held: number;
  /** the share of each shot's rise that stays until it is pulled down; the rest comes back by itself */
  stays: number;
  /** how fast the muzzle comes back, 1/s */
  back: number;
  /** how the gun in the hands jumps (seen; it does not move the shot), and whether it is one of the heavy ones */
  jump: number;
  heavy?: boolean;
  /** the ranges its sights can be set for, metres: the first is how it comes */
  zero: number[];
  /** the furthest a hit with it is believed, metres */
  reach: number;
}

export const GUNS: Record<string, Gun> = {
  // (the bolt rifle: one hard shove, and a long way back to the target)
  mosin: { ammo: 'ammo_762', rpm: 300, cycle: 0.8, barrel: 1, moa: 1.6, hip: 1.3, up: 3.1, side: 0.5, lean: 0.15, first: 1, held: 1, stays: 0.24, back: 8.5, jump: 3.2, heavy: true, zero: [100, 200, 300, 400, 500, 600], reach: 900 },
  // (the Colt: a heavier round than the 9 mm's and a harder shove with each, a little slower to come back)
  colt: { ammo: 'ammo_45', rpm: 380, barrel: 1, moa: 6, hip: 1.8, up: 2.1, side: 0.5, lean: 0, first: 1, held: 1, stays: 0.26, back: 9, jump: 1.9, zero: [25], reach: 200 },
  m9: { ammo: 'ammo_9mm', rpm: 460, barrel: 1, moa: 6, hip: 1.7, up: 1.4, side: 0.4, lean: 0, first: 1, held: 1, stays: 0.23, back: 10, jump: 1.6, zero: [25], reach: 220 },
  deagle: { ammo: 'ammo_50', rpm: 220, barrel: 1, moa: 5, hip: 1.9, up: 3.3, side: 0.8, lean: 0, first: 1, held: 1, stays: 0.3, back: 8, jump: 2.7, heavy: true, zero: [25, 50], reach: 260 },
  benelli: { ammo: 'ammo_12', rpm: 176, barrel: 1, moa: 7, hip: 1.3, up: 3.9, side: 0.9, lean: 0, first: 1, held: 1, stays: 0.24, back: 8.5, jump: 4.2, heavy: true, zero: [25], reach: 70 },
  // (The AK: a heavy round and a heavy bolt carrier. Its first shot is the worst of a string, it climbs and pulls
  // to the right, and it never quite settles: short bursts, or it is pointing at the sky.)
  ak: { ammo: 'ammo_739', rpm: 600, auto: true, barrel: 1, moa: 4, hip: 2.1, up: 1.45, side: 0.5, lean: 0.4, first: 1.3, held: 0.78, stays: 0.46, back: 8.5, jump: 2.1, zero: [100, 200, 300, 400], reach: 500 },
  // (The AR-15: a light round in a straight line with the shoulder. Faster, flatter, and it stays where it is put;
  // this one's barrel is a short one, and its rounds leave it a little slower than a rifle's.)
  // (The submachine gun: a pistol's round out of a barrel half as long again, fast, with nothing against the
  // shoulder. Each shot is little; there are a great many of them, and they walk.)
  mpa: { ammo: 'ammo_9mm', rpm: 780, auto: true, barrel: 1.08, moa: 6, hip: 2.3, up: 0.8, side: 0.5, lean: 0.15, first: 1.05, held: 0.85, stays: 0.34, back: 9.5, jump: 1.0, zero: [50, 100], reach: 260 },
  aks74u: { ammo: 'ammo_739', rpm: 700, auto: true, barrel: 0.8, moa: 6, hip: 2.3, up: 1.7, side: 0.65, lean: 0.4, first: 1.4, held: 0.8, stays: 0.5, back: 8.5, jump: 2.2, zero: [100, 200], reach: 350 },
  mp7a1: { ammo: 'ammo_9mm', rpm: 950, auto: true, barrel: 1.0, moa: 5, hip: 1.9, up: 0.55, side: 0.35, lean: 0.12, first: 0.9, held: 0.78, stays: 0.3, back: 8, jump: 0.9, zero: [50, 100], reach: 260 },
  scorpion: { ammo: 'ammo_9mm', rpm: 1150, auto: true, barrel: 1.0, moa: 6, hip: 2.1, up: 0.7, side: 0.45, lean: 0.14, first: 1.0, held: 0.82, stays: 0.32, back: 9, jump: 0.95, zero: [50, 100], reach: 240 },
  ar15: { ammo: 'ammo_556', rpm: 700, auto: true, barrel: 0.94, moa: 2, hip: 1.9, up: 0.98, side: 0.32, lean: 0.1, first: 1.1, held: 0.7, stays: 0.42, back: 10.5, jump: 1.5, zero: [100, 200, 300], reach: 550 },
};

/** What a gun's shot is when it leaves: its cartridge, through its barrel. */
export function shotOf(id: string): { muzzleVel: number; drag: number; damage: number; pellets: number; cone: number } {
  const g = GUNS[id], c = CARTRIDGES[g?.ammo];
  if (!g || !c) return { muzzleVel: 350, drag: 0.002, damage: 0, pellets: 1, cone: 0 };
  return { muzzleVel: c.vel * g.barrel, drag: c.drag, damage: c.damage, pellets: c.pellets ?? 1, cone: c.cone ?? 0 };
}

/**
 * What a suppressor leaves of a round's speed. Whoever fires flies their round at this, and so must everybody
 * else's copy of it: flown at its full speed in the other games, a quieted 9 mm was faster than sound there, and
 * cracked past a head it went by in silence where it was fired, and landed higher.
 */
export const QUIETED = 0.9;

/** the speed of sound, m/s */
export const SOUND = 343;
/**
 * How much of a crack a round makes that is going this fast: 0 (slower than sound: none) .. 1 (a rifle's). It is
 * what a suppressor does nothing about, and most of how loud a quieted gun still is: see `gunshot` in
 * src/core/audio.ts. (A 9 mm from a pistol is under the speed of sound once it is quieted, and has none.)
 */
export const crackOf = (speed: number) => Math.min(1, Math.max(0, (speed / SOUND - 1) / 0.3));

/** seconds from one shot to the next at its fastest */
export const intervalOf = (id: string) => 60 / (GUNS[id]?.rpm ?? 460);

/**
 * The wait before a gun can fire again, a frame of `dt` seconds later: at nought or under, it can. When the shot
 * goes its interval is added to this (`wait += intervalOf(id)`), not put in its place.
 *
 * A gun comes ready part of the way through a frame, and what was left of that frame is the little this goes
 * under nought by. It was thrown away, so every shot waited for the next whole frame and a gun's rate was its
 * rate rounded down to a number of frames: at sixty frames a second the AR-15's 700 a minute was the AK's 600,
 * and the submachine gun's 780 was 720. Kept, the next shot comes that much sooner and the rate is the gun's
 * own at any frame rate. Only that one frame's worth is ever kept: a gun that was ready and was not fired owes
 * nothing, or one left alone for a second would fire its next ten rounds in ten frames.
 */
export function cooled(wait: number, dt: number): number {
  if (wait <= 0) return 0;
  const left = wait - dt;
  // (a rate that is a whole number of frames comes out a hair either side of nought: it is nought)
  return Math.abs(left) < 1e-9 ? 0 : left;
}

/**
 * What a round still does when it has lost speed. It hurts by its energy, which goes by the square of its speed;
 * and a round with almost none left still does this share of what it did at the muzzle.
 */
export const SPENT = 0.4;
export function damageKept(speedShare: number): number {
  const e = Math.min(1, Math.max(0, speedShare) ** 2);
  return SPENT + (1 - SPENT) * e;
}

/** the share of its speed a round has left after so many metres (over level ground: what the server, which flies nothing, goes by) */
export const speedAt = (drag: number, metres: number) => Math.exp(-drag * Math.max(0, metres));

/**
 * How far above the line of sight the barrel points for its round to come back down onto that line at `zero`
 * metres: the slope, as a share of the distance. Flat fire with drag by the square of the speed has an answer
 * that can be written down: the fall after x metres is g (e^(2kx) - 1 - 2kx) / (4 k^2 v^2).
 */
export function elevationFor(muzzleVel: number, drag: number, zero: number): number {
  const a = 2 * drag * zero;
  // (with next to no drag the same thing is g x / 2 v^2: said so, or it is nought over nought)
  const fall = a < 1e-4 ? (GRAVITY * zero * zero) / (2 * muzzleVel * muzzleVel) : (GRAVITY * (Math.exp(a) - 1 - a)) / (4 * drag * drag * muzzleVel * muzzleVel);
  return fall / zero;
}

/** The range a gun's sights are set for: what its item says, if that is one of the ranges it has; else how it comes. */
export function zeroOf(id: string, set?: number): number {
  const z = GUNS[id]?.zero ?? [100];
  return set !== undefined && z.includes(set) ? set : z[0];
}

/** A bullet carried forward a moment (changes `vel` and `pos`): the air takes speed off it by the square of its speed, and it falls. */
export function fly(pos: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }, drag: number, h: number) {
  const k = drag * Math.hypot(vel.x, vel.y, vel.z) * h;
  vel.x -= vel.x * k;
  vel.y -= vel.y * k + GRAVITY * h;
  vel.z -= vel.z * k;
  pos.x += vel.x * h;
  pos.y += vel.y * h;
  pos.z += vel.z * h;
}

/** How whoever is firing stands, and what they are firing. */
export interface Hold {
  /** which shot of the string this is, counting from 1 (shots close together are one string: see `heat` in the game) */
  shot: number;
  crouched: boolean;
  prone: boolean;
  aimed: boolean;
  /** how fresh the arms are, 0 (spent) .. 1 */
  arms: number;
  /** the gun's handling with what is on it, 0..100, and what its fittings do to its kick (a multiple) */
  ergo: number;
  fitted: number;
}

export interface Kick {
  /** thrown up and across (to the right, positive) and coming back, radians */
  up: number;
  across: number;
  /** and staying until it is pulled down, radians */
  stayUp: number;
  stayAcross: number;
  /** how fast it comes back, 1/s */
  back: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));

/**
 * The two rifles held open: where each shot of a string throws the muzzle, up and across (to the right,
 * positive), degrees, standing and not aimed. (2026-10-12: "the recoil patterns for the AK and AR-5 are not
 * realistic or dramatic enough, google the AK recoil pattern on rust and use something similar".)
 *
 * What is told of that pattern, by everybody who has written of it, is its shape and not its figures: the first
 * few rounds go nearly straight up and hard, and then the muzzle snakes as it climbs: off to the right for about
 * five, back across to the left for about eleven, right again for about eight, and left. The figures here are
 * this game's own, drawn to that shape: a string is the same string every time, give or take a little, so that it
 * can be learnt and pulled against. Each of them was a sum with a sine in it: a gun that rose a little and
 * wandered.
 *
 * The AK: thirty-one and a half degrees up over a magazine if nothing is done about it, of which not quite half
 * stays until it is pulled down; four and a half degrees to the right, seven back to the left, five right again.
 * The AR-15, a lighter round in a straight-line stock: two thirds of the climb, and its snake goes the other way
 * first (left, then right, then left) and half as wide.
 * Past the end of a table (a drum, a sixty-round magazine) its last twenty go round again.
 *
 * (2026-10-13: "the recoil on AR's is not dramatic enough, we need more vertical recoil per bullet, dont go crazy
 * ... the recoil pattern that goes left and right is good but it doesnt go up enough". So the snake is as it was
 * and every shot climbs more: `lift`. The AR-15 by four tenths, which brings a magazine of it to twenty-nine
 * degrees, where it was twenty-one; the AK, which was the one that climbed, by an eighth, to thirty-six.)
 */
const snake = (rows: [shots: number, up: number, upLast: number, across: number][], lift = 1): [number, number][] =>
  rows.flatMap(([n, u0, u1, a]) => Array.from({ length: n }, (_, i): [number, number] => [(n > 1 ? u0 + ((u1 - u0) * i) / (n - 1) : u0) * lift, a]));
export const PATTERNS: Record<string, [up: number, across: number][]> = {
  ak: snake([
    [1, 1.85, 1.85, 0.07], [3, 1.5, 1.4, 0.2],
    [5, 1.3, 1.1, 0.78],
    [1, 1.05, 1.05, -0.5], [9, 1.0, 0.9, -0.72], [1, 0.9, 0.9, -0.4],
    [1, 0.9, 0.9, 0.5], [6, 0.9, 0.9, 0.72], [1, 0.9, 0.9, 0.4],
    [2, 0.9, 0.9, -0.6],
  ], 1.125),
  ar15: snake([
    [1, 1.15, 1.15, 0], [2, 1.0, 0.95, -0.07],
    [7, 0.85, 0.7, -0.34],
    [10, 0.65, 0.65, 0.32],
    [10, 0.6, 0.6, -0.27],
  ], 1.4),
};
const TAIL = 20;

/**
 * What one shot does to the aim.
 *
 * Up: the gun's own figure; more for the first of a string where its bolt carrier is a heavy one, and less from
 * the third shot to the sixth as whoever is firing leans into it. Across: the first few go the way the gun
 * leans, and after them it saws from side to side, never twice quite the same. A knee takes three tenths off it,
 * lying down takes half, the sights at the eye a little, tired arms give it back, and what is fitted says its own.
 * @param rnd a number from 0 to 1, new every call (the game's dice; a test's own)
 */
export function kickOf(id: string, hold: Hold, rnd: () => number): Kick {
  const g = GUNS[id];
  if (!g) return { up: 0, across: 0, stayUp: 0, stayAcross: 0, back: 9 };
  const n = Math.max(1, hold.shot);
  const body = (hold.prone ? 0.5 : hold.crouched ? 0.7 : 1) * (hold.aimed ? 0.85 : 1) * hold.fitted * (1 + (1 - hold.arms) * 0.5) * lerp(1.12, 0.92, hold.ergo / 100);
  const table = PATTERNS[id];
  if (table) {
    // (a rifle with a string of its own: this shot's place in it, a little off it either way, and steadied or not as any gun is)
    const [u, a] = table[n <= table.length ? n - 1 : table.length - TAIL + ((n - table.length - 1) % TAIL)];
    const up = rad(u) * body * (0.94 + rnd() * 0.12), across = (rad(a) + rad(g.side) * (rnd() - 0.5) * 0.3) * body;
    return { up: up * (1 - g.stays), across: across * (1 - g.stays), stayUp: up * g.stays, stayAcross: across * g.stays, back: g.back };
  }
  const string = n === 1 ? g.first : lerp(1, g.held, (n - 2) / 4);
  const up = rad(g.up) * string * body * (0.92 + rnd() * 0.16);
  // (one shot by itself goes either way; in a string the gun has a way it goes, and then a sway)
  const sway = n === 1 ? (rnd() - 0.5) * 1.4 : n <= 3 ? 0.35 : Math.sin(n * 1.7 + g.rpm * 0.01) * 0.85;
  const across = rad(g.side) * body * (g.lean * (n <= 3 ? 1 : 0.45) + sway + (rnd() - 0.5) * 0.4);
  return { up: up * (1 - g.stays), across: across * (1 - g.stays * 0.5), stayUp: up * g.stays, stayAcross: across * g.stays * 0.5, back: g.back };
}

/** Where whoever is firing is, for how wide the shot can go. */
export interface Stance {
  /** how far the gun is up at the eye, 0 (hip) .. 1 */
  aimed: number;
  /** how fast they are moving, 0 .. 1 */
  moving: number;
  air: boolean;
  crouched: boolean;
  prone: boolean;
  /** shots in the string so far */
  heat: number;
}

/**
 * The cone a shot can land in, radians across. At the eye and still it is the gun's own; moving opens it, being
 * off the ground opens it wide, a knee or the ground closes the hip's; and an automatic held open warms into a
 * wider one (the barrel is not where the last shot left it).
 *
 * The two rifles with a string of their own (PATTERNS) warm by a quarter of what the others do. A string is
 * there to be learnt and pulled against, and a cone that grew to seven times the AK's own on top of it (twelve
 * times the AR-15's) put the round somewhere else however well it was pulled. (Rust, whose pattern theirs is
 * drawn to the shape of, took more than four fifths off its cone when it gave its guns patterns.)
 */
export function coneOf(id: string, s: Stance): number {
  const g = GUNS[id];
  if (!g) return 0.03;
  const hip = rad(g.hip) * (1 + s.moving * 1.3) * (s.prone ? 0.6 : s.crouched ? 0.75 : 1) + (s.air ? 0.035 : 0);
  const eye = g.moa * MOA + s.moving * 0.007 + (s.air ? 0.02 : 0);
  const warm = g.auto ? Math.min(Math.max(0, s.heat - 1), 6) * (PATTERNS[id] ? 0.0003 : 0.0011) : 0;
  return lerp(hip, eye, s.aimed) + warm;
}

/**
 * How far off the middle of a cone `across` radians wide something lands that is as likely to be in any part of
 * it as in any other of the same size: most of it out toward the edge, there being more edge than middle.
 * @param u a number from 0 to 1 (a throw of the dice)
 */
export const anywhereIn = (across: number, u: number) => (across / 2) * Math.sqrt(u);

/**
 * How far off the middle of its cone a gun's shot goes, radians, by two throws of the dice (each 0 to 1).
 * Anywhere across it, for most guns. The two rifles with a string of their own are drawn in toward the middle:
 * half their shots land inside half the cone's width, where a quarter would, and none at its very edge.
 */
export function scatterOf(id: string, across: number, u: number, v: number): number {
  return PATTERNS[id] ? (across / 2) * ((u + v) / 2) : anywhereIn(across, u);
}
