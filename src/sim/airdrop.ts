// The supply drop comes by helicopter (2026-10-13: "it should fly over the map to the airdrop location, and play
// the sound ... spawns edge of map. flies to spot, spawns airdrop after arriving to spot, stays there for a while
// then leaves flying to the edge of the map, proximity audio").
//
// One flight is one line of numbers (`Flight`): where on the map's edge it appears, the place the crate is for,
// which way it turns as it leaves, how high it flies and how high it holds. Everything else is worked out from
// that and from how long ago it appeared: where the helicopter is, which way it points, how it leans, where the
// crate is under its canopy, when the crate is on the ground. So the server says a flight once, and every game
// (one that joins half way through as well) has the same helicopter in the same place at the same moment.
// Rules and numbers only: the server keeps the clock in multiplayer, the game itself when playing alone; what is
// drawn and what is heard is src/game/airdrop.ts.

import { SQUARE_HALF } from '../world/worldgen';

/** every figure of the flight and of the crate's fall */
export const AIRDROP = {
  /** how fast it flies, m/s (144 km/h: a Black Hawk in no hurry, so that it is heard coming for half a minute) */
  speed: 40,
  /** how hard it slows to a hover over the place, and how hard it gathers way as it leaves: m/s² */
  brake: 4,
  pull: 3,
  /** it is never nearer the ground under its way than this, metres */
  clear: 45,
  /** how high over the place it holds while the crate goes, metres (higher, where the ground round the place asks it) */
  hover: 90,
  /**
   * Over how many metres of its way in it comes down from the height it flies at to the height it holds at; and
   * climbs again, leaving. (Long, so that it is never a dive: coming down two hundred metres, the most this map asks
   * of it, it sinks fifteen metres a second at its steepest.)
   */
  blend: 800,
  /** the most it comes down between the height it flies at and the height it holds at, metres */
  sink: 200,
  /** seconds it holds over the place before the crate leaves it */
  settle: 3,
  /** how far under the helicopter's own place the crate is when it leaves, metres */
  belly: 2.5,
  /** the crate falls free for this long, the canopy takes this long to open, and then it comes down at this many m/s */
  free: 1.2,
  open: 0.9,
  // (5.5 until 2026-10-13: "airdrops should spawn in sky and slowly fall with parachute". Some twenty-one seconds from ninety metres.)
  fall: 4.2,
  gravity: 9.81,
  /** seconds the helicopter stays over the place after the crate has left it */
  stay: 30,
  /** seconds the canopy takes to settle to the ground and be gone, once the crate is down */
  down: 5,
  /** the turn it leaves on: the radius of it in metres, and the least and the most it turns off the way it came in, radians (never back along its own track) */
  arc: 150,
  turn: [0.45, 2.0] as [number, number],
  /** the least way in, as a share of the map's width: it comes over the country, not across a corner */
  wayIn: 0.45,
  /** the most it leans into a turn, radians; and how far its nose goes down for each m/s² it gathers (up, as it slows) */
  bank: 0.5,
  nose: 0.045,
  /** how far its nose is down as it flies level, radians */
  trim: 0.05,
  /** turns a second of its main rotor (a Black Hawk's is 258 a minute) */
  rotor: 4.3,
  /** how far the crate swings under the canopy as it opens, radians; and how many seconds one swing takes */
  swing: 0.16,
  period: 3.4,
};

/**
 * The rotor as it is heard (src/core/audio.ts plays the recording; NOBODY WHO SET THESE COULD HEAR IT: the test
 * prints what they come to at 0, 50, 150, 400 and 800 m, coming and going, and `?sounds` on the dev page plays them).
 */
