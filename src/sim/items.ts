// Item database. Pure data; shared by the client UI, world spawning and the server.
// Grid sizes follow DayZ conventions (1 cell ~ 10 cm).

export type Category = 'weapon' | 'ammo' | 'food' | 'drink' | 'medical' | 'melee' | 'tool' | 'misc' | 'stash' | 'attachment' | 'clothing';
/** physical equipment slots on the character: weapons and worn gear */
export type Slot = 'primary' | 'secondary' | 'holster' | 'melee' | 'head' | 'face' | 'vest' | 'back' | 'hands' | 'feet';
/** what kind of slot an item fits: long guns fit primary or secondary, gear fits its own slot */
export type SlotKind = 'long' | 'holster' | 'melee' | 'head' | 'face' | 'vest' | 'back' | 'hands' | 'feet';
export const SLOT_KIND: Record<Slot, SlotKind> = {
  primary: 'long', secondary: 'long', holster: 'holster', melee: 'melee',
  head: 'head', face: 'face', vest: 'vest', back: 'back', hands: 'hands', feet: 'feet',
};
export const WEAPON_SLOTS: Slot[] = ['primary', 'secondary', 'holster', 'melee'];
export const GEAR_SLOTS: Slot[] = ['head', 'face', 'vest', 'back', 'hands', 'feet'];
export const ALL_SLOTS: Slot[] = [...WEAPON_SLOTS, ...GEAR_SLOTS];
export const SLOT_LABEL: Record<Slot, string> = {
  primary: 'Primary', secondary: 'Secondary', holster: 'Holster', melee: 'Melee',
  head: 'Head', face: 'Face', vest: 'Vest', back: 'Back', hands: 'Hands', feet: 'Feet',
};

export type AttachSlot = 'optic' | 'muzzle' | 'magazine' | 'wrap' | 'light';

export interface ItemDef {
  id: string;
  name: string;
  desc: string;
  /** Poly Haven model id, or '@name' for a mesh built in code */
  model: string;
  /** node name inside the model when the file contains several objects */
  node?: string;
  /** regular expression over node names (several nodes make up the item) */
  nodeRe?: string;
  /** extra uniform scale for the world model */
  scale?: number;
  w: number;
  h: number;
  weight: number;
  category: Category;
  stack?: number;
  slot?: SlotKind;
  use?: { verb: string; time: number; energy?: number; water?: number; health?: number; stopBleed?: boolean; /** sets a broken leg (see src/sim/injury.ts) */ splint?: boolean; sound: 'eat' | 'drink' | 'bandage' | 'inject' | 'smoke' };
  /** thrown when used: seconds of fuse, damage at the centre, metres it reaches */
  throw?: { fuse: number; damage: number; radius: number };
  /** used, it calls a supply drop down where its user stands (see CALL in src/sim/drops.ts) */
  call?: boolean;
  /** looked through when used: how much of the normal field of view is left (0.2 = five times closer) */
  look?: number;
  /** ergo: how handy it is, 0..100. A handy gun comes up to the eye fast and follows a turn closely; a long heavy one does neither. */
  weapon?: {
    kind: 'rifle' | 'pistol' | 'auto';
    ammo: string;
    capacity: number;
    ergo: number;
    modes?: ('semi' | 'auto')[];
    /** pieces of its model that are only there with an attachment on it (attachment -> pieces), and pieces that never are */
    shows?: Record<string, string[]>;
    never?: string[];
    /** how it is made ready after a shot, where its kind does not say: by hand (a bolt), or by itself */
    action?: 'bolt' | 'self';
    /**
     * What it fires, where that is not what its kind fires (see BALLISTICS in weapons.ts): the
     * speed it leaves at (m/s), how fast the air slows it, what one of them does, the range it
     * is sighted for; how many leave at once, and how wide they go (radians across).
     */
    round?: { muzzleVel: number; drag: number; damage: number; zero: number; pellets?: number; cone?: number };
    /** its kick, and the least time between its shots, as multiples of its kind's */
    kick?: number;
    pace?: number;
    /** fed one at a time into a tube under the barrel, not by a magazine */
    tube?: boolean;
  };
  melee?: { damage: number; range: number; rate: number };
  /** sealed container (ammo box): opening it replaces the item with loose contents */
  open?: { gives: string; qty: number; time: number };
  /** world model shows this many copies of the mesh in a small pile (loose rounds) */
  pile?: number;
  /** worn gear: cargo grid it adds, damage it soaks */
  wear?: { cargo?: [number, number]; /** torso damage multiplier */ armor?: number; /** head damage multiplier */ head?: number; /** fall damage multiplier */ fall?: number; /** extra punch damage */ fist?: number; /** how fast thirst grows, as a multiplier */ thirst?: number; /** over the face, it keeps the gas out (see src/sim/gas.ts) */ gas?: number };
  /** weapon attachment: which weapons take it and where it mounts; what it does to the gun's handling score, and to its kick (a multiplier) */
  attach?: { fits: string[]; slot: AttachSlot; ergo?: number; recoil?: number; /** rounds more than the gun's own magazine holds */ rounds?: number; /** on the muzzle: it quiets the shot and hides the flash */ quiet?: boolean };
  /** camera hint for the icon renderer */
  iconYaw?: number;
}

