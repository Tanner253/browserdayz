// THE WEST'S TOWNS (2026-10-16): the new towns set down where plan v5 has them, each on level ground of its own, as
// their own data says (src/sim/towns.ts: the reference is lay() in src/dev/towns.ts, at the town's real middle); and
// Kalat, the ruined town of src/sim/ruins.ts, set down whole in the desert on land shaped as it really stands
// (`ruinsGround`: its top, its banks and moat, the dry river's flats), as src/dev/ruins.ts lays it on its test patch.

import { lerp, smoothstep } from '../../core/noise';
import { MOKROYE, WATER } from '../../sim/mokroye';
import { OZERKI, SHORE } from '../../sim/ozerki';
import { LAND, OUTLINE, outside as offTop, ruinLocal, ruinsGround, type Place } from '../../sim/ruins';
import { moundAt, placedSlabs, townBuildings, townGround, townPoint, townThings, type PlacedTown, type SlabRun, type Town } from '../../sim/towns';
import { BUILDING_FOOTPRINT, type BuildingPlot } from './layout';
import { CELL, SEA_LEVEL } from './places';
import { PLACED, PLAN } from './west-plan';
import type { Net } from './west-relief';
import type { Instance } from './types';

export { PLACED };
export const placedTown = (name: string) => PLACED.find((t) => t.name === name)!;

/** a point of the world in a town's frame */
export function townLocal(t: Town, x: number, z: number): [number, number] {
  const c = Math.cos(t.rot), s = Math.sin(t.rot), dx = x - t.x, dz = z - t.z;
  return [dx * c - dz * s, dx * s + dz * c];
}
/** how far outside a town's pad a spot is (0 on it), in its own frame */
export function offPad(t: Town, x: number, z: number) {
  const [lx, lz] = townLocal(t, x, z);
  return Math.max(Math.abs(lx) - t.pad[0], Math.abs(lz) - t.pad[1], 0);
}
/** every sample of a net within `reach` of a town's pad, in its frame */
function overPad(net: Net, t: Town, reach: number, f: (i: number, x: number, z: number, lx: number, lz: number, out: number) => void) {
  const R = Math.hypot(t.pad[0], t.pad[1]) + reach;
  for (let iz = Math.max(0, Math.floor((t.z - R - net.z0) / CELL)); iz <= Math.min(net.nz - 1, Math.ceil((t.z + R - net.z0) / CELL)); iz++)
    for (let ix = Math.max(0, Math.floor((t.x - R - net.x0) / CELL)); ix <= Math.min(net.nx - 1, Math.ceil((t.x + R - net.x0) / CELL)); ix++) {
      const x = net.x0 + ix * CELL, z = net.z0 + iz * CELL, [lx, lz] = townLocal(t, x, z), out = Math.max(Math.abs(lx) - t.pad[0], Math.abs(lz) - t.pad[1], 0);
      if (out <= reach) f(iz * net.nx + ix, x, z, lx, lz, out);
    }
}

/** the level a town's pad is laid at: the ground's middle height under it (Ozerki's on its land side only) */
export function padLevel(H: Float32Array, net: Net, t: Town) {
  const was: number[] = [];
  overPad(net, t, 0, (i, _x, _z, _lx, lz) => { if (t.name !== OZERKI.name || lz > SHORE + 2) was.push(H[i]); });
  was.sort((a, b) => a - b);
  return was[was.length >> 1];
}

/**
 * A town's pad levelled at its height, its knolls and terraces raised on it (`moundAt`), and eased into the land
 * about it over 40 m (the swamp's hamlet over 10, into the swamp's own floor; Ozerki's not over its lake, where the
 * shore's shingle runs down from it into the water).
 */
export function layPad(H: Float32Array, net: Net, t: Town, padY: number, lake?: number) {
  const E = t.name === MOKROYE.name ? 10 : 40;
  overPad(net, t, E, (i, _x, _z, lx, lz, out) => {
    const mix = 1 - smoothstep(0, E, out), y = padY + moundAt(t, lx, lz);
    if (t.name === OZERKI.name && lake !== undefined) {
      if (lz < SHORE - 3) return;
      if (lz < SHORE + 2.5) return void (H[i] = lerp(H[i], lerp(lake - 0.3, padY, smoothstep(SHORE - 3, SHORE + 2.5, lz)), mix));
    }
    H[i] = lerp(H[i], y, mix);
  });
}

