// What a base is built from, and the tools that get it (2026-10-24, base building's first step; the rules of gathering
// are src/sim/gather.ts). Logs come off a tree and are sawn into planks, stone off a boulder; nails and sheet metal are
// found, in the sheds and the industrial places. The owner: "players will need to harvest trees for logs and then saw
// them for planks and harvest nails from industrial areas etc..".
// The models are stand-ins until real ones are downloaded (the owner: "make due with placeholders if needed").

import type { ItemDef } from '../items';
import { SHEDS, IN_SHEDS } from './rules';

export const BUILD_ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- materials
  // (a log is long and heavy: a big pack takes one, otherwise it is carried in the hands, as in DayZ)
  { id: 'log', name: 'Log', model: '@log', w: 2, h: 6, weight: 6, category: 'misc',
    desc: 'A length of trunk, from a tree you felled. Lay it down and saw it into six planks.',
  },
  { id: 'planks', name: 'Planks', model: '@planks', w: 2, h: 4, weight: 0.3, stack: 20, fresh: 8, category: 'misc',
    desc: 'Sawn boards. Every frame of a base is made of them, and a wooden wall is nailed up out of more.',
    // (a few, sawn already, where wood was worked and kept. Each of these is kept off the outskirts, or nearly, whose sheds
    // are full of the tools, the firewood and the lights already, and found inland, where most of the works and yards are.)
    loot: { pair: 'WoodenPlank', at: [0, 4, 5, 0, 0], restock: 300, usage: SHEDS, favour: { Farm: 2, Industrial: 2 }, qty: [0.25, 0.5] },
  },
  { id: 'stone', name: 'Stone', model: 'boulder_01', scale: 0.14, pile: 3, w: 1, h: 2, weight: 0.15, stack: 50, fresh: 15, category: 'misc',
    desc: 'Rough stone broken off a boulder with a pickaxe. A stone wall is built of it.',
  },
  { id: 'nails', name: 'Nails', model: 'cardboard_box_01', scale: 0.3, tint: 0x9a9a9a, w: 1, h: 1, weight: 0.01, stack: 99, fresh: 25, category: 'misc',
    desc: 'A box of nails. Wood and metal are nailed up with a hammer: nothing in a base is built without them.',
    // (DayZ's nails: in sheds and garages, and above all where things were made)
    loot: { pair: 'Nail', at: [2, 10, 14, 0, 0], restock: 240, usage: SHEDS, favour: { Industrial: 3, Farm: 1.5 }, qty: [0.1, 0.4] },
  },
  { id: 'sheet_metal', name: 'Sheet Metal', model: '@sheet', w: 3, h: 4, weight: 2, stack: 5, fresh: 2, category: 'misc',
    desc: 'Corrugated sheet steel. A metal wall or a metal door is made of it, nailed up.',
    loot: { pair: 'MetalPlate', at: [0, 5, 8, 0, 0], restock: 360, usage: ['Industrial', 'Farm', 'Military'], favour: { Industrial: 3 }, qty: [0.2, 0.6] },
  },
  // ---------------------------------------------------------------- tools (each wears out: see TOOL_LIFE in src/sim/gather.ts)
  { id: 'hand_saw', name: 'Hand Saw', model: 'machete', tint: 0xb8c4cc, w: 1, h: 4, weight: 0.6, category: 'melee', desc: 'Saws a log lying on the ground into planks.', melee: { damage: 18, range: 1.6, rate: 0.7 },
    loot: { pair: 'HandSaw', at: [1, 3, 6, 0, 0], restock: 180, usage: SHEDS, favour: { Farm: 2, Industrial: 2 }, on: IN_SHEDS, rack: { any: 1.4 } },
    worth: 4,
  },
  { id: 'felling_axe', name: 'Felling Axe', model: 'hatchet', scale: 3, tint: 0xd8c0a0, w: 2, h: 6, weight: 2.4, category: 'melee', slot: 'long', desc: 'A long axe in both hands: fells a tree in half the blows a hatchet takes, and hits hard.', melee: { damage: 55, range: 2.0, rate: 1.0 },
    loot: { pair: 'WoodAxe', at: [0, 2, 5, 0, 0], restock: 240, usage: SHEDS, favour: { Hunting: 2, Farm: 2 }, on: IN_SHEDS },
    worth: 7,
  },
  // (base building's second step: Rust's two, the owner: "We will need a building hammer and blueprint paper like rust
  // has ... why change something thats not broken". The plan lays frames; the hammer nails them up, and takes them down.)
  { id: 'building_plan', name: 'Building Plan', model: '@plan', w: 1, h: 2, weight: 0.1, category: 'tool',
    desc: 'Blueprint paper. In your hands, it lays the frame of a base: hold the right button for the pieces, the left lays one.',
    // (where things were built and mended: the works, the farms' sheds and the hunters' cabins)
    loot: { pair: 'Paper', at: [1, 5, 8, 0, 0], restock: 240, usage: SHEDS, favour: { Industrial: 2 } },
    worth: 2,
  },
  { id: 'hammer', name: 'Building Hammer', model: 'hatchet', scale: 0.85, tint: 0x8c9299, w: 1, h: 3, weight: 0.7, category: 'melee', desc: 'Nails a frame up to wood, stone or metal, mends what is broken and takes down what is yours. Hold the left button on a piece.', melee: { damage: 30, range: 1.7, rate: 0.6 },
    loot: { pair: 'Hammer', at: [1, 4, 7, 0, 0], restock: 180, usage: SHEDS, favour: { Industrial: 2, Farm: 2 }, on: IN_SHEDS, rack: { any: 1.2 } },
    worth: 4,
  },
  { id: 'pickaxe', name: 'Pickaxe', model: 'crowbar_01', scale: 1.6, tint: 0xc9a77a, w: 2, h: 6, weight: 2.8, category: 'melee', slot: 'long', desc: 'Breaks stone off a boulder. Swung in both hands: slow, and heavy where it lands.', melee: { damage: 50, range: 2.0, rate: 1.05 },
    loot: { pair: 'Pickaxe', at: [0, 2, 5, 0, 0], restock: 240, usage: SHEDS, favour: { Industrial: 3, Farm: 1 }, on: IN_SHEDS },
    worth: 6,
  },
];
