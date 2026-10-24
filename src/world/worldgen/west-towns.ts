// THE WEST'S TOWNS (2026-10-16): the new towns set down where plan v5 has them, each on level ground of its own, as
// their own data says (src/sim/towns.ts: the reference is lay() in src/dev/towns.ts, at the town's real middle); and
// Kalat, the ruined town of src/sim/ruins.ts, set down whole in the desert on land shaped as it really stands
// (`ruinsGround`: its top, its banks and moat, the dry river's flats), as src/dev/ruins.ts lays it on its test patch.

import { Simplex, lerp, smoothstep } from '../../core/noise';
import { DESERT_TOWNS } from '../../sim/desert';
import { MOKROYE, WATER } from '../../sim/mokroye';
import { OZERKI, SHORE } from '../../sim/ozerki';
import { LAND, OUTLINE, outside as offTop, ruinLocal, ruinsGround, type Place } from '../../sim/ruins';
import { moundAt, placedSlabs, placedTowers, townBuildings, townTrees, townGround, townPoint, townThings, townWalks, type PlacedTown, type SlabRun, type Town } from '../../sim/towns';
import { BUILDING_FOOTPRINT, type BuildingPlot } from './layout';
import { CELL, SEA_LEVEL, WORLD_SEED } from './places';
import { PLACED, PLAN } from './west-plan';
import type { Net } from './west-relief';
import type { Instance } from './types';

export { PLACED };
export const placedTown = (name: string) => PLACED.find((t) => t.name === name)!;

/** the desert's towns lie west of this: what they set down stands on the ground as it is in the end (`fillTown`) */
export const DESERT_EAST = -2400;
/** the desert's own places (src/sim/desert.ts), whose pads are the last word on the ground under them (`padHeld`) */
const DESERT = PLACED.filter((t) => DESERT_TOWNS.some((d) => d.name === t.name));
export const desertTown = (t: Town) => DESERT.some((d) => d.name === t.name);
/**
 * How much of a spot is a desert place's own level ground: all of it on its pad, none `out` metres past its edge.
 * What is laid after the pads (Kalat's land about it, the roads' beds) leaves that much of a spot as it was. Kalat's
 * land, laid over Peski's east end and Blokpost's west, had tilted their pads by a metre: Peski's houses stood on
 * their foundations' bare concrete and its lamps in the air (the owner, 2026-10-19: "a lot of the poi's in the desert
 * are hovering off the ground").
 */
export function padHeld(x: number, z: number, out: number) {
  let held = 0;
  for (const t of DESERT) held = Math.max(held, 1 - smoothstep(0, out, offPad(t, x, z)));
  return held;
}

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

const h1 = new Simplex(WORLD_SEED + 351);
/**
 * How much of a spot is the swamp's hamlet's own ground (1) and how much the swamp's floor (0): its pad's edge let
 * wander 14 m in and out (seen from the sky its straight edge drew a rectangle in the swamp, the owner: "too ugly"),
 * eased into the floor over 16 m; the ground under its boardwalks always its own.
 */
export function hamletGround(t: Town, x: number, z: number) {
  const [lx, lz] = townLocal(t, x, z), edge = Math.max(Math.abs(lx) - t.pad[0], Math.abs(lz) - t.pad[1]) + 14 * h1.noise(x * 0.022, z * 0.022) + 4 * h1.noise(x * 0.09 + 3, z * 0.09);
  let walk = Infinity;
  for (const { a, b } of townWalks(t)) {
    const ex = b[0] - a[0], ez = b[1] - a[1], u = Math.max(0, Math.min(1, ((lx - a[0]) * ex + (lz - a[1]) * ez) / (ex * ex + ez * ez || 1)));
    walk = Math.min(walk, Math.hypot(lx - a[0] - ex * u, lz - a[1] - ez * u));
  }
  return Math.max(1 - smoothstep(-6, 10, edge), 1 - smoothstep(4, 10, walk));
}

