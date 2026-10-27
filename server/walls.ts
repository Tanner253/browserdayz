// The map's own walls, floors and rocks on the server (the owner, 2026-10-27: "people complain being shot through
// walls"; "can we try to get in the walls on server i think it will be cheapest and fast and most effective. player
// structures count too"). The server built the map's places but none of its solids: every wall was the game's alone,
// and a hit through one was believed. The game's own solids, written out by scripts/solid-bake.mjs, are read into the
// same physics the game uses, and a round's line is traced through them. Player bases are server/solid.ts.
// docs/ANTI-CHEAT.md is the whole plan.
import RAPIER from '@dimforge/rapier3d-compat';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Vec3 } from '../src/sim/grenades';

/** what a piece of wall is to a line traced through it: a round stops at one, a look at the other */
const ROUND = 1, SIGHT = 2;
/** a piece's flags as the bake writes them: thin (a curtain, a door of boards: a round goes through), a bush */
const THIN = 1, BUSH = 2;

/** whether the walls are in, and what they came to (said once at start, and on /healthz if wanted) */
export const WALLS = { on: false, pieces: 0, tris: 0, ms: 0, mb: 0, why: 'not read yet' };

let world: RAPIER.World | null = null;

/** The walls in a file's bytes, if its print is `print` (the map this server made). @returns why not, or '' */
export async function readWalls(raw: Buffer, print: string | null): Promise<string> {
  const t0 = Date.now(), rss0 = process.memoryUsage().rss;
  if (raw.toString('latin1', 0, 4) !== 'ZSOL' || raw.readUInt32LE(4) !== 1) return 'not a walls file';
  const hl = raw.readUInt32LE(8), head = JSON.parse(raw.toString('utf8', 12, 12 + hl)) as { print: string };
  if (print !== null && head.print !== print) return `baked from another map (${head.print}, this one is ${print}): run node scripts/solid-bake.mjs`;
  await RAPIER.init();
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  // (a Buffer's bytes may sit anywhere in its pool: copied out, so that floats are read where they lie)
  const buf = new Uint8Array(raw).buffer, dv = new DataView(buf);
  let o = 12 + ((hl + 3) & ~3), tris = 0;
  const shapes: { kind: number; v: Float32Array; ix: Uint32Array | null }[] = [];
  for (let n = dv.getUint32(o, true), i = (o += 4, 0); i < n; i++) {
    const kind = dv.getUint32(o, true), nv = dv.getUint32(o + 4, true), ni = dv.getUint32(o + 8, true);
    o += 12;
    const v = new Float32Array(buf.slice(o, o + nv * 12));
    o += nv * 12;
    const ix = ni ? new Uint32Array(buf.slice(o, o + ni * 4)) : null;
    o += ni * 4;
    shapes.push({ kind, v, ix });
  }
  let pieces = 0;
  for (let n = dv.getUint32(o, true), i = (o += 4, 0); i < n; i++, o += 44) {
    const kind = dv.getUint8(o), flags = dv.getUint8(o + 1), f = (k: number) => dv.getFloat32(o + 4 + k * 4, true);
    let desc: RAPIER.ColliderDesc | null;
    if (kind === 4 || kind === 5) {
      const s = shapes[dv.getUint32(o + 32, true)];
      desc = kind === 5 ? RAPIER.ColliderDesc.convexHull(s.v) : s.ix?.length ? RAPIER.ColliderDesc.trimesh(s.v, s.ix) : null;
      if (kind === 4) tris += s.ix?.length ? s.ix.length / 3 : 0;
    } else {
      const [a, b, c] = [f(7), f(8), f(9)];
      desc = kind === 0 ? RAPIER.ColliderDesc.cuboid(a, b, c) : kind === 1 ? RAPIER.ColliderDesc.ball(a) : kind === 2 ? RAPIER.ColliderDesc.capsule(a, b) : kind === 3 ? RAPIER.ColliderDesc.cylinder(a, b) : kind === 6 ? RAPIER.ColliderDesc.cone(a, b) : null;
    }
    if (!desc) continue;
    // (a thin thing or a bush hides somebody but lets a round through)
    const member = flags & (THIN | BUSH) ? SIGHT : ROUND | SIGHT;
    desc.setTranslation(f(0), f(1), f(2)).setRotation({ x: f(3), y: f(4), z: f(5), w: f(6) }).setCollisionGroups((member << 16) | 0xffff);
    w.createCollider(desc);
    pieces++;
  }
  // (the scene's queries are made ready by a step: nothing here moves, so it is the only one)
  w.step();
  world?.free();
  world = w;
  Object.assign(WALLS, { on: true, pieces, tris, ms: Date.now() - t0, mb: Math.round((process.memoryUsage().rss - rss0) / 1e6), why: '' });
  return '';
}

/** The walls from server/solids.bin.gz, for the map whose print is `print`; without them every line is clear. */
export async function loadWalls(file: string, print: string, log: (s: string) => void) {
  // (WALLS=off: a test of something else, whose players stand where the map has a wall between them)
  if (process.env.WALLS === 'off') return void log('[walls] none: WALLS=off');
  try {
    const why = fs.existsSync(file) ? await readWalls(gunzipSync(fs.readFileSync(file)), print) : 'no walls file';
    if (why) WALLS.why = why;
    log(WALLS.on ? `[walls] ${WALLS.pieces} pieces of the map's walls (${WALLS.tris} triangles) read in ${WALLS.ms} ms, ${WALLS.mb} MB` : `[walls] none: ${why}. A round is stopped only by the ground and by bases`);
  } catch (e) {
    WALLS.why = e instanceof Error ? e.message : String(e);
    log(`[walls] none, they could not be read: ${WALLS.why}`);
  }
}

/** whether nothing of the map's that stops a round stands on the line from `a` to `b` (a hand short of `b`) */
export function roundClear(a: Vec3, b: Vec3): boolean {
  return clear(a, b, ROUND);
}

/** whether nothing of the map's that hides a body stands on the line from `a` to `b` (for the line of sight to come) */
export function sightClear(a: Vec3, b: Vec3): boolean {
  return clear(a, b, SIGHT);
}

function clear(a: Vec3, b: Vec3, group: number): boolean {
  if (!world) return true;
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz);
  if (l < 0.2) return true;
  const ray = new RAPIER.Ray({ x: a[0], y: a[1], z: a[2] }, { x: dx / l, y: dy / l, z: dz / l });
  return world.castRay(ray, l - 0.1, true, undefined, (0xffff << 16) | group) === null;
}
