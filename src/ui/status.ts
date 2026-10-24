// How a survivor's state is read: an icon each for health, blood, food and water, drawn in the colour of how it
// stands, with arrows beside it for which way it is going and how fast; and a badge for each thing that is the
// matter with them (or is doing them good) for as long as it is so. This is the reckoning and nothing else: which
// of its five looks an icon has, how many arrows, whether blood is shown at all, and what each says in words.
// Nothing here touches the page: src/ui/status-view.ts draws it, in the corner of the game and in the inventory.
//
// The user's (2026-10-13): "We dont need to show the players blood unless its dropping, dayz just does icons and
// symbols. We can just show the icons (we should have different icons for different statuses states for the
// statuses) in dayz the internals of the icons are the symbols themselves and the color correlates with the status."
//
// As DayZ has it (its own HUD script and its notifiers, and dayz.wiki.gg/wiki/Blood, /Energy and /Hydration, read
// 2026-10-13): an icon has five looks. Whole and white; white with less in it; yellow; red; and red that blinks
// to white and back every quarter of a second. Up to three arrows stand beside it, up or down, by how fast it is
// changing over the last few seconds, and none when it is steady. A badge is a symbol that is there or is not
// (a wound, a broken bone, a sickness). The levels at which its looks change are its own game's (health 80, 50,
// 30, 15; blood 4500, 4000, 3500, 3000; food and water 70%, 16%, 6%, none): here each is a figure of this game's
// rules, so that a colour always means something has changed for the survivor, and DayZ's where the rules have none.

import { BLOOD, bleedsOutIn, bloodBack, bloodLeft } from '../sim/blood';
import { NEED } from '../sim/wells';

export type Stat = 'health' | 'blood' | 'food' | 'water';
/** the four, in the order they stand in from the left: blood at the end, so that the others never move when it comes and goes */
export const STATS: Stat[] = ['blood', 'health', 'food', 'water'];

/** the five looks of an icon: whole; less (white still, and part empty); low (yellow); critical (red); and the last (red, blinking) */
export type Step = 'fine' | 'less' | 'low' | 'crit' | 'last';

/**
 * Health has two figures in the rules: under 30 a survivor is slower on their feet (Player.step), and the lightest
 * blows there are (one of the infected's is 13, a fist 14) end anybody under 15. The other two are DayZ's.
 */
export const HEALTH = { less: 80, low: 50, slow: 30, last: 15 };
/** with more food and more water than this, health mends by itself and blood comes back at its best (Player.tickVitals, `bloodBack`) */
export const FED = 60;

/**
 * Which look an icon has.
 * - health: less under 80 and yellow under 50 (DayZ's), red under 30 (slowed), blinking under 15 (any blow ends it)
 * - blood, ml: less under 5000, yellow under 4500 (the colour begins to go, health mends at half), red under 3500
 *   (the colour has gone, health does not mend), blinking under 3000 (the head swims: no running)
 * - food and water: less at 60 and under (health no longer mends by itself), yellow under 25 (hungry, thirsty),
 *   red under 10 (starving, parched), blinking at nothing (health is going)
 */
