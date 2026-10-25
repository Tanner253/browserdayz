// What is worn and carried. Each item says everything about itself: what it is, where and how much of it is found (`loot`, on
// DayZ's Central Economy: see rules.ts) and what the trader gives for it. Adding a thing is one entry here.

import type { ItemDef } from '../items';
import { HOMES, SHEDS, ARMY } from './rules';

export const WEAR_ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- clothing & bags
  // The jacket and the trousers every survivor stands in (2026-10-13: "we should make the jacket and pants the user
  // spawns in with (the default inventory slots) clothing items"). They were two grids of the body's own, and could
  // not be taken off; they are things now, worn in `top` and `legs`. Their pockets were the size those grids were
  // (4x4 and 4x3) and are bigger since (see GRIDS below): never smaller either way, so that nothing anybody carried
  // in them has to move. Taken off, dropped or left on a body, each keeps what is in its pockets. (On the ground and in a
  // pocket each is still the hospital's folded blanket, dyed; worn, it is drawn as it is: see `dress`.)
  //
  // GRIDS. How much each thing that is worn holds (2026-10-13: "i think we need to expand every equipable item with
  // an inventory (lik ebackpacks and jackets) with more rows and colluns for example the largest backpack should b e
  // able to hold 2 large primary weapons minimum to set the top end of the limit, look up how many inventory slots
  // each dayz backpack has"). DayZ's own, from its wiki's Clothing page (the tables of game version 1.29.163451):
  //   packs     Field / Long Haul 8x8 (64) the most · Tactical 8x7, Combat and Mountain 7x8 (56) · Hunter 7x6,
  //             Drybag and Leather 6x7 (42) · Assault 6x6 (36) · Hiking 6x5 (30) · Canvas, Duffel 5x5 (25) · School
  //             6x4 (24) · Sling 4x5 (20)
  //   tops      OMK Jacket 6x5 (30) the most · Field, Patrol, Hunter, BDU jackets 6x4 (24) · police, suit 5x4 (20)
  //             · hoodie 5x3 (15) · shirts 3x3 (9)
  //   legs      cargo, BDU, hunter, patrol pants 5x4 (20) the most · combat 5x3 (15) · jeans 4x3 (12)
  //   vests     Field and Tactical Vest 5x4 (20) the most · Assault, Ballistic, Hunter 4x4 (16) · a Plate Carrier
  //             holds nothing itself, and 15 with its pouches on
  // Ours, as they were and as they are. No class of thing holds more than DayZ's most of that class; each is where
  // its like stands on DayZ's ladder, as near as a grid that grew BOTH ways allows; and none is smaller either way
  // than it was, so that what was kept in one lies where it lay:
  //   Field Rucksack    7x6 (42) -> 9x7 (63)   the biggest: two AKs (8x3 each) with a column and a row over, or
  //                                            three Mosins (9x2) and a row; DayZ's biggest is 64
  //   Camping Backpack  6x5 (30) -> 7x6 (42)   DayZ's middle packs (Hunter, Drybag); an AR-15 lies in it, an AK does not
  //   Day Pack          4x4 (16) -> 5x5 (25)   DayZ's small bags (Canvas 25, School 24)
  //   Field Jacket      4x4 (16) -> 5x5 (25)   DayZ's Field Jacket is 24
  //   Field Trousers    4x3 (12) -> 5x4 (20)   DayZ's cargo and BDU pants
  //   Plate Carrier     4x3 (12) -> 5x4 (20)   the vest that carries most, as DayZ's Field and Tactical Vests
  //   Chest Rig         4x2 (8)  -> 5x3 (15)   DayZ's Assault Vest is 16
  //   Armoured Vest     3x2 (6)  -> 4x3 (12)   DayZ's Ballistic Vest is 16
  //   Heavy Armour      3x2 (6)  -> 4x3 (12)
  //   Soft Armour Vest  2x2 (4)  -> 3x3 (9)
  // Weights are as they were: what a load costs is its weight (src/sim/load.ts), as in DayZ, and a pack full of
  // rifles is paid for in breath. What is not worn is not part of this: the cases, the body, an admin's hold.
  // (test/inventory.test.ts holds the old sizes, and lays an inventory kept under them thing for thing.)
  // The clothes (the owner, 2026-10-24: "i like the clothes they have on. but i want to make them items to be looted on
  // the ground like dayz has tiers of clothing items that provide warmth etc and bigger storage etc.. and durability
  // color etc... camoflaughe is nice obviously"). Each is drawn on the body as it is worn (`dress`: scripts/wear.mjs),
  // in any of its colours, and is found where its kind is: the basics in houses on the coast, work clothes in the
  // farms and yards, hunting clothes in the cabins, the army's in the army's places, and the gorka and the ghillie suit,
  // rare, in the army's places of the third step. None lies under the gas or down the bunker: every place there is
  // spoken for, and a jacket there was a sniper rifle fewer (test/loot.test.ts). Pockets on DayZ's ladder (see GRIDS above). No warmth yet (the owner,
  // 2026-10-25: "dont worry about temperature for now").
  {
    // (the M65: the army's field jacket; still `field_jacket`, which everybody wore until 2026-10-25 and many still do)
    id: 'field_jacket', name: 'Field Jacket', model: 'folded_blanket', tint: 0x4b5235, scale: 1.1, w: 3, h: 3, weight: 1.3, category: 'clothing', slot: 'top',
    desc: 'An M65 army field jacket: stand collar, four flapped pockets, drawstring waist. 25 slots in its pockets. Take it off and what is in them goes with it.', wear: { cargo: [5, 5] },
    dress: { model: 'm65', hides: ['chest', 'belly', 'shoulder', 'upperArm', 'forearm'], shrinks: ['hips'] },
    colours: [{ name: 'Olive', tint: 0x4b5235 }, { name: 'Black', tint: 0x26282a }, { name: 'Woodland', camo: 'woodland' }, { name: 'Autumn', camo: 'autumn' }],
    loot: { pair: 'M65Jacket_Olive', at: [0, 0, 8, 0, 0], restock: 900, usage: ARMY, favour: { Military: 2 } },
    worth: 10,
  },
  {
    id: 'field_trousers', name: 'Field Trousers', model: 'folded_blanket', tint: 0x5b5d3e, scale: 0.85, w: 3, h: 2, weight: 0.8, category: 'clothing', slot: 'legs',
    desc: 'Army field trousers with thigh pockets and knee pads strapped on. 20 slots in their pockets, and the pads take a tenth off a fall.', wear: { cargo: [5, 4], fall: 0.9 },
    dress: { model: 'field_pants', hides: ['hips', 'thigh', 'aboveKnee', 'shin'] },
    colours: [{ name: 'Olive', tint: 0x4b5235 }, { name: 'Black', tint: 0x26282a }, { name: 'Woodland', camo: 'woodland' }, { name: 'Autumn', camo: 'autumn' }],
    loot: { pair: 'BDUPants', at: [0, 0, 8, 0, 0], restock: 900, usage: ARMY, favour: { Military: 2 } },
    worth: 8,
  },
  // ---- the basics, that every new survivor wakes in (CLOTHES), and that any house has (DayZ's own spawn: a T-shirt, a
  // tracksuit and trainers; the owner, 2026-10-25: "we should do dayz styled basics")
  {
    id: 'tshirt', name: 'T-Shirt', model: 'folded_blanket', tint: 0xe8e4da, scale: 0.7, w: 3, h: 2, weight: 0.2, category: 'clothing', slot: 'top',
    desc: 'A cotton T-shirt. 6 slots in it, and it keeps nothing out.', wear: { cargo: [3, 2] },
    dress: { model: 'tshirt', hides: ['chest', 'belly', 'shoulder'], shrinks: ['hips', 'upperArm'] },
    colours: [{ name: 'White' }, { name: 'Grey', tint: 0x8d8e8a }, { name: 'Black', tint: 0x2a2a2a }, { name: 'Olive', tint: 0x556040 }, { name: 'Red', tint: 0x8e2a24 }, { name: 'Navy', tint: 0x23304f }],
    loot: { pair: 'TShirt_White', at: [6, 4, 4, 0, 0], restock: 600, usage: [...HOMES, 'Shop'] },
    worth: 1,
  },
  {
    id: 'tracksuit_pants', name: 'Tracksuit Trousers', model: 'folded_blanket', tint: 0x23304f, scale: 0.7, w: 3, h: 2, weight: 0.4, category: 'clothing', slot: 'legs',
    desc: 'Thin polyester tracksuit trousers. 6 slots in their pockets.', wear: { cargo: [3, 2] },
    dress: { model: 'tracksuit_pants', hides: ['hips', 'thigh', 'aboveKnee', 'shin'] },
    colours: [{ name: 'Navy' }, { name: 'Black', tint: 0x26262a }, { name: 'Grey', tint: 0x7a7c80 }, { name: 'Red', tint: 0x8a2626 }],
    loot: { pair: 'TrackSuitPants_Blue', at: [4, 3, 3, 0, 0], restock: 600, usage: [...HOMES, 'Shop'] },
    worth: 1,
  },
  {
    id: 'trainers', name: 'Trainers', model: 'combat_boots', tint: 0xd8d8d2, w: 2, h: 2, weight: 0.6, category: 'clothing', slot: 'feet',
    desc: 'Cheap running shoes. Better than bare feet, and that is all.', wear: {},
    dress: { model: 'trainers', hides: ['foot'] },
    colours: [{ name: 'White' }, { name: 'Grey', tint: 0x7d7f80 }, { name: 'Black', tint: 0x2a2a2c }],
    loot: { pair: 'AthleticShoes_Grey', at: [4, 3, 3, 0, 0], restock: 600, usage: [...HOMES, 'Shop'] },
    worth: 1,
  },
  // ---- the towns and the houses
  {
    id: 'flannel_shirt', name: 'Flannel Shirt', model: 'folded_blanket', tint: 0x8e2a24, scale: 0.75, w: 3, h: 2, weight: 0.3, category: 'clothing', slot: 'top',
    desc: 'A checked flannel shirt. 9 slots in its pockets.', wear: { cargo: [3, 3] },
    dress: { model: 'flannel', hides: ['chest', 'belly', 'shoulder', 'upperArm', 'forearm'], shrinks: ['hips'] },
    colours: [{ name: 'Red check' }, { name: 'Blue check', tint: 0x3a5a94 }, { name: 'Green check', tint: 0x3d6b3d }],
    loot: { pair: 'Shirt_RedCheck', at: [3, 3, 4, 0, 0], restock: 600, usage: [...HOMES, 'Farm'] },
    worth: 2,
  },
  {
    id: 'hoodie', name: 'Hoodie', model: 'folded_blanket', tint: 0x8d8e8a, scale: 0.85, w: 3, h: 3, weight: 0.6, category: 'clothing', slot: 'top',
    desc: 'A cotton pullover hoodie. 15 slots in its pocket and sleeves.', wear: { cargo: [5, 3] },
    dress: { model: 'hoodie', hides: ['chest', 'belly', 'shoulder', 'upperArm', 'forearm'], shrinks: ['hips'] },
    // (and in the two camouflages of the mountain, as Sumrak's Namalsk has them: found where the army is)
    colours: [{ name: 'Grey' }, { name: 'Black', tint: 0x262626 }, { name: 'Green', tint: 0x3d5a3a }, { name: 'Red', tint: 0x7e2a24 }, { name: 'Snow', camo: 'snow' }, { name: 'Forest', camo: 'forest' }],
    loot: { pair: 'Hoodie_Grey', at: [3, 3, 4, 0, 0], restock: 600, usage: [...HOMES, 'Shop'] },
    worth: 3,
  },
  {
    id: 'jeans', name: 'Jeans', model: 'folded_blanket', tint: 0x3e5d86, scale: 0.8, w: 3, h: 2, weight: 0.7, category: 'clothing', slot: 'legs',
    desc: 'Denim jeans. 6 slots in their pockets.', wear: { cargo: [3, 2] },
    dress: { model: 'jeans', hides: ['hips', 'thigh', 'aboveKnee', 'shin'] },
    colours: [{ name: 'Blue' }, { name: 'Black', tint: 0x2a2b2e }, { name: 'Grey', tint: 0x6e7073 }],
    loot: { pair: 'Jeans_Blue', at: [3, 3, 4, 0, 0], restock: 600, usage: [...HOMES, 'Shop'] },
    worth: 2,
  },
  {
    id: 'leather_jacket', name: 'Leather Jacket', model: 'folded_blanket', tint: 0x5a3e2a, scale: 1.0, w: 3, h: 3, weight: 1.8, category: 'clothing', slot: 'top',
    desc: 'A heavy leather jacket. 16 slots in its pockets, and the hide takes the edge off a hit to the body: five in a hundred less.', wear: { cargo: [4, 4], armor: 0.95 },
    dress: { model: 'leather_jacket', hides: ['chest', 'belly', 'shoulder', 'upperArm', 'forearm'], shrinks: ['hips'] },
    colours: [{ name: 'Brown' }, { name: 'Black', tint: 0x1f1d1c }],
    loot: { pair: 'LeatherJacket_Natural', at: [0, 3, 4, 0, 0], restock: 900, usage: ['Town'] },
    worth: 6,
  },
  // ---- the farms, the works and the depots
  {
    id: 'quilted_jacket', name: 'Quilted Jacket', model: 'folded_blanket', tint: 0x3a3b3c, scale: 1.0, w: 3, h: 3, weight: 1.6, category: 'clothing', slot: 'top',
    desc: 'A telogreika: the quilted cotton jacket of every Soviet workman. 16 slots in its pockets.', wear: { cargo: [4, 4] },
    dress: { model: 'telogreika', hides: ['chest', 'belly', 'shoulder', 'upperArm', 'forearm'], shrinks: ['hips'] },
    colours: [{ name: 'Charcoal' }, { name: 'Grey', tint: 0x6b6c6a }, { name: 'Navy', tint: 0x26304a }, { name: 'Olive', tint: 0x4b5235 }],
    loot: { pair: 'QuiltedJacket_Black', at: [1, 4, 6, 0, 0], restock: 900, usage: [...SHEDS, 'Village'] },
    worth: 4,
  },
  {
    id: 'work_trousers', name: 'Work Trousers', model: 'folded_blanket', tint: 0x4a3626, scale: 0.8, w: 3, h: 2, weight: 0.8, category: 'clothing', slot: 'legs',
    desc: 'Heavy cotton work trousers. 12 slots in their pockets.', wear: { cargo: [4, 3] },
    dress: { model: 'work_pants', hides: ['hips', 'thigh', 'aboveKnee', 'shin'] },
    colours: [{ name: 'Brown' }, { name: 'Black', tint: 0x28282a }, { name: 'Khaki', tint: 0x8f8160 }],
    loot: { pair: 'CanvasPants_Beige', at: [2, 4, 4, 0, 0], restock: 600, usage: SHEDS },
    worth: 2,
  },
  {
    id: 'work_boots', name: 'Work Boots', model: 'combat_boots', tint: 0x6b4a30, w: 2, h: 2, weight: 1.2, category: 'clothing', slot: 'feet',
    desc: 'Leather lace-up work boots. A seventh off a bad landing.', wear: { fall: 0.85 },
    dress: { model: 'work_boots', hides: ['foot'] },
    colours: [{ name: 'Brown' }, { name: 'Black', tint: 0x262626 }],
    loot: { pair: 'WorkingBoots_Brown', at: [2, 4, 4, 0, 0], restock: 600, usage: SHEDS },
    worth: 2,
  },
  {
    id: 'leather_gloves', name: 'Leather Gloves', model: 'garden_gloves_01', tint: 0x6b4a30, w: 2, h: 1, weight: 0.2, category: 'clothing', slot: 'hands',
    desc: 'Worn leather work gloves. Your punches land a little harder.', wear: { fist: 3 },
    dress: { model: 'leather_gloves', hides: ['hand'] },
    colours: [{ name: 'Brown' }, { name: 'Black', tint: 0x242424 }],
    loot: { pair: 'LeatherGloves_Brown', at: [1, 3, 4, 0, 0], restock: 600, usage: SHEDS },
    worth: 2,
  },
  // ---- the hunting cabins and the mountain
  {
    id: 'parka', name: 'Parka', model: 'folded_blanket', tint: 0x4b5235, scale: 1.15, w: 4, h: 3, weight: 1.9, category: 'clothing', slot: 'top',
    desc: 'A long waxed-cotton parka with a hood. 20 slots in its pockets.', wear: { cargo: [5, 4] },
    dress: { model: 'parka', hides: ['chest', 'belly', 'hips', 'shoulder', 'upperArm', 'forearm'], shrinks: ['thigh'] },
    colours: [{ name: 'Olive' }, { name: 'Grey', tint: 0x6b6d6b }, { name: 'Winter white', tint: 0xd8dcd8 }, { name: 'Snow', camo: 'snow' }],
    loot: { pair: 'Parka_Green', at: [0, 3, 6, 0, 0], restock: 900, usage: ['Hunting', 'Village'] },
    worth: 6,
  },
  {
    id: 'cargo_pants', name: 'Cargo Trousers', model: 'folded_blanket', tint: 0x3a3b3c, scale: 0.85, w: 3, h: 3, weight: 0.8, category: 'clothing', slot: 'legs',
    desc: 'Ripstop cargo trousers with big thigh pockets. 16 slots in them.', wear: { cargo: [4, 4] },
    dress: { model: 'cargo_pants', hides: ['hips', 'thigh', 'aboveKnee', 'shin'] },
    colours: [{ name: 'Charcoal' }, { name: 'Olive', tint: 0x4b5235 }, { name: 'Tan', tint: 0x9c8562 }],
    loot: { pair: 'CargoPants_Grey', at: [0, 4, 8, 0, 0], restock: 900, usage: ['Hunting', 'Industrial'] },
    worth: 4,
  },
  {
    id: 'hiking_boots', name: 'Hiking Boots', model: 'combat_boots', tint: 0x7a6a58, w: 2, h: 2, weight: 1.1, category: 'clothing', slot: 'feet',
    desc: 'Suede hiking boots with a padded ankle. A fifth off a bad landing.', wear: { fall: 0.8 },
    dress: { model: 'hiking_boots', hides: ['foot'] },
    colours: [{ name: 'Grey' }, { name: 'Brown', tint: 0x5a3e2a }],
    loot: { pair: 'HikingBootsLow_Grey', at: [0, 4, 8, 0, 0], restock: 900, usage: ['Hunting'] },
    worth: 4,
  },
  // ---- the army's
  {
    id: 'fingerless_gloves', name: 'Fingerless Gloves', model: 'tactical_gloves', tint: 0x2a2a2a, w: 2, h: 1, weight: 0.15, category: 'clothing', slot: 'hands',
    desc: 'Tactical gloves with the fingertips cut off, for the trigger. Your punches land a little harder.', wear: { fist: 3 },
    dress: { model: 'fingerless', hides: [] },
    colours: [{ name: 'Black' }, { name: 'Olive', tint: 0x4b5235 }],
    loot: { pair: 'TacticalGloves_Black', at: [0, 2, 8, 0, 0], restock: 900, usage: ARMY },
    worth: 3,
  },
  // ---- the mountain's: Sumrak's kind (the owner, 2026-10-25: "sumrak mod also has some cool clothes like new field
  // bags and snow camo pants and hoodies and parkas"), in snow at the fort and in the forest further down
  {
    id: 'mountain_smock', name: 'Mountain Smock', model: 'folded_blanket', tint: 0x9a9c94, scale: 1.1, w: 3, h: 3, weight: 1.4, category: 'clothing', slot: 'top',
    desc: 'A loose gorka-cut canvas smock with a hood and patched elbows. 30 slots in its pockets: the most of any top.', wear: { cargo: [6, 5] },
    dress: { model: 'smock', hides: ['chest', 'belly', 'shoulder', 'upperArm', 'forearm'], shrinks: ['hips'] },
    colours: [{ name: 'Snow', camo: 'snow' }, { name: 'Forest', camo: 'forest' }, { name: 'Flat', tint: 0x7d7a62 }],
    loot: { pair: 'GorkaEJacket_Winter', at: [0, 0, 2, 0, 0], restock: 1200, usage: ARMY },
    worth: 12,
  },
  {
    id: 'mountain_trousers', name: 'Mountain Trousers', model: 'folded_blanket', tint: 0x9a9c94, scale: 0.85, w: 3, h: 2, weight: 0.9, category: 'clothing', slot: 'legs',
    desc: 'Loose gorka-cut canvas trousers with patched knees. 20 slots in their pockets.', wear: { cargo: [5, 4] },
    dress: { model: 'smock_pants', hides: ['hips', 'thigh', 'aboveKnee', 'shin'] },
    colours: [{ name: 'Snow', camo: 'snow' }, { name: 'Forest', camo: 'forest' }, { name: 'Flat', tint: 0x7d7a62 }],
    loot: { pair: 'GorkaPants_Winter', at: [0, 0, 2, 0, 0], restock: 1200, usage: ARMY },
    worth: 10,
  },
  {
    // (worn on the back, as DayZ has it: no pack with it. A shape in the grass, not a survivor.)
    id: 'ghillie_suit', name: 'Ghillie Suit', model: 'folded_blanket', tint: 0x4f5a34, scale: 1.2, w: 4, h: 3, weight: 2.5, category: 'clothing', slot: 'back',
    desc: 'A sniper\'s suit of burlap strips, head to ankle. Worn on the back: there is no pack with it, and nothing in its pockets.', wear: {},
    dress: { model: 'ghillie_suit', hides: ['chest', 'belly', 'hips', 'shoulder', 'upperArm', 'forearm', 'thigh', 'aboveKnee', 'shin'] },
    colours: [{ name: 'Woodland' }, { name: 'Mossy', tint: 0x55663a }, { name: 'Desert', tint: 0xb39d70 }, { name: 'Winter', tint: 0xd8dcd6 }],
    loot: { pair: 'GhillieSuit_Woodland', at: [0, 0, 1, 0, 0], restock: 1800, usage: ['Military', 'Hunting'] },
    worth: 20,
  },
  {
    // (still `boonie_hat`, so that what is carried and what is kept in the world still means it: a helmet now)
    id: 'boonie_hat', name: 'Combat Helmet', model: 'combat_helmet', w: 2, h: 2, weight: 1.4, category: 'clothing', slot: 'head',
    desc: 'Ballistic helmet with a mount on the brow and pouches over the ears. Takes three tenths off anything that hits your head: a pistol round there is no longer the end of you.', wear: { head: 0.7 },
    loot: { pair: 'BoonieHat_DPM', at: [0, 1, 5, 5, 4], restock: 900, usage: ['Military'], lean: 0.4 },
    worth: 18,
  },
  {
    // (2026-10-10: the fifth step's helmet. A sniper's round to the head does 304 at the muzzle; under this it does 97.)
    id: 'helmet_k63', name: 'K6-3 Helmet', model: 'helmet_k63', w: 3, h: 3, weight: 3.6, category: 'clothing', slot: 'head',
    desc: 'A titanium assault helmet with a steel visor: the heaviest there is, and kept in the bunker and nowhere else. Takes two thirds off anything that hits your head. A sniper round there leaves you standing, barely.', wear: { head: 0.32 },
    // (the heaviest helmet there is: the bunker's)
    loot: { pair: 'GorkaHelmet', at: [0, 0, 0, 0, 2], lifetime: 7200, restock: 1800 },
  },
  {
    // (2026-10-13: an old steel pot under a camouflage cover, out of the packs the user brought in. The weakest
    // thing that is a helmet, between a cap and the Combat Helmet: a 9 mm to the head at the muzzle leaves 13 of a
    // hundred where a cap leaves 2, and a .45 or any rifle's round there is the end, as it is bare. With a mask on
    // as well, 0.64 of a hit gets through: nearly a Combat Helmet's 0.7.)
    id: 'helmet_m1', name: 'Steel Helmet', model: 'helmet_m1', w: 2, h: 2, weight: 1.3, category: 'clothing', slot: 'head',
    desc: 'An old steel pot under a camouflage cover, a clip of cartridges tucked in its band. A fifth off anything that hits your head: twice what a cap takes, and short of a Combat Helmet.', wear: { head: 0.8 },
    // (The steel pot: the army's old helmet, the weak one and the common one, as DayZ's plain ballistic helmet is the
    // one found at every checkpoint. It is the army's and not the police's, on the pistols' own step and a couple in
    // Kamenka; its places are five of the caps' in the village and the camp, and two of theirs in the town.)
    loot: { pair: 'BallisticHelmet_Green', at: [0, 4, 6, 0, 0], restock: 900, usage: ['Military'] },
    worth: 9,
  },
  // (cloth on the head: the tier under the helmet. Both were in the game's files and in nobody's hands.)
  {
    id: 'patrol_cap', name: 'Patrol Cap', model: 'patrol_cap', w: 2, h: 1, weight: 0.1, category: 'clothing', slot: 'head',
    desc: 'A soldier\'s field cap. Cloth, not steel: a tenth off what hits your head, and better than nothing.', wear: { head: 0.9 },
    loot: { pair: 'PoliceCap', at: [0, 2, 6, 0, 0], restock: 600, usage: ARMY },
    worth: 4,
  },
  {
    id: 'fishermans_hat', name: 'Boonie Hat', model: 'fishermans_hat', w: 2, h: 1, weight: 0.1, category: 'clothing', slot: 'head',
    desc: 'A soft brimmed hat. A tenth off what hits your head. A helmet is what you want, when you find one.', wear: { head: 0.9 },
    loot: { pair: 'BoonieHat_Olive', at: [6, 2, 13, 0, 0], restock: 600, usage: [...HOMES, 'Farm', 'Hunting'] },
    worth: 4,
  },
  {
    id: 'garden_gloves', name: 'Work Gloves', model: 'garden_gloves_01', w: 2, h: 1, weight: 0.1, category: 'clothing', slot: 'hands',
    desc: 'Canvas gloves from somebody\'s shed. Your punches land a little harder.', wear: { fist: 2 },
    loot: { pair: 'WoolGloves_Tan', at: [6, 0, 14, 0, 0], restock: 600, usage: ['Village', 'Farm', 'Industrial'] },
    worth: 2,
  },
  {
    // (2026-10-13: the GP-5 again, without the hose and the filter can it came with. For a day it was a respirator
    // out of a pack, in four paints: "the new gas masks dont look right ... lets just use the old gas mask we
    // already have but i want to get rid of the long hose in the front and the box thats attached to the model".)
    id: 'gasmask', name: 'Gas Mask', model: 'old_gas_mask', w: 2, h: 2, weight: 0.7, category: 'clothing', slot: 'face',
    desc: 'GP-5 pattern mask. Worn on the face, it lets you breathe in the gas. Thick rubber and glass, too: a fifth less damage from anything that hits your head.', wear: { head: 0.8, gas: 1 },
    // (The mask is what lets anybody into the gas, so it is not kept IN the gas: it is a policeman's, in the
    // police station of the village and in Kamenka's, and these are what the whole map has to share, bar what one
    // of the army's cases or a supply drop turns up.)
    loot: { pair: 'GasMask', at: [0, 0, 5, 0, 0], restock: 900, usage: ['Police'] },
    worth: 30, sells: 1,
  },
  // Armour for the body in four weights, and a rig that is only for carrying. Each takes more off a hit to the
  // body than the one before it, weighs more, and is harder to come by.
  {
    id: 'chest_rig', name: 'Chest Rig', model: 'vest_t0', w: 3, h: 2, weight: 0.9, category: 'clothing', slot: 'vest',
    desc: 'Webbing and a belt of pouches, with a pad behind them. A tenth off every hit to the body, 15 slots, and it weighs next to nothing.', wear: { cargo: [5, 3], armor: 0.9 },
    // (armour by weight: the rig in sheds and houses, the soft vest where the police and the army were, the
    // armoured vest in Kamenka and one that got as far as the village, the plate carrier under the gas, the heavy
    // armour only down the bunker)
    loot: { pair: 'ChestHolster', at: [7, 0, 18, 0, 0], restock: 600, usage: [...SHEDS, 'Town'] },
    worth: 6,
  },
  {
    id: 'soft_vest', name: 'Soft Armour Vest', model: 'vest_t1', w: 3, h: 3, weight: 2.4, category: 'clothing', slot: 'vest',
    desc: 'A policeman\'s soft vest. 15% less damage from every hit to the body, and 9 slots.', wear: { cargo: [3, 3], armor: 0.85 },
    loot: { pair: 'PoliceVest', at: [0, 2, 17, 0, 0], restock: 900, usage: ARMY, favour: { Police: 3 }, lean: 0.6 },
    worth: 12,
  },
  {
    id: 'armor_vest', name: 'Armoured Vest', model: 'vest_t2', w: 3, h: 3, weight: 3.8, category: 'clothing', slot: 'vest',
    desc: 'An army vest with plates sewn in. 28% less damage from every hit to the body, and 12 slots.', wear: { cargo: [4, 3], armor: 0.72 },
    loot: { pair: 'PressVest_LightBlue', at: [0, 1, 14, 1, 0], restock: 1200, usage: ARMY, favour: { Military: 3 }, lean: 2.5 },
    worth: 18,
  },
  {
    id: 'heavy_armor', name: 'Heavy Armour', model: 'heavy_armor', w: 3, h: 3, weight: 8.5, category: 'clothing', slot: 'vest',
    desc: 'Plates front, back and sides, and a collar. Half the damage from every hit to the body. It weighs what it looks as if it weighs, and carries 12 slots.', wear: { cargo: [4, 3], armor: 0.5 },
    loot: { pair: 'PlateCarrierVest', at: [0, 0, 0, 0, 3], lifetime: 7200, restock: 1800 },
    worth: 32,
  },
  {
    // (still `life_vest`, which is what was worn here before: it is a plate carrier now)
    id: 'life_vest', name: 'Plate Carrier', model: 'plate_carrier', w: 3, h: 3, weight: 5.2, category: 'clothing', slot: 'vest',
    desc: 'Hard plates front and back, pouches all round. 20 more slots, and 40% less damage from every hit to the body.', wear: { cargo: [5, 4], armor: 0.6 },
    loot: { pair: 'PlateCarrierVest_Camo', at: [0, 0, 0, 7, 4], restock: 900 },
    worth: 22,
  },
  {
    // (still `work_gloves`)
    id: 'work_gloves', name: 'Tactical Gloves', model: 'tactical_gloves', w: 2, h: 1, weight: 0.15, category: 'clothing', slot: 'hands',
    desc: 'Padded leather gloves with hard knuckles. Your punches land harder.', wear: { fist: 5 },
    // (a workman's: sheds and yards before barracks)
    loot: { pair: 'WorkingGloves_Brown', at: [3, 2, 13, 0, 0], restock: 900, usage: ['Industrial', 'Farm', 'Military'], favour: { Industrial: 2 } },
    worth: 3,
  },
  {
    // (still `rubber_boots`)
    id: 'rubber_boots', name: 'Combat Boots', model: 'combat_boots', w: 2, h: 2, weight: 1.4, category: 'clothing', slot: 'feet',
    desc: 'Laced leather boots with a stiff sole. Cushions a bad landing: a third less fall damage.', wear: { fall: 0.67 },
    dress: { model: 'combat_boots', hides: ['foot'] },
    colours: [{ name: 'Black' }, { name: 'Tan', tint: 0x9c8562 }],
    loot: { pair: 'Wellies_Green', at: [3, 1, 14, 0, 0], restock: 900, usage: ['Industrial', 'Farm', 'Military', 'Police'], favour: { Industrial: 2 } },
    worth: 3,
  },
  {
    // Three packs, small to large. (Still `sack_pack`: the smallest. It was the military backpack's model made
    // small, and was taken for the big one, which is not found below the fourth step of the map: it is the
    // camping pack's now, made small.)
    id: 'sack_pack', name: 'Day Pack', model: 'camping_backpack', scale: 0.72, w: 3, h: 3, weight: 0.8, category: 'clothing', slot: 'back',
    desc: 'A small black day pack that sits close to the back. 25 slots.', wear: { cargo: [5, 5] },
    // (three packs: the day pack from the first step, the camping pack from the village on, and the army's
    // rucksack, the biggest, from the fourth step up and never below it)
    loot: { pair: 'TaloonBag_Green', at: [8, 0, 16, 0, 0], restock: 600, usage: [...SHEDS, 'Town', 'Shop'], filled: { chance: 0.35, most: 2 } },
    worth: 8, sells: 1,
  },
  {
    id: 'camping_pack', name: 'Camping Backpack', model: 'camping_backpack', w: 4, h: 3, weight: 1.5, category: 'clothing', slot: 'back',
    desc: 'A tall black hiking pack with red lacing. 42 slots.', wear: { cargo: [7, 6] },
    loot: { pair: 'MountainBag_Green', at: [0, 0, 17, 0, 0], restock: 900, usage: [...HOMES, 'Hunting', 'Shop'], filled: { chance: 0.4, most: 3 } },
    worth: 14,
  },
  {
    // (still `suitcase`: the largest)
    id: 'suitcase', name: 'Field Rucksack', model: 'military_backpack', scale: 1.22, w: 4, h: 3, weight: 2.2, category: 'clothing', slot: 'back',
    desc: 'A full-size military backpack, the biggest there is: 63 slots, nine across. Two rifles lie in it with room over.', wear: { cargo: [9, 7] },
    loot: { pair: 'AliceBag_Green', at: [0, 0, 0, 3, 3], restock: 1200, filled: { chance: 0.5, most: 3 } },
    worth: 20,
  },
];
