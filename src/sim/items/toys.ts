// The small wins of 2026-10-31 (the owner: "players want more content they can play with and interact with"): a smoke
// grenade, a flare gun and its rounds, a bear trap and a land mine. What they do is src/sim/traps.ts and, for the two that
// are fired or thrown, the game's own grenades.

import type { ItemDef } from '../items';

export const TOY_ITEMS: ItemDef[] = [
  {
    id: 'smoke_grenade', name: 'Smoke Grenade', model: 'smoke_grenade', w: 1, h: 2, weight: 0.5, category: 'misc',
    desc: 'A steel can of white smoke. Hold the button to pull the pin, let go to throw. Three seconds on it starts to pour, and for three quarters of a minute nobody sees through it. It hurts nobody.',
    use: { verb: 'Throw', time: 0.6, sound: 'bandage' }, throw: { fuse: 3, damage: 0, radius: 0.1 },
    loot: { pair: 'M18SmokeGrenade_White', at: [0, 0, 4, 0, 0], restock: 1200, usage: ['Military', 'Police'] },
    worth: 12, sells: 2,
  },
  {
    id: 'flare_gun', name: 'Flare Gun', model: 'flare_gun', w: 3, h: 2, weight: 0.9, category: 'weapon', slot: 'holster',
    desc: 'A red plastic signal pistol, one round at a time. Fired up, its flare hangs over the ground for half a minute and lights it red, and everybody for kilometres sees where it is.',
    weapon: { kind: 'pistol', ammo: 'ammo_flare', capacity: 1, ergo: 75, action: 'self', launches: 'ammo_flare' }, iconYaw: 0,
    loot: { pair: 'Flaregun', at: [0, 1, 3, 0, 0], restock: 900, usage: ['Military', 'Police', 'Village'], loaded: [0, 1] },
    worth: 20,
  },
  {
    id: 'ammo_flare', name: 'Signal Flares', model: 'flare_round', w: 1, h: 1, weight: 0.08, category: 'ammo', stack: 6,
    desc: 'Red flares for the flare gun. Each burns for half a minute.',
    loot: { pair: 'Ammo_Flare', at: [0, 2, 5, 0, 0], restock: 600, usage: ['Military', 'Police', 'Village'] },
    worth: 3,
  },
  // (the way down's cards, src/sim/sites.ts. The blue one is kept down Bunker 17, and goes out to the desert)
  {
    id: 'card_blue', name: 'Blue Access Card', model: '@card_blue', w: 1, h: 1, weight: 0.02, category: 'misc',
    desc: 'A blue card out of Bunker 17, stamped for a post on a mesa in the desert: Stolovaya. Its reader takes it, once.',
    loot: { pair: 'ShippingContainerKeys_Blue', at: [0, 0, 0, 0, 2], away: [], lifetime: 7200, restock: 600, usage: ['Bunker'] },
  },
  {
    id: 'card_yellow', name: 'Yellow Access Card', model: '@card_yellow', w: 1, h: 1, weight: 0.02, category: 'misc',
    desc: 'A yellow card from the locker at Stolovaya, stamped for a gate in the canyon wall.',
  },
  {
    id: 'bear_trap', name: 'Bear Trap', model: 'bear_trap', w: 2, h: 2, weight: 3.5, category: 'tool',
    desc: 'Toothed steel on a spring. Set on the ground it waits for whoever steps on it, and breaks the leg. Held F takes up one that is set.',
    use: { verb: 'Set', time: 3, sound: 'bandage' },
    loot: { pair: 'TrapBear', at: [0, 2, 4, 0, 0], restock: 900, usage: ['Hunting', 'Farm', 'Industrial'] },
    worth: 18,
  },
  {
    id: 'land_mine', name: 'Land Mine', model: 'land_mine', w: 2, h: 2, weight: 6, category: 'tool',
    desc: 'A steel disc of explosive. Set on the ground it arms itself in eight seconds, and goes off under whoever or whatever comes over it first. Held F takes one up, slowly.',
    use: { verb: 'Set', time: 4, sound: 'bandage' },
    loot: { pair: 'LandMineTrap', at: [0, 0, 0, 0, 1], restock: 1800, usage: ['Military'] },
    worth: 35,
  },
];
