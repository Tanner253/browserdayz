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
    tex: 4096,
    tags: ['loot', 'ammo'],
    changes: 'Scaled to metres and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
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
    tex: 1024,
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
    // (as big as it came: it was brought down to 2048, a quarter of its points, and its brick was soft close to)
    tex: 4096,
    bare: true,
    rough: 0.9,
    metal: 0,
    tags: ['prop'],
    changes: 'Stood on the ground about its own middle; its colour and its relief re-encoded as WebP at the size they came, its other maps left out; geometry compressed.',
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
  // The K6-3 (2026-10-10): the heaviest helmet there is, its visor up. Its brow is toward -z as it comes, which is
  // the way a body faces. It came a hundred units wide: at this it is 29 cm, a size over the combat helmet.
  helmet_k63: {
    dir: 'helmet_k63',
    scale: 0.00279,
    // (as big as its pictures came)
    tex: 2048,
    tags: ['loot', 'gear'],
    changes: 'Scaled to a head and stood on the ground about its own middle; textures re-encoded as WebP at the size they came; geometry compressed.',
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
  shanty_mansion: {
    dir: 'shanty_mansion',
    // (as it came it was twice the size of a house: a floor of it was five metres high. At this, a floor is 2.7 m.)
    size: 15.8,
    // (as big as they came: they were brought down to 1024, a sixteenth of their points)
    tex: 4096,
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
  // The police car (2026-10-10): the second car, a road car. It came 6.7 long, nose toward +z, a quarter of a
  // million triangles, and with its brakes as pieces of their own (four more things called a wheel): those are
  // left out, and it is made the length of the car it is drawn from. Nothing else of it is lessened: every
  // triangle it came with, and its pictures at the size they came ("i dont want the quality of the models to be
  // lowered"). It was first brought down to sixty thousand triangles and 2048: that was put back.
  police_car: {
    kind: 'vehicle',
    file: 'scene.gltf',
    tex: 4096,
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
      changes: 'Scaled to metres and turned to face the way the game drives; each wheel re-centred on its own middle; its brake discs left out; textures re-encoded as WebP at the size they came; geometry compressed.',
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
    tex: 4096,
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
    origin: [0.3, 0.02, -0.03],
    fps: 30,
    clips: { idle: 'Rig|AK_Idle', draw: 'Rig|AK_Draw', fire: 'Rig|AK_Shot', reload: 'Rig|AK_Reload', reloadEmpty: 'Rig|AK_Reload_full', reloadOther: 'Rig|AK_Reload_var2', walk: 'Rig|AK_Walk', run: 'Rig|AK_Run' },
    credit: {
      name: 'FPS AK-74m animations',
      url: 'https://sketchfab.com/3d-models/fps-ak-74m-animations-94be8385c402474cacd39bc096c6ca14',
      author: 'Cransh',
      line: 'This work is based on "FPS AK-74m animations" (https://sketchfab.com/3d-models/fps-ak-74m-animations-94be8385c402474cacd39bc096c6ca14) by Cransh (https://sketchfab.com/ccransh) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      changes: 'Scaled to metres; its eight animations laid end to end as the one the game plays; a copy of the rifle alone, taken off its skeleton and standing still, in two pieces (the rifle and its magazine), made for the ground and for other players; textures re-encoded as WebP at the size they came; geometry compressed.',
    },
  },
  // The AR-15 (2026-10-10): a rifle and nothing else, in twenty-nine pieces, with what was fitted to it as it
  // came: a suppressor and the brake it goes on in place of, a holographic sight, a foregrip, a light on its
  // mount, a magazine. Each of those is a piece by itself here, there when the thing is fitted and not otherwise
  // (see `shows` on the weapon). It came with no hands and no movements: it is held in the AK's, set where the
  // AK is, magazine to magazine, since it is the magazine the hands go to. Every triangle and every picture as
  // it came. Ten of its units are a metre: its lower receiver is 2.1 of them long, and an AR's is 0.2 m.
  ar15: {
    dir: 'ar15',
    file: 'scene.gltf',
    tex: 2048,
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
      changes: 'Scaled to metres and set in the pieces the game shows and hides (the rifle, its magazine, its brake, its suppressor, its sight, its foregrip, its light); its muzzle brake, which lay beside the rifle, put on the barrel; textures re-encoded as WebP at the size they came; geometry compressed.',
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