/**
 * A town's buildings, things and slab walls added to the world's (after every older one: nothing is renumbered), its
 * yards gravelled, its lanes trodden and its beds dug, and no grass on them nor under its buildings (lay(), as it is).
 */
export function fillTown(t: Town, padY: number, net: Net, out: { buildings: BuildingPlot[]; props: Instance[]; slabs: SlabRun[]; splat: Uint8Array; grass: Uint8Array }) {
  townBuildings(t).forEach((s, n) => {
    const [x, z] = townPoint(t, s.x, s.z);
    out.buildings.push({ id: `${t.name.toLowerCase()}_${n}`, type: s.type, x, z, rot: t.rot + s.rot, floorY: padY + (s.up ?? moundAt(t, s.x, s.z) + 0.3), seed: 9100 + n * 37, ...(s.arms ? { arms: s.arms } : {}) });
    const [fw, fd] = BUILDING_FOOTPRINT[s.type], c = Math.cos(t.rot + s.rot), sn = Math.sin(t.rot + s.rot), reach = Math.hypot(fw, fd) / 2 + 2;
    for (let j = Math.floor((z - reach - net.z0) / CELL); j <= Math.ceil((z + reach - net.z0) / CELL); j++) for (let i = Math.floor((x - reach - net.x0) / CELL); i <= Math.ceil((x + reach - net.x0) / CELL); i++) {
      const dx = net.x0 + i * CELL - x, dz = net.z0 + j * CELL - z;
      if (i >= 0 && j >= 0 && i < net.nx && j < net.nz && Math.abs(dx * c - dz * sn) < fw / 2 + 1.5 && Math.abs(dx * sn + dz * c) < fd / 2 + 1.5) out.grass[j * net.nx + i] = 0;
    }
  });
  const ground = townGround(t);
  overPad(net, t, 30, (k, _x, _z, lx, lz) => {
    let off = 1e9;
    for (const [x0, z0, x1, z1] of [...ground.yards, ...(ground.beds ?? [])]) off = Math.min(off, Math.max(x0 - lx, lx - x1, z0 - lz, lz - z1));
    for (const { line, w } of ground.lanes) for (let q = 0; q + 1 < line.length; q++) {
      const [ax, az] = line[q], [bx, bz] = line[q + 1], ex = bx - ax, ez = bz - az, u = Math.max(0, Math.min(1, ((lx - ax) * ex + (lz - az) * ez) / (ex * ex + ez * ez)));
      off = Math.min(off, Math.hypot(lx - ax - ex * u, lz - az - ez * u) - w / 2);
    }
    // (the edge ragged over a metre and a half)
    const wob = Math.sin(lx * 0.7 + lz * 0.3) * 0.5 + Math.sin(lz * 1.3 - lx * 0.4) * 0.4, bare = 1 - Math.min(1, Math.max(0, (off + wob + 0.5) / 1.6));
    if (bare <= 0) return;
    // (a garden's bed is dug earth, the forest floor's paint; the rest gravel)
    const dug = (ground.beds ?? []).some(([x0, z0, x1, z1]) => lx > x0 && lx < x1 && lz > z0 && lz < z1), to = dug ? 1 : 3, sp = out.splat;
    for (let ch = 0; ch < 4; ch++) sp[k * 4 + ch] = Math.round(sp[k * 4 + ch] * (1 - bare) + (ch === to ? 255 * bare : 0));
    out.grass[k] = Math.round(out.grass[k] * (1 - bare));
  });
  // (Two things stood one on the other, as crates are: the upper set a hand's breadth askew. What is searched is
  // known by where it stands, to a tenth of a metre, and not by how high: two at one spot were one container.)
  const stood = new Set<string>();
  for (const th of townThings(t)) {
    let [x, z] = townPoint(t, th.x, th.z);
    while (stood.has(`${Math.round(x * 10)}_${Math.round(z * 10)}`)) x += 0.11;
    stood.add(`${Math.round(x * 10)}_${Math.round(z * 10)}`);
    // (what grows in a garden is drawn only from near, a stack of logs from no farther than a street's length)
    const near = th.kind === 'pumpkin' || th.kind === 'cabbage' ? { far: 40 } : th.kind === 'log_pile' ? { far: 150 } : {};
    out.props.push({ kind: th.kind, x, y: padY + moundAt(t, th.x, th.z) + (th.up ?? 0), z, rot: t.rot + th.rot, scale: 1, ...near });
  }
  out.slabs.push(...placedSlabs(t));
}

