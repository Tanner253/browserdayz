// Checks of the signals post on the fort (src/sim/castle-post.ts, src/world/castle-post-shape.ts): that nothing of
// it stands in a way, at a door, at the foot of a stair or on a firing step; that what lies in it lies ON something;
// that snow is only where the fort says the sky is; and what it costs. Nothing drawn, nothing run.
// `npx tsx test/castle-post.test.ts`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KIT_LEVELS } from '../src/sim/kit';
import { CASTLE, CASTLE_SCALE, FURNITURE, UNDER, castleAt, castleLamps, castleLocal, castleLoose, castleLoot, castleParts, castleProps, inCastle, stairShare, type Flight, type Place, type Tower, type V3 } from '../src/sim/castle';
import { POST, postBeacon, postLamps, postLights, postLoot, postMade, postModels, postProps, postRooms, postSolids, type Room } from '../src/sim/castle-post';
import { castleShape, castleSky, type Solid } from '../src/world/castle-shape';
import { postCounts, postShape, type Skin } from '../src/world/castle-post-shape';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const P: Place = { x: 310, y: 240, z: -415, rot: 0.7 }, O: Place = { x: 0, y: 0, z: 0, rot: 0 };
/** the fort is built so much bigger than its own measure; what is a body's is not, and in the fort's own measure is so much smaller */
const S = CASTLE_SCALE;
/** a place in the world of a fort that stands at nothing and is not turned, in the fort's own measure */
const own = <Q extends { x: number; y: number; z: number }>(q: Q): Q => ({ ...q, x: q.x / S, y: q.y / S, z: q.z / S });
const C = CASTLE, K = C.keep, R = K.room, T = C.tower, [, F1, F2] = K.floors, B = K.band;
const models = JSON.parse(fs.readFileSync(new URL('../public/assets/manifest.json', import.meta.url), 'utf8')).models as Record<string, { min: number[]; max: number[]; tris: number }>;
const parts = castleParts(), towers = parts.filter((p): p is Tower => p.t === 'tower'), flights = parts.filter((p): p is Flight => p.t === 'flight' && !p.low);
const fort = castleShape().solids.filter((s): s is Extract<Solid, { t: 'box' }> => s.t === 'box');

