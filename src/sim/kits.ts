// Whole sets of gear an admin can hand out in one go (2026-10-11): `/kit`, and the Spawn tab of the panel.
//
// A kit is a list of things as they are to arrive: a gun with its magazine in it, full, and its parts fitted; the
// magazines beside it full; the best there is to wear. The server makes every one of them (so each is a thing it
// knows it put in the world) and hands the list to whoever it is for, whose game puts them on and away. What was
// carried before goes, but for the dog tags; what finds no room is put at the feet.
//
// A kit "replaces everything", and that is the jacket and the trousers that were on as well, with what was in
// their pockets (they are things since 2026-10-13). Nobody is left without: whoever is given a kit stands in a new
// Field Jacket and new Field Trousers before the first thing of it is put away (PlayerInventory.clear), and every
// kit is counted to fit with those on. So no kit lists a jacket or trousers of its own: one would only be a spare
// in a pocket. (test/kits.test.ts holds both of these.)

export interface KitThing {
  id: string;
  /** how many in the pile (things that pile) */
  qty?: number;
  /** a gun: the magazine in it, the rounds in it (the magazine's and the one in the chamber), the parts fitted */
  mag?: string;
  loaded?: number;
  mods?: string[];
  /** a magazine: the rounds in it */
  rounds?: number;
}

export interface Kit {
  id: string;
  name: string;
  does: string;
  /** added to what is carried, and nothing taken away (a bag of supplies, not a set of gear) */
  adds?: true;
  things: KitThing[];
}

const many = (n: number, t: KitThing): KitThing[] => Array.from({ length: n }, () => ({ ...t }));

/** worn by every kit: the helmet and the plates that stop the most, a mask for the gas, the biggest pack, gloves and boots */
const WORN: KitThing[] = ['helmet_k63', 'gasmask', 'heavy_armor', 'suitcase', 'work_gloves', 'rubber_boots'].map((id) => ({ id }));
/** and carried by every kit: something to mend with, to eat and drink, to see and find the way with */
const CARE: KitThing[] = [{ id: 'firstaid' }, { id: 'aid_pouch' }, { id: 'bandage', qty: 5 }, { id: 'stim', qty: 3 }, { id: 'stim_stamina', qty: 3 }, { id: 'blood_bag' }, { id: 'saline' }, { id: 'splint' }, { id: 'beans' }, { id: 'flask' }, { id: 'binoculars' }, { id: 'compass' }, { id: 'radio' }, ...many(2, { id: 'grenade' })];

const M9: KitThing = { id: 'm9', mag: 'mag_m9_ext', loaded: 21, mods: ['red_dot', 'suppressor_9', 'gun_light'] };
const MPA: KitThing = { id: 'mpa', mag: 'mag_mpa', loaded: 31, mods: ['red_dot', 'suppressor_9', 'gun_light'] };

export const KITS: Kit[] = [
  {
    id: 'assault', name: 'Assault', does: 'AR-15 with its sight, suppressor, foregrip and light, sixty-round magazines; a suppressed M9; the best armour',
    things: [...WORN, { id: 'ar15', mag: 'mag_ar_60', loaded: 61, mods: ['red_dot', 'suppressor_556', 'foregrip', 'gun_light'] }, M9,
      ...many(2, { id: 'mag_ar_60', rounds: 60 }), ...many(2, { id: 'mag_ar', rounds: 30 }), { id: 'mag_m9_ext', rounds: 20 }, ...many(2, { id: 'box_556' }), ...CARE],
  },
  {
    id: 'heavy', name: 'Heavy', does: 'AK with a seventy-five round drum, a sight, a suppressor and a light; a Desert Eagle; the best armour',
    things: [...WORN, { id: 'ak', mag: 'drum_ak', loaded: 76, mods: ['red_dot', 'suppressor_739', 'gun_light'] }, { id: 'deagle', mag: 'mag_deagle_ext', loaded: 11, mods: ['gun_light'] },
      { id: 'drum_ak', rounds: 75 }, ...many(3, { id: 'mag_ak', rounds: 30 }), { id: 'mag_deagle_ext', rounds: 10 }, ...many(2, { id: 'box_739' }), ...CARE],
  },
  {
    id: 'marksman', name: 'Marksman', does: 'The sniper rifle with its scope, cheek rest and suppressor; a suppressed submachine gun for close by; the best armour',
    things: [...WORN, { id: 'mosin', mag: 'mag_sniper', loaded: 6, mods: ['pu_scope', 'rifle_wrap', 'suppressor_762'] }, MPA,
      ...many(4, { id: 'mag_sniper', rounds: 5 }), ...many(2, { id: 'box_762' }), ...many(2, { id: 'mag_mpa', rounds: 30 }), { id: 'box_9mm' }, ...CARE],
  },
  {
    id: 'breacher', name: 'Breacher', does: 'The shotgun with a sight, a suppressor and a light; a suppressed submachine gun; the best armour',
    things: [...WORN, { id: 'benelli', loaded: 7, mods: ['red_dot', 'suppressor_12', 'gun_light'] }, MPA,
      ...many(2, { id: 'ammo_12', qty: 30 }), { id: 'box_12' }, ...many(3, { id: 'mag_mpa', rounds: 30 }), { id: 'box_9mm' }, ...CARE],
  },
  {
    id: 'spawn', name: 'Spawn', does: 'What a new life begins with, and nothing else: something to eat, something to drink, one bandage',
    things: [{ id: 'beans' }, { id: 'thermos' }, { id: 'bandage', qty: 1 }],
  },
  {
    id: 'supplies', name: 'Supplies', does: 'Dressings, stims, first aid kits and pouches, bags of blood, splints, food and water: added to what is carried', adds: true,
    things: [...many(2, { id: 'firstaid' }), ...many(2, { id: 'aid_pouch' }), ...many(2, { id: 'bandage', qty: 5 }), ...many(2, { id: 'stim', qty: 3 }), ...many(2, { id: 'stim_stamina', qty: 3 }), { id: 'stim_combat', qty: 5 }, ...many(2, { id: 'blood_bag' }), ...many(2, { id: 'saline' }), ...many(2, { id: 'splint' }), { id: 'beans' }, { id: 'sardines' }, { id: 'condensed' }, { id: 'water_jug' }, { id: 'flask' }],
  },
];

