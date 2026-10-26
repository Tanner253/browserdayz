// What crafting makes and is made of (2026-10-24, plan-crafting: the owner, "We need some sort of crafting like how rust
// has crafting ... clearly we need crafting"; "clothing could be cut up with a knife or sharp object to make cloth which
// could be combined with rubbing alcohols to make iFAK's"). The recipes are src/sim/craft/recipes.ts, the metals' numbers
// src/sim/craft/materials.ts. Rubbing alcohol, the tin can, scrap and the gun parts are found; the rest is made, smelted
// or salvaged. The models are the owner's downloads and Higgsfield's (progress/base-models/incoming-map.md).

import { PLACED } from '../build/pieces';
import type { ItemDef } from '../items';
import { ARMOURY, ARMY, HOMES, SHEDS } from './rules';
import { PILES } from '../craft/materials';

/** what is only ever made, smelted or salvaged: never found lying about (the plan: 'Found, never made' is the other way round) */
export const MADE_ONLY = [
  'rags', 'rope', 'gunpowder', 'metal_frags', 'iron_bar', 'coal', 'stone_hatchet', 'bone_knife', 'sledgehammer', 'satchel',
  // (what is set down from the hands, and the doors: made at the crafting screen, never found; the sleeping bag is found)
  ...Object.values(PLACED).filter((id) => id !== 'sleeping_bag' && id !== 'torch'),
];

