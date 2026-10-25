// How big a building material is in the hands (2026-10-24). The navigator, of planks taken into the hands that filled
// half the screen as one board: "Held building materials (planks, logs, sheet metal, the nails box) should sit in the
// right fist at the size and place a tin or a flask does, the way the hands show anything that isn't a gun." So each is
// drawn with its longest side this long, metres, in first person (src/game/weapons.ts) and in the inventory's figure
// (src/game/doll.ts) alike.
export const HELD_FIT: Record<string, number> = {
  planks: 0.2,
  log: 0.22,
  sheet_metal: 0.18,
  nails: 0.11,
  stone: 0.12,
  building_plan: 0.28,
  torch: 0.52,
};
