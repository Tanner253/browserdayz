import { GUNS } from './gunplay';
// Item database. Pure data; shared by the client UI, world spawning and the server.
// Grid sizes follow DayZ conventions (1 cell ~ 10 cm).

export type Category = 'weapon' | 'ammo' | 'magazine' | 'food' | 'drink' | 'medical' | 'melee' | 'tool' | 'misc' | 'stash' | 'attachment' | 'clothing';
/**
 * Physical equipment slots on the character: weapons and worn gear. Two things are carried slung on the back
 * (`primary`, `secondary`: a long gun, or something long to hit with), a sidearm in a holster, and that is all the
 * body has places for (2026-10-10, as DayZ has it: there was a place for a melee weapon, and there is not). A
 * knife or a hatchet goes in a pocket like anything else. What is in the hands is whatever was taken into them:
 * see `hold` on the inventory, and the hot keys, which are bound to things and not to places.
 */
export type Slot = 'primary' | 'secondary' | 'holster' | 'head' | 'face' | 'vest' | 'back' | 'hands' | 'feet';
/** what kind of slot an item fits: long things fit either place on the back, gear fits its own slot */
export type SlotKind = 'long' | 'holster' | 'head' | 'face' | 'vest' | 'back' | 'hands' | 'feet';
export const SLOT_KIND: Record<Slot, SlotKind> = {
  primary: 'long', secondary: 'long', holster: 'holster',
  head: 'head', face: 'face', vest: 'vest', back: 'back', hands: 'hands', feet: 'feet',
};
export const WEAPON_SLOTS: Slot[] = ['primary', 'secondary', 'holster'];
export const GEAR_SLOTS: Slot[] = ['head', 'face', 'vest', 'back', 'hands', 'feet'];
export const ALL_SLOTS: Slot[] = [...WEAPON_SLOTS, ...GEAR_SLOTS];
export const SLOT_LABEL: Record<Slot, string> = {
  primary: 'On the back', secondary: 'On the back', holster: 'Holster',
  head: 'Head', face: 'Face', vest: 'Vest', back: 'Back', hands: 'Hands', feet: 'Feet',
};

export type AttachSlot = 'optic' | 'muzzle' | 'magazine' | 'wrap' | 'light' | 'grip';

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
  use?: { verb: string; time: number; energy?: number; water?: number; health?: number; stopBleed?: boolean; /** sets a broken leg (see src/sim/injury.ts) */ splint?: boolean; /** breath given back, in hundredths of all there is */ stamina?: number; /** a bottle: it holds this many drinks (what `water` and `energy` say is one of them), is kept when it is empty, and is filled at a well */ sips?: number; /** seconds afterwards in which nothing costs any breath */ boost?: number; /** taken into the hand first and held there: a click then uses it (see `ready` in src/game/game.ts) */ hold?: boolean; sound: 'eat' | 'drink' | 'bandage' | 'inject' | 'smoke' };
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
    /** rounds in what feeds it: its own tube, or the magazine it is made with (a gun with a bigger one in it holds that one's) */
    capacity: number;
    /**
     * The magazine it is made with, if it is fed by one: a thing of its own (see `mag` on an item), found, carried,
     * filled by hand and put in. A gun with none in it fires what is in its chamber and no more. Without this the
     * gun is fed from its own tube, a round at a time.
     */
    mag?: string;
    ergo: number;
    modes?: ('semi' | 'auto')[];
    /** pieces of its model that are only there with an attachment on it (attachment -> pieces), and pieces that never are */
    shows?: Record<string, string[]>;
    never?: string[];
    /** and pieces that are taken off when an attachment goes on in their place (attachment -> pieces): a brake, for a suppressor */
    hides?: Record<string, string[]>;
    /** how it is made ready after a shot, where its kind does not say: by hand (a bolt), or by itself */
    action?: 'bolt' | 'self';
    // (what it fires, how fast, how it kicks and what its sights are set for: src/sim/gunplay.ts, by its id)
    /** fed one at a time into a tube under the barrel, not by a magazine */
    tube?: boolean;
  };
  melee?: { damage: number; range: number; rate: number };
  /** a magazine: what it is filled with, and how many of them it holds (which guns take it is its `attach.fits`) */
  mag?: { ammo: string; capacity: number };
  /** sealed container (ammo box): opening it replaces the item with loose contents */
  open?: { gives: string; qty: number; time: number };
  /** world model shows this many copies of the mesh in a small pile (loose rounds) */
  pile?: number;
  /** worn gear: cargo grid it adds, damage it soaks */
  wear?: { cargo?: [number, number]; /** torso damage multiplier */ armor?: number; /** head damage multiplier */ head?: number; /** fall damage multiplier */ fall?: number; /** extra punch damage */ fist?: number; /** how fast thirst grows, as a multiplier */ thirst?: number; /** over the face, it keeps the gas out (see src/sim/gas.ts) */ gas?: number };
  /** weapon attachment: which weapons take it and where it mounts; what it does to the gun's handling score, and to its kick (a multiplier) */
  attach?: { fits: string[]; slot: AttachSlot; ergo?: number; recoil?: number; /** on the muzzle: it quiets the shot and hides the flash */ quiet?: boolean };
  /** its model's colours are multiplied by this (0xrrggbb): one model, told apart from another thing made of it */
  tint?: number;
  /** what is white on its model is painted this colour (0xrrggbb) and the rest keeps its own: see whiteTo in src/game/loot.ts */
  paint?: number;
  /** camera hint for the icon renderer */
  iconYaw?: number;
}

