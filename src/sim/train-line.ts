// The line under the map (the owner, 2026-10-31: "does it travel to under the bunker like rust?"): from a station at the foot of the Kupol's ridge to a terminus
// behind Level 3's back wall. It runs under the ground all the way: down one long grade under the high plateau north of the valley, under the river at its lowest, up under the
// ridge that runs east from the bunker, and in square to the back wall. `assets-src/_wf/me/line-depth.ts` says how much rock it has over it. Everything here is the same on the server and in every game, from the clock alone.

import { makeLine, onLine, runTime, runTo, type OnLine, type P3 } from './train';
import { bunkerAt, levelY, type Place } from './bunker';

/** the bunker as the line knows it: its place is the map's, and the line must end at its third level on every machine */
const P: Place = { x: -1450, y: 35.6, z: -320, rot: -1.0458 };
/** a wagon's deck stands this far under a platform, which is level with its sides: you step over them and down (the wagon is an open one, whose sides have no door) */
export const RIM = 1.42;
const FLOOR = P.y + levelY(3) - RIM;
/** the terminus runs straight in at this right of the bunker's middle, square to its back wall */
const R = 25;
const at = (f: number, y = FLOOR): P3 => {
  const [x, , z] = bunkerAt(P, R, f);
  return [x, y, z];
};

export const LINE = makeLine([
  [586, 84, -525], [570, 84, -525], [520, 84, -525], [440, 81, -528], [300, 71.3, -535], [150, 61.8, -540], [0, 52.3, -545], [-150, 42.7, -550], [-300, 33.2, -553], [-450, 23.7, -556],
  [-600, 14.2, -558], [-750, 4.7, -556], [-830, 0, -549], [-885, -3.5, -530], [-925, -5.7, -503], [-965, -5.5, -476], [-1015, -2.5, -449], [-1070, 1.5, -423], [-1125, 6.5, -398],
  [-1180, 11, -377], [-1228, 15, -360], [-1271, 18, -351], [-1316, 20, -350], [-1337, 20.7, -348.2], [-1357, 21.2, -342.8], at(-71), at(-55), at(-36.6),
]);

export const RUN = { speed: 34, accel: 2, dwell: 40 };
/** how far the shunter stands ahead of the wagon along the line, metres: the line's end is the shunter's, so the wagon's run stops this short of it */
export const COUPLED = 11.9;
/** the rails run on past where the wagon stands at the Kupol, and the shunter at Level 3: to the buffers, metres */
const HEAD = 10, TAIL = 7;
const REACH = LINE.length - HEAD - TAIL - COUPLED;
/** how long a run takes, seconds, and a whole round: there, a wait, back, a wait */
export const RUN_TIME = runTime(REACH, RUN.speed, RUN.accel);
export const ROUND = 2 * (RUN_TIME + RUN.dwell);

export interface TrainNow {
  /** how far along the line the wagon is, metres */
  s: number;
  /** standing at a platform, and which: 0 the Kupol's, 1 Level 3's; -1 on the way */
  stop: number;
  /** seconds until it next moves, or until it next stands */
  left: number;
}

/** where the train is at a moment of the shared clock, seconds */
export function trainAt(t: number): TrainNow {
  const c = ((t % ROUND) + ROUND) % ROUND, d = RUN.dwell, r = RUN_TIME;
  if (c < d) return { s: HEAD, stop: 0, left: d - c };
  if (c < d + r) return { s: HEAD + runTo(REACH, RUN.speed, RUN.accel, c - d), stop: -1, left: d + r - c };
  if (c < d + r + d) return { s: HEAD + REACH, stop: 1, left: 2 * d + r - c };
  return { s: HEAD + REACH - runTo(REACH, RUN.speed, RUN.accel, c - 2 * d - r), stop: -1, left: ROUND - c };
}

/** the wagon and the shunter at a moment */
export const wagonAt = (t: number): OnLine => onLine(LINE, trainAt(t).s);
export const shunterAt = (t: number): OnLine => onLine(LINE, trainAt(t).s + COUPLED);

const CELL = 16, cells = new Map<number, number[]>(), key = (x: number, z: number) => x * 4096 + z;
LINE.pts.forEach((p, i) => {
  const k = key(Math.floor(p[0] / CELL), Math.floor(p[2] / CELL));
  cells.set(k, [...(cells.get(k) ?? []), i]);
});

/**
 * A station, in its own measure: `a` from its buffers out towards the tunnel, `b` from the middle of the track across towards the platform, heights from the platform.
 * The wagon stands with its steps at `gate` along the platform, and the platforms are on the same side of the wagon at both ends of the line.
 */
export interface Station {
  name: string;
  stop: number;
  /** the line's distance at the buffers, and which way along it the tunnel lies */
  end: number;
  way: 1 | -1;
  x: number; y: number; z: number;
  ux: number; uz: number; vx: number; vz: number;
  gate: number;
}
/** the hall, metres: its length out to the tunnel's mouth, the platform's edge and its back wall, and the wall across the track */
export const HALL = { long: 34, edge: 1.72, back: 9.6, far: -3.3, tall: 6.4 };

const station = (name: string, stop: number, end: number, way: 1 | -1, stands: number): Station => {
  const p = onLine(LINE, end), c = Math.cos(p.yaw), n = Math.sin(p.yaw);
  return { name, stop, end, way, x: p.x, y: p.y + RIM, z: p.z, ux: way * n, uz: way * c, vx: -c, vz: n, gate: Math.abs(stands - end) };
};
export const STATIONS: Station[] = [station('Kupol', 0, 1, 1, HEAD), station('Bunker 17', 1, LINE.length - 0.6, -1, HEAD + REACH)];
/** the tunnel proper, between the two halls */
export const BORE = { from: 1 + HALL.long, to: LINE.length - 0.6 - HALL.long };

/** a point in a station's own measure */
export const inFrame = (t: Station, x: number, z: number) => ({ a: (x - t.x) * t.ux + (z - t.z) * t.uz, b: (x - t.x) * t.vx + (z - t.z) * t.vz });

/** the station this point is in, if any */
export function stationAt(x: number, y: number, z: number): Station | null {
  for (const t of STATIONS) {
    if (y < t.y - 3.5 || y > t.y + HALL.tall + 1) continue;
    const { a, b } = inFrame(t, x, z);
    if (a > -8 && a < HALL.long + 1 && b > HALL.far - 1 && b < (t.stop ? 30 : HALL.back + 1)) return t;
  }
  return null;
}

/** is this point in the tunnel? (Under the ground anywhere else, a body is put back on top of it.) */
export function inTunnel(x: number, y: number, z: number): boolean {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
    for (const n of cells.get(key(i, j)) ?? []) {
      const p = LINE.pts[n];
      if (Math.hypot(p[0] - x, p[2] - z) < 4 && y > p[1] - 3 && y < p[1] + 6) return true;
    }
  }
  return false;
}
