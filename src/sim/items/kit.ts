// What you hit with, eat, drink and mend with. Each item says everything about itself: what it is, where and how much of it is found (`loot`, on
// DayZ's Central Economy: see rules.ts) and what the trader gives for it. Adding a thing is one entry here.

import type { ItemDef } from '../items';
import { HOMES, SHEDS, LARDER, IN_SHEDS } from './rules';

export const KIT_ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- melee
  // (The long ones are carried slung on the back, in either of its two places, or in a pack that is tall enough;
  // the hatchet and the knife go in a pocket. Any of them is put on a hot key and taken into the hands with it.)
  { id: 'hatchet', name: 'Hatchet', model: 'melee_hatchet', w: 1, h: 3, weight: 0.8, category: 'melee', desc: 'Chops wood and anything else.', melee: { damage: 45, range: 1.7, rate: 0.75 },
    // ("t1 melee heavy". Past the outskirts the tools of a shed are still in sheds, a few: a shed with nothing in
    // it is a shed nobody opens twice. Nothing to hit with lies in a house, a shop or a barracks past the outskirts.)
    loot: { pair: 'Hatchet', at: [14, 1, 7, 0, 0], restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 2, Hunting: 2 }, on: IN_SHEDS, rack: { any: 1.6 } },
    worth: 5,
  },
  { id: 'machete', name: 'Machete', model: 'melee_machete', w: 1, h: 5, weight: 0.6, category: 'melee', slot: 'long', desc: 'Long blade. Fast swings.', melee: { damage: 38, range: 1.9, rate: 0.55 },
    loot: { pair: 'Machete', at: [12, 0, 0, 0, 0], restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 2 }, rack: { any: 1.4 } },
    worth: 5,
  },
  { id: 'crowbar', name: 'Crowbar', model: 'melee_crowbar', w: 1, h: 4, weight: 1.6, category: 'melee', slot: 'long', desc: 'Heavy steel. Opens things, closes arguments.', melee: { damage: 42, range: 1.8, rate: 0.85 },
    loot: { pair: 'Crowbar', at: [14, 1, 7, 0, 0], restock: 180, usage: [...SHEDS, 'Village'], favour: { Industrial: 2 }, on: IN_SHEDS, rack: { any: 1.4 } },
    worth: 4,
  },
  { id: 'bat', name: 'Baseball Bat', model: 'melee_bat', w: 1, h: 6, weight: 0.9, category: 'melee', slot: 'long', desc: 'Wooden bat.', melee: { damage: 30, range: 2.0, rate: 0.7 },
    loot: { pair: 'BaseballBat', at: [13, 0, 0, 0, 0], restock: 180, usage: [...HOMES, 'Farm'], rack: { any: 1.6 } },
    worth: 3,
  },
  // (2026-10-10: swung as the bat is, in both hands; heavier, a little slower, and its edge bites)
  { id: 'shovel', name: 'Shovel', model: 'melee_shovel', w: 2, h: 6, weight: 1.7, category: 'melee', slot: 'long', desc: 'A short-handled digging shovel with a steel blade. Swung in both hands like a bat: heavier, a little slower, and it hits harder.', melee: { damage: 36, range: 2.0, rate: 0.78 },
    // (a tool of yards and sheds: it lies on a floor, being as long as a rifle is)
    loot: { pair: 'Shovel', at: [11, 1, 7, 0, 0], restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 2, Industrial: 2 }, on: IN_SHEDS, rack: { any: 1.4 } },
    worth: 4,
  },
  // (2026-10-13: the Fish Knife is gone and this is in its place, under the same id: an army bayonet-knife out of a
  // pack with hands and movements of its own, see `knife` in WEAPON_PACKS. What it does is as it was.)
  { id: 'pitchfork', name: 'Pitchfork', model: 'pitchfork', w: 2, h: 7, weight: 2.0, category: 'melee', slot: 'long', desc: 'A farm pitchfork, four long tines. Held in both hands: the longest reach of anything you can swing, and slow.', melee: { damage: 40, range: 2.4, rate: 0.85 },
    loot: { pair: 'Pitchfork', at: [6, 1, 12, 0, 0], restock: 180, usage: [...SHEDS, 'Village'], favour: { Farm: 3 }, on: IN_SHEDS },
    worth: 3,
  },
  { id: 'knife', name: 'Combat Knife', model: 'combat_knife', w: 1, h: 2, weight: 0.4, category: 'melee', desc: 'A clip-point fighting knife: a steel guard, a grip of stacked leather. Quick, short reach.', melee: { damage: 27, range: 1.45, rate: 0.42 },
    loot: { pair: 'CombatKnife', at: [18, 1, 10, 0, 0], restock: 180, usage: [...HOMES, ...SHEDS], on: IN_SHEDS, rack: { any: 1 } },
    worth: 3,
  },
  // (the owner, 2026-10-25: "high quality knives". Found as DayZ has them: the hunting knife where hunters keep things,
  // the AK's bayonet at the army's places of the second step, as no police station keeps a thing to hit with. Every
  // knife hits as every other: what one finds is a look, not an edge.)
  { id: 'hunting_knife', name: 'Hunting Knife', model: 'hunting_knife', w: 1, h: 2, weight: 0.3, category: 'melee', desc: 'A drop-point hunting knife: a brass guard, a wooden grip. Quick, short reach.', melee: { damage: 27, range: 1.45, rate: 0.42 },
    loot: { pair: 'HuntingKnife', at: [12, 1, 4, 0, 0], restock: 180, usage: [...SHEDS, 'Village'], favour: { Hunting: 3 }, on: IN_SHEDS, rack: { any: 1 } },
    worth: 3,
  },
  { id: 'bayonet', name: 'AK Bayonet', model: 'bayonet', w: 1, h: 2, weight: 0.35, category: 'melee', desc: 'The AK\'s bayonet (6Kh4): a saw-backed blade, a ring at its guard. Quick, short reach.', melee: { damage: 27, range: 1.45, rate: 0.42 },
    loot: { pair: 'AK_Bayonet', at: [0, 4, 0, 0, 0], restock: 240, usage: ['Military'], rack: { any: 1 } },
    worth: 3,
  },
  // (the owner, 2026-10-25: "karambit is not a finish type its a knife type, the circular claw one like from cs:go". Bought
  // at the store, not found: a knife of theirs is made one. It hits as every knife does: nothing bought hits harder.)
  { id: 'karambit', name: 'Karambit', model: 'karambit', w: 1, h: 2, weight: 0.25, category: 'melee', desc: 'A curved claw blade, held point down, the first finger through its ring. Quick, short reach.', melee: { damage: 27, range: 1.45, rate: 0.42 },
    worth: 3,
  },
  // ---------------------------------------------------------------- food & drink
  // (food that keeps and needs no cooking under half as common, a little of it in the villages and the army's places,
  // and slower to come back: "since we have animals in the game we can reduce the spawn rate of food items ... we
  // shouldnt make food absent but it should be more rare higher tier loot since it cant spoil and doesnt need to be
  // cooked its very valuble", the owner, 2026-10-24. Sprats no longer dry you out: "sprats shouoldnt dehydrate".)
  { id: 'sprats', name: 'Tinned Sprats', model: 'russian_food_cans_01', node: 'russian_food_cans_01_can_fish', scale: 2.2, w: 1, h: 1, weight: 0.24, category: 'food', desc: 'Smoked sprats in oil. Шпроты.', use: { verb: 'Eat', time: 2.5, energy: 28, sound: 'eat' },
    loot: { pair: 'TunaCan', at: [4, 1, 15, 0, 0], restock: 600, usage: ['Shop', ...HOMES], favour: LARDER },
    worth: 2,
  },
  { id: 'condensed', name: 'Condensed Milk', model: 'russian_food_cans_01', node: 'russian_food_cans_01_can_cond', scale: 2, w: 1, h: 1, weight: 0.4, category: 'food', desc: 'Sweet, thick, calorie dense.', use: { verb: 'Eat', time: 2.5, energy: 34, water: 4, sound: 'eat' },
    loot: { pair: 'Marmalade', at: [2, 1, 11, 1, 2], restock: 600, usage: ['Shop', ...HOMES, 'Military'], favour: LARDER },
    worth: 3,
  },
  { id: 'beans', name: 'Baked Beans', model: 'long_life_food', node: 'long_life_food_beans', w: 1, h: 2, weight: 0.42, category: 'food', desc: 'A can of baked beans.', use: { verb: 'Eat', time: 3, energy: 36, water: 2, sound: 'eat' },
    loot: { pair: 'BakedBeansCan', at: [4, 1, 17, 0, 1], restock: 600, usage: ['Shop', ...HOMES, 'Farm'], favour: LARDER },
    worth: 3, sells: 3,
  },
  { id: 'tomatoes', name: 'Tinned Tomatoes', model: 'long_life_food', node: 'long_life_food_tomatoes', w: 1, h: 2, weight: 0.4, category: 'food', desc: 'Watery and filling.', use: { verb: 'Eat', time: 2.5, energy: 18, water: 12, sound: 'eat' },
    loot: { pair: 'PeachesCan', at: [3, 1, 11, 0, 0], restock: 600, usage: ['Shop', 'Village', 'Farm'], favour: LARDER },
    worth: 2,
  },
  { id: 'sardines', name: 'Sardines', model: 'long_life_food', node: 'long_life_food_sardines', w: 2, h: 1, weight: 0.13, category: 'food', desc: 'Flat tin of sardines.', use: { verb: 'Eat', time: 2, energy: 20, water: -1, sound: 'eat' },
    loot: { pair: 'SardinesCan', at: [3, 1, 15, 0, 1], restock: 600, usage: ['Shop', ...HOMES, 'Hunting'], favour: LARDER },
    worth: 2, sells: 3,
  },
  { id: 'apple', name: 'Apple', model: 'food_apple_01', w: 1, h: 1, weight: 0.15, category: 'food', desc: 'Crisp and sour.', use: { verb: 'Eat', time: 1.5, energy: 10, water: 8, sound: 'eat' },
    loot: { pair: 'Apple', at: [4, 0, 12, 0, 0], lifetime: 1200, restock: 600, usage: ['Shop', 'Village', 'Farm'], favour: LARDER },
    worth: 1,
  },
  { id: 'milk', name: 'Milk Carton', model: 'long_life_food', node: 'long_life_food_milk', w: 1, h: 2, weight: 1.0, category: 'drink', desc: 'UHT milk. Still sealed.', use: { verb: 'Drink', time: 2.5, energy: 10, water: 30, sound: 'drink' },
    loot: { pair: 'PowderedMilk', at: [3, 0, 20, 0, 0], lifetime: 1800, restock: 300, usage: ['Shop', ...HOMES], favour: LARDER },
    worth: 2,
  },
  // (More drinks in each bottle, and more in each drink, the litres and weights kept: the owner, 2026-10-18, "water
  // containers should hold more water/drinking from them should replenish more water". A full jug was 80 of thirst,
  // a flask 54, a thermos 40; now 180, 120 and 75: a full flask takes a body from parched to full. The flask is still
  // a litre, as DayZ's canteen is.)
  { id: 'water_jug', name: 'Water Jug', model: 'plastic_bottle_gallon', w: 2, h: 3, weight: 2.2, category: 'drink', desc: 'Two litres of clean water: six good drinks. A well fills it again, and so does a river or a lake.', use: { verb: 'Drink from the', time: 2.2, water: 30, sips: 6, drink: 2, sound: 'drink' },
    // (there was a third as much to drink on the map as to eat, and thirst runs as fast as hunger)
    loot: { pair: 'WaterBottle', at: [8, 0, 39, 1, 1], restock: 300, usage: ['Shop', ...HOMES, 'Farm', 'Industrial'], favour: { Shop: 9 } },
    worth: 3,
  },
  { id: 'flask', name: 'Water Flask', model: 'flask', w: 2, h: 2, weight: 1.25, category: 'drink', desc: 'A soldier\'s litre of water in a hard flask: four drinks. A well fills it again, and so does a river or a lake.', use: { verb: 'Drink from the', time: 2, water: 30, sips: 4, drink: 1, sound: 'drink' },
    loot: { pair: 'Canteen', at: [4, 2, 22, 1, 3], restock: 300, usage: ['Shop', 'Military', 'Hunting', 'Village', 'Farm'], favour: { Shop: 5 } },
    worth: 3, sells: 3,
  },
  { id: 'thermos', name: 'Thermos', model: 'plastic_thermos', w: 1, h: 3, weight: 0.8, category: 'drink', desc: 'Lukewarm tea, three cups of it. Filled at a well it is water, and still better than nothing.', use: { verb: 'Drink from the', time: 2, water: 25, energy: 3, sips: 3, drink: 0.5, sound: 'drink' },
    loot: { pair: 'SodaCan_Kvass', at: [4, 2, 19, 1, 1], restock: 300, usage: ['Shop', 'Military', 'Hunting', 'Village', 'Police', 'Industrial'], favour: { Shop: 2 } },
    worth: 4,
  },
  // ---------------------------------------------------------------- medical
  // Two things for a wound, and the kit (2026-10-10, as asked): a bandage, common from the outskirts on, stops
  // bleeding and gives back 10; a stim, found in the village and common from Kamenka on, stops bleeding and gives
  // back 35 (and was adrenaline as well, until the two were parted: see below). (`bandage` was an injector for two days, and a roll of tape
  // before that: it is a bandage again, in every loot table and every pocket.)
  // (2026-10-11, asked: "stims should be common in mid tier loot and in hospitals and should stack, bandages stack
  // to 5, stims stack to 3". Each is still found, given and sold one at a time: `fresh`. Five in one place of a
  // pocket, and one is used off the pile.)
  { id: 'bandage', name: 'Bandage', model: 'medical_tape', w: 1, h: 1, weight: 0.06, category: 'medical', stack: 5, fresh: 1, desc: 'A rolled field dressing. Bound on, it stops bleeding and gives back 10 health.', use: { verb: 'Apply', time: 3.2, stopBleed: true, health: 10, sound: 'bandage' },
    // (What stops bleeding is what a fight is lost for want of: a bandage is in houses, shops and barracks too.)
    // A clinic leans on bandages and stims, with a kit or two; the hospital is where the kits are, and stims by the shelf.
    loot: { pair: 'BandageDressing', at: [16, 3, 66, 2, 3], lifetime: 2400, restock: 240, usage: ['Medic', 'Hospital', 'Shop', ...HOMES, 'Military', 'Police', 'Hunting', 'Farm'], favour: { Medic: 26, Hospital: 2, Shop: 1.5, Military: 2 }, lean: 0.6 },
    worth: 3, sells: 3,
  },
  // Two injectors, told apart by the barrel (2026-10-13: "currently the stims give you health and stamina, they
  // should be 2 seperate items. the yellow one is stamina, the white one (default is HP). i think something got
  // confused and you mixed the effect for the yellow stim"). The white one, the model as it came, is for a wound:
  // it stops bleeding and gives back 35. The yellow one is adrenaline and nothing else: it fills your breath, and
  // for ten seconds nothing costs any. (`stim` was both, with a yellow barrel, from 2026-10-10: whoever had one
  // has the white one now.)
  { id: 'stim', name: 'Health Stim', model: 'syringe', w: 1, h: 1, weight: 0.06, category: 'medical', stack: 3, fresh: 1, desc: 'Clotting agent and a painkiller in one spring-loaded shot, its barrel white. Stops bleeding and gives back 35 health.', use: { verb: 'Use', time: 2.4, stopBleed: true, health: 35, hold: true, sound: 'inject' },
    loot: { pair: 'Morphine', at: [0, 3, 92, 3, 4], lifetime: 3000, restock: 360, usage: ['Medic', 'Hospital', 'Military', 'Police', ...HOMES], favour: { Medic: 16, Hospital: 6, Military: 3, Police: 2 } },
    worth: 11,
  },
  { id: 'stim_stamina', name: 'Stamina Stim', model: 'syringe', paint: 0xf0bd12, w: 1, h: 1, weight: 0.06, category: 'medical', stack: 3, fresh: 1, desc: 'Adrenaline in a spring-loaded shot, its barrel yellow. Fills your stamina, and for ten seconds after it nothing you do costs any. It does nothing for a wound.', use: { verb: 'Use', time: 2.4, stamina: 100, boost: 10, hold: true, sound: 'inject' },
    // (the yellow one, for the breath: see items.ts. A soldier's thing as much as a nurse's.)
    loot: { pair: 'Epinephrine', at: [0, 3, 44, 1, 2], lifetime: 3000, restock: 360, usage: ['Medic', 'Hospital', 'Military', 'Police'], favour: { Medic: 10, Hospital: 5, Military: 4 } },
    worth: 9,
  },
  // The two in one (2026-10-13: "users want a new stim variant that gives both hp and stamina, basically the
  // stamina one and the hp one combined, make it pink instead of yellow"). Everything the white one does and
  // everything the yellow one does, at one press, its barrel pink. Where and how many, the same day: "the new
  // hybrid stim will be in loot areas T4 and higher", "medical and military and can stack up to 5 instead of the
  // normal": under the gas and down the bunker and nowhere else (economy.ts, crates.ts), five to a pile where the
  // others are three. A supply drop brings one: what a drop brings is the fourth and fifth steps' already.
  { id: 'stim_combat', name: 'Combat Stim', model: 'syringe', paint: 0xf2559d, w: 1, h: 1, weight: 0.06, category: 'medical', stack: 5, fresh: 1, desc: 'Clotting agent, a painkiller and adrenaline in one spring-loaded shot, its barrel pink. Stops bleeding, gives back 35 health, fills your stamina, and for ten seconds after it nothing you do costs any.', use: { verb: 'Use', time: 2.4, stopBleed: true, health: 35, stamina: 100, boost: 10, hold: true, sound: 'inject' },
    // (the pink one, both at once: see items.ts. 2026-10-13: "the new hybrid stim will be in loot areas T4 and
    // higher", "medical and military": under the gas and down the bunker, where the army and its medics were, and on
    // no step below. Six in the whole world where there are eighty-odd of the white, and a quarter of an hour
    // coming back.)
    loot: { pair: 'Epinephrine', at: [0, 0, 0, 3, 3], lifetime: 3000, restock: 900, usage: ['Military', 'Medic', 'Hospital'], favour: { Military: 4, Medic: 4, Hospital: 4 }, lean: 2.5 },
    worth: 22,
  },
  // What gives blood back (2026-10-13: "we need blood bags with iv's now to recover blood faster"; src/sim/blood.ts).
  // Two bags of a drip, out of the "IV Supplies" the user brought in for the hospital: salt water, which is slow,
  // and blood, which is not. Neither closes a wound: a bag run into somebody still bleeding runs out again.
  { id: 'saline', name: 'Saline Bag (IV)', model: 'saline_bag', w: 1, h: 2, weight: 0.55, category: 'medical', desc: 'Half a litre of salt water and the line to run it into your arm. Gives back 750 ml of blood over a minute and a half, and water, as DayZ’s does. It closes no wound: stop the bleeding first.', use: { verb: 'Run in the', time: 5, blood: 750, over: 90, water: 30, sound: 'bandage' },
    // What gives blood back (2026-10-13; src/sim/blood.ts): saline in a clinic and the hospital, and with the army's
    // medics; blood in the hospital before anywhere, a bag or two in a clinic's fridge, and where the best of
    // everything is. (Under the gas every place is spoken for: a stim and a dressing there have made way for them.)
    loot: { pair: 'SalineBagIV', at: [0, 3, 32, 1, 2], restock: 420, usage: ['Medic', 'Hospital', 'Military'], favour: { Medic: 10, Hospital: 5 }, lean: 4 },
    worth: 8,
  },
  { id: 'blood_bag', name: 'Blood Bag (IV)', model: 'blood_bag', w: 2, h: 1, weight: 0.6, category: 'medical', desc: 'A unit of blood and the line to run it into your arm. Gives back 1500 ml of blood in twenty seconds: most of what a bad wound takes. It closes no wound: stop the bleeding first.', use: { verb: 'Run in the', time: 6, blood: 1500, over: 20, sound: 'bandage' },
    loot: { pair: 'BloodBagIV', at: [0, 0, 29, 2, 3], restock: 600, usage: ['Hospital', 'Medic', 'Military'], favour: { Hospital: 12, Medic: 4 }, lean: 2.5 },
    worth: 16,
  },
  { id: 'firstaid', name: 'First Aid Kit', model: 'medical_box', w: 3, h: 2, weight: 0.9, category: 'medical', desc: 'Dressings, antiseptic, a splint and a small bag of saline with its line. Treats wounds properly, sets a broken leg, and gives back 500 ml of blood over a minute.', use: { verb: 'Treat wounds', time: 6, stopBleed: true, health: 45, splint: true, blood: 500, over: 60, sound: 'bandage' },
    loot: { pair: 'FirstAidKit', at: [0, 1, 72, 2, 2], restock: 600, usage: ['Hospital', 'Medic', 'Military', 'Police'], favour: { Hospital: 14, Medic: 3 }, lean: 2 },
    worth: 12, sells: 2,
  },
  // The pouch between the stim and the kit (2026-10-13: "the medikit which is betrween a stim and a medkit its like
  // a small meddkit 2x2"), a soldier's own, out of the packs the user brought in. What each of the three is for, now
  // that blood is not health (src/sim/blood.ts):
  //   the stim           one place, 2.4 s. Closes the wound and gives back 35: the most health for its size and
  //                      its time, and nothing for blood. The one for the middle of a fight.
  //   this pouch         four places, 4 s. Closes the wound, gives back 20, and runs in 500 ml of blood over a
  //                      minute (the small bag of saline in it). The one thing that both stops the bleeding and
  //                      puts back some of what was bled: for when the fight is over and the world has gone grey.
  //   the First Aid Kit  six places, 6 s. Closes the wound, gives back 45, the most at one go, sets a broken
  //                      leg, and runs in the same 500 ml over a minute as the pouch. (It gave no blood until
  //                      2026-10-13: "medkit should recover some blood for the user but bloodbags are superiour
  //                      source of blood".)
  // So none stands in for another: a stim does nothing for somebody bled white; the pouch gives little more than
  // half a stim's health and sets no leg, and is the small one of the two that give blood; the kit is the whole
  // of it, at half as big again and half as long in the using. (By health alone the pouch could not have had a
  // place: twelve stims go where one pouch does. And the bags are still what blood comes back by: a bag of saline
  // is half the pouch's size and gives half as much again, a bag of blood three times as much and three times as
  // fast as either.)
  { id: 'aid_pouch', name: 'First Aid Pouch', model: 'aid_pouch', w: 2, h: 2, weight: 0.45, category: 'medical', desc: 'A soldier\'s own pouch: a pressure dressing, and a small bag of saline with its line. Stops bleeding, gives back 20 health, and gives back 500 ml of blood over a minute.', use: { verb: 'Open the', time: 4, stopBleed: true, health: 20, blood: 500, over: 60, sound: 'bandage' },
    // (The pouch between a stim and the kit: see items.ts. A soldier's own, so it lies where soldiers and constables
    // were before it lies in a clinic. Its places are taken out of the bandages' and the kit's: three bandages on the
    // second step, three bandages and two kits on the third, a kit under the gas and one down the bunker. No more
    // lies on any step than lay there before. In Kamenka the police station and the army's posts are full of what
    // only they keep, and five pouches laid there left the pistols' rounds no shelf in them on half the throws of
    // the dice: there it lies in the hospital and the clinic before an army post, and in no police station.)
    loot: { pair: 'IodineTincture', at: [0, 1, 13, 1, 1], restock: 480, usage: ['Military', 'Police', 'Medic', 'Hospital'], favour: { Military: 6, Police: 4 }, on: { 3: { usage: ['Hospital', 'Medic', 'Military'], favour: { Hospital: 3, Medic: 3, Military: 2 } } }, lean: 2.5 },
    worth: 10,
  },
  { id: 'splint', name: 'Splint Tape', model: 'medical_tape', tint: 0xd9a55c, w: 1, h: 1, weight: 0.12, category: 'medical', desc: 'A roll of tan strapping tape. Bound round a broken leg with whatever is to hand, it lets you run on it again.', use: { verb: 'Splint your leg with', time: 5, splint: true, sound: 'bandage' },
    // (what sets a broken leg and does nothing else: where there are ladders and lofts to fall off, too)
    loot: { pair: 'Splint', at: [5, 1, 48, 1, 2], restock: 420, usage: ['Medic', 'Hospital', 'Shop', ...HOMES, 'Farm', 'Hunting', 'Industrial', 'Police'], favour: { Medic: 6, Hospital: 4, Shop: 2 } },
    worth: 5, sells: 3,
  },
];
