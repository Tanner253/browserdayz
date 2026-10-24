// What a hunt gives, and what keeps a hunter well (2026-10-23, with the animals: src/sim/animals.ts). The owner: "drops
// from animals should be useful", "it will be time to bring in raw food being an issue and we need ways to cook the
// food", "we will also need to add vitimins to the medical places to fight off illness and food poisonings".
//
// Meat is written as what it is worth COOKED (src/sim/cooking.ts says what raw and burned are worth: a quarter, and raw
// as often as not poisons you), and it goes off: raw within forty minutes, cooked within three hours (DayZ). Fat is eaten
// as lard or burned (Rust's fuel); hides, pelts and bones are what clothes, armour and tools will be made of, and until
// then the trader buys them.

import type { ItemDef } from '../items';
import { HOMES, SHEDS } from './rules';

/** a steak of one animal: one model, dyed by what it came off */
const meat = (id: string, name: string, tint: number, energy: number, desc: string, worth: number): ItemDef => ({
  id, name, model: 'meat_steak', tint, w: 1, h: 1, weight: 0.25, category: 'food', desc,
  use: { verb: 'Eat', time: 3, energy, water: 4, sound: 'eat' },
  worth,
});

export const HUNT_ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- meat
  // (a tin of beans is 36: a cooked steak is the best one thing to eat in the game, and a deer is seven of them. One
  // model dyed, and a dye only darkens it: beef bright, venison deep red, wolf dull and brown, bear near black)
  meat('meat_venison', 'Venison Steak', 0x9a3a36, 40, 'Red deer, cut from the haunch. Cook it: raw, it is as likely as not to make you ill.', 2),
  meat('meat_bear', 'Bear Steak', 0x5a3028, 46, 'Dark and fatty. Cook it well.', 3),
  meat('meat_wolf', 'Wolf Steak', 0x9a6a58, 32, 'Lean and stringy. Cook it.', 2),
  meat('meat_beef', 'Beef Steak', 0xffb0a0, 44, 'From a farm cow. Cook it.', 3),

  // ---------------------------------------------------------------- what things will be made of
  {
    id: 'animal_fat', name: 'Animal Fat', model: 'animal_fat', w: 1, h: 1, weight: 0.12, category: 'misc', stack: 10,
    desc: 'Rendered fat. Eaten as lard it is food and thirst; put in a fire it keeps it going three minutes a lump. One day, the fuel lamps, furnaces and charges are made of.',
    use: { verb: 'Eat', time: 2, energy: 20, water: -4, sound: 'eat' },
    worth: 1,
  },
  {
    id: 'bones', name: 'Bones', model: 'bone_pile', w: 1, h: 1, weight: 0.05, category: 'misc', stack: 20,
    desc: 'Clean bones. One day a bone knife, hooks and arrows are made of them. The trader takes them.',
    worth: 1,
  },
  {
    // (no model of its own: a pelt, tanned in colour and the size of a deer's)
    id: 'hide', name: 'Animal Hide', model: 'fur_pelt', tint: 0x9a7a5a, scale: 0.8, w: 2, h: 2, weight: 1.2, category: 'misc',
    desc: 'A raw hide off a deer or a cow. Leather is made of it one day: clothes, bags, armour. The trader takes it.',
    worth: 4,
  },
  {
    id: 'pelt_wolf', name: 'Wolf Pelt', model: 'fur_pelt', tint: 0x8a8a86, scale: 0.65, w: 2, h: 2, weight: 1.0, category: 'misc',
    desc: 'A grey wolf\'s pelt. Warm, and worth something to the trader.',
    worth: 7,
  },
  {
    id: 'pelt_bear', name: 'Bear Pelt', model: 'fur_pelt', tint: 0x5a4030, w: 3, h: 3, weight: 4.0, category: 'misc',
    desc: 'A brown bear\'s pelt, heavy and thick. The best thing the trader buys off a hunter.',
    worth: 16,
  },
  {
    id: 'firewood', name: 'Firewood', model: 'log_pile', scale: 0.12, w: 2, h: 3, weight: 2.0, category: 'tool', stack: 4,
    desc: 'Dry branches, enough for a fire. Use it to build a campfire where you stand, to cook on; used at a fire that is alight, it keeps it going five minutes longer.',
    use: { verb: 'Build a fire with', time: 4, sound: 'bandage' },
    // ("t1": sheds, barns and the hunters' cabins, where wood was kept)
    loot: { pair: 'Firewood', at: [22, 4, 0, 0, 0], restock: 240, usage: [...SHEDS, 'Village'], favour: { Hunting: 3, Farm: 2 } },
    worth: 1,
  },

  // ---------------------------------------------------------------- what keeps a hunter well (DayZ)
  // (not in the gas or the bunker: their places are all taken, and a stim was cut for them)
  {
    id: 'charcoal', name: 'Charcoal Tablets', model: 'pill_box', paint: 0x2b2b2b, w: 1, h: 1, weight: 0.05, category: 'medical', stack: 6, fresh: 3,
    desc: 'Activated charcoal. Ends food poisoning.',
    use: { verb: 'Take', time: 2, cures: true, sound: 'eat' },
    loot: { pair: 'CharcoalTablets', at: [10, 2, 30, 0, 0], lifetime: 3000, restock: 300, usage: ['Medic', 'Hospital', ...HOMES], favour: { Medic: 8, Hospital: 3 } },
    worth: 3, sells: 2,
  },
  {
    id: 'vitamins', name: 'Multivitamins', model: 'pill_box', paint: 0xe0a020, w: 1, h: 1, weight: 0.05, category: 'medical', stack: 5, fresh: 2,
    desc: 'A day\'s vitamins. For twenty minutes after, bad food is half as likely to make you ill, and illness passes twice as fast.',
    use: { verb: 'Take', time: 2, guard: 1200, sound: 'eat' },
    loot: { pair: 'VitaminBottle', at: [8, 2, 26, 0, 0], lifetime: 3000, restock: 300, usage: ['Medic', 'Hospital', ...HOMES], favour: { Medic: 8, Hospital: 3 } },
    worth: 3,
  },
];