/** a block on the plan: its middle, half its size, how it is turned, from how high to how high, and what it is */
interface Block { x: number; z: number; hx: number; hz: number; yaw: number; y0: number; y1: number; name: string; room?: Room; mine: boolean }
const stoodBlock = (q: { kind: string; x: number; y: number; z: number; rot: number }, name: string, mine: boolean, room?: Room): Block => {
  // (a thing off the shelf is the size its model is, in metres of the world: in the fort's own measure, which is a fifth smaller, it is `/ S` of that)
  const e = models[q.kind.split(/[#@]/)[0]], c = Math.cos(q.rot), s = Math.sin(q.rot), mx = (e.max[0] + e.min[0]) / 2 / S, mz = (e.max[2] + e.min[2]) / 2 / S;
  return { x: q.x + mx * c + mz * s, z: q.z - mx * s + mz * c, hx: (e.max[0] - e.min[0]) / 2 / S, hz: (e.max[2] - e.min[2]) / 2 / S, yaw: q.rot, y0: q.y + e.min[1] / S, y1: q.y + e.max[1] / S, name, mine, room };
};
/** everything of the post that takes up room, in the fort's own measure: what is off the shelf (as big as its model) and what is made and stops a body */
const mine: Block[] = [
  ...postRooms().filter((q) => !q.sits).map((q) => stoodBlock(q, q.kind, true, q.room)),
  // (and the models it stands and draws itself, the tents: as big as each model is at the size it is stood)
  ...postModels().map((m): Block => {
    const e = models[m.model], k = m.scale / S, c = Math.cos(m.yaw), s = Math.sin(m.yaw), mx = ((e.max[0] + e.min[0]) / 2) * k, mz = ((e.max[2] + e.min[2]) / 2) * k;
    return { x: m.at[0] + mx * c + mz * s, z: m.at[2] - mx * s + mz * c, hx: ((e.max[0] - e.min[0]) / 2) * k, hz: ((e.max[2] - e.min[2]) / 2) * k, yaw: m.yaw, y0: m.at[1] + e.min[1] * k, y1: m.at[1] + e.max[1] * k, name: m.name, room: m.room, mine: true };
  }),
  // (but the body the post gives the stove, which the world gives none: the stove itself is in the list already)
  // (nor what stops a body at a model it stands itself, a tent: the model, which is bigger, is in the list already)
  ...postSolids().filter((s) => !s.sits && s.name !== 'stove' && !postModels().some((m) => m.name === s.name && m.room === s.room && Math.hypot(m.at[0] - s.c[0], m.at[2] - s.c[2]) < 0.5)).map((s): Block => ({ x: s.c[0], z: s.c[2], hx: s.h[0], hz: s.h[2], yaw: s.yaw, y0: s.c[1] - s.h[1], y1: s.c[1] + s.h[1], name: s.name, room: s.room, mine: true })),
];
/** and the fort's own things: its furniture, and what it stood off the shelf */
// (the fort's own: since the post was joined to the fort, what the fort gives holds the post's things too, and they are left out)
const spot = (q: { kind: string; x: number; y: number; z: number }) => `${q.kind} ${q.x.toFixed(2)} ${q.y.toFixed(2)} ${q.z.toFixed(2)}`;
const ownProps = new Set(postProps(O).map(spot));
const theirs: Block[] = [
  ...FURNITURE.map((f): Block => ({ x: f.x, z: f.z, hx: f.w / 2 / S, hz: f.d / 2 / S, yaw: f.yaw, y0: f.y, y1: f.y + (f.kind === 'table' ? 0.8 : f.kind === 'bench' ? 0.45 : f.kind === 'bunk' ? 1.75 : 1.9) / S, name: `the fort's ${f.kind}`, mine: false })),
  // (what the fort gives is places in the world: here in its own measure, as everything else in this list is)
  ...castleProps(O).filter((q) => !ownProps.has(spot(q)) && inCastle(O, q.x, q.y + 0.3, q.z)).map((q) => stoodBlock(own(q), `the fort's ${q.kind}`, false)),
];
/** how far a spot of the plan is from a block (0: in it) */
const off = (b: Block, x: number, z: number) => {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.x, dz = z - b.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - b.hx), Math.max(0, Math.abs(lz) - b.hz));
};
/** whether two blocks are in one another (on the plan, and in height) */
const meet = (a: Block, b: Block) => {
  if (a.y1 <= b.y0 + 0.02 || b.y1 <= a.y0 + 0.02) return false;
  const corners = (q: Block) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => { const c = Math.cos(q.yaw), s = Math.sin(q.yaw); return [q.x + i * q.hx * c + j * q.hz * s, q.z - i * q.hx * s + j * q.hz * c]; });
  const ca = corners(a), cb = corners(b);
  for (const q of [a, b]) for (const [ax, az] of [[Math.cos(q.yaw), -Math.sin(q.yaw)], [Math.sin(q.yaw), Math.cos(q.yaw)]]) {
    const pa = ca.map(([x, z]) => x * ax + z * az), pb = cb.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pa) <= Math.min(...pb) + 0.01 || Math.max(...pb) <= Math.min(...pa) + 0.01) return false;
  }
  return true;
};
/** what of the post a body is in or brushes, with its feet at a spot: it is `wide` across and 1.72 m tall */
const brushes = (x: number, y: number, z: number, wide: number) => mine.find((b) => b.y1 > y + 0.12 && b.y0 < y + 1.72 && off(b, x, z) < wide / 2);
const along = (a: V3, b: V3, step = 0.1): V3[] => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), out: V3[] = [];
  for (let s = 0; s <= len + 1e-6; s += step) out.push([a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len, a[2] + ((b[2] - a[2]) * s) / len]);
  return out;
};

