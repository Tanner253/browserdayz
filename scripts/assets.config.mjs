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
  // (2026-10-12: "we need more texture variations for our hand made buildings so they dont all use the same
  // textures". One plaster was under twelve of the paints. Fetched by themselves with `node scripts/textures.mjs`.)
  // walls
  red_brick_03: { res: '2k', tex: 1024 },
  white_bricks: { res: '2k', tex: 1024 },
  // the mountain fort's stone (2026-10-13, fetched on the owner's yes): rough stacked blocks, dressed fortress blocks, an aged defence wall
  castle_wall_slates: { res: '2k', tex: 1024 },
  // (base building's armoured tier, 2026-10-25: dark welded plates of steel, weathered)
  metal_plate_02: { res: '2k', tex: 1024 },
  medieval_blocks_06: { res: '2k', tex: 1024 },
  defense_wall: { res: '2k', tex: 1024 },
  // the desert's ground (2026-10-13, fetched on the owner's word): dry trampled sand, pale desert gravel, the cracked silt of a dry river bed
  sand_01: { res: '2k', tex: 1024 },
  sandy_gravel_02: { res: '2k', tex: 1024 },
  mud_cracked_dry_riverbed_002: { res: '2k', tex: 1024 },
  // the coast and the desert west of the plains (2026-10-16, not yet laid: progress/map3/kit/terrain-hookup.md): wind-rippled
  // sand, a beach's dry sand and its wet, and the layered rock of a canyon's walls. Cracked earth is the riverbed above.
  aerial_beach_01: { res: '2k', tex: 1024 },
  coast_sand_01: { res: '2k', tex: 1024 },
  damp_beach_sand: { res: '2k', tex: 1024 },
  cliff_side: { res: '2k', tex: 1024 },
  // new woods and meadows (2026-10-16, not yet laid: progress/map3/kit/terrain-hookup.md): the pale sandy floor of a dry
  // pine wood, the fresh leaf litter of a beech or oak wood, the dark wet ground of an alder hollow, the roots of an old
  // wood, and thin short grass for a meadow or the steppe toward the desert. Each unlike today's kinds.
  forrest_sand_01: { res: '2k', tex: 1024 },
  leaves_forest_ground: { res: '2k', tex: 1024 },
  mud_forest: { res: '2k', tex: 1024 },
  roots: { res: '2k', tex: 1024 },
  sparse_grass: { res: '2k', tex: 1024 },
  // the mountain's snow, close to (2026-10-13): smooth powdery snowfield. What lies on the ground far off is still colour alone.
  snow_02: { res: '2k', tex: 1024 },
  // the country's ground by what it is (2026-10-13: "spare no expense with textures so that it doesnt look like shit is
  // copy and pasted like our dirt texture is ... different forest floor textures"). See KINDS in src/world/ground.ts.
  // meadow turf, dry grass, and the thin grass and twigs of a wood's edge
  grass_ground: { res: '2k', tex: 1024 },
  withered_grass: { res: '2k', tex: 1024 },
  forrest_ground_01: { res: '2k', tex: 1024 },
  // forest floors: needles under pine, leaves under birch and oak, moss in the damp, dark earth in the hollows
  forrest_ground_03: { res: '2k', tex: 1024 },
  dry_decay_leaves: { res: '2k', tex: 1024 },
  forest_leaves_02: { res: '2k', tex: 1024 },
  forest_ground_06: { res: '2k', tex: 1024 },
  // the trodden earth of a track or a yard, stony ground at the foot of a bank, and the rock of a steep face
  dry_mud_field_001: { res: '2k', tex: 1024 },
  rocky_trail: { res: '2k', tex: 1024 },
  rock_face_03: { res: '2k', tex: 1024 },
  // (the low wooded banks: rock with moss on it, where the bare rock face read as a quarry)
  mossy_rock: { res: '2k', tex: 1024 },
  painted_brick: { res: '2k', tex: 1024 },
  plaster_brick_01: { res: '2k', tex: 1024 },
  rough_plaster_brick_02: { res: '2k', tex: 1024 },
  grey_plaster_02: { res: '2k', tex: 1024 },
  beige_wall_001: { res: '2k', tex: 1024 },
  concrete_block_wall_02: { res: '2k', tex: 1024 },
  concrete_panels: { res: '2k', tex: 1024 },
  // (2026-10-16, the new land's log houses: boards painted the blues and greens of these villages, a shed's pale ones)
  blue_painted_planks: { res: '2k', tex: 1024 },
  green_rough_planks: { res: '2k', tex: 1024 },
  distressed_painted_planks: { res: '2k', tex: 1024 },
  // roofs
  corrugated_iron: { res: '2k', tex: 1024 },
  grey_roof_tiles_02: { res: '2k', tex: 1024 },
  bitumen: { res: '2k', tex: 1024 },
  // floors
  garage_floor: { res: '2k', tex: 1024 },
  concrete_tiles_02: { res: '2k', tex: 1024 },
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
 * `tex` is 2048 at most (the owner, 2026-10-19: "make sure no texture exceeds 2048"; see WEAPON_PACKS).
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
    tex: 2048,
    tags: ['loot', 'attachment'],
    changes: 'Only its flashlight is used here: laid along the barrel, stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  rifle_suppressor: {
    dir: 'gun_attachments',
    only: /^Supressor/,
    rot: [0, Math.PI / 2, 0],
    scale: 1,
    tex: 2048,
    tags: ['loot', 'attachment'],
    changes: 'Only its suppressor is used here: laid along the barrel, stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  // (the AR-15's own magnified sight, fitted to no other gun: 2026-10-17)
  elcan: {
    dir: 'elcan',
    scale: 1,
    tex: 2048,
    tags: ['loot', 'attachment'],
    changes: 'Stood on the ground about its own middle; textures re-encoded as WebP at 2048; geometry compressed.',
    credit: {
      name: 'Elcan Specter TR',
      url: 'https://sketchfab.com/Diamonddogkz',
      author: 'Diamonddogkz',
      line: 'Elcan Specter TR by Diamonddogkz (https://sketchfab.com/Diamonddogkz), Sketchfab Standard licence',
      changes: 'stood on the ground about its own middle, fitted to the AR-15 alone, textures at 2048',
    },
  },
  // (a 1x red dot, on every gun that takes a sight: the owner, 2026-10-18, "i added a red dot sight 1x we need to fit
  // to all the guns that accept scope attachments"; 2026-10-19, "the red dot can go on everything that takes a scope")
  red_dot_1x: {
    scale: 0.001,
    tex: 2048,
    tags: ['loot', 'attachment'],
    changes: 'Scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at 2048; geometry compressed.',
    credit: {
      name: 'FPS Red Dot Sight (Game Model)',
      url: 'https://sketchfab.com/3d-models/fps-red-dot-sight-game-model-0cf999d9363940c2b149dcd80c448554',
      author: 'Michael Makivic',
      line: 'This work is based on "FPS Red Dot Sight (Game Model)" (https://sketchfab.com/3d-models/fps-red-dot-sight-game-model-0cf999d9363940c2b149dcd80c448554) by Michael Makivic (https://sketchfab.com/makivic) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'scaled to metres, stood on the ground about its own middle, fitted to the guns that take a sight, textures at 2048',
    },
  },
  holo_sight: {
    dir: 'eotech_exps3',
    scale: 0.01,
    tex: 2048,
    tags: ['loot', 'attachment'],
    changes: 'Scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed. In the game it is drawn smaller than life where it is fitted to a pistol.',
  },
  flask: {
    dir: 'bottle_pouch',
    only: /^portable_bottle_portable_bottle_pouch/,
    size: 0.22,
    tex: 2048,
    tags: ['loot', 'drink'],
    changes: 'Only the bottle is used, without its pouch: stood on the ground about its own middle, brought down to about six thousand triangles; textures re-encoded as WebP; geometry compressed.',
  },
  round_50: {
    dir: 'desert_eagle',
    // (the cartridge and its case; not the ejector, whose name begins the same way)
    only: /^Bullet(Case)?_low/,
    scale: 0.01,
    tex: 512,
    tags: ['loot', 'ammo'],
    changes: 'Only its cartridge is used here: scaled to metres and stood on the ground; textures re-encoded as WebP; geometry compressed.',
  },
  // A round of 7.62x39 and one of 9 mm (2026-10-11, asked for: "they should be brass, with tips visible"): brass
  // cases with their bullets showing, out of the boxes the rounds are sold in. The rifle's are thirty standing in
  // a tray, all one shape: one of them is taken, the one in the corner. (Said in metres of the tray stood 5.6 cm
  // tall about its own middle: its columns are 1.2 cm apart and its rows 1.4.) The 9 mm is one of the two that
  // came lying loose beside its box.
  round_739: {
    dir: 'ammo_box_rifle',
    only: /^bullets_bullet/,
    cut: { tall: 0.056, keep: (x, _y, z) => x < -0.018 && z > 0.027 },
    size: 0.056,
    tex: 1024,
    tags: ['loot', 'ammo'],
    changes: 'One cartridge out of the thirty in its tray: scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
  },
  // And the rest out of one download of eleven cartridges, each a shape of its own, in millimetres (the user's,
  // 2026-10-11: "heres all the bullets models"): the 9 mm, the 5.56, and a 7.62 NATO for the sniper rifle's round,
  // which is the same bullet in a case a little longer and with a rim. Brass, at the size they came.
  round_9mm: {
    dir: 'cartridges',
    only: /^_9mmHP_low/,
    scale: 0.001,
    tex: 512,
    tags: ['loot', 'ammo'],
    changes: 'Only its 9 mm cartridge is used here: scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
  },
  round_45: {
    dir: 'cartridges',
    only: /^_45ACP_low/,
    scale: 0.001,
    tex: 512,
    tags: ['loot', 'ammo'],
    changes: 'Only its .45 ACP cartridge is used here: scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
  },
  round_556: {
    dir: 'cartridges',
    only: /^_556NATO_low/,
    scale: 0.001,
    tex: 512,
    tags: ['loot', 'ammo'],
    changes: 'Only its 5.56 cartridge is used here: scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
  },
  // (the .50 BMG of the .50s, out of the same download of eleven, 2026-10-17: it was the sniper rifle pack's own round)
  round_50bmg: {
    dir: 'cartridges',
    only: /^_50bmg_low/,
    scale: 0.001,
    tex: 512,
    tags: ['loot', 'ammo'],
    changes: 'Only its .50 BMG cartridge is used here: scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
  },
  round_762: {
    dir: 'cartridges',
    only: /^_762NATO_low/,
    scale: 0.001,
    tex: 512,
    tags: ['loot', 'ammo'],
    changes: 'Only its 7.62 NATO cartridge is used here, for the 7.62x54R round: scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
  },
  shell_12: {
    dir: 'benelli_m3',
    only: /^Shell_Low/,
    scale: 1,
    tex: 2048,
    tags: ['loot', 'ammo'],
    changes: 'Only its shell is used here: stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  // The boxes ammunition is found in (2026-10-10): one to a calibre, each a hand's length, every triangle and every
  // picture as it came. The 9 mm box came with two loose rounds lying beside it: a box is a box, and they are left
  // out. Three are out of one download of nine small boxes drawn for an old console, which is their look: 256
  // pixels is the size they were made.
  ammo_box_9mm: {
    dir: 'ammo_box_9mm',
    only: /^(box|tray|bullet9mm\.001)/,
    size: 0.13,
    tex: 2048,
    tags: ['loot', 'ammo'],
    changes: 'The box, its tray and the rounds in it, without the two loose rounds beside it: scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
  },
  ammo_box_739: {
    dir: 'ammo_box_rifle',
    size: 0.13,
    tex: 2048,
    tags: ['loot', 'ammo'],
    changes: 'Scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at no more than 2048 a side; geometry compressed.',
  },
  // (The .45's box, for the Colt: a Remington box of fifty with its end open and the rounds showing, every round
  // of them a shape of its own. As it came, at the size it came: 17.7 cm long.)
  ammo_box_45: {
    dir: 'ammo_box_45acp',
    scale: 1,
    tex: 2048,
    tags: ['loot', 'ammo'],
    changes: 'Stood on the ground about its own middle; textures re-encoded as WebP at no more than 2048 a side; geometry compressed.',
  },
  ammo_box_50: {
    dir: 'ammo_box_b',
    size: 0.13,
    tex: 1024,
    tags: ['loot', 'ammo'],
    changes: 'Scaled to a hand\'s length and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
  },
  ammo_box_12: {
    dir: 'ammo_boxes_psx',
    only: /^12Cal/,
    size: 0.11,
    tex: 256,
    tags: ['loot', 'ammo'],
    changes: 'Only its 12 gauge box is used here: scaled to metres and stood on the ground about its own middle; its texture re-encoded as WebP at the size it came; geometry compressed.',
  },
  ammo_box_762: {
    dir: 'ammo_boxes_psx',
    only: /^7\.62Cal/,
    size: 0.13,
    tex: 256,
    tags: ['loot', 'ammo'],
    changes: 'Only its 7.62 mm box is used here: scaled to metres and stood on the ground about its own middle; its texture re-encoded as WebP at the size it came; geometry compressed.',
  },
  ammo_box_556: {
    dir: 'ammo_boxes_psx',
    only: /^5\.56Cal/,
    size: 0.13,
    tex: 256,
    tags: ['loot', 'ammo'],
    changes: 'Only its 5.56 mm box is used here: scaled to metres and stood on the ground about its own middle; its texture re-encoded as WebP at the size it came; geometry compressed.',
  },
  // Two magazines that are not their rifle's own (2026-10-10). The AK's drum is the drum of a light machine gun,
  // and all that is used of that gun: 0.0186 brings it to metres (the gun is 57.8 of its units long, and 1.08 m).
  // The AR-15's sixty-round magazine is one of a sheet of magazines drawn plain, in metres already.
  ak_drum: {
    dir: 'rpk_drum',
    only: /RPK_Mag/,
    scale: 0.0186,
    tex: 2048,
    tags: ['loot', 'magazine'],
    changes: 'Only its drum magazine is used here: scaled to metres and stood on the ground about its own middle; its texture re-encoded as WebP at the size it came; geometry compressed.',
  },
  ar_mag_60: {
    dir: 'ar15_magazines',
    only: /^Object_3[12] /,
    scale: 1,
    // (It came as bare colour, a pale grey-green, said to be all metal and with no picture to say how it shines:
    // drawn so, it was a mirror of the sky, nearly white on a black rifle. Painted metal: a little sheen, and its
    // own colour a good deal darker, the dark grey such a magazine is.)
    metal: 0.3,
    rough: 0.6,
    shade: 0.22,
    tags: ['loot', 'magazine'],
    changes: 'Only its sixty-round magazine is used here: stood on the ground about its own middle; its surface made painted metal rather than bare, and its colour darkened (it has no textures); geometry compressed.',
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
    size: 0.27,
    tex: 2048,
    tags: ['loot', 'gear'],
    // (and then scripts/gloves.mjs: run it again after anything rebuilds this model)
    changes: 'Scaled to metres; one glove turned into its pair and both laid flat, one half over the other; textures re-encoded as WebP; geometry compressed.',
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
    // (it came at 4096 and was first brought down to 2048, its brick soft close to, then kept at 4096: 2048 again
    // with every model's, 2026-10-19)
    tex: 2048,
    bare: true,
    rough: 0.9,
    metal: 0,
    tags: ['prop'],
    changes: 'Stood on the ground about its own middle; its colour and its relief re-encoded as WebP at no more than 2048 a side, its other maps left out; geometry compressed.',
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
  // The shovel (2026-10-10): as it came, every triangle and its pictures at their own size. It lies on the ground
  // in its file, 22 degrees off the x axis, its blade toward -x: it is turned along x and then stood on its
  // handle, blade up, the way the bat and the hatchet stand (what is held is held by the foot of it).
  shovel: {
    dir: 'shovel',
    rot: [0, -0.3805, -Math.PI / 2],
    scale: 1,
    tex: 2048,
    tags: ['loot'],
    changes: 'Stood upright on its handle about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
  },
  // The army's tent (2026-10-10): gone into, like a building (see `tent` in src/world/buildings.ts). Its guy ropes
  // and their pegs are taken off: what stops a body in a building that is all a model is the model's own
  // triangles, and a rope nobody sees until they have walked into it is a wall. Its cloth lies within 3 m of its
  // middle line and ends 4.4 m toward its door; the pegs stand 5.5 m out.
  tent_military: {
    dir: 'tent_military',
    // (and the pole that stands on its middle line half a metre inside the doorway: whoever walked in, walked into it)
    cut: { tall: 4.001, keep: (x, y, z) => Math.abs(x) < 3.4 && z < 4.4 && !(Math.abs(x) < 0.06 && y < 3 && z > 0.5 && z < 3.6) },
    scale: 1,
    tex: 2048,
    both: true,
    tags: ['prop'],
    changes: 'Its guy ropes and pegs taken off, and the pole inside its doorway; stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  // The K6-3 (2026-10-10): the heaviest helmet there is. Its brow is toward -z as it comes, which is the way a body
  // faces. It came a hundred units wide: at this it is 29 cm, a size over the combat helmet.
  // Its visor (2026-10-13). It came with its visor raised, standing out from the brow with its glass tipped 40
  // degrees up from straight ahead, and it is wanted down: "it should be like a 90 degree angle on the face visor".
  // The helmet is one mesh of thirty-five islands. The visor is eight of them: its plate with the two lugs it hangs
  // by (the island that reaches furthest forward), the frame bolted on it with the maker's bear on its sides, the two
  // panes of its glass, and four small bolts inside the frame. Its hinge is the line through the two bolts at the
  // temples, level and across the head: 12.1 cm up from the helmet's foot and 3.8 cm behind its middle as it stands.
  // Turned 40 degrees down about that line the glass stands upright, the plate's top edge is level with the brow, and
  // the glass is at the wearer's nose: the eyes are behind the bar over it. So the visor is then raised 3.1 cm, which
  // puts the eyes in the middle of the glass and its lower edge at the chin: in full forward of the temples, and not
  // at all at the lugs, which stay on their bolts (the visor's sides slope by that much over 5.6 cm).
  // The loose end of its chin strap, a strap and the tongue of its buckle, stood out forward and to the right, where
  // the lowered visor is: it is turned back about the ring it is threaded through until it lies along the inside of
  // the right cheek, a centimetre higher, where it meets nothing.
  // (It is down always, a gas mask under it or not: see OVER_MASK in src/game/avatar.ts for how the two sit.)
  // Its glass. The whole helmet came as one see-through material, for the sake of the visor's two panes (a fifth
  // solid in its picture; everything else in it is wholly solid): the panes keep it, the rest is drawn solid.
  helmet_k63: {
    dir: 'helmet_k63',
    isles: {
      tall: 0.2799,
      glass: (lo, hi) => hi[0] < 0.13 && lo[1] > 0.1 && lo[2] < -0.15,
      swing: [
        {
          pick: (lo, hi, tris) => (hi[1] > 0.1 && lo[2] < -0.14) || (tris < 20 && Math.min(Math.abs(lo[0]), Math.abs(hi[0])) > 0.1 && lo[1] > 0.08 && hi[1] < 0.16 && hi[2] < -0.035),
          at: [0, 0.1214, 0.0378],
          axis: [1, 0, 0],
          angle: (-40 * Math.PI) / 180,
          move: [0, 0.0307, 0],
          ease: (_x, _y, z) => (0.0268 - z) / 0.0558,
        },
        {
          pick: (lo, hi) => lo[0] > 0.06 && hi[1] < 0.03 && lo[2] < -0.1 && hi[2] < -0.05,
          at: [0.0725, 0, -0.0597],
          axis: [0, 1, 0],
          angle: (-130 * Math.PI) / 180,
          move: [0, 0.0112, 0.02],
        },
        // (The chin strap, its cup and the short strap with the other half of the buckle hang where a face is. The
        // helmet sits 2 cm further forward on the head than it did, see GEAR in src/game/avatar.ts, and they came
        // with it: the cup stood out through the cheeks. They are 2 cm further back in the helmet, which is where
        // they were on the head.)
        { pick: (lo, hi) => hi[1] < 0.075 && lo[2] > -0.095 && hi[2] < 0.045 && lo[0] > -0.13 && hi[0] < 0.125, move: [0, 0, 0.02] },
      ],
    },
    scale: 0.00279,
    // (as big as its pictures came)
    tex: 2048,
    tags: ['loot', 'gear'],
    changes: 'Scaled to a head and stood on the ground about its own middle; its visor, which came raised, turned down in front of the face about its own hinge and brought up to the eyes, its chin strap set two centimetres further back and the loose end of it laid inside the cheek; its one see-through material kept for the two panes of the visor and made solid for everything else; textures re-encoded as WebP at the size they came; geometry compressed.',
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
    // (a dot in a name is written with ONE backslash: with two, four of these seven never matched, and the vest was
    // shipped as its pads, bolts and straps with no body to it)
    only: /main_002\.004|pad_002_0|bolt_005|cover_002\.004|strap_021|pouch_002\.002|buckle\.002/,
    size: 0.6,
    // (as it was made, within reason: it was brought down to a tenth of its triangles and half its texture size, and looked it)
    budget: 36000,
    tex: 2048,
    tags: ['loot', 'gear'],
    changes: 'The collared vest of the pack alone: scaled to a body and stood on the ground; brought down from eighty-seven thousand triangles to about thirty-six thousand; textures re-encoded as WebP; geometry compressed.',
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
  // (2026-10-16, the new land's towns: a woodcutter's stack of logs, the picket fences of front gardens, what grows in them)
  log_pile: {
    dir: 'log_pile',
    size: 5.0,
    tex: 1024,
    // (stacked a dozen to a sawmill's yard: its 8,400 triangles were too many. Its log ends are blocks as it came: at
    // 5,600 they looked no rounder than at this.)
    budget: 2400,
    tags: ['prop'],
    changes: 'Brought to 5 m long, its triangles thinned to about 3,300 and stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  fence_white: {
    dir: 'fence_pack',
    only: /^FenceStyle1Long_White_Wash_T_0 /,
    size: 2.0,
    tex: 512,
    tags: ['prop'],
    changes: 'One panel of the pack (the white pickets, 2 m), stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  fence_grey: {
    dir: 'fence_pack',
    only: /^FenceStyle2Long_Gray_T_0 /,
    size: 2.0,
    tex: 512,
    tags: ['prop'],
    changes: 'One panel of the pack (the grey railed pickets, 2 m), stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  pumpkin: {
    dir: 'fruit_veg',
    only: /^Pumpkin_Pumpkin_0 /,
    size: 0.42,
    tex: 512,
    tags: ['prop'],
    changes: 'One piece of the pack, brought to life size and stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  cabbage: {
    dir: 'fruit_veg',
    only: /^Cabbage_Cabbage_0 /,
    size: 0.34,
    tex: 512,
    budget: 900,
    tags: ['prop'],
    changes: 'One piece of the pack, brought to life size, its triangles thinned to about 900 and stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.',
  },
  shanty_mansion: {
    dir: 'shanty_mansion',
    // (as it came it was twice the size of a house: a floor of it was five metres high. At this, a floor is 2.7 m.)
    size: 15.8,
    // (they came at 4096: 1024, a sixteenth of their points, was too soft; 2048 with every model's, 2026-10-19)
    tex: 2048,
    bare: true,
    rough: 0.9,
    metal: 0,
    tags: ['prop'],
    changes: 'Stood on the ground about its own middle; its colour re-encoded as WebP at the size it came, its shade maps left out; geometry compressed.',
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
  // The two bags of a drip (2026-10-13: "we need blood bags with iv's now to recover blood faster"). Out of "IV
  // Supplies", one of the downloads the user brought in for the hospital on 2026-10-11 and not used until now.
  blood_bag: { dir: 'iv_supplies', only: /^Blood_Bag_flat/, size: 0.24, tex: 1024, tags: ['loot'], changes: 'Only the bag of blood lying flat is used, scaled to metres and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  // (The pack's own bag of saline is clear plastic, drawn see-through: lying in a pocket or on a shelf it was a
  // shadow. The saline here is the bag of blood with its colour turned from red to the pale blue of salt water.)
  saline_bag: { dir: 'iv_supplies', only: /^Blood_Bag_flat/, size: 0.24, tex: 1024, dye: { hue: 205, saturation: 0.4, brightness: 2.3 }, tags: ['loot'], changes: 'Only the bag lying flat is used, scaled to metres and stood on the ground, and its colour turned from red to pale blue; textures re-encoded as WebP; geometry compressed.' },
  syringe: {
    dir: 'syringe',
    only: /Syringe/,
    size: 0.14,
    tex: 2048,
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
  // The police car (2026-10-10): the second car, a road car. It came 6.7 long, nose toward +z, a quarter of a
  // million triangles, and with its brakes as pieces of their own (four more things called a wheel): those are
  // left out, and it is made the length of the car it is drawn from. Nothing else of it is lessened: every
  // triangle it came with ("i dont want the quality of the models to be lowered"). It was first brought down to
  // sixty thousand triangles and 2048: that was put back; its pictures are 2048 again with every model's (2026-10-19).
  police_car: {
    kind: 'vehicle',
    file: 'scene.gltf',
    tex: 2048,
    scale: 0.806,
    turn: Math.PI,
    wheel: /Wheel\.(Ft|Bk)\./,
    skip: /WheelBrake/,
    tags: ['vehicle'],
    credit: {
      name: 'Police car',
      url: 'https://sketchfab.com/3d-models/police-car-9166b13b6ae341f4bfc093edb71d74f4',
      author: 'Mateusz Woliński',
      line: 'This work is based on "Police car" (https://sketchfab.com/3d-models/police-car-9166b13b6ae341f4bfc093edb71d74f4) by Mateusz Woliński (https://sketchfab.com/jeandiz) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'Scaled to metres and turned to face the way the game drives; each wheel re-centred on its own middle; its brake discs left out; textures re-encoded as WebP at no more than 2048 a side; geometry compressed.',
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
  bunker_cable: { dir: 'bunker_props', only: /^SM_Cable_JFG_3/, size: 6, tex: 1024, tags: ['prop'], changes: 'Only these of its shapes are used here, scaled to the rooms of the bunker and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  // The hospital's fittings and the clinics' (2026-10-11): out of six downloads the user brought in, each a room's
  // worth of things in one file. Each is a few of its shapes picked out by name. (What stands on a floor is
  // 'furniture'; what hangs from a ceiling or on a wall is too, and is put at its height where it is used.)
  hospital_desk: { dir: 'hospital_props', only: /^reseptionDesk/, size: 2.99, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  hospital_pc: { dir: 'hospital_props', only: /^(Keyboard|Microhpone|Mouse|PC|Screen)_/, size: 0.83, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  hospital_bench: { dir: 'hospital_props', only: /^hospitalBench/, size: 2.03, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  water_cooler: { dir: 'hospital_props', only: /^waterCooler/, size: 1.62, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  ward_curtain: { dir: 'hospital_props', only: /^standingCourtains/, size: 2.14, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  ventilator: { dir: 'hospital_props', only: /^anesthesiaVentilator/, size: 1.39, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  computer_cart: { dir: 'hospital_props', only: /^computerCart/, size: 1.49, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  ceiling_arm: { dir: 'hospital_props', only: /^powerInjector/, size: 2.55, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  mop_bucket: { dir: 'hospital_props', only: /^mopBucket/, size: 1.46, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  extinguisher_box: { dir: 'hospital_props', only: /^fireExtinguisherBox/, size: 0.65, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  folded_blanket: { dir: 'hospital_props', only: /^foldedBlanket/, size: 0.36, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  // (the morgue's things were drawn for a room four metres high: brought down to one of three)
  // (And they are steel that mirrors: in a room, where there is no sky to mirror, each was a black shape. Their glint
  // maps are left out and they are said to be dull steel, which takes the light of the room as painted things do.)
  body_lockers: { dir: 'morgue_room', only: /^Locker_2048_/, scale: 0.72, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  autopsy_table: { dir: 'morgue_room', only: /^AutopsyTable_/, scale: 0.72, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  surgical_trolley: { dir: 'morgue_room', only: /^Surgical_Trolley/, scale: 0.8, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  med_cabinet: { dir: 'morgue_room', only: /^Cabinet_LargeSet/, scale: 0.76, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  lab_counter: { dir: 'morgue_room', only: /^Bench_LargeSet/, scale: 0.85, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  med_sink: { dir: 'morgue_room', only: /^Sink_LargeSet/, scale: 0.85, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  surgical_lamp: { dir: 'morgue_room', only: /^Surgical_Lamp/, scale: 0.7, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  autopsy_scales: { dir: 'morgue_room', only: /^Autopsy_Scales/, scale: 0.8, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  covered_body: { dir: 'morgue_room', only: /^Body_SmallGroup/, scale: 0.72, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  instrument_tray: { dir: 'morgue_room', only: /^(Surgical_Tray_SmallGroup|Scissors_SmallGroup|Tool_SmallGroup)/, scale: 0.8, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  // (the autopsy lab's three things, told apart by what each is painted with: a screen of three curtains on wheels,
  // a lamp on a stand, and a steel table: bare, and with a microscope and a rack of tubes on it)
  screen_curtain: { dir: 'autopsy_lab', only: /CurtainDripper_2048/, scale: 1, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  medical_light: { dir: 'autopsy_lab', only: /MedicalLight_1024/, scale: 1, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  steel_table: { dir: 'autopsy_lab', only: /DissectionTable_2048/, scale: 1, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  lab_table: { dir: 'autopsy_lab', only: /DissectionTable_2048|ChemLab_1024/, scale: 1, tex: 2048, plain: true, metal: 0.35, rough: 0.5, tags: ['furniture'], changes: 'Only these of its shapes are used here, stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  xray_viewer: { dir: 'xray_viewer', only: /./, scale: 1, tex: 2048, tags: ['furniture'], changes: 'Only these of its shapes are used here, brought to the size of a room three metres high and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  // What stands over the bunker's stair, and the door at its foot: two more downloads.
  bunker_house: { dir: 'field_bunker', scale: 1, tex: 2048, tags: ['prop'], changes: 'Stood on the ground as it came; textures re-encoded as WebP; geometry compressed.' },
  // (the door came as one shape standing half open: scripts/split-door.mjs makes its frame and its leaf two, the leaf shut)
  bunker_gate_frame: { dir: 'bunker_door_split', only: /Frame/, scale: 0.009, tex: 2048, tags: ['prop'], changes: 'Its frame, taken apart from its leaf; scaled to the doorway and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  bunker_gate_leaf: { dir: 'bunker_door_split', only: /Leaf/, scale: 0.009, tex: 2048, tags: ['prop'], changes: 'Its leaf, taken apart from its frame and turned shut; scaled to the doorway and stood on the ground; textures re-encoded as WebP; geometry compressed.' },
  // The packs of 2026-10-13: ten downloads, every triangle of each and its pictures at the size they came ("i want
  // full first person model quality, do not degrade model quality unless its too large and expensive"). What is
  // worn faces -z, the way a body does and the K6-3 helmet does; what stands against a wall has its front to +z,
  // as the furniture from Poly Haven has; what goes on a gun looks along +x.
  // (The pouch leans six degrees in its file: it is stood straight. The red cross is on its +z face.)
  // A box of pills out of the food pack the owner added (food_collection_-_game_ready.zip, unpacked to
  // assets-src/models/food_collection/): charcoal tablets and multivitamins, told apart by their paint (2026-10-23).
  // What a body gives (2026-10-23, the animals): the downloads the owner fetched, at the size the game wants them.
  meat_steak: { dir: 'meat_rib_kimmen', size: 0.24, tex: 2048, tags: ['loot', 'food'], changes: 'Stood on the ground about its own middle and scaled to a rib steak 24 cm long; textures re-encoded as WebP at 2048 a side (they came at 4096); geometry compressed.' },
  animal_fat: { dir: 'raw_meat_4_plaggy', size: 0.13, tex: 2048, dye: { hue: 12, saturation: 0.3, brightness: 1.45 }, tags: ['loot'], changes: 'Stood on the ground about its own middle and scaled to a piece 13 cm long; its colour turned paler, to fat; textures re-encoded as WebP at 2048 a side (they came at 4096); geometry compressed.' },
  bone_pile: { dir: 'bone_pile_3dsauce', size: 0.42, tex: 1024, tags: ['loot'], changes: 'Stood on the ground about its own middle and scaled to a heap 42 cm across; textures re-encoded as WebP at the size they came; geometry compressed.' },
  // (548,000 triangles as it came, drawn whole near and as a light copy further off: never brought down itself)
  fur_pelt: { dir: 'bear_skin_rug_jepson', size: 2.2, tex: 2048, tags: ['loot'], changes: 'Stood on the ground about its own middle and scaled to a pelt 2.2 m long; a copy of about 7,300 triangles made for seeing it from further off (scripts/lods.mjs), the whole one kept for near; textures re-encoded as WebP at the size they came; geometry compressed.' },
  pill_box: { dir: 'food_collection', only: /SM_Pills_Box_01/, size: 0.09, tex: 512, tags: ['loot'], changes: 'Only its box of pills is used here: stood on the ground about its own middle and scaled to nine centimetres tall; textures re-encoded as WebP at no more than 512 a side (one picture for the whole pack, of which the box is a corner); geometry compressed.' },
  aid_pouch: { dir: 'tactical_first_aid_kit', rot: [0.1013, -0.0337, -0.0034], size: 0.2, tex: 2048, tags: ['loot'], changes: 'Stood straight on the ground about its own middle and scaled to a pouch twenty centimetres tall; textures re-encoded as WebP at the size they came; geometry compressed.' },
  // (The ACOG: life size, 14.3 cm. Its objective is toward -x as it comes, the end its fibre lies along: turned
  // round. It is one shape with one material, drawn see-through: the picture's alpha is 22 in 255 on the clear lid
  // over the fibre, 224 on the objective's glass and 255 everywhere else. Cut at a half, the lid is gone and the red
  // fibre shows as it does through a clear lid; the glass is solid and dark. Drawn solid whole, the lid hid the fibre.
  // Its pictures at 1024 as the heaviest guns' are: 71,000 triangles, where the other sights are 2,000 to 30,000.)
  acog_sight: { dir: 'acog_scope', rot: [0, Math.PI, 0], scale: 1, tex: 1024, solid: 0.5, tags: ['loot', 'attachment'], changes: 'Turned to look along +x and stood on the ground about its own middle, at the size it came; its one material, which came see-through, is cut out where its colour picture is clear (the lid over its fibre) and drawn solid everywhere else; textures re-encoded as WebP at no more than 512 a side (one picture for the whole pack, of which the box is a corner); geometry compressed.' },
  // (The M1: its shell, the band round it and the four cartridges tucked into the band; its chin straps and their
  // buckle hang a hand below the rim and are left off, as nothing holds them to a chin. Its brow is toward +z as it
  // comes: turned round. Its biggest picture is 1024.)
  helmet_m1: { dir: 'm1_helmet', only: / (Helm|Helmband|Patrone)$/, rot: [0, Math.PI, 0], scale: 1, tex: 1024, tags: ['loot', 'gear'], changes: 'Its shell, its band and the cartridges in the band, without its chin straps: turned to face -z and stood on the ground about its own middle, at the size it came; its materials put from specular and gloss into metal and roughness; textures re-encoded as WebP at the size they came; geometry compressed.' },
  // (Two racks of angle iron and boards, in metres already. The narrow one has a coil of rope lying at its foot.)
  rack_small: { dir: 'shelf', only: /^Shelf_02_A/, scale: 1, tex: 2048, tags: ['furniture'], changes: 'Its narrow rack: stood on the ground about its own middle, at the size it came; textures re-encoded as WebP at no more than 2048 a side; geometry compressed.' },
  rack_wide: { dir: 'shelf', only: /^Shelf_02_B/, scale: 1, tex: 2048, tags: ['furniture'], changes: 'Its wide rack, made the same way.' },
  // (A steel cupboard of two doors, two metres tall as it comes. Its glint map says bare steel nearly all over, and
  // steel that mirrors is a black shape in a room, where there is no sky to mirror: as with the morgue's lockers,
  // the map is left out and it is said to be dull painted steel.)
  // (It is two lockers side by side, each with its own door, and the doors came as one shape, the right-hand one a
  // hand's breadth open. `node scripts/split-locker.mjs` makes of the download a case and two doors, both shut, each
  // door a piece hung on the line of its own hinges: built from that, so that the game can swing them. See `hung`.)
  // The gun rack (2026-10-17): a green steel weapons locker, what stands in it drawn standing in it (src/game/racks.ts):
  // the bunker's armoury and the military places (the owner: "we just want the best one").
  gun_rack: {
    dir: 'gun_rack',
    // (it came facing along x: turned to face +z as the rest of the furniture does)
    rot: [0, Math.PI / 2, 0],
    size: 1.85,
    tex: 2048,
    // (its paint said to be all metal drew it black where there is nothing for it to shine back: painted steel, as the locker's)
    plain: true,
    metal: 0.3,
    rough: 0.6,
    tags: ['furniture'],
    changes: "Stood on the ground about its own middle, at a locker's height; its glint map left out and its surface said to be painted steel; textures re-encoded as WebP at 2048; geometry compressed.",
    credit: {
      name: 'Gun Rack',
      url: 'https://sketchfab.com/3d-models/gun-rack-394e6e2958e04c3bbc8bc7c305e48f4c',
      author: 'Javier_Fernandez',
      line: 'Gun Rack by Javier_Fernandez (https://sketchfab.com/Javier.Fernandez), CC-BY-4.0',
      changes: "stood on the ground at a locker's height, textures at 2048",
    },
  },
  steel_locker: { dir: 'metal_cabinet_split', scale: 1, tex: 2048, plain: true, metal: 0.35, rough: 0.5, hung: { door_l: /^DoorL/, door_r: /^DoorR/ }, tags: ['furniture'], changes: 'Its two doors, which came as one shape, made two, each with its own handle and each a piece of its own hung on the line of its hinges; the right-hand door, which came standing a little open, turned shut; stood on the ground about its own middle, at the size it came; its glint map left out and its surface said to be dull steel; textures re-encoded as WebP at the size they came; geometry compressed.' },
  // (The canopy, its pillar, the island with its pump, bin and posts, and the cracked pad they stand on: the pad
  // made ten metres long. The plain slab drawn under the pad is left out. The island's material gave its colour
  // picture as its relief map as well: that is left out.)
  fuel_station: { dir: 'gas_station', only: /\.0(13|27|28|29)$/, flat: /^\.028$/, size: 10, tex: 2048, tags: ['prop'], changes: 'Without the plain slab under its pad: scaled to a pad ten metres long and stood on the ground about its own middle; the relief map of its pump island, which was its colour picture given a second time, left out; textures re-encoded as WebP at the size they came; geometry compressed.' },
  // (The rod stands at forty degrees in its file, as its skeleton holds it: it is stood upright on its butt, tip up,
  // the way the shovel and the bat stand. A spinning rod of six feet: its spool comes out 4.7 cm across.)
  // (Tagged as gear and not as loot, though it is a thing found lying about: what is tagged loot and is heavy is
  // given a far lighter copy by scripts/lods.mjs, which lets a shape go as far from itself as seven parts in a
  // hundred of its length. That is 12 cm of a rod a centimetre thick: the copy it made was a reel, four rings and
  // a butt cap hanging in the air with no rod between them. Gear is carried too, and is drawn as it is.)
  fishing_rod: { dir: 'fishing_rod_rigged_and_animated', rot: [0, 0, -0.8755], size: 1.8, tex: 2048, tags: ['gear'], changes: 'Taken off its skeleton as it is held at rest, stood upright on its handle about its own middle and scaled to metres: its animation is left out. Textures re-encoded as WebP at no more than 2048 a side; geometry compressed.' },
  // (The stove in two: its body with the flue, and its door alone, which is hung on the body by the game and turned
  // about y to open. Both at one scale, which makes body and flue 1.35 m; both turned a quarter so the door is on
  // the +z face. The door's own origin is on the line of its hinge pin, at the height of its lower edge.)
  wood_stove: { dir: 'stove', only: /^(StoveLow|FlueLow)/, rot: [0, -Math.PI / 2, 0], scale: 0.0034826, tex: 2048, tags: ['furniture'], changes: 'Its body and its flue, without its door: turned so the door is to the front, scaled to metres and stood on the ground about its own middle; its materials put from specular and gloss into metal and roughness; textures re-encoded as WebP at the size they came; geometry compressed; its animation is left out.' },
  wood_stove_door: { dir: 'stove', only: /^Door1Low/, pivot: /^Door1Low$/, rot: [0, -Math.PI / 2, 0], scale: 0.0034826, tex: 2048, tags: ['furniture'], changes: 'Its door alone, at the same scale and turned the same way, standing on the ground about the line of its hinge.' },
  // (The stones, the logs and the scorched ground under them, without the twenty-nine cards its flames are drawn on:
  // the game makes its own fire. And the same ring with its colour greyed, for a fire that is out: the picture has
  // the glow of the fire painted into it.)
  campfire_ring: { dir: 'campfire', only: /Campfire_MAT/, size: 1.45, tex: 1024, tags: ['prop'], changes: 'Its stones, logs and scorched ground: scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed. While it burns, its colour picture is darkened to charred wood as it is drawn, and only the orange parts of it give light. Its flames and their animation are used as well, for the campfire and, larger, for a burning vehicle: the sheet of flame pictures re-encoded as WebP at the size it came, with its colour carried outward under its clear parts; its twenty-nine cards and every key of their movement written out as data, in metres. As they are played, each card runs over the frames in which it is to be seen, on its own time and two or three times over, fading in and out at the ends of its run (the animation as it came swelled once a loop, and jumped where the loop turned over); the cards turn to face the eye; their pictures are laid on by their own alpha, pushed about by a pattern that climbs, and coloured anew from the photograph\'s brightness and hue; the small flames are let go lower than the animation carries them, and the smoke is painted pale.' },
  campfire_ring_cold: { dir: 'campfire', only: /Campfire_MAT/, size: 1.45, tex: 1024, dye: { saturation: 0.15, brightness: 0.7 }, tags: ['prop'], changes: 'The same again with its colour picture greyed and darkened, for a fire that is not lit.' },
  // (The canopy a supply drop comes down under: src/game/airdrop.ts. Unpack assets-src/army_parachute.zip into
  // assets-src/models/army_parachute/. It came to be drawn half clear, by blending: its cloth is 53 to 80 parts in
  // a hundred solid in its colour picture and its lines wholly so, and nothing of it is cut out by that picture (the
  // lines are shapes of their own, from the rim to where they meet). So it is made SOLID: drawn as a thing that is
  // not seen through, both faces of its cloth, the clearness thrown out of its colour picture. Twelve metres from
  // where the lines meet to the top of the canopy, which is 8.1 m across; it stands on the point where its lines
  // meet, and that point is what the crate hangs from. Its fourth picture, for light of its own, is black all over
  // (every pixel of it nought): the game does not put it on the card.)
  // The helicopter that brings a supply drop (2026-10-14, the owner: "i have added an animated helicopter for the
  // airdrop (apache) make sure its nice and large"). Unpack assets-src/low_poly_apache_gunship.zip into
  // assets-src/models/low_poly_apache_gunship/. Its loose Hellfire, which the download stands under its belly, is
  // left out. Its two rotors are pieces of their own (`apache_rotor`, `apache_tail`), each with its origin on its
  // hub, so the game turns them (the download's own turning is not used: the game's rotor runs at the rules' speed).
  // 28 m over all, rotor included: some 27 m nose to tail, 1.7 times a real Apache (at 1.4 times it read as any
  // helicopter would in the sky at ninety metres). Stood with its origin under the main rotor's hub, nose toward -z.
  apache: { dir: 'low_poly_apache_gunship', only: /Gunship_material/, pivot: /^Rotor$/, hung: { rotor: /^Rotor_/, tail: /^Back_Rotor_/ }, rot: [0, Math.PI, 0], size: 28, tex: 1024, tags: ['prop'], changes: 'Its loose missile left out; its main and tail rotors made pieces of their own about their hubs (its own animation not used: the game turns them); turned nose to -z and stood under its main rotor; scaled to 28 m over all; textures re-encoded as WebP at the size they came; geometry compressed.' },
  // The karambit (2026-10-25, the owner: "karambit is not a finish type its a knife type, the circular claw one like from
  // cs:go"): made in Higgsfield on the owner's account, a picture first (gpt_image_2_5) then Tripo H3.1 image to 3D,
  // brought in at 20 cm long (progress/tools/intake.mjs). Stood with its point up and its ring at the foot, as the other
  // things to hit with stand.
  karambit: {
    dir: '../incoming/higgsfield/melee', file: 'karambit_sized.glb', size: 0.2, rot: [-Math.PI / 2, 0, 0], tex: 1024, tags: ['loot'],
    changes: 'Stood point up, 20 cm long as made; textures re-encoded as WebP at 1024 (they came at 2048 and 4096); geometry compressed.',
    credit: { name: 'Karambit', author: 'ZONA (Higgsfield, Tripo H3.1 image to 3D)', url: 'https://higgsfield.ai', line: '"Karambit" made for ZONA with Higgsfield (gpt_image_2_5 and Tripo H3.1), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // The melee remodels and the knives (2026-10-25, the owner: "we should remodel our melee weapons and I want high
  // quality knives"): made as the karambit was, a picture first (with no stamped words) then Tripo H3.1 image to 3D,
  // brought in at their real lengths (progress/tools/intake.mjs). Stood with the head or point up, as every thing to hit
  // with stands. The old models they replace in the hand stay where the world uses them (the shovel as a prop).
  combat_knife: {
    dir: '../incoming/higgsfield/melee', file: 'combat_knife_sized.glb', size: 0.3, rot: [-Math.PI / 2, 0, 0], tex: 1024, tags: ['loot'],
    changes: 'Stood head up, 30 cm long as made; textures re-encoded as WebP at 1024 (they came at 2048 and more); geometry compressed.',
    credit: { name: 'Combat knife', author: 'ZONA (Higgsfield, Tripo H3.1 image to 3D)', url: 'https://higgsfield.ai', line: '"Combat knife" made for ZONA with Higgsfield (gpt_image_2_5 and Tripo H3.1), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  hunting_knife: {
    dir: '../incoming/higgsfield/melee', file: 'hunting_knife_sized.glb', size: 0.25, rot: [-Math.PI / 2, 0, 0], tex: 1024, tags: ['loot'],
    changes: 'Stood head up, 25 cm long as made; textures re-encoded as WebP at 1024 (they came at 2048 and more); geometry compressed.',
    credit: { name: 'Hunting knife', author: 'ZONA (Higgsfield, Tripo H3.1 image to 3D)', url: 'https://higgsfield.ai', line: '"Hunting knife" made for ZONA with Higgsfield (gpt_image_2_5 and Tripo H3.1), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  bayonet: {
    dir: '../incoming/higgsfield/melee', file: 'bayonet_sized.glb', size: 0.28, rot: [-Math.PI / 2, 0, 0], tex: 1024, tags: ['loot'],
    changes: 'Stood head up, 28 cm long as made; textures re-encoded as WebP at 1024 (they came at 2048 and more); geometry compressed.',
    credit: { name: 'AK bayonet', author: 'ZONA (Higgsfield, Tripo H3.1 image to 3D)', url: 'https://higgsfield.ai', line: '"AK bayonet" made for ZONA with Higgsfield (gpt_image_2_5 and Tripo H3.1), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  melee_hatchet: {
    dir: '../incoming/higgsfield/melee', file: 'melee_hatchet_sized.glb', size: 0.36, rot: [-Math.PI / 2, 0, 0], tex: 1024, tags: ['loot'],
    changes: 'Stood head up, 36 cm long as made; textures re-encoded as WebP at 1024 (they came at 2048 and more); geometry compressed.',
    credit: { name: 'Hatchet', author: 'ZONA (Higgsfield, Tripo H3.1 image to 3D)', url: 'https://higgsfield.ai', line: '"Hatchet" made for ZONA with Higgsfield (gpt_image_2_5 and Tripo H3.1), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  melee_machete: {
    dir: '../incoming/higgsfield/melee', file: 'melee_machete_sized.glb', size: 0.6, rot: [-Math.PI / 2, 0, 0], tex: 1024, tags: ['loot'],
    changes: 'Stood head up, 60 cm long as made; textures re-encoded as WebP at 1024 (they came at 2048 and more); geometry compressed.',
    credit: { name: 'Machete', author: 'ZONA (Higgsfield, Tripo H3.1 image to 3D)', url: 'https://higgsfield.ai', line: '"Machete" made for ZONA with Higgsfield (gpt_image_2_5 and Tripo H3.1), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  melee_crowbar: {
    // (made again from four views, Meshy multi-image to 3D: the one-picture Tripo copy's claw was melted, close up)
    dir: '../incoming/higgsfield/melee', file: 'melee_crowbar_mv_sized.glb', size: 0.6, rot: [0, 0, -Math.PI / 2], tex: 1024, tags: ['loot'],
    changes: 'Stood head up, 60 cm long as made; textures re-encoded as WebP at 1024 (they came at 2048 and more); geometry compressed.',
    credit: { name: 'Crowbar', author: 'ZONA (Higgsfield, Meshy multi-image to 3D)', url: 'https://higgsfield.ai', line: '"Crowbar" made for ZONA with Higgsfield (gpt_image_2_5 views and Meshy multi-image to 3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  melee_bat: {
    dir: '../incoming/higgsfield/melee', file: 'melee_bat_sized.glb', size: 0.84, rot: [Math.PI / 2, 0, 0], tex: 1024, tags: ['loot'],
    changes: 'Stood head up, 84 cm long as made; textures re-encoded as WebP at 1024 (they came at 2048 and more); geometry compressed.',
    credit: { name: 'Baseball bat', author: 'ZONA (Higgsfield, Tripo H3.1 image to 3D)', url: 'https://higgsfield.ai', line: '"Baseball bat" made for ZONA with Higgsfield (gpt_image_2_5 and Tripo H3.1), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  melee_shovel: {
    dir: '../incoming/higgsfield/melee', file: 'melee_shovel_sized.glb', size: 0.95, rot: [-Math.PI / 2, 0, 0], tex: 1024, tags: ['loot'],
    changes: 'Stood head up, 95 cm long as made; textures re-encoded as WebP at 1024 (they came at 2048 and more); geometry compressed.',
    credit: { name: 'Shovel', author: 'ZONA (Higgsfield, Tripo H3.1 image to 3D)', url: 'https://higgsfield.ai', line: '"Shovel" made for ZONA with Higgsfield (gpt_image_2_5 and Tripo H3.1), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // The helicopter a player flies (2026-10-14: "a new helicopter for users to use"). Unpack
  // assets-src/md-500_defender_helicopter.zip into assets-src/models/md-500_defender_helicopter/. Its rotors are
  // pieces of their own (`md500_rotor`, `md500_tail`), each with its origin on its hub, so the game turns them. It
  // came in its own metres (6.9 m nose to tail, a rotor 7.4 m across: an MD 500 is 7 m and 8 m): kept so. Nose
  // toward -z, stood with its origin under the main rotor's hub, its skids on y = 0.
  md500: { dir: 'md-500_defender_helicopter', pivot: /^Top_rotor$/, hung: { rotor: /^Top_rotor_/, tail: /^Tail_Rotor_/ }, rot: [0, Math.PI, 0], scale: 1, tex: 1024, tags: ['vehicle'], changes: 'Its main and tail rotors made pieces of their own about their hubs (its own animation not used: the game turns them); turned nose to -z and stood under its main rotor; kept at the size it came; textures re-encoded as WebP at the size they came; geometry compressed.' },
  parachute: { dir: 'army_parachute', solid: true, both: true, size: 12, tex: 2048, tags: ['prop'], changes: 'Made solid: drawn as a thing that is not seen through, where it came half clear, with the clearness taken out of its colour picture, and both faces of its cloth drawn; scaled to metres (twelve from where its lines meet to the top of the canopy) and stood on the point where its lines meet; textures re-encoded as WebP at no more than 2048 a side; geometry compressed. In the game it is drawn narrow as it opens and laid over as it settles.' },
  // The frag grenade (2026-10-13: "i added a new frag grenade, it takes up 1x1 in the inventory"). Unpack
  // assets-src/frag_granade.zip into assets-src/models/frag_grenade/. A ball grenade with its fuse, lever, pin and
  // ring: one material, three pictures of 2048. As it came its ball is 8.0 cm across, a quarter over life size: the
  // M67 it is drawn from is 6.35 cm across the ball and 8.96 cm tall. Made 8.9 cm tall its ball is 6.35 cm: life
  // size, beside a stick grenade that is 38 cm long with a head of 8 cm. Every triangle it came with, and its
  // pictures at the size they came.
  frag_grenade: { size: 0.089, tex: 2048, tags: ['loot'], changes: 'Scaled to life size (it came a quarter larger) and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.' },
  // What survivors wear as things of their own (2026-10-25, the owner's yes to the clothing card: hats, a balaclava, the
  // ghillie hood, packs and a belt), made as the melee remodels were: a picture with no stamped words, then Tripo H3.1
  // image to 3D, at their real sizes; worn where GEAR in src/game/avatar/gear.ts puts them, and lying as they are.
  // The clothes' own ground models are the shared folded ones below, coloured as each piece is.
  ...Object.fromEntries(
    [
      ['beanie', 0.24, 'Beanie'],
      ['ushanka', 0.3, 'Ushanka'],
      ['beret', 0.29, 'Beret'],
      ['balaclava', 0.3, 'Balaclava'],
      ['ghillie_hood', 0.5, 'Ghillie hood'],
      ['hip_pack', 0.38, 'Hip pack'],
      ['field_bag', 0.38, 'Field bag'],
      ['assault_pack', 0.52, 'Assault pack'],
      ['military_belt', 0.4, 'Military belt'],
      ['ground_jacket', 0.62, 'Folded jacket'],
      ['ground_trousers', 0.62, 'Folded trousers'],
      ['ground_shirt', 0.5, 'Folded shirt'],
      ['ground_trainers', 0.3, 'Trainers'],
    ].map(([id, size, name, rot]) => [
      id,
      {
        dir: '../incoming/higgsfield/survivors/gear', file: id.startsWith('ground_') && id !== 'ground_trainers' ? `${id}_flat.glb` : `${id}.glb`, size, ...(rot ? { rot } : {}), tex: 1024, tags: ['loot'],
        changes: `Scaled to life size (${Math.round(size * 100)} cm at its longest) and stood on the ground about its own middle; textures re-encoded as WebP at 1024; geometry compressed.`,
        credit: { name, author: 'ZONA (Higgsfield, Tripo H3.1)', url: 'https://higgsfield.ai', line: `"${name}" made for ZONA with Higgsfield (gpt_image_2_5 and Tripo H3.1), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms` },
      },
    ]),
  ),
  // (the stab vest lying down: its worn piece let go of the body and laid flat, scripts/unskin.mjs and lay-flat.mjs)
  ground_stab_vest: {
    dir: '../incoming/higgsfield/survivors/gear', file: 'ground_stab_vest_flat.glb', size: 0.6, tex: 1024, tags: ['loot'],
    changes: 'Its worn piece let go of the body and laid flat; scaled to 60 cm at its longest and stood on the ground about its own middle; textures re-encoded as WebP at 1024; geometry compressed.',
    credit: { name: 'Stab vest', author: 'ZONA (Higgsfield, Meshy)', url: 'https://higgsfield.ai', line: '"Stab vest" made for ZONA with Higgsfield (gpt_image_2_5 and Meshy multi-image-to-3D, front and back views), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // ---------------------------------------------------------------- crafting (2026-10-25): the owner's downloads for its
  // items (progress/base-models/incoming-map.md), each judged in the sandbox beside the stand-in it replaced. Their folders
  // are the downloads as they came, in assets-src/incoming/; textures at 1024 for what is carried in the hand (the navigator).
  alcohol_bottle: { dir: '../incoming/isopropyl_rubbing_alcohol_bottle_game_ready', size: 0.25, tex: 1024, tags: ['loot'], changes: 'Stood on the ground about its own middle; textures re-encoded as WebP at 1024 (they came at 4096); geometry compressed.' },
  // (the iron ones of the set: three bars, two lying and one on them)
  iron_ingots: { dir: '../incoming/blacksmith_ingots_game_ready_asset', only: /Iron/, size: 0.26, tex: 1024, tags: ['loot'], changes: 'Only its three iron bars are used here, scaled to 26 cm across and stood on the ground about their own middle; textures re-encoded as WebP; geometry compressed.' },
  stone_axe: { dir: '../incoming/primitive_stone_axe', size: 0.46, tex: 1024, tags: ['loot'], changes: 'Scaled to 46 cm and stood on the ground about its own middle; textures re-encoded as WebP at 1024 (they came at 4096); geometry compressed.' },
  bone_knife: { dir: '../incoming/bone_knife_1', size: 0.26, tex: 1024, tags: ['loot'], changes: 'Scaled to 26 cm and stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.' },
  // (Rurre's, of the three the owner downloaded: picked in the sandbox, 2026-10-25, as the pile that reads as scrap and is lightest;
  // it is fan art of Team Fortress 2, which the owner allows: "fan art is allowed, it is not ripped")
  scrap_pile: { dir: '../incoming/scrap_metal', size: 0.4, tex: 1024, tags: ['loot'], changes: 'Scaled to 40 cm across and stood on the ground about its own middle; textures re-encoded as WebP; geometry compressed.' },
  // (made in Higgsfield on the owner's account, 2026-10-25: Tripo's text-to-3D; scaled to size by the navigator, kept so)
  satchel_charge: {
    dir: '../incoming/higgsfield', file: 'satchel_charge_30cm.glb', scale: 1, tex: 2048, tags: ['loot'],
    changes: 'Stood on the ground about its own middle, 30 cm tall as made; textures re-encoded as WebP; geometry compressed.',
    credit: { name: 'Satchel charge', author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: '"Satchel charge" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // (base building's pieces drawn from models, 2026-10-25, src/game/building/models.ts: made for them in Higgsfield on the
  // owner's account. Each is fitted into its piece's solids as the game draws it, so it comes at the size it was made.)
  ...Object.fromEntries([
    ['bb_door_wood', 'Wooden door leaf', 'remade/door_wood.glb'], ['bb_door_metal', 'Metal door leaf', 'remade/door_metal.glb'],
    ['bb_hatch', 'Hatch lid', 'remade/hatch.glb'], ['bb_garage', 'Garage door', 'remade/garage.glb'],
    ['bb_small_box', 'Small box', 'remade/small_box.glb'], ['bb_large_box', 'Large box', 'base/large_box_sized.glb'],
    ['bb_workbench', 'Workbench', 'base/workbench_sized.glb'], ['bb_bed', 'Bed', 'base/bed_sized.glb'],
    ['bb_wall_torch', 'Wall torch', 'base/wall_torch_sized.glb'], ['bb_ladder', 'Ladder', 'remade/ladder.glb'],
    ['bb_palisade_log', 'Palisade log', 'base/palisade_log_sized.glb'], ['bb_gate_wood', 'Wooden gate', 'base/gate_wood_sized.glb'],
    ['bb_gate_steel', 'Steel gate leaf', 'remade/gate_steel.glb'],
    ['bb_bedroll', 'Sleeping bag', 'base/bedroll.glb'],
  ].map(([id, name, file]) => [id, {
    dir: '../incoming/higgsfield', file, scale: 1, tex: 1024, tags: ['base'],
    changes: 'Kept at the size it was made to, stood on the ground about its own middle; textures re-encoded as WebP at 1024; geometry compressed.',
    credit: { name, author: 'ZONA (Higgsfield)', url: 'https://higgsfield.ai', line: `"${name}" made for ZONA with Higgsfield (${file.startsWith('remade/') ? 'Meshy multi-image-to-3D from front, side and back views' : 'text-to-3D'}), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms` },
  }])),
  // (the claim: a post on a rusted strongbox, made in Higgsfield, with the owner's pirate flag nailed to it: "i prefer the
  // look of the pirate flag i porovided". The flag is SusanKing's, waved by the game: src/game/building/models.ts)
  bb_claim: {
    dir: '../incoming/higgsfield', file: 'claim_pirate.glb', scale: 1, tex: 1024, tags: ['base'],
    changes: 'The post and strongbox made for ZONA in Higgsfield, the flag set on the post; kept at its size, stood on the ground about its own middle; textures re-encoded as WebP at 1024; geometry compressed.',
    credit: { name: 'Pirate Flag animated', author: 'SusanKing', url: 'https://sketchfab.com/3d-models/pirate-flag-animated-e6b2c8a5be864ad6afba3bdfdde1aff2', line: 'This work is based on "Pirate Flag animated" (https://sketchfab.com/3d-models/pirate-flag-animated-e6b2c8a5be864ad6afba3bdfdde1aff2) by SusanKing (https://sketchfab.com/krolzuzannapl) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/); its post and strongbox made for ZONA with Higgsfield (text-to-3D) on the owner’s account' },
  },
  // (the progression plan's two looted parts, made for it in Higgsfield, 2026-10-25: a tin of hinges and bolts, and a
  // plate of armour steel, laid flat and pressed to three centimetres thick)
  ...Object.fromEntries([['hardware', 'Hardware tin', { size: 0.13 }], ['steel_plate', 'Steel plate', { rot: [0, 0, Math.PI / 2], squash: [1, 0.3, 1], size: 0.5 }]].map(([id, name, more]) => [id, {
    dir: '../incoming/higgsfield/parts', file: `${id}.glb`, tex: 1024, tags: ['loot'], ...more,
    changes: 'Made its real size, stood on the ground about its own middle; textures re-encoded as WebP at 1024; geometry compressed.',
    credit: { name, author: 'ZONA (Higgsfield text-to-3D)', url: 'https://higgsfield.ai', line: `"${name}" made for ZONA with Higgsfield (text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms` },
  }])),
  // (C4, base building's raiding: of the two the owner downloaded, the one of three blocks taped to a timer, picked in
  // the sandbox over a cartoon one)
  c4: { dir: '../incoming/simple_old_c4', file: 'scene.gltf', size: 0.2, tex: 1024, tags: ['loot'], changes: 'Stood on the ground about its own middle and made 20 cm tall; textures re-encoded as WebP at 1024; geometry compressed.' },
  // (charcoal with no maker's print on it, as the sack the owner downloaded had all over; and the tin powder is kept in)
  // (made grey as stone: darkened to charcoal's black)
  charcoal_lumps: {
    dir: '../incoming/higgsfield', file: 'charcoal_sized.glb', scale: 1, tex: 1024, tags: ['loot'], dye: { brightness: 0.45, saturation: 0.5 },
    changes: 'Stood on the ground about its own middle, at the size it was made, its colour darkened; textures re-encoded as WebP at 1024; geometry compressed.',
    credit: { name: 'Charcoal', author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: '"Charcoal" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // (made lying on its side: stood on its base)
  gunpowder_tin: {
    dir: '../incoming/higgsfield', file: 'gunpowder_tin_sized.glb', rot: [0, 0, -Math.PI / 2], scale: 1, tex: 1024, tags: ['loot'],
    changes: 'Stood on its base on the ground, about its own middle, at the size it was made; textures re-encoded as WebP at 1024; geometry compressed.',
    credit: { name: 'Gunpowder tin', author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: '"Gunpowder tin" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // (the forge: Higgsfield's drum with a chimney, judged in the sandbox beside Poly Haven's barrel_stove)
  forge_hf: {
    dir: '../incoming/higgsfield', file: 'forge_cold.glb', scale: 1, budget: 10000, tex: 2048, tags: ['prop'],
    changes: 'Stood on the ground about its own middle, at the size it was made, simplified to about 10,000 triangles; textures re-encoded as WebP at 2048 (they came at 4096); geometry compressed.',
    credit: { name: 'Forge', author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: '"Forge" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // (made for crafting in Higgsfield, 2026-10-25, sized at intake by progress/tools/intake.mjs: a slim sledgehammer, a coil of
  // hemp rope and a bundle of rags, in place of the downloads judged too thick, untextured and whole clothes)
  sledgehammer_slim: {
    dir: '../incoming/higgsfield', file: 'sledgehammer_slim_sized.glb', rot: [0, 0, -0.1822], scale: 1, tex: 1024, tags: ['loot'],
    changes: 'Stood straight up its handle, at its true length of 0.9 m, about its own middle; textures at 1024; geometry compressed.',
    credit: { name: 'Sledgehammer', author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: '"Sledgehammer" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  rope_coil_hemp: {
    dir: '../incoming/higgsfield', file: 'rope_coil_hemp_sized.glb', scale: 1, tex: 1024, tags: ['loot'],
    changes: 'Stood on the ground about its own middle, 30 cm across; textures at 1024; geometry compressed.',
    credit: { name: 'Coiled rope', author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: '"Coiled rope" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  rags_bundle: {
    dir: '../incoming/higgsfield', file: 'rags_bundle_sized.glb', scale: 1, tex: 1024, tags: ['loot'],
    changes: 'Stood on the ground about its own middle, 20 cm long; textures at 1024; geometry compressed.',
    credit: { name: 'Rags', author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: '"Rags" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // (salvage's wrecks, a layer of their own laid by src/sim/craft/wrecks.ts: each with a far copy, as a vehicle has)
  zil_wreck: {
    dir: '../incoming/higgsfield', file: 'zil_truck_wreck_sized.glb', scale: 1, budget: 20000, tex: 2048, tags: ['prop', 'vehicle'],
    changes: 'Stood on the ground about its own middle, 6.6 m long as made, simplified to about 20,000 triangles; textures re-encoded as WebP at 2048 (they came at 4096); geometry compressed.',
    credit: { name: 'ZIL truck wreck', author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: '"ZIL truck wreck" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  tractor_wreck: {
    dir: '../incoming/higgsfield', file: 'tractor_wreck_sized.glb', scale: 1, budget: 18000, tex: 2048, tags: ['prop', 'vehicle'],
    changes: 'Stood on the ground about its own middle, 4.2 m long as made, simplified to about 18,000 triangles; textures re-encoded as WebP at 2048 (they came at 4096); geometry compressed.',
    credit: { name: 'Tractor wreck', author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: '"Tractor wreck" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // (the owner's download: Renafox's retopology of Mikhail Volkov's scan, both credited; its glowing lamps left dark)
  pirozhok_wreck: {
    dir: '../incoming/pirozhok_scan_retopo_free_scan', size: 4.0, tex: 2048, bare: true, tags: ['prop', 'vehicle'],
    changes: 'Scaled to its 4 m and stood on the ground about its own middle; its lamps left unlit (the glow taken off); textures re-encoded as WebP at 2048 (they came at 4096); geometry compressed.',
    credit: { name: 'Pirozhok Scan Retopo (Free Scan)', author: 'Renafox', url: 'https://sketchfab.com/3d-models/pirozhok-scan-retopo-free-scan-07bc48134b364d4f8a43d288b3a0282d', line: 'This work is based on "Pirozhok Scan Retopo (Free Scan)" (https://sketchfab.com/3d-models/pirozhok-scan-retopo-free-scan-07bc48134b364d4f8a43d288b3a0282d) by Renafox (https://sketchfab.com/kryik1023), itself from Mikhail Volkov\'s scan "Abandoned Soviet Car — IZH-2715" (https://sketchfab.com/3d-models/abandoned-soviet-car-izh-2715-b97884f0730d42a68c1a6a9a9874159d), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)' },
  },
  junk_heap: {
    dir: '../incoming/higgsfield', file: 'junk_heap_3m.glb', scale: 1, tex: 2048, tags: ['prop', 'vehicle'],
    changes: 'Stood on the ground about its own middle, 3 m across as made; textures re-encoded as WebP; geometry compressed.',
    credit: { name: 'Junk heap', author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: '"Junk heap" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // Progression v3's things (crafting, 2026-10-25), made in Higgsfield on the owner's account (Tripo text-to-3D) and sized
  // at intake (progress/tools/intake.mjs): the metal fragments, the spring, the pipe, the rifle body, the research table,
  // and the recycler (the pistol body is the Colt's own frame: src/sim/items/craft.ts; the stall made again below). What is carried at 1024, what stands at 2048 (the navigator: "textures 2048, 1024 for hand items").
  ...Object.fromEntries(
    [
      ['metal_frags', 'Metal fragments', '22 cm across', 1024, ['loot']],
      ['metal_pipe', 'Metal pipe', '35 cm long', 1024, ['loot']],
      ['spring_coil', 'Spring', '12 cm long', 1024, ['loot']],
      ['gun_body_rifle', 'Rifle body', '45 cm long', 1024, ['loot']],
      ['research_table', 'Research table', '1.2 m long', 2048, ['prop']],
      ['recycler', 'Recycler', '2 m wide', 2048, ['prop']],
    ].map(([id, name, size, tex, tags]) => [id, {
      dir: '../incoming/higgsfield', file: `${id}_sized.glb`, scale: 1, tex, tags,
      changes: `Stood on the ground about its own middle, ${size} as made; textures re-encoded as WebP at ${tex}; geometry compressed.`,
      credit: { name, author: 'ZONA (Higgsfield, Tripo text-to-3D)', url: 'https://higgsfield.ai', line: `"${name}" made for ZONA with Higgsfield (Tripo text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms` },
    }]),
  ),
  // (the trader camp's stall made again, the owner: "the trader stand looks very low quality": a front, a side and a back
  // picture first, then Meshy's model of all three, on the owner's Higgsfield account; its counter turned to +x, as the
  // camp lays a stall: src/sim/camp.ts FACE_TURN; the black holes Meshy left in its atlas filled from their neighbours by
  // progress/crafting/stall/pad.mjs, as they showed as dark blotches on the canvas)
  trader_stall: {
    dir: '../incoming/higgsfield', file: 'trader_stall_padded.glb', scale: 1, tex: 2048, tags: ['prop'], rot: [0, Math.PI / 2, 0],
    changes: 'Stood on the ground about its own middle, 2.8 m across as made, turned so its counter faces +x; the holes in its texture atlas filled from their neighbours; textures re-encoded as WebP at 2048; geometry compressed.',
    credit: { name: 'Trader stall', author: 'ZONA (Higgsfield, Meshy multi-image-to-3D)', url: 'https://higgsfield.ai', line: '"Trader stall" made for ZONA with Higgsfield (Meshy multi-image-to-3D, from three pictures made for it), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms' },
  },
  // Base building's things (2026-10-25), made in Higgsfield in place of the stand-ins (the owner: "all of thes eitems
  // look terrible and need models done in higgsfield ... they all look extremely low quality"). Each came at its real
  // size, foot on the ground, centred (the navigator's *_sized.glb), 1.6 to 3.3 thousand triangles: put in
  // assets-src/models/higgsfield_items/ (a worktree's own assets-src: `node scripts/packs.mjs <id>` reads it).
  ...Object.fromEntries(
    [
      ['log', 'Birch log'], ['stone', 'Stones'], ['nails', 'Box of nails'], ['sheet_metal', 'Sheet metal'], ['felling_axe', 'Felling axe'],
      ['hammer', 'Claw hammer'], ['pickaxe', 'Pickaxe'], ['torch', 'Torch'], ['code_lock', 'Code lock'], ['sleeping_bag', 'Sleeping bag'],
      // (and those made again: the saw twice, its blade first as short as its handle, a padlock made a lock box as
      // Rust's, the key, the plan a clipboard, the planks a bundle)
      ['hand_saw', 'Panel saw'], ['key_lock', 'Key lock', 'key_lock2'], ['key', 'Key', 'key2'], ['building_plan', 'Building plan', 'building_plan2'], ['planks', 'Planks', 'planks3'],
    ].map(([id, name, file = id]) => [id, {
      dir: 'higgsfield_items', file: `${file}_sized.glb`, scale: 1, tex: 1024, tags: ['loot'],
      // (the tools came leaning, their handles 41 to 50 degrees off upright: stood up, head uppermost, as the
      // hatchet's is, which the hands' hold of a thing to hit with goes by; and made their true length along it. The
      // clipboard came stood on its edge, its sketch to +x: laid face up. The saw, made a third time (the owner,
      // 2026-10-25: "the handsaw looks so short"), came at no size and 17 degrees off level: laid level, its handle
      // to -z where the hands hold it by the butt, and made a panel saw's length; its blade came polished as a mirror, which drew near black with no bright sky in it ("this
      // does not look good"): two fifths as much metal, so its grey steel shows)
      ...({ felling_axe: { rot: [0.714, 0, 0], size: 0.9 }, hammer: { rot: [-0.577, 0, -0.148], size: 0.33 }, pickaxe: { rot: [0.834, 0, -0.298], size: 0.9 }, building_plan: { rot: [0, 0, Math.PI / 2] }, hand_saw: { file: 'hand_saw3.glb', size: 0.62, rot: [-0.3005, Math.PI, 0], metalBy: 0.4 } }[id] ?? {}),
      ...(['felling_axe', 'hammer', 'pickaxe', 'hand_saw'].includes(id) ? { scale: undefined } : {}),
      changes: 'Kept at the real size it was made to, stood on the ground about its own middle; textures re-encoded as WebP at 1024; geometry compressed.',
      credit: { name, author: 'ZONA (Higgsfield text-to-3D)', url: 'https://higgsfield.ai', line: `"${name}" made for ZONA with Higgsfield (text-to-3D), 2026-10-25, on the owner’s account: commercial use under Higgsfield’s terms` },
    }]),
  ),
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
 *   atEye     – the pack's camera (`eye`) is made the eye: for a pack whose camera stands where a body's head is
 *   ourArms   – held in our own arms (src/game/hands-on.ts): the pack's own arms are left out of its file
 *
 * `tex` is 2048 at most for every model, and 1024 for the guns of very many triangles and dozens of pictures (the
 * owner, 2026-10-19: "make sure no texture exceeds 2048 / 1024 if the weapon has ALOT of triangles and is super high
 * quality"): a gun at 4096 was 256 MB on the card in the hands, at 2048 64, and the two could not be told apart;
 * holding the AR-15 kept a gigabyte of pictures on the card, and cards that ran out dropped the game's picture.
 * 1024: the AR-15 (102,000 triangles, 46 pictures), VSSK (85,000, 24), M32 (65,000, 15), Barrett (49,000, 15).
 */
export const WEAPON_PACKS = {
  sniper: {
    dir: 'sniper',
    file: 'scene.gltf',
    tex: 2048,
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
  // The knife (2026-10-13, in place of the Fish Knife: "a knife to replace our fish knife with animations"). By the
  // maker of the sniper's pack, on the same arms and the same skeleton: an army bayonet-knife of the M9 kind (clip
  // point, saw teeth on its spine, a cross guard, a round ribbed grip and a heavy pommel), 34.4 cm long at the size
  // it came, with one animation of 146 frames that has every movement in it: held, a cut each way, a stab down with
  // the blade turned under the fist, a thrust, put away and drawn. Every triangle and every picture as it came.
  // It is held ACROSS the picture, not along it. `forward` and `up` are how the knife itself lies on the first
  // frame, said so that the knife alone STANDS as everything else to hit with stands (the hands of a body seen from
  // outside are laid on a thing that does: lying along x, the fist was on it crossways and the blade out of the
  // wrong end): `up` is the way its point is, `forward` is through its flat, and so its spine is +z and its edge
  // -z, away from whoever holds it. `look` is which way whoever holds it faces. Its arms are the sniper's arms with another paint on them: the
  // game draws them in the sniper's (one pair of gloves whatever is held), so this pack's own arm pictures are not
  // kept in it.
  // Its size: in the hands it is as it came, drawn for those arms, which are a seventh over life as the sniper's
  // are (`scale`). Alone, on the ground, in the fist of a body seen from outside and in its picture, it is the
  // length an M9 is: 30.5 cm (`aloneLength`).
  knife: {
    dir: 'knife_animated',
    file: 'scene.gltf',
    tex: 2048,
    scale: 0.01,
    aloneLength: 0.305,
    forward: [-0.367514, 0.924977, -0.0967],
    up: [0.919853, 0.346196, -0.18444],
    look: { forward: [0, 0, 1], up: [0, 1, 0] },
    parts: { knife: 'knife' },
    wrists: { right: 'R_wrist_027', left: 'L_wrist_04' },
    // (the knife alone is set down by its own middle line, inside its grip: that far from the wrist)
    origin: [-0.016468, 0.004444, -0.085641],
    fpBare: 'arms',
    fps: 30,
    clips: { idle: [0, 40], cutA: [41, 60], cutB: [61, 80], stab: [81, 102], thrust: [103, 124], stow: [125, 135], draw: [135, 145] },
    credit: {
      name: 'knife Animated',
      url: 'https://sketchfab.com/3d-models/knife-animated-f3140db917cc43389c14b5b2536c1dc8',
      author: 'DJMaesen',
      line: 'This work is based on "knife Animated" (https://sketchfab.com/3d-models/knife-animated-f3140db917cc43389c14b5b2536c1dc8) by DJMaesen (https://sketchfab.com/bumstrum) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'Scaled to metres; its one long animation cut into the movements the game plays; a copy of the knife alone, standing still and made the length of a real one (30.5 cm), for the ground and for other players; its arms drawn with the pictures of the same maker\'s sniper pack, their own left out; textures re-encoded as WebP at the size they came; geometry compressed.',
    },
  },
  // The AK (2026-10-10): a rifle on a skeleton with the arms that hold it, and a movement to an animation: an
  // idle, a draw, a shot, three reloads (a magazine changed; the same done another way; and one with the bolt
  // worked after it, for a gun that had run dry), a walk and a run. Every triangle and every picture as it came,
  // at the size it came: four thousand pixels a side, the arms as well. Its body is one shape that follows five
  // joints (nearly all of it one of them; the top cover, the safety and the trigger each their own; and its
  // magazine), and a second magazine is a shape by itself, which is the fresh one of the reloads: the gun alone
  // is made of the first, in two pieces, the rifle and its magazine. It lies along z as it comes, its muzzle to
  // +z (its trigger is nearer the low end than its magazine is), 2.76 of its own units long: an AK-74M is 0.943 m.
  ak: {
    dir: 'ak74m',
    file: 'scene.gltf',
    tex: 2048,
    length: 0.943,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    // (It was modelled as it is held: turned in to the middle of the picture, its front sight 9 mm to the left of
    // its rear one, 36 cm ahead of it; and leaning over to the left, six degrees, by its magazine, its stock and
    // the ears of its front sight alike. The gun alone is made straight and upright; in the hands it stays as it came.)
    trim: { yaw: -1.4, roll: 6.2 },
    // (each joint's share of it a piece of its own, so that in the hands each is hung on its joint and moves as it did)
    skinned: { mesh: ['Ak_ak74m', 'Mag_2_ak74m'], joints: { PBody_058: 'base', Rif_059: 'bolt', Safety_061: 'safety', Trigger_060: 'trigger', Pmag_062: 'mag', Pmag2_063: null }, rest: 'base' },
    eye: 'Head_Cam_014',
    wrists: { right: 'Hand_R_037', left: 'Hand_L_016' },
    // (in the hands the gun alone is hung on these joints: the pack's own drawing of it, and of its second magazine, is not kept)
    fpDrop: ['Object_97', 'Object_99'],
    origin: [0.3, 0.02, -0.03],
    fps: 30,
    clips: { idle: 'Rig|AK_Idle', draw: 'Rig|AK_Draw', fire: 'Rig|AK_Shot', reload: 'Rig|AK_Reload', reloadEmpty: 'Rig|AK_Reload_full', reloadOther: 'Rig|AK_Reload_var2', walk: 'Rig|AK_Walk', run: 'Rig|AK_Run' },
    credit: {
      name: 'FPS AK-74m animations',
      url: 'https://sketchfab.com/3d-models/fps-ak-74m-animations-94be8385c402474cacd39bc096c6ca14',
      author: 'Cransh',
      line: 'This work is based on "FPS AK-74m animations" (https://sketchfab.com/3d-models/fps-ak-74m-animations-94be8385c402474cacd39bc096c6ca14) by Cransh (https://sketchfab.com/ccransh) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'Scaled to metres; its eight animations laid end to end as the one the game plays; a copy of the rifle alone, taken off its skeleton and standing still, in two pieces (the rifle and its magazine), made for the ground and for other players; textures re-encoded as WebP at no more than 2048 a side; geometry compressed.',
    },
  },
  // The submachine gun (2026-10-11): by the maker of the AK's pack, on the same arms and the same skeleton, with a
  // movement to an animation: an idle, a draw, a shot, two reloads (a magazine changed; and one with the bolt worked
  // after it), a look over the gun, a walk and a run. Its magazine goes up its grip, as a pistol's does, which is
  // why the pistols are held in these hands too (the user's, 2026-10-11: "this will apply to all pistols and
  // smg's"). Its arms are the AK's arms a hair smaller in the file (an upper arm 0.395 of its units long, where the
  // AK's is 0.398 of the AK's): it is made the size that makes them the same arms, at which the gun is 26 cm from
  // its back plate to the front of its receiver. Every triangle and every picture as it came.
  smg: {
    dir: 'smg_fps',
    file: 'scene.gltf',
    tex: 2048,
    scale: 0.3443,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    // (Bound as it is held, like the AK: turned in a little under a degree, by its rail and its two sights, and
    // leaning over to the left nearly six, by its grip, its receiver and its rail. The gun alone is made straight.)
    trim: { yaw: -0.87, roll: 5.8 },
    skinned: { mesh: ['LP SST30 Bottom Frame001'], joints: { PBody_058: 'base', Rif_059: 'bolt', Trigger_060: 'trigger', Pmag_061: 'mag', Pmag_2_062: null }, rest: 'base' },
    eye: 'Head_Cam_014',
    wrists: { right: 'Hand_R_00', left: 'Hand_L_016' },
    // (as the AK's: the gun alone is hung on the joints, and the pack's own drawing of it is not kept)
    fpDrop: ['Object_93', 'Object_94', 'Object_96'],
    origin: [0.08, 0.02, -0.03],
    fps: 30,
    clips: { idle: 'Rig|KDW_DPose_Idle', draw: 'Rig|KDW_Draw', fire: 'Rig|KDW_Shot', reload: 'Rig|KDW_Reload_fast', reloadEmpty: 'Rig|KDW_Reload_full', check: 'Rig|KDW_Ispect', walk: 'Rig|KDW_Walk', run: 'Rig|KDW_Run' },
    credit: {
      name: 'SMG FPS Animations',
      url: 'https://sketchfab.com/3d-models/smg-fps-animations-ca37ea9148dc4fcc9cc632175d311b23',
      author: 'Cransh',
      line: 'This work is based on "SMG FPS Animations" (https://sketchfab.com/3d-models/smg-fps-animations-ca37ea9148dc4fcc9cc632175d311b23) by Cransh (https://sketchfab.com/ccransh) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'Scaled to metres; its eight animations laid end to end as the one the game plays; a copy of the gun alone, taken off its skeleton and standing still, in pieces (the gun, its bolt, its trigger, its magazine), made for the ground and for other players; its arms and its movements are also what the pistols are held in and moved by. Textures re-encoded as WebP at no more than 2048 a side; geometry compressed.',
    },
  },
  // The AR-15 (2026-10-10): a rifle and nothing else, in twenty-nine pieces, with what was fitted to it as it
  // came: a suppressor and the brake it goes on in place of, a holographic sight, a foregrip, a light on its
  // mount, a magazine. Each of those is a piece by itself here, there when the thing is fitted and not otherwise
  // (see `shows` on the weapon). It came with no hands and no movements: it is held in the AK's, set where the
  // AK is, magazine to magazine, since it is the magazine the hands go to. Every triangle as it came; its 46
  // pictures at 1024 (see above). Ten of its units are a metre: its lower receiver is 2.1 of them long, and an AR's is 0.2 m.
  ar15: {
    dir: 'ar15',
    file: 'scene.gltf',
    tex: 1024,
    fp: false,
    scale: 0.1,
    forward: [1, 0, 0],
    up: [0, 1, 0],
    fit: { to: 'ak', piece: 'mag' },
    // (its brake is drawn lying under the muzzle, for show: it is put on the barrel, where the suppressor that takes its place is)
    put: { brake: 'silencer' },
    parts: {
      'CQB STOCK': 'base', Barrel: 'base', Bolt_catch: 'base', Disconnector: 'base', Hammer: 'base', 'Lower receiver': 'base', 'Magazine catch button': 'base', Springs: 'base', SSL: 'base', Trigger: 'base', lower_pin: 'base',
      'Firing pin': 'base', 'Bolt carrier key': 'base', Bolt: 'base', 'Ejection port cover': 'base', 'Bolt carrier': 'base', 'Upper receiver': 'base', Grip: 'base', Handguard: 'base', 'Swivel QD': 'base', 'Charging handle': 'base',
      'Magpul PMAG 30': 'mag', Bullets: 'mag', 'Muzzle brake': 'brake', 'GEMTECH ABYSS 5.56': 'silencer', 'EOtech EXPS-2': 'sight', 'BCM VFG': 'foregrip', 'mount flashlight': 'light', 'Surefire EDC1': 'light',
    },
    credit: {
      name: 'AR-15',
      url: 'https://sketchfab.com/3d-models/ar-15-33e225811b404192b89dcd4096603fbe',
      author: 'wafla',
      line: 'This work is based on "AR-15" (https://sketchfab.com/3d-models/ar-15-33e225811b404192b89dcd4096603fbe) by wafla (https://sketchfab.com/wafla) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'Scaled to metres and set in the pieces the game shows and hides (the rifle, its magazine, its brake, its suppressor, its sight, its foregrip, its light); its muzzle brake, which lay beside the rifle, put on the barrel; textures re-encoded as WebP at no more than 1024 a side; geometry compressed.',
    },
  },
  // The Colt 1911 (2026-10-11, in place of the Pistol 43, which is gone: "replace pistol 43 with colt 1911 i
  // dropped in"). A pistol and nothing else, on a skeleton of its own with a joint to each part: taken off it and
  // set in rigid pieces (its frame with its barrel, trigger and catch; its slide; its hammer; its magazine with the
  // round that shows at the top of it). It lies along z with its muzzle to -z, 792 of its units from the front of
  // its slide to the back of its grip safety: a Government Model is 216 mm. Every triangle and every picture as it
  // came. Like the other pistols it is set where the M9 is, slide to slide, and held in the same hands.
  colt_1911: {
    dir: 'colt_1911',
    file: 'scene.gltf',
    tex: 2048,
    fp: false,
    length: 0.216,
    forward: [0, 0, -1],
    up: [0, 1, 0],
    fit: { to: 'm9', piece: 'slide' },
    skinned: { mesh: 'Default_1', joints: { Main_00: 'base', Dyl_03: 'base', Trig_015: 'base', Mag_button_021: 'base', Slide_012: 'slide', Hammer_018: 'hammer', Magaz_024: 'mag', Bullet_2_027: 'mag', Gils_09: null, Bullet_06: null }, rest: 'base' },
    credit: {
      name: 'Colt 1911',
      url: 'https://sketchfab.com/3d-models/colt-1911-561fccb5b3314feda06da315b8d36553',
      author: 'AlexChuchvaga',
      line: 'This work is based on "Colt 1911" (https://sketchfab.com/3d-models/colt-1911-561fccb5b3314feda06da315b8d36553) by AlexChuchvaga (https://sketchfab.com/AlexChuchvaga) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'Taken off its skeleton and set in rigid pieces (frame, slide, hammer, magazine), scaled to metres and laid along the barrel; the cartridge in its chamber and the spent case are left out, and its animation is not used. Textures re-encoded as WebP at the size they came; geometry compressed.',
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
  // The Mosin 91/30 (2026-10-19), back: the old rifle out of Poly Haven, in the rifle's hands as the shotgun is (the
  // owner: "bring back the mosin with the pu scope attachment ... to act as a tier 1-2 sniper"). Its bolt rides the
  // pack's bolt; its PU scope and its wrap are pieces of their own, there when the scope and the cheek rest are fitted;
  // its round is the one seen going in as it is loaded, and what its stripper clip is drawn with.
  mosin9130: {
    dir: 'bolt_action_rifle_7_62',
    file: 'bolt_action_rifle_7_62_2k.gltf',
    tex: 2048,
    fp: false,
    scale: 1,
    forward: [1, 0, 0],
    up: [0, 1, 0],
    fit: { to: 'sniper', piece: 'base' },
    parts: { bolt_action_rifle_7_62: 'base', bolt_action_rifle_7_62_trigger: 'trigger', bolt_action_rifle_7_62_bolt_a: 'bolt', bolt_action_rifle_7_62_bolt_b: 'bolt', bolt_action_rifle_7_62_scope: 'scope', bolt_action_rifle_7_62_wrap: 'wrap', bolt_action_rifle_7_62_bullet_54mm: 'bullet' },
    // (CC0, credited in CREDITS.md's Poly Haven table by this line)
    credit: { name: 'Bolt Action Rifle 7.62', url: 'https://polyhaven.com/a/bolt_action_rifle_7_62', author: 'Mateusz Sadek', line: '[Bolt Action Rifle 7.62](https://polyhaven.com/a/bolt_action_rifle_7_62) | Mateusz Sadek |' },
  },
  // The CZ Scorpion EVO (2026-10-17, the weapons pass: "we need to part out their attachments per gun like all the
  // rest of the guns ... be thorough we want high quality"). A first-person pack on arms of its own (Rigify, in
  // metres), with a movement to an animation: equip, idle, walk, run, fire, two reloads, an inspect and putting it
  // away. As with the AK, the pack's own drawing of the gun is put away and the gun alone is hung on its joints.
  scorpion: {
    dir: 'scorpion',
    file: 'scene.gltf',
    tex: 2048,
    scale: 1,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    // (Bound as it is held, like the AK: its rail rises 2.9 degrees to the muzzle, turns 2.1 to the left and leans
    // 3.1 to the left across its width, measured off the file by scripts/sight-profile.mjs. The gun alone is made straight.)
    trim: { pitch: 2.86, yaw: -2.11, roll: 3.1 },
    skinned: { mesh: ['CZScorpion_CZScorpion_0'], joints: { Weapon_0725: 'base', Changing_handle_0726: 'bolt', Firemode_0727: 'safety', Trigger_0728: 'trigger', Mag_Release_0729: 'base', Magazine_0730: 'mag', Magazine_2_0732: null }, rest: 'base' },
    eye: 'Camera_0733', atEye: true, ourArms: true,
    wrists: { right: 'DEF-hand.R_0583', left: 'DEF-hand.L_0458' },
    // (the gun alone is hung on the joints; the pack's sky ball is not kept either)
    fpDrop: ['Object_11', 'Object_19'],
    origin: [0.08, 0.02, -0.03],
    fps: 30,
    clips: { idle: 'rig|Idle', draw: 'rig|Equip', fire: 'rig|Fire', reload: 'rig|Reload', reloadEmpty: 'rig|Reload_Empty', check: 'rig|Inspect', walk: 'rig|Walk', run: 'rig|Run', holster: 'rig|Unequip' },
    credit: {
      name: 'Scorpion | First Person Animations (2026 Remake)',
      url: 'https://sketchfab.com/3d-models/scorpion-first-person-animations-2026-remake-f2bdfac775344004ad38d0318f0664a4',
      author: '1Matzh',
      line: 'This work is based on "Scorpion | First Person Animations (2026 Remake)" (https://sketchfab.com/3d-models/scorpion-first-person-animations-2026-remake-f2bdfac775344004ad38d0318f0664a4) by 1Matzh (https://sketchfab.com/1Matzh) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'The gun taken off its skeleton and set in rigid pieces; its animations played as they came; its sky ball left out. Textures re-encoded as WebP; geometry compressed.',
    },
  },
  mp7a1: {
    dir: 'mp7a1',
    file: 'scene.gltf',
    tex: 2048,
    scale: 1,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    // (its sights flip up, its suppressor and its sight come off: each a piece of its own, on its own joint)
    skinned: {
      mesh: ['mp7a1_Object_slot_3_0', 'mp7a1_Object_Slot_1_0', 'mp7a1_Object_slot_2_0'],
      joints: { body_0161: 'base', stock_0162: 'stock', stock_lock_0176: 'stock', slide_lock_0163: 'base', trigger_0164: 'trigger', trigger_p2_0165: 'trigger', mag_lock_0166: 'base', mag_0167: 'mag', bullet_2_0168: 'mag', bullet_1_0169: 'mag', foregrip_0170: 'foregrip', foregrip_lock_0171: 'foregrip', bolt_handle_0172: 'bolt', silencer_0173: 'silencer', front_scope_0174: 'sightF', back_scope_0175: 'sightR', fire_switch_0156: 'safety', scope_0177: 'sight' },
      rest: 'base',
    },
    eye: 'Camera', atEye: true, ourArms: true,
    wrists: { right: 'hand_r_067', left: 'hand_l_021' },
    origin: [0.08, 0.02, -0.03],
    fps: 30,
    clips: { idle: 'root|MC_MP7_idle', draw: 'root|MC_MP7_show', fire: 'root|MC_MP7_shoot', reload: 'root|MC_MP7_reload', reloadEmpty: 'root|MC_MP7_full_reload', check: 'root|MC_MP7_inspect', walk: 'root|MC_MP7_walk_fwd_loop', run: 'root|MC_MP7_run_loop', holster: 'root|MC_MP7_hide' },
    credit: {
      name: 'MP7A1 Animations',
      url: 'https://sketchfab.com/3d-models/mp7a1-animations-0a55689855594f2496c2debdb7e6f5bc',
      author: 'TheParaziT',
      line: 'This work is based on "MP7A1 Animations" (https://sketchfab.com/3d-models/mp7a1-animations-0a55689855594f2496c2debdb7e6f5bc) by TheParaziT (https://sketchfab.com/TheParaziT) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'held in our own arms (its own arms left out), its pieces parted by joint, textures at 2048',
    },
  },
  sniper50: {
    dir: 'sniper50',
    file: 'scene.gltf',
    tex: 2048,
    scale: 0.01,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    // (its rifle in rigid pieces moved by their own nodes, as the old sniper pack's, by the same maker; its round a
    // piece of its own, which is what its loose rounds are drawn as)
    parts: { base: 'base', release: 'base', scope: 'scope', boltback: 'boltrear', bolt: 'bolt', trigger: 'trigger', mag: 'mag', bullet: 'bullet' },
    ourArms: true,
    wrists: { right: 'R_wrist_027', left: 'L_wrist_03' },
    origin: [0.08, 0.02, -0.03],
    fps: 30,
    // (one long animation: a shot, the bolt, a reload, and a look over it, by where its pieces move)
    clips: { fire: [0, 14], bolt: [16, 50], reload: [62, 118], check: [120, 164] },
    credit: {
      name: 'sniper animated',
      url: 'https://sketchfab.com/3d-models/sniper-animated-eae1ba5b43ae4bc89b0647fb5d8a2d27',
      author: 'DJMaesen',
      line: 'This work is based on "sniper animated" (https://sketchfab.com/3d-models/sniper-animated-eae1ba5b43ae4bc89b0647fb5d8a2d27) by DJMaesen (https://sketchfab.com/bumstrum) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'held in our own arms (its own arms left out), its one animation cut into movements, textures at 2048',
    },
  },
  barrett: {
    dir: 'barrett',
    file: 'scene.gltf',
    tex: 1024,
    fp: false,
    scale: 1,
    // (its muzzle toward -z: its magazine and scope are by the end its butt is)
    forward: [0, 0, -1],
    up: [0, 1, 0],
    fit: { to: 'sniper50', piece: 'base' },
    // (its cartridges' names have a times sign in them that came through as nothing readable; and they lie beside
    // the gun in its maker's scene: left out)
    rename: { 'Cartridge$': 'round_lying', 'Cartridge \(Fired\)$': 'case_lying', 'NATO Bullet$': 'bullet_lying' },
    skinned: {
      mesh: ['Barrett M82 Gun_Barrett M82 Main Body_0', 'Barrett M82 Gun_Barrett M82 Rail, Grip, Stock and others_0', 'Barrett M82 Gun_Barrett M82 Bolt Carrier_0'],
      // (and its bipod's two legs, each a piece of its own, to be folded and let down, the owner, 2026-10-17: "for the
      // barrett .50 cal add a button to toggle the bipod")
      joints: { 'M82 Bolt Carrier_09': 'bolt', 'M82 Trigger_05': 'trigger', 'M82 Bipod Handle Right_011': 'bipodR', 'M82 Bipod Handle Left_012': 'bipodL' },
      rest: 'base',
    },
    parts: { 'NightForce Scope': 'scope', 'Barrett M82 Magazine': 'mag' },
    credit: {
      name: 'Barrett-M82 (Optimized)',
      url: 'https://sketchfab.com/3d-models/barrett-m82-optimized-af16e974a47e463989311bcda6f51f87',
      author: 'Gintoki1234',
      line: 'This work is based on "Barrett-M82 (Optimized)" (https://sketchfab.com/3d-models/barrett-m82-optimized-af16e974a47e463989311bcda6f51f87) by Gintoki1234 (https://sketchfab.com/Gintoki1234) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'set in rigid pieces and held in our own arms moved as the .50 sniper pack moves its own, textures at 1024',
    },
  },
  vssk: {
    dir: 'vssk',
    file: 'scene.gltf',
    tex: 1024,
    fp: false,
    scale: 1,
    // (its barrel runs across its maker's scene, the muzzle at the end of its long can toward +x: it is a bullpup,
    // its magazine behind its grip by the butt)
    forward: [1, 0, 0],
    up: [0, 1, 0],
    fit: { to: 'sniper50', piece: 'base' },
    // (its sling left out; its round a piece of its own, what its loose rounds are drawn as)
    parts: { Object_2: 'base', Object_3: 'base', Object_5: 'mag', Object_8: 'bullet', Object_6: 'scope', Object_7: 'scope', Object_9: 'base', Object_10: 'base', Object_11: 'base', Object_12: 'base', Object_13: 'base' },
    credit: {
      name: 'VSSK Vykhlop',
      url: 'https://sketchfab.com/Diamonddogkz',
      author: 'Diamonddogkz',
      line: 'VSSK Vykhlop by Diamonddogkz (https://sketchfab.com/Diamonddogkz), Sketchfab Standard licence',
      changes: 'set in rigid pieces and held in our own arms moved as the .50 sniper pack moves its own, textures at 1024',
    },
  },
  m32: {
    dir: 'm32',
    file: 'scene.gltf',
    tex: 1024,
    fp: false,
    length: 0.81,
    // (its barrel runs across its maker's scene, the muzzle toward -x: its stock at the other end, its sight on top)
    forward: [-1, 0, 0],
    up: [0, 1, 0],
    // (it came with no movements: held in the .50 sniper rifle's, fitted by its stock. Its cylinder and the six
    // grenades in it are one piece; its speedloader, which only a reload of its own would have moved, is left out)
    fit: { to: 'sniper50', piece: 'base' },
    skinned: {
      mesh: ['mike32_barrel', 'mike32_frame', 'mike32_cylinder', 'grip_vert03', 'mike32_scope', 'att_lens_scope', 'stocktac02', 'grenades_heads', 'grenades_shells'],
      joints: {
        j_cylinder_06: 'cylinder', j_speed_loader_07: 'cylinder', j_speed_loader_cylinder_08: 'cylinder', grenades_09: 'cylinder',
        grenadeA_main_010: 'cylinder', grenadeB_main_013: 'cylinder', grenadeC_main_016: 'cylinder', grenadeD_main_025: 'cylinder', grenadeE_main_022: 'cylinder', grenadeF_main_019: 'cylinder',
        j_speed_loader_nade00_011: 'cylinder', j_speed_loader_nade01_014: 'cylinder', j_speed_loader_nade02_017: 'cylinder', j_speed_loader_nade03_020: 'cylinder', j_speed_loader_nade04_023: 'cylinder', j_speed_loader_nade05_026: 'cylinder',
        j_speed_loader_nade00_shell_012: 'cylinder', j_speed_loader_nade01_shell_015: 'cylinder', j_speed_loader_nade02_shell_018: 'cylinder', j_speed_loader_nade03_shell_021: 'cylinder', j_speed_loader_nade04_shell_024: 'cylinder', j_speed_loader_nade05_shell_027: 'cylinder',
        sight_scope_02: 'sight', zoom_wheelA_03: 'sight', zoom_wheelB_04: 'sight', j_trigger_029: 'trigger',
      },
      rest: 'base',
    },
    credit: {
      name: 'M32 MGL (old version)',
      url: 'https://sketchfab.com/ardickasaretas',
      author: 'ardickasaretas',
      line: 'M32 MGL (old version) by ardickasaretas (https://sketchfab.com/ardickasaretas), Sketchfab Standard licence',
      changes: 'set in rigid pieces and held in our own arms moved as the .50 sniper pack moves its own, textures at 1024',
    },
  },
  pitchfork: {
    dir: 'pitchfork',
    file: 'scene.gltf',
    tex: 2048,
    scale: 0.01,
    // (the fork alone laid along its own shaft, its tines flat)
    forward: [0.09, 0.276, 0.957],
    up: [-0.593, -0.757, 0.274],
    look: { forward: [0, 0, 1], up: [0, 1, 0] },
    parts: { pitchfork: 'base' },
    ourArms: true,
    wrists: { right: 'R_wrist_027', left: 'L_wrist_04' },
    origin: [0, 0, 0],
    fps: 30,
    // (held; a sweep to the right; a thrust from the shaft drawn back; a sweep to the left; held again: seen frame by
    // frame, progress/weapons/fork. It has no drawing of its coming up: the game lifts it into the picture.)
    clips: { idle: [96, 114], cutA: [14, 34], thrust: [40, 62], cutB: [64, 90] },
    credit: {
      name: 'pitchfork Animated',
      url: 'https://sketchfab.com/3d-models/pitchfork-animated-54ea2a82f7d74e8fabbc7245bec7be14',
      author: 'DJMaesen',
      line: 'This work is based on "pitchfork Animated" (https://sketchfab.com/3d-models/pitchfork-animated-54ea2a82f7d74e8fabbc7245bec7be14) by DJMaesen (https://sketchfab.com/bumstrum) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'held in our own arms (its own arms left out), its one animation cut into movements, textures at 2048',
    },
  },
  dualsmg: {
    dir: 'dualsmg',
    file: 'scene.gltf',
    tex: 2048,
    scale: 0.01,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    // (two of the one gun, one in each hand: the right one's pieces are the gun alone; the left one's, named _2, are
    // hung with a second copy of it in the game)
    parts: { base: 'base', ejector: 'base', bolt: 'bolt', trigger: 'trigger', mag: 'mag', bullet: 'mag' },
    keep: ['smg2Left', 'smg2Right', 'base_2', 'ejector_2', 'bolt_2', 'trigger_2', 'mag_2', 'bullet_2'],
    ourArms: true,
    wrists: { right: 'R_wrist_027', left: 'L_wrist_03' },
    origin: [0.08, 0.02, -0.03],
    fps: 30,
    // (both fire at once, both are reloaded at once, then held and looked over: by where their pieces move. The game
    // plays the shot for one hand and its gun at a time.)
    clips: { fire: [0, 9], reload: [15, 42], idle: [44, 70], check: [70, 122] },
    credit: {
      name: 'dual smgs',
      url: 'https://sketchfab.com/3d-models/dual-smgs-faf517bf83fd4029b4814f28f09881bb',
      author: 'DJMaesen',
      line: 'This work is based on "dual smgs" (https://sketchfab.com/3d-models/dual-smgs-faf517bf83fd4029b4814f28f09881bb) by DJMaesen (https://sketchfab.com/bumstrum) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'held in our own arms (its own arms left out), its one animation cut into movements, textures at 2048',
    },
  },
  dualmac: {
    dir: 'dualmac',
    file: 'scene.gltf',
    tex: 2048,
    fp: false,
    scale: 1,
    // (its muzzle, at the end of its suppressor, toward -z)
    forward: [0, 0, -1],
    up: [0, 1, 0],
    // (it came with no movements: held in the dual submachine guns', each MAC-10 on one of theirs; the right one's
    // pieces are the gun alone, its suppressor a piece of its own)
    fit: { to: 'dualsmg', piece: 'base' },
    parts: { mac10r_base: 'base', mac10r_magazine: 'mag', mac10r_bullet: 'mag', 'mac10r_outer frame_button': 'base', mac10r_bolt: 'bolt', 'mac10r_stock.': 'base', mac10r_stock_bars: 'base', mac10r_suppressor: 'silencer', mac10r_trigger: 'trigger', mac10r_ejector: 'base' },
    credit: {
      name: 'Dual Mac10 SMG - Animated',
      url: 'https://sketchfab.com/3d-models/dual-mac10-smg-animated-9a98526e69894b80a99ef328e889080f',
      author: 'user77',
      line: 'This work is based on "Dual Mac10 SMG - Animated" (https://sketchfab.com/3d-models/dual-mac10-smg-animated-9a98526e69894b80a99ef328e889080f) by user77 (https://sketchfab.com/user77) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'set in rigid pieces and held in our own arms moved as the dual submachine guns pack moves its own, textures at 2048',
    },
  },
  db12: {
    dir: 'shotgun_set',
    file: 'scene.gltf',
    tex: 2048,
    scale: 1,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    // (Its gun's points are a hundred times the size of the space its joints were bound in, and turned through
    // themselves: drawn as it came, by three.js too, the gun was 142 metres long behind the eye. Times -0.01 it is in
    // the hands, its bead on the bead's own joint at the muzzle. Alone it is as long as such a gun is.)
    meshScale: -0.01,
    aloneLength: 1.15,
    // (its four joints are named in Russian in a Windows code page: given names here by how theirs end)
    rename: { '^[^\\x00-\\x7f].*_049$': 'stock_049', '^[^\\x00-\\x7f].*_050$': 'barrels_050', '^[^\\x00-\\x7f].*_051$': 'bead_051', '^[^\\x00-\\x7f].*_052$': 'shells_052' },
    skinned: { mesh: ['Shotgun_Material.001_0'], joints: { stock_049: 'base', barrels_050: 'barrels', bead_051: 'barrels', shells_052: 'shells' }, rest: 'base' },
    eye: 'cam_controller_047', atEye: true, ourArms: true,
    wrists: { right: 'r_wrist_028', left: 'l_wrist_03' },
    origin: [0.08, 0.02, -0.03],
    fps: 30,
    clips: { fire: 'Shoot', draw: 'Equip', holster: 'Unequip', reload: 'Reload', walk: 'Walk', run: 'Run' },
    credit: {
      name: 'Shotgun animation set',
      url: 'https://sketchfab.com/3d-models/shotgun-animation-set-c24e049dccfe4a1d837b1b0ae1461636',
      author: 'Vlasov Daniil',
      line: 'This work is based on "Shotgun animation set" (https://sketchfab.com/3d-models/shotgun-animation-set-c24e049dccfe4a1d837b1b0ae1461636) by Vlasov Daniil (https://sketchfab.com/dan741vlasov) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'held in our own arms (its own arms left out), its gun stood at the size and the turn its joints were bound in, its pieces parted by joint, textures at 2048',
    },
  },
  sawnoffs: {
    dir: 'sawnoffs',
    file: 'scene.gltf',
    tex: 2048,
    scale: 0.01,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    // (a sawn-off in each hand: the right one's pieces are the gun alone, the left one's (_2) a second copy in the game)
    parts: { base: 'base', release: 'base', trigger1: 'trigger', trigger2: 'trigger', front: 'front', unloader: 'front', slug1: 'slug1', slug2: 'slug2' },
    keep: ['sawnoffL', 'sawnoffR', 'base_2', 'release_2', 'trigger1_2', 'trigger2_2', 'front_2', 'unloader_2', 'slug1_2', 'slug2_2'],
    ourArms: true,
    wrists: { right: 'R_wrist_027', left: 'L_wrist_03' },
    origin: [0.08, 0.02, -0.03],
    fps: 30,
    // (the right one fires, then the left, then both are broken open and loaded, by where their pieces move)
    clips: { fire: [0, 10], fireR: [0, 10], fireL: [12, 22], reload: [32, 66] },
    credit: {
      name: 'sawnoffs Animated',
      url: 'https://sketchfab.com/3d-models/sawnoffs-animated-001bec4277414a62bb8ad9b2a1a7abcb',
      author: 'DJMaesen',
      line: 'This work is based on "sawnoffs Animated" (https://sketchfab.com/3d-models/sawnoffs-animated-001bec4277414a62bb8ad9b2a1a7abcb) by DJMaesen (https://sketchfab.com/bumstrum) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'held in our own arms (its own arms left out), its one animation cut into movements, textures at 2048',
    },
  },
  aks74u: {
    dir: 'aks74u',
    file: 'scene.gltf',
    tex: 2048,
    scale: 1,
    forward: [0, 0, -1],
    up: [0, 1, 0],
    // (filed as held, as the AK's pack is: its sights rise 2.7 degrees to the muzzle and turn 3.6 to the left, and the
    // ears of its front sight lean it over to the left about six. The gun alone is made straight.)
    trim: { pitch: 2.7, yaw: -3.6, roll: 6 },
    skinned: {
      mesh: ['arms_aks74u_0', 'arms_aks74u.wood_0', 'arms_bullet_0'],
      joints: { wpn_body_068: 'base', wpn_zatvor_069: 'bolt', wpn_trigger_070: 'trigger', wpn_magazine_lock_071: 'base', wpn_magazine_072: 'mag', wpn_bullets_073: 'mag', wpn_magazine_2_074: null, wpn_bullets_2_075: null, wpn_magazine_rig_076: null, wpn_bullets_rig_077: null, wpn_magazine_rig_2_078: null, 'wpn_bullets_rig.001_079': null },
      rest: 'base',
    },
    eye: 'Camera', atEye: true, ourArms: true,
    wrists: { right: 'hand_r_016', left: 'hand_l_042' },
    origin: [0.08, 0.02, -0.03],
    fps: 30,
    // (no movement of its own for standing still, walking or looking it over: the first frame of a shot is how it is held)
    clips: { fire: 'armature|Fire_single', draw: 'armature|Put_in', holster: 'armature|Put_out', reload: 'armature|Reload_t', reloadEmpty: 'armature|Reload_f' },
    credit: {
      name: 'Animated AKs-74u',
      url: 'https://sketchfab.com/3d-models/animated-aks-74u-34220aaa62e44b34b7d5ac30701f2b5f',
      author: 'Vlasov Daniil',
      line: 'This work is based on "Animated AKs-74u" (https://sketchfab.com/3d-models/animated-aks-74u-34220aaa62e44b34b7d5ac30701f2b5f) by Vlasov Daniil (https://sketchfab.com/dan741vlasov) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'held in our own arms (its own arms left out), its pieces parted by joint, textures at 2048',
    },
  },
  // The 9A-91 (2026-10-20, the owner: "i added a new gun ... collapsable stock for this rifle should be same key [as
  // the Barrett's bipod], animated"). Rigid pieces on joints of their own, in the AK's hands as the AR-15 is, fitted
  // magazine to magazine. Its stock is two pieces, the frame and the butt plate on its own hinge, folded by the game
  // as its maker's one animation folds them; its PBS suppressor is a piece shown when fitted; its round lies beside it
  // in its maker's scene and is what its loose rounds are drawn as. In metres as it comes, its muzzle to +z.
  a91: {
    dir: '9a91',
    file: 'scene.gltf',
    // (five sets of pictures on one small gun: at 2048 it was 320 MB on the card in the hands, four times the AK's; at
    // 1024 a set it is drawn as sharp as the AK is, whose one 2048 set covers its whole gun and arms. The owner,
    // 2026-10-20: "make sure no suboptimal fps drops")
    tex: 1024,
    fp: false,
    scale: 1,
    forward: [0, 0, 1],
    up: [0, 1, 0],
    fit: { to: 'ak', piece: 'mag' },
    parts: { 'Bone.003_03': 'butt', 'Bone.001_01': 'stock', 'Bone.005_06': 'silencer', 'Bone.006_08': 'trigger', 'Bone.007_09': 'mag', Bone_00: 'base', 'wTube.087': 'bullet' },
    credit: {
      name: '9A-91 Assault Rifle Gameready Lowpoly',
      url: 'https://sketchfab.com/3d-models/9a-91-assault-rifle-gameready-lowpoly-788797a8a6284a29a04961cb09072eda',
      author: 'valterjherson1',
      line: 'This work is based on "9A-91 Assault Rifle Gameready Lowpoly" (https://sketchfab.com/3d-models/9a-91-assault-rifle-gameready-lowpoly-788797a8a6284a29a04961cb09072eda) by valterjherson1 (https://sketchfab.com/valterjherson1) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'Set in rigid pieces (the rifle, its stock and butt plate, its magazine, trigger and suppressor, its round) and held in the AK pack\'s hands; its stock folded by the game along the path its own animation takes; textures re-encoded as WebP at no more than 1024 a side; geometry compressed.',
    },
  },
};

export const MODELS = {
  // weapons (viewmodels get 2k textures)
  ammo_box: { res: '1k', tex: 1024, budget: 2500, tags: ['loot'] },

  // loot
  russian_food_cans_01: { res: '1k', tex: 1024, tags: ['loot'] },
  long_life_food: { res: '1k', tex: 1024, tags: ['loot'] },
  metal_jerrycan_green: { res: '1k', tex: 1024, tags: ['loot'] },
  plastic_thermos: { res: '1k', tex: 1024, tags: ['loot'] },
  plastic_bottle_gallon: { res: '1k', tex: 1024, tags: ['loot'] },
  medical_box: { res: '1k', tex: 1024, tags: ['loot'] },
  medical_tape: { res: '1k', tex: 1024, tags: ['loot'] },
  binoculars: { res: '1k', tex: 1024, tags: ['loot'] },
  hatchet: { res: '1k', tex: 1024, tags: ['loot'] },
  crowbar_01: { res: '1k', tex: 1024, tags: ['loot'] },
  machete: { res: '1k', tex: 1024, tags: ['loot'] },
  baseball_bat: { res: '1k', tex: 1024, tags: ['loot'] },
  // The GP-5 alone (2026-10-13): "get rid of the long hose in the front and the box thats attached to the model so
  // its just the mask and the protusion out the front". It came as nine islands of one mesh: the hood, its two
  // eyepieces, the valve housing at the mouth with a small valve beside it and the knurled nut that closes the
  // housing's end, and, below those, a metre of hose, the coupling at the hose's foot and the filter can. Those
  // three, which are all that reaches more than 30 cm below the middle of the hood, are left out. The nut is a
  // cap, closed across its end, so nothing is left open where the hose was. What is left is then laid on its
  // back, eyepieces up, as a mask lies where it is put down (it came hanging upright from nothing, and would
  // stand on the end of its valve). Every triangle of what is kept is kept: the five thousand it was brought down
  // to were for the mask and the hose together.
  old_gas_mask: { res: '1k', tex: 1024, tags: ['loot'], isles: { drop: (lo) => lo[1] < -0.3, swing: [{ pick: () => true, axis: [1, 0, 0], angle: -Math.PI / 2 }] } },
  vintage_flashlight: { res: '1k', tex: 1024, tags: ['loot'] },
  cigarette_pack: { res: '1k', tex: 1024, tags: ['loot'] },
  food_apple_01: { res: '1k', tex: 1024, tags: ['loot'] },
  can_rusted: { res: '1k', tex: 512, budget: 1500, tags: ['loot'] },
  seadogs_compass: { res: '1k', tex: 1024, tags: ['loot'] },
  digital_wrist_watch: { res: '1k', tex: 1024, tags: ['loot'] },
  stick_grenade: { res: '1k', tex: 1024, tags: ['loot'] },
  vintage_radio_transceiver: { res: '1k', tex: 1024, tags: ['loot'] },
  fish_knife: { res: '1k', tex: 1024, tags: ['loot'] },

  // clothing and bags
  fishermans_hat: { res: '1k', tex: 1024, budget: 4000, tags: ['loot'] },
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
  // (the bunker's generator and its gas, in place of the ones it was drawn with: 2026-10-17, "replace the ones in the
  // bunker we made ourselves")
  portable_generator: { res: '2k', tex: 2048, budget: 14000, far: 1400, tags: ['prop'] },
  propane_tank: { res: '1k', tex: 1024, budget: 4000, far: 400, tags: ['prop'] },
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
  // (2026-10-19, the west's rooms dressed: "some of the buildings look unnatural or hollow with no decoration". The
  // painted set the chairs, table and cabinet are of; a candlestick for the church and the chapel; a sofa and an
  // armchair for the flats)
  painted_wooden_bench: { res: '1k', tex: 1024, budget: 630, far: 200, tags: ['furniture'] },
  painted_wooden_nightstand: { res: '1k', tex: 512, budget: 470, far: 200, tags: ['furniture'] },
  painted_wooden_shelves: { res: '1k', tex: 1024, budget: 524, far: 200, tags: ['furniture'] },
  painted_wooden_stool: { res: '1k', tex: 512, budget: 676, far: 200, tags: ['furniture'] },
  wooden_candlestick: { res: '1k', tex: 512, budget: 1600, far: 100, tags: ['furniture'] },
  sofa_02: { res: '1k', tex: 1024, budget: 2728, far: 300, tags: ['furniture'] },
  GreenChair_01: { res: '1k', tex: 1024, budget: 4213, far: 300, tags: ['furniture'] },

  // nature
  rock_moss_set_01: { res: '1k', tex: 1024, budget: 40000, far: 6000, tags: ['nature'] },
  rock_moss_set_02: { res: '1k', tex: 1024, budget: 40000, far: 6000, tags: ['nature'] },
  boulder_01: { res: '1k', tex: 1024, budget: 9000, far: 1200, tags: ['nature'] },
  tree_stump_01: { res: '1k', tex: 1024, budget: 6000, far: 600, tags: ['nature'] },
  dead_tree_trunk: { res: '1k', tex: 1024, budget: 8000, far: 800, tags: ['nature'] },
  fern_02: { res: '1k', tex: 1024, budget: 3000, far: 300, tags: ['nature'] },
  dry_branches_medium_01: { res: '1k', tex: 1024, budget: 4000, far: 500, tags: ['nature'] },
  // the desert and the coast (2026-10-16, not yet placed): Poly Haven's Namaqualand scans, built one at a time by
  // scripts/haven-models.mjs. A canyon's walls and outcrops (its cave mouths: see below), boulders for its floor and the
  // beach, a bleached branch for the tide line. Pictures at the 2k they came at (tier-now keeps
  // them in hi/). The scans came at 15,000 to 194,000 triangles; each is brought down only as far as keeps every point
  // of it within 2 to 11 mm of where it was, by its size (`--probe`), its relief map carrying the rest; the scan as it
  // came beside the copy: progress/map3/kit/pair-*.jpg (the rule for dense scans, 2026-10-13).
  namaqualand_cliff_01: { res: '2k', tex: 2048, budget: 52000, far: 4000, tags: ['nature'] },
  namaqualand_cliff_02: { res: '2k', tex: 2048, budget: 45000, far: 6000, tags: ['nature'] },
  namaqualand_boulder_02: { res: '2k', tex: 2048, budget: 34000, far: 2500, tags: ['nature'] },
  namaqualand_boulder_03: { res: '2k', tex: 2048, budget: 30000, far: 2500, tags: ['nature'] },
  namaqualand_boulder_04: { res: '2k', tex: 2048, budget: 44000, far: 2500, tags: ['nature'] },
  namaqualand_boulder_05: { res: '2k', tex: 2048, budget: 20000, far: 1200, tags: ['nature'] },
  dead_quiver_branch_01: { res: '2k', tex: 2048, budget: 9800, far: 500, tags: ['nature'] },
  // green woods and meadows (2026-10-16, the owner: "desert is ugly the grass is prettier we can make new forests and
  // biomes with the textures we get from that website"): a mossy stump, a fallen trunk, a mound of roots for an old wood;
  // and a cliff face ten metres high for the canyon's cave mouths and walls. Budgets as above. (Saplings, bushes and
  // meadow flowers were tried and taken out again, the owner: "i dont think the plants will give us much to work with in game".)
  tree_stump_02: { res: '2k', tex: 2048, budget: 19000, far: 1500, tags: ['nature'] },
  dead_tree_trunk_02: { res: '2k', tex: 2048, budget: 16000, far: 1200, tags: ['nature'] },
  root_cluster_01: { res: '2k', tex: 2048, budget: 40000, far: 3000, tags: ['nature'] },
  mountainside: { res: '2k', tex: 2048, budget: 46000, far: 5000, tags: ['nature'] },
};

/**
 * Poly Haven models that are made into a file of NAMED PIECES (2026-10-13), which `scripts/fetch-assets.mjs` does
 * not know how to do: a kit whose pieces share one set of pictures (the fort), a door whose leaves turn, and a
 * rock whose near copy keeps its colour picture whole and the rest at half. In the file each piece is an empty
 * node at the top, named by its id and nowhere in particular; its shapes hang under it, one to a material, said
 * from the piece's own origin. One file, so one copy of the pictures however many pieces are stood.
 * Three files each: `<id>.glb` (the world's copy: colour 1024, the rest 512), `hi/<id>.glb` (near), `<id>_lod1.glb`
 * (far). The manifest entry has `pieces`: each piece's box from its origin and its triangles.
 *   src   – its Poly Haven id (the folder under assets-src/models/)
 *   name  – a piece's id, from the name its node came with;  mat – the same for a material
 *   shut  – its pieces keep the places they came in and lose their turn (a door's leaves, which came ajar)
 *   hi    – the near copy: the longest side of each material's [colour, relief, the rest]
 *   far   – the far copy: the share of its triangles kept, how far from its shape it may go (of its size), `open`
 *           if its open edges may move (a rock; a kit's must not, or neighbours part), and its pictures' sizes
 * Why these sizes: progress/intake/CATALOGUE.md and the two picture sheets beside it. NOT built by `npm run
 * assets` (which would also drop them from the manifest): by the intake lane's `kit.mjs`, a copy of which is
 * kept in progress/intake/tools/.
 */
export const HAVEN_KITS = {
  fort_kit: {
    src: 'modular_fort_01',
    name: (n) => n.replace('modular_fort_01_', 'fort_'),
    mat: (n) => n.replace('modular_fort_01_', 'fort_').replace(/_1$/, ''),
    hi: { fort_wall: [2048, 2048, 2048], fort_trim: [2048, 2048, 2048], fort_plaster: [2048, 2048, 1024] },
    far: { ratio: 0.4, error: 0.004, colour: 512, other: 256 },
    tags: ['building', 'kit'],
  },
  large_castle_door: {
    src: 'large_castle_door',
    name: (n) => n,
    mat: (n) => n,
    shut: true,
    hi: { large_castle_door: [2048, 2048, 2048] },
    far: { ratio: 0.12, error: 0.01, colour: 512, other: 256 },
    tags: ['building', 'door'],
  },
  rock_face_01: { src: 'rock_face_01', name: (n) => n, mat: (n) => n, hi: { rock_face_01: [2048, 2048, 2048] }, far: { ratio: 0.125, error: 0.02, open: true, colour: 512, other: 256 }, tags: ['nature'] },
  rock_face_02: { src: 'rock_face_02', name: (n) => n, mat: (n) => n, hi: { rock_face_02: [2048, 2048, 2048] }, far: { ratio: 0.1, error: 0.02, open: true, colour: 512, other: 256 }, tags: ['nature'] },
  // (2026-10-16, the new land's towns: brick works and plaster flats dressed over the game's own buildings. Their
  // pictures come at 2k, so the world copy is the one drawn close to. Their flat pieces came finely cut up, to the
  // edges: thinned with their edges free, as a straight edge loses none of its line when its middle points go.)
  factory_kit: {
    src: 'modular_factory_facade',
    name: (n) => n,
    mat: (n) => n.replace('modular_factory_facade_', 'factory_'),
    hi: null,
    world: { ratio: 0.05, error: 0.003, open: true },
    far: { ratio: 0.03, error: 0.03, open: true, colour: 512, other: 256 },
    tags: ['building', 'kit'],
  },
  flats_kit: {
    src: 'modular_urban_apartments_facade',
    name: (n) => n,
    mat: (n) => n.replace('modular_urban_apartments_facade_', 'flats_'),
    hi: null,
    world: { ratio: 0.05, error: 0.003, open: true },
    far: { ratio: 0.03, error: 0.03, open: true, colour: 512, other: 256 },
    tags: ['building', 'kit'],
  },
  // (the fishing village's piers: sections on poles, a gateway, loose poles, a landing of planks. Each section came at
  // twelve to twenty-three thousand triangles of bevelled planks.)
  pier_kit: {
    src: 'modular_wooden_pier',
    name: (n) => n.replace('modular_wooden_pier_', 'pier_'),
    mat: (n) => n.replace('modular_wooden_pier_', 'pier_'),
    hi: null,
    world: { ratio: 0.15, error: 0.004, open: true },
    far: { ratio: 0.05, error: 0.03, open: true, colour: 512, other: 256 },
    tags: ['building', 'kit'],
  },
};
