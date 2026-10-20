// The steps of the map. Every place a thing can lie is on one of five, and every sort of thing is kept on the
// steps it belongs to (src/sim/economy.ts): what a new arrival finds at the edge is not what is kept down the
// bunker, and the way from the one to the other is the game. The map says which step each place is, and what
// is to be had there (the menu's map, src/game/game.ts).

export type Tier = 1 | 2 | 3 | 4 | 5;

/**
 * The step a place is marked with on the map: the highest that a tenth of the loot places within `r` of it are on, or
 * null with none there. Worked out, not written beside each place (the owner, 2026-10-18: "balance it so the loot
 * progression from west to east is unnavoidable and unmistakable"): the steps were moved that day and the day before,
 * and the marks written by hand had stayed where they were.
 */
export function tierAround(points: readonly { x: number; z: number; tier?: Tier }[], x: number, z: number, r: number): Tier | null {
  const n = [0, 0, 0, 0, 0, 0];
  let all = 0;
  for (const p of points) if (p.tier && Math.abs(p.x - x) < r && Math.abs(p.z - z) < r && Math.hypot(p.x - x, p.z - z) < r) n[p.tier]++, all++;
  for (let t = 5; t >= 1; t--) if (all && n[t] >= all * 0.1) return t as Tier;
  return null;
}

export const TIERS: Record<Tier, { name: string; colour: string; where: string; finds: string }> = {
  1: { name: 'Tier 1', colour: '#cfc9ba', where: 'The west coast and the desert: Peski, Karavan, Bereg, Mys', finds: 'Melee weapons, flashlights and tools, food and water, bandages, cloth hats, a day pack. No guns.' },
  2: { name: 'Tier 2', colour: '#7fd4a0', where: 'Kalat, Zavod, Pokrov, Blokpost; the valley\'s farms, yards and cabins', finds: 'Pistols, their magazines and their rounds, 9 mm and .45. Soft vests, bandages and stims.' },
  3: { name: 'Tier 3', colour: '#6db3ff', where: 'The pass, Lipki, Mokroye, Ozerki, Zastava; the village, the checkpoints and the army camp; Kamenka\'s houses and hospital', finds: 'Submachine guns, their magazines and 9 mm by the box. Armoured vests, suppressors and sights. The gas masks, at the police stations. The hospital: first aid kits and stims by the shelf. An AK or an AR-15 if you are very lucky, and luckier still if it has a magazine: rifle rounds are few here, and kept east.' },
  4: { name: 'Tier 4', colour: '#c58cff', where: 'The Chemical Works, under the gas; Kamenka\'s army and police places; a helicopter down; a supply drop', finds: 'The AK and the AR-15, sniper rifles and scopes, their magazines and most of their rounds, plate carriers, field rucksacks; and under the gas, the keycards that open the bunker.' },
  5: { name: 'Tier 5', colour: '#ffd35a', where: 'Bunker 17, and the fort Orlinoye on the mountain', finds: 'The best of everything, and plenty of it. The shotgun, the Desert Eagle, heavy armour and the K6-3 helmet, here and nowhere else; the AK\'s drum and the long magazines.' },
};

/** the way up, a step at a time: what each step is gone to for, said to whoever asks what to do next */
export const WAY_UP = [
  'Tier 1, the coast and the desert: something to hit with, a light, food and water.',
  'Tier 2, Kalat, Zavod, Pokrov and the valley\'s farms: a pistol and its rounds.',
  'Tier 3, the pass, the green west and the village: a submachine gun, an armoured vest, and a gas mask from a police station.',
  'Tier 4, the Chemical Works and Kamenka\'s army and police: put the mask on under the gas. A rifle, plates, and a keycard.',
  'Tier 5, Bunker 17 and the fort: the keycard opens the bunker. The best of everything is down there.',
];