ok('it is what was asked for: every room has its job, and what is off the shelf is something the game has', () => {
  const rooms = new Set(postRooms().map((q) => q.room)), made = postMade();
  for (const r of ['roof', 'command post', 'mess', 'store', 'dump', "sniper's nest", 'bunk room', 'village'] as Room[]) assert.ok(rooms.has(r), `nothing stands in the ${r}`);
  for (const q of postRooms()) assert.ok(models[q.kind], `the game has no ${q.kind}`);
  const has = (t: string, room?: Room) => made.some((m) => m.t === t && (!room || m.room === room));
  // the mast and its guys and its light; sandbags, nets, a tarpaulin, tents, duckboards, cables, the flagpole, floodlights, the generator
  const mast = made.find((m) => m.t === 'mast');
  assert.ok(mast && mast.t === 'mast' && mast.guys.length >= 3 && mast.at[1] === K.roof && mast.h === POST.mast.h);
  for (const [t, room] of [['bags', 'gate'], ['bags', 'roof'], ['sheet', 'dump'], ['sheet', 'roof'], ['sheet', 'terrace'], ['boards', 'terrace'], ['table', 'terrace'], ['cable', 'store'], ['pole', 'gate'], ['flood', 'terrace'], ['generator', 'store'], ['scope', 'roof'], ['map', 'command post'], ['grave', 'village'], ['bedroll', 'bunk room'], ['table', "sniper's nest"], ['set', 'signals tower']] as [string, Room][]) assert.ok(has(t, room), `no ${t} in the ${room}`);
  assert.equal(made.filter((m) => m.t === 'sheet' && m.stuff === 'net').length, 3);
  // two tents on the terrace, the Army Camp's own model (2026-10-14: the hand-made ones were "too low quality"), at the size POST.tent says, which is the model's as it comes
  const tents = postModels().filter((m) => m.room === 'terrace');
  assert.ok(tents.length === 2 && tents.every((m) => m.model === 'tent_military' && models[m.model] && m.scale === POST.tent.scale));
  const e = models[POST.tent.model];
  assert.ok(Math.abs(e.max[0] - POST.tent.half[0]) < 0.01 && Math.abs(e.max[1] - POST.tent.half[1]) < 0.01 && Math.abs(e.max[2] - POST.tent.half[2]) < 0.01 && Math.abs(e.min[1]) < 0.01);
  // three drums of fuel in the store, which blow; the stove in the mess; the set on the desk
  assert.equal(postRooms().filter((q) => q.kind === 'Barrel_01' && q.room === 'store').length, 3);
  assert.ok(postRooms().some((q) => q.kind === 'wood_stove' && q.room === 'mess') && postRooms().some((q) => q.kind === 'vintage_radio_transceiver' && q.room === 'command post'));
  // the south-east tower is left a ruin: nothing of the post is in it
  const se = towers.find((t) => /south-east/.test(t.name ?? ''))!;
  for (const b of mine) assert.ok(Math.hypot(b.x - se.cx, b.z - se.cz) > T.r + 0.5, `the ${b.name} is in the ruined tower`);
});

ok('it goes where the fort is put, however the fort is turned; and what is in the village goes with the houses', () => {
  const props = postProps(P), rooms = postRooms();
  assert.equal(props.length, rooms.length);
  props.forEach((q, i) => {
    const [x, z] = castleLocal(P, q.x, q.y, q.z);
    assert.ok(Math.hypot(x - rooms[i].x, z - rooms[i].z) < 1e-6 && Math.abs(q.rot - P.rot - rooms[i].rot) < 1e-9 && q.scale === 1);
  });
  // (all of it but the village is in the fort)
  props.forEach((q, i) => assert.equal(inCastle(P, q.x, q.y + 0.3, q.z), rooms[i].room !== 'village', `the ${q.kind} of the ${rooms[i].room}`));
  // the houses moved a long way off, on ground of the world's own: the graves and the picket go with them, and stand on that ground
  const moved = castleLoose(P).map((l) => (l.kind === 'house' ? { ...l, x: l.x + 400, z: l.z - 250 } : l)), flat = () => 77;
  const far = postProps(P, flat, moved).filter((q) => Math.hypot(q.x - P.x, q.z - P.z) > 300);
  assert.ok(far.length >= 3 && far.every((q) => q.y >= 77 && q.y < 78.2));
  // with no houses there is still the post, and nothing of a village
  assert.ok(postProps(P, flat, castleLoose(P).filter((l) => l.kind !== 'house')).every((q) => inCastle(P, q.x, q.y + 0.3, q.z)));
  assert.ok(!postMade([]).some((m) => m.room === 'village') && !postSolids([]).some((s) => s.sits));
});

// ---- the ways through the fort, as the fort itself says them

