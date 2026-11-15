// The map's doors, to the server's own survivors (2026-11-15). The owner, playing them: "the ai are shooting through
// ... the doors of the shipping containers when theyre open, the ai are shooting through and walking through the doors
// of buildings without needing to open them". A door is no part of the server's walls (server/walls.ts): it swings, so
// the bake leaves it out, and all the server kept of one was whether it is open. Here each is a leaf where the game
// hangs it (src/world/buildings.ts Door: from its hinge along its own x, shut, or swung 0.55 of a half turn open),
// which no eye and no round of theirs goes through, shut or open; a shut one stops their feet until they open it.

import * as THREE from 'three';
import { broadcast } from './players';
import { doors, world } from './index';
import { doorLocked } from './sites';
import type { Vec3 } from '../src/sim/grenades';

interface Leaf { i: number; x: number; z: number; w: number; h: number; oneWay: boolean; inv: Map<number, number[]> }

/** metres a side of the squares the doors are kept in, to find the few near a line */
const BIN = 16;
let bins: Map<number, Leaf[]> | null = null;
const key = (i: number, j: number) => i * 8192 + j;

function leaves() {
  if (bins) return bins;
  bins = new Map();
  (world.doorSpecs as { m: THREE.Matrix4; w: number; h: number; id: string; leaf?: number }[]).forEach((s, i) => {
    const e = s.m.elements, l: Leaf = { i, x: e[12], z: e[14], w: s.w, h: s.h, oneWay: s.id.startsWith('container'), inv: new Map() };
    const k = key(Math.floor(l.x / BIN), Math.floor(l.z / BIN));
    bins!.set(k, [...(bins!.get(k) ?? []), l]);
  });
  return bins;
}

/** whether it stands open, and which way it swung */
function stateOf(i: number): [boolean, number] {
  const spec = world.doorSpecs[i] as { open: boolean; swing: number };
  return doors.get(i) ?? [spec.open, spec.swing];
}

/** the world seen from a leaf: shut (0), or open to one side */
function frame(l: Leaf, swing: number) {
  let inv = l.inv.get(swing);
  if (!inv) {
    const m = (world.doorSpecs[l.i] as { m: THREE.Matrix4 }).m.clone();
    if (swing) m.multiply(new THREE.Matrix4().makeRotationY(-swing * Math.PI * 0.55));
    inv = m.invert().elements.slice();
    l.inv.set(swing, inv);
  }
  return inv;
}

/**
 * The door a line goes through: its number, or -1. `shut`: only one that is shut (what stops feet); else an open
 * leaf where it stands as well (what stops an eye or a round).
 */
export function doorAcross(a: Vec3, b: Vec3, shut: boolean): number {
  const all = leaves();
  const i0 = Math.floor((Math.min(a[0], b[0]) - 3) / BIN), i1 = Math.floor((Math.max(a[0], b[0]) + 3) / BIN);
  const j0 = Math.floor((Math.min(a[2], b[2]) - 3) / BIN), j1 = Math.floor((Math.max(a[2], b[2]) + 3) / BIN);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    for (const l of all.get(key(i, j)) ?? []) {
      const [open, swing] = stateOf(l.i);
      if (open && shut) continue;
      const e = frame(l, open ? (l.oneWay ? 1 : swing > 0 ? 1 : -1) : 0);
      const az = e[2] * a[0] + e[6] * a[1] + e[10] * a[2] + e[14], bz = e[2] * b[0] + e[6] * b[1] + e[10] * b[2] + e[14];
      if (az * bz > 0 || az === bz) continue;
      const t = az / (az - bz), x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      const lx = e[0] * x + e[4] * y + e[8] * z + e[12], ly = e[1] * x + e[5] * y + e[9] * z + e[13];
      if (lx >= -0.05 && lx <= l.w + 0.05 && ly >= -0.05 && ly <= l.h + 0.05) return l.i;
    }
  }
  return -1;
}

/** It opens a door, away from where it stands as a player's does: every game is told. False if it is locked. */
export function openDoor(i: number, from: Vec3): boolean {
  if (doorLocked(i)) return false;
  const spec = world.doorSpecs[i] as { m: THREE.Matrix4; id: string };
  const e = spec.m.clone().invert().elements, z = e[2] * from[0] + e[6] * from[1] + e[10] * from[2] + e[14];
  const swing = spec.id.startsWith('container') ? 1 : z > 0 ? -1 : 1;
  if (process.env.NPC_LOG) console.log(`[npc] opened door ${i} (${spec.id})`);
  doors.set(i, [true, swing]);
  broadcast({ t: 'door', i, open: true, swing });
  return true;
}

export { doorLocked };
