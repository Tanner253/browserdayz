// Level 1's wings (the owner, 2026-11-01: "i expected lvl 1 bunker to be much larger and have a much better layout"; the plan, marketing/plan-level1.html): where people lived to
// the west, where the work was to the east, command out front, and a passage round the old block so that no room is a dead end. The old block stands as it was, every room and
// thing in it where it was: all this is laid round it, and its places for things come after all the others. It lies under the ground as it is, nothing of which is moved.
// And the bolt-hole (the owner: "a 2nd entrance is under a locked hatch and ladder to lvl 1 from a nearby buildings basement"): cellar steps beside the camp's far barracks, a
// cellar on no map, a hatch in its floor, and a ladder down to the floor of the generator hall. All in the bunker's own measure: r right of its middle, f forward of it.

/** a part of it: a room when it has a `kind`, a passage when not. Its floor and ceiling over the level's floor, when they are not the level's own */
export interface Area { r0: number; r1: number; f0: number; f1: number; kind?: string; name?: string; y?: number; top?: number; bare?: boolean }

export const WING_AREAS: Area[] = [
  // the west wing: where people lived
  { r0: -52, r1: -36, f0: -28, f1: -14, kind: 'barracks', name: 'Dormitory' },
  { r0: -36, r1: -23, f0: -28, f1: -14, kind: 'barracks', name: 'Dormitory' },
  { r0: -52, r1: -36, f0: -11, f1: 2, kind: 'washroom', name: 'Wash block' },
  { r0: -36, r1: -23, f0: -11, f1: 2, kind: 'stores', name: 'Kit store' },
  { r0: -52, r1: -23, f0: 5, f1: 22, kind: 'mess', name: 'Mess hall' },
  { r0: -52, r1: -38, f0: 25, f1: 36, kind: 'kitchen', name: 'Kitchen' },
  { r0: -38, r1: -23, f0: 25, f1: 36, kind: 'stores', name: 'Cold store' },
  // the east wing: where the work was, the generator hall two storeys deep
  { r0: 23, r1: 37, f0: -28, f1: -14, kind: 'medical', name: 'Laboratory' },
  { r0: 37, r1: 52, f0: -28, f1: -14, kind: 'medical', name: 'Laboratory' },
  { r0: 23, r1: 37, f0: -11, f1: 2, kind: 'archive', name: 'Records' },
  { r0: 37, r1: 52, f0: -11, f1: 2, kind: 'workshop', name: 'Workshop' },
  { r0: 23, r1: 52, f0: 5, f1: 22, kind: 'plant', name: 'Generator hall', y: -3.8, bare: true },
  { r0: 23, r1: 38, f0: 25, f1: 36, kind: 'workshop', name: 'Tool crib' },
  { r0: 38, r1: 52, f0: 25, f1: 36, kind: 'stores', name: 'Fuel store' },
  // the front: command
  { r0: -20.5, r1: -6, f0: 11, f1: 24, kind: 'control', name: 'Command post' },
  { r0: 6, r1: 20.5, f0: 11, f1: 24, kind: 'medical', name: 'Infirmary' },
  { r0: -20.5, r1: -6, f0: 27, f1: 36, kind: 'control', name: 'Comms' },
  { r0: 6, r1: 20.5, f0: 27, f1: 36, kind: 'armoury', name: 'Armoury' },
  // the passages: round the old block, out along each wing, and the gallery between the front rooms
  { r0: -23, r1: -20.5, f0: -28, f1: 39 }, { r0: 20.5, r1: 23, f0: -28, f1: 39 }, { r0: -20.5, r1: 20.5, f0: 36, f1: 39 },
  { r0: -52, r1: -23, f0: 2, f1: 5 }, { r0: -52, r1: -23, f0: -14, f1: -11 }, { r0: -52, r1: -23, f0: 22, f1: 25 },
  { r0: 23, r1: 52, f0: 2, f1: 5 }, { r0: 23, r1: 52, f0: -14, f1: -11 }, { r0: 23, r1: 52, f0: 22, f1: 25 },
  { r0: -6, r1: 6, f0: 17.5, f1: 36 }, { r0: -20.5, r1: -6, f0: 24, f1: 27 }, { r0: 6, r1: 20.5, f0: 24, f1: 27 },
  // the bolt-hole: the cellar under the steps, and the drift at the ladder's foot, through to the hall's floor
  { r0: 55, r1: 62, f0: 2, f1: 10, kind: 'stores', name: 'Cellar' },
  { r0: 52, r1: 57.2, f0: 4.6, f1: 7.4, y: -3.8, top: -1.2 },
];

/** the ways through: [right, forward], on the line between two parts; `y`, how high its foot is over the level's floor, where that is not 0 */
export const WING_DOORS: [number, number, number?][] = [
  [-44, -14], [-29.5, -14], [-36, -21], [-44, -11], [-44, 2], [-29.5, 2], [-23, -4.5], [-44, 5], [-30, 5], [-23, 14], [-44, 22], [-30, 22], [-45, 25], [-30, 25], [-38, 30.5],
  [30, -14], [44.5, -14], [37, -21], [30, -11], [23, -4.5], [44.5, -11], [44.5, 2], [30, 5], [44.5, 5], [23, 14], [30, 22], [44.5, 22], [30, 25], [45, 25], [38, 30.5],
  [-20.5, 17], [20.5, 17], [-20.5, 31.5], [20.5, 31.5], [-6, 20], [6, 20], [-6, 31.5], [6, 31.5], [-13, 24], [13, 24], [-13, 27], [13, 27],
  [59.75, 10], [52, 6, -3.8],
];

