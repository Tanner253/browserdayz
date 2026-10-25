// Crafting's materials, their ids, piles and the forge's ratio, in one place (the navigator, 2026-10-25: "the salvage
// yield's item id, the forge ratio and the stack size as data in one place, so a rename and new numbers are a few
// lines"). Progression v3, the owner's yes: Rust's three metals and a currency ("rust has scrap, metal bars, and metal
// frags ... scrap is important in rust just like frags and iron bars"). Scrap is the currency: traders, blueprints,
// bench levels. Fragments are the small change of metal, knocked off wrecks and out of recyclers. Bars are forged.

export const MAT = {
  /** the currency, found and recycled */
  scrap: 'scrap',
  /** salvaged and recycled; most metal crafting */
  frags: 'metal_frags',
  /** forged from fragments; guns, Bench III, the armoured tier */
  bar: 'iron_bar',
  /** what a forge's wood leaves */
  coal: 'coal',
} as const;

/** fragments a bar takes at the forge (v3: "10 fragments make 1 bar, with time and fuel") */
export const PER_BAR = 10;

/** how many make a pile, and what one weighs, kg (a full pile of scrap 5 kg, of fragments 10: carried, they cost) */
export const PILES = {
  scrap: { stack: 500, weight: 0.01 },
  frags: { stack: 500, weight: 0.02 },
  bar: { stack: 20, weight: 0.5 },
};