/** every way a body goes, as spots where its feet are: [x, y over the terrace, z] */
const ways: { name: string; spots: V3[] }[] = [];
{
  const gz = (C.gate.z0 + C.gate.z1) / 2, rampFoot = C.hx + C.parapet.thick / 2 + Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2);
  // (the same lines the fort's own test walks: test/castle.test.ts, 'the ways in are open')
  ways.push({ name: 'up the ramp', spots: along([rampFoot, -C.ramp.drop, gz], [C.hx + 0.4, 0, gz]) });
  ways.push({ name: 'through the gate', spots: along([C.hx + 0.4, 0, gz], [C.hx - 2.5, 0, gz]) });
  ways.push({ name: 'the small door of the keep', spots: along([K.x1 + 1.5, 0, 0], [R.x1 - 1, 0, 0]) });
  ways.push({ name: 'the doorway of the hall', spots: along([K.x1 + 0.8, F1, 0], [R.x1 - 1, F1, 0]) });
  // (to the north walk's middle, which the way through the breach comes in on: it went on half a pace past it, into whatever stood by the keep)
  ways.push({ name: 'through the breach', spots: along([-4.5, 0, -C.hz - 2], [-4.5, 0, -C.hz + 2.1]) });
  ways.push({ name: 'from the scaffold onto the keep', spots: along([-1.3, B, K.z1 + 1], [-1.3, B, R.z1 - 0.6]) });
  // every flight of stairs, from a pace before its foot to a pace past its head
  for (const f of flights) {
    const dx = f.head[0] - f.foot[0], dz = f.head[2] - f.foot[2], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    ways.push({ name: f.name ?? 'a stair', spots: [...along([f.foot[0] - ux * 0.9, f.foot[1], f.foot[2] - uz * 0.9], f.foot), ...along(f.foot, f.head), ...along(f.head, [f.head[0] + ux * 0.9, f.head[1], f.head[2] + uz * 0.9])] });
  }
  for (const tw of towers) {
    // through its door, from the terrace to the middle of its floor; up its stair; and from the head of its stair onto its platform
    const d = (tw.door * Math.PI) / 180, rm = (T.stairIn + T.r - T.wall) / 2, sg = Math.sign(tw.stair.sweep), stair: V3[] = [];
    ways.push({ name: `${tw.name}: its door`, spots: along([tw.cx + Math.cos(d) * (T.r + 1.4), 0, tw.cz + Math.sin(d) * (T.r + 1.4)], [tw.cx, 0, tw.cz]) });
    for (let a = -8; a <= Math.abs(tw.stair.sweep) + 20; a += 2) {
      const ang = ((tw.stair.from + sg * a) * Math.PI) / 180;
      stair.push([tw.cx + Math.cos(ang) * rm, T.deck * Math.min(1, Math.max(0, a / Math.abs(tw.stair.sweep))), tw.cz + Math.sin(ang) * rm]);
    }
    ways.push({ name: `${tw.name}: its stair`, spots: stair });
    const end = ((tw.stair.from + tw.stair.sweep) * Math.PI) / 180;
    ways.push({ name: `${tw.name}: onto its platform`, spots: along([tw.cx + Math.cos(end) * rm, T.deck, tw.cz + Math.sin(end) * rm], [tw.cx, T.deck, tw.cz]) });
  }
  // round the terrace: along the middle of each walk, between the keep and the wall (but where the fort itself has no floor)
  const face = { x: C.hx + C.parapet.thick / 2 - 1.06, z: C.hz + C.parapet.thick / 2 - 1.06 };
  ways.push({ name: 'the north walk', spots: along([K.x0 - 1, 0, -7.9], [K.x1 + 1, 0, -7.9]) });
  ways.push({ name: 'the east walk', spots: [...along([6.8, 0, K.z0], [6.8, 0, C.gate.z0]), ...along([7.2, 0, C.gate.z1 + 0.2], [7.2, 0, 1.8]), ...along([7.4, 0, UNDER.rent.z0], [7.4, 0, UNDER.rent.z1 + 0.5])] });
  ways.push({ name: 'the south walk', spots: along([K.x0 - 1, 0, 8.4], [K.x1 + 1, 0, 8.4]) });
  // the firing step: a body's width along the inside of the parapet, all the way round (the towers stand in the corners)
  for (const s of [-1, 1]) {
    ways.push({ name: `the parapet ${s < 0 ? 'north' : 'south'}`, spots: along([-6.8, 0, s * (face.z - 0.4)], [6.8, 0, s * (face.z - 0.4)], 0.2) });
    ways.push({ name: `the parapet ${s < 0 ? 'west' : 'east'}`, spots: along([s * (face.x - 0.4), 0, -6.8], [s * (face.x - 0.4), 0, 6.8], 0.2) });
  }
  // the keep's roof: from the hatch to each flight of steps, and along the east wall top behind the observation post
  const roof = flights.filter((f) => /roof steps/.test(f.name ?? '')), hatch = flights.find((f) => /stair to the roof/.test(f.name ?? ''))!;
  for (const f of roof) ways.push({ name: `the roof, to the ${f.name}`, spots: along([hatch.head[0] + 0.5, K.roof, hatch.head[2]], f.foot) });
  ways.push({ name: 'the east wall top', spots: along([R.x1 + 0.6, B, -3], [R.x1 + 0.6, B, 1.9]) });
}

