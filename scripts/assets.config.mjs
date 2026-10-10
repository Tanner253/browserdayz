// Asset manifest for the vertical slice. Every entry here is CC0 from Poly Haven
// (https://polyhaven.com). The pipeline downloads the source files, compresses
// them for the web and writes public/assets/manifest.json + CREDITS.md.
//
//   res        – source resolution to download from Poly Haven
//   tex        – max texture size after re-encoding (webp)
//   budget     – most triangles the model may have (scans come far denser than a game needs)
//   far        – triangles of the copy drawn from a distance, written as <id>_lod1.glb

export const HDRI = { id: 'kloofendal_48d_partly_cloudy_puresky', res: '4k', envRes: '1k' };

// PBR texture sets: diffuse, OpenGL normal, AO/rough/metal.
export const TEXTURES = {
  // terrain layers
  leafy_grass: { res: '2k', tex: 1024 },
  brown_mud_leaves_01: { res: '2k', tex: 1024 },
  aerial_rocks_02: { res: '2k', tex: 1024 },
  rocks_ground_02: { res: '2k', tex: 1024 },
  // architecture
  worn_mossy_plasterwall: { res: '2k', tex: 1024 },
  red_brick_plaster_patch_02: { res: '2k', tex: 1024 },
  weathered_plank_siding: { res: '2k', tex: 1024 },
  weathered_planks: { res: '2k', tex: 1024 },
  damaged_plaster: { res: '2k', tex: 1024 },
  painted_plaster_wall: { res: '2k', tex: 1024 },
  wood_floor_worn: { res: '2k', tex: 1024 },
  old_linoleum_flooring_01: { res: '2k', tex: 1024 },
  concrete_floor_worn_001: { res: '2k', tex: 1024 },
  rusty_corrugated_iron: { res: '2k', tex: 1024 },
  clay_roof_tiles_02: { res: '2k', tex: 1024 },
  dirty_concrete: { res: '2k', tex: 1024 },
  asphalt_02: { res: '2k', tex: 1024 },
  // bark for procedural trees
  pine_bark: { res: '1k', tex: 1024 },
  bark_brown_02: { res: '1k', tex: 1024 },
};

/**
 * Models that are not from Poly Haven. Their files are put in assets-src/models/<id>/ by
 * hand (the glTF download, unpacked), and the credit their licence asks for goes into
 * CREDITS.md word for word.
 *   file   – the .gltf in that folder
 *   scale  – what brings it to metres
 *   turn   – what brings its nose round to -z, radians about the upright
 *   small  – textures matching this are flat colour and are kept tiny
 * A vehicle is written out in the pieces the game moves: `body`, `glass`, `helm` (the
 * steering wheel) and `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`, each wheel about its
 * own middle, the whole standing on y = 0 with the middle of its wheelbase at the origin.
 * Anything else is a thing that stands still (see scripts/props.mjs for its settings); its
 * credit is read out of the licence that came with the download.
 */
