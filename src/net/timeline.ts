// When a report of somebody else's player was TRUE, as against when it got here.
//
// Another game says where its player is fifteen times a second, and the server passes on the last it has heard,
// fifteen times a second by its own clock. Spaced out by when they ARRIVE, as they were, those reports are not
// evenly apart: one is held up on the way (a long way off, more of them are, and by more), one is waited for
// behind a slow frame of the game that is drawing it, the server's fifteen and the other game's fifteen slide
// past one another so that the same report is passed on twice and then the next but one. Each of those was a
// runner who stood still for a fifteenth of a second and then covered the ground twice as fast: "jumping about".
//
// So each report carries the time it was true by the clock of the game that made it, and is kept by that. The
// quickest report yet says how that clock stands to this one, and every other is late by however long it was
// held up (the jeep has been drawn this way since it was made: see Jeep.push). They are shown a little in the
// past, as before, and by how much is no longer a fixed tenth of a second: it is what the reports of this one
// player have lately needed, the furthest apart they come and the latest one of them has been. Somebody near on
// a good line is shown as near to now as before; somebody across an ocean a little further back, and smoothly.

/** how far behind now somebody is shown, at the least and at the most (ms) */
export const SHOWN_BEHIND = { least: 100, most: 350 };
/** kept in hand over what the reports have needed (ms) */
const MARGIN = 12;
/** a report later than this is a hold-up and is not waited for another time: the picture catches up after it (ms) */
const LATE_MOST = 200;
/** reports further apart than this are somebody whose game has stopped, not a rate to be allowed for (ms) */
const GAP_MOST = 200;
/** seconds in which the worst seen is half forgotten */
const FORGET = 2.5;
/** when the next report is later than was allowed for, they are carried on as they were going for this long past the newest (ms): not stopped dead */
const CARRIED_ON = 100;
/** and when it does come, they make up the ground at this many times their own speed: not in one bound */
const CATCH_UP = 2;

/**
 * Between which two of the reports kept the time `t` falls, and how far from the first of them to the second
 * (over 1: carried on past the newest).
 */
export function between<S extends { t: number }>(s: S[], t: number): { a: S; b: S; k: number } | null {
  if (!s.length) return null;
  let a = s[0], b = s[s.length - 1];
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i - 1].t <= t) {
      a = s[i - 1];
      b = s[i];
      break;
    }
  }
  const span = b.t - a.t;
  return { a, b, k: span > 0 ? Math.min(1 + Math.min(1.5, CARRIED_ON / span), Math.max(0, (t - a.t) / span)) : 1 };
}

/**
 * How much of the way to where they should be shown somebody is moved in this frame: all of it, but for one who
 * has fallen behind (a report was held up for longer than was allowed for, and has now come), who makes it up at
 * a run and not in a bound.
 * @param off how far they are from where they should be, metres @param speed what they were going at between the two reports, m/s
 */
export function caughtUp(off: number, speed: number, dt: number): number {
  const most = Math.max(speed, 1.5) * CATCH_UP * dt + 0.01;
  return off <= most ? 1 : most / off;
}

export class Timeline {
  /** this clock less theirs, by the quickest report yet (ms); null until one has come */
  private clock: number | null = null;
  /** the same as it is used: eased, so that a correction is not a jump in what is shown */
  private used = 0;
  private last = -Infinity;
  /** lately: how late a report has come at worst, and how far apart two have been (ms) */
  private late = 0;
  private gap = 0;
  private astray = 0;
  /** one more each time their clock is taken afresh: what was kept by the old one is of no use */
  epoch = 0;
  /** how far behind the newest they are being shown (ms) */
  behind = SHOWN_BEHIND.least;

  /**
   * A report has come.
   * @param stamp when it was true, by the clock of the game that made it (ms)
   * @param now when it came, by this one's (ms)
   * @returns the time it is to be kept by (their clock)
   */
  place(stamp: number, now: number): number {
    const est = now - stamp;
    // (Their clock is not the one it was: far ahead of where it stood, which nothing on the way does to a report;
    // or far behind it for ten reports together, which is a machine that slept and woke.)
    this.astray = this.clock !== null && est - this.clock > 1000 ? this.astray + 1 : 0;
    if (this.clock === null || est < this.clock - 400 || this.astray >= 10) {
      this.clock = this.used = est;
      this.last = -Infinity;
      this.late = this.gap = this.astray = 0;
      this.epoch++;
    } else this.clock = Math.min(est, this.clock + 0.02);
    const late = est - this.clock;
    if (late < 1000) this.late = Math.max(this.late, Math.min(LATE_MOST, late));
    if (stamp > this.last) {
      if (this.last > -Infinity) this.gap = Math.max(this.gap, Math.min(GAP_MOST, stamp - this.last));
      this.last = stamp;
    }
    return stamp;
  }

  /** What time it is now by their clock: for something the server has done to them itself, which their game put no time to. */
  theirs(now: number): number {
    return this.clock === null ? now : now - this.clock;
  }

  /** Each frame: the time, by their clock, that is to be shown. */
  at(now: number, dt: number): number {
    if (this.clock === null) return now;
    const keep = Math.pow(0.5, dt / FORGET);
    this.late *= keep;
    this.gap *= keep;
    // (what has to have come before a moment can be shown is the report after it: so, as far behind as two
    // reports are apart and the later of them is late. Further behind at once when that is not enough, which is
    // their time run a little slow for a moment; nearer again slowly, which nobody sees.)
    const want = Math.min(SHOWN_BEHIND.most, Math.max(SHOWN_BEHIND.least, this.gap + this.late + MARGIN));
    this.behind += (want - this.behind) * (1 - Math.exp(-(want > this.behind ? 2.5 : 0.5) * dt));
    this.used += (this.clock - this.used) * (1 - Math.exp(-3 * dt));
    return now - this.used - this.behind;
  }
}