export const ROTOR = {
  /**
   * The recording (scripts/sounds.mjs: "UH60 Black Hawk helicopter hover loop 1" by qubodup, CC0), and how loud it
   * is played right under the aircraft. LOUD (2026-10-13: "the helicopter sound should be loud"): after a shot and a
   * blast, the loudest thing there is. As the game's own engine makes it (rendered in a browser that plays nothing,
   * its loudest tenth of a second in decibels under as loud as can be): under it -11.9, at 150 m -16.2, at 400 m
   * -26.1, at 800 m -33.1, at 1500 m -40.0; where a rifle shot of one's own is -8.5, a blast twenty metres off -8.0,
   * a jeep at full throttle seven metres off -11.0 and thirty metres off -24.5, and a step at a run -30.2. Its
   * highest moment comes out at -1.3: it goes through the squeeze and the ceiling every sound of the world goes
   * through (`sfx` in src/core/audio.ts, the Effects group), which is what holds it.
   */
  rec: 'rotor',
  level: 1.4,
  /** within this of it, it is as loud as it gets: metres (it holds 90 m up, so whoever stands under it has all of it) */
  near: 90,
  /** how it falls away past that: as the distance to this power (1: as sound does in open air, six decibels for each doubling) */
  falloff: 1.15,
  /** it is gone altogether by this far, fading out over the last fifth of it: metres (the map is 1536 across, and 2170 corner to corner) */
  far: 2600,
  /** the speed of sound, m/s: what coming toward the ear raises its pitch by, and going away lowers it */
  sound: 343,
  /** "pitch it by distance": how fast it is played from far off against from near (lower, further), and by how many metres it is all the way there */
  pitchFar: 0.88,
  pitchBy: 1200,
  /** how much of its top comes through: nothing above this many Hz from near, nothing above this many from far (only the thump of the blades is left), and by how many metres */
  dull: [14000, 420] as [number, number],
  dullBy: 1100,
  /** under a roof: [how much of it comes through, nothing of it above this many Hz] (the wind and the birds are turned down so under one: 0.45 and 900) */
  indoors: [0.55, 1100] as [number, number],
  /** and down in the bunker, under the hill: the same two */
  under: [0.05, 200] as [number, number],
};

/**
 * the edge it comes in over and goes out by: this far from the map's middle, east, west, north and south. The
 * square's (2026-10-16): drops fall on it, and the ground west of it is ground only as yet.
 */
export const EDGE = SQUARE_HALF;

/** one flight, as the server says it: all a game needs to put the helicopter and the crate where they are */
export interface Flight {
  /** its number, which is the number of the crate it brings: the box that stands there once it has landed */
  uid: string;
  /** where on the map's edge it appears */
  fx: number;
  fz: number;
  /** the place the crate is for, and the ground there */
  x: number;
  y: number;
  z: number;
  /** how far it turns off its way in as it leaves, radians: to the right if more than nothing, to the left if less */
  turn: number;
  /** the height it flies at, and the height it holds at over the place */
  high: number;
  hold: number;
  /** seconds since it appeared, at the moment this was said (nothing, when it is first said) */
  age: number;
  /** whoever called it down on a radio, if anybody did */
  by?: number;
}

/** the moments of a flight, in seconds from when it appears */
export interface Times {
  /** it is over the place, and still */
  arrive: number;
  /** the crate leaves it */
  release: number;
  /** the canopy is open */
  opened: number;
  /** the crate is on the ground: it can be opened from now, and not before */
  land: number;
  /** the canopy has settled and is gone */
  cleared: number;
  /** the helicopter starts away */
  leave: number;
  /** it is over the map's edge, and gone */
  gone: number;
}

export interface HeliAt {
  phase: 'in' | 'hold' | 'out' | 'gone';
  x: number;
  y: number;
  z: number;
  /** which way it points: as a player's yaw is said (0 looks north, toward -z; a quarter turn is west) */
  heading: number;
  /** over the ground, m/s, and which way that is */
  speed: number;
  vx: number;
  vy: number;
  vz: number;
  /** how far it leans: to its right if more than nothing */
  bank: number;
  /** how far its nose is down (up, if less than nothing) */
  pitch: number;
  /** how far round its main rotor has turned, radians */
  rotor: number;
}

export interface CrateAt {
  x: number;
  y: number;
  z: number;
  /** it is on the ground */
  landed: boolean;
  /** m/s it is coming down at */
  falling: number;
  /** the canopy: 0 a streamer, 1 full */
  open: number;
  /** how far the crate hangs off straight down under the canopy, radians, about x and about z */
  swing: [number, number];
  /** which way it has turned on its lines */
  spin: number;
  /** once it is down: 0 the canopy still stands over it, 1 it has settled and is gone */
  settled: number;
}

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/** how far along a way that begins at (x, z) and goes toward (dx, dz) the map's edge is */
function toEdge(x: number, z: number, dx: number, dz: number): number {
  const ax = dx > 1e-9 ? (EDGE - x) / dx : dx < -1e-9 ? (-EDGE - x) / dx : Infinity;
  const az = dz > 1e-9 ? (EDGE - z) / dz : dz < -1e-9 ? (-EDGE - z) / dz : Infinity;
  return Math.max(0, Math.min(ax, az));
}