/** how deep the generator hall's floor lies, and the walkway round it at the level's own floor: how wide */
export const HALL_DEEP = 3.8, WALKWAY = 2.4;

/**
 * The bolt-hole's fixed points. `steps`: the cellar steps, a flight beside the barracks rising from the cellar's back to the ground; `open`, where their roof ends and the ground is
 * cut for them. `hatch`: the steel plate in the cellar's floor, the ladder under it, the wheel beside it.
 */
export const BOLT = { steps: { r0: 58.5, r1: 61, f0: 10, f1: 19, high: 5.2, open: 14.2 }, hatch: { r: 56, f: 6, half: 0.62 }, ladderOut: 1 };

const inside = (a: Area, r: number, f: number, slack = 0) => r > a.r0 - slack && r < a.r1 + slack && f > a.f0 - slack && f < a.f1 + slack;

/** the part of the wings a spot is in, if any: its number in the list */
export const wingAt = (r: number, f: number, slack = 0) => WING_AREAS.findIndex((a) => inside(a, r, f, slack));

/** is a spot in the wings, the cellar steps or the shaft under the hatch? */
export function inWings(r: number, f: number, slack = 0.6) {
  const S = BOLT.steps, H = BOLT.hatch;
  return wingAt(r, f, slack) >= 0 || (r > S.r0 - slack && r < S.r1 + slack && f > S.f0 && f < S.open) || (Math.abs(r - H.r) < 1.2 && Math.abs(f - H.f) < 1.2);
}

/** A stretch of wall, floor to ceiling, or from `y0` over the floor to `y1`. */
export interface WingWall { r0: number; r1: number; f0: number; f1: number; y0: number; y1: number }

const T = 0.3, GAP = 0.95, HIGH = 2.15, STEP = 0.5, TALL = 3;

/** Every wall of the wings: wherever a room meets anything but a way through, or a passage meets rock. Along the old block's outside there is one already. */
export function wingWalls(H: { r: number; back: number; front: number }): WingWall[] {
  const old = (r: number, f: number) => Math.abs(r) < H.r + 0.5 && f > H.back - 0.5 && f < H.front;
  const of = (r: number, f: number) => (old(r, f) ? -2 : wingAt(r, f));
  const out: WingWall[] = [];
  const say = (axis: 'r' | 'f', at: number, a: number, b: number, y0: number, y1: number) => {
    if (y1 <= y0) return;
    out.push(axis === 'r' ? { r0: at - T / 2, r1: at + T / 2, f0: a, f1: b, y0, y1 } : { r0: a, r1: b, f0: at - T / 2, f1: at + T / 2, y0, y1 });
  };
  for (const axis of ['r', 'f'] as const) {
    const [lo, hi, from, to] = axis === 'r' ? [-54, 64, -30, 42] : [-30, 42, -54, 64];
    for (let at = lo; at <= hi; at += STEP) {
      let run: { a: number; y0: number; y1: number } | null = null;
      const close = (b: number) => {
        if (!run) return;
        // (cut at each way through it: the wall over the door and, where its foot is high or low, under it)
        const doors = WING_DOORS.filter(([dr, df]) => Math.abs((axis === 'r' ? dr : df) - at) < 0.01 && (axis === 'r' ? df : dr) > run!.a && (axis === 'r' ? df : dr) < b).map(([dr, df, y]) => [axis === 'r' ? df : dr, y ?? 0]).sort((p, q) => p[0] - q[0]);
        let from_ = run.a;
        for (const [g, y] of doors) {
          say(axis, at, from_, g - GAP, run.y0, run.y1);
          say(axis, at, g - GAP, g + GAP, run.y0, y);
          say(axis, at, g - GAP, g + GAP, y + HIGH, run.y1);
          from_ = g + GAP;
        }
        say(axis, at, from_, b, run.y0, run.y1);
        run = null;
      };
      for (let v = from; v < to; v += STEP) {
        const m = v + STEP / 2, [ra, fa] = axis === 'r' ? [at - STEP / 2, m] : [m, at - STEP / 2], [rb, fb] = axis === 'r' ? [at + STEP / 2, m] : [m, at + STEP / 2];
        const a = of(ra, fa), b = of(rb, fb), A = WING_AREAS[a], B = WING_AREAS[b];
        const wall = a !== b && a !== -2 && b !== -2 && !(a === -1 && b === -1) && !(A && B && !A.kind && !B.kind);
        const y0 = Math.min(A?.y ?? 0, B?.y ?? 0), y1 = Math.max(A?.top ?? TALL, B?.top ?? TALL);
        if (wall && run && run.y0 === y0 && run.y1 === y1) continue;
        close(v);
        if (wall) run = { a: v, y0, y1 };
      }
      close(to);
    }
  }
  return out;
}
