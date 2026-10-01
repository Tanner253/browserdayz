// Asset manifest for the vertical slice. Every entry here is CC0 from Poly Haven
// (https://polyhaven.com). The pipeline downloads the source files, compresses
// them for the web and writes public/assets/manifest.json + CREDITS.md.
//
//   res        – source resolution to download from Poly Haven
//   tex        – max texture size after re-encoding (webp)
//   simplify   – meshopt simplify ratio for over-dense scans (0..1)
//   lods       – extra simplified copies written as <id>_lod1.glb, <id>_lod2.glb

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

export const MODELS = {
  // weapons (viewmodels get 2k textures)
  bolt_action_rifle_7_62: { res: '2k', tex: 2048, tags: ['weapon'] },
  service_pistol: { res: '2k', tex: 2048, tags: ['weapon'] },
  ammo_box: { res: '1k', tex: 1024, tags: ['loot'] },

  // loot
  russian_food_cans_01: { res: '1k', tex: 1024, tags: ['loot'] },
  long_life_food: { res: '1k', tex: 1024, tags: ['loot'] },
  metal_jerrycan_green: { res: '1k', tex: 1024, tags: ['loot'] },
  plastic_thermos: { res: '1k', tex: 1024, tags: ['loot'] },
  plastic_bottle_gallon: { res: '1k', tex: 512, tags: ['loot'] },
  medical_box: { res: '1k', tex: 1024, tags: ['loot'] },
  medical_tape: { res: '1k', tex: 512, tags: ['loot'] },
  binoculars: { res: '1k', tex: 1024, tags: ['loot'] },
  hatchet: { res: '1k', tex: 1024, tags: ['loot'] },
  crowbar_01: { res: '1k', tex: 1024, tags: ['loot'] },
  machete: { res: '1k', tex: 1024, tags: ['loot'] },
  baseball_bat: { res: '1k', tex: 512, tags: ['loot'] },
  old_gas_mask: { res: '1k', tex: 1024, tags: ['loot'] },
  vintage_flashlight: { res: '1k', tex: 1024, tags: ['loot'] },
  cigarette_pack: { res: '1k', tex: 512, tags: ['loot'] },
  food_apple_01: { res: '1k', tex: 512, tags: ['loot'] },
  can_rusted: { res: '1k', tex: 512, tags: ['loot'] },
  seadogs_compass: { res: '1k', tex: 512, tags: ['loot'] },
  digital_wrist_watch: { res: '1k', tex: 512, tags: ['loot'] },
  stick_grenade: { res: '1k', tex: 512, tags: ['loot'] },
  vintage_radio_transceiver: { res: '1k', tex: 1024, simplify: 0.5, tags: ['loot'] },
  fish_knife: { res: '1k', tex: 512, tags: ['loot'] },

  // clothing and bags
  fishermans_hat: { res: '1k', tex: 1024, tags: ['loot'] },
  life_jacket: { res: '1k', tex: 1024, simplify: 0.5, tags: ['loot'] },
  rubber_boots: { res: '1k', tex: 1024, tags: ['loot'] },
  garden_gloves_01: { res: '1k', tex: 512, tags: ['loot'] },
  vintage_suitcase: { res: '1k', tex: 1024, tags: ['loot'] },

  // containers / stash
  wooden_military_crate: { res: '1k', tex: 1024, tags: ['prop'] },
  old_military_crate: { res: '1k', tex: 1024, tags: ['prop'] },

  // world props
  covered_car: { res: '1k', tex: 1024, tags: ['prop'] },
  concrete_road_barrier: { res: '1k', tex: 1024, simplify: 0.25, tags: ['prop'] },
  Barrel_01: { res: '1k', tex: 1024, tags: ['prop'] },
  barrel_03: { res: '1k', tex: 1024, tags: ['prop'] },
  wooden_crate_01: { res: '1k', tex: 1024, tags: ['prop'] },
  cardboard_box_01: { res: '1k', tex: 512, tags: ['prop'] },
  metal_trash_can: { res: '1k', tex: 1024, tags: ['prop'] },
  old_tyre: { res: '1k', tex: 512, tags: ['prop'] },
  utility_box_01: { res: '1k', tex: 512, tags: ['prop'] },
  trashbag: { res: '1k', tex: 512, tags: ['prop'] },
  stone_fire_pit: { res: '1k', tex: 1024, tags: ['prop'] },
  wooden_ladder: { res: '1k', tex: 512, tags: ['prop'] },
  street_lamp_01: { res: '1k', tex: 1024, simplify: 0.5, tags: ['prop'] },

  // interiors
  old_bed_frame: { res: '1k', tex: 1024, simplify: 0.4, tags: ['furniture'] },
  WoodenTable_01: { res: '1k', tex: 1024, tags: ['furniture'] },
  painted_wooden_table: { res: '1k', tex: 1024, tags: ['furniture'] },
  painted_wooden_chair_01: { res: '1k', tex: 512, tags: ['furniture'] },
  SchoolChair_01: { res: '1k', tex: 512, tags: ['furniture'] },
  Shelf_01: { res: '1k', tex: 1024, tags: ['furniture'] },
  steel_frame_shelves_01: { res: '1k', tex: 1024, tags: ['furniture'] },
  wooden_bookshelf_worn: { res: '1k', tex: 1024, tags: ['furniture'] },
  painted_wooden_cabinet: { res: '1k', tex: 1024, tags: ['furniture'] },
  scandinavian_masonry_heater: { res: '1k', tex: 1024, tags: ['furniture'] },
  metal_office_desk: { res: '1k', tex: 1024, tags: ['furniture'] },
  Television_01: { res: '1k', tex: 512, tags: ['furniture'] },
  electric_stove: { res: '1k', tex: 512, tags: ['furniture'] },

  // nature
  rock_moss_set_01: { res: '1k', tex: 1024, lods: [0.15], tags: ['nature'] },
  rock_moss_set_02: { res: '1k', tex: 1024, lods: [0.15], tags: ['nature'] },
  boulder_01: { res: '1k', tex: 1024, simplify: 0.25, lods: [0.2], tags: ['nature'] },
  tree_stump_01: { res: '1k', tex: 1024, simplify: 0.4, tags: ['nature'] },
  dead_tree_trunk: { res: '1k', tex: 1024, simplify: 0.2, tags: ['nature'] },
  fern_02: { res: '1k', tex: 1024, tags: ['nature'] },
  dry_branches_medium_01: { res: '1k', tex: 1024, simplify: 0.5, tags: ['nature'] },
};
