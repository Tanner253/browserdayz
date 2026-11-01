// The line under the map (the owner, 2026-10-31: "does it travel to under the bunker like rust?"): from a station at the foot of the Kupol's ridge to a terminus
// behind Level 3's back wall. It runs under the ground all the way: down one long grade under the high plateau north of the valley, under the river at its lowest, up under the
// ridge that runs east from the bunker, and in square to the back wall. `assets-src/_wf/me/line-depth.ts` says how much rock it has over it. Everything here is the same on the server and in every game, from the clock alone.

import { makeLine, onLine, runTime, runTo, type OnLine, type P3 } from './train';
import { bunkerAt, levelY, type Place } from './bunker';

/** the bunker as the line knows it: its place is the map's, and the line must end at its third level on every machine */
const P: Place = { x: -1450, y: 35.6, z: -320, rot: -1.0458 };
const FLOOR = P.y + levelY(3);
/** the terminus runs straight in at this right of the bunker's middle, square to its back wall */
const R = 25;
const at = (f: number, y = FLOOR): P3 => {
  const [x, , z] = bunkerAt(P, R, f);
  return [x, y, z];
};

export const LINE = makeLine([
  [570, 84, -525], [520, 84, -525], [440, 81, -528], [300, 71.3, -535], [150, 61.8, -540], [0, 52.3, -545], [-150, 42.7, -550], [-300, 33.2, -553], [-450, 23.7, -556],
  [-600, 14.2, -558], [-750, 4.7, -556], [-830, 0, -549], [-885, -3.5, -530], [-925, -5.7, -503], [-965, -5.5, -476], [-1015, -2.5, -449], [-1070, 1.5, -423], [-1125, 6.5, -398],
  [-1180, 11, -377], [-1228, 15, -360], [-1271, 18, -351], [-1316, 20.5, -350], [-1337, 21.5, -348.2], [-1357, 22.3, -342.8], at(-71), at(-55), at(-38),
]);

export const RUN = { speed: 34, accel: 2, dwell: 40 };
/** how long a run takes, seconds, and a whole round: there, a wait, back, a wait */
export const RUN_TIME = runTime(LINE.length, RUN.speed, RUN.accel);
export const ROUND = 2 * (RUN_TIME + RUN.dwell);

export interface TrainNow extends OnLine {
  /** standing at a platform, and which: 0 the Kupol's, 1 Level 3's; -1 on the way */
  stop: number;
  /** seconds until it next moves, or until it next stands */
  left: number;
}

/** where the train is at a moment of the shared clock, seconds */
export function trainAt(t: number): TrainNow {
  const c = ((t % ROUND) + ROUND) % ROUND, d = RUN.dwell, r = RUN_TIME;
  if (c < d) return { ...onLine(LINE, 0), stop: 0, left: d - c };
  if (c < d + r) return { ...onLine(LINE, runTo(LINE.length, RUN.speed, RUN.accel, c - d)), stop: -1, left: d + r - c };
  if (c < d + r + d) return { ...onLine(LINE, LINE.length), stop: 1, left: 2 * d + r - c };
  return { ...onLine(LINE, LINE.length - runTo(LINE.length, RUN.speed, RUN.accel, c - 2 * d - r)), stop: -1, left: ROUND - c };
}