const D: ItemDef[] = [
  // ---------------------------------------------------------------- weapons
  {
    id: 'mosin', name: 'Sniper Rifle', model: 'sniper', w: 9, h: 2, weight: 4.1, category: 'weapon', slot: 'long',
    desc: 'Bolt-action rifle in 7.62. Five rounds in a box magazine, and the bolt worked by hand after every one. Slow, loud and devastating. Takes a scope, a cheek rest, a suppressor and a light.',
    weapon: { kind: 'rifle', ammo: 'ammo_762', capacity: 5, mag: 'mag_sniper', ergo: 40, shows: { pu_scope: ['scope', 'glass'], rifle_wrap: ['cheekrest'], suppressor_762: ['silencer'] } }, iconYaw: 0,
  },
  {
    id: 'p38', name: 'Pistol 43', model: 'pistol_43', w: 3, h: 2, weight: 0.75, category: 'weapon', slot: 'holster',
    desc: 'Slim 9x19mm pistol. Eight rounds in its magazine, twelve in the long one. Takes a suppressor, a holographic sight and a light.',
    weapon: { kind: 'pistol', ammo: 'ammo_9mm', capacity: 8, mag: 'mag_p38', ergo: 86 }, iconYaw: 0,
  },
  {
    id: 'm9', name: 'M9 Pistol', model: 'm9', w: 3, h: 2, weight: 1.0, category: 'weapon', slot: 'holster',
    desc: 'Full-size 9x19mm service pistol. Fifteen rounds in its magazine, twenty in the long one, and heavier in the hand for it. Takes a suppressor, a holographic sight and a light.',
    weapon: { kind: 'pistol', ammo: 'ammo_9mm', capacity: 15, mag: 'mag_m9', ergo: 74 }, iconYaw: 0,
  },
  {
    id: 'deagle', name: 'Desert Eagle', model: 'desert_eagle', w: 3, h: 2, weight: 2.0, category: 'weapon', slot: 'holster',
    desc: 'A .50 pistol the size of a brick. Seven rounds in its magazine, ten in the long one, a kick to match, and two of them end most arguments. Nothing else fits it.',
    // (A .50 AE leaves at about 440 m/s. What a round does is its `damage` times how fast it is still going, and
    // nothing as slow as a pistol's does all of it (see where a round lands in src/game/weapons.ts): at 58 this
    // did 50 at the muzzle, and two to the body left a man standing with a sliver. At 82 it does 70: two to the
    // body are the end of anybody not in plates, and of whoever wears the armoured vest, barely.)
    weapon: { kind: 'pistol', ammo: 'ammo_50', capacity: 7, mag: 'mag_deagle', ergo: 56 }, iconYaw: 0,
  },
  {
    id: 'benelli', name: 'Benelli M3', model: 'benelli_m3', w: 8, h: 2, weight: 3.5, category: 'weapon', slot: 'long',
    desc: 'Twelve-gauge shotgun, self-loading. Seven shells in the tube, pushed in one at a time: it takes no magazine. Nine pellets a shell: nothing is worse to meet in a corridor, and little is less use across a field. Takes a holographic sight, a suppressor and a light.',
    weapon: { kind: 'rifle', ammo: 'ammo_12', capacity: 7, ergo: 52, action: 'self', tube: true, shows: { red_dot: ['sight'], suppressor_12: ['silencer'] } }, iconYaw: 0,
  },
  // Ammunition (2026-10-10). Loose rounds lie thirty to a place in a pocket, whatever they are. A box is one place,
  // and holds twenty-five: it is unwrapped in the hands, and what was in it is loose rounds. Rounds go into a
  // magazine by hand, and a magazine into a gun: nothing goes from a pocket into a gun but through one of those,
  // except a shell into the shotgun's tube, and a single round into an empty chamber.
  // The two rifles that fire as long as the trigger is held (2026-10-10). Each is fed by a thirty-round magazine
  // of its own, three cells tall, or by a big one that is two wide; neither goes in a pocket: they are slung on
  // the back. (The AK is drawn from an AK-74M and fires what the box found with it says, 7.62x39.)
  {
    id: 'ak', name: 'AK', model: 'ak', w: 8, h: 3, weight: 3.6, category: 'weapon', slot: 'long',
    desc: 'Assault rifle in 7.62x39. Thirty rounds in its magazine, seventy-five in the drum. It fires for as long as the trigger is held, kicks up and to the right, and hits hard at any range a man is seen at. B changes it to single shots. Takes a holographic sight, a suppressor and the drum.',
    weapon: { kind: 'auto', ammo: 'ammo_739', capacity: 30, mag: 'mag_ak', ergo: 46, modes: ['auto', 'semi'], shows: { mag_ak: ['mag'] } }, iconYaw: 0,
  },
  {
    id: 'ar15', name: 'AR-15', model: 'ar15', w: 7, h: 3, weight: 3.0, category: 'weapon', slot: 'long',
    desc: 'Carbine in 5.56. Thirty rounds in its magazine, sixty in the long one. Faster and flatter than the AK and easier to hold on a target, and each round does less. B changes it to single shots. Takes a holographic sight, a suppressor, a foregrip, a light and the long magazine.',
    weapon: { kind: 'auto', ammo: 'ammo_556', capacity: 30, mag: 'mag_ar', ergo: 62, modes: ['auto', 'semi'], shows: { mag_ar: ['mag'], suppressor_556: ['silencer'], red_dot: ['sight'], foregrip: ['foregrip'], gun_light: ['light'] }, hides: { suppressor_556: ['brake'] } }, iconYaw: 0,
  },
  {
    id: 'ammo_739', name: '7.62x39 Rounds', model: 'bolt_action_rifle_7_62', node: 'bolt_action_rifle_7_62_bullet_54mm', w: 1, h: 1, weight: 0.016, category: 'ammo', stack: 30, scale: 0.95, pile: 5,
    desc: 'Loose rifle cartridges, for the AK. They go into its magazine by hand.',
  },
  {
    id: 'ammo_556', name: '5.56x45 Rounds', model: 'bolt_action_rifle_7_62', node: 'bolt_action_rifle_7_62_bullet_54mm', w: 1, h: 1, weight: 0.012, category: 'ammo', stack: 30, scale: 0.82, pile: 5,
    desc: 'Loose rifle cartridges, small and fast, for the AR-15. They go into its magazine by hand.',
  },
  {
    id: 'box_739', name: '7.62x39 Ammo Box', model: 'ammo_box_739', w: 1, h: 1, weight: 0.45, category: 'ammo',
    desc: 'A sealed box of 25 cartridges for the AK. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_739', qty: 25, time: 2.2 },
  },
  {
    id: 'box_556', name: '5.56x45 Ammo Box', model: 'ammo_box_556', w: 1, h: 1, weight: 0.35, category: 'ammo',
    desc: 'A sealed box of 25 cartridges for the AR-15. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_556', qty: 25, time: 2.2 },
  },
  {
    id: 'ammo_762', name: '7.62x54R Rounds', model: 'bolt_action_rifle_7_62', node: 'bolt_action_rifle_7_62_bullet_54mm', w: 1, h: 1, weight: 0.022, category: 'ammo', stack: 30, scale: 1.25, pile: 5,
    desc: 'Loose full-power rifle cartridges, for the sniper rifle. They go into its magazine by hand.',
  },
  {
    id: 'ammo_9mm', name: '9x19mm Rounds', model: 'service_pistol', node: 'service_pistol_bullet', w: 1, h: 1, weight: 0.012, category: 'ammo', stack: 30, scale: 1.6, pile: 6,
    desc: 'Loose pistol cartridges. Common among police and military. They go into a pistol\'s magazine by hand.',
  },
  {
    id: 'ammo_50', name: '.50 AE Rounds', model: 'round_50', w: 1, h: 1, weight: 0.03, category: 'ammo', stack: 30, scale: 1.5, pile: 4,
    desc: 'Loose .50 cartridges. Only the Desert Eagle fires them.',
  },
  {
    id: 'ammo_12', name: '12 Gauge Shells', model: 'shell_12', w: 1, h: 1, weight: 0.045, category: 'ammo', stack: 30, scale: 1.3, pile: 5,
    desc: 'Buckshot: nine pellets a shell. Pushed into the shotgun\'s tube one at a time.',
  },
  {
    id: 'box_50', name: '.50 AE Ammo Box', model: 'ammo_box_50', w: 1, h: 1, weight: 0.8, category: 'ammo',
    desc: 'A sealed box of 25 .50 cartridges. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_50', qty: 25, time: 2.2 },
  },
  {
    id: 'box_12', name: '12 Gauge Shell Box', model: 'ammo_box_12', w: 1, h: 1, weight: 1.15, category: 'ammo',
    desc: 'A sealed box of 25 buckshot shells. Hold it and unwrap it to get them out.',
    open: { gives: 'ammo_12', qty: 25, time: 2.2 },
  },
  {
    id: 'box_762', name: '7.62x54R Ammo Box', model: 'ammo_box_762', w: 1, h: 1, weight: 0.6, category: 'ammo',
    desc: 'A sealed box of 25 rifle cartridges. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_762', qty: 25, time: 2.2 },
  },
  {
    id: 'box_9mm', name: '9x19mm Ammo Box', model: 'ammo_box_9mm', w: 1, h: 1, weight: 0.33, category: 'ammo',
    desc: 'A sealed box of 25 pistol cartridges. Hold it and unwrap it to get the rounds out.',
    open: { gives: 'ammo_9mm', qty: 25, time: 2.2 },
  },
  // ---------------------------------------------------------------- magazines
  // A thing of its own: found with a gun in it or lying by itself, carried, filled a round at a time and put into
  // the gun it fits. Each is its gun's own magazine, as its gun's model draws it; the long ones are the same drawn
  // a little longer. What it weighs is itself: the rounds in it are weighed with it (see itemWeight).
  {
    id: 'mag_sniper', name: 'Sniper Rifle Magazine', model: 'sniper', nodeRe: '^mag', w: 1, h: 1, weight: 0.12, category: 'magazine',
    desc: 'The five-round box magazine of the sniper rifle.',
    mag: { ammo: 'ammo_762', capacity: 5 }, attach: { fits: ['mosin'], slot: 'magazine' },
  },
  {
    id: 'mag_ak', name: 'AK Magazine', model: 'ak', nodeRe: '^mag', w: 1, h: 3, weight: 0.33, category: 'magazine',
    desc: 'Thirty rounds of 7.62x39 for the AK.',
    mag: { ammo: 'ammo_739', capacity: 30 }, attach: { fits: ['ak'], slot: 'magazine' },
  },
  {
    id: 'drum_ak', name: 'AK Drum Magazine', model: 'ak_drum', w: 2, h: 3, weight: 0.9, category: 'magazine',
    desc: 'A drum of seventy-five rounds for the AK, off a light machine gun. Two and a half magazines without a change, and a rifle that is heavier and slower to bring up for it.',
    mag: { ammo: 'ammo_739', capacity: 75 }, attach: { fits: ['ak'], slot: 'magazine', ergo: -12 },
  },
  {
    id: 'mag_ar', name: 'AR-15 Magazine', model: 'ar15', nodeRe: '^mag', w: 1, h: 3, weight: 0.13, category: 'magazine',
    desc: 'Thirty rounds of 5.56 for the AR-15.',
    mag: { ammo: 'ammo_556', capacity: 30 }, attach: { fits: ['ar15'], slot: 'magazine' },
  },
  {
    id: 'mag_ar_60', name: 'AR-15 60-Round Magazine', model: 'ar_mag_60', w: 2, h: 3, weight: 0.3, category: 'magazine',
    desc: 'Sixty rounds of 5.56 in a magazine four rows thick: two magazines without a change, and a longer one to swing.',
    mag: { ammo: 'ammo_556', capacity: 60 }, attach: { fits: ['ar15'], slot: 'magazine', ergo: -7 },
  },
  {
    id: 'mag_p38', name: 'Pistol 43 Magazine', model: 'pistol_43', nodeRe: '^mag', w: 1, h: 1, weight: 0.08, category: 'magazine',
    desc: 'Eight rounds of 9 mm for the Pistol 43.',
    mag: { ammo: 'ammo_9mm', capacity: 8 }, attach: { fits: ['p38'], slot: 'magazine' },
  },
  {
    id: 'mag_p38_ext', name: 'Pistol 43 Extended Magazine', model: 'pistol_43', nodeRe: '^mag', w: 1, h: 2, weight: 0.12, category: 'magazine', scale: 1.15,
    desc: 'Twelve rounds for the Pistol 43: four more shots before you change it, and a longer grip to draw.',
    mag: { ammo: 'ammo_9mm', capacity: 12 }, attach: { fits: ['p38'], slot: 'magazine', ergo: -4 },
  },
  {
    id: 'mag_m9', name: 'M9 Magazine', model: 'm9', nodeRe: '^mag', w: 1, h: 1, weight: 0.11, category: 'magazine',
    desc: 'Fifteen rounds of 9 mm for the M9.',
    mag: { ammo: 'ammo_9mm', capacity: 15 }, attach: { fits: ['m9'], slot: 'magazine' },
  },
  {
    id: 'mag_m9_ext', name: 'M9 Extended Magazine', model: 'm9', nodeRe: '^mag', w: 1, h: 2, weight: 0.16, category: 'magazine', scale: 1.15,
    desc: 'Twenty rounds for the M9: five more shots before you change it.',
    mag: { ammo: 'ammo_9mm', capacity: 20 }, attach: { fits: ['m9'], slot: 'magazine', ergo: -4 },
  },
  {
    id: 'mag_deagle', name: 'Desert Eagle Magazine', model: 'desert_eagle', nodeRe: '^mag', w: 1, h: 1, weight: 0.15, category: 'magazine',
    desc: 'Seven rounds of .50 for the Desert Eagle.',
    mag: { ammo: 'ammo_50', capacity: 7 }, attach: { fits: ['deagle'], slot: 'magazine' },
  },
  {
    id: 'mag_deagle_ext', name: 'Desert Eagle Extended Magazine', model: 'desert_eagle', nodeRe: '^mag', w: 1, h: 2, weight: 0.2, category: 'magazine', scale: 1.15,
    desc: 'Ten rounds for the Desert Eagle: three more shots before you change it.',
    mag: { ammo: 'ammo_50', capacity: 10 }, attach: { fits: ['deagle'], slot: 'magazine', ergo: -4 },
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
    desc: 'A holographic sight: a lit ring and dot that lie on whatever the gun points at. Fits either 9 mm pistol, the shotgun and both assault rifles. Faster to aim with than irons.',
    attach: { fits: ['p38', 'm9', 'benelli', 'ak', 'ar15'], slot: 'optic', ergo: 3 },
  },
  {
    id: 'gun_light', name: 'Weapon Light', model: 'gun_light', w: 1, h: 1, weight: 0.15, category: 'attachment',
    desc: 'A light clamped to the gun, switched with L. It shows you the dark, and shows the dark where you are. Fits everything but the Desert Eagle and the AK.',
    attach: { fits: ['mosin', 'p38', 'm9', 'benelli', 'ar15'], slot: 'light', ergo: -2 },
  },
  {
    id: 'suppressor_556', name: '5.56 Suppressor', model: 'ar15', nodeRe: '^silencer', w: 3, h: 1, weight: 0.45, category: 'attachment',
    desc: 'A suppressor for the AR-15, in place of its brake. Much quieter and no flash: a little less punch, a softer kick, and a longer rifle to swing.',
    attach: { fits: ['ar15'], slot: 'muzzle', ergo: -7, recoil: 0.88, quiet: true },
  },
  {
    id: 'suppressor_739', name: 'AK Suppressor', model: 'rifle_suppressor', w: 3, h: 1, weight: 0.55, category: 'attachment',
    desc: 'A suppressor for the AK. A burst with it on is not heard across the valley, and shows no flash: a little less punch, a softer kick, and a longer rifle to swing.',
    attach: { fits: ['ak'], slot: 'muzzle', ergo: -9, recoil: 0.88, quiet: true },
  },
  {
    id: 'foregrip', name: 'Foregrip', model: 'ar15', nodeRe: '^foregrip', w: 1, h: 2, weight: 0.12, category: 'attachment',
    desc: 'A grip for the forward hand, clamped under the AR-15. It holds the rifle down when it fires: a fifth less kick, and it comes up a little faster.',
    attach: { fits: ['ar15'], slot: 'grip', ergo: 4, recoil: 0.8 },
  },
  // ---------------------------------------------------------------- melee
  // (The long ones are carried slung on the back, in either of its two places, or in a pack that is tall enough;
  // the hatchet and the knife go in a pocket. Any of them is put on a hot key and taken into the hands with it.)
  { id: 'hatchet', name: 'Hatchet', model: 'hatchet', w: 1, h: 3, weight: 0.8, category: 'melee', desc: 'Chops wood and anything else.', melee: { damage: 45, range: 1.7, rate: 0.75 } },
  { id: 'machete', name: 'Machete', model: 'machete', w: 1, h: 5, weight: 0.6, category: 'melee', slot: 'long', desc: 'Long blade. Fast swings.', melee: { damage: 38, range: 1.9, rate: 0.55 } },
  { id: 'crowbar', name: 'Crowbar', model: 'crowbar_01', w: 1, h: 4, weight: 1.6, category: 'melee', slot: 'long', desc: 'Heavy steel. Opens things, closes arguments.', melee: { damage: 42, range: 1.8, rate: 0.85 } },
  { id: 'bat', name: 'Baseball Bat', model: 'baseball_bat', w: 1, h: 6, weight: 0.9, category: 'melee', slot: 'long', desc: 'Wooden bat.', melee: { damage: 30, range: 2.0, rate: 0.7 } },
  // (2026-10-10: swung as the bat is, in both hands; heavier, a little slower, and its edge bites)
  { id: 'shovel', name: 'Shovel', model: 'shovel', w: 2, h: 6, weight: 1.7, category: 'melee', slot: 'long', desc: 'A short-handled digging shovel with a steel blade. Swung in both hands like a bat: heavier, a little slower, and it hits harder.', melee: { damage: 36, range: 2.0, rate: 0.78 } },
  { id: 'knife', name: 'Fish Knife', model: 'fish_knife', w: 1, h: 2, weight: 0.15, category: 'melee', desc: 'Thin filleting blade. Quick, short reach.', melee: { damage: 27, range: 1.45, rate: 0.42 } },
  // ---------------------------------------------------------------- food & drink
  { id: 'sprats', name: 'Tinned Sprats', model: 'russian_food_cans_01', node: 'russian_food_cans_01_can_fish', scale: 2.2, w: 1, h: 1, weight: 0.24, category: 'food', desc: 'Smoked sprats in oil. Шпроты.', use: { verb: 'Eat', time: 2.5, energy: 28, water: -2, sound: 'eat' } },
  { id: 'condensed', name: 'Condensed Milk', model: 'russian_food_cans_01', node: 'russian_food_cans_01_can_cond', scale: 2, w: 1, h: 1, weight: 0.4, category: 'food', desc: 'Sweet, thick, calorie dense.', use: { verb: 'Eat', time: 2.5, energy: 34, water: 4, sound: 'eat' } },
  { id: 'beans', name: 'Baked Beans', model: 'long_life_food', node: 'long_life_food_beans', w: 1, h: 2, weight: 0.42, category: 'food', desc: 'A can of baked beans.', use: { verb: 'Eat', time: 3, energy: 36, water: 2, sound: 'eat' } },
  { id: 'tomatoes', name: 'Tinned Tomatoes', model: 'long_life_food', node: 'long_life_food_tomatoes', w: 1, h: 2, weight: 0.4, category: 'food', desc: 'Watery and filling.', use: { verb: 'Eat', time: 2.5, energy: 18, water: 12, sound: 'eat' } },
  { id: 'sardines', name: 'Sardines', model: 'long_life_food', node: 'long_life_food_sardines', w: 2, h: 1, weight: 0.13, category: 'food', desc: 'Flat tin of sardines.', use: { verb: 'Eat', time: 2, energy: 20, water: -1, sound: 'eat' } },
  { id: 'apple', name: 'Apple', model: 'food_apple_01', w: 1, h: 1, weight: 0.15, category: 'food', desc: 'Crisp and sour.', use: { verb: 'Eat', time: 1.5, energy: 10, water: 8, sound: 'eat' } },
  { id: 'milk', name: 'Milk Carton', model: 'long_life_food', node: 'long_life_food_milk', w: 1, h: 2, weight: 1.0, category: 'drink', desc: 'UHT milk. Still sealed.', use: { verb: 'Drink', time: 2.5, energy: 10, water: 30, sound: 'drink' } },
  { id: 'water_jug', name: 'Water Jug', model: 'plastic_bottle_gallon', w: 2, h: 3, weight: 2.2, category: 'drink', desc: 'Two litres of clean water: four good drinks. A well fills it again.', use: { verb: 'Drink from the', time: 2.2, water: 20, sips: 4, sound: 'drink' } },
  { id: 'flask', name: 'Water Flask', model: 'flask', w: 2, h: 2, weight: 1.1, category: 'drink', desc: 'A soldier\'s litre of water in a hard flask: three drinks. A well fills it again.', use: { verb: 'Drink from the', time: 2, water: 18, sips: 3, sound: 'drink' } },
  { id: 'thermos', name: 'Thermos', model: 'plastic_thermos', w: 1, h: 3, weight: 0.8, category: 'drink', desc: 'Lukewarm tea, two cups of it. Filled at a well it is water, and still better than nothing.', use: { verb: 'Drink from the', time: 2, water: 20, energy: 3, sips: 2, sound: 'drink' } },
  // ---------------------------------------------------------------- medical
  // Two things for a wound, and the kit (2026-10-10, as asked): a bandage, common from the outskirts on, stops
  // bleeding and gives back 10; a stim, found in the village and common from Kamenka on, stops bleeding and gives
  // back 35, and is the adrenaline it always was. (`bandage` was an injector for two days, and a roll of tape
  // before that: it is a bandage again, in every loot table and every pocket.)
  { id: 'bandage', name: 'Bandage', model: 'medical_tape', w: 1, h: 1, weight: 0.06, category: 'medical', desc: 'A rolled field dressing. Bound on, it stops bleeding and gives back 10 health.', use: { verb: 'Apply', time: 3.2, stopBleed: true, health: 10, sound: 'bandage' } },
  // (an injector with a yellow barrel)
  { id: 'stim', name: 'Stim', model: 'syringe', paint: 0xf0bd12, w: 1, h: 1, weight: 0.06, category: 'medical', desc: 'Clotting agent, a painkiller and adrenaline in one spring-loaded shot, its barrel yellow. Stops bleeding and gives back 35 health; fills your stamina, and for ten seconds after it nothing you do costs any.', use: { verb: 'Use', time: 2.4, stopBleed: true, health: 35, stamina: 100, boost: 10, hold: true, sound: 'inject' } },
  { id: 'firstaid', name: 'First Aid Kit', model: 'medical_box', w: 3, h: 2, weight: 0.9, category: 'medical', desc: 'Dressings, antiseptic and a splint. Treats wounds properly, and sets a broken leg.', use: { verb: 'Treat wounds', time: 6, stopBleed: true, health: 45, splint: true, sound: 'bandage' } },
  { id: 'splint', name: 'Splint Tape', model: 'medical_tape', tint: 0xd9a55c, w: 1, h: 1, weight: 0.12, category: 'medical', desc: 'A roll of tan strapping tape. Bound round a broken leg with whatever is to hand, it lets you run on it again.', use: { verb: 'Splint your leg with', time: 5, splint: true, sound: 'bandage' } },
  // ---------------------------------------------------------------- clothing & bags
  {
    // (still `boonie_hat`, so that what is carried and what is kept in the world still means it: a helmet now)
    id: 'boonie_hat', name: 'Combat Helmet', model: 'combat_helmet', w: 2, h: 2, weight: 1.4, category: 'clothing', slot: 'head',
    desc: 'Ballistic helmet with a mount on the brow and pouches over the ears. Takes three tenths off anything that hits your head: a pistol round there is no longer the end of you.', wear: { head: 0.7 },
  },
  {
    // (2026-10-10: the fifth step's helmet. A sniper's round to the head does 304 at the muzzle; under this it does 97.)
    id: 'helmet_k63', name: 'K6-3 Helmet', model: 'helmet_k63', w: 3, h: 3, weight: 3.6, category: 'clothing', slot: 'head',
    desc: 'A titanium assault helmet with a steel visor: the heaviest there is, and kept in the bunker and nowhere else. Takes two thirds off anything that hits your head. A sniper round there leaves you standing, barely.', wear: { head: 0.32 },
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
  // Armour for the body in four weights, and a rig that is only for carrying. Each takes more off a hit to the
  // body than the one before it, weighs more, and is harder to come by.
  {
    id: 'chest_rig', name: 'Chest Rig', model: 'vest_t0', w: 3, h: 2, weight: 0.9, category: 'clothing', slot: 'vest',
    desc: 'Webbing and a belt of pouches, with a pad behind them. A tenth off every hit to the body, 8 slots, and it weighs next to nothing.', wear: { cargo: [4, 2], armor: 0.9 },
  },
  {
    id: 'soft_vest', name: 'Soft Armour Vest', model: 'vest_t1', w: 3, h: 3, weight: 2.4, category: 'clothing', slot: 'vest',
    desc: 'A policeman\'s soft vest. 15% less damage from every hit to the body, and 4 slots.', wear: { cargo: [2, 2], armor: 0.85 },
  },
  {
    id: 'armor_vest', name: 'Armoured Vest', model: 'vest_t2', w: 3, h: 3, weight: 3.8, category: 'clothing', slot: 'vest',
    desc: 'An army vest with plates sewn in. 28% less damage from every hit to the body, and 6 slots.', wear: { cargo: [3, 2], armor: 0.72 },
  },
  {
    id: 'heavy_armor', name: 'Heavy Armour', model: 'heavy_armor', w: 3, h: 3, weight: 8.5, category: 'clothing', slot: 'vest',
    desc: 'Plates front, back and sides, and a collar. Half the damage from every hit to the body. It weighs what it looks as if it weighs, and carries 6 slots.', wear: { cargo: [3, 2], armor: 0.5 },
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
    // Three packs, small to large. (Still `sack_pack`: the smallest. It was the military backpack's model made
    // small, and was taken for the big one, which is not found below the fourth step of the map: it is the
    // camping pack's now, made small.)
    id: 'sack_pack', name: 'Day Pack', model: 'camping_backpack', scale: 0.72, w: 3, h: 3, weight: 0.8, category: 'clothing', slot: 'back',
    desc: 'A small black day pack that sits close to the back. 16 slots.', wear: { cargo: [4, 4] },
  },
  {
    id: 'camping_pack', name: 'Camping Backpack', model: 'camping_backpack', w: 4, h: 3, weight: 1.5, category: 'clothing', slot: 'back',
    desc: 'A tall black hiking pack with red lacing. 30 slots.', wear: { cargo: [6, 5] },
  },
  {
    // (still `suitcase`: the largest)
    id: 'suitcase', name: 'Field Rucksack', model: 'military_backpack', scale: 1.22, w: 4, h: 3, weight: 2.2, category: 'clothing', slot: 'back',
    desc: 'A full-size military backpack, the biggest there is: 42 slots.', wear: { cargo: [7, 6] },
  },
  // ---------------------------------------------------------------- tools & misc
  { id: 'keycard', name: 'Bunker Keycard', model: '@keycard', w: 1, h: 1, weight: 0.02, category: 'misc', desc: 'Opens the door of Bunker 17, once: the reader keeps it. It goes on foot: no car will take you while you carry one.' },
  { id: 'flashlight', name: 'Flashlight', model: 'vintage_flashlight', w: 1, h: 2, weight: 0.4, category: 'tool', desc: 'A battery lantern. Carried anywhere on you, L switches it on: it shines from your chest, wide and not far. It shows you the dark, and shows the dark where you are.' },
  { id: 'binoculars', name: 'Binoculars', model: 'binoculars', w: 2, h: 2, weight: 0.6, category: 'tool', desc: 'Field binoculars. Use them to look five times closer; any other action puts them away.', use: { verb: 'Look through', time: 0.35, sound: 'bandage' }, look: 0.2 },
  { id: 'compass', name: 'Compass', model: 'seadogs_compass', w: 1, h: 1, weight: 0.1, category: 'tool', desc: 'Brass pocket compass. While you carry it, your exact bearing in degrees is shown under the compass strip.' },
  { id: 'watch', name: 'Wrist Watch', model: 'digital_wrist_watch', w: 1, h: 1, weight: 0.05, category: 'tool', desc: 'Still ticking.' },
  { id: 'radio', name: 'Field Radio', model: 'vintage_radio_transceiver', w: 4, h: 3, weight: 6.5, category: 'misc', desc: 'Military transceiver, good for one call: use it under open sky and a supply drop comes down where you stand. Everybody hears it called.', use: { verb: 'Call a drop on the', time: 5, sound: 'bandage' }, call: true },
  { id: 'cigarettes', name: 'Cigarettes', model: 'cigarette_pack', w: 1, h: 1, weight: 0.03, category: 'misc', stack: 5, desc: 'Kentucky Ace. A smoke steadies you: each one gives back 12 health.', use: { verb: 'Smoke', time: 4, health: 12, sound: 'smoke' } },
  { id: 'jerrycan', name: 'Jerrycan', model: 'metal_jerrycan_green', w: 2, h: 3, weight: 8.5, category: 'misc', desc: 'Ten litres of fuel, a quarter of a tank. Hold it, look at a jeep or a police car, and hold the left button to pour it in.' },
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
  /** a gun: the rounds in it, in its magazine or its tube and the one in its chamber */
  loaded?: number;
  /** a gun fed by a magazine: the one in it (an item's id), or null with none in it. (Not said at all: a gun from before magazines were things, which is given the one it was made with: see sanitizeItem.) */
  mag?: string | null;
  /** a magazine: the rounds in it */
  rounds?: number;
  /** attachment item ids fitted to this weapon (not its magazine: see `mag`) */
  mods?: string[];
  /** a gun whose sights can be set: the range they are set for, metres (not said: how it comes; see GUNS in gunplay.ts) */
  zero?: number;
  /** contents of a bag or vest: they stay inside it when it is dropped or handed over */
  cargo?: Placed[];
  /** dog tag: the name stamped on it and that player's public id */
  owner?: string;
  pid?: string;
  /** dog tag: public id of whoever carries it now, and for how many seconds they have */
  holder?: string;
  held?: number;
  /** a bottle (see `sips`): how many drinks are left in it */
  left?: number;
}