export function stepOf(stat: Stat, v: number): Step {
  if (stat === 'health') return v < HEALTH.last ? 'last' : v < HEALTH.slow ? 'crit' : v < HEALTH.low ? 'low' : v < HEALTH.less ? 'less' : 'fine';
  if (stat === 'blood') return v < BLOOD.faint ? 'last' : v < BLOOD.grey[1] ? 'crit' : v < BLOOD.grey[0] ? 'low' : v < BLOOD.full ? 'less' : 'fine';
  return v <= 0 ? 'last' : v < NEED.bad ? 'crit' : v < NEED.wanting ? 'low' : v <= FED ? 'less' : 'fine';
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** how much of the symbol is filled, 0 to 1: blood as how much of what can be lost is left */
export const fillOf = (stat: Stat, v: number) => (stat === 'blood' ? bloodLeft(v) : clamp(v / 100, 0, 1));

/**
 * How fast each has to be changing, a second, to earn one arrow, two and three: falling, and rising. Every figure
 * stands between two rates the rules have, so that no arrow flickers at one of them.
 * - health falls by 0.35 with nothing eaten or drunk, by 6 to 16 in the gas, and by a blow all at once (a round's
 *   thirty, seen over three seconds, is ten a second); it rises by 0.06 to 0.12 by itself, by 0.8 beside a fire,
 *   and by a dressing's ten or a stim's thirty-five at once
 * - blood, ml: a wound in a limb is 3.6 and one in the body 6, and every wound there is costs some multiple of 1.2,
 *   so wounds together do too: one arrow up to 4.8, two from the body's 6, three from two in the body (12). It comes
 *   back by itself at 0.5 to 1.2, from saline at 8.3, from a bag of blood at 75
 * - food goes at 0.045 at rest and 0.108 at a sprint, water at 0.07 and 0.168: at rest and at a walk there is no
 *   arrow (that is what steady is), at a run there is one; anything eaten or drunk comes all at once
 */
export const PACE: Record<Stat, { down: [number, number, number]; up: [number, number, number] }> = {
  health: { down: [0.2, 3, 10], up: [0.04, 0.5, 3] },
  blood: { down: [1, 5.4, 11.4], up: [0.3, 5, 30] },
  food: { down: [0.07, 0.5, 2], up: [0.3, 3, 8] },
  water: { down: [0.12, 0.5, 2], up: [0.3, 3, 8] },
};

/** the arrows beside an icon: -3 (falling fast) to 3 (rising fast), 0 for none */
export function arrowsOf(stat: Stat, rate: number): number {
  const by = rate < 0 ? PACE[stat].down : PACE[stat].up, a = Math.abs(rate);
  const n = a >= by[2] ? 3 : a >= by[1] ? 2 : a >= by[0] ? 1 : 0;
  return n && rate < 0 ? -n : n;
}

/** seconds a change is measured over, how often what it is gets noted, and how long there has to be before anything is said */
const SPAN = 3, EVERY = 0.25, LEAST = 0.5;

/**
 * How fast a thing is changing, from what it was a few seconds ago (as DayZ's notifiers tell it: from what was
 * seen, not from what the rules say ought to be happening, so that a blow, a bag and a wound all show alike).
 */
export class Pace {
  private ts: number[] = [];
  private vs: number[] = [];

  /**
   * Note what it is now, and say how fast it is changing, a second (0 until there is enough to tell by).
   * @param t seconds, by any clock that only goes forward
   */
  note(v: number, t: number): number {
    const n = this.ts.length;
    // (a clock put back, or nothing heard for longer than is measured over: what was known is of no use)
    if (n && (t < this.ts[n - 1] || t - this.ts[n - 1] > SPAN)) this.clear();
    if (!this.ts.length || t - this.ts[this.ts.length - 1] >= EVERY) {
      this.ts.push(t);
      this.vs.push(v);
    }
    // (the oldest kept is the last that is at least the whole span old)
    while (this.ts.length > 1 && t - this.ts[1] >= SPAN) {
      this.ts.shift();
      this.vs.shift();
    }
    const dt = t - this.ts[0];
    return dt >= LEAST ? (v - this.vs[0]) / dt : 0;
  }

  clear() {
    this.ts.length = this.vs.length = 0;
  }
}

/** how bad a wound is, by what it costs: 1 light (a limb), 2 heavy (the body), 3 severe (two in the body, or more) */
export const bleedLevel = (rate: number): 1 | 2 | 3 => (rate >= PACE.blood.down[2] ? 3 : rate >= PACE.blood.down[1] ? 2 : 1);

/** the share of the blood there is to lose under which its symbol is shown */
export const BLOOD_SHOWN = 0.8;

/**
 * Whether blood is shown at all: only with less than four fifths of what there is to lose (2026-10-13, the user:
 * "we only need to show the blood icon when its below 80%"). That is 4500 ml, which is also where losing it begins
 * to do anything: the colour starts to go out of the world there, and health mends slower. Above it there is
 * nothing for the symbol to say, wound or no wound: an open wound has a badge of its own.
 */
export const bloodShows = (blood: number) => bloodLeft(blood) < BLOOD_SHOWN;

/** a survivor, as far as their state goes */
export interface Body {
  health: number;
  /** ml */
  blood: number;
  /** what every open wound together costs, ml a second (0: none is open) */
  bleed: number;
  energy: number;
  water: number;
  broken: boolean;
  /** a bag of blood or saline is running in */
  drip: boolean;
  /** breathing gas: with nothing over the face, or through a mask (null: clean air) */
  gas: 'bare' | 'masked' | null;
  /** resting by a fire that is alight: mending by it, or only warm */
  fire: 'mending' | 'warm' | null;
  /** seconds of food poisoning left, and of a vitamins' guard (src/sim/sickness.ts): 0, none */
  ill: number;
  guard: number;
}

export interface StatView {
  stat: Stat;
  /** false: its icon is not there (blood, when it is full and steady) */
  shown: boolean;
  step: Step;
  /** how much of the symbol is filled, 0..1 */
  fill: number;
  /** -3..3 */
  arrows: number;
  /** the number, for whoever has asked for numbers */
  figure: string;
  /** and in words, for the inventory */
  line: string;
}

export type BadgeId = 'fire' | 'gas' | 'leg' | 'bleed' | 'ill' | 'guard';
/** what colour a badge is: doing harm, a warning, neither, doing good */
export type Tone = 'bad' | 'warn' | 'calm' | 'good';

export interface BadgeView {
  id: BadgeId;
  tone: Tone;
  /** about to kill */
  blink: boolean;
  /** a wound: how bad, 1 to 3 (0 for every other badge) */
  level: 0 | 1 | 2 | 3;
  figure: string;
  line: string;
}

export interface Reading {
  stats: StatView[];
  badges: BadgeView[];
}

function healthLine(b: Body, step: Step, arrows: number): string {
  const how = { fine: 'fine', less: 'hurt, not badly', low: 'hurt', crit: 'badly hurt, and slower on your feet', last: 'nearly gone. One more blow ends it' }[step];
  const going = arrows <= -2 ? ' Falling fast.' : arrows < 0 ? ' Falling.' : arrows >= 2 ? ' Mending fast.' : arrows > 0 ? ' Mending.' : '';
  // (why it is not mending, to whoever is waiting for it to: the three things that stop it, in Player.tickVitals)
  const stuck = arrows !== 0 || b.health >= 100 ? '' : b.bleed > 0 ? ' It will not mend while a wound is open.' : b.energy <= FED || b.water <= FED ? ' It will not mend until you have eaten and drunk.' : b.blood < BLOOD.grey[1] ? ' It will not mend on so little blood.' : '';
  return `Health: ${how}.${going}${stuck}`;
}

function bloodLine(b: Body, step: Step): string {
  if (b.bleed > 0) return `Blood: ${b.drip ? 'a bag is running in, and it is running out of the wound' : ['losing it', 'losing it fast', 'pouring out'][bleedLevel(b.bleed) - 1]}. Bandage now.`;
  const back = b.drip ? 'A bag is running in.' : bloodBack(b.energy, b.water, false) > 0 ? 'It is coming back by itself.' : 'Eat and drink to bring it back.';
  if (step === 'fine') return `Blood: all of it.${b.drip ? ' ' + back : ''}`;
  if (step === 'less') return `Blood: a little down. ${back}`;
  if (step === 'low') return `Blood: low. The colour is going out of things. ${back}`;
  const bag = b.drip ? 'A bag is running in.' : step === 'last' ? 'A blood bag or saline, now.' : 'A blood bag or saline puts it back.';
  return step === 'crit' ? `Blood: very low. Health will not mend. ${bag}` : `Blood: too little to run on. ${bag}`;
}

const NEEDS: Record<'food' | 'water', Record<Step, string>> = {
  food: {
    fine: 'Food: well fed.',
    less: 'Food: getting low. Eat to keep your health mending.',
    low: 'Food: hungry. Your aim is less steady. Eat.',
    crit: 'Food: starving. Your hands shake and your breath is slow to come back. Eat now.',
    last: 'Food: none. You are losing health. Eat now.',
  },
  water: {
    fine: 'Water: not thirsty.',
    less: 'Water: getting low. Drink to keep your health mending.',
    low: 'Water: thirsty. Your breath comes back slower. Drink.',
    crit: 'Water: parched. You cannot run flat out. Drink now.',
    last: 'Water: none. You are losing health. Drink now.',
  },
};

/**
 * Everything there is to show of a survivor.
 * @param rates how fast each of the four is changing, a second (a `Pace` each, kept by whoever is showing them)
 */
export function reading(b: Body, rates: Record<Stat, number>): Reading {
  const value: Record<Stat, number> = { health: b.health, blood: b.blood, food: b.energy, water: b.water };
  const stats = STATS.map((stat): StatView => {
    const v = value[stat], step = stepOf(stat, v), arrows = arrowsOf(stat, rates[stat]);
    return {
      stat,
      shown: stat !== 'blood' || bloodShows(v),
      step,
      fill: fillOf(stat, v),
      arrows,
      // (never "0" on somebody still alive; and blood in millilitres, as the rules count it)
      figure: stat === 'blood' ? String(Math.round(v)) : String(clamp(Math.ceil(v), 0, 100)),
      line: stat === 'health' ? healthLine(b, step, arrows) : stat === 'blood' ? bloodLine(b, step) : NEEDS[stat][step],
    };
  });

  const badges: BadgeView[] = [];
  if (b.fire) {
    // (why it is doing no good, when it is not: the things that stop it, in Player.rest)
    const why = b.bleed > 0 ? 'stop the bleeding first, and it will mend you' : b.energy <= 10 || b.water <= 10 ? 'eat and drink first, and it will mend you' : 'warm, and nothing to mend';
    badges.push({ id: 'fire', tone: b.fire === 'mending' ? 'good' : 'calm', blink: false, level: 0, figure: '', line: b.fire === 'mending' ? 'By the fire: mending.' : `By the fire: ${why}.` });
  }
  if (b.gas) {
    const bare = b.gas === 'bare';
    badges.push({ id: 'gas', tone: bare ? 'bad' : 'good', blink: bare, level: 0, figure: '', line: bare ? 'Breathing gas: it is taking your health. Get out, or put on a gas mask.' : 'Contaminated air: your mask is keeping it out.' });
  }
  if (b.ill > 0) badges.push({ id: 'ill', tone: 'bad', blink: false, level: 0, figure: `${Math.ceil(b.ill / 60)}m`, line: `Food poisoning: you will throw up now and then for about ${Math.max(1, Math.ceil(b.ill / 60))} min, and nothing mends. Charcoal tablets end it.` });
  if (b.guard > 0) badges.push({ id: 'guard', tone: 'good', blink: false, level: 0, figure: `${Math.ceil(b.guard / 60)}m`, line: `Vitamins: bad food is half as likely to make you ill, and illness passes twice as fast (${Math.max(1, Math.ceil(b.guard / 60))} min left).` });
  if (b.broken) badges.push({ id: 'leg', tone: 'warn', blink: false, level: 0, figure: '', line: 'Broken leg: no running, no jumping. Splint it, or use a first aid kit.' });
  if (b.bleed > 0) {
    // (how long there is, if nothing is done: a wound that will close before it kills is a warning, one that will not is worse)
    const left = bleedsOutIn(b.blood, b.bleed), level = bleedLevel(b.bleed);
    const time = left === Infinity ? 'it will close by itself, and cost you blood' : left < 60 ? 'under a minute left' : `about ${Math.max(1, Math.round(left / 60))} min left at this rate`;
    badges.push({ id: 'bleed', tone: left === Infinity ? 'warn' : 'bad', blink: left < 60, level, figure: `-${b.bleed.toFixed(1)}`, line: `Bleeding ${['lightly', 'heavily', 'badly'][level - 1]}: ${time}.` });
  }
  return { stats, badges };
}
