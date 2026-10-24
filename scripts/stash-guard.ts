// npx tsx scripts/stash-guard.ts <stashes.json> [--base <git ref>] [--r 15]: THE PLAYERS' STASHES, KEPT AS THEY WERE.
// The owner, 2026-10-23: "we cannot change the map around user stashes, or risk making them unreachable. we need to
// maintain stash locations, not change the geography around them and not build on top of them". So before any deploy
// that changes the world, this makes the world of the base (default `main`, what is live) and of this tree, and at
// every buried stash compares the ground (every metre out to R, drawn and server alike) and everything standing within
// R of it (trees, rocks, outcrops, the pass's rocks, buildings, walls, slabs, posts, solids, towns, Kalat). Any
// difference fails it (exit 1). It also names every part of the map whose ground or things changed, so a change
// is seen to stay where it was meant to.
//
// The stash list comes from the live server (positions are never committed: keep it under progress/, which git
// leaves out). The base is the base ref's src/ and server/, unpacked into .stash-base/ beside this tree's own
// node_modules, its world printed by this same file run there (`--print`), then removed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Stash = { x: number; y?: number; z: number };
type Thing = { k: string; x: number; z: number; r: number; s: string };
type Print = { at: Stash; ground: number[]; things: Thing[] };
type Prints = { R: number; stashes: Print[]; places: { name: string; x: number; z: number }[]; all: [string, number, number, number][]; map: { step: number; nx: number; nz: number; x0: number; z0: number; h: number[]; cells: Record<string, string> } };