/** seconds somebody else's dog tag has to be carried before it is cashed in */
export const TAG_HOLD = 10 * 60;
/**
 * The Zona is the played part of the map, the dotted line on it (PLAY_AREAS in the world's generator): tags are
 * earned inside it. The country outside is for stashes and for building. A tag taken off somebody and carried
 * over that line is void after this many seconds out there: no sitting out its ten minutes in the hills.
 */
export const TAG_OUT = 15;
/**
 * Seconds somebody has to have been alive before there is a tag on their body at all. Whoever has just arrived
 * has nothing on them worth a reward, and is not to be farmed for one where they are set down.
 */
export const TAG_FRESH = 5 * 60;
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
  if (def.weapon) {
    it.loaded = 0;
    if (def.weapon.mag) it.mag = null;
  }
  if (def.mag) it.rounds = 0;
  if (def.use?.sips) it.left = def.use.sips;
  return it;
}

// ------------------------------------------------------------------ magazines, and what feeds a gun
//
// A gun fed by a magazine holds what its magazine holds and one more, in its chamber. Pull the magazine out of a
// gun that has been firing and one round stays behind: put a full one in and the gun is one over. A gun with no
// magazine in it has its chamber and nothing else. Every count below keeps to that, and nothing here makes a
// round or loses one: what goes into a gun came out of a magazine, and what goes into a magazine came out of a
// pocket.

