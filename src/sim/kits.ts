// Whole sets of gear an admin can hand out in one go (2026-10-11): `/kit`, and the Spawn tab of the panel.
//
// A kit is a list of things as they are to arrive: a gun with its magazine in it, full, and its parts fitted; the
// magazines beside it full; the best there is to wear. The server makes every one of them (so each is a thing it
// knows it put in the world) and hands the list to whoever it is for, whose game puts them on and away. What was
// carried before goes, but for the dog tags; what finds no room is put at the feet.

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
const CARE: KitThing[] = [{ id: 'firstaid' }, { id: 'bandage', qty: 5 }, { id: 'stim', qty: 3 }, { id: 'stim_stamina', qty: 3 }, { id: 'splint' }, { id: 'beans' }, { id: 'flask' }, { id: 'binoculars' }, { id: 'compass' }, { id: 'radio' }, ...many(2, { id: 'grenade' })];

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
    id: 'supplies', name: 'Supplies', does: 'Dressings, stims, first aid, splints, food and water: added to what is carried', adds: true,
    things: [...many(2, { id: 'firstaid' }), ...many(2, { id: 'bandage', qty: 5 }), ...many(2, { id: 'stim', qty: 3 }), ...many(2, { id: 'stim_stamina', qty: 3 }), ...many(2, { id: 'splint' }), { id: 'beans' }, { id: 'sardines' }, { id: 'condensed' }, { id: 'water_jug' }, { id: 'flask' }],
  },
];
