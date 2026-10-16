// npx tsx scripts/split/fingerprint.ts [save.json]: THE WORLD'S FINGERPRINT, for the split of the giant files (2026-10-14).
// The owner's rule for the split is "no change of behaviour", and the world is where a slip would hide: a constant
// moved out of order, a helper that read a module-level value before it was set. So this hashes everything the world
// and the fort are made of, field by field: `generateWorld()` whole, the ground as it is drawn, the server's own world
// (loot places, crates, cars, homes of the infected), the fort's plan and its whole shape as the game makes it, every
// constant the three world files export, and the fort's point questions asked over a grid. Run it before a split and
// after: with a file given, it writes the prints there; given one that exists, it compares and names what differs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as WG from '../../src/world/worldgen';
import * as C from '../../src/sim/castle';
import * as CS from '../../src/world/castle-shape';
import { buildWorldData } from '../../server/world';

/** Every value as bytes, in one fixed order: numbers as float64 (so -0 and NaN are told apart), keys sorted, typed arrays as their bytes. */
function feed(h: ReturnType<typeof createHash>, v: unknown, seen = new Set<unknown>()): void {
  if (v === null) return void h.update('n');
  switch (typeof v) {
    case 'undefined': return void h.update('u');
    case 'boolean': return void h.update(v ? 'T' : 'F');
    case 'number': { const b = Buffer.alloc(8); b.writeDoubleLE(v); h.update('#'); return void h.update(b); }
    case 'bigint': return void h.update('b' + v.toString());
    case 'string': return void h.update('s' + v.length + ':' + v);
    case 'function': return void h.update('f' + v.name);
    case 'symbol': return void h.update('y' + String(v));
  }
  if (seen.has(v)) return void h.update('@');
  seen.add(v);
  if (ArrayBuffer.isView(v)) { h.update('A' + v.constructor.name + v.byteLength + ':'); h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); }
  else if (Array.isArray(v)) { h.update('[' + v.length); for (const x of v) feed(h, x, seen); h.update(']'); }
  else if (v instanceof Map) { h.update('M' + v.size); for (const [k, x] of v) { feed(h, k, seen); feed(h, x, seen); } }
  else if (v instanceof Set) { h.update('S' + v.size); for (const x of v) feed(h, x, seen); }
  else {
    const o = v as Record<string, unknown>, keys = Object.keys(o).sort();
    h.update('{' + (v as object).constructor?.name + keys.length);
    for (const k of keys) { h.update(k); feed(h, o[k], seen); }
    h.update('}');
  }
  seen.delete(v);
}
const hash = (v: unknown) => { const h = createHash('sha256'); feed(h, v); return h.digest('hex').slice(0, 16); };

const prints: Record<string, string> = {};
const put = (name: string, v: unknown) => { prints[name] = hash(v); };
const run = <T>(f: () => T): T => {
  const g = f() as unknown;
  if (g && typeof (g as Generator).next === 'function') { let r = (g as Generator).next(); while (!r.done) r = (g as Generator).next(); return r.value as T; }
  return g as T;
};

// THE OLD SQUARE ONLY, with FP_SQUARE=1 (2026-10-16): the world grew from a 1536 m square into a rectangle with two
// squares west of it, and the square was to come out as it was. So what is laid on the ground's net is printed as
// the square's 769 by 769 samples, cut out of a bigger net wherever they stand in it, and what stands somewhere is
// printed for the square only: the same prints from a tree before the rectangle and after it. Without it (for a
// change meant to change nothing) the whole world is printed.
const SQ = 769, SQ_HALF = 768;
const net = WG as unknown as { WORLD_X0?: number; WORLD_Z0?: number; WORLD_NX?: number };
function square<T extends Float32Array | Uint8Array>(a: T): T {
  const per = a.length % (SQ * SQ) === 0 && a.length / (SQ * SQ) <= 4 ? a.length / (SQ * SQ) : 0;
  if (per) return a;
  const nx = net.WORLD_NX!, k = a.length / (nx * SQ), ox = (-SQ_HALF - net.WORLD_X0!) / 2, oz = (-SQ_HALF - net.WORLD_Z0!) / 2;
  const out = new (a.constructor as new (n: number) => T)(SQ * SQ * k);
  for (let iz = 0; iz < SQ; iz++) out.set(a.subarray(((iz + oz) * nx + ox) * k, ((iz + oz) * nx + ox + SQ) * k), iz * SQ * k);
  return out;
}
const inSquare = (v: unknown) => {
  const p = v as { x?: unknown; z?: unknown };
  return !(p && typeof p.x === 'number' && typeof p.z === 'number') || (Math.abs(p.x) <= SQ_HALF && Math.abs(p.z) <= SQ_HALF);
};
const SQUARE_ONLY = !!process.env.FP_SQUARE;
const ofSquare = (v: unknown): unknown =>
  !SQUARE_ONLY ? v : v instanceof Float32Array || v instanceof Uint8Array ? (v.length >= SQ * SQ ? square(v) : v) : Array.isArray(v) ? v.filter(inSquare) : v;

