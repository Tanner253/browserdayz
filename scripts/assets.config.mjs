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
 */
export const LOCAL_MODELS = {
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
    clips: { fire: [0, 10], bolt: [10, 48], reload: [49, 97], draw: [182, 200], idle: [148, 180], check: [98, 147] },
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
