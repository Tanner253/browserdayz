// How a body moves, watched for a program walking it: standing on nothing, or to and fro on one spot doing nothing.
// (2026-10-15: "when the bots make it into the game sometimes
// theyre walking in the air and dont get kicked... some bots move back and forth and move around in a jittery
// fashion once on the server preventing them from being kicked or flagged"; and, when the first measures were
// shown: "this can be dangerous, what about players falling a large distance or making a jump etc... we shouldnt
// take my rules at face value"; and: "we need to detect bots within a minute of joining. waiting for longer could
// allow the bots to learn or cash tags").
//
// Two things a person's body never does, measured from what their game says of where it is, by its own clock:
//   - STANDING ON NOTHING: more than 2 m over what is under them, with nothing within 4 m that could hold them up
//     (a building, a rock, a crate, a vehicle: whoever is near one may be on it, up its stairs or its ladder), and
//     not coming down. A fall is coming down within half a second of leaving the edge (5 m/s by then); a jump tops
//     out near 1.2 m. 1.5 s of it is a strike.
//   - GOING NOWHERE: to and fro and to and fro, turning back again and again, ending where it began, and nothing
//     else done (no pick-up, door, inventory, shot, hit, call, voice, emote, seat). A person who strafes is shooting;
//     one who steps round a body is in its pockets; one who dances has chosen a dance.
// In a player's first minute in the world the windows are short, so that a program is found inside that minute:
// two strikes, or a quarter minute of going nowhere, and it is sent back to the bot check. After the first minute,
// the gentler rules: three strikes in two minutes, or going nowhere for a minute and a half. Sent back is no loss to
// a person: they are taken off as with the proper leave (saved where they stood, with everything), pass the check
// in a minute, and are back where they were.
//
// Nothing of the server is in here: the server says what is under a body and what is near it (server/checks.ts),
// and the test says it of its own made-up worlds (test/bodywatch.test.ts).

/** the first minute in the world, ms: the short windows */
export const FIRST = 60_000;

export const AIR = {
  /** over what is under them, metres, and how long without coming down before it is a strike (ms) */
  high: 2,
  hold: 1500,
  /** "coming down": falling faster than this, m/s, measured over at least this long (ms) */
  falling: 2,
  over: 300,
  /** strikes that send them back: in the first minute, and after it within `within` ms */
  first: 2,
  later: 3,
  within: 120_000,
};

export const PACE = {
  /**
   * the window, ms (in the first minute, and after), and how long going nowhere must last to send them back. Three
   * minutes, not the minute and a half it was: a player with a sniper's rifle, side to side behind cover watching a
   * field, was sent back for it 2026-10-15 ("16 m walked, 7 turn-backs in 30 s, for 90 s"). A program pacing to stay
   * in the world is still out long before it could hold a tag the fifteen minutes it must.
   */
  first: 15_000,
  later: 30_000,
  lasts: 180_000,
  /** in a window: at least this far walked (m), no further than this from where it began (m), no wider than this (m), and this many turn-backs */
  walked: 6,
  ends: 4,
  wide: 12,
  backs: 6,
  /** a step counts toward a turn-back once it is this long (m): what jitters under it is gathered into one */
  step: 0.15,
  /**
   * up or down this much in a window (m) is going somewhere, whatever the ground plan says: a flight of stairs is to
   * and fro across the plan, turning back at each landing. A player who went up a house's stairs and round its rooms
   * was sent back in their first minute for it, 2026-10-15 ("26 m walked, 8 turn-backs in 15 s"), and the owner:
   * "does our back and forth account for height? ... it could look like when they go on 2nd story that they are going
   * back and forth on themselves"
   */
  climb: 1.5,
};

/** what a telling of a body says, with what the server knows of the place */
export interface Body {
  /** the game's own clock, ms */
  t: number;
  x: number;
  y: number;
  z: number;
  /** how high what is under them stands (the ground, a bridge's deck, the fort's floors) */
  under: number;
  /** something that could hold them up is within reach (a building, a rock, a crate, a vehicle), when they are over the ground */
  near: boolean;
  /**
   * the same, at any height: by a building, inside one or on its stairs. To and fro there is a person going through
   * its rooms as often as a program, and the gentler rules are kept, in the first minute as after it; out in the open,
   * where the programs of 2026-10-15 stood about after coming in, the first minute's short windows still hold.
   */
  by?: boolean;
  /** not to be asked: in a seat, dead, an admin, flying by an admin's power, just set down somewhere */
  free: boolean;
  /** when they last did something a person does (the server's clock, ms; compared with `now`) */
  did: number;
}

export type Verdict = { why: string } | null;

/** a pace window: where and when it began, how far has been walked in it and how wide, the turn-backs, and the step being gathered */
interface Win { t: number; x: number; z: number; path: number; backs: number; minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number; sx: number; sz: number; px: number; pz: number; dx: number; dz: number }