ok('nothing stands in a way: a body has its width, 0.8 m, on every stair, through every door and along every walk', () => {
  assert.ok(ways.length >= 30 && flights.length >= 9);
  for (const w of ways) for (const [x, y, z] of w.spots) {
    const hit = brushes(x, y, z, 0.8);
    assert.equal(hit, undefined, `${w.name}: the ${hit?.name} of the ${hit?.room} is within a body's width of the way at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
  }
});

ok('nothing stands within 0.6 m of a door, of the foot or the head of a stair, or of a window that is fought from', () => {
  const gz = (C.gate.z0 + C.gate.z1) / 2, spots: [string, V3][] = [];
  for (const f of flights) spots.push([`the foot of the ${f.name}`, f.foot], [`the head of the ${f.name}`, f.head]);
  spots.push(['the gate', [C.hx, 0, gz]], ['the small door', [K.x1, 0, 0]], ['the small door, inside', [R.x1, 0, 0]], ['the doorway of the hall', [K.x1, F1, 0]], ['the doorway of the hall, inside', [R.x1, F1, 0]]);
  spots.push(['the breach', [(C.breach.x0 + C.breach.x1) / 2, 0, -C.hz]], ['the head of the stair down', [UNDER.stair.head, 0, UNDER.stair.z]], ['the fallen bay', [(UNDER.bay.x0 + UNDER.bay.x1) / 2, 0, UNDER.bay.z1]]);
  for (const tw of towers) {
    const d = (tw.door * Math.PI) / 180;
    spots.push([`the door of the ${tw.name}`, [tw.cx + Math.cos(d) * (T.r - T.wall / 2), 0, tw.cz + Math.sin(d) * (T.r - T.wall / 2)]]);
    // its windows: stood at on the floor, or on the stair where the stair passes before one
    for (const s of tw.slits) {
      const a = (s.a * Math.PI) / 180, share = stairShare(tw, s.a), y = s.y0 < 1 ? 0 : (share ?? 0) * T.deck;
      spots.push([`a window of the ${tw.name}`, [tw.cx + Math.cos(a) * (T.r - T.wall - 0.3), y, tw.cz + Math.sin(a) * (T.r - T.wall - 0.3)]]);
    }
  }
  // the keep's windows, each at the mouth of its recess in the wall (the fort's own: src/sim/castle.ts, where the mass of each wall is cut)
  spots.push(['the north window of the hall', [-0.5, F1, R.z0]], ['the west window of the hall', [R.x0, F1, -2.3]], ['the west window of the upper room', [R.x0, F2, 0.4]], ['the south window of the upper room', [2.1, F2, R.z1]]);
  for (const [name, [x, y, z]] of spots) {
    const hit = mine.find((b) => b.y1 > y + 0.12 && b.y0 < y + 1.8 && off(b, x, z) < 0.6);
    assert.equal(hit, undefined, `the ${hit?.name} of the ${hit?.room} is within 0.6 m of ${name}`);
  }
});

ok('nothing of it stands in the fort, in the fort\'s own things, or in anything else of the post', () => {
  const clear = (s: (typeof fort)[number], p: V3) => {
    const [qx, qy, qz, qw] = s.q, d = [p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]];
    const tx = 2 * (-qy * d[2] + qz * d[1]), ty = 2 * (-qz * d[0] + qx * d[2]), tz = 2 * (-qx * d[1] + qy * d[0]);
    const l = [d[0] + qw * tx + (-qy * tz + qz * ty), d[1] + qw * ty + (-qz * tx + qx * tz), d[2] + qw * tz + (-qx * ty + qy * tx)];
    return Math.hypot(...l.map((v, i) => Math.max(0, Math.abs(v) - s.h[i])));
  };
  for (const b of mine) {
    // (its middle, a little over its foot, is in no stone and no timber of the fort: but the floor it stands on, and the furniture, which is asked about next)
    for (const s of fort) if (!s.feet && !/terrace|floor|roof|table|bench|bunk|rack|landing|wall$/.test(s.name)) assert.ok(clear(s, [b.x, b.y0 + 0.3, b.z]) > 0.04, `the ${b.name} of the ${b.room} stands in the fort's ${s.name}`);
    for (const t of theirs) assert.ok(!meet(b, t), `the ${b.name} of the ${b.room} stands in ${t.name}`);
  }
  for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
    // (what stands ON something of the post is not in it: a box on a crate, the set on the desk)
    assert.ok(!meet(mine[i], mine[j]), `the ${mine[i].name} and the ${mine[j].name} of the ${mine[i].room} are in one another`);
  }
  // and every block has size
  for (const s of postSolids()) assert.ok(s.h.every((v) => v > 0.02 && Number.isFinite(v)) && s.c.every(Number.isFinite), s.name);
  assert.ok(postSolids().length < 40);
});

