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
  p38: { ammo: 'ammo_9mm', rpm: 460, barrel: 1, moa: 7, hip: 1.7, up: 1.5, side: 0.45, lean: 0, first: 1, held: 1, stays: 0.23, back: 10, jump: 1.6, zero: [25], reach: 220 },
  m9: { ammo: 'ammo_9mm', rpm: 460, barrel: 1, moa: 6, hip: 1.7, up: 1.4, side: 0.4, lean: 0, first: 1, held: 1, stays: 0.23, back: 10, jump: 1.6, zero: [25], reach: 220 },
  deagle: { ammo: 'ammo_50', rpm: 220, barrel: 1, moa: 5, hip: 1.9, up: 3.3, side: 0.8, lean: 0, first: 1, held: 1, stays: 0.3, back: 8, jump: 2.7, heavy: true, zero: [25, 50], reach: 260 },
  benelli: { ammo: 'ammo_12', rpm: 176, barrel: 1, moa: 7, hip: 1.3, up: 3.9, side: 0.9, lean: 0, first: 1, held: 1, stays: 0.24, back: 8.5, jump: 4.2, heavy: true, zero: [25], reach: 70 },
  // (The AK: a heavy round and a heavy bolt carrier. Its first shot is the worst of a string, it climbs and pulls
  // to the right, and it never quite settles: short bursts, or it is pointing at the sky.)
  ak: { ammo: 'ammo_739', rpm: 600, auto: true, barrel: 1, moa: 4, hip: 2.1, up: 1.45, side: 0.5, lean: 0.4, first: 1.3, held: 0.78, stays: 0.32, back: 8.5, jump: 1.65, zero: [100, 200, 300, 400], reach: 500 },
  // (The AR-15: a light round in a straight line with the shoulder. Faster, flatter, and it stays where it is put;
  // this one's barrel is a short one, and its rounds leave it a little slower than a rifle's.)
  // (The submachine gun: a pistol's round out of a barrel half as long again, fast, with nothing against the
  // shoulder. Each shot is little; there are a great many of them, and they walk.)
  mpa: { ammo: 'ammo_9mm', rpm: 780, auto: true, barrel: 1.08, moa: 6, hip: 2.3, up: 0.8, side: 0.5, lean: 0.15, first: 1.05, held: 0.85, stays: 0.34, back: 9.5, jump: 1.0, zero: [50, 100], reach: 260 },
  ar15: { ammo: 'ammo_556', rpm: 700, auto: true, barrel: 0.94, moa: 2, hip: 1.9, up: 0.98, side: 0.32, lean: 0.1, first: 1.1, held: 0.7, stays: 0.3, back: 10.5, jump: 1.15, zero: [100, 200, 300], reach: 550 },
};

/** What a gun's shot is when it leaves: its cartridge, through its barrel. */
export function shotOf(id: string): { muzzleVel: number; drag: number; damage: number; pellets: number; cone: number } {
  const g = GUNS[id], c = CARTRIDGES[g?.ammo];
  if (!g || !c) return { muzzleVel: 350, drag: 0.002, damage: 0, pellets: 1, cone: 0 };
  return { muzzleVel: c.vel * g.barrel, drag: c.drag, damage: c.damage, pellets: c.pellets ?? 1, cone: c.cone ?? 0 };
}

/** seconds from one shot to the next at its fastest */
export const intervalOf = (id: string) => 60 / (GUNS[id]?.rpm ?? 460);

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
 */
export function coneOf(id: string, s: Stance): number {
  const g = GUNS[id];
  if (!g) return 0.03;
  const hip = rad(g.hip) * (1 + s.moving * 1.3) * (s.prone ? 0.6 : s.crouched ? 0.75 : 1) + (s.air ? 0.035 : 0);
  const eye = g.moa * MOA + s.moving * 0.007 + (s.air ? 0.02 : 0);
  const warm = g.auto ? Math.min(Math.max(0, s.heat - 1), 6) * 0.0011 : 0;
  return lerp(hip, eye, s.aimed) + warm;
}