/** How often a gun put into the world has its magazine in it, and how full that is at most (a share of what it holds). */
export const FOUND_WITH_MAG = { chance: 0.6, full: 0.6 };

/** Is this gun fed by a magazine that comes out? (the others by their own tube, a round at a time) */
export function magFed(id: string): boolean {
  return !!ITEMS[id]?.weapon?.mag;
}

/** what the magazine in a gun holds (0 with none in it, or for a gun that takes none) */
export function magRoom(gun: ItemInstance): number {
  return (gun.mag ? ITEMS[gun.mag]?.mag?.capacity : 0) ?? 0;
}

/** Is there a round in its chamber? (any gun with a round in it has one there: it is the first to go) */
export function chambered(gun: ItemInstance): boolean {
  return (gun.loaded ?? 0) > 0;
}

/** Does this magazine go into this gun? */
export function magFits(mag: ItemInstance | string, gun: ItemInstance | string): boolean {
  const m = ITEMS[typeof mag === 'string' ? mag : mag.id], g = typeof gun === 'string' ? gun : gun.id;
  return !!m?.mag && m.attach?.slot === 'magazine' && m.attach.fits.includes(g);
}

/** A magazine, made with this many rounds in it (no more than it holds). */
export function makeMag(id: string, rounds = 0): ItemInstance {
  const it = makeItem(id);
  it.rounds = Math.max(0, Math.min(ITEMS[id].mag?.capacity ?? 0, Math.floor(rounds)));
  return it;
}