/** a town as the world keeps it */
export const placed = (t: Town, padY: number): PlacedTown => ({ town: t, padY });

/** the swamp's hamlet's pad: under its water by as much as its own data says */
export const swampPad = (level: number) => level - WATER;

// ------------------------------------------------------------------ Kalat

/** where Kalat stands: its frame, and its top's height (the land round it rises to it, a tell in the desert) */
export function kalatSite(H: Float32Array, net: Net): Place {
  const K = PLAN.kalat;
  // (the desert's height about it, a little way out from its top, all round)
  let sum = 0, c = 0;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
    const x = K.x + Math.cos(a) * 260, z = K.z + Math.sin(a) * 200;
    sum += H[Math.round((z - net.z0) / CELL) * net.nx + Math.round((x - net.x0) / CELL)];
    c++;
  }
  // (and its dry river's bed, the lowest of it, no lower than a little over the sea: there is sea water under the desert's edge)
  const y = Math.max(sum / c - LAND.plain, SEA_LEVEL + 0.6 - LAND.flats + LAND.bed);
  return { x: K.x, z: K.z, rot: K.rot, y: Math.round(y * 10) / 10 };
}
/** how much of a spot is Kalat's own land (1 within its banks and the flats, easing out into the desert) */
export function kalatShare(site: Place, x: number, z: number) {
  const [lx, lz] = ruinLocal(site, x, 0, z), K = PLAN.kalat;
  return 1 - smoothstep(K.blend[0], K.blend[1], offTop(lx, lz, OUTLINE));
}
/**
 * Kalat's land laid on the net: as it really stands, eased out into the desert about it. Gives back how much of each
 * sample of the net is its land (0 to 255), for whatever is asked of it after (paint, what grows), and how much is
 * its cracked earth.
 */
export function layKalat(H: Float32Array, net: Net, site: Place): { share: Uint8Array; wash: Uint8Array } {
  const share = new Uint8Array(net.nx * net.nz), wash = new Uint8Array(net.nx * net.nz), K = PLAN.kalat;
  // (only over the box its land can reach, in its own frame)
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of OUTLINE) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const R = K.reach;
  for (let iz = Math.max(0, Math.floor((site.z - R - net.z0) / CELL)); iz <= Math.min(net.nz - 1, Math.ceil((site.z + R - net.z0) / CELL)); iz++)
    for (let ix = Math.max(0, Math.floor((site.x - R - net.x0) / CELL)); ix <= Math.min(net.nx - 1, Math.ceil((site.x + R - net.x0) / CELL)); ix++) {
      const x = net.x0 + ix * CELL, z = net.z0 + iz * CELL, [lx, lz] = ruinLocal(site, x, 0, z);
      if (lx < x0 - K.blend[1] || lx > x1 + K.blend[1] || lz < z0 - K.blend[1] || lz > z1 + K.blend[1]) continue;
      const mix = 1 - smoothstep(K.blend[0], K.blend[1], offTop(lx, lz, OUTLINE));
      if (mix <= 0) continue;
      const i = iz * net.nx + ix;
      share[i] = Math.round(mix * 255);
      const g = ruinsGround(lx, lz);
      H[i] = lerp(H[i], site.y + g.y, mix);
      // (its flats, its moat and its dry river's bed are cracked earth)
      if (g.kind === 'flats' || g.kind === 'moat' || g.kind === 'river') wash[i] = Math.round(mix * 255);
    }
  return { share, wash };
}
