// Grenades: what is thrown, how its fuse runs, and what the server believes of one. The game and the server both
// go by this file.
//
// The owner's (2026-10-13): "rework the grenade throwing mechanic so it functions more like PUBG or DAYZ or COD ...
// hold to cook the grenade for multiple seconds before throwing it".
//
// So: the button is held, and the hands get the pin out (`pull` seconds: until it is out the other button or the
// wheel still stops them, and nothing is lost). From the moment it is out the fuse runs, `fuse` seconds, wherever
// the grenade is. Let go of the button and it is thrown with what is left of its fuse; a tap throws it the moment
// the pin is out, with all of it; held to the end, it goes off in the hand, and nothing worn is between it and
// whoever held it. Once the pin is out there is no putting it back, as there is not in those games.
//
// The server (see `Thrower`). A game says "the pin is out", and later "it has left my hand, from here, this fast".
// Where the grenade then flies and whom its blast reaches is that game's to work out, as whom a bullet hits is: the
// walls it bounces off are not the server's to fly it through. What the server holds a game to:
//   - WHEN. The fuse is the server's own count, from when it heard the pin go. A blast is believed only about the
//     moment that count ends (`early` before it, `late` after), however long the grenade was held. (Until this was
//     written a hit was believed at any time in the nine seconds after a throw: a grenade that "went off" as it
//     left the hand was as good as one that flew.)
//   - WHERE. In the time between leaving the hand and going off, a grenade cannot have got further from where it
//     left than its speed and its fall carry it (`travel`): nothing it bounces off gives it speed, and gravity
//     gives it no more than g a second. Whoever is further from that than the blast reaches was not reached; and
//     whoever is nearer is hurt as by a blast no closer to them than that leaves room for, whatever the game says.
//     A grenade cooked to its last half second has hardly left the hand: the server then knows where it went off
//     to within a few metres, and one that went off IN the hand, exactly.
//   - WHO. One blast reaches each body, each of the infected and each car once, and no more than `people` players.
//     (Twelve hits were believed of one grenade, and nothing said they were twelve people; a car took one from
//     every message that said so.)
//   - IN THE HAND. A pin that is out and a fuse that has run down with nothing thrown is a grenade that went off
//     where its holder stood: the server says so itself if their game does not (`overdue`), shows it to everybody
//     else, and counts what it did to the holder among what they have taken (`dealt` in server/index.ts: whoever is
//     still on their feet after it has taken more than a body can).
//   - FROM A DEAD HAND. Whoever dies with the pin out lets go of it: it falls where they fell, lies there for
//     everybody to see, and goes off when its fuse ends (`fallen`). Of this one nobody's game is asked anything:
//     the server knows where its holder died and when the pin came out, and reckons whom it reaches itself.
// What it still takes on a game's word is said where `judge` is.

import { WEAPON_RULES, hitDamage } from './combat';
import { ITEMS } from './items';

export const NADE = {
  /** how fast an arm throws it, m/s, along the way its thrower looks; and how much is added upward */
  speed: 15,
  lift: 3.2,
  /** the fastest one is believed to leave a hand, m/s (the arm's, and whatever its thrower was doing), and how far from where its thrower stands it may leave from, metres along the ground and up or down */
  most: 40,
  from: 4,
  up: 6,
  /** what pulls it down, m/s a second (as the game flies it: src/game/grenades.ts) */
  fall: 9.81,
  /**
   * How long before the end of the fuse, by the server's count, a blast is believed, and how long after, ms. Before:
   * what a line may hold the word of the pin up by and then be quick with the word of the blast. After: the same the
   * other way about, and a game whose frames are slow (it counts the fuse in its own frames, and a frame is never
   * reckoned longer than a tenth of a second).
   */
  early: 700,
  late: 3000,
  /** how far from where the server can put a blast its game's word of it is believed, metres (where anybody stands is told a moment late) */
  slack: 2,
  /** and how much longer than the server counted a grenade is allowed to have been in the air, ms: the word that it had left the hand may have been held up on the line */
  lag: 250,
  /** the most players one blast reaches */
  people: 12,
  /** pins are not pulled closer together than this, ms (the hands take longer over it than that) */
  gap: 500,
  /**
   * How long past the end of its fuse a grenade is waited for, with nothing said of it, before the server says it
   * went off in the hand, ms. As long again as the fuse: the word that it was thrown may be held up on a bad line,
   * and whoever threw theirs in good time is not to die of a line (a game that is not answering is killed by a
   * blast in its hand: `keep` in server/index.ts). It is longer than `late`: by the time the server says so, nothing
   * that game then says the blast reached is believed.
   */
  silent: 4000,
  /** how far above the feet the hand is that it went off in, metres; and how far above the ground one that lies on it goes off */
  hand: 1.3,
  lies: 0.15,
} as const;