ok('what lies in it lies ON something, at that thing\'s height, on the step of the map its room is', () => {
  // (the places are places in the world; here in the fort's own measure, as the tops they lie on are. And every top
  // is a body's: the height of a desk, a shelf, a table, a bedroll or a course of sandbags is so many metres of the
  // world, which in the fort's own measure is `/ S` of it; and so is how far along it a hand reaches.)
  const loot = postLoot(O).map(own), made = postMade(), BG = POST.bag;
  // the tops there are to lie on: desks and shelves off the shelf, and what is made (a bench, a table, a wall of sandbags, a bedroll)
  const tops: { x: number; z: number; y: number; r: number; what: string }[] = [];
  for (const q of postRooms()) {
    const e = models[q.kind];
    if (q.kind === 'metal_office_desk') tops.push({ x: q.x, z: q.z, y: q.y + e.max[1] / S, r: 1.05 / S, what: 'desk' });
    if (q.kind === 'Shelf_01') for (const lv of [0.14, 0.38, 0.66, 0.94, 1.22, 1.51, 1.79]) tops.push({ x: q.x, z: q.z, y: q.y + lv / S, r: 0.6 / S, what: 'shelf' });
    // (and the lid of a crate stood on the paving, a hand's breadth of slack in it for how the lid is drawn)
    if (q.kind === 'wooden_military_crate' && q.room === 'terrace') tops.push({ x: q.x, z: q.z, y: q.y + e.max[1] / S + 0.004, r: e.max[0] / S, what: 'crate' });
  }
  for (const m of made) {
    if (m.t === 'table') tops.push({ x: m.at[0], z: m.at[2], y: m.at[1] + m.h / S, r: m.w / 2 / S, what: m.name });
    if (m.t === 'bedroll') tops.push({ x: m.at[0], z: m.at[2], y: m.at[1] + 0.11 / S, r: 0.92 / S, what: 'bedroll' });
    // (a groundsheet: a sheet laid flat, all four corners at one height over the paving)
    if (m.t === 'sheet' && m.name === 'groundsheet' && m.p.every((q) => Math.abs(q[1] - m.p[0][1]) < 1e-9)) tops.push({ x: (m.p[0][0] + m.p[2][0]) / 2, z: (m.p[0][2] + m.p[2][2]) / 2, y: m.p[0][1], r: Math.hypot(m.p[2][0] - m.p[0][0], m.p[2][2] - m.p[0][2]) / 2, what: 'groundsheet' });
    if (m.t === 'bags' && !m.sits) tops.push({ x: (m.pts[0][0] + m.pts[1][0]) / 2, z: (m.pts[0][1] + m.pts[1][1]) / 2, y: m.y + (m.courses * BG.course) / S, r: Math.hypot(m.pts[1][0] - m.pts[0][0], m.pts[1][1] - m.pts[0][1]) / 2, what: m.name });
  }
  for (const l of loot) {
    const on = tops.find((t) => Math.abs(t.y - l.y) < 0.012 && Math.hypot(t.x - l.x, t.z - l.z) < t.r);
    assert.ok(on, `a thing of the ${l.room} at ${l.x.toFixed(2)}, ${l.y.toFixed(2)}, ${l.z.toFixed(2)} lies on nothing`);
    assert.ok(!l.floor && l.surf && l.building === 'castle' && inCastle(O, l.x * S, l.y * S, l.z * S));
    // (and the room it is in over it: its surface says how much)
    assert.ok(l.surf!.clear >= 0.24);
  }
  // by the owner's step (2026-10-13: "castle is T4 loot"): every place of the post inside the walls is of the fourth; the nest's bench always has a gun
  // (as first laid out the command post and the sniper's nest were of the fourth and the other eight of the third)
  for (const l of loot) assert.equal(l.tier, 4, `the step of a thing in the ${l.room}`);
  const by = (t: number) => loot.filter((l) => l.tier === t).length;
  // (the bivouac behind the keep, 2026-10-14: a thing on each groundsheet, on the stack and two on the table, where two lay hidden in the tents)
  assert.deepEqual([by(3), by(4), loot.length], [0, 15, 15]);
  assert.deepEqual(loot.filter((l) => l.arms).map((l) => [l.room, l.arms]), [["sniper's nest", 'guns']]);
  assert.ok(loot.every((l) => l.usage.includes('Military')));
  // no two in one place, the fort's own among them; and none in what stops a body (but the thing it lies on)
  const all = [...loot, ...castleLoot(O).filter((l) => !('room' in l)).map(own)];
  for (let i = 0; i < loot.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y, all[i].z - all[j].z) > 0.3 / S, `two things in one place in the ${loot[i].room}`);
  for (const l of loot) for (const b of mine) if (b.y1 > l.y + 0.1 && b.y0 < l.y + 0.1) assert.ok(off(b, l.x, l.z) > 0.02 || /desk|bench|table|Shelf/.test(b.name), `a thing of the ${l.room} lies in the ${b.name}`);
  // what is searched: the commander's locker, the two crates of the dump, the two of the stack behind the keep, the crate at the picket
  const searched = new Set(['wooden_crate_01', 'wooden_military_crate', 'old_military_crate', 'weapons_case', 'steel_locker', 'med_cabinet']);
  assert.deepEqual(postRooms().filter((q) => searched.has(q.kind)).map((q) => q.room).sort(), ['command post', 'dump', 'dump', 'terrace', 'terrace', 'village']);
  // and turned with the fort it is all in the same places
  postLoot(P).forEach((l, i) => {
    const [x, z, y] = castleLocal(P, l.x, l.y, l.z);
    assert.ok(Math.hypot(x - loot[i].x, z - loot[i].z, y - loot[i].y) < 0.002 && Math.abs(l.surf!.rot - loot[i].surf!.rot - P.rot) < 1e-9);
  });
});