const args = process.argv.slice(2);
const opt = (name: string, d: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const R = Number(opt('--r', '15'));
const r2 = (v: number) => Math.round(v * 100) / 100;

function readStashes(file: string): Stash[] {
  if (file === '-') return [];
  // (what /stashes answers, every STASHES line of it as copied, or a plain list)
  const text = readFileSync(file, 'utf8'), lines = text.match(/STASHES\s*\[.*\]/g);
  const raw = (lines ? lines.flatMap((l) => JSON.parse(l.replace(/^STASHES\s*/, ''))) : JSON.parse(text)) as unknown[];
  return raw.map((s) => (Array.isArray(s) ? { x: s[0], y: s[1], z: s[2] } : (s as Stash))).filter((s) => Number.isFinite(s.x) && Number.isFinite(s.z));
}

/** this tree's world, printed at each stash and over the whole map (run from the tree whose world is wanted) */
async function print(stashes: Stash[]): Promise<Prints> {
  const WG = await import('../src/world/worldgen');
  const { outcropPieces } = await import('../src/world/outcrops');
  const { rockPieces } = await import('../src/sim/pass');
  const T = await import('../src/sim/towns');
  const world = WG.generateWorld();
  const H = (x: number, z: number) => WG.heightAt(world.heights, x, z), S = (x: number, z: number) => WG.heightAt(world.surface, x, z);
  const things: Thing[] = [];
  const put = (k: string, x: number, z: number, r: number, v: unknown) => things.push({ k, x, z, r, s: JSON.stringify(v, (_, n) => (typeof n === 'number' ? r2(n) : n)) });
  // (what stands: every list of the world whose members stand somewhere, each with how far it reaches)
  for (const t of world.trees) put('tree', t.x, t.z, 2 * t.scale, t);
  for (const t of world.rocks) put('rock', t.x, t.z, 3 * t.scale, t);
  for (const t of world.props) put('prop', t.x, t.z, 2 * t.scale, t);
  for (const b of world.buildings) { const f = WG.BUILDING_FOOTPRINT[b.type] ?? [20, 20]; put('building', b.x, b.z, Math.hypot(f[0], f[1]) / 2, b); }
  for (const w of world.walls) put('wall', w.x, w.z, w.long / 2 + 1, w);
  for (const s of world.solids) { const o = s as unknown as { x: number; z: number }; put('solid', o.x, o.z, 15, s); }
  for (const p of world.posts ?? []) put('post', p.x, p.z, 12, p);
  for (const s of world.slabs ?? []) put('slab', (s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) / 2 + 1, s);
  // (a town by what of it stands: its pad is the ground's, its buildings and things are above; here its walkways' boards
  // and its walls, each where it is. As one thing reaching over the whole town, a part of a town laid since was a change
  // at every stash in the town, though nothing of it stood near.)
  for (const p of world.towns ?? []) {
    for (const k of T.placedKits(p)) for (const b of k.boxes) put('walk', b.c[0], b.c[2], Math.hypot(b.h[0], b.h[2]) + 1, b);
    for (const k of T.placedWalls(p)) put('town wall', k.at[0], k.at[2], 8, k);
  }
  if (world.kalat) put('kalat', world.kalat.x, world.kalat.z, 400, world.kalat);
  for (const q of world.pois) put('place', q.x, q.z, q.radius, q);
  for (const o of outcropPieces(world, WG.passPlan)) put('outcrop', o.at[0], o.at[2], 4 * o.scale, o);
  for (const o of rockPieces(WG.passPlan)) put('pass rock', o.at[0], o.at[2], 4 * o.scale, o);
  // (at each stash: the ground every metre out to R, and what reaches within R)
  const stashPrints = stashes.map((at) => {
    const ground: number[] = [];
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) if (dx * dx + dz * dz <= R * R) ground.push(r2(H(at.x + dx, at.z + dz)), r2(S(at.x + dx, at.z + dz)));
    return { at, ground, things: things.filter((t) => Math.hypot(t.x - at.x, t.z - at.z) <= R + t.r) };
  });
  // (and the whole map, coarsely: the ground every 4 m, and what stands in each 32 m square, so that what changed is named)
  const step = 4, x0 = WG.WORLD_X0, z0 = WG.WORLD_Z0, nx = Math.floor((WG.WORLD_X1 - x0) / step) + 1, nz = Math.floor((WG.WORLD_Z1 - z0) / step) + 1;
  const h: number[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h.push(r2(H(x0 + i * step, z0 + j * step)));
  const cells: Record<string, string> = {};
  for (const t of things) { const key = `${Math.floor(t.x / 32)},${Math.floor(t.z / 32)}`; cells[key] = (cells[key] ?? '') + t.k + t.s; }
  for (const key of Object.keys(cells)) cells[key] = createHash('sha1').update(cells[key]).digest('hex').slice(0, 12);
  // (and every thing, by a print of itself, where it stands and how far it reaches: what is in one world and not the other is what changed)
  const all = things.map((t): [string, number, number, number] => [createHash('sha1').update(t.k + t.s).digest('hex').slice(0, 12), Math.round(t.x), Math.round(t.z), Math.ceil(t.r)]);
  return { R, stashes: stashPrints, all, places: world.pois.map((q) => ({ name: q.name, x: q.x, z: q.z })), map: { step, nx, nz, x0, z0, h, cells } };
}

/** where the two worlds differ, clustered into named areas */
function changedAreas(a: Prints, b: Prints): string[] {
  const m = a.map, hits: [number, number][] = [];
  for (let j = 0; j < m.nz; j++) for (let i = 0; i < m.nx; i++) if (Math.abs(m.h[j * m.nx + i] - b.map.h[j * m.nx + i]) > 0.02) hits.push([m.x0 + i * m.step, m.z0 + j * m.step]);
  for (const key of new Set([...Object.keys(a.map.cells), ...Object.keys(b.map.cells)])) if (a.map.cells[key] !== b.map.cells[key]) { const [cx, cz] = key.split(',').map(Number); hits.push([cx * 32 + 16, cz * 32 + 16]); }
  const areas: { x0: number; z0: number; x1: number; z1: number; n: number }[] = [];
  for (const [x, z] of hits) {
    const a2 = areas.find((q) => x > q.x0 - 60 && x < q.x1 + 60 && z > q.z0 - 60 && z < q.z1 + 60);
    if (a2) { a2.x0 = Math.min(a2.x0, x); a2.x1 = Math.max(a2.x1, x); a2.z0 = Math.min(a2.z0, z); a2.z1 = Math.max(a2.z1, z); a2.n++; } else areas.push({ x0: x, z0: z, x1: x, z1: z, n: 1 });
  }
  return areas.map((q) => {
    const cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2, near = [...b.places].sort((p, o) => Math.hypot(p.x - cx, p.z - cz) - Math.hypot(o.x - cx, o.z - cz))[0];
    return `  x ${Math.round(q.x0)}..${Math.round(q.x1)}, z ${Math.round(q.z0)}..${Math.round(q.z1)} (${q.n} marks; nearest place ${near?.name}, ${near ? Math.round(Math.hypot(near.x - cx, near.z - cz)) : '?'} m)`;
  });
}

/**
 * Every 8 m square of the map where the ground moved or anything stands otherwise than in the base: what the server
 * reads at its start (server/stash-guard.ts) to say how many of the stashes it keeps lie within 15 m of a change.
 */
function changedCells(a: Prints, b: Prints, ref: string): { base: string; size: number; cells: [number, number][] } {
  const S = 8, set = new Set<string>(), mark = (x: number, z: number, r = 0) => { for (let i = Math.floor((x - r) / S); i <= Math.floor((x + r) / S); i++) for (let j = Math.floor((z - r) / S); j <= Math.floor((z + r) / S); j++) set.add(`${i},${j}`); };
  const m = a.map;
  for (let j = 0; j < m.nz; j++) for (let i = 0; i < m.nx; i++) if (Math.abs(m.h[j * m.nx + i] - b.map.h[j * m.nx + i]) > 0.02) mark(m.x0 + i * m.step, m.z0 + j * m.step, m.step / 2);
  const was = new Set(a.all.map((t) => t[0])), now = new Set(b.all.map((t) => t[0]));
  for (const [k, x, z, r] of a.all) if (!now.has(k)) mark(x, z, r);
  for (const [k, x, z, r] of b.all) if (!was.has(k)) mark(x, z, r);
  return { base: ref, size: S, cells: [...set].map((k) => k.split(',').map(Number) as [number, number]).sort((p, q) => p[0] - q[0] || p[1] - q[1]) };
}

async function main(): Promise<void> {
  if (args[0] === '--print') return void writeFileSync(args[1], JSON.stringify(await print(readStashes(args[2]))));
  const file = args[0];
  if (!file || (file !== '-' && !existsSync(file))) throw new Error('usage: npx tsx scripts/stash-guard.ts <stashes.json | -> [--base <ref>] [--r 15] [--cells server/changed-cells.json]');
  const ref = opt('--base', 'main');
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(), base = path.join(top, '.stash-base');
  const stashFile = file === '-' ? '-' : path.resolve(file), out = (n: string) => path.join(top, '.stash-base-' + n + '.json');
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  // (the base's code as it is in git, unpacked beside this tree's node_modules so that its imports are found)
  const tar = path.join(top, '.stash-base.tar');
  execFileSync('git', ['archive', '-o', tar, ref, 'src', 'server', 'package.json', 'tsconfig.json'], { cwd: top });
  // (relative paths: GNU tar takes a drive letter's colon for another machine)
  execFileSync('tar', ['-xf', '.stash-base.tar', '-C', '.stash-base'], { cwd: top });
  rmSync(tar, { force: true });
  mkdirSync(path.join(base, 'scripts'), { recursive: true });
  cpSync(path.join(top, 'scripts/stash-guard.ts'), path.join(base, 'scripts/stash-guard.ts'));
  const run = (dir: string, n: string) => execFileSync(process.execPath, ['--import', 'tsx', path.join(dir, 'scripts/stash-guard.ts'), '--print', out(n), stashFile, '--r', String(R)], { cwd: top, stdio: 'inherit' });
  try {
    run(base, 'old');
    run(top, 'new');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  const a = JSON.parse(readFileSync(out('old'), 'utf8')) as Prints, b = JSON.parse(readFileSync(out('new'), 'utf8')) as Prints;
  rmSync(out('old'), { force: true });
  rmSync(out('new'), { force: true });
  let bad = 0;
  for (let i = 0; i < a.stashes.length; i++) {
    const o = a.stashes[i], n = b.stashes[i], at = `${Math.round(o.at.x)}, ${Math.round(o.at.z)}`;
    const dy = Math.max(0, ...o.ground.map((v, k) => Math.abs(v - n.ground[k])));
    const was = new Set(o.things.map((t) => t.k + t.s)), now = new Set(n.things.map((t) => t.k + t.s));
    let gone = o.things.filter((t) => !now.has(t.k + t.s)), came = n.things.filter((t) => !was.has(t.k + t.s));
    // (a thing that stands where it stood but for its height, by no more than the ground's own 2 cm, as the ground
    // under it may: the same thing, not a change)
    const same = (p: Thing, q: Thing) => {
      if (p.k !== q.k) return false;
      const a = JSON.parse(p.s) as Record<string, unknown>, b = JSON.parse(q.s) as Record<string, unknown>;
      return Object.keys({ ...a, ...b }).every((key) => (key === 'y' && typeof a[key] === 'number' ? Math.abs((a[key] as number) - (b[key] as number)) <= 0.021 : JSON.stringify(a[key]) === JSON.stringify(b[key])));
    };
    const kept = gone.filter((g) => came.some((c) => same(g, c)));
    gone = gone.filter((g) => !kept.includes(g));
    came = came.filter((c) => !kept.some((g) => same(g, c)));
    // (2 cm, and no more than a rounding over: a road's bed lies 2 cm under the pad it crosses)
    if (dy <= 0.02 + 1e-6 && !gone.length && !came.length) continue;
    bad++;
    console.log(`STASH ${at}: ground moved up to ${dy.toFixed(2)} m; ${gone.length} things gone, ${came.length} new or moved within ${R} m`);
    const what = (t: Thing) => { const v = JSON.parse(t.s) as { id?: string; kind?: string; type?: string; name?: string }; return v.id ?? v.kind ?? v.name ?? ''; };
    for (const t of [...gone.map((q) => ['-', q] as const), ...came.map((q) => ['+', q] as const)].slice(0, 8)) console.log(`   ${t[0]} ${t[1].k} ${what(t[1])} at ${Math.round(t[1].x)}, ${Math.round(t[1].z)} (${Math.round(Math.hypot(t[1].x - o.at.x, t[1].z - o.at.z))} m)`);
  }
  console.log(`${a.stashes.length} stashes checked against ${ref} (${b.stashes.reduce((n, s) => n + s.things.length, 0)} things within reach of them): ${bad ? `${bad} TOUCHED` : 'every one untouched'} (ground within 2 cm out to ${R} m, nothing within ${R} m changed)`);
  const areas = changedAreas(a, b), cellsOut = opt('--cells', '');
  if (cellsOut) writeFileSync(cellsOut, JSON.stringify(changedCells(a, b, ref)) + '\n');
  console.log(areas.length ? `Changed against ${ref}:\n${areas.join('\n')}` : `Nothing on the map changed against ${ref}.`);
  process.exit(bad ? 1 : 0);
}

void main();