/**
 * A grenade fired from a launcher, the M32's (2026-10-17, the owner: "the grenade launcher and its ammo is an admin
 * only weapon"): how fast it leaves the muzzle, m/s, and the longest it is believed to be in the air, seconds. It
 * goes off where it strikes, so it has no fuse for the server to count: its blast is believed from the moment it
 * leaves to the end of that, no further from where it left than it can have flown by then (see `judge`).
 */
export const LAUNCHED: Record<string, { speed: number; flight: number }> = {
  ammo_40mm: { speed: 76, flight: 8 },
};

/** a thing that is thrown: how long the hands take to get its pin out, and how long its fuse then runs, seconds */
export interface Thrown {
  id: string;
  pull: number;
  fuse: number;
}
/** every such thing, by its item (which is also the name of its rule in WEAPON_RULES, and what a hit by it is said with) */
export const THROWN: Record<string, Thrown> = Object.fromEntries(
  Object.values(ITEMS)
    .filter((d) => d.throw && d.use && WEAPON_RULES[d.id]?.blast)
    .map((d) => [d.id, { id: d.id, pull: d.use!.time, fuse: d.throw!.fuse }]),
);

/** seconds of fuse left, `cooked` seconds after the pin came out (none: it goes off where it is) */
export const fuseLeft = (id: string, cooked: number): number => Math.max(0, (THROWN[id]?.fuse ?? 0) - Math.max(0, cooked));

/** what one that goes off in the hand does to whoever held it: all it has, and no plate is between it and them */
export const inHandDamage = (id: string): number => WEAPON_RULES[id]?.damage ?? 0;

/**
 * The furthest a grenade can be from where it left the hand, so many seconds later, in any direction. It leaves at
 * `speed`; whatever it strikes takes speed from it and gives it none (it keeps 62 parts in a hundred of what it had
 * along a surface and a third of what it had into it); and falling adds g a second at the most.
 */
export const travel = (speed: number, seconds: number): number => speed * seconds + 0.5 * NADE.fall * seconds * seconds;

export type Vec3 = [number, number, number];

/** a grenade whose pin is out and that is still in the hand: which, and when the server heard so (ms) */
export interface Held {
  w: string;
  at: number;
}
/** one that has left the hand, or gone off in it */
export interface Flown {
  w: string;
  /** when its fuse ends, and when the server heard it had left the hand (ms) */
  due: number;
  thrownAt: number;
  /** where it left from, and how fast */
  from: Vec3;
  speed: number;
  /** it never left the hand */
  hand: boolean;
  /** fired from a launcher: it goes off where it strikes, whenever that is before `due` */
  impact?: boolean;
  /** whom and what its blast has been said to reach (see `judge`), and how many of those were players */
  reached: Set<string>;
  people: number;
}
/** what the server keeps of one player's grenades */
export interface Thrower {
  held: Held | null;
  flown: Flown[];
  lastPin: number;
  /** when the last grenade left a launcher (ms) */
  lastLaunch?: number;
}
export const newThrower = (): Thrower => ({ held: null, flown: [], lastPin: -1e12 });

/**
 * A game says a grenade left its player's launcher: from `o`, at `v`, its player standing at `feet`. Believed if it
 * leaves from where they stand, no faster than that launcher fires, and not sooner after the last than the launcher
 * can be fired again (who may fire one at all is the server's to say: an admin).
 * @returns what is kept of it for `judge`; null if it is not believed
 */