ok('its lamps are in the fort, and the mast\'s light is over it', () => {
  const lamps = postLamps(P), all = postLights();
  assert.ok(lamps.length >= 4 && lamps.every((l) => inCastle(P, ...l)) && all.length === lamps.length + 1);
  const [bx, bz, by] = castleLocal(P, ...postBeacon(P));
  assert.ok(Math.abs(by - (K.roof + POST.mast.h + POST.mast.light)) < 1e-6 && bx > R.x0 && bx < R.x1 && bz > R.z0 && bz < R.z1);
  // (higher than anything of the fort: seen from the valley)
  const stubs = parts.flatMap((p) => (p.t === 'wall' && /^keep .* face$/.test(p.name ?? '') && typeof p.top !== 'number' ? p.top : []));
  assert.ok(by > Math.max(...stubs) + 4);
  // none of them is where the fort already keeps a fire
  for (const l of lamps) for (const f of castleLamps(P)) assert.ok(Math.hypot(l[0] - f[0], l[1] - f[1], l[2] - f[2]) > 1);
  void castleAt;
});

// ---- its shapes

const skins = postShape(postMade()), counts = postCounts(), each = Object.entries(skins) as [string, Skin][];

ok('it is cheap: under 25,000 triangles made by hand and six things to draw from near, the mast alone from far', () => {
  assert.equal(Object.keys(skins).length, 4);
  // (hard, cloth, nets, the glass of the lamps after dusk; one more into the sun's shadow maps; and the mast's light)
  assert.ok(Object.keys(skins).length + 2 <= 6);
  assert.ok(counts.near < 25000 && counts.near > 6000, `${counts.near} triangles from near`);
  assert.ok(counts.far > 20 && counts.far < 100, `${counts.far} triangles from far`);
  assert.ok(counts.hard > 0 && counts.cloth > 0 && counts.net > 0 && counts.glow > 0);
  assert.ok(Math.abs(POST.reach - 350) <= 30);
});

