// What a load does to whoever carries it (2026-10-13: "Make sure our weight balance makes sense, perhaps dayz has
// some info on this"). Rules only, in kilograms: nothing here knows of the game, the screen or the world.
//
// As DayZ has it. There, what is carried takes nothing from how fast anybody moves: it takes from their stamina.
// The first six kilograms are free, every kilogram past them takes 1.75 of the hundred there is, and no load takes
// more than ninety-five (in its script: STAMINA_WEIGHT_LIMIT_THRESHOLD 6000 g, STAMINA_KG_TO_STAMINAPERCENT_PENALTY
// 1.75, STAMINA_MIN_CAP 5; and everything counts, worn, slung, pocketed or held). So a loaded man walks and jogs
// wherever a bare one does, and cannot sprint far.
//
// The same two figures here, said the other way about. A breath is the whole bar whatever is carried, and running
// spends it faster: under a load that would leave sixty of DayZ's hundred, a second of sprinting costs 1/0.6 of
// what it costs bare, so a full breath runs 60% as far. (Not a shorter bar, as DayZ draws it, because how much of
// the bar is left is also what the breathing is heard by, what the hands shake by, and what decides whether the
// bar is on the screen at all: with a shorter one a man in plates would pant and shake standing still.) And it
// comes back faster by the same measure, so a loaded man who has run his shorter run is ready to run it again as
// soon as a bare man is ready to run his: which is what DayZ's shorter bar does, being the sooner full.
//
// Two figures are ZONA's own, and both are kinder than DayZ at the heavy end. The user, 2026-10-13, of the first
// figures tried (a fifth at the least, the legs slowed from 52 kg): "i think the sprint skew is too dramatic near
// the top end. a player with no items is so fast they can easily catch up to a person fully geared."
//  - The least a full breath is ever worth is HALF a bare one, not DayZ's twentieth. Nobody who has geared up is
//    run down by a man with nothing merely because he has nothing: the geared man runs half as far, not a fifth.
//  - Only a load far past anything a fighter carries slows the legs: from `slowsFrom`, a hundredth of the pace a
//    kilogram, and never below seven tenths of it. DayZ has no such rule, since its packs hold what they hold.
//    Here a stash case goes into a rucksack with forty-eight places of its own inside it, and without this there
//    would be no end to what one back could carry for nothing.
//
// (Before any of this there was one rule: nothing up to 18 kg, then 1.2% of the pace a kilogram, at a walk and at
// a run alike, down to 55%. A rifleman in plates jogged a tenth slower than a new arrival and sprinted as long.)

export const LOAD = {
  /** kilograms carried for nothing: the clothes stood in, a pistol, a day's food and water */
  free: 6,
  /** what each kilogram past that takes off how far a full breath runs, as a share of it */
  perKg: 0.0175,
  /** and the least of it that is ever left */
  least: 0.5,
  /** the weight from which the legs slow as well: more than a rifleman's whole kit and a second rifle */
  slowsFrom: 60,
  /** what each kilogram past that takes off the pace, as a share of it */
  slows: 0.01,
  /** and the least of that */
  slowest: 0.7,
};

/** the weight at which a breath is worth its least: 34.6 kg as the figures stand */
export const heavy = () => LOAD.free + (1 - LOAD.least) / LOAD.perKg;

/** kilograms past a mark: none under it, and none for a weight that is no number */
const over = (kg: number, from: number) => (kg > from ? kg - from : 0);

/** How far a full breath runs under this load, as a share of how far it runs bare: 1 up to `free`, then less, never under `least`. */
export function breathOf(kg: number): number {
  return Math.max(LOAD.least, 1 - over(kg, LOAD.free) * LOAD.perKg);
}

/** How many times the breath a second of running takes under this load, and how many times as fast it comes back: 1 bare, 2 at the most. */
export function runCost(kg: number): number {
  return 1 / breathOf(kg);
}

/** How much of the pace is left under this load, at any gait: all of it up to `slowsFrom`, then less, never under `slowest`. */
export function paceOf(kg: number): number {
  return Math.max(LOAD.slowest, 1 - over(kg, LOAD.slowsFrom) * LOAD.slows);
}
