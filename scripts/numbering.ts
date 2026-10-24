// npx tsx scripts/numbering.ts [--base <git ref>] [--keep]: THE MAP'S NUMBERS, KEPT. What a restart gives back it gives back by
// number: a thing on the ground to its place for things by that place's number (Economy.restore), a door its open or
// shut by the door's. A release that adds to the map must add after the end, never between: this makes the map of the
// base (default `main`, what is live) and of this tree, as the server and the game plan it, and says whether every
// building, place for a thing and door of the base keeps its number here (a place may move with its house; what it is
// and whose it is may not). Exit 1 if one does not.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);

interface Print { buildings: string[]; loot: [string, number, number][]; doors: string[]; props: string[] }

/** this tree's map as the game plans it (main.ts): its buildings, its places in their order, its doors, its things */
async function print(root: string): Promise<Print> {
  const { assets } = await import('../src/core/assets');
  const manifest = [path.join(root, 'dist/assets/manifest.json'), path.join(root, 'public/assets/manifest.json')].filter((p) => existsSync(p)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  (assets as { manifest: unknown }).manifest = JSON.parse(readFileSync(manifest, 'utf8'));
  const { generateWorld, heightAt } = await import('../src/world/worldgen');
  const { Buildings } = await import('../src/world/buildings');
  const { ruinLoot, ruinsPlan } = await import('../src/sim/ruins');
  const { caveLootPoints } = await import('../src/world/caves-carved');
  const world = generateWorld(), b = new Buildings(world, null as never);
  b.plan();
  if (world.kalat) for (const { piece, place } of ruinsPlan(world.kalat)) b.lootPoints.push(...ruinLoot(piece, place, (x, z) => heightAt(world.heights, x, z)));
  b.lootPoints.push(...caveLootPoints());
  b.lootPoints.push(...((b as { laterLoot?: typeof b.lootPoints }).laterLoot ?? []));
  return {
    buildings: world.buildings.map((q) => q.id),
    loot: b.lootPoints.map((p) => [p.building, Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]),
    doors: b.doorSpecs.map((d) => d.id),
    props: world.props.map((p) => p.kind),
  };
}

/** how many of the base's come first here in the same order, and the first that does not */
function kept<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): { n: number; first: number } {
  for (let i = 0; i < a.length; i++) if (i >= b.length || !same(a[i], b[i])) return { n: i, first: i };
  return { n: a.length, first: -1 };
}

async function main(): Promise<void> {
  if (args[0] === '--print') return void writeFileSync(args[1], JSON.stringify(await print(process.cwd())));
  const ref = opt('--base', 'main');
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(), base = path.join(top, '.stash-base-num');
  const out = (n: string) => path.join(top, `.stash-base-num-${n}.json`);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  // (the base's code as it is in git, unpacked beside this tree's node_modules, as scripts/stash-guard.ts does)
  execFileSync('git', ['archive', '-o', '.stash-base-num.tar', ref, 'src', 'server', 'package.json', 'tsconfig.json'], { cwd: top });
  execFileSync('tar', ['-xf', '.stash-base-num.tar', '-C', '.stash-base-num'], { cwd: top });
  rmSync(path.join(top, '.stash-base-num.tar'), { force: true });
  mkdirSync(path.join(base, 'scripts'), { recursive: true });
  cpSync(path.join(top, 'scripts/numbering.ts'), path.join(base, 'scripts/numbering.ts'));
  mkdirSync(path.join(base, 'public/assets'), { recursive: true });
  cpSync(path.join(top, 'public/assets/manifest.json'), path.join(base, 'public/assets/manifest.json'));
  const run = (dir: string, n: string) => execFileSync(process.execPath, ['--import', 'tsx', path.join(dir, 'scripts/numbering.ts'), '--print', out(n)], { cwd: dir, stdio: 'inherit' });
  try {
    run(base, 'old');
    run(top, 'new');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  const a = JSON.parse(readFileSync(out('old'), 'utf8')) as Print, b = JSON.parse(readFileSync(out('new'), 'utf8')) as Print;
  if (!args.includes('--keep')) rmSync(out('old'), { force: true });
  if (!args.includes('--keep')) rmSync(out('new'), { force: true });
  let bad = 0;
  const say = (what: string, k: { n: number; first: number }, of: number, now: number, at: (i: number) => string) => {
    if (k.first >= 0) bad++;
    console.log(`${k.first < 0 ? 'ok  ' : 'BAD '} ${what}: ${k.n} of the base's ${of} keep their numbers (${now} here)${k.first >= 0 ? `; the first that does not is #${k.first}: ${at(k.first)}` : ''}`);
  };
  say('buildings', kept(a.buildings, b.buildings, (x, y) => x === y), a.buildings.length, b.buildings.length, (i) => `${a.buildings[i]} is now ${b.buildings[i]}`);
  say('places for things', kept(a.loot, b.loot, (x, y) => x[0] === y[0]), a.loot.length, b.loot.length, (i) => `${a.loot[i].join(' ')} is now ${b.loot[i]?.join(' ')}`);
  say('doors', kept(a.doors, b.doors, (x, y) => x === y), a.doors.length, b.doors.length, (i) => `${a.doors[i]} is now ${b.doors[i]}`);
  // (places that moved, with their houses or by being slid off a way out: said, not wrong)
  const moved = a.loot.filter((p, i) => b.loot[i] && Math.hypot(p[1] - b.loot[i][1], p[2] - b.loot[i][2]) > 0.2);
  console.log(`     ${moved.length} of the base's places moved more than 20 cm (${[...new Set(moved.map((p) => p[0].replace(/_\d+$/, '')))].slice(0, 12).join(', ')})`);
  const things = kept(a.props, b.props, (x, y) => x === y);
  console.log(`     things: ${things.n} of the base's ${a.props.length} come first here in the same order (${b.props.length} here)${things.first >= 0 ? `, from #${things.first} (${a.props[things.first]} is now ${b.props[things.first]})` : ''}`);
  process.exit(bad ? 1 : 0);
}
void main();
