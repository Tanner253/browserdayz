// Somebody playing the bot check's course honestly, for the tests: walks a way round the yard that a person could
// walk (round the walls, up the ramp onto the catwalk and back), and whenever the server shows a figure that is
// still standing, stops, turns to it over half a second, follows it a while and fires. It knows nothing the game is
// not told: the yard, and what the server shows. It says what a game says (where it stands and looks, and each
// shot) through whatever it is given: straight to a judge (test/course.test.ts), or over the wire to a server in
// real time (test/bots.test.ts).
import { YARD, floorAt, fromPlan, lookOf, solidAlong, toPlan, type Sighting } from '../src/sim/course';

export interface CourseIO {
  seen(ms: number, x: number, y: number, z: number, yaw: number, pitch: number): void;
  shot(ms: number, o: [number, number, number], d: [number, number, number]): void;
  /** what the server shows now: the figures in sight */
  shown(ms: number): Sighting[];
  /** the figures counted down so far */
  down(): ReadonlySet<number>;
  /** passed, or over: nothing more to do */
  done(): boolean;
  /** waits until `ms` after the go began (in a test with no clock of its own: not at all) */
  until(ms: number): Promise<void> | void;
}

/** the way round, in the plan's frame: north-west round the wall, back past the hut's door, to the ramp, up it, along the catwalk, and back */
const ROUND: [number, number][] = [
  [0, 0], [-5, -5], [-5.4, -9.6], [-5, -5], [3.3, -4.2], [4.6, -3.4], [3.3, -4.2], [0, 0], [-1.0, 5.0], [-6.8, 5.0], [-12.8, 5.0], [-6.8, 5.0], [-1.0, 5.0], [0, 0],
];

export const aimAt = (ex: number, ey: number, ez: number, tx: number, ty: number, tz: number) => {
  const dx = tx - ex, dy = ty - ey, dz = tz - ez;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
};

/**
 * @param turn the way the yard was turned (what the server says when it deals the course)
 * @param how wait: how long a figure must have been shown before it is turned to (ms); pace: walking speed (m/s)
 * @returns how long it took, ms
 */
export async function playCourse(turn: number, secs: number, io: CourseIO, how: { wait?: number; pace?: number } = {}): Promise<number> {
  const wait = how.wait ?? 350, pace = how.pace ?? 4.5, step = 50;
  let ms = 0, k = 0, yaw = turn, pitch = 0;
  let [px, pz] = [0, 0];
  let y = 0;
  /** when each figure was first shown in this run of sightings */
  const since = new Map<number, number>();
  const where = () => {
    const [x, z] = fromPlan(turn, px, pz);
    return { x, z };
  };
  const say = async () => {
    await io.until(ms);
    const w = where();
    io.seen(ms, w.x, y, w.z, yaw, pitch);
  };
  const target = (): Sighting | null => {
    const down = io.down(), shown = io.shown(ms);
    for (const s of shown) if (!since.has(s[0])) since.set(s[0], ms);
    for (const i of [...since.keys()]) if (!shown.some((s) => s[0] === i)) since.delete(i);
    // (up, standing, shown a while, and its chest to be seen from here, as a person sees whether a wall is in the
    // way: a peeker crouched behind its block is waited for, and one only half out from a wall's edge walked to)
    return shown.find((s) => !down.has(s[0]) && s[6] === 1 && ms - (since.get(s[0]) ?? ms) >= wait && (missed.get(s[0]) ?? 0) < ms && clear(s)) ?? null;
  };
  /** after a shot that did not bring it down, a figure is let be for a moment */
  const missed = new Map<number, number>();
  const clear = (s: Sighting) => {
    const w = where(), [ex, ez] = toPlan(turn, w.x, w.z), [tx, tz] = toPlan(turn, s[1], s[3]), ey = y + YARD.eye, ty = s[2] + 1.55;
    const v = [tx - ex, ty - ey, tz - ez], len = Math.hypot(v[0], v[1], v[2]);
    return solidAlong([ex, ey, ez], [v[0] / len, v[1] / len, v[2] / len], len) >= len;
  };
  for (let k2 = 0; k2 < 6; k2++) {
    await say();
    ms += step;
  }
  while (!io.done() && ms < secs * 1000) {
    const t = target();
    if (t) {
      // turn to it over half a second, and follow it for the rest
      const i = t[0];
      for (let u = 0; u < 900 && !io.done(); u += step) {
        ms += step;
        const s = io.shown(ms).find((q) => q[0] === i);
        if (!s) break;
        const w = where(), want = aimAt(w.x, y + YARD.eye, w.z, s[1], s[2] + (s[6] ? 1.55 : 0.9), s[3]), kk = Math.min(1, (u + step) / 500);
        yaw += Math.atan2(Math.sin(want.yaw - yaw), Math.cos(want.yaw - yaw)) * kk;
        pitch += (want.pitch - pitch) * kk;
        await say();
      }
      ms += 20;
      const s = io.shown(ms).find((q) => q[0] === i);
      if (s && s[6] === 1) {
        const w = where(), a = aimAt(w.x, y + YARD.eye, w.z, s[1] + s[4] * 0.05, s[2] + 1.55, s[3] + s[5] * 0.05);
        yaw = a.yaw;
        pitch = a.pitch;
        await say();
        await io.until(ms + 5);
        io.shot(ms + 5, [w.x, y + YARD.eye, w.z], lookOf(a.yaw, a.pitch));
      }
      ms += 260;
      await say();
      if (!io.down().has(i)) missed.set(i, ms + 1500);
      continue;
    }
    // on round the yard, a step at a time, looking the way it goes
    const [tx, tz] = ROUND[(k + 1) % ROUND.length], dx = tx - px, dz = tz - pz, far = Math.hypot(dx, dz), go = (pace * step) / 1000;
    if (far <= go) {
      px = tx;
      pz = tz;
      k++;
    } else {
      px += (dx / far) * go;
      pz += (dz / far) * go;
    }
    y = floorAt(px, y, pz);
    if (far > 0.01) {
      const want = Math.atan2(-dx, -dz) + turn;
      yaw += Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw)) * 0.25;
      pitch *= 0.8;
    }
    ms += step;
    await say();
  }
  return ms;
}