interface Shape {
  /** the way in: how long, and which way (a unit) */
  d: number;
  ux: number;
  uz: number;
  /** the way out: the whole of it, and how much of that is the turn */
  out: number;
  arc: number;
}

/** where it is, and which way it is going, so many metres along its way out: a turn of `AIRDROP.arc` metres' radius, then straight */
function outAt(f: Flight, s: Shape, along: number): [x: number, z: number, dx: number, dz: number] {
  const a0 = Math.atan2(s.uz, s.ux), k = (f.turn < 0 ? -1 : 1) / AIRDROP.arc;
  const on = Math.min(along, s.arc), a = a0 + k * on;
  let x = f.x, z = f.z;
  if (s.arc > 1e-6) {
    x += (Math.sin(a) - Math.sin(a0)) / k;
    z -= (Math.cos(a) - Math.cos(a0)) / k;
  }
  const dx = Math.cos(a), dz = Math.sin(a), rest = Math.max(0, along - s.arc);
  return [x + dx * rest, z + dz * rest, dx, dz];
}

const shapes = new WeakMap<Flight, Shape>();
function shapeOf(f: Flight): Shape {
  let s = shapes.get(f);
  if (s) return s;
  const d = Math.max(1e-6, Math.hypot(f.x - f.fx, f.z - f.fz));
  s = { d, ux: (f.x - f.fx) / d, uz: (f.z - f.fz) / d, out: 0, arc: Math.abs(f.turn) * AIRDROP.arc };
  // how long the way out is: round the turn, and on to the edge (or to where the turn itself crosses the edge)
  const inside = (along: number) => {
    const [x, z] = outAt(f, s!, along);
    return Math.abs(x) < EDGE && Math.abs(z) < EDGE;
  };
  let crossed = -1;
  for (let a = 0; a < s.arc && crossed < 0; a += 2) if (!inside(Math.min(a + 2, s.arc))) crossed = a;
  if (crossed >= 0) {
    let lo = crossed, hi = Math.min(crossed + 2, s.arc);
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inside(mid)) lo = mid;
      else hi = mid;
    }
    s.out = hi;
  } else {
    const [x, z, dx, dz] = outAt(f, s, s.arc);
    s.out = s.arc + toEdge(x, z, dx, dz);
  }
  shapes.set(f, s);
  return s;
}

/** where it leaves the map */
export function wayOut(f: Flight): { x: number; z: number } {
  const s = shapeOf(f), [x, z] = outAt(f, s, s.out);
  return { x, z };
}

/** how long the way in is, and the way out, metres */
export function ways(f: Flight): { in: number; out: number } {
  const s = shapeOf(f);
  return { in: s.d, out: s.out };
}

/** how far it has gone along its way in, and how fast, so many seconds after it appeared: at a steady speed, then slowing to a stand over the place */
function inAt(d: number, t: number): [along: number, speed: number, gaining: number] {
  const V = AIRDROP.speed, a = AIRDROP.brake;
  // (a way in shorter than it takes to stop from full speed: it comes in slower, and is slowing all the way)
  const v0 = Math.min(V, Math.sqrt(2 * a * d)), braking = (v0 * v0) / (2 * a), steady = (d - braking) / v0;
  if (t <= steady) return [v0 * Math.max(0, t), v0, 0];
  const k = Math.min(t - steady, v0 / a);
  return [d - braking + v0 * k - (a * k * k) / 2, v0 - a * k, k < v0 / a ? -a : 0];
}

/** and along its way out, so many seconds after it started away: gathering way, then steady */
function awayAt(k: number): [along: number, speed: number, gaining: number] {
  const V = AIRDROP.speed, a = AIRDROP.pull;
  if (k <= 0) return [0, 0, 0];
  if (k < V / a) return [(a * k * k) / 2, a * k, a];
  return [(V * V) / (2 * a) + V * (k - V / a), V, 0];
}

