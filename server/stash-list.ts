// Where every stash kept on the map lies, told to the owner alone by /stashes (server/admin.ts), so that a release that
// changes the map can be checked against them first (scripts/stash-guard.ts; the owner, 2026-10-23: "we cannot change
// the map around user stashes"). Each as [x, y, z, buried 1 / lying 0], fifteen to a line, every line starting STASHES,
// to be copied as it is (the guard reads every such line).

type Kept = { kind: string; buried?: boolean; x: number; y: number; z: number };
type Lying = { keptAt?: number; x: number; y: number; z: number };

const r1 = (v: number) => Math.round(v * 10) / 10;

export function stashLines(boxes: Iterable<Kept>, loot: Iterable<Lying>): { buried: number; total: number; lines: string[] } {
  const list: [number, number, number, number][] = [];
  for (const b of boxes) if (b.kind === 'stash') list.push([r1(b.x), r1(b.y), r1(b.z), b.buried ? 1 : 0]);
  for (const l of loot) if (l.keptAt !== undefined) list.push([r1(l.x), r1(l.y), r1(l.z), 0]);
  const lines: string[] = [];
  for (let k = 0; k < list.length; k += 15) lines.push(`STASHES ${JSON.stringify(list.slice(k, k + 15))}`);
  return { buried: list.filter((q) => q[3]).length, total: list.length, lines };
}
