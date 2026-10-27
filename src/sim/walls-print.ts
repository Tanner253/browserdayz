// A print of the map's buildings: the server's walls (server/solids.bin.gz, scripts/solid-bake.mjs) carry the
// print of the map they were baked from, and the server holds it against its own. Told apart, the walls are of
// another map, and the server goes without them rather than refuse shots by walls that are not there.

export function wallsPrint(buildings: readonly { type: string; x: number; z: number; rot: number }[]): string {
  const s = buildings.map((b) => `${b.type}@${b.x.toFixed(1)},${b.z.toFixed(1)},${b.rot.toFixed(2)}`).join(';');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${buildings.length}:${(h >>> 0).toString(36)}`;
}