/**
 * A town's pad levelled at its height, its knolls and terraces raised on it (`moundAt`), and eased into the land
 * about it over 40 m (the swamp's hamlet into the swamp's own floor, over an edge that wanders: `hamletGround`;
 * Ozerki's not over its lake, where the shore's shingle runs down from it into the water).
 */
export function layPad(H: Float32Array, net: Net, t: Town, padY: number, lake?: number) {
  const E = t.name === MOKROYE.name ? 30 : 40;
  overPad(net, t, E, (i, x, z, lx, lz, out) => {
    const mix = t.name === MOKROYE.name ? hamletGround(t, x, z) : 1 - smoothstep(0, E, out), y = padY + moundAt(t, lx, lz);
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
 * Its things and lamps stand on its pad, or on the ground `on` says where that is given, let down to the lowest of it
 * under the thing's foot (`footOn`): a desert town's all of them (the river's wadi cuts into the brick works' pad: its
 * quay's crates, and the lamps down its lane to the ford, stood up to 4 m in the air at the pad's height, the owner,
 * 2026-10-19: "some building decorations like at industrial are floating very high off the ground"); another's only
 * where what was laid after the pad moved the ground under it (`all` false: a road's bed had sunk a lamp at Zastava
 * 0.8 m and one at Lipki, and dug under Ozerki's covered car), what stands on a deck or a table over the pad as laid.
 */
export function fillTown(t: Town, padY: number, net: Net, out: { buildings: BuildingPlot[]; props: Instance[]; slabs: SlabRun[]; splat: Uint8Array; grass: Uint8Array; trees?: Instance[] }, on?: (x: number, z: number) => number, all = true) {
  const foot = on && footOn(on), under = (x: number, z: number, lx: number, lz: number) => {
    const laid = padY + moundAt(t, lx, lz);
    return foot && (all || Math.abs(on(x, z) - laid) > MOVED) ? foot(x, z) : laid;
  };
  townBuildings(t).forEach((s, n) => {
    const [x, z] = townPoint(t, s.x, s.z);
    out.buildings.push({ id: `${t.name.toLowerCase()}_${n}`, type: s.type, x, z, rot: t.rot + s.rot, floorY: padY + (s.up ?? moundAt(t, s.x, s.z) + 0.3), seed: 9100 + n * 37, ...(s.arms ? { arms: s.arms } : {}) });
    const [fw, fd] = BUILDING_FOOTPRINT[s.type], c = Math.cos(t.rot + s.rot), sn = Math.sin(t.rot + s.rot), reach = Math.hypot(fw, fd) / 2 + 2;
    for (let j = Math.floor((z - reach - net.z0) / CELL); j <= Math.ceil((z + reach - net.z0) / CELL); j++) for (let i = Math.floor((x - reach - net.x0) / CELL); i <= Math.ceil((x + reach - net.x0) / CELL); i++) {
      const dx = net.x0 + i * CELL - x, dz = net.z0 + j * CELL - z;
      if (i >= 0 && j >= 0 && i < net.nx && j < net.nz && Math.abs(dx * c - dz * sn) < fw / 2 + 1.5 && Math.abs(dx * sn + dz * c) < fd / 2 + 1.5) out.grass[j * net.nx + i] = 0;
    }
  });
  // (nor in Pokrov's corner towers, which are hollow: a blade grows within a metre of its square's middle, and the room is 4.4 m round, the tower 7.9)
  for (const w of placedTowers({ town: t, padY })) for (let j = Math.floor((w.z - 6 - net.z0) / CELL); j <= Math.ceil((w.z + 6 - net.z0) / CELL); j++) for (let i = Math.floor((w.x - 6 - net.x0) / CELL); i <= Math.ceil((w.x + 6 - net.x0) / CELL); i++) {
    if (i >= 0 && j >= 0 && i < net.nx && j < net.nz && Math.hypot(net.x0 + i * CELL - w.x, net.z0 + j * CELL - w.z) < 5.8) out.grass[j * net.nx + i] = 0;
  }
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
  // known by where it stands, to a tenth of a metre, and not by how high: two at one spot were one container.) The
  // upper stands on the lower, wherever that was set.
  const stood = new Set<string>(), base = new Map<string, number>();
  for (const th of townThings(t)) {
    let [x, z] = townPoint(t, th.x, th.z);
    const at = `${Math.round(x * 10)}_${Math.round(z * 10)}`;
    while (stood.has(`${Math.round(x * 10)}_${Math.round(z * 10)}`)) x += 0.11;
    stood.add(`${Math.round(x * 10)}_${Math.round(z * 10)}`);
    const y = base.get(at) ?? (th.up && !all ? padY + moundAt(t, th.x, th.z) : under(x, z, th.x, th.z));
    if (!base.has(at)) base.set(at, y);
    // (what grows in a garden is drawn only from near, a stack of logs from no farther than a street's length)
    const near = th.kind === 'pumpkin' || th.kind === 'cabbage' ? { far: 40 } : th.kind === 'log_pile' ? { far: 150 } : {};
    out.props.push({ kind: th.kind, x, y: y + (th.up ?? 0), z, rot: t.rot + th.rot, scale: 1, ...near });
  }
  for (const [kind, lx, lz, scale] of townTrees(t)) {
    const [x, z] = townPoint(t, lx, lz);
    out.trees?.push({ kind, x, y: under(x, z, lx, lz), z, rot: (lx * 7 + lz * 3) % 6.28, scale });
  }
  for (const l of townLamps(t)) {
    const [x, z] = townPoint(t, l.x, l.z);
    out.props.push({ kind: 'street_lamp_01', x, y: under(x, z, l.x, l.z), z, rot: t.rot + l.rot, scale: 1 });
  }
  out.slabs.push(...placedSlabs(t));
}

/** how far the ground under a thing may be off the pad as laid before it is taken to have been moved (`fillTown`) */
const MOVED = 0.05;
/** how far round its middle a thing on sloping ground reaches to the ground: a crate's or a drum's half width */
const FOOT = 0.6;
/**
 * The ground a crate, a drum or a lamp stands on: the lowest under its foot, as src/world/seat.ts seats a rock. Stood
 * at the ground under its middle, on the brick works' bank (28 in the hundred) its low edge was 14 cm in the air.
 */
export const footOn = (on: (x: number, z: number) => number) => (x: number, z: number) => {
  let y = on(x, z);
  for (let a = 0; a < 8; a++) y = Math.min(y, on(x + FOOT * Math.cos((a * Math.PI) / 4), z + FOOT * Math.sin((a * Math.PI) / 4)));
  return y;
};

/** how far apart a town's street lamps stand along a lane, and how far out from its edge */
const LAMP = { every: 22, out: 1.4, apart: 13 };

/**
 * Street lamps down a town's lanes, either side by turns (the owner, 2026-10-19: "i think we need to add some lights to
 * each of the towns, at night you cant really tell where to go especially as a fresh spawn"): the village's lamp, lit
 * from dusk and seen as a point of light from far off (src/game/game/drops.ts). Never in a building, by a thing, in the
 * water or off the pad. In the town's frame: where each stands, and its turn (its arm over the lane).
 */
export function townLamps(t: Town): { x: number; z: number; rot: number }[] {
  const ground = townGround(t), out: { x: number; z: number; rot: number }[] = [];
  // (a swamp's water is shallow, a lamp stands in it, as the drowned hamlet's houses do; a lake's is not, nor its
  // shingle running down into it: Ozerki's lake is the world's, north of its shore, and three lamps beside its piers
  // stood over the water at the bank's height)
  const homes = townBuildings(t), things = townThings(t), water = ground.water && !ground.water.swamp ? ground.water.outline : undefined;
  const bank = t.name === OZERKI.name ? SHORE + 2.5 : -Infinity;
  const wet = (x: number, z: number) => {
    if (z < bank) return true;
    if (!water) return false;
    let inside = false;
    for (let i = 0, j = water.length - 1; i < water.length; j = i++) {
      const [xi, zi] = water[i], [xj, zj] = water[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const clear = (x: number, z: number) =>
    Math.abs(x) < t.pad[0] - 1 && Math.abs(z) < t.pad[1] - 1 && !wet(x, z) &&
    !homes.some((s) => {
      const [w, d] = BUILDING_FOOTPRINT[s.type], c = Math.cos(s.rot), sn = Math.sin(s.rot), dx = x - s.x, dz = z - s.z;
      return Math.abs(dx * c - dz * sn) < w / 2 + 1.2 && Math.abs(dx * sn + dz * c) < d / 2 + 1.2;
    }) &&
    !things.some((th) => Math.hypot(th.x - x, th.z - z) < 2.5) && !out.some((o) => Math.hypot(o.x - x, o.z - z) < LAMP.apart);
  let side = 1;
  // (and beside the boardwalks, where those are the town's ways: the drowned hamlet has no lane)
  for (const { line, w } of [...ground.lanes.filter((l) => !l.dark), ...townWalks(t).map((r) => ({ line: [r.a, r.b], w: 2 }))]) {
    let walked = 0, next = LAMP.every / 3;
    for (let q = 0; q + 1 < line.length; q++) {
      const [ax, az] = line[q], [bx, bz] = line[q + 1], len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      for (; next <= walked + len; next += LAMP.every) {
        const k = next - walked, px = ax + ux * k, pz = az + uz * k;
        for (const s of [side, -side]) {
          // (out from the lane's edge on its side; turned so that its arm reaches back over the lane)
          const x = px - uz * s * (w / 2 + LAMP.out), z = pz + ux * s * (w / 2 + LAMP.out);
          if (!clear(x, z)) continue;
          out.push({ x, z, rot: Math.atan2(ux, uz) + (s > 0 ? -Math.PI / 2 : Math.PI / 2) });
          side = -s;
          break;
        }
      }
      walked += len;
    }
  }
  return out;
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
      // (but not over a desert place's pad, nor much of the 40 m its pad is eased over: see `padHeld`)
      H[i] = lerp(H[i], site.y + g.y, mix * (1 - padHeld(x, z, 40)));
      // (its flats, its moat and its dry river's bed are cracked earth)
      if (g.kind === 'flats' || g.kind === 'moat' || g.kind === 'river') wash[i] = Math.round(mix * 255);
    }
  // (and the edge of the cracked earth eased over some 8 m: a sample of the net either cracked or not drew its edge
  // as the net's own steps, square by square, "lots of visual glitches", 2026-10-23)
  const ix0 = Math.max(0, Math.floor((site.x - R - net.x0) / CELL)), ix1 = Math.min(net.nx - 1, Math.ceil((site.x + R - net.x0) / CELL));
  const iz0 = Math.max(0, Math.floor((site.z - R - net.z0) / CELL)), iz1 = Math.min(net.nz - 1, Math.ceil((site.z + R - net.z0) / CELL));
  for (let pass = 0; pass < 2; pass++) for (const along of [1, net.nx]) {
    const was = wash.slice();
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * net.nx + ix;
      if (!share[i]) continue;
      let s = 0, c = 0;
      for (let k = -2; k <= 2; k++) {
        const j = i + k * along, jx = along === 1 ? ix + k : ix, jz = along === 1 ? iz : iz + k;
        if (jx < ix0 || jx > ix1 || jz < iz0 || jz > iz1) continue;
        s += was[j];
        c++;
      }
      wash[i] = Math.round(s / c);
    }
  }
  return { share, wash };
}
