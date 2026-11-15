// What kind of fighter each of the server's survivors is (2026-11-15). The owner: "should have complex ai behaviors to
// give dynamic gameplay. 2 fights shouldnt feel the same for the real player ... is it too simple? Does it feel
// realistic and human like?". It was: every one fought the one way, told apart only by how well it shot. Each now has a
// way of its own and a nerve of its own, so one comes straight on, one sits in a window and waits, one is gone round
// the back before the first magazine is out, one keeps its distance and breaks off the moment it is hurt.
//
// And two parties that meet do not always fight ("the ai should fight eachother sometimes when 2 parties come into
// contact ... like normal players would"): whether two parties are at odds is settled between the two of them, the
// same every time they meet, until one of them fires on the other.

export type Style = 'rusher' | 'holder' | 'flanker' | 'marksman' | 'skittish';

export interface Ways {
  /** ms behind one piece of cover before it works nearer (or, a marksman, further off) */
  push: [number, number];
  /** ms down behind cover between bursts */
  hold: [number, number];
  /** how near it wants them: it works nearer while they are further off than this, metres */
  near: number;
  /** and no nearer than this: it falls back to cover further off */
  far: number;
  /** how often it opens a fight by going round to a side, not to the nearest cover */
  flank: number;
  /** the health under which it breaks off, with no dressing left or little nerve */
  breaks: number;
  /** how often it keeps firing on where somebody went out of sight */
  pins: number;
  /** its bursts and its aim, to those of its gun and its own hand */
  burst: number;
  aim: number;
}

export const STYLE: Record<Style, Ways> = {
  rusher: { push: [3500, 8000], hold: [500, 1500], near: 10, far: 0, flank: 0.25, breaks: 20, pins: 0.8, burst: 1.5, aim: 0.85 },
  holder: { push: [30000, 60000], hold: [1500, 4200], near: 45, far: 0, flank: 0.05, breaks: 35, pins: 0.5, burst: 1, aim: 1.05 },
  flanker: { push: [7000, 15000], hold: [900, 2400], near: 18, far: 0, flank: 0.85, breaks: 30, pins: 0.2, burst: 1, aim: 1 },
  marksman: { push: [9000, 20000], hold: [2200, 5000], near: 80, far: 40, flank: 0.15, breaks: 45, pins: 0.1, burst: 0.4, aim: 1.2 },
  skittish: { push: [20000, 40000], hold: [1800, 4000], near: 35, far: 15, flank: 0.3, breaks: 65, pins: 0.3, burst: 0.8, aim: 0.8 },
};

/** a way of fighting for one with that gun: nobody keeps their distance with a pistol */
export function rollStyle(long: boolean): Style {
  const r = Math.random();
  if (long) return r < 0.22 ? 'rusher' : r < 0.45 ? 'holder' : r < 0.67 ? 'flanker' : r < 0.87 ? 'marksman' : 'skittish';
  return r < 0.3 ? 'rusher' : r < 0.55 ? 'holder' : r < 0.8 ? 'flanker' : 'skittish';
}

/** parties that have fired on one another: at odds from then on, whatever they were */
const blood = new Set<string>();
const pair = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Whether two parties (each named by the first of its two) are at odds: two in three are, the same every time they meet. */
export function atOdds(a: number, b: number): boolean {
  if (a === b) return false;
  if (blood.has(pair(a, b))) return true;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return (((lo * 73856093) ^ (hi * 19349663)) >>> 0) % 100 < 66;
}

export const feud = (a: number, b: number) => void (a !== b && blood.add(pair(a, b)));