/**
 * Loads for trying the game on one's own machine, and nowhere else: the server hands these out only while it is a
 * local one (LOCAL_ADMIN, server/index.ts), never lists them otherwise, and the admin panel does not show them.
 * `npx tsx scripts/test-load.ts` puts one on a player on the local server.
 */
export const TEST_KITS: Kit[] = [
  {
    // (2026-10-18: "simulate a load that a user will normally have ... in mid game. So it doesn't have everything ...
    // a cocktail of everything and different amounts", and "multiple bags arranged in a similar way")
    id: 'midgame', name: 'Mid-game', does: 'A load some hours into a life: a pistol, an SMG and two rifles, each with magazines, loose rounds and boxes of its own, part used; food, drink and medicine; a vest and a pack',
    things: [
      { id: 'boonie_hat' }, { id: 'chest_rig' }, { id: 'camping_pack' }, { id: 'garden_gloves' }, { id: 'rubber_boots' },
      { id: 'ak', mag: 'mag_ak', loaded: 22 }, { id: 'mosin', mag: 'mag_sniper', loaded: 4 }, { id: 'colt', mag: 'mag_colt', loaded: 6 }, { id: 'mpa', mag: 'mag_mpa', loaded: 19 },
      { id: 'mag_ak', rounds: 30 }, { id: 'mag_ak', rounds: 17 }, { id: 'mag_ak', rounds: 4 },
      { id: 'ammo_739', qty: 30 }, { id: 'ammo_739', qty: 14 }, { id: 'ammo_739', qty: 5 }, ...many(2, { id: 'box_739' }),
      { id: 'mag_sniper', rounds: 5 }, { id: 'mag_sniper', rounds: 2 },
      { id: 'ammo_762', qty: 22 }, { id: 'ammo_762', qty: 8 }, ...many(2, { id: 'box_762' }),
      { id: 'mag_colt', rounds: 7 }, { id: 'mag_colt', rounds: 3 },
      { id: 'ammo_45', qty: 26 }, { id: 'ammo_45', qty: 9 }, ...many(2, { id: 'box_45' }),
      { id: 'mag_mpa', rounds: 30 }, { id: 'mag_mpa', rounds: 24 }, { id: 'mag_mpa', rounds: 11 },
      { id: 'ammo_9mm', qty: 30 }, { id: 'ammo_9mm', qty: 16 }, { id: 'ammo_9mm', qty: 3 }, ...many(3, { id: 'box_9mm' }),
      { id: 'beans' }, { id: 'sardines' }, { id: 'tomatoes' }, { id: 'apple' }, { id: 'flask' }, { id: 'milk' },
      { id: 'bandage', qty: 4 }, { id: 'bandage', qty: 1 }, { id: 'stim', qty: 2 }, { id: 'aid_pouch' }, { id: 'splint' }, { id: 'saline' },
    ],
  },
];