export class BodyWatch {
  private last: Body | null = null;
  /** recent tellings, for how fast they are coming down */
  private recent: Body[] = [];
  private aloft = 0;
  private strikes: number[] = [];
  /** the pace window: where it began, every gathered step since */
  private win: Win | null = null;
  /** since when (game clock) they have been going nowhere, window on window */
  private nowhereSince = -1;

  /** @param joined when they came into the world (the server's clock, ms) */
  constructor(private joined: number) {}

  /** A telling. @param now the server's clock @returns a verdict when they are to be sent back to the bot check */
  see(b: Body, now: number): Verdict {
    const first = now - this.joined < FIRST;
    if (b.free) {
      this.reset(b);
      return null;
    }
    const last = this.last;
    this.last = b;
    if (!last || b.t <= last.t) return null;
    const dt = Math.min(1000, b.t - last.t);
    this.recent.push(b);
    while (this.recent.length > 2 && this.recent[1].t <= b.t - AIR.over) this.recent.shift();
    return this.air(b, dt, now, first) ?? this.pace(b, now, first);
  }

  private reset(b: Body) {
    this.last = b;
    this.recent = [b];
    this.aloft = 0;
    this.win = null;
    this.nowhereSince = -1;
  }

  private air(b: Body, dt: number, now: number, first: boolean): Verdict {
    const back = this.recent[0], span = b.t - back.t;
    const coming = span >= AIR.over && (b.y - back.y) / (span / 1000) < -AIR.falling;
    if (b.y - b.under > AIR.high && !b.near && !coming) this.aloft += dt;
    else this.aloft = 0;
    if (this.aloft < AIR.hold) return null;
    this.aloft = 0;
    this.strikes.push(now);
    this.strikes = this.strikes.filter((s) => now - s <= AIR.within);
    const need = first ? AIR.first : AIR.later;
    if (this.strikes.length < need) return null;
    this.strikes = [];
    return { why: `stood on nothing, ${(b.y - b.under).toFixed(0)} m over the ground, ${need} times${first ? ' in their first minute' : ''}` };
  }

  private fresh(b: Body) {
    return (this.win = { t: b.t, x: b.x, z: b.z, path: 0, backs: 0, minX: b.x, maxX: b.x, minZ: b.z, maxZ: b.z, minY: b.y, maxY: b.y, sx: b.x, sz: b.z, px: b.x, pz: b.z, dx: 0, dz: 0 });
  }

  private pace(b: Body, now: number, first: boolean): Verdict {
    // (anything done is a person doing it: the count begins again)
    if (now - b.did < 1000) {
      this.nowhereSince = -1;
      this.fresh(b);
      return null;
    }
    // (the first minute's short windows out in the open; by a building, the gentler rules from the start: see `by`)
    const quick = first && !b.by;
    const w = this.win ?? this.fresh(b), span = quick ? PACE.first : PACE.later;
    this.walk(w, b);
    if (b.t - w.t < span) return null;
    // (a window run its length with nothing done in it: going nowhere, or going somewhere)
    this.fresh(b);
    const nowhere = w.path >= PACE.walked && Math.hypot(b.x - w.x, b.z - w.z) <= PACE.ends && Math.max(w.maxX - w.minX, w.maxZ - w.minZ) <= PACE.wide && w.backs >= PACE.backs && w.maxY - w.minY < PACE.climb;
    if (!nowhere) {
      this.nowhereSince = -1;
      return null;
    }
    if (this.nowhereSince < 0) this.nowhereSince = w.t;
    if (!quick && b.t - this.nowhereSince < PACE.lasts) return null;
    this.nowhereSince = -1;
    return { why: `went to and fro on one spot doing nothing else (${w.path.toFixed(0)} m walked, ${w.backs} turn-backs in ${(span / 1000).toFixed(0)} s)${quick ? ' in their first minute' : ` for ${(PACE.lasts / 1000).toFixed(0)} s`}` };
  }

  private walk(w: Win, b: Body) {
    w.path += Math.hypot(b.x - w.px, b.z - w.pz);
    w.px = b.x;
    w.pz = b.z;
    w.minX = Math.min(w.minX, b.x);
    w.maxX = Math.max(w.maxX, b.x);
    w.minZ = Math.min(w.minZ, b.z);
    w.maxZ = Math.max(w.maxZ, b.z);
    w.minY = Math.min(w.minY, b.y);
    w.maxY = Math.max(w.maxY, b.y);
    // (steps gathered until they are long enough to say a way: a turn-back is a step against the one before it)
    const sx = b.x - w.sx, sz = b.z - w.sz, len = Math.hypot(sx, sz);
    if (len >= PACE.step) {
      const before = Math.hypot(w.dx, w.dz);
      if (before > 0 && sx * w.dx + sz * w.dz < -0.5 * len * before) w.backs++;
      w.dx = sx;
      w.dz = sz;
      w.sx = b.x;
      w.sz = b.z;
    }
  }
}
