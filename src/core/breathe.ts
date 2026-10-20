/**
 * Work that nobody is waiting on this very frame (a model being made ready for the ground, a body for one of the
 * infected who has come near, pictures sent on ahead to the graphics card) is done a few milliseconds at a time,
 * one helping to a frame (2026-10-12).
 *
 * The first rifle to come within ninety metres was fifty milliseconds of arithmetic in one go: every point of it
 * unpacked, turned, measured, moved, measured again, its pieces made one. A body was thirty. Nothing was drawn the
 * while, and that was the catch in the step on walking into a village. The same work is done now, in the same
 * order; between its parts this is asked, and when the frame has had its share it says wait, and the rest goes on
 * in the next.
 *
 *   await breathe();   // before each piece of the work
 *
 * However many pieces of work are going at once, a frame gives them this much between them and no more (and what
 * the last piece begun runs over by): they take turns.
 */

/**
 * What a frame gives to work of this kind: this many milliseconds, or this share of the frame where frames are
 * long. (A fixed three milliseconds is a fifth of a frame at sixty a second and a seventieth of one at five: on a
 * slow computer the infected would have stood about bodiless for a minute.)
 */
const SHARE_MS = 3, SHARE_OF_FRAME = 0.12, SHARE_MOST = 40;
let share = SHARE_MS;
/** how long frames are, as far as this has seen: quick to believe a short one, slow to believe a long one */
let frame = 16;
let began = 0;
let armed = false;
const waiting: (() => void)[] = [];

/** one of those waiting is let go on, and when its piece is done (it asks again, or is finished) the next, while the frame's share lasts */
function pass() {
  // (development: how long the piece let go on last ran before it waited again, or was done)
  if (resumed) {
    resumed = false;
    const ms = performance.now() - resumedAt;
    if (ms > 8) LONG_PIECES.push({ ms: Math.round(ms), from: resumedFrom });
  }
  if (!waiting.length) return;
  if (performance.now() - began >= share) return arm();
  waiting.shift()!();
  queueMicrotask(pass);
}

function arm() {
  if (armed) return;
  armed = true;
  let gone = false;
  const on = () => {
    if (gone) return;
    gone = true;
    clearTimeout(late);
    armed = false;
    const now = performance.now();
    // (How long frames are, from the last time this was let go on: only while it is being let go on frame after
    // frame. One long frame is not taken for the pace of the computer: given a bigger share after it, this made a
    // second long frame out of the first.)
    if (began && now - began < 400) {
      frame = steady(frame, now - began);
      share = Math.min(SHARE_MOST, Math.max(SHARE_MS, frame * SHARE_OF_FRAME));
    }
    began = now;
    pass();
  };
  // (a page with no frames coming, or coming slower than this, goes on without them)
  const late = setTimeout(on, 34);
  requestAnimationFrame(on);
}

/** A frame's length as it is believed to be, given one more frame: down at once, up a twentieth of the way. */
export function steady(believed: number, seen: number) {
  return seen < believed ? seen : believed + (seen - believed) * 0.05;
}

/** (development, with `__breatheWatch` set: every piece of work let go on that ran over 8 ms, with where it was let go on from) */
export const LONG_PIECES: { ms: number; from: string }[] = [];
let resumed = false, resumedAt = 0, resumedFrom = '';

export function breathe(): Promise<void> | void {
  // (a page nobody is looking at has no frame to keep: the work is done as fast as it can be, as it was. The game
  // loads so in a tab left in the background.)
  if (typeof document !== 'undefined' && document.hidden) return;
  if (!waiting.length && performance.now() - began < share) return;
  const from = (globalThis as { __breatheWatch?: boolean }).__breatheWatch ? (new Error().stack ?? '') : '';
  return new Promise<void>((go) => {
    waiting.push(from ? () => ((resumed = true), (resumedAt = performance.now()), (resumedFrom = from), go()) : go);
    arm();
  });
}

/** One piece of such work at a time: what is marked `first` (it is near, or somebody has just done something) before what is not. */
export class Line {
  private busy = false;
  private waiting: { first: boolean; go: () => void }[] = [];

  async take<T>(first: boolean, work: () => Promise<T>): Promise<T> {
    if (this.busy) {
      await new Promise<void>((go) => {
        const at = first ? this.waiting.findIndex((w) => !w.first) : -1;
        this.waiting.splice(at < 0 ? this.waiting.length : at, 0, { first, go });
      });
    }
    this.busy = true;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      // (handed straight on: nobody who comes between the two finds the line free)
      if (next) next.go();
      else this.busy = false;
    }
  }
}
