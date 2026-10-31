// The train's line and its run, the same on the server and in every game: a smooth curve through a list of points, walked by distance, and how far
// along it a train is at a moment, from standing to its speed and back to standing. Nothing here knows what a train looks like.

export type P3 = [number, number, number];

export interface Line {
  /** points along the curve, a metre or two apart, and how far along it each lies */
  pts: P3[];
  at: number[];
  length: number;
}

/** a point of a Catmull-Rom curve through p1 and p2 */
const spline = (p0: P3, p1: P3, p2: P3, p3: P3, t: number): P3 => {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3)) as P3;
};

/** the curve through a list of points, cut into pieces of about `step` metres */
export function makeLine(through: P3[], step = 1.5): Line {
  const pts: P3[] = [], at: number[] = [];
  const of = (i: number) => through[Math.max(0, Math.min(through.length - 1, i))];
  for (let i = 0; i + 1 < through.length; i++) {
    const a = of(i), b = of(i + 1), n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
    for (let k = 0; k < n; k++) pts.push(spline(of(i - 1), a, b, of(i + 2), k / n));
  }
  pts.push(through[through.length - 1]);
  let run = 0;
  pts.forEach((p, i) => {
    if (i) run += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]);
    at.push(run);
  });
  return { pts, at, length: run };
}

export interface OnLine { x: number; y: number; z: number; yaw: number; pitch: number }

/** where along a line a distance is, and which way the line runs there */
export function onLine(l: Line, s: number): OnLine {
  const d = Math.max(0, Math.min(l.length, s));
  let lo = 0, hi = l.at.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (l.at[m] <= d) lo = m;
    else hi = m;
  }
  const a = l.pts[lo], b = l.pts[hi], k = (d - l.at[lo]) / Math.max(1e-6, l.at[hi] - l.at[lo]);
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return { x: a[0] + dx * k, y: a[1] + dy * k, z: a[2] + dz * k, yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** how far along a run of `length` metres a train is `t` seconds after it set off: up to `speed` at `accel`, and down again to stand at the end */
export function runTo(length: number, speed: number, accel: number, t: number): number {
  const up = speed / accel, far = 0.5 * accel * up * up;
  // (a run too short to reach its speed)
  if (far * 2 >= length) {
    const half = Math.sqrt(length / accel);
    if (t <= half) return 0.5 * accel * t * t;
    const back = Math.max(0, 2 * half - t);
    return length - 0.5 * accel * back * back;
  }
  const cruise = (length - far * 2) / speed;
  if (t <= up) return 0.5 * accel * t * t;
  if (t <= up + cruise) return far + speed * (t - up);
  const back = Math.max(0, 2 * up + cruise - t);
  return length - 0.5 * accel * back * back;
}

/** how long such a run takes, seconds */
export function runTime(length: number, speed: number, accel: number): number {
  const up = speed / accel, far = 0.5 * accel * up * up;
  return far * 2 >= length ? 2 * Math.sqrt(length / accel) : 2 * up + (length - far * 2) / speed;
}
