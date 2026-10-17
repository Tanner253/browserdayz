// The steps of the map. Every place a thing can lie is on one of five, and every sort of thing is kept on the
// steps it belongs to (src/sim/economy.ts): what a new arrival finds at the edge is not what is kept down the
// bunker, and the way from the one to the other is the game. The map says which step each place is, and what
// is to be had there (the menu's map, src/game/game.ts).

export type Tier = 1 | 2 | 3 | 4 | 5;

export const TIERS: Record<Tier, { name: string; colour: string; where: string; finds: string }> = {
  1: { name: 'Tier 1', colour: '#cfc9ba', where: 'The outskirts: cabins, farms, yards, ranger posts', finds: 'Melee weapons, flashlights and tools, food and water, bandages, cloth hats, a day pack. No guns.' },
  2: { name: 'Tier 2', colour: '#7fd4a0', where: 'The checkpoints, the army camp, the depot, the market', finds: 'Pistols and their magazines, and every calibre of ammunition where the army was, mostly 9 mm and .45. Soft vests, bandages and stims.' },
  3: { name: 'Tier 3', colour: '#6db3ff', where: 'Kamenka and the village', finds: 'Submachine guns, their magazines and 9 mm by the box. Armoured vests, suppressors and sights. The gas masks, at the police stations. The hospital: first aid kits and stims by the shelf. An AK or an AR-15 if you are very lucky, and luckier still if it has a magazine.' },
  4: { name: 'Tier 4', colour: '#c58cff', where: 'The Chemical Works, under the gas; a helicopter down; a supply drop', finds: 'The AK and the AR-15, sniper rifles and scopes, their magazines and rounds, plate carriers, field rucksacks, and the keycards that open the bunker.' },
  5: { name: 'Tier 5', colour: '#ffd35a', where: 'Bunker 17', finds: 'The best of everything, and plenty of it. The shotgun, the Desert Eagle, heavy armour and the K6-3 helmet, here and nowhere else; the AK\'s drum and the long magazines.' },
};

/** the way up, a step at a time: what each step is gone to for, said to whoever asks what to do next */
export const WAY_UP = [
  'Tier 1, the outskirts: something to hit with, a light, food and water.',
  'Tier 2, the checkpoints and the army camp: a pistol and its rounds.',
  'Tier 3, Kamenka and the village: a submachine gun, an armoured vest, and a gas mask from a police station.',
  'Tier 4, the Chemical Works: put the mask on. A rifle, plates, and a keycard.',
  'Tier 5, Bunker 17: the keycard opens it. The best of everything is down there.',
];