/**
 * One magazine out of a gun and another in (or none in, with `next` null: it is taken out and that is all).
 * The round in the chamber stays where it is.
 * @returns the magazine that came out, with what was in it, or null if there was none in the gun
 */
export function swapMag(gun: ItemInstance, next: ItemInstance | null): ItemInstance | null {
  if (!magFed(gun.id) || (next && !magFits(next, gun))) return null;
  const inChamber = chambered(gun) ? 1 : 0;
  const out = gun.mag ? makeMag(gun.mag, (gun.loaded ?? 0) - inChamber) : null;
  gun.mag = next ? next.id : null;
  gun.loaded = inChamber + (next ? Math.min(next.rounds ?? 0, ITEMS[next.id].mag!.capacity) : 0);
  return out;
}

/**
 * Rounds in a gun as it is put into the world: as many of these as it has room for as it is, which with no
 * magazine in a gun that needs one is none. (No extra one for the chamber: that comes of changing magazines.)
 */
export function stockGun(gun: ItemInstance, rounds: number): ItemInstance {
  const w = ITEMS[gun.id].weapon;
  if (w) gun.loaded = Math.max(0, Math.min(Math.floor(rounds), w.mag ? magRoom(gun) : w.capacity));
  return gun;
}

/**
 * The magazine a reload puts into a gun, of those carried for it: the fullest of the kind that is in it (with none
 * in it, the kind it is made with), if that is fuller than what the gun has; and only failing that, the fullest of
 * any other kind it takes. (It was the fullest of any kind: a rifle with a thirty in it and a drum in the pack was
 * given the drum by every reload, which is nobody's idea of changing a magazine. The big one is put in by hand, or
 * when there is nothing else with a round in it.) Null: nothing carried is fuller than what is in it.
 */
