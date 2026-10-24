// Food poisoning (2026-10-23, with the animals; DayZ's). The owner: "it will be time to bring in raw food being an
// issue", "we will also need to add vitimins to the medical places to fight off illness and food poisonings".
//
// Raw meat as often as not, and anything rotten every time, makes whoever eats it ill (src/sim/cooking.ts says which,
// `Worth.sick`). Ill, they throw up every half minute or so, losing water and food, and nothing mends of itself, for
// five minutes. Charcoal tablets end it at once (DayZ). Multivitamins for twenty minutes after halve the chance bad food
// makes them ill, and an illness passes twice as fast. Kept on the body (`Vitals.ill`, `Vitals.guard`: seconds left),
// so a death or a reconnect does not cure it.

export const POISON = {
  /** seconds it lasts, unguarded */
  lasts: 300,
  /** seconds between bouts of throwing up, the least and the most */
  every: [22, 38] as [number, number],
  /** what a bout costs */
  water: 7,
  energy: 5,
};

export const GUARD = {
  /** what the chance of falling ill is multiplied by, guarded */
  chance: 0.5,
  /** how many times faster an illness passes, guarded */
  pace: 2,
};

/** Does eating this make them ill? `chance` is the food's (`mealOf(...).sick`), `roll` a random number in [0, 1). */
export const fallsIll = (chance: number | undefined, guarded: boolean, roll: number) => !!chance && roll < chance * (guarded ? GUARD.chance : 1);

/**
 * An illness and a guard as time goes by: what is left of each after `dt` seconds, and how many bouts of throwing up
 * fall in that time (`bout` counts down to the next).
 */
export function illFor(v: { ill?: number; guard?: number }, bout: number, dt: number, roll: () => number): { ill: number; guard: number; bout: number; bouts: number } {
  const guard = Math.max(0, (v.guard ?? 0) - dt);
  let ill = v.ill ?? 0, bouts = 0;
  if (ill > 0) {
    ill = Math.max(0, ill - dt * ((v.guard ?? 0) > 0 ? GUARD.pace : 1));
    bout -= dt;
    while (bout <= 0 && ill > 0) {
      bouts++;
      bout += POISON.every[0] + roll() * (POISON.every[1] - POISON.every[0]);
    }
  }
  return { ill, guard, bout: ill > 0 ? bout : POISON.every[0], bouts };
}