// 1. the world, field by field
const world = WG.generateWorld();
for (const k of Object.keys(world).sort()) put('world.' + k, ofSquare((world as unknown as Record<string, unknown>)[k]));
const seen = WG.seenGround(world);
put('world.seenGround', SQUARE_ONLY ? { heights: square(seen.heights), open: seen.open && square(seen.open) } : seen);

// 2. every constant the three world files export (a function is told by its name only; those are asked below)
for (const [tag, M] of [['worldgen', WG], ['castle', C], ['castle-shape', CS]] as const) {
  for (const k of Object.keys(M).sort()) {
    const v = (M as Record<string, unknown>)[k];
    if (typeof v !== 'function') put(`${tag}.${k}`, v);
  }
}

// 3. the server's world, as the server makes it at boot
put('server.buildWorldData', buildWorldData(process.cwd()));

// 4. the fort, its plan and its shape: on its own and where the world stands it, as the game makes it
const P = world.castle!;
const ground: C.GroundAt = (x, z) => WG.heightAt(world.surface, x, z);
put('castle.parts', C.castleParts());
put('castle.kit', C.castleKit());
put('castle.door', C.castleDoor());
put('castle.rocks', C.castleRocks());
put('castle.loose', C.castleLoose(P));
put('castle.looseLocal', C.looseLocal(P, C.castleLoose(P)));
put('castle.looseParts', C.LOOSE.map((l) => C.looseParts(l)));
put('castle.loot', C.castleLoot(P));
put('castle.loot.ground', C.castleLoot(P, ground));
put('castle.props', C.castleProps(P));
put('castle.props.ground', C.castleProps(P, ground));
put('castle.lamps', C.castleLamps(P, ground));
put('castle.homes', C.castleHomes(P));
put('castle.cuts', C.castleCuts(P, ground));
put('castle.open', C.castleOpen(P));
put('castle.jeep', C.castleJeep(P, ground));
put('castle.hatchWells', C.LOOSE.filter((l) => l.kind === 'hatch').map((l) => [C.hatchLine(l, C.castleGround(l.x, l.z)), C.hatchWells(l, C.castleGround(l.x, l.z))]));
put('shape.alone', run(() => CS.castleShape()));
put('shape.bare', run(() => CS.castleShape(C.castleGround, [], false)));
put('shape.inWorld', run(() => CS.castleShapeIn(P, ground)));
put('shape.inWorld.noGround', run(() => CS.castleShapeIn(P)));

// 5. the fort's point questions over a grid round it (2 m apart, at three heights)
const grid: unknown[] = [];
for (let dx = -60; dx <= 60; dx += 2) for (let dz = -60; dz <= 60; dz += 2) {
  const x = P.x + dx, z = P.z + dz, g = WG.heightAt(world.heights, x, z);
  for (const y of [g - 3, g + 0.5, g + 4]) grid.push([C.inCastle(P, x, y, z), C.castleUnder(P, x, y, z, ground), C.castleDark(P, x, y, z, ground), C.castleHides(P, x, y, z)]);
  grid.push(C.castleFoot(P, x, z), C.castleClear(C.castleLoose(P), dx, dz), C.castleGround(dx / 2, dz / 2), C.moundTop('outcrop', dx / 3, dz / 3));
}
put('castle.grid', grid);

// 6. the ground's own questions over the whole map (8 m apart)
// (the slope on the square's west edge looks over it, at whatever ground lies there: printed apart)
const ground2: number[] = [], westSlope: number[] = [];
for (let x = -SQ_HALF; x <= SQ_HALF; x += 8) for (let z = -SQ_HALF; z <= SQ_HALF; z += 8) {
  const slope = WG.slopeAt(world.heights, x, z);
  if (x === -SQ_HALF) westSlope.push(slope);
  ground2.push(WG.heightAt(world.heights, x, z), x === -SQ_HALF ? 0 : slope, WG.inPlay(x, z) ? 1 : 0);
}
put('worldgen.points', ground2);
put('worldgen.points.westSlope', westSlope);

const file = process.argv[2];
const names = Object.keys(prints);
console.log(`${names.length} prints; all: ${hash(prints)}`);
if (!file) process.exit(0);
if (!existsSync(file)) { writeFileSync(file, JSON.stringify(prints, null, 1)); console.log('written to ' + file); process.exit(0); }
const was = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
// (a print that is new is told and is no difference: a constant or a field added; the old square's own are all still printed)
for (const k of names.filter((k) => !(k in was))) console.log(`NEW: ${k}`);
// (WORLD_SIZE and WORLD_RES were the square's, and went with it into the rectangle's bounds, 2026-10-16)
const GONE = new Set(['worldgen.WORLD_SIZE', 'worldgen.WORLD_RES']);
const differ = Object.keys(was).filter((k) => was[k] !== prints[k] && !(GONE.has(k) && !(k in prints)));
for (const k of differ) console.log(`DIFFERS: ${k} (${was[k] ?? 'absent'} -> ${prints[k] ?? 'absent'})`);
console.log(differ.length ? `WORLD CHANGED: ${differ.length} of ${names.length}` : `SAME: all ${names.length} prints match ${file}`);
process.exit(differ.length ? 1 : 0);
