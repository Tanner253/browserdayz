// Where the traders stand (the owner, 2026-10-25: "the trader zone must be moved from the red zone on the map away from
// the center of the map because this can be exploited"; then "in fact the traders should be spread out across the map
// (green west and the valley only)"). One stall at each of four spots out of the Zona, in the green west and the valley,
// chosen by progress/crafting/trader-spots.ts: flat ground near a road, off every town, spread as far as they go (the
// valley is all but all Zona: one there). Nothing here imports anything, so that the base rules (src/sim/build/land.ts)
// and the camp (src/sim/camp.ts) may both read it.

/**
 * each trader's spot: which stall, where, and what it is near (to be said on the map); `recycler`, one stands beside it:
 * the green west's and the valley's (the owner: recyclers at "the desert ruins (Kalat), the green west, and the valley")
 */
export const TRADER_SPOTS = [
  { id: 'building', x: -980, z: -40, near: 'the watchtower', recycler: true },
  { id: 'weapons', x: 140, z: 620, near: "the squatters' house", recycler: true },
  { id: 'medical', x: -1620, z: -200, near: 'the hunting tower' },
  { id: 'clothing', x: -1660, z: 220, near: 'the Mokroye road' },
] as const;
/** how far from a spot no base is laid: its safe zone and a margin besides (src/sim/build/land.ts) */
export const CAMP_KEEP = 60;