/** how far through its fall the crate is, so many seconds after it left the helicopter: [metres it has come down, m/s, how open the canopy is] */
function fallAt(k: number): [down: number, speed: number, open: number] {
  const { free, open, fall, gravity: g } = AIRDROP, v1 = g * free;
  if (k <= free) return [(g * k * k) / 2, g * k, 0];
  const d1 = (g * free * free) / 2;
  if (k <= free + open) {
    const u = k - free, v = v1 + ((fall - v1) * u) / open;
    return [d1 + ((v1 + v) / 2) * u, v, smooth(u / open)];
  }
  return [d1 + ((v1 + fall) / 2) * open + fall * (k - free - open), fall, 1];
}

const timesOf = new WeakMap<Flight, Times>();
/** The moments of a flight: all of them follow from how far it has to come and how high it holds. */
export function flightTimes(f: Flight): Times {
  let T = timesOf.get(f);
  if (T) return T;
  const s = shapeOf(f), V = AIRDROP.speed;
  const v0 = Math.min(V, Math.sqrt(2 * AIRDROP.brake * s.d));
  // (distance over speed, and half the time it takes to stop: a thing that slows evenly to a stand covers half the ground it would have)
  const arrive = (s.d - (v0 * v0) / (2 * AIRDROP.brake)) / v0 + v0 / AIRDROP.brake;
  const release = arrive + AIRDROP.settle;
  const drop = Math.max(0, f.hold - AIRDROP.belly - f.y);
  const [opening] = fallAt(AIRDROP.free + AIRDROP.open);
  // (from too low for a canopy to open, it would simply fall: the planner never holds that low)
  const land = release + (drop > opening ? AIRDROP.free + AIRDROP.open + (drop - opening) / AIRDROP.fall : Math.sqrt((2 * drop) / AIRDROP.gravity));
  const leave = release + AIRDROP.stay;
  const reach = (V * V) / (2 * AIRDROP.pull);
  const gone = leave + (s.out <= reach ? Math.sqrt((2 * s.out) / AIRDROP.pull) : V / AIRDROP.pull + (s.out - reach) / V);
  T = { arrive, release, opened: release + AIRDROP.free + AIRDROP.open, land, cleared: land + AIRDROP.down, leave, gone };
  timesOf.set(f, T);
  return T;
}

/** which way a thing going toward (dx, dz) points, as a player's yaw is said */
const yawOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** the height it is at, so many metres short of the place on its way in (or past it, on its way out) */
const heightAt = (f: Flight, off: number) => f.hold + (f.high - f.hold) * smooth(off / AIRDROP.blend);
/** and how fast that height changes for each metre gone */
const climbAt = (f: Flight, off: number) => {
  const k = Math.min(1, Math.max(0, off / AIRDROP.blend));
  return ((f.high - f.hold) * 6 * k * (1 - k)) / AIRDROP.blend;
};

/**
 * Where the helicopter is, so many seconds after it appeared.
 * (Before it appears it is where it appears; once it is gone it is where it left.)
 */
export function heliAt(f: Flight, t: number): HeliAt {
  const s = shapeOf(f), T = flightTimes(f), rotor = (Math.max(0, t) * AIRDROP.rotor * Math.PI * 2) % (Math.PI * 2);
  if (t < T.arrive) {
    const [along, speed, gaining] = inAt(s.d, t), off = s.d - along;
    return {
      phase: 'in', x: f.fx + s.ux * along, y: heightAt(f, off), z: f.fz + s.uz * along, heading: yawOf(s.ux, s.uz), speed,
      vx: s.ux * speed, vy: -climbAt(f, off) * speed, vz: s.uz * speed, bank: 0, pitch: (speed > 1 ? AIRDROP.trim * (speed / AIRDROP.speed) : 0) + gaining * AIRDROP.nose, rotor,
    };
  }
  if (t < T.leave) return { phase: 'hold', x: f.x, y: f.hold, z: f.z, heading: yawOf(s.ux, s.uz), speed: 0, vx: 0, vy: 0, vz: 0, bank: 0, pitch: 0, rotor };
  const gone = t >= T.gone;
  const [along, speed, gaining] = awayAt(Math.min(t, T.gone) - T.leave);
  const [x, z, dx, dz] = outAt(f, s, Math.min(along, s.out));
  // (it leans into the turn as hard as its speed round it asks, coming into the lean and out of it over the ends of the turn)
  const turning = along < s.arc ? smooth(along / (s.arc * 0.2)) * smooth((s.arc - along) / (s.arc * 0.3)) : 0;
  const bank = Math.sign(f.turn) * turning * Math.min(AIRDROP.bank, Math.atan((speed * speed) / (AIRDROP.arc * AIRDROP.gravity)));
  return {
    phase: gone ? 'gone' : 'out', x, y: heightAt(f, along), z, heading: yawOf(dx, dz), speed,
    vx: dx * speed, vy: climbAt(f, along) * speed, vz: dz * speed, bank, pitch: AIRDROP.trim * (speed / AIRDROP.speed) + gaining * AIRDROP.nose, rotor,
  };
}