const D: ItemDef[] = [
  // ---------------------------------------------------------------- weapons
  {
    id: 'mosin', name: 'Sniper Rifle', model: 'sniper', w: 9, h: 2, weight: 4.1, category: 'weapon', slot: 'long',
    desc: 'Bolt-action rifle in 7.62. Five rounds in a box magazine, and the bolt worked by hand after every one. Slow, loud and devastating. Takes a scope, a cheek rest, a suppressor and a light.',
    weapon: { kind: 'rifle', ammo: 'ammo_762', capacity: 5, ergo: 40, shows: { pu_scope: ['scope', 'glass'], rifle_wrap: ['cheekrest'], suppressor_762: ['silencer'] } }, iconYaw: 0,
  },
  {
    id: 'p38', name: 'Pistol 43', model: 'pistol_43', w: 3, h: 2, weight: 0.75, category: 'weapon', slot: 'holster',
    desc: 'Slim 9x19mm pistol. Eight-round magazine. Takes a suppressor, an extended magazine, a holographic sight and a light.',
    weapon: { kind: 'pistol', ammo: 'ammo_9mm', capacity: 8, ergo: 86 }, iconYaw: 0,
  },
  {
    id: 'm9', name: 'M9 Pistol', model: 'm9', w: 3, h: 2, weight: 1.0, category: 'weapon', slot: 'holster',
    desc: 'Full-size 9x19mm service pistol. Fifteen rounds in the magazine, and heavier in the hand for it. Takes a suppressor, an extended magazine, a holographic sight and a light.',
    weapon: { kind: 'pistol', ammo: 'ammo_9mm', capacity: 15, ergo: 74 }, iconYaw: 0,
  },
  {
    id: 'deagle', name: 'Desert Eagle', model: 'desert_eagle', w: 3, h: 2, weight: 2.0, category: 'weapon', slot: 'holster',
    desc: 'A .50 pistol the size of a brick. Seven rounds, a kick to match, and two of them end most arguments. Takes an extended magazine and nothing else.',
    // (a .50 AE leaves at about 440 m/s and hits much harder than a 9 mm: two to the body, where a 9 mm takes three)
    weapon: { kind: 'pistol', ammo: 'ammo_50', capacity: 7, ergo: 56, round: { muzzleVel: 440, drag: 0.0017, damage: 58, zero: 30 }, kick: 2.1, pace: 2.1 }, iconYaw: 0,
  },
  {
    id: 'benelli', name: 'Benelli M3', model: 'benelli_m3', w: 8, h: 2, weight: 3.5, category: 'weapon', slot: 'long',
    desc: 'Twelve-gauge shotgun, self-loading. Seven shells in the tube, nine pellets a shell: nothing is worse to meet in a corridor, and little is less use across a field. Takes a holographic sight, a suppressor and a light.',
    weapon: { kind: 'rifle', ammo: 'ammo_12', capacity: 7, ergo: 52, action: 'self', tube: true, round: { muzzleVel: 400, drag: 0.011, damage: 14, zero: 25, pellets: 9, cone: 0.075 }, kick: 1.3, pace: 1.7, shows: { red_dot: ['sight'], suppressor_12: ['silencer'] } }, iconYaw: 0,
  },
  {
    id: 'ammo_762', name: '7.62x54R Rounds', model: 'bolt_action_rifle_7_62', node: 'bolt_action_rifle_7_62_bullet_54mm', w: 1, h: 1, weight: 0.022, category: 'ammo', stack: 20, scale: 1.25, pile: 5,
    desc: 'Loose full-power rifle cartridges. Load them into a Mosin with R.',
  },
  {
    id: 'ammo_9mm', name: '9x19mm Rounds', model: 'service_pistol', node: 'service_pistol_bullet', w: 1, h: 1, weight: 0.012, category: 'ammo', stack: 25, scale: 1.6, pile: 6,
    desc: 'Loose pistol cartridges. Common among police and military.',
  },
  {
    id: 'ammo_50', name: '.50 AE Rounds', model: 'round_50', w: 1, h: 1, weight: 0.03, category: 'ammo', stack: 14, scale: 1.5, pile: 4,
    desc: 'Loose .50 cartridges. Only the Desert Eagle fires them.',
  },
  {
    id: 'ammo_12', name: '12 Gauge Shells', model: 'shell_12', w: 1, h: 1, weight: 0.045, category: 'ammo', stack: 16, scale: 1.3, pile: 5,
    desc: 'Buckshot: nine pellets a shell. For the shotgun.',
  },
  {
    id: 'box_50', name: '.50 AE Ammo Box', model: 'ammo_box', w: 2, h: 1, weight: 0.5, category: 'ammo', scale: 0.6,
    desc: 'Sealed box of 14 .50 cartridges. Open it to get the rounds out.',
    open: { gives: 'ammo_50', qty: 14, time: 1.5 },
  },
  {
    id: 'box_12', name: '12 Gauge Shell Box', model: 'ammo_box', w: 2, h: 2, weight: 0.8, category: 'ammo', scale: 0.8,
    desc: 'Sealed box of 16 buckshot shells. Open it to get them out.',
    open: { gives: 'ammo_12', qty: 16, time: 1.8 },
  },
  {
    id: 'box_762', name: '7.62x54R Ammo Box', model: 'ammo_box', w: 2, h: 2, weight: 0.6, category: 'ammo', scale: 0.8,
    desc: 'Sealed steel can of 20 rifle cartridges. Open it to get the rounds out.',
    open: { gives: 'ammo_762', qty: 20, time: 1.8 },
  },
  {
    id: 'box_9mm', name: '9x19mm Ammo Box', model: 'ammo_box', w: 2, h: 1, weight: 0.4, category: 'ammo', scale: 0.6,
    desc: 'Sealed box of 25 pistol cartridges. Open it to get the rounds out.',
    open: { gives: 'ammo_9mm', qty: 25, time: 1.5 },
  },
  // ---------------------------------------------------------------- attachments
  {
    id: 'pu_scope', name: 'Rifle Scope 3.5x', model: 'sniper', nodeRe: '^(scope|glass)', w: 2, h: 1, weight: 0.27, category: 'attachment',
    desc: 'A 3.5x telescopic sight for the sniper rifle. What makes the rifle a sniper, and a little slower to bring up.',
    attach: { fits: ['mosin'], slot: 'optic', ergo: -7 },
  },
  {
    id: 'rifle_wrap', name: 'Cheek Rest', model: 'sniper', nodeRe: '^cheekrest', w: 2, h: 1, weight: 0.2, category: 'attachment',
    desc: 'A raised rest for the cheek, strapped to the stock. Steadies the rifle: a quarter less sway, and a surer hold.',
    attach: { fits: ['mosin'], slot: 'wrap', ergo: 6 },
  },
  {
    id: 'suppressor_9', name: '9mm Suppressor', model: '@suppressor', w: 2, h: 1, weight: 0.3, category: 'attachment',
    desc: 'Screw-on sound suppressor for either 9 mm pistol. Much quieter, no muzzle flash, slightly less punch. Softer kick, but the pistol is longer and slower in the hand.',
    attach: { fits: ['p38', 'm9'], slot: 'muzzle', ergo: -8, recoil: 0.85, quiet: true },
  },
  {
    id: 'suppressor_762', name: 'Sniper Suppressor', model: 'sniper', nodeRe: '^silencer', w: 3, h: 1, weight: 0.55, category: 'attachment',
    desc: 'A suppressor for the sniper rifle. A shot with it on is not heard across the valley, and shows no flash: a little less punch, and a longer rifle to swing.',
    attach: { fits: ['mosin'], slot: 'muzzle', ergo: -9, recoil: 0.88, quiet: true },
  },
  {
    id: 'suppressor_12', name: 'Shotgun Suppressor', model: 'benelli_m3', nodeRe: '^silencer', w: 4, h: 1, weight: 0.9, category: 'attachment',
    desc: 'The long can for the shotgun. It takes the worst of the noise and all of the flash, and makes a long gun longer.',
    attach: { fits: ['benelli'], slot: 'muzzle', ergo: -12, recoil: 0.85, quiet: true },
  },
  {
    id: 'red_dot', name: 'Holographic Sight', model: 'holo_sight', w: 2, h: 1, weight: 0.3, category: 'attachment',
    desc: 'A holographic sight: a lit ring and dot that lie on whatever the gun points at. Fits either 9 mm pistol and the shotgun. Faster to aim with than irons.',
    attach: { fits: ['p38', 'm9', 'benelli'], slot: 'optic', ergo: 3 },
  },
  {
    id: 'gun_light', name: 'Weapon Light', model: 'gun_light', w: 1, h: 1, weight: 0.15, category: 'attachment',
    desc: 'A light clamped under the barrel, switched with L. It shows you the dark, and shows the dark where you are. Fits everything but the Desert Eagle.',
    attach: { fits: ['mosin', 'p38', 'm9', 'benelli'], slot: 'light', ergo: -2 },
  },
  {
    id: 'mag_m9_ext', name: 'M9 Extended Magazine', model: 'm9', nodeRe: '^mag', w: 1, h: 2, weight: 0.16, category: 'attachment', scale: 1.15,
    desc: 'Twenty-round magazine for the M9: five more shots before you reload.',
    attach: { fits: ['m9'], slot: 'magazine', ergo: -4, rounds: 5 },
  },
  {
    id: 'mag_deagle_ext', name: 'Desert Eagle Extended Magazine', model: 'desert_eagle', nodeRe: '^mag', w: 1, h: 2, weight: 0.2, category: 'attachment', scale: 1.15,
    desc: 'Ten-round magazine for the Desert Eagle: three more shots before you reload.',
    attach: { fits: ['deagle'], slot: 'magazine', ergo: -4, rounds: 3 },
  },
  {
    id: 'mag_p38_ext', name: 'Pistol 43 Extended Magazine', model: 'pistol_43', nodeRe: '^mag', w: 1, h: 2, weight: 0.12, category: 'attachment', scale: 1.15,
    desc: 'Twelve-round magazine for the Pistol 43: four more shots before you reload.',
    attach: { fits: ['p38'], slot: 'magazine', ergo: -4, rounds: 4 },
  },
  // ---------------------------------------------------------------- melee
  { id: 'hatchet', name: 'Hatchet', model: 'hatchet', w: 1, h: 3, weight: 0.8, category: 'melee', slot: 'melee', desc: 'Chops wood and anything else.', melee: { damage: 45, range: 1.7, rate: 0.75 } },
  { id: 'machete', name: 'Machete', model: 'machete', w: 1, h: 5, weight: 0.6, category: 'melee', slot: 'melee', desc: 'Long blade. Fast swings.', melee: { damage: 38, range: 1.9, rate: 0.55 } },
  { id: 'crowbar', name: 'Crowbar', model: 'crowbar_01', w: 1, h: 4, weight: 1.6, category: 'melee', slot: 'melee', desc: 'Heavy steel. Opens things, closes arguments.', melee: { damage: 42, range: 1.8, rate: 0.85 } },
  { id: 'bat', name: 'Baseball Bat', model: 'baseball_bat', w: 1, h: 6, weight: 0.9, category: 'melee', slot: 'melee', desc: 'Wooden bat.', melee: { damage: 30, range: 2.0, rate: 0.7 } },
  { id: 'knife', name: 'Fish Knife', model: 'fish_knife', w: 1, h: 2, weight: 0.15, category: 'melee', slot: 'melee', desc: 'Thin filleting blade. Quick, short reach.', melee: { damage: 27, range: 1.45, rate: 0.42 } },
  // ---------------------------------------------------------------- food & drink
  { id: 'sprats', name: 'Tinned Sprats', model: 'russian_food_cans_01', node: 'russian_food_cans_01_can_fish', scale: 2.2, w: 1, h: 1, weight: 0.24, category: 'food', desc: 'Smoked sprats in oil. Шпроты.', use: { verb: 'Eat', time: 2.5, energy: 28, water: -2, sound: 'eat' } },
  { id: 'condensed', name: 'Condensed Milk', model: 'russian_food_cans_01', node: 'russian_food_cans_01_can_cond', scale: 2, w: 1, h: 1, weight: 0.4, category: 'food', desc: 'Sweet, thick, calorie dense.', use: { verb: 'Eat', time: 2.5, energy: 34, water: 4, sound: 'eat' } },
  { id: 'beans', name: 'Baked Beans', model: 'long_life_food', node: 'long_life_food_beans', w: 1, h: 2, weight: 0.42, category: 'food', desc: 'A can of baked beans.', use: { verb: 'Eat', time: 3, energy: 36, water: 2, sound: 'eat' } },
  { id: 'tomatoes', name: 'Tinned Tomatoes', model: 'long_life_food', node: 'long_life_food_tomatoes', w: 1, h: 2, weight: 0.4, category: 'food', desc: 'Watery and filling.', use: { verb: 'Eat', time: 2.5, energy: 18, water: 12, sound: 'eat' } },
  { id: 'sardines', name: 'Sardines', model: 'long_life_food', node: 'long_life_food_sardines', w: 2, h: 1, weight: 0.13, category: 'food', desc: 'Flat tin of sardines.', use: { verb: 'Eat', time: 2, energy: 20, water: -1, sound: 'eat' } },
  { id: 'apple', name: 'Apple', model: 'food_apple_01', w: 1, h: 1, weight: 0.15, category: 'food', desc: 'Crisp and sour.', use: { verb: 'Eat', time: 1.5, energy: 10, water: 8, sound: 'eat' } },
  { id: 'milk', name: 'Milk Carton', model: 'long_life_food', node: 'long_life_food_milk', w: 1, h: 2, weight: 1.0, category: 'drink', desc: 'UHT milk. Still sealed.', use: { verb: 'Drink', time: 2.5, energy: 10, water: 30, sound: 'drink' } },
  { id: 'water_jug', name: 'Water Jug', model: 'plastic_bottle_gallon', w: 2, h: 3, weight: 2.2, category: 'drink', desc: 'Two litres of clean water.', use: { verb: 'Drink', time: 3, water: 60, sound: 'drink' } },
  { id: 'flask', name: 'Water Flask', model: 'flask', w: 2, h: 2, weight: 1.1, category: 'drink', desc: 'A soldier\'s litre of water in a hard flask.', use: { verb: 'Drink', time: 2.5, water: 48, sound: 'drink' } },
  { id: 'thermos', name: 'Thermos', model: 'plastic_thermos', w: 1, h: 3, weight: 0.8, category: 'drink', desc: 'Lukewarm tea. Better than nothing.', use: { verb: 'Drink', time: 2.5, water: 35, energy: 5, sound: 'drink' } },
  // ---------------------------------------------------------------- medical
  // (The item is still `bandage`: it is what the roll of tape was, in every loot table and every
  // pocket. What it is now is an auto-injector: quicker than winding a dressing, and it gives
  // something back.)
  { id: 'bandage', name: 'Combat Injector', model: 'syringe', w: 1, h: 1, weight: 0.06, category: 'medical', desc: 'Clotting agent and a painkiller in one spring-loaded shot. Stops bleeding and gives back 15 health.', use: { verb: 'Use', time: 2.4, stopBleed: true, health: 15, sound: 'inject' } },
  { id: 'firstaid', name: 'First Aid Kit', model: 'medical_box', w: 3, h: 2, weight: 0.9, category: 'medical', desc: 'Dressings, antiseptic and a splint. Treats wounds properly, and sets a broken leg.', use: { verb: 'Treat wounds', time: 6, stopBleed: true, health: 45, splint: true, sound: 'bandage' } },
  { id: 'splint', name: 'Splint Tape', model: 'medical_tape', w: 1, h: 1, weight: 0.12, category: 'medical', desc: 'A roll of strapping tape. Bound round a broken leg with whatever is to hand, it lets you run on it again.', use: { verb: 'Splint your leg with', time: 5, splint: true, sound: 'bandage' } },
  // ---------------------------------------------------------------- clothing & bags
  {
    // (still `boonie_hat`, so that what is carried and what is kept in the world still means it: a helmet now)
    id: 'boonie_hat', name: 'Combat Helmet', model: 'combat_helmet', w: 2, h: 2, weight: 1.4, category: 'clothing', slot: 'head',
    desc: 'Ballistic helmet with a mount on the brow and pouches over the ears. Takes three tenths off anything that hits your head: a pistol round there is no longer the end of you.', wear: { head: 0.7 },
  },
  // (cloth on the head: the tier under the helmet. Both were in the game's files and in nobody's hands.)
  {
    id: 'patrol_cap', name: 'Patrol Cap', model: 'patrol_cap', w: 2, h: 1, weight: 0.1, category: 'clothing', slot: 'head',
    desc: 'A soldier\'s field cap. Cloth, not steel: a tenth off what hits your head, and better than nothing.', wear: { head: 0.9 },
  },
  {
    id: 'fishermans_hat', name: 'Boonie Hat', model: 'fishermans_hat', w: 2, h: 1, weight: 0.1, category: 'clothing', slot: 'head',
    desc: 'A soft brimmed hat. A tenth off what hits your head. A helmet is what you want, when you find one.', wear: { head: 0.9 },
  },
  {
    id: 'garden_gloves', name: 'Work Gloves', model: 'garden_gloves_01', w: 2, h: 1, weight: 0.1, category: 'clothing', slot: 'hands',
    desc: 'Canvas gloves from somebody\'s shed. Your punches land a little harder.', wear: { fist: 2 },
  },
  {
    id: 'gasmask', name: 'Gas Mask', model: 'old_gas_mask', w: 2, h: 2, weight: 0.7, category: 'clothing', slot: 'face',
    desc: 'GP-5 pattern mask. Worn on the face, it lets you breathe in the gas. Thick rubber and glass, too: a fifth less damage from anything that hits your head.', wear: { head: 0.8, gas: 1 },
  },
  {
    // (still `life_vest`, which is what was worn here before: it is a plate carrier now)
    id: 'life_vest', name: 'Plate Carrier', model: 'plate_carrier', w: 3, h: 3, weight: 5.2, category: 'clothing', slot: 'vest',
    desc: 'Hard plates front and back, pouches all round. 12 more slots, and 40% less damage from every hit to the body.', wear: { cargo: [4, 3], armor: 0.6 },
  },
  {
    // (still `work_gloves`)
    id: 'work_gloves', name: 'Tactical Gloves', model: 'tactical_gloves', w: 2, h: 1, weight: 0.15, category: 'clothing', slot: 'hands',
    desc: 'Padded leather gloves with hard knuckles. Your punches land harder.', wear: { fist: 5 },
  },
  {
    // (still `rubber_boots`)
    id: 'rubber_boots', name: 'Combat Boots', model: 'combat_boots', w: 2, h: 3, weight: 1.4, category: 'clothing', slot: 'feet',
    desc: 'Laced leather boots with a stiff sole. Cushions a bad landing: a third less fall damage.', wear: { fall: 0.67 },
  },
  {
    // (still `sack_pack`: the smaller of two packs, both the one military backpack at two sizes)
    id: 'sack_pack', name: 'Patrol Pack', model: 'military_backpack', scale: 0.98, w: 3, h: 3, weight: 0.9, category: 'clothing', slot: 'back',
    desc: 'A small camouflage day pack. 16 slots.', wear: { cargo: [4, 4] },
  },
  {
    // (still `suitcase`)
    id: 'suitcase', name: 'Field Rucksack', model: 'military_backpack', scale: 1.22, w: 4, h: 3, weight: 1.8, category: 'clothing', slot: 'back',
    desc: 'A full-size military backpack, with room for 30 slots.', wear: { cargo: [6, 5] },
  },
  // ---------------------------------------------------------------- tools & misc
  { id: 'keycard', name: 'Bunker Keycard', model: '@keycard', w: 1, h: 1, weight: 0.02, category: 'misc', desc: 'Opens the door of Bunker 17, once: the reader keeps it. It goes on foot: no jeep will take you while you carry one.' },
  { id: 'flashlight', name: 'Flashlight', model: 'vintage_flashlight', w: 1, h: 2, weight: 0.4, category: 'tool', desc: 'A battery lantern. Carried anywhere on you, L switches it on: it shines from your chest, wide and not far. It shows you the dark, and shows the dark where you are.' },
  { id: 'binoculars', name: 'Binoculars', model: 'binoculars', w: 2, h: 2, weight: 0.6, category: 'tool', desc: 'Field binoculars. Use them to look five times closer; any other action puts them away.', use: { verb: 'Look through', time: 0.35, sound: 'bandage' }, look: 0.2 },
  { id: 'compass', name: 'Compass', model: 'seadogs_compass', w: 1, h: 1, weight: 0.1, category: 'tool', desc: 'Brass pocket compass. While you carry it, your exact bearing in degrees is shown under the compass strip.' },
  { id: 'watch', name: 'Wrist Watch', model: 'digital_wrist_watch', w: 1, h: 1, weight: 0.05, category: 'tool', desc: 'Still ticking.' },
  { id: 'radio', name: 'Field Radio', model: 'vintage_radio_transceiver', w: 4, h: 3, weight: 6.5, category: 'misc', desc: 'Military transceiver, good for one call: use it under open sky and a supply drop comes down where you stand. Everybody hears it called.', use: { verb: 'Call a drop on the', time: 5, sound: 'bandage' }, call: true },
  { id: 'cigarettes', name: 'Cigarettes', model: 'cigarette_pack', w: 1, h: 1, weight: 0.03, category: 'misc', stack: 5, desc: 'Kentucky Ace. A smoke steadies you: each one gives back 12 health.', use: { verb: 'Smoke', time: 4, health: 12, sound: 'smoke' } },
  { id: 'jerrycan', name: 'Jerrycan', model: 'metal_jerrycan_green', w: 2, h: 3, weight: 8.5, category: 'misc', desc: 'Ten litres of fuel, a quarter of what a jeep holds. Look at a jeep and press G to pour it in.' },
  { id: 'grenade', name: 'Stick Grenade', model: 'stick_grenade', w: 1, h: 3, weight: 0.6, category: 'misc', desc: 'Pull the cord and throw. Four seconds, then everything within nine metres is hurt, you included.', use: { verb: 'Throw', time: 0.75, sound: 'bandage' }, throw: { fuse: 4, damage: 150, radius: 9 } },
  // ---------------------------------------------------------------- identity
  {
    id: 'dogtag', name: 'Dog Tag', model: '@dogtag', scale: 1.5, w: 1, h: 1, weight: 0.02, category: 'misc',
    desc: 'Stamped steel on a ball chain. Every survivor carries their own. Take one off a body and stay alive with it for 10 minutes to cash it in.',
  },
  // ---------------------------------------------------------------- base building
  { id: 'stash_kit', name: 'Stash Case', model: 'weapons_case', w: 4, h: 3, weight: 6, category: 'stash', scale: 0.55, desc: 'A hard case you can put down anywhere (right-click → Place). It stays in the world and keeps whatever you store in it.' },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(D.map((d) => [d.id, d]));

/** an item sitting at a grid position inside a container */
export interface Placed {
  item: ItemInstance;
  x: number;
  y: number;
  rot: boolean;
}

export interface ItemInstance {
  uid: string;
  id: string;
  qty: number;
  /** rounds loaded (weapons) */
  loaded?: number;
  /** attachment item ids fitted to this weapon */
  mods?: string[];
  /** contents of a bag or vest: they stay inside it when it is dropped or handed over */
  cargo?: Placed[];
  /** dog tag: the name stamped on it and that player's public id */
  owner?: string;
  pid?: string;
  /** dog tag: public id of whoever carries it now, and for how many seconds they have */
  holder?: string;
  held?: number;
}

/** seconds somebody else's dog tag has to be carried before it is cashed in */
export const TAG_HOLD = 10 * 60;
/** the same in minutes, for everything that says so in words */
export const TAG_HOLD_MIN = TAG_HOLD / 60;

/** time left on a carried dog tag, as m:ss */
export function tagClock(it: ItemInstance): string {
  const left = Math.max(0, Math.ceil(TAG_HOLD - (it.held ?? 0)));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/** what an item is called: a dog tag carries its owner's name */
export function itemName(it: ItemInstance): string {
  const d = ITEMS[it.id];
  return it.id === 'dogtag' && it.owner ? `${tagOwner(it)}'s Dog Tag` : d.name;
}

/** the name stamped on a tag, safe to put into markup (it was typed by another player) */
export function tagOwner(it: ItemInstance): string {
  return (it.owner ?? '').replace(/[<>&"']/g, '').slice(0, 16) || 'Survivor';
}

let uidCounter = 0;
export function newUid() {
  return `${Date.now().toString(36)}-${(uidCounter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeItem(id: string, qty?: number): ItemInstance {
  const def = ITEMS[id];
  if (!def) throw new Error(`unknown item ${id}`);
  const it: ItemInstance = { uid: newUid(), id, qty: qty ?? (def.stack ? Math.max(1, Math.round(def.stack * 0.6)) : 1) };
  if (def.weapon) it.loaded = 0;
  return it;
}

/**
 * Now and then a gun is found with something already fitted to it: [what, how often], one
 * roll each. The scope is the best thing on the map and stays the rarest: one rifle in
 * forty has one on it. (Each is still found on its own as well: see TYPES in economy.ts.)
 */
export const FITTED: Record<string, [string, number][]> = {
  mosin: [['pu_scope', 0.025], ['rifle_wrap', 0.12], ['suppressor_762', 0.02]],
  p38: [['suppressor_9', 0.08], ['mag_p38_ext', 0.12], ['red_dot', 0.03]],
  m9: [['suppressor_9', 0.06], ['mag_m9_ext', 0.08], ['red_dot', 0.03]],
  deagle: [['mag_deagle_ext', 0.1]],
  benelli: [['red_dot', 0.25], ['gun_light', 0.2]],
};

/** Rolls for what a gun put into the world comes with. @param rnd 0..1, the caller's own dice */
export function fitAtRandom(item: ItemInstance, rnd: () => number): ItemInstance {
  for (const [mod, chance] of FITTED[item.id] ?? []) {
    if (rnd() < chance && !item.mods?.includes(mod)) (item.mods ??= []).push(mod);
  }
  return item;
}

export function hasMod(it: ItemInstance | null | undefined, id: string) {
  return !!it?.mods?.includes(id);
}

/** Is this piece of a gun's model there, with these attachments on the gun? (see `shows` and `never` on the weapon) */
export function pieceShown(id: string, piece: string, mods: string[] = []): boolean {
  const w = ITEMS[id]?.weapon;
  if (!w) return true;
  if (w.never?.includes(piece)) return false;
  for (const [mod, pieces] of Object.entries(w.shows ?? {})) if (pieces.includes(piece)) return mods.includes(mod);
  return true;
}

/** magazine capacity including an extended magazine */
export function capacityOf(it: ItemInstance): number {
  const w = ITEMS[it.id].weapon;
  if (!w) return 0;
  let n = w.capacity;
  for (const m of it.mods ?? []) n += ITEMS[m]?.attach?.rounds ?? 0;
  return n;
}

/** Is something on its muzzle that quiets it? (a quieted shot shows no flash, carries a fraction as far, and hits a little softer) */
export function quietOf(it: ItemInstance | null | undefined): boolean {
  return !!it?.mods?.some((m) => ITEMS[m]?.attach?.quiet);
}

/** weight of an item with everything fitted to it and packed inside it */
/**
 * How a gun handles with what is fitted to it: its handling score (0..100), what it weighs
 * in the hands, and how hard it kicks next to the bare gun. Null for anything that is not a gun.
 */
export function handlingOf(it: ItemInstance | null | undefined): { ergo: number; weight: number; recoil: number } | null {
  const w = it ? ITEMS[it.id]?.weapon : undefined;
  if (!it || !w) return null;
  let ergo = w.ergo, recoil = 1, weight = ITEMS[it.id].weight;
  for (const m of it.mods ?? []) {
    const d = ITEMS[m];
    if (!d) continue;
    ergo += d.attach?.ergo ?? 0;
    recoil *= d.attach?.recoil ?? 1;
    weight += d.weight;
  }
  return { ergo: Math.max(5, Math.min(100, ergo)), weight, recoil };
}

export function itemWeight(it: ItemInstance): number {
  const d = ITEMS[it.id];
  let w = d.weight * (d.stack ? it.qty : 1);
  for (const m of it.mods ?? []) w += ITEMS[m]?.weight ?? 0;
  for (const p of it.cargo ?? []) w += itemWeight(p.item);
  return w;
}

/** drop anything a save refers to that no longer exists */
export function sanitizeItem(it: ItemInstance): ItemInstance | null {
  if (!it || !ITEMS[it.id]) return null;
  if (it.mods) it.mods = it.mods.filter((m) => ITEMS[m]?.attach?.fits.includes(it.id));
  if (it.cargo) {
    it.cargo = it.cargo.filter((p) => p && p.item && sanitizeItem(p.item));
    if (!ITEMS[it.id].wear?.cargo) delete it.cargo;
  }
  return it;
}