export function nextMag(gun: ItemInstance, carried: ItemInstance[]): ItemInstance | null {
  const w = ITEMS[gun.id]?.weapon;
  if (!w?.mag) return null;
  const inGun = gun.mag ? Math.max(0, (gun.loaded ?? 0) - (chambered(gun) ? 1 : 0)) : 0;
  const fuller = carried.filter((mg) => magFits(mg.id, gun.id) && (mg.rounds ?? 0) > inGun);
  const best = (list: ItemInstance[]) => list.reduce<ItemInstance | null>((a, b) => (!a || (b.rounds ?? 0) > (a.rounds ?? 0) ? b : a), null);
  const kind = gun.mag ?? w.mag;
  return best(fuller.filter((mg) => mg.id === kind)) ?? best(fuller);
}

/** The same for a gun that is to be a gun that fires, whatever the dice said: its magazine is put in it first, if it has none. */
export function loadGun(gun: ItemInstance, rounds: number): ItemInstance {
  const w = ITEMS[gun.id].weapon;
  if (w?.mag && !gun.mag) gun.mag = w.mag;
  return stockGun(gun, rounds);
}

/** How full a magazine found lying by itself is: nothing in it up to FOUND_WITH_MAG.full of what it holds. @param rnd 0..1 */
export function foundMag(mag: ItemInstance, rnd: () => number): ItemInstance {
  const cap = ITEMS[mag.id].mag?.capacity ?? 0;
  mag.rounds = Math.floor(rnd() * (cap * FOUND_WITH_MAG.full + 1));
  return mag;
}

