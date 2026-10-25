// What crafting makes and is made of (2026-10-24, plan-crafting: the owner, "We need some sort of crafting like how rust
// has crafting ... clearly we need crafting"; "clothing could be cut up with a knife or sharp object to make cloth which
// could be combined with rubbing alcohols to make iFAK's"). The recipes are src/sim/craft/recipes.ts. Rubbing alcohol
// and the tin can are found; the rest is made, smelted or salvaged. The models are the owner's downloads, and
// the rags, rope, sledgehammer, satchel, charcoal and gunpowder tin made in Higgsfield (progress/base-models/incoming-map.md).

import type { ItemDef } from '../items';
import { HOMES } from './rules';

/** what is only ever made, smelted or salvaged: never found lying about (the plan: 'Found, never made' is the other way round) */
export const MADE_ONLY = ['rags', 'rope', 'gunpowder', 'scrap', 'iron_bar', 'coal', 'stone_hatchet', 'bone_knife', 'sledgehammer', 'satchel'];

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
  // ---------------------------------------------------------------- smelted and salvaged (the forge and the wrecks: plan-base-economy)
  { id: 'scrap', name: 'Scrap Metal', model: 'scrap_pile', w: 2, h: 1, weight: 0.25, stack: 40, fresh: 5, category: 'misc',
    desc: 'Rusted metal knocked off a wreck with a hammer, a pickaxe or a sledgehammer. Five of it smelt into an iron bar at a forge.',
    worth: 1,
  },
  { id: 'iron_bar', name: 'Iron Bar', model: 'iron_ingots', w: 2, h: 1, weight: 0.5, stack: 20, fresh: 2, category: 'misc',
    desc: 'A bar of iron smelted from scrap. At a workbench it is drawn into nails and rolled into sheet metal, and made into tools.',
    worth: 3,
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
