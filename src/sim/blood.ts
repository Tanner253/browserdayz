// Blood, which is not health (2026-10-13). The rules, in one place: the game and the server both go by them.
//
// The user's: "we need to add a new mechanic for blood, that is seprate from health like dayz ... currently a
// player who is bleeding out with low hp dies too fast after a gunfight, dayz solves this by having 2 completeley
// different stats for this." And: "we need blood bags with iv's now to recover blood faster".
//
// Until now a wound took a health a second, off the same hundred a bullet takes its thirty from: whoever came
// out of a fight on thirty had thirty seconds, less the three a bandage takes. Now a hit takes HEALTH and a wound
// takes BLOOD, and they are two things that each kill by themselves.
//
// The figures are DayZ's (dayz.wiki.gg/wiki/Blood and /Bleeding, read 2026-10-13), kept as it counts them, in
// millilitres, so that anybody who knows that game knows this:
//   - five litres, and dead at half of it
//   - a wound bleeds by where it is: six a second from the head or the body, 3.6 from an arm or a leg; and a
//     round takes a hundred as it goes in
//   - wounds add up, each bleeding by itself; left alone a wound closes in five minutes. One in the body, left
//     alone, costs 1800 of the 2500 there are to lose: nobody dies of one wound, and nobody is well after it. Two
//     kill in three minutes and a half, three in a little over two.
//   - the colour goes out of the world below 4500, more of it by 4000 and nearly all by 3500; below 3000 the
//     head swims (there, DayZ lays a player out unconscious. Nobody is laid out here: they cannot run, their
//     breath comes back at half, and the edges of the picture close in.)
//   - it comes back by itself to whoever is fed and watered, slowly; not at all on an empty stomach or a dry
//     mouth, and not while a wound is open. Health mends only on good blood.
//   - a bag of saline gives five hundred, slowly; a bag of blood gives it faster.
// Where this departs from DayZ: it comes back four times as fast by itself (a life here is an evening, not a
// week), a bag holds three times as much, and one dressing closes every wound there is (there, each wound wants
// its own).

export const BLOOD = {
  /** what anybody has, ml */
  full: 5000,
  /** and at this they are dead */
  dead: 2500,
  /** what one wound costs, ml a second, by where it is (src/sim/combat.ts: the zones a hit is told by) */
  wound: { head: 6, torso: 6, arms: 3.6, legs: 3.6 } as Record<string, number>,
  /** and by what made it, when that is not a round: a blade, teeth, something blunt, a blast, a fall */
  cut: 3.6,
  bite: 2.4,
  blunt: 1.2,
  blast: 6,
  fall: 3.6,
  /** all the wounds there are bleed no faster than this together (three in the body) */
  most: 18,
  /** what a round takes as it goes in */
  shot: 100,
  /** seconds a wound left alone goes on bleeding */
  clots: 300,
  /** what comes back, ml a second: fed and watered; one of the two running low; and with either all but gone, none */
  back: [1.2, 0.5] as [number, number],
  /** where the colour begins to go, and where it has all but gone */
  grey: [4500, 3500] as [number, number],
  /** below this the head swims: no running, breath at half */
  faint: 3000,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** how much of what can be lost is left, 0 (dead) to 1 (all of it): what the bar shows */
export const bloodLeft = (blood: number) => clamp((blood - BLOOD.dead) / (BLOOD.full - BLOOD.dead), 0, 1);

/** what somebody's blood is, whatever they said of it (a character kept from before there was any has all of theirs) */
export const bloodOf = (v: { blood?: unknown } | null | undefined) => (typeof v?.blood === 'number' && Number.isFinite(v.blood) ? clamp(v.blood, 0, BLOOD.full) : BLOOD.full);
/** and how fast they are losing it (one kept from before wounds were counted, bleeding: one wound in the body) */
export const bleedOf = (v: { bleed?: unknown; bleeding?: unknown } | null | undefined) => (typeof v?.bleed === 'number' && Number.isFinite(v.bleed) ? clamp(v.bleed, 0, BLOOD.most) : v?.bleeding ? BLOOD.wound.torso : 0);

/**
 * What a new wound bleeds, ml a second.
 * @param by what made it: a round ('shot'), or one of the others
 * @param zone where a round went in
 */
export function woundOf(by: 'shot' | 'cut' | 'bite' | 'blunt' | 'blast' | 'fall', zone = 'torso'): number {
  return by === 'shot' ? (BLOOD.wound[zone] ?? BLOOD.wound.torso) : BLOOD[by];
}

/** the wounds there were, and one more */
export const withWound = (bleed: number, rate: number) => Math.min(BLOOD.most, Math.max(0, bleed) + Math.max(0, rate));

/** what comes back by itself, ml a second: by how fed and how watered (each 0..100), and never with a wound open */
export function bloodBack(energy: number, water: number, bleeding: boolean): number {
  if (bleeding || energy <= 20 || water <= 20) return 0;
  return energy > 60 && water > 60 ? BLOOD.back[0] : BLOOD.back[1];
}

/** how much of the colour is gone from the world, 0 (none) to 1 (all but all) */
export const greyOf = (blood: number) => clamp((BLOOD.grey[0] - blood) / (BLOOD.grey[0] - BLOOD.grey[1]), 0, 1);

/** how fast health mends on this blood, of what it mends at on good blood: all, half, none */
export const mendsOn = (blood: number) => (blood >= BLOOD.grey[0] ? 1 : blood >= BLOOD.grey[1] ? 0.5 : 0);

/** seconds until this much bleeding has taken this much blood down to none, if nothing is done (Infinity: it will close first) */
export function bleedsOutIn(blood: number, bleed: number, bledFor = 0): number {
  if (bleed <= 0) return Infinity;
  const t = (blood - BLOOD.dead) / bleed;
  return t <= BLOOD.clots - bledFor ? Math.max(0, t) : Infinity;
}