export function launch(t: Thrower, w: string, o: Vec3, v: Vec3, feet: Vec3, now: number): Flown | null {
  const spec = LAUNCHED[w];
  if (!spec) return null;
  const speed = Math.hypot(v[0], v[1], v[2]);
  if (Math.hypot(o[0] - feet[0], o[2] - feet[2]) > NADE.from || Math.abs(o[1] - feet[1]) > NADE.up || speed > spec.speed * 1.1) return null;
  if (now - (t.lastLaunch ?? -1e12) < 250) return null;
  t.lastLaunch = now;
  const f: Flown = { w, due: now + spec.flight * 1000, thrownAt: now, from: o, speed, hand: false, impact: true, reached: new Set(), people: 0 };
  t.flown.push(f);
  return f;
}

/**
 * A game says the pin of a grenade is out.
 * @returns 'ok', and the fuse runs from `now`; or why it is not believed: no such thing is thrown, one is live in
 *   that hand already, or the last pin was pulled too short a time ago
 */
export function pullPin(t: Thrower, w: string, now: number): 'ok' | 'what' | 'held' | 'soon' {
  if (!THROWN[w]) return 'what';
  if (t.held) return 'held';
  if (now - t.lastPin < NADE.gap) return 'soon';
  t.held = { w, at: now };
  t.lastPin = now;
  return 'ok';
}

/**
 * A game says its grenade has left the hand: from `o`, at `v`, its thrower standing at `feet`.
 * It is believed if a pin is out, it leaves from where its thrower is and no faster than an arm throws. Which
 * grenade it is and how much of its fuse is left are not asked of the game: they are what the server heard and
 * counted. Said after the fuse has run out by that count, it went off where it then was; and if its game says it
 * never left the hand (it is not moving, at the end of its fuse), that is where the server has its holder standing.
 * @returns what everybody else is told: which, from where, with how many seconds left, and whether it went off in
 *   the hand; null if it is not believed (the pin stays out: see `overdue`)
 */
export function letGo(t: Thrower, o: Vec3, v: Vec3, feet: Vec3, now: number): { w: string; o: Vec3; left: number; hand: boolean } | null {
  const h = t.held;
  if (!h) return null;
  const speed = Math.hypot(v[0], v[1], v[2]);
  if (Math.hypot(o[0] - feet[0], o[2] - feet[2]) > NADE.from || Math.abs(o[1] - feet[1]) > NADE.up || speed > NADE.most) return null;
  const due = h.at + THROWN[h.w].fuse * 1000;
  // (Not moving: it never left the hand, which is how a game says its grenade went off there. That is believed about
  // the end of the fuse and no sooner: an arm throws at twelve metres a second or more, and nothing is let fall.)
  const hand = speed < 1;
  if (hand && now < due - NADE.early) return null;
  const from: Vec3 = hand ? [feet[0], feet[1] + NADE.hand, feet[2]] : o;
  t.held = null;
  t.flown.push({ w: h.w, due, thrownAt: Math.min(now, due), from, speed: hand ? 0 : speed, hand, reached: new Set(), people: 0 });
  return { w: h.w, o: from, left: Math.max(0, (due - now) / 1000), hand };
}

/**
 * Asked now and then of everybody with a pin out: has the fuse run down, and `NADE.silent` more, with nothing said
 * of the grenade? Then it went off in the hand, where its holder stands now. (Nothing is kept of it for `judge`:
 * a game that said nothing of its own grenade for that long is not then believed about whom it reached.)
 * @returns the blast, for the server to show and to count against its holder; null while there is none
 */
export function overdue(t: Thrower, feet: Vec3, now: number): Flown | null {
  const h = t.held;
  if (!h) return null;
  const due = h.at + THROWN[h.w].fuse * 1000;
  if (now < due + NADE.silent) return null;
  t.held = null;
  return { w: h.w, due, thrownAt: due, from: [feet[0], feet[1] + NADE.hand, feet[2]], speed: 0, hand: true, reached: new Set(), people: 0 };
}