/** Rounds pushed into a magazine. @returns how many went in (what it had room for) */
export function fillMag(mag: ItemInstance, rounds: number): number {
  const room = (ITEMS[mag.id].mag?.capacity ?? 0) - (mag.rounds ?? 0);
  const n = Math.max(0, Math.min(room, Math.floor(rounds)));
  mag.rounds = (mag.rounds ?? 0) + n;
  return n;
}

/** Everything fitted to a gun that its model shows: its attachments, and its magazine. */
export function fittedOf(it: ItemInstance | null | undefined): string[] {
  return it ? [...(it.mods ?? []), ...(it.mag ? [it.mag] : [])] : [];
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
  ak: [['red_dot', 0.1], ['suppressor_739', 0.05], ['drum_ak', 0.04]],
  ar15: [['red_dot', 0.2], ['foregrip', 0.2], ['gun_light', 0.15], ['suppressor_556', 0.06], ['mag_ar_60', 0.05]],
};

/** Rolls for what a gun put into the world comes with. @param rnd 0..1, the caller's own dice */
export function fitAtRandom(item: ItemInstance, rnd: () => number): ItemInstance {
  for (const [mod, chance] of FITTED[item.id] ?? []) {
    // (a long magazine is a magazine: it goes where the magazine goes, with nothing in it yet)
    if (rnd() >= chance) continue;
    if (ITEMS[mod]?.mag) item.mag = mod;
    else if (!item.mods?.includes(mod)) (item.mods ??= []).push(mod);
  }
  // (and more often than not, the one it was made with: a gun found is not always a gun that can be fired twice)
  const w = ITEMS[item.id].weapon;
  if (w?.mag && !item.mag && rnd() < FOUND_WITH_MAG.chance) item.mag = w.mag;
  return item;
}

