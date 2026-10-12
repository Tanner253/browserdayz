// Somebody playing the bot check's range honestly, for the tests: walks to where a figure can be had, turns to it,
// follows it a while, fires. It says what a game says (where it stands and looks, and each shot) through whatever
// it is given to say it with: straight to a judge (test/range.test.ts), or over the wire to a server in real time
// (test/bots.test.ts).
import { EYE, STRIP, clearShot, figureAt, lookOf, type RangeSpec } from '../src/sim/range';

export interface RangeIO {
  seen(ms: number, x: number, z: number, yaw: number, pitch: number): void;
  shot(ms: number, o: [number, number, number], d: [number, number, number]): void;
  /** the figures counted down so far */
  down(): ReadonlySet<number>;
  /** passed, or over: nothing more to do */
  done(): boolean;
  /** waits until `ms` after the go began (in a test with no clock of its own: not at all) */
  until(ms: number): Promise<void> | void;
}

export const aimAt = (ex: number, ez: number, tx: number, ty: number, tz: number) => {
  const dx = tx - ex, dy = ty - EYE, dz = tz - ez;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
};

/**
 * @param how walk: go on foot (or be there at once); follow: turn the head to the figure and keep it there (or
 *   never turn it at all); wait: a little longer before each shot
 * @returns how long it took, ms
 */
export async function playRange(spec: RangeSpec, io: RangeIO, how: { walk?: boolean; follow?: boolean; wait?: number } = {}): Promise<number> {
  const walk = how.walk ?? true, follow = how.follow ?? true;
  let ms = 0, x = STRIP.start[0], z = STRIP.start[1], yaw = 0, pitch = 0;
  const say = async () => {
    await io.until(ms);
    io.seen(ms, x, z, yaw, pitch);
  };
  const step = 50;
  for (let k = 0; k < 6; k++) {
    await say();
    ms += step;
  }
  for (let guard = 0; guard < 40 && !io.done() && ms < spec.secs * 1000; guard++) {
    // the nearest place and the soonest moment some figure still standing can be had from
    let best: { i: number; x: number; z: number } | null = null, far = Infinity;
    const down = io.down();
    spec.figures.forEach((_, i) => {
      if (down.has(i)) return;
      for (let px = -STRIP.half + 1; px <= STRIP.half - 1; px += 1) {
        for (const pz of [1, 3, 5]) {
          const d = Math.hypot(px - x, pz - z), arrive = ms + (d / 5) * 1000 + 900;
          if (d < far && clearShot(spec, i, px, pz, arrive, down) && clearShot(spec, i, px, pz, arrive + 150, down)) {
            far = d;
            best = { i, x: px, z: pz };
          }
        }
      }
    });
    if (!best) {
      for (let k = 0; k < 4; k++) {
        await say();
        ms += step;
      }
      continue;
    }
    const b = best as { i: number; x: number; z: number };
    // walk there at five metres a second (or be there at once)
    const d = Math.hypot(b.x - x, b.z - z), steps = walk ? Math.max(1, Math.ceil(((d / 5) * 1000) / step)) : 1;
    const x0 = x, z0 = z;
    for (let k = 1; k <= steps; k++) {
      x = x0 + ((b.x - x0) * k) / steps;
      z = z0 + ((b.z - z0) * k) / steps;
      ms += step;
      await say();
    }
    // turn to it over half a second, and follow it for the rest
    for (let t = 0; t < 900; t += step) {
      ms += step;
      const p = figureAt(spec.figures[b.i], ms), want = aimAt(x, z, p.x, 1.2, p.z), k = Math.min(1, (t + step) / 500);
      if (follow) {
        yaw += Math.atan2(Math.sin(want.yaw - yaw), Math.cos(want.yaw - yaw)) * k;
        pitch += (want.pitch - pitch) * k;
      }
      await say();
    }
    ms += how.wait ?? 20;
    const p = figureAt(spec.figures[b.i], ms), a = aimAt(x, z, p.x, 1.2, p.z);
    if (follow) {
      yaw = a.yaw;
      pitch = a.pitch;
      await say();
    }
    await io.until(ms + 5);
    io.shot(ms + 5, [x, EYE, z], lookOf(a.yaw, a.pitch));
    ms += 260;
    await say();
  }
  return ms;
}