/** a number between 0 and 1 that is a flight's own, from its number: what two games must agree on without being told */
function ownNumber(uid: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < uid.length; i++) h = Math.imul(h ^ uid.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Where the crate is, so many seconds after the helicopter appeared: nothing until it has left the helicopter
 * (it is inside it), then falling, then under its canopy, then on the ground at the place.
 */
export function crateAt(f: Flight, t: number): CrateAt | null {
  const T = flightTimes(f);
  if (t < T.release) return null;
  const spin0 = ownNumber(f.uid, 1) * Math.PI * 2;
  if (t >= T.land) return { x: f.x, y: f.y, z: f.z, landed: true, falling: 0, open: 1, swing: [0, 0], spin: spin0, settled: Math.min(1, (t - T.land) / AIRDROP.down) };
  const k = t - T.release, [down, falling, open] = fallAt(k);
  // it swings as the canopy takes its weight, less with every swing, and hangs still as it comes to the ground
  const since = Math.max(0, k - AIRDROP.free), left = T.land - t;
  const wide = AIRDROP.swing * open * Math.exp(-since / 9) * Math.min(1, left / 2.5);
  const a = (since / AIRDROP.period) * Math.PI * 2, way = ownNumber(f.uid, 2) * Math.PI * 2;
  return {
    x: f.x, y: Math.max(f.y, f.hold - AIRDROP.belly - down), z: f.z, landed: false, falling, open,
    swing: [Math.cos(way) * Math.sin(a) * wide, Math.sin(way) * Math.sin(a * 0.83 + 1) * wide],
    // (a slow turn on its lines, which stops where it lands)
    spin: spin0 - 0.25 * left * Math.min(1, left / 6),
    settled: 0,
  };
}

/** whether the crate can be opened yet: only once it is on the ground */
export const landed = (f: Flight, t: number) => t >= flightTimes(f).land;

/** which way the helicopter comes from, as it is said to somebody at the place: 'NW' (north is -z, east is +x) */
export function comesFrom(f: Flight): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(Math.atan2(f.fx - f.x, -(f.fz - f.z)) / (Math.PI / 4) + 8) % 8];
}

/** how near the ground it comes anywhere on its way in or out: metres (asked with the ground of the map it flies over) */
export function lowest(f: Flight, ground: (x: number, z: number) => number): number {
  const s = shapeOf(f);
  let least = Infinity;
  for (let a = 0; a <= s.d; a += 8) least = Math.min(least, heightAt(f, s.d - a) - ground(f.fx + s.ux * a, f.fz + s.uz * a));
  for (let a = 0; a <= s.out; a += 8) {
    const [x, z] = outAt(f, s, a);
    least = Math.min(least, heightAt(f, a) - ground(Math.max(-EDGE, Math.min(EDGE, x)), Math.max(-EDGE, Math.min(EDGE, z))));
  }
  return least;
}

/**
 * A flight for a crate that is to come down at a place. It appears on the map's edge a long way from the place
 * (so that its way in is over the country), on whichever of twenty-four ways round, leaving to one side or the
 * other, lets it hold lowest; it flies clear of all the ground under it; and it leaves on a turn, never back the
 * way it came.
 * @param ground the height of the ground at a point of the map
 * @param place where the crate is to stand, and the ground there
 */