/** Is this fitted to it? (an attachment, or the magazine that is in it) */
export function hasMod(it: ItemInstance | null | undefined, id: string) {
  return !!it?.mods?.includes(id) || (!!it?.mag && it.mag === id);
}

/** Is this piece of a gun's model there, with these attachments on the gun? (see `shows` and `never` on the weapon) */
export function pieceShown(id: string, piece: string, mods: string[] = []): boolean {
  const w = ITEMS[id]?.weapon;
  if (!w) return true;
  if (w.never?.includes(piece)) return false;
  for (const [mod, pieces] of Object.entries(w.hides ?? {})) if (pieces.includes(piece) && mods.includes(mod)) return false;
  for (const [mod, pieces] of Object.entries(w.shows ?? {})) if (pieces.includes(piece)) return mods.includes(mod);
  return true;
}

/** The most rounds this gun can have in it as it is: its tube's worth, or its magazine's and the one in its chamber. */
export function capacityOf(it: ItemInstance): number {
  const w = ITEMS[it.id].weapon;
  if (!w) return 0;
  return w.mag ? magRoom(it) + 1 : w.capacity;
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
  for (const m of fittedOf(it)) {
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
  for (const m of fittedOf(it)) w += ITEMS[m]?.weight ?? 0;
  // (the rounds in a magazine and in a gun weigh what they weigh loose)
  if (d.mag) w += (it.rounds ?? 0) * (ITEMS[d.mag.ammo]?.weight ?? 0);
  if (d.weapon) w += (it.loaded ?? 0) * (ITEMS[d.weapon.ammo]?.weight ?? 0);
  for (const p of it.cargo ?? []) w += itemWeight(p.item);
  return w;
}

/** drop anything a save refers to that no longer exists */
export function sanitizeItem(it: ItemInstance): ItemInstance | null {
  if (!it || !ITEMS[it.id]) return null;
  // (a bottle from before bottles were counted is a full one)
  const sips = ITEMS[it.id].use?.sips;
  if (sips) it.left = Math.max(0, Math.min(sips, Math.floor(Number(it.left ?? sips))));
  else delete it.left;
  const d = ITEMS[it.id];
  if (d.weapon?.mag) {
    // A gun from before magazines were things had its rounds in itself, and a long magazine among what was fitted
    // to it: it is given that one, or the one it was made with, and keeps what was in it.
    const was = it.mods?.find((m) => magFits(m, it.id));
    if (it.mag === undefined) it.mag = was ?? d.weapon.mag;
    else if (it.mag !== null && !magFits(it.mag, it.id)) it.mag = null;
    it.loaded = Math.max(0, Math.min(capacityOf(it), Math.floor(Number(it.loaded) || 0)));
  } else delete it.mag;
  if (d.mag) it.rounds = Math.max(0, Math.min(d.mag.capacity, Math.floor(Number(it.rounds) || 0)));
  else delete it.rounds;
  // (its sights: one of the ranges that gun's can be set for, or as it comes)
  if (it.zero !== undefined && !(d.weapon && GUNS[it.id]?.zero.includes(it.zero))) delete it.zero;
  if (it.mods) it.mods = it.mods.filter((m) => !ITEMS[m]?.mag && ITEMS[m]?.attach?.fits.includes(it.id));
  if (it.cargo) {
    it.cargo = it.cargo.filter((p) => p && p.item && sanitizeItem(p.item));
    if (!ITEMS[it.id].wear?.cargo) delete it.cargo;
  }
  return it;
}