export const LOCAL_MODELS = {
  // Out of the packs of 2026-10-09. What goes on a gun is laid with its length along x (the
  // way a barrel runs in a gun's own file) and left life size; where it sits on each gun is
  // said in the game (src/game/weapons.ts).
  gun_light: {
    dir: 'gun_attachments',
    only: /^FlashLight/,
    rot: [0, Math.PI / 2, 0],
    scale: 1,
    tex: 512,
    tags: ['loot', 'attachment'],
    changes: 'Only its flashlight is used here: laid along the barrel, stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  rifle_suppressor: {
    dir: 'gun_attachments',
    only: /^Supressor/,
    rot: [0, Math.PI / 2, 0],
    scale: 1,
    tex: 512,
    tags: ['loot', 'attachment'],
    changes: 'Only its suppressor is used here: laid along the barrel, stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  holo_sight: {
    dir: 'eotech_exps3',
    scale: 0.01,
    tex: 1024,
    tags: ['loot', 'attachment'],
    changes: 'Scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed. In the game it is drawn smaller than life where it is fitted to a pistol.',
  },
  flask: {
    dir: 'bottle_pouch',
    only: /^portable_bottle_portable_bottle_pouch/,
    size: 0.22,
    tex: 1024,
    budget: 6000,
    tags: ['loot', 'drink'],
    changes: 'Only the bottle is used, without its pouch: stood on the ground about its own middle, brought down to about six thousand triangles; textures re-encoded as WebP; geometry compressed.',
  },
  round_50: {
    dir: 'desert_eagle',
    // (the cartridge and its case; not the ejector, whose name begins the same way)
    only: /^Bullet(Case)?_low/,
    scale: 0.01,
    tex: 256,
    tags: ['loot', 'ammo'],
    changes: 'Only its cartridge is used here: scaled to metres and stood on the ground; textures re-encoded as WebP; geometry compressed.',
  },
  shell_12: {
    dir: 'benelli_m3',
    only: /^Shell_Low/,
    scale: 1,
    tex: 512,
    tags: ['loot', 'ammo'],
    changes: 'Only its shell is used here: stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  plate_carrier: {
    dir: 'plate_carrier',
    size: 0.56,
    tex: 1024,
    metal: 0,
    rough: 0.92,
    tags: ['loot', 'gear'],
    changes: 'Scaled to metres and stood on the ground; its texture re-encoded as WebP; geometry compressed.',
  },
  weapons_case: {
    dir: 'weapons_container',
    size: 1.25,
    tex: 2048,
    tags: ['prop', 'crate'],
    changes: 'Scaled to metres and stood on the ground; textures re-encoded as WebP; geometry compressed.',
  },
  // (two things out of the suit the player's body is made of: as they lie about to be found)
  patrol_cap: {
    dir: 'tactical_suit',
    only: /GreenCap/,
    size: 0.33,
    tex: 512,
    tags: ['loot', 'gear'],
    changes: 'The suit is put onto the skeleton of the game\'s own character by scripts/suit.mjs: every point of it is moved from the joints it was made on to that skeleton\'s, and stretched along the bones that are longer there. Its cap and its boots are also used alone, standing still, as things to be found. Textures re-encoded as WebP at a quarter of their size; geometry compressed; its own animation is not used.',
  },
  // The helmet off a soldier cast in one piece: there is no helmet in the download to take, so
  // what stands above its rim is cut out of the whole (the statue stood 1.8 m tall, facing +x,
  // the middle of its head 17.5 cm forward of its own middle: it carries a pack). The rim is
  // over the goggles in front, down over the ears at the sides, and above the collar behind.
  combat_helmet: {
    dir: 'tactical_soldier',
    cut: {
      tall: 1.8,
      keep: (x, y, z) => {
        if (Math.abs(z) > 0.145 || x < 0 || x > 0.36) return false;
        const fwd = x - 0.175;
        // (from the brow down to the pouch over the ear, along under it, and up again to the nape)
        const ramp = (a, b, ya, yb) => ya + ((yb - ya) * (fwd - a)) / (b - a);
        const rim = fwd > 0.09 ? 1.63 : fwd > 0.055 ? ramp(0.055, 0.09, 1.562, 1.63) : fwd > -0.045 ? 1.562 : fwd > -0.068 ? ramp(-0.068, -0.045, 1.618, 1.562) : 1.618;
        // (behind the ears, low down, the straps of its pack come up beside the helmet: not those)
        if (fwd < -0.062 && y < 1.628 && Math.abs(z) > 0.118) return false;
        return y > rim;
      },
    },
    size: 0.3,
    tex: 2048,
    budget: 7000,
    plain: true,
    both: true,
    metal: 0.2,
    rough: 0.72,
    tags: ['loot', 'gear'],
    changes: "Only its helmet is used: what stands above the helmet's rim is cut out of the statue, scaled to metres and stood on the ground, and brought down to about seven thousand triangles. Its colour texture is re-encoded as WebP; its glint map is left out.",
  },
  combat_boots: {
    dir: 'tactical_suit',
    only: /Mil_Suit_R5\.002/,
    pair: true,
    size: 0.3,
    tex: 512,
    tags: ['loot', 'gear'],
    changes: '',
  },
  tactical_gloves: {
    dir: 'tactical_gloves_sf',
    budget: 5000,
    size: 0.27,
    tex: 1024,
    tags: ['loot', 'gear'],
    changes: 'Scaled to metres and stood on the ground; brought down to about five thousand triangles; textures re-encoded as WebP; geometry compressed.',
  },
  // The packs of 2026-10-10: a wreck for the helicopter that comes down, a bigger pack, and two whole buildings.
  heli_wreck: {
    dir: 'crashed_helicopter',
    budget: 18000,
    plain: true,
    metal: 0.25,
    rough: 0.8,
    size: 14.8,
    tex: 1024,
    tags: ['prop'],
    changes: 'Stood on the ground about its own middle; brought down to about eighteen thousand triangles; textures re-encoded as WebP at 1024; geometry compressed.',
  },
  camping_backpack: {
    dir: 'camping_backpack',
    size: 0.66,
    tex: 1024,
    tags: ['loot', 'gear'],
    changes: 'Scaled to metres and stood on the ground; textures re-encoded as WebP; geometry compressed.',
  },
  house_interior: {
    dir: 'building_interior',
    size: 14.6,
    tex: 2048,
    tags: ['prop'],
    changes: 'Stood on the ground about its own middle; its texture re-encoded as WebP at 2048; geometry compressed.',
  },
  // (inspired by a game's barrack and not taken out of it: the owner of this project says so, 2026-10-10)
  // (It is a shell, and its windows and its door are boards with pictures of them on. Those boards are taken out:
  // the game hangs a door there that opens and puts glass in the windows, and lines the inside. See `hut` in
  // src/world/buildings.ts, where the same openings are written down.)
  old_barrack: {
    dir: 'old_barrack',
    cut: {
      tall: 4.72,
      drop: (a, b, c) => {
        const all = (f) => f(a) && f(b) && f(c);
        return all((v) => Math.abs(Math.abs(v[2]) - 2.28) < 0.03 && Math.abs(v[0]) < 5.6 && v[1] > 0.9 && v[1] < 2.5) || all((v) => Math.abs(v[0] - 6.56) < 0.03 && v[2] > -1.9 && v[2] < -0.8 && v[1] < 2.3);
      },
    },
    size: 15.07,
    tex: 2048,
    tags: ['prop'],
    changes: 'Stood on the ground about its own middle; the boards its windows and its door were painted on taken out (ten windows and a door: 22 triangles); its texture re-encoded as WebP at 2048; geometry compressed.',
  },
  // Armour for the body, lightest to heaviest (the tiers are in src/sim/items.ts): three vests out of one pack, and
  // the collared vest out of another. And containers and a crate, a piece at a time.
  vest_t0: {
    dir: 'vest_holster_pack',
    only: /^Vest_T0/,
    size: 0.56,
    tex: 1024,
    tags: ['loot', 'gear'],
    changes: 'One vest of the pack: scaled to a body and stood on the ground; textures re-encoded as WebP; geometry compressed.',
  },
  vest_t1: {
    dir: 'vest_holster_pack',
    only: /^Vest_1_T1/,
    size: 0.56,
    tex: 1024,
    tags: ['loot', 'gear'],
    changes: 'One vest of the pack: scaled to a body and stood on the ground; textures re-encoded as WebP; geometry compressed.',
  },
  vest_t2: {
    dir: 'vest_holster_pack',
    only: /^Vest_1_T2/,
    size: 0.56,
    tex: 1024,
    tags: ['loot', 'gear'],
    changes: 'One vest of the pack: scaled to a body and stood on the ground; textures re-encoded as WebP; geometry compressed.',
  },
  heavy_armor: {
    dir: 'body_armor_pack',
    only: /main_002\\.004|pad_002_0|bolt_005|cover_002\\.004|strap_021|pouch_002\\.002|buckle\\.002/,
    size: 0.6,
    budget: 9000,
    tex: 1024,
    tags: ['loot', 'gear'],
    changes: 'The collared vest of the pack alone: scaled to a body and stood on the ground; brought down to about nine thousand triangles; textures re-encoded as WebP; geometry compressed.',
  },
  // The container that can be gone into: the pack's open one, with the leaves it was drawn with cut away (they are
  // hung on it in the game, where they open and shut: see CONTAINER in src/world/buildings.ts).
  container_shell: {
    dir: 'containers_barrels',
    only: /^Object_12 /,
    cut: { tall: 2.2, keep: (x, _y, z) => x > -1.13 && x < 1.33 && z > -3.05 && z < 3.01 },
    size: 6.0,
    tex: 1024,
    tags: ['prop'],
    changes: 'One piece of the pack with its two door leaves cut away, stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  crate_big: {
    dir: 'containers_barrels',
    only: /^Object_32 /,
    size: 1.0,
    tex: 1024,
    tags: ['prop'],
    changes: 'One piece of the pack, stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  shanty_mansion: {
    dir: 'shanty_mansion',
    size: 29.6,
    tex: 1024,
    tags: ['prop'],
    changes: 'Stood on the ground about its own middle; textures re-encoded as WebP at 1024; geometry compressed.',
  },
  military_backpack: {
    dir: 'military_backpack',
    budget: 14000,
    small: /buckle|plate|slider|zipper/,
    size: 0.56,
    tex: 1024,
    tags: ['loot', 'gear'],
    changes: 'Scaled to metres and stood on the ground; brought down to about fourteen thousand triangles; textures re-encoded as WebP, the flat-coloured ones at a small size; geometry compressed.',
  },
  syringe: {
    dir: 'syringe',
    only: /Syringe/,
    size: 0.14,
    tex: 512,
    tags: ['loot'],
    changes: 'Only the syringe is used, taken off its skeleton as it is held at rest and scaled to metres: the arms that came with it and its animation are left out. Textures re-encoded as WebP; geometry compressed.',
  },
  uaz_469: {
    kind: 'vehicle',
    file: 'scene.gltf',
    tex: 2048,
    small: /Glass/,
    scale: 0.01,
    turn: Math.PI,
    tags: ['vehicle'],
    credit: {
      name: 'Uaz-469',
      url: 'https://skfb.ly/6x8RE',
      author: 'Yo.Ri',
      line: '"Uaz-469" (https://skfb.ly/6x8RE) by Yo.Ri is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).',
      changes: 'Scaled to metres and turned to face the way the game drives; each wheel re-centred on its own middle; textures re-encoded as WebP; geometry compressed.',
    },
  },
  // The bunker's own fittings, all out of one download ("Bunker PBR Showcase Props JFG"): each is
  // a few of its shapes, picked out by name and brought to the size of a room three metres high.
  bunker_terminal: { dir: 'bunker_props', only: /^SM_TerminalBaseOnly/, size: 1.5, tex: 2048, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_machine: { dir: 'bunker_props', only: /^SM_Machine_1_(Main|Buttons|Deco|Windows)/, size: 3.6, tex: 2048, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_grate: { dir: 'bunker_props', only: /^SM_GrateRoblox/, size: 1.03, tex: 1024, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_light: { dir: 'bunker_props', only: /^SM_Light_/, size: 0.95, tex: 1024, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_rail: { dir: 'bunker_props', only: /^SM_Rail_1/, size: 1.85, tex: 1024, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_ladder: { dir: 'bunker_props', only: /^SM_MetalLadder/, size: 3.0, tex: 1024, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_pipe: { dir: 'bunker_props', only: /^SM_Tubes_JFG_1_M_/, size: 3.0, tex: 1024, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_pipes: { dir: 'bunker_props', only: /^SM_Tubes_JFG_5/, size: 1.9, tex: 1024, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_chain: { dir: 'bunker_props', only: /^SM_Chain_1/, size: 2.05, tex: 1024, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_cable: { dir: 'bunker_props', only: /^SM_Cable_JFG_3/, size: 6, tex: 1024, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  // What stands over the bunker's stair, and the door at its foot: two more downloads.
  bunker_house: { dir: 'field_bunker', scale: 1, tex: 2048, tags: ['prop'], changes: 'Stood on the ground as it came; textures re-encoded as WebP; geometry compressed.' },
  // (the door came as one shape standing half open: scripts/split-door.mjs makes its frame and its leaf two, the leaf shut)
  bunker_gate_frame: { dir: 'bunker_door_split', only: /Frame/, scale: 0.009, tex: 2048, tags: ['prop'], changes: 'Its frame, taken apart from its leaf; scaled to the doorway and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_gate_leaf: { dir: 'bunker_door_split', only: /Leaf/, scale: 0.009, tex: 2048, tags: ['prop'], changes: 'Its leaf, taken apart from its frame and turned shut; scaled to the doorway and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
};

/**
 * First-person weapon packs that are not from Poly Haven: a gun in rigid pieces, a pair of
 * arms on a skeleton, and one long animation with every movement in it one after another.
 * Each is written out twice:
 *   <id>_fp.glb  the pack as it came (arms, gun, animation), for the hands of whoever holds it
 *   <id>.glb     the gun alone, standing still, in metres with its muzzle toward +x: for the
 *                ground, the icon, and everybody else's view of it
 *   scale     – what brings the pack to metres (or `length`: how long the gun should come out, metres)
 *   forward, up – which way the pack has its muzzle and its top
 *   parts     – node in the pack -> name of the piece in the gun-alone file (what is not named is left out of it)
 *   wrists    – the two wrist joints: the gun-alone file has its origin `origin` (metres, muzzle-right-up
 *               as x-y-z... x along the barrel, y up, z to the right) from the right one, so the hands
 *               of the old models' holders land on the new grip
 *   clips     – where each movement begins and ends in the long animation, in frames at `fps`
 *   skinned   – the gun is one skinned shape: joint -> piece (and the pack's arms are not wanted: `fp: false`)
 *   level     – a piece that runs straight up and down the gun: the gun is rolled about its barrel until it does
 *   fit       – instead of `origin`: put it where another pack's gun is, one piece on the other's (and its
 *               holder's wrists are then that gun's)
 */
export const WEAPON_PACKS = {
  sniper: {
    dir: 'sniper',
    file: 'scene.gltf',
    tex: 2048,
    aloneTex: 1024,
    armsTex: 1024,
    scale: 0.01,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    parts: { base: 'base', scope: 'scope', glass: 'glass', boltrear: 'boltrear', bolt: 'bolt', cheekrest: 'cheekrest', trigger: 'trigger', clip: 'mag', silencer: 'silencer' },
    wrists: { right: 'R_wrist_026', left: 'L_wrist_02' },
    origin: [0.425, 0, -0.034],
    fps: 30,
    // (It has no drawing of its coming up: the rifle is lifted into the picture by the game. What
    // its last frames are is a blow with it, a fast turn of the whole rifle and a slow way back,
    // which was played as the draw until somebody said what it looked like.)
    clips: { fire: [0, 10], bolt: [10, 48], reload: [49, 97], idle: [148, 180], check: [98, 147], melee: [180, 200] },
    credit: {
      name: 'sniper animated',
      url: 'https://sketchfab.com/3d-models/sniper-animated-b48999a250b2433da59f705c371a49b2',
      author: 'DJMaesen',
      line: '"sniper animated" (https://sketchfab.com/3d-models/sniper-animated-b48999a250b2433da59f705c371a49b2) by DJMaesen is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).',
      changes: 'Scaled to metres; its one long animation cut into the movements the game plays; a copy of the rifle alone, standing still, made for the ground and for other players; textures re-encoded as WebP; geometry compressed.',
    },
  },
  m9: {
    dir: 'pistol_m9',
    file: 'scene.gltf',
    tex: 2048,
    aloneTex: 1024,
    armsTex: 1024,
    scale: 1,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    parts: { base: 'base', slide: 'slide', mag: 'mag', hammer: 'hammer', trigger: 'trigger', stopper: 'stopper' },
    wrists: { right: 'R_wrist_028', left: 'L_wrist_03' },
    origin: [0.072, 0.018, -0.032],
    fps: 30,
    clips: { fire: [0, 11], reload: [12, 82], fireLast: [83, 94], reloadEmpty: [95, 175], holster: [176, 187], draw: [187, 233], idle: [234, 264] },
    credit: {
      name: 'animated pistol',
      url: 'https://skfb.ly/ooPqJ',
      author: 'DJMaesen',
      line: '"animated pistol" (https://skfb.ly/ooPqJ) by DJMaesen is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).',
      changes: 'Its one long animation cut into the movements the game plays; a copy of the pistol alone, standing still, made for the ground and for other players; textures re-encoded as WebP; geometry compressed.',
    },
  },
  pistol_43: {
    dir: 'pistol_43',
    file: 'scene.gltf',
    tex: 2048,
    fp: false,
    // (over life size: it is held in hands that were drawn round a bigger pistol, and this is the size at which its grip fills them)
    length: 0.213,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    // set where the other pistol is, slide to slide (the back of it, the top of it): it is held in that pistol's hands
    fit: { to: 'm9', piece: 'slide' },
    // (it is bound to its skeleton held over on its side: stood up by its magazine, which hangs straight down a pistol)
    level: 'mag',
    // (and it is bound a little askew besides, which shows along the sights: under a degree each
    // way, measured in the game along the sides and the underside of its slide once it stood up)
    trim: { yaw: 0.83, pitch: 0.6, roll: 0.4 },
    skinned: { mesh: 'Glock', joints: { Slide_051: 'slide', Magazine_054: 'mag', Bullet_055: 'mag', Magazine2_056: null }, rest: 'base' },
    wrists: { right: 'r_wrist_027', left: 'l_wrist_03' },
    origin: [0.072, 0.018, -0.032],
    credit: {
      name: 'Pistol 43 Tactical | FPS Animations',
      url: 'https://skfb.ly/oMt7u',
      author: 'Vlasov Daniil',
      line: '"Pistol 43 Tactical | FPS Animations" (https://skfb.ly/oMt7u) by Vlasov Daniil is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).',
      changes: 'Only the pistol is used: the arms that came with it, its lights and its animation are left out. The pistol is taken off its skeleton and set in rigid pieces (frame, slide, magazine), scaled to metres; textures re-encoded as WebP; geometry compressed.',
    },
  },
  // The Desert Eagle came as a pistol and nothing else: it is held in the other pistol's
  // hands and moved as that pistol is, like the Pistol 43. Its barrel is part of its frame
  // (the slide runs back round it), and the cartridge that came lying in it is the .50's own model.
  desert_eagle: {
    dir: 'desert_eagle',
    file: 'scene.gltf',
    tex: 2048,
    fp: false,
    length: 0.305,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    fit: { to: 'm9', piece: 'slide' },
    parts: { Group001: 'slide', Magazine_low: 'mag', MagazineBase_low: 'mag', BaseInside_low: 'mag', Barrel_low: 'base', Trigger_low: 'base', Hammer_low: 'base', FrontSight_low: 'base', SlideHolder_low: 'base', Button_03_low: 'base', Button_02_low: 'base', Button_01_low: 'base', SideSwitch_low: 'base', SideSwitchHolder_low: 'base', GripBolt_low: 'base', BackPart_low: 'base', BulletThrow_low: 'base', Frame_low: 'base', Grip_low: 'base' },
    credit: {
      name: 'Desert Eagle',
      url: 'https://sketchfab.com/3d-models/desert-eagle-cabde59f5cf24effaf80536e35d04e95',
      author: 'ELIZION',
      line: 'This work is based on "Desert Eagle" (https://sketchfab.com/3d-models/desert-eagle-cabde59f5cf24effaf80536e35d04e95) by ELIZION (https://sketchfab.com/ELIZION) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'Set in three rigid pieces (frame with its barrel, slide, magazine), scaled to metres and laid along the barrel; the cartridge that came with it is a model of its own. Textures re-encoded as WebP; geometry compressed.',
    },
  },
  // The shotgun, likewise: held in the rifle's hands. Its sight and the long can on its
  // muzzle are pieces of their own, there only when they are fitted.
  benelli_m3: {
    dir: 'benelli_m3',
    file: 'scene.gltf',
    tex: 2048,
    fp: false,
    scale: 1.17,
    forward: [0, 0, -1],
    up: [0, 1, 0],
    fit: { to: 'sniper', piece: 'base' },
    parts: { Benelli_M3: 'base', Eotech: 'sight', Silencel_Low: 'silencer', forend_Low: 'forend' },
    credit: {
      name: 'Benelli M3 Tactical',
      url: 'https://sketchfab.com/3d-models/benelli-m3-tactical-1eaea0239fdf43ad92eb276fbf9c60dd',
      author: 'Amapsis',
      line: 'This work is based on "Benelli M3 Tactical" (https://sketchfab.com/3d-models/benelli-m3-tactical-1eaea0239fdf43ad92eb276fbf9c60dd) by Amapsis (https://sketchfab.com/Amapsis) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'Set in rigid pieces (the gun, its fore-end, its sight, the can on its muzzle) and laid along the barrel; its shell is a model of its own. Textures re-encoded as WebP; geometry compressed.',
    },
  },
};

export const MODELS = {
  // weapons (viewmodels get 2k textures)
  bolt_action_rifle_7_62: { res: '2k', tex: 2048, tags: ['weapon'] },
  service_pistol: { res: '2k', tex: 2048, tags: ['weapon'] },
  ammo_box: { res: '1k', tex: 1024, budget: 2500, tags: ['loot'] },

  // loot
  russian_food_cans_01: { res: '1k', tex: 1024, tags: ['loot'] },
  long_life_food: { res: '1k', tex: 1024, tags: ['loot'] },
  metal_jerrycan_green: { res: '1k', tex: 1024, budget: 4000, tags: ['loot'] },
  plastic_thermos: { res: '1k', tex: 1024, budget: 2500, tags: ['loot'] },
  plastic_bottle_gallon: { res: '1k', tex: 512, budget: 3000, tags: ['loot'] },
  medical_box: { res: '1k', tex: 1024, budget: 2500, tags: ['loot'] },
  medical_tape: { res: '1k', tex: 512, tags: ['loot'] },
  binoculars: { res: '1k', tex: 1024, budget: 4500, tags: ['loot'] },
  hatchet: { res: '1k', tex: 1024, budget: 3000, tags: ['loot'] },
  crowbar_01: { res: '1k', tex: 1024, tags: ['loot'] },
  machete: { res: '1k', tex: 1024, tags: ['loot'] },
  baseball_bat: { res: '1k', tex: 512, tags: ['loot'] },
  old_gas_mask: { res: '1k', tex: 1024, budget: 5000, tags: ['loot'] },
  vintage_flashlight: { res: '1k', tex: 1024, budget: 3500, tags: ['loot'] },
  cigarette_pack: { res: '1k', tex: 512, budget: 1500, tags: ['loot'] },
  food_apple_01: { res: '1k', tex: 512, budget: 1500, tags: ['loot'] },
  can_rusted: { res: '1k', tex: 512, budget: 1500, tags: ['loot'] },
  seadogs_compass: { res: '1k', tex: 512, budget: 3000, tags: ['loot'] },
  digital_wrist_watch: { res: '1k', tex: 512, budget: 3000, tags: ['loot'] },
  stick_grenade: { res: '1k', tex: 512, budget: 2500, tags: ['loot'] },
  vintage_radio_transceiver: { res: '1k', tex: 1024, budget: 5000, tags: ['loot'] },
  fish_knife: { res: '1k', tex: 512, tags: ['loot'] },

  // clothing and bags
  fishermans_hat: { res: '1k', tex: 1024, budget: 4000, tags: ['loot'] },
  life_jacket: { res: '1k', tex: 1024, budget: 4500, tags: ['loot'] },
  rubber_boots: { res: '1k', tex: 1024, budget: 5000, tags: ['loot'] },
  garden_gloves_01: { res: '1k', tex: 512, budget: 3000, tags: ['loot'] },
  vintage_suitcase: { res: '1k', tex: 1024, budget: 5000, tags: ['loot'] },

  // containers / stash
  wooden_military_crate: { res: '1k', tex: 1024, budget: 5000, far: 400, tags: ['prop'] },
  old_military_crate: { res: '1k', tex: 1024, budget: 5000, far: 500, tags: ['prop'] },

  // world props
  covered_car: { res: '1k', tex: 1024, budget: 9000, far: 900, tags: ['prop'] },
  concrete_road_barrier: { res: '1k', tex: 1024, budget: 3000, far: 300, tags: ['prop'] },
  Barrel_01: { res: '1k', tex: 1024, budget: 2682, far: 300, tags: ['prop'] },
  barrel_03: { res: '1k', tex: 1024, budget: 1473, far: 300, tags: ['prop'] },
  wooden_crate_01: { res: '1k', tex: 1024, budget: 3000, far: 300, tags: ['prop'] },
  cardboard_box_01: { res: '1k', tex: 512, budget: 2500, far: 200, tags: ['prop'] },
  metal_trash_can: { res: '1k', tex: 1024, budget: 6000, far: 500, tags: ['prop'] },
  old_tyre: { res: '1k', tex: 512, budget: 2880, far: 300, tags: ['prop'] },
  utility_box_01: { res: '1k', tex: 512, budget: 3000, far: 300, tags: ['prop'] },
  trashbag: { res: '1k', tex: 512, budget: 3000, far: 300, tags: ['prop'] },
  stone_fire_pit: { res: '1k', tex: 1024, budget: 3887, far: 500, tags: ['prop'] },
  wooden_ladder: { res: '1k', tex: 512, budget: 4000, far: 300, tags: ['prop'] },
  street_lamp_01: { res: '1k', tex: 1024, budget: 4000, far: 400, tags: ['prop'] },

  // interiors
  old_bed_frame: { res: '1k', tex: 1024, budget: 6000, far: 500, tags: ['furniture'] },
  WoodenTable_01: { res: '1k', tex: 1024, budget: 952, far: 200, tags: ['furniture'] },
  painted_wooden_table: { res: '1k', tex: 1024, budget: 600, far: 200, tags: ['furniture'] },
  painted_wooden_chair_01: { res: '1k', tex: 512, budget: 724, far: 200, tags: ['furniture'] },
  SchoolChair_01: { res: '1k', tex: 512, budget: 3000, far: 300, tags: ['furniture'] },
  Shelf_01: { res: '1k', tex: 1024, budget: 182, far: 100, tags: ['furniture'] },
  steel_frame_shelves_01: { res: '1k', tex: 1024, budget: 4348, far: 300, tags: ['furniture'] },
  wooden_bookshelf_worn: { res: '1k', tex: 1024, budget: 5000, far: 400, tags: ['furniture'] },
  painted_wooden_cabinet: { res: '1k', tex: 1024, budget: 2227, far: 300, tags: ['furniture'] },
  scandinavian_masonry_heater: { res: '1k', tex: 1024, budget: 5000, far: 400, tags: ['furniture'] },
  metal_office_desk: { res: '1k', tex: 1024, budget: 5000, far: 400, tags: ['furniture'] },
  Television_01: { res: '1k', tex: 512, budget: 1918, far: 300, tags: ['furniture'] },
  electric_stove: { res: '1k', tex: 512, budget: 5000, far: 400, tags: ['furniture'] },

  // nature
  rock_moss_set_01: { res: '1k', tex: 1024, budget: 40000, far: 6000, tags: ['nature'] },
  rock_moss_set_02: { res: '1k', tex: 1024, budget: 40000, far: 6000, tags: ['nature'] },
  boulder_01: { res: '1k', tex: 1024, budget: 9000, far: 1200, tags: ['nature'] },
  tree_stump_01: { res: '1k', tex: 1024, budget: 6000, far: 600, tags: ['nature'] },
  dead_tree_trunk: { res: '1k', tex: 1024, budget: 8000, far: 800, tags: ['nature'] },
  fern_02: { res: '1k', tex: 1024, budget: 3000, far: 300, tags: ['nature'] },
  dry_branches_medium_01: { res: '1k', tex: 1024, budget: 4000, far: 500, tags: ['nature'] },
};
