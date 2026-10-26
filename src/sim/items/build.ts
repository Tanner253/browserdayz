// What a base is built from, and the tools that get it (2026-10-24, base building's first step; the rules of gathering
// are src/sim/gather.ts). Logs come off a tree and are sawn into planks, stone off a boulder; nails and sheet metal are
// found, in the sheds and the industrial places. The owner: "players will need to harvest trees for logs and then saw
// them for planks and harvest nails from industrial areas etc..".
// The models are stand-ins until real ones are downloaded (the owner: "make due with placeholders if needed").

import type { ItemDef } from '../items';
import { HOMES, SHEDS, IN_SHEDS } from './rules';

/**
 * A broken box's things, in one bag where it stood, gone through where it lies and never picked up: gone itself once it
 * is emptied, or this long after (ms), near anybody or not (the owner, 2026-10-25: "if it has loot and is a container
 * then it drops as a bag on the ground but it despawns like loot dropped on the ground within 10 mins ... defer to
 * rust"). As big inside as the biggest store, the large box's, so each thing keeps its place.
 */
export const LOOT_BAG = { id: 'loot_bag', life: 10 * 60_000 };

export const BUILD_ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- materials
  // (a log is long and heavy: a big pack takes one, otherwise it is carried in the hands, as in DayZ)
  { id: 'log', name: 'Log', model: 'log', w: 2, h: 6, weight: 6, category: 'misc',
    desc: 'A length of trunk, from a tree you felled. Lay it down and saw it into six planks.',
  },
  { id: 'planks', name: 'Planks', model: 'planks', w: 2, h: 4, weight: 0.3, stack: 20, fresh: 8, category: 'misc',
    desc: 'Sawn boards. Every frame of a base is made of them, and a wooden wall is nailed up out of more.',
    // (a few, sawn already, where wood was worked and kept. Each of these is kept off the outskirts, or nearly, whose sheds
    // are full of the tools, the firewood and the lights already, and found inland, where most of the works and yards are.)
    loot: { pair: 'WoodenPlank', at: [0, 4, 5, 0, 0], restock: 300, usage: SHEDS, favour: { Farm: 2, Industrial: 2 }, qty: [0.25, 0.5] },
  },
  { id: 'stone', name: 'Stone', model: 'stone', pile: 3, w: 1, h: 2, weight: 0.15, stack: 50, fresh: 15, category: 'misc',
    desc: 'Rough stone broken off a boulder with a pickaxe. A stone wall is built of it.',
  },
  { id: 'nails', name: 'Nails', model: 'nails', w: 1, h: 1, weight: 0.01, stack: 99, fresh: 25, category: 'misc',
    desc: 'A box of nails. Wood and metal are nailed up with a hammer: nothing in a base is built without them.',
    // (DayZ's nails: in sheds and garages, and above all where things were made)
    loot: { pair: 'Nail', at: [2, 10, 14, 0, 0], restock: 240, usage: SHEDS, favour: { Industrial: 3, Farm: 1.5 }, qty: [0.1, 0.4] },
  },
  { id: 'sheet_metal', name: 'Sheet Metal', model: 'sheet_metal', w: 3, h: 4, weight: 2, stack: 5, fresh: 2, category: 'misc',
    desc: 'Corrugated sheet steel. A metal wall or a metal door is made of it, nailed up.',
    loot: { pair: 'MetalPlate', at: [0, 5, 8, 0, 0], restock: 360, usage: ['Industrial', 'Farm', 'Military'], favour: { Industrial: 3 }, qty: [0.2, 0.6] },
  },
  // (the progression plan, the owner's yes 2026-10-25: two parts only ever looted, "the highest tier upgrades to base should
  // be quite grindy and also shoudl require th euser to loot". Hardware goes into every metal door, hatch and gate and a
  // level II workbench; steel plate into the armoured tier, its doors and a level III workbench.)
  { id: 'hardware', name: 'Hardware', model: 'hardware', w: 1, h: 1, weight: 0.6, stack: 5, category: 'misc',
    desc: 'A tin of hinges, bolts and screws. Every metal door, hatch and gate takes one; a workbench is brought up to level II with two.',
    loot: { pair: 'Hinges', at: [0, 2, 3, 1, 0], restock: 600, usage: [...SHEDS, 'Industrial'], favour: { Industrial: 3, Farm: 1.5 } },
    worth: 6,
  },
  { id: 'steel_plate', name: 'Steel Plate', model: 'steel_plate', w: 2, h: 3, weight: 4, stack: 2, category: 'misc',
    desc: 'A plate of armour steel, cut square. The armoured tier is made of it, and its doors, and a level III workbench.',
    loot: { pair: 'MetalPlate', at: [0, 0, 1, 3, 4], restock: 1800, usage: ['Military'] },
    worth: 25,
  },
  // ---------------------------------------------------------------- tools (each wears out: see TOOL_LIFE in src/sim/gather.ts)
  { id: 'hand_saw', name: 'Hand Saw', model: 'hand_saw', w: 1, h: 4, weight: 0.6, category: 'melee', desc: 'Saws a log lying on the ground into planks.', melee: { damage: 18, range: 1.6, rate: 0.7 },
    loot: { pair: 'HandSaw', at: [1, 3, 6, 0, 0], restock: 180, usage: SHEDS, favour: { Farm: 2, Industrial: 2 }, on: IN_SHEDS, rack: { any: 1.4 } },
    worth: 4,
  },
  { id: 'felling_axe', name: 'Felling Axe', model: 'felling_axe', w: 2, h: 6, weight: 2.4, category: 'melee', slot: 'long', desc: 'A long axe in both hands: fells a tree in half the blows a hatchet takes, and hits hard.', melee: { damage: 55, range: 2.0, rate: 1.0 },
    loot: { pair: 'WoodAxe', at: [0, 2, 5, 0, 0], restock: 240, usage: SHEDS, favour: { Hunting: 2, Farm: 2 }, on: IN_SHEDS },
    worth: 7,
  },
  // (base building's second step: Rust's two, the owner: "We will need a building hammer and blueprint paper like rust
  // has ... why change something thats not broken". The plan lays frames; the hammer nails them up, and takes them down.)
  { id: 'building_plan', name: 'Building Plan', model: 'building_plan', w: 1, h: 2, weight: 0.1, category: 'tool',
    desc: 'A clipboard of plans. In your hands, it lays the frame of a base: hold the right button for the pieces, the left lays one.',
    // (where things were built and mended: the works, the farms' sheds and the hunters' cabins)
    loot: { pair: 'Paper', at: [1, 5, 8, 0, 0], restock: 240, usage: SHEDS, favour: { Industrial: 2 } },
    worth: 2,
  },
  { id: 'hammer', name: 'Building Hammer', model: 'hammer', w: 1, h: 3, weight: 0.7, category: 'melee', desc: 'Nails a frame up to wood, stone or metal, mends what is broken and takes down what is yours. Hold the left button on a piece.', melee: { damage: 30, range: 1.7, rate: 0.6 },
    loot: { pair: 'Hammer', at: [1, 4, 7, 0, 0], restock: 180, usage: SHEDS, favour: { Industrial: 2, Farm: 2 }, on: IN_SHEDS, rack: { any: 1.2 } },
    worth: 4,
  },
  // (base building's fourth step, the owner: "keycode keylocks". Plan v2: a code lock in the police's, the works' and the
  // army's places, rare; the key lock in sheds and houses)
  { id: 'code_lock', name: 'Code Lock', model: 'code_lock', w: 1, h: 1, weight: 0.4, category: 'tool',
    desc: 'A keypad lock. In your hands, the left button fits it to a door, a gate, a hatch, a box or a claim you may build at, on a four-figure code you choose. Whoever enters the code may open it; a wrong code shocks.',
    // (found rarely, and made at a level II bench: src/sim/craft/recipes.ts)
    loot: { pair: 'CodeLock', at: [0, 0, 1, 0, 0], restock: 900, usage: ['Police', 'Industrial', 'Military'], favour: { Police: 2 } },
    worth: 8,
  },
  { id: 'key_lock', name: 'Key Lock', model: 'key_lock', w: 1, h: 1, weight: 0.3, category: 'tool',
    desc: 'A lock and its key. In your hands, the left button fits it to a door, a gate, a hatch, a box or a claim you may build at, and gives you its key. Whoever carries a key to it may open it; more keys are cut at it from a plank.',
    loot: { pair: 'CombinationLock', at: [1, 3, 3, 0, 0], restock: 480, usage: [...SHEDS, ...HOMES], favour: { Farm: 1.5 } },
    worth: 4,
  },
  // (set down from the hands on a floor of a base, as Rust's: src/sim/build/pieces.ts PLACED; made by hand from what each
  // cost to lay, the research table at a workbench)
  { id: 'box_small', name: 'Small Box', model: 'bb_small_box', w: 3, h: 2, weight: 4, category: 'misc',
    desc: 'A small wooden box to keep things in. Hold it and left-click on a floor of your base to set it down; R turns it.' },
  { id: 'box_large', name: 'Large Box', model: 'bb_large_box', w: 4, h: 3, weight: 8, category: 'misc',
    desc: 'A large wooden box to keep things in. Hold it and left-click on a floor of your base to set it down; R turns it.' },
  { id: 'workbench', name: 'Workbench', model: 'bb_workbench', w: 4, h: 3, weight: 12, category: 'misc',
    desc: 'A workbench, to make what cannot be made by hand. Hold it and left-click on a floor of your base to set it down; nail it up with the hammer to levels II and III.' },
  { id: 'forge', name: 'Forge', model: 'forge_hf', w: 4, h: 4, weight: 15, category: 'misc',
    desc: 'A forge, to smelt metal fragments into iron bars. Hold it and left-click on a floor of your base to set it down.' },
  { id: 'bed', name: 'Bed', model: 'bb_bed', w: 5, h: 3, weight: 10, category: 'misc',
    desc: 'A bed of planks. Set down on a floor of a base whose claim you are on, you wake at it after a death, every five minutes at most.' },
  { id: 'research_table', name: 'Research Table', model: 'research_table', w: 4, h: 3, weight: 10, category: 'misc',
    desc: 'A research table: a found thing put in with scrap teaches you to make it. Set it down beside a workbench.' },
  // (what hangs in a doorway, a hatch hole or a high wall, made at the crafting screen: src/sim/build/pieces.ts PLACED)
  { id: 'door_wood', name: 'Wooden Door', model: 'bb_door_wood', w: 3, h: 5, weight: 8, category: 'misc',
    desc: 'Hold it and aim at a doorway of your base: the left button hangs it there; R turns which way it swings. A lock goes on it after.' },
  { id: 'door_metal', name: 'Metal Door', model: 'bb_door_metal', w: 3, h: 5, weight: 14, category: 'misc',
    desc: 'Hold it and aim at a doorway of your base: the left button hangs it there; R turns which way it swings. A lock goes on it after.' },
  { id: 'double_door_wood', name: 'Wooden Double Door', model: 'bb_door_wood', w: 4, h: 5, weight: 14, category: 'misc',
    desc: 'Hold it and aim at a doorway of your base: the left button hangs it there; R turns which way it swings. A lock goes on it after.' },
  { id: 'double_door_metal', name: 'Metal Double Door', model: 'bb_door_metal', w: 4, h: 5, weight: 24, category: 'misc',
    desc: 'Hold it and aim at a doorway of your base: the left button hangs it there; R turns which way it swings. A lock goes on it after.' },
  { id: 'garage_door', name: 'Garage Door', model: 'bb_garage', w: 5, h: 5, weight: 26, category: 'misc',
    desc: 'Hold it and aim at a doorway of your base: the left button hangs it there; R turns which way it swings. A lock goes on it after.' },
  { id: 'hatch', name: 'Ladder Hatch', model: 'bb_hatch', w: 4, h: 4, weight: 12, category: 'misc',
    desc: 'Hold it and aim at a hatch hole of your base: the left button hangs it there; R turns which way it swings. A lock goes on it after.' },
  { id: 'gate_wood', name: 'High Wood Gate', model: 'bb_gate_wood', w: 5, h: 6, weight: 30, category: 'misc',
    desc: 'Hold it and aim at a high wall of your base: the left button hangs it there; R turns which way it swings. A lock goes on it after.' },
  { id: 'gate_stone', name: 'High Stone Gate', model: 'bb_gate_steel', w: 5, h: 6, weight: 40, category: 'misc',
    desc: 'Hold it and aim at a high wall of your base: the left button hangs it there; R turns which way it swings. A lock goes on it after.' },
  { id: 'door_armoured', name: 'Armoured Door', model: 'bb_door_metal', w: 3, h: 5, weight: 20, category: 'misc',
    desc: 'Hold it and aim at a doorway of your base: the left button hangs it there; R turns which way it swings. A lock goes on it after.' },
  { id: 'garage_door_armoured', name: 'Armoured Garage Door', model: 'bb_garage', w: 5, h: 5, weight: 34, category: 'misc',
    desc: 'Hold it and aim at a doorway of your base: the left button hangs it there; R turns which way it swings. A lock goes on it after.' },
  // (found where people camped and hunted: the owner's "bedroll", set down in a base whose claim you are on)
  { id: 'sleeping_bag', name: 'Sleeping Bag', model: 'sleeping_bag', w: 3, h: 2, weight: 1.8, category: 'misc',
    desc: 'A rolled sleeping bag. Held and set down on a floor of a base whose claim you are on, you wake at it after a death, every ten minutes at most; on a bed of planks, every five.',
    loot: { pair: 'SleepingBag', at: [2, 3, 2, 0, 0], restock: 600, usage: ['Hunting', 'Village'], favour: { Hunting: 3 } },
    worth: 3,
  },
  { id: 'loot_bag', name: 'Loot Bag', model: 'trashbag', w: 2, h: 3, weight: 0.3, category: 'stash', scale: 0.7, stash: [10, 8],
    desc: 'What was in a box when it was broken. Go through it where it lies: it is gone once emptied, or ten minutes on.' },
  // (the owner, 2026-10-24: "found around, (tier 1 flashlight reuse the fire from campfire and cars put it on a stick boom
  // you have a torch)": lit with L in the hands, or set on a wall with the building plan)
  { id: 'torch', name: 'Torch', model: 'torch', w: 1, h: 4, weight: 0.5, category: 'tool',
    desc: 'A stick with a rag-wrapped head soaked in fuel. In your hands, L lights it: a flame and a warm light all round, as far as a campfire throws one. Set on a wall with the building plan, it burns there.',
    loot: { pair: 'LongTorch', at: [3, 4, 2, 0, 0], restock: 420, usage: [...HOMES, ...SHEDS], favour: { Hunting: 2, Farm: 1.5 } },
    worth: 2,
  },
  // (raiding, base building's fifth step: the navigator, "C4 as loot". Plan v2: "explosive loot rare; crafted later". Found
  // only where the army was, and seldom; crafting's satchel charge is the cheaper way through a door: src/sim/build/raid.ts)
  { id: 'c4', name: 'C4 Charge', model: 'c4', w: 1, h: 2, weight: 1.2, category: 'tool',
    desc: 'Three blocks of plastic explosive taped to a timer. In your hands, the left button sticks it to a wall, a door or a floor within reach: ten seconds later it goes off. One takes a wooden wall, two a stone one, four a metal one.',
    // (held back for now, src/sim/build/raid.ts HELD_BACK: none found. When raiding opens, at [0, 0, 0, 1, 2])
    loot: { pair: 'PlasticExplosive', at: [0, 0, 0, 0, 0], restock: 3600, usage: ['Military'] },
    worth: 40,
  },
  { id: 'key', name: 'Key', model: 'key', w: 1, h: 1, weight: 0.02, category: 'misc',
    desc: 'A key to one key lock. Carried, it opens that lock: lose it, and so does whoever finds it.',
  },
  { id: 'pickaxe', name: 'Pickaxe', model: 'pickaxe', w: 2, h: 6, weight: 2.8, category: 'melee', slot: 'long', desc: 'Breaks stone off a boulder. Swung in both hands: slow, and heavy where it lands.', melee: { damage: 50, range: 2.0, rate: 1.05 },
    loot: { pair: 'Pickaxe', at: [0, 2, 5, 0, 0], restock: 240, usage: SHEDS, favour: { Industrial: 3, Farm: 1 }, on: IN_SHEDS },
    worth: 6,
  },
];