export const CRAFT_ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- made by hand
  // (DayZ's rags: cut from clothes, and bound on a wound they stop the bleeding, slower than a dressing)
  { id: 'rags', name: 'Rags', model: 'rags_bundle', w: 1, h: 1, weight: 0.05, stack: 10, fresh: 4, category: 'medical',
    desc: 'Strips of cloth cut from old clothes. Bound on a wound they stop the bleeding; rope, bandages, splints, torches and bags are made of them.',
    use: { verb: 'Bind a wound with', time: 6, stopBleed: true, sound: 'bandage' },
  },
  { id: 'rope', name: 'Rope', model: 'rope_coil_hemp', w: 2, h: 2, weight: 0.5, category: 'misc',
    desc: 'Rags twisted and plaited into a rope. A sleeping bag is rolled and a satchel charge tied with it.',
    worth: 2,
  },
  // (the plan: "Gunpowder is taken out of rounds: raiding spends the ammunition you would fight with")
  { id: 'gunpowder', name: 'Gunpowder', model: 'gunpowder_tin', w: 1, h: 1, weight: 0.02, stack: 50, fresh: 5, category: 'misc',
    desc: 'Powder pulled out of cartridges, a rifle round giving more than a pistol round. A satchel charge is packed with ten.',
    worth: 1,
  },
  // ---------------------------------------------------------------- found, never made
  // (a bottle is five measures: a bandage takes one, a first aid pouch two. Where medicine and cleaning things are kept)
  { id: 'rubbing_alcohol', name: 'Rubbing Alcohol', model: 'alcohol_bottle', w: 1, h: 2, weight: 0.06, stack: 5, fresh: 5, category: 'medical',
    desc: 'A bottle of surgical spirit, five measures in a full one. Rags cleaned with it make bandages and a first aid pouch.',
    loot: { pair: 'DisinfectantAlcohol', at: [8, 2, 24, 0, 0], restock: 300, usage: ['Medic', 'Hospital', ...HOMES], favour: { Medic: 6, Hospital: 3 }, qty: [0.4, 1] },
    worth: 2,
  },
  { id: 'tin_can', name: 'Tin Can', model: 'can_rusted', w: 1, h: 1, weight: 0.06, category: 'misc',
    desc: 'An empty can, rusted through in places. A satchel charge is packed into one.',
    loot: { pair: 'TacticalBaconCan_Opened', at: [8, 3, 6, 0, 0], restock: 300, usage: [...HOMES, 'Farm', 'Industrial'] },
  },
  // ---------------------------------------------------------------- the metals and the currency (progression v3: Rust's)
  // (scrap: junk found in sheds, works and drums, and out of recyclers; what traders, blueprints and bench levels are paid in)
  { id: 'scrap', name: 'Scrap', model: 'scrap_pile', w: 2, h: 1, weight: PILES.scrap.weight, stack: PILES.scrap.stack, fresh: 20, category: 'misc',
    desc: 'Useful junk: springs, screws, wire, bits of motors. Traders take it as money, and blueprints are learned with it.',
    loot: { pair: 'MetalWire', at: [6, 10, 14, 6, 3], restock: 300, usage: [...SHEDS, ...HOMES], favour: { Industrial: 3, Farm: 1.5 }, qty: [0.01, 0.04] },
    worth: 1,
  },
  { id: 'metal_frags', name: 'Metal Fragments', model: 'metal_frags', w: 1, h: 1, weight: PILES.frags.weight, stack: PILES.frags.stack, fresh: 25, category: 'misc',
    desc: 'Bent and torn bits of steel knocked off wrecks with a hammer, a pickaxe or a sledgehammer. Tools, locks and fittings are made of them; ten smelt into an iron bar at a forge.',
  },
  { id: 'iron_bar', name: 'Iron Bar', model: 'iron_ingots', w: 2, h: 1, weight: PILES.bar.weight, stack: PILES.bar.stack, fresh: 2, category: 'misc',
    desc: 'A bar of iron smelted from fragments at a forge. Guns, sheet metal and the armoured tier are made of it.',
    worth: 3,
  },
  // ---------------------------------------------------------------- gun parts: found, never made (v3: "a crafted gun costs iron bars plus a spring, a pipe and a gun body")
  { id: 'metal_pipe', name: 'Metal Pipe', model: 'metal_pipe', w: 2, h: 1, weight: 0.6, category: 'misc',
    desc: 'A threaded length of steel pipe. A gun barrel is turned from it at a workbench.',
    loot: { pair: 'Pipe', at: [3, 6, 8, 3, 1], restock: 420, usage: [...SHEDS, ...ARMY], favour: { Industrial: 3 } },
    worth: 4,
  },
  { id: 'spring', name: 'Spring', model: 'spring_coil', w: 1, h: 1, weight: 0.1, category: 'misc',
    desc: 'A stiff coil spring out of a machine. The action of a gun is sprung with one.',
    loot: { pair: 'SparkPlug', at: [2, 5, 8, 4, 2], restock: 420, usage: [...SHEDS, ...ARMY], favour: { Industrial: 2, Military: 2 } },
    worth: 4,
  },
  // (the Colt 1911's own frame, its model's base: no slide, no barrel, no magazine; as the scopes are cut from their guns)
  { id: 'gun_body_pistol', name: 'Pistol Body', model: 'colt_1911', nodeRe: '^base$', w: 2, h: 1, weight: 0.4, category: 'misc',
    desc: 'A bare pistol frame: no slide, no barrel, no magazine. At a workbench it is built into a pistol.',
    loot: { pair: 'FNX45', at: [0, 2, 4, 3, 1], restock: 600, usage: ARMY, favour: ARMOURY },
    worth: 10,
  },
  { id: 'gun_body_rifle', name: 'Rifle Body', model: 'gun_body_rifle', w: 4, h: 1, weight: 1.2, category: 'misc',
    desc: 'A bare rifle receiver, never finished. At a workbench it is built into a rifle or a submachine gun.',
    loot: { pair: 'SKS', at: [0, 0, 3, 4, 2], restock: 900, usage: ARMY, favour: ARMOURY },
    worth: 20,
  },
  // (not the charcoal tablets, which end food poisoning: what a forge leaves as its wood burns)
  { id: 'coal', name: 'Charcoal Lumps', model: 'charcoal_lumps', w: 1, h: 1, weight: 0.1, stack: 30, fresh: 4, category: 'misc',
    desc: 'Lumps of charcoal left in a forge by the wood it burned. A building plan is drawn in it on rags.',
  },
  // ---------------------------------------------------------------- tools (each wears: TOOL_LIFE in src/sim/gather.ts)
  { id: 'stone_hatchet', name: 'Stone Hatchet', model: 'stone_axe', w: 1, h: 3, weight: 0.9, category: 'melee',
    desc: 'A sharp stone lashed to a stick. It fells a tree, slowly, and wears out fast: what you start with when you have found nothing.',
    melee: { damage: 32, range: 1.6, rate: 0.85 },
  },
  { id: 'bone_knife', name: 'Bone Knife', model: 'bone_knife', w: 1, h: 2, weight: 0.15, category: 'melee',
    desc: 'A bone split and ground to an edge. It cuts clothes into rags, and a throat, if it must.',
    melee: { damage: 20, range: 1.4, rate: 0.45 },
  },
  // (plan-base-economy, change 4: "Sledgehammer: breaks scrap twice as fast; the slow raid tool")
  { id: 'sledgehammer', name: 'Sledgehammer', model: 'sledgehammer_slim', w: 2, h: 6, weight: 4.5, category: 'melee', slot: 'long',
    desc: 'A heavy hammer swung in both hands. It knocks scrap off a wreck twice as fast as a hammer, and breaks down a wall, slowly.',
    melee: { damage: 70, range: 2.1, rate: 1.35 },
    worth: 6,
  },
  // ---------------------------------------------------------------- raiding (what it does as a charge is base building's raiding step)
  { id: 'satchel', name: 'Satchel Charge', model: 'satchel_charge', w: 2, h: 2, weight: 2, category: 'misc',
    desc: 'A tin of gunpowder in a cloth bag, tied with rope, with a fuse. Made at a workbench: a hundred rounds of powder to blow one door.',
  },
];