export function planFlight(ground: (x: number, z: number) => number, place: { x: number; y: number; z: number }, uid: string, rnd: () => number = Math.random, by?: number): Flight {
  const N = 24, first = rnd();
  const all: Flight[] = [];
  for (let i = 0; i < N; i++) {
    const a = ((i + first) / N) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), far = toEdge(place.x, place.z, dx, dz);
    const much = AIRDROP.turn[0] + rnd() * (AIRDROP.turn[1] - AIRDROP.turn[0]);
    for (const turn of [much, -much]) {
      const hold = place.y + AIRDROP.hover;
      all.push({ uid, fx: place.x + dx * far, fz: place.z + dz * far, x: place.x, y: place.y, z: place.z, turn, high: hold, hold, age: 0, ...(by === undefined ? {} : { by }) });
    }
  }
  // (the long ways in; from a place so near a corner that there are few, the longest there are)
  all.sort((p, q) => shapeOf(q).d - shapeOf(p).d);
  const long = all.filter((f) => shapeOf(f).d >= AIRDROP.wayIn * 2 * EDGE);
  const picks = long.length >= 8 ? long : all.slice(0, 8);
  for (const f of picks) lift(f, ground);
  const least = Math.min(...picks.map((f) => f.hold));
  const low = picks.filter((f) => f.hold <= least + 6);
  return low[Math.floor(rnd() * low.length) % low.length];
}

/** a flight's two heights raised until it is clear of the ground all the way: the height it flies at, and (only where the ground near the place asks it) the height it holds at */
function lift(f: Flight, ground: (x: number, z: number) => number) {
  const s = shapeOf(f);
  for (let pass = 0; pass < 12; pass++) {
    let short = false;
    const ask = (off: number, x: number, z: number) => {
      const need = ground(Math.max(-EDGE, Math.min(EDGE, x)), Math.max(-EDGE, Math.min(EDGE, z))) + AIRDROP.clear;
      if (heightAt(f, off) >= need - 1e-6) return;
      short = true;
      const k = smooth(off / AIRDROP.blend);
      // (It is the height it flies at that is raised, wherever that helps: it costs nobody anything. Only for ground
      // close by the place is it the height it holds at, which is how far the crate has to come down.)
      if (k >= 0.25) f.high = Math.max(f.high, f.hold + (need - f.hold) / k);
      else f.hold = Math.max(f.hold, (need - f.high * k) / (1 - k));
      f.high = Math.max(f.high, f.hold);
    };
    for (let a = 0; a <= s.d; a += 8) ask(s.d - a, f.fx + s.ux * a, f.fz + s.uz * a);
    for (let a = 0; a <= s.out; a += 8) {
      const [x, z] = outAt(f, s, a);
      ask(a, x, z);
    }
    if (!short) break;
  }
  f.high = Math.ceil(f.high);
  // (never a dive: it comes down no more than this from the one height to the other, and holds higher if it must)
  f.hold = Math.max(Math.ceil(f.hold), f.high - AIRDROP.sink);
}

/**
 * How the rotor is heard from so far off: how loud, how fast the recording is played, and how much of its top
 * comes through. @param closing how fast the helicopter and the ear are coming together, m/s (going apart, less than nothing)
 * @param indoors the ear is under a roof  @param under how far down in the bunker it is, 0..1
 */
export function rotorAt(dist: number, closing = 0, indoors = false, under = 0): { gain: number; rate: number; cutoff: number } {
  const d = Math.max(0, dist);
  const fade = 1 - smooth((d - ROTOR.far * 0.8) / (ROTOR.far * 0.2));
  const gain = ROTOR.level * (d <= ROTOR.near ? 1 : Math.pow(ROTOR.near / d, ROTOR.falloff)) * fade;
  const off = (by: number) => Math.min(1, Math.max(0, (d - ROTOR.near) / (by - ROTOR.near)));
  const v = Math.max(-90, Math.min(90, closing));
  const rate = (1 + (ROTOR.pitchFar - 1) * off(ROTOR.pitchBy)) * (ROTOR.sound / (ROTOR.sound - v));
  const open = ROTOR.dull[0] * Math.pow(ROTOR.dull[1] / ROTOR.dull[0], off(ROTOR.dullBy));
  // (walls take its top off and some of its weight; the hill over the bunker takes nearly all of it)
  const u = Math.min(1, Math.max(0, under)), roof = indoors ? ROTOR.indoors[0] : 1, top = indoors ? Math.min(open, ROTOR.indoors[1]) : open;
  return { gain: gain * (roof + (ROTOR.under[0] - roof) * u), rate, cutoff: top * Math.pow(Math.min(top, ROTOR.under[1]) / top, u) };
}

/** which way round the crate of a flight stands once it is down: the same in every game, and on the server that sets it down */
export const restAt = (uid: string) => ownNumber(uid, 1) * Math.PI * 2;
