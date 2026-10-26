// How big a building material is in the hands (2026-10-24). The navigator, of planks taken into the hands that filled
// half the screen as one board: "Held building materials (planks, logs, sheet metal, the nails box) should sit in the
// right fist at the size and place a tin or a flask does, the way the hands show anything that isn't a gun." So each is
// drawn with its longest side this long, metres, in first person (src/game/weapons.ts) and in the inventory's figure
// (src/game/doll.ts) alike.
export const HELD_FIT: Record<string, number> = {
  // (what is set down in a base, carried before it: src/sim/build/pieces.ts PLACED)
  box_small: 0.34,
  box_large: 0.4,
  workbench: 0.42,
  forge: 0.4,
  bed: 0.45,
  research_table: 0.42,
  door_wood: 0.45,
  door_metal: 0.45,
  double_door_wood: 0.45,
  double_door_metal: 0.45,
  garage_door: 0.45,
  hatch: 0.45,
  gate_wood: 0.45,
  gate_stone: 0.45,
  door_armoured: 0.45,
  garage_door_armoured: 0.45,
  planks: 0.2,
  log: 0.22,
  sheet_metal: 0.18,
  nails: 0.11,
  stone: 0.12,
  building_plan: 0.28,
  torch: 0.52,
};
