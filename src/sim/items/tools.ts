// Tools and odds and ends, the dog tag, and what things are kept in. Each item says everything about itself: what it is, where and how much of it is found (`loot`, on
// DayZ's Central Economy: see rules.ts) and what the trader gives for it. Adding a thing is one entry here.

import type { ItemDef } from '../items';
import { HOMES, SHEDS } from './rules';

export const TOOL_ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- tools & misc
  { id: 'keycard', name: 'Bunker Keycard', model: '@keycard', w: 1, h: 1, weight: 0.02, category: 'misc', desc: 'Opens the door of Bunker 17, once: the reader keeps it. It goes on foot: no car will take you while you carry one.',
    // (what opens the bunker is kept under the gas, and nowhere else: the one place is the way into the other. Three at
    // once, and one taken comes back as soon as the gas's things do, so that there is always one to be found: the
    // owner, 2026-10-18, "green keycards ONLY found in chemical works, make sure theres multiple that spawn and always 1
    // available somewhere". It was two, anywhere on the fourth step, back ten minutes after)
    // (under the gas, very rare, and at the fort, rare; never in the bunker it opens: the owner, 2026-10-19, "bunker cards should
    // only be found in gas zones, and super rare T4 and regular rare in T5 like the castle. (no need for bunker to have keycards)")
    loot: { pair: 'ShippingContainerKeys_Red', at: [0, 0, 0, 1, 1], away: [5], lifetime: 7200, restock: 300, usage: ['Gas'], on: { 4: { restock: 3600 }, 5: { usage: ['Military'], restock: 1200 } } },
  },
  { id: 'flashlight', name: 'Flashlight', model: 'vintage_flashlight', w: 1, h: 2, weight: 0.4, category: 'tool', desc: 'A battery lantern. Carried anywhere on you, L switches it on: it shines from your chest, wide and not far. It shows you the dark, and shows the dark where you are.',
    // (a lantern is a thing of sheds, yards and the shop's shelf: most of them out where anybody starts, because the night is everybody's.
    // The shop's shelf three times a shed's since 2026-10-18: the first step the desert's alone, its two stores at eight took two thirds of its lights)
    loot: { pair: 'Flashlight', at: [22, 1, 29, 1, 2], restock: 420, usage: [...SHEDS, 'Shop', 'Town'], favour: { Shop: 3, Industrial: 3, Farm: 2 } },
    worth: 5, sells: 3,
  },
  { id: 'binoculars', name: 'Binoculars', model: 'binoculars', w: 2, h: 2, weight: 0.8, category: 'tool', desc: 'Field binoculars. Use them to look five times closer; any other action puts them away.', use: { verb: 'Look through', time: 0.35, sound: 'bandage' }, look: 0.2,
    loot: { pair: 'Binoculars', at: [2, 0, 7, 1, 1], restock: 1200, usage: ['Military', 'Hunting', 'Police'], lean: 2 },
    worth: 10,
  },
  { id: 'compass', name: 'Compass', model: 'seadogs_compass', w: 1, h: 1, weight: 0.15, category: 'tool', desc: 'Brass pocket compass. While you carry it, your exact bearing in degrees is shown under the compass strip.',
    loot: { pair: 'OrienteeringCompass', at: [4, 1, 10, 0, 0], restock: 1200, usage: ['Military', 'Hunting', 'Village', 'Shop'], favour: { Shop: 3 } },
    worth: 4,
  },
  { id: 'watch', name: 'Wrist Watch', model: 'digital_wrist_watch', w: 1, h: 1, weight: 0.05, category: 'tool', desc: 'Still ticking.',
    loot: { pair: 'WristWatch' },
    worth: 6,
  },
  { id: 'radio', name: 'Field Radio', model: 'vintage_radio_transceiver', w: 4, h: 3, weight: 6.5, category: 'misc', desc: 'Military transceiver, good for one call: use it under open sky and a supply drop comes down where you stand. Everybody hears it called.', use: { verb: 'Call a drop on the', time: 5, sound: 'bandage' }, call: true,
    // (a field radio: good for one supply drop called down where it is used. One at the army's; the trader sells them dear.)
    loot: { pair: 'PersonalRadio', at: [0, 1, 2, 0, 0], lifetime: 7200, restock: 2400, usage: ['Military'] },
    worth: 35, sells: 1,
  },
  { id: 'cigarettes', name: 'Cigarettes', model: 'cigarette_pack', w: 1, h: 1, weight: 0.03, category: 'misc', stack: 5, desc: 'Kentucky Ace. A smoke steadies you: each one gives back 12 health.', use: { verb: 'Smoke', time: 4, health: 12, sound: 'smoke' },
    loot: { pair: 'CigarettePack_Chernamorka', at: [4, 1, 25, 0, 1], lifetime: 2400, restock: 600, usage: [...HOMES, 'Military', 'Industrial', 'Shop'], favour: { Shop: 2 }, lean: 0.3 },
    worth: 2,
  },
  { id: 'jerrycan', name: 'Jerrycan', model: 'metal_jerrycan_green', w: 2, h: 3, weight: 10, category: 'misc', desc: 'Ten litres of fuel, a quarter of a tank. Hold it, look at a jeep or a police car, and hold the left button to pour it in.',
    // fuel for the jeeps (src/sim/vehicles.ts): where there are sheds, yards and soldiers
    loot: { pair: 'CanisterGasoline', at: [6, 6, 15, 1, 1], restock: 600, usage: ['Farm', 'Industrial', 'Military'], favour: { Industrial: 2 }, lean: 0.5 },
    worth: 8,
  },
  // (Thrown by being cooked, 2026-10-13: "rework the grenade throwing mechanic so it functions more like PUBG or
  // DAYZ or COD ... hold to cook the grenade for multiple seconds before throwing it". `use.time` is how long the
  // hands take to get the cord pulled or the pin out; `throw.fuse` runs from that moment, in the hand or out of it.
  // What each does to a body, to a car and how far is WEAPON_RULES in combat.ts, by the same name: `throw` says it
  // again for the game's own blast, and test/grenades.test.ts holds the two to each other.)
  { id: 'grenade', name: 'Stick Grenade', model: 'stick_grenade', w: 1, h: 3, weight: 0.6, category: 'misc', desc: 'Hold the button to pull the cord, let go to throw. Four seconds from the pull, in your hand or out of it, then everything within nine metres is hurt, you included.', use: { verb: 'Throw', time: 0.75, sound: 'bandage' }, throw: { fuse: 4, damage: 150, radius: 9 },
    // (The frag grenade, 2026-10-13: where the stick grenade is and rarer, from the third step up and never below
    // it. One in Kamenka, two under the gas, two down the bunker, and half as long again coming back. Down the bunker
    // every place is spoken for: its two are two of the stick grenade's four, which are two now.)
    loot: { pair: 'RGD5Grenade', at: [0, 2, 8, 5, 2], restock: 1200, usage: ['Military'], lean: 2 },
    worth: 15, sells: 2,
  },
  // (The frag grenade, 2026-10-13: "i added a new frag grenade, it takes up 1x1 in the inventory and does more
  // damage as the stick grenade". An M67, life size: 0.4 kg, where the stick grenade is 0.6. Its pin is out sooner
  // than a cord is pulled.)
  { id: 'frag', name: 'Frag Grenade', model: 'frag_grenade', w: 1, h: 1, weight: 0.4, category: 'misc', desc: 'A steel ball the size of a fist: one place in a pocket. Hold the button to pull the pin, let go to throw. Four seconds from the pull, in your hand or out of it, then everything within ten metres is hurt, and worse than by a stick grenade. One is the end of a car.', use: { verb: 'Throw', time: 0.6, sound: 'bandage' }, throw: { fuse: 4, damage: 200, radius: 10 },
    loot: { pair: 'M67Grenade', at: [0, 0, 2, 2, 2], restock: 1800, usage: ['Military'] },
    worth: 22,
  },
  // ---------------------------------------------------------------- identity
  {
    id: 'dogtag', name: 'Dog Tag', model: '@dogtag', scale: 1.5, w: 1, h: 1, weight: 0.02, category: 'misc',
    desc: 'Stamped steel on a ball chain. Every survivor carries their own. Take one off a body and stay alive with it for 15 minutes to cash it in.',
    loot: { pair: 'Dogtag_Survivor' },
  },
  // ---------------------------------------------------------------- base building
  { id: 'stash_kit', name: 'Stash Case', model: 'weapons_case', w: 4, h: 3, weight: 6, category: 'stash', scale: 0.55, /* (ten by fifteen: five Barretts laid flat, the owner, 2026-10-18: "we need to make stash crates larger, large enough to hold 5 barretts". It was eight by six) */ stash: [10, 15], desc: 'A hard case. Dropped, it lies where it lands and can be opened there: it stays in the world and keeps whatever you store in it. Out in the country, a shovel buries it.',
    loot: { pair: 'SmallProtectorCase', at: [3, 1, 4, 0, 0], restock: 1800, usage: ['Farm', 'Industrial', 'Hunting'], filled: { chance: 0.25, most: 2 } },
    worth: 15, sells: 1,
  },
  // (two more things to keep things in, 2026-10-12: smaller than the case, lighter, and found in houses)
  // (ONE of the two cases the model is of: it comes as a pair side by side, and both were drawn wherever a suitcase
  // was: on the ground, in the hands, in its picture. 2026-10-13: "the suitcase model is duplicated". The one is
  // drawn as wide as the pair was, so that it lies wherever it lay; and stood down as a stash it is a suitcase's size.)
  { id: 'old_suitcase', name: 'Suitcase', model: 'vintage_suitcase', nodeRe: '^vintage_suitcase_01', w: 4, h: 3, weight: 3, category: 'stash', scale: 0.7, place: 1, stash: [6, 5], desc: 'An old travelling case. Dropped, it lies where it lands and can be opened there: it keeps what you store in it. Out in the country, a shovel buries it.',
    loot: { pair: 'SeaChest', at: [3, 0, 13, 0, 0], restock: 1800, usage: HOMES, filled: { chance: 0.5, most: 3 } },
    worth: 8,
  },
  { id: 'black_bag', name: 'Black Bag', model: 'trashbag', w: 2, h: 3, weight: 0.3, category: 'stash', scale: 0.5, stash: [5, 4], desc: 'A heavy black sack. Dropped, it lies where it lands and can be opened there: it keeps what you store in it. Out in the country, a shovel buries it.',
    // (two more things to keep things in, beside the stash case: a black sack, in every shed, and a suitcase, in houses)
    loot: { pair: 'CourierBag', at: [5, 0, 15, 0, 0], restock: 1200, usage: [...SHEDS, 'Town'], filled: { chance: 0.35, most: 2 } },
    worth: 3,
  },
];