ok('its shapes are sound: every triangle has size and is a number, and every corner faces a way', () => {
  for (const [name, k] of each) {
    assert.ok(k.pos.length % 9 === 0 && k.nrm.length === k.pos.length && k.col.length === k.pos.length && k.uv.length === (k.pos.length / 3) * 2 && k.snow.length === k.uv.length);
    assert.ok([...k.pos, ...k.nrm, ...k.uv, ...k.col, ...k.snow].every(Number.isFinite), `${name}: not a number`);
    let small = 0;
    for (let t = 0; t < k.pos.length / 9; t++) {
      const p = [0, 1, 2].map((i) => k.pos.slice(t * 9 + i * 3, t * 9 + i * 3 + 3)), e1 = p[1].map((v, c) => v - p[0][c]), e2 = p[2].map((v, c) => v - p[0][c]);
      if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-9) small++;
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(Math.hypot(...k.nrm.slice(t * 9 + i * 3, t * 9 + i * 3 + 3)) - 1) < 1e-3, `${name}: a corner faces no way`);
    }
    assert.equal(small, 0, `${name}: ${small} triangles of no size`);
    assert.ok(k.col.every((v) => v >= 0 && v <= 1.2));
  }
});

ok('the day on it and its snow are the fort\'s own: never more than the fort says of a place, and snow only under the sky', () => {
  // (the number each corner carries is how much of the day reaches it, as the fort's own corners carry it: the fort's
  // stone look lays snow from SNOW_FROM of it up, and dims the sky's light by it)
  const SNOW_FROM = 0.7;
  let snowed = 0, bare = 0, under = 0;
  for (const [, k] of each) for (let i = 0; i < k.pos.length / 3; i++) {
    const p = k.pos.slice(i * 3, i * 3 + 3) as V3, nn = k.nrm.slice(i * 3, i * 3 + 3) as V3, s = k.snow[i * 2], fort = castleSky(p, nn);
    assert.ok(s >= 0 && s <= 1);
    assert.ok(s <= fort + 1e-9, `${s.toFixed(2)} of the day at ${p.map((v) => v.toFixed(1))}, where the fort says ${fort.toFixed(2)}`);
    if (s >= SNOW_FROM) {
      assert.equal(fort, 1, `snow at ${p.map((v) => v.toFixed(1))}, where the fort has a roof over it`);
      snowed++;
    } else if (fort >= 1) bare++;
    else under++;
    // (in the keep's rooms, under its floors and its roof, it is whatever the fort says of the room, and no snow)
    if (p[0] > R.x0 && p[0] < Math.min(R.x1, K.fallen.x0) && p[2] > R.z0 && p[2] < R.z1 && p[1] < K.roof - 0.4 && p[1] > 0) assert.ok(s < SNOW_FROM && Math.abs(s - fort) < 1e-9, `in the keep at ${p.map((v) => v.toFixed(1))}`);
  }
  // (snow on most of what is out of doors; none on the mast's bars, a flag, the bare patches of a tarpaulin; and what is under a roof)
  assert.ok(snowed > 3000 && bare > 500 && under > 1000, `${snowed} corners that snow lies on, ${bare} under the sky and bare, ${under} under cover`);
  void KIT_LEVELS;
});

console.log(`\n${n} checks passed. By hand: ${counts.near} triangles from near (hard ${counts.hard}, cloth ${counts.cloth}, nets ${counts.net}, glass ${counts.glow}), ${counts.far} from far; ${postSolids().length} things to run into.`);
const stood = postRooms(), sum = stood.reduce((t, q) => t + models[q.kind].tris, 0);
console.log(`Off the shelf: ${stood.length} things of ${new Set(stood.map((q) => q.kind)).size} kinds, ${sum} triangles at their fullest.`);