/**
 * Whoever had a pin out has died. The grenade does not go with them (the ruling of 2026-10-13, DayZ being the rule
 * for what the owner has not said: "it falls where the holder fell and goes off when its fuse ends, for whoever is
 * in reach, as any grenade on the ground would; others see it lying there"). The fuse is the one that was running:
 * the server's count from the pin. Where it falls is where the server has its holder standing. So there is nothing
 * here for any game to say, and none is asked: whom it reaches the server reckons itself when the fuse ends, by how
 * far each stands from where it lies (`lyingBlast`; `fellBlast` in server/index.ts).
 * @param feet where the holder died
 * @returns what falls: which grenade; where it leaves the hand, for everybody to be shown it fall from there; where
 *   it lies; how many seconds of its fuse are left (none: it goes off as they fall). Null if no pin was out.
 */
export function fallen(t: Thrower, feet: Vec3, now: number): { w: string; from: Vec3; lies: Vec3; left: number } | null {
  const h = t.held;
  if (!h) return null;
  t.held = null;
  const due = h.at + THROWN[h.w].fuse * 1000;
  return { w: h.w, from: [feet[0], feet[1] + NADE.hand, feet[2]], lies: [feet[0], feet[1] + NADE.lies, feet[2]], left: Math.max(0, (due - now) / 1000) };
}

/** What a grenade that goes off where it lies does to a body whose chest is at `chest`, before anything worn: by how far that is from it, as any blast is reckoned. */
export const lyingBlast = (w: string, lies: Vec3, chest: Vec3): number => (THROWN[w] ? hitDamage(w, 'torso', Math.hypot(chest[0] - lies[0], chest[1] - lies[1], chest[2] - lies[2])) : 0);

/**
 * A game says a blast of its player's reached somebody or something. Is it believed, and from how far?
 *
 * Believed: a grenade of that kind, of theirs, whose fuse ends about now by the server's count; that has not been
 * said to reach this body or this car before, nor more players than a blast reaches; and that can have got near
 * enough to it since it left the hand. Then the distance the game says is taken, but never less than the nearest
 * the blast can have been.
 *
 * ON TRUST, still: that the thrower had a grenade at all (what is in a pocket is its own game's to say, and the
 * trader sells these); where inside the reach of its flight the grenade went off, and so how hard it struck
 * anybody inside that reach; that no wall stood between; and what a thrown one did to its own thrower.
 *
 * @param key which body or car, in a word of its own ('p' + a player's number, 'i' + an infected's, 'v' + a car's)
 * @param at where that is (of a body: its chest)
 * @param said how far from the blast its game says that was, metres
 * @param within how far the blast reaches such a thing, metres (as far as its rule says, if not given)
 * @returns the distance to reckon what it did by; null if it is not believed
 */
export function judge(t: Thrower, w: string, key: string, at: Vec3, said: number, now: number, within?: number): number | null {
  const rule = WEAPON_RULES[w];
  if ((!THROWN[w] && !LAUNCHED[w]) || !rule?.blast || !Number.isFinite(said)) return null;
  // (what went off long enough ago is forgotten)
  if (t.flown.length) t.flown = t.flown.filter((f) => now <= f.due + NADE.late);
  let best: { f: Flown; least: number } | null = null;
  for (const f of t.flown) {
    // (one from a launcher goes off where it strikes: believed from when it left, not about the end of a fuse)
    if (f.w !== w || (!f.impact && now < f.due - NADE.early) || f.reached.has(key)) continue;
    if (key.startsWith('p') && f.people >= NADE.people) continue;
    const flown = (Math.max(0, (f.impact ? Math.min(now, f.due) : f.due) - f.thrownAt) + NADE.lag) / 1000;
    const least = Math.max(0, Math.hypot(at[0] - f.from[0], at[1] - f.from[1], at[2] - f.from[2]) - travel(f.speed, flown));
    if (least > (within ?? rule.blast) + NADE.slack) continue;
    if (!best || least < best.least) best = { f, least };
  }
  if (!best) return null;
  best.f.reached.add(key);
  if (key.startsWith('p')) best.f.people++;
  return Math.max(0, said, best.least - NADE.slack);
}
