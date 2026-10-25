// The twelve kinds of the infected, and which one each is (the owner, 2026-10-25: "we also need lots of variations").
// They are the people who lived and worked where they are found: the hospital's are its patients and nurses, a police
// station's its militia, the army's places their conscripts, the works their workers; the gas and the bunker keep the
// orange suits they always had. Three are rare, about anywhere: the Bloated, the Starved, and at the chemical works the
// Burned. Looks and movement only: what any of them does is the same for every kind (src/sim/infected.ts). Every game
// works the same kind out for the same one, from its number and where it lives, so nothing of it is sent.

import type * as THREE from 'three';
import type { World } from '../world/worldgen';
import { suited } from '../sim/infected';

export const KINDS = ['villager', 'babushka', 'oldman', 'worker', 'conscript', 'militia', 'patient', 'nurse', 'hazmat', 'bloated', 'starved', 'burned'] as const;
export type InfectedKind = (typeof KINDS)[number];

/**
 * Each kind's bodies (public/assets/characters/zombie_<body>.glb, scripts/infected.mjs), and how tall each stands against
 * the skeleton every body is fitted to (a survivor's height): the babushka and the nurse smaller, the old man stooped and
 * shrunk, the Starved long. The commonest have two: the villages a woman as well as a man, the army a second soldier.
 */
export const BODIES: Record<InfectedKind, [body: string, height: number][]> = {
  villager: [['villager', 1], ['villager2', 0.93]], babushka: [['babushka', 0.9]], oldman: [['oldman', 0.95]], worker: [['worker', 1.01]],
  conscript: [['conscript', 1.01], ['conscript2', 1]], militia: [['militia', 1.02]], patient: [['patient', 0.99]], nurse: [['nurse', 0.94]],
  hazmat: [['hazmat', 1.01]], bloated: [['bloated', 1]], starved: [['starved', 1.05]], burned: [['burned', 1]],
};

/** which of its kind's bodies the `i`th one has, and how tall that body stands */
export function bodyOf(kind: InfectedKind, i: number): { body: string; height: number } {
  const of = BODIES[kind], [body, height] = of[Math.floor(roll(i, 24) * of.length)];
  return { body, height };
}

/** each of the rare ones turns up about this often wherever it may */
const RARE = 0.05;
/** what an infected lived among: the nearest place of work within this of where it lives, metres */
const AMONG = 40;

/** a number in 0..1 that is the same in every game for the same one (and another for each `salt`) */
export function roll(i: number, salt: number) {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** one of these, each as likely as its share */
function pick(r: number, of: [InfectedKind, number][]): InfectedKind {
  const all = of.reduce((s, [, w]) => s + w, 0);
  let at = r * all;
  for (const [k, w] of of) if ((at -= w) < 0) return k;
  return of[of.length - 1][0];
}

const TOWNSFOLK: [InfectedKind, number][] = [['villager', 45], ['babushka', 30], ['oldman', 25]];
/** by the kind of building it lived among, who it was: [what it was there, how many in a hundred] (the rest are townsfolk) */
const AMONG_KIND: Record<string, [InfectedKind, number][]> = {
  hospital: [['patient', 55], ['nurse', 45]], hospital_wing: [['patient', 55], ['nurse', 45]], hospital_lobby: [['patient', 45], ['nurse', 55]], clinic: [['patient', 50], ['nurse', 50]],
  police: [['militia', 75]], police_hq: [['militia', 75]], police_cells: [['militia', 60]], police_garage: [['militia', 60]],
  barracks: [['conscript', 85]], guardpost: [['conscript', 80]], tower: [['conscript', 60]], tent: [['conscript', 70]],
  works_hall: [['worker', 75]], works_office: [['worker', 55]], zavod_flats: [['worker', 40]], garage: [['worker', 50]], sawmill: [['worker', 60]], smithy: [['worker', 50]], barn: [['worker', 25]],
};

/**
 * Which kind the `i`th of the infected is, living at (x, z).
 * @returns its body's file
 */
export function kindOf(world: World, i: number, x: number, z: number): InfectedKind {
  // the gas and the bunker: the orange suits, and at the works the odd one burned in its fire, or still in its overalls
  if (suited(world, x, z)) {
    const works = world.sites.find((s) => s.kind === 'works');
    const atWorks = !!works && Math.hypot(x - works.x, z - works.z) < 200;
    return pick(roll(i, 1), atWorks ? [['hazmat', 75], ['burned', 15], ['worker', 10]] : [['hazmat', 85], ['conscript', 15]]);
  }
  const r = roll(i, 2);
  if (r < RARE) return 'bloated';
  if (r < RARE * 2) return 'starved';
  // (the nearest of the places people worked, if one is within reach: among thirty houses the village's one police
  // station was the nearest to hardly anybody, and its militia were not to be found)
  let near = '', best = AMONG * AMONG;
  for (const b of world.buildings) {
    const d = (b.x - x) ** 2 + (b.z - z) ** 2;
    if (d < best && AMONG_KIND[b.type]) (best = d), (near = b.type);
  }
  // (or, with no building near, the place it is at: the army's own, a depot or a yard)
  if (!near) {
    for (const s of world.sites) if (Math.hypot(s.x - x, s.z - z) < 60) near = s.kind === 'camp' ? 'barracks' : s.kind === 'depot' || s.kind === 'yard' ? 'garage' : near;
    for (const p of world.pois) if (p.name === 'Military Checkpoint' && Math.hypot(p.x - x, p.z - z) < p.radius + 20) near = 'barracks';
  }
  const there = AMONG_KIND[near];
  if (there) {
    const work = there.reduce((s, [, w]) => s + w, 0);
    const w = roll(i, 3) * 100;
    if (w < work) return pick(w / work, there);
  }
  return pick(roll(i, 4), TOWNSFOLK);
}

/**
 * Past this the far copy of a body is drawn (`body_far`, a fifth of the triangles and a small picture: see
 * scripts/infected.mjs), metres as the eye sees them: through a scope that brings them four times nearer, four times this.
 */
export const FAR_FROM = 30;
const PAIRS = new WeakMap<THREE.Object3D, [THREE.Object3D | undefined, THREE.Object3D | undefined]>();
/** an infected's body drawn as it was made, or its far copy (with the near one's shadow, as long as it has one) */
export function drawFar(root: THREE.Object3D, far: boolean) {
  let p = PAIRS.get(root);
  if (!p) {
    p = [root.getObjectByName('body'), root.getObjectByName('body_far')];
    if (p[0] && p[1]) p[1].castShadow = p[0].castShadow;
    PAIRS.set(root, p);
  }
  if (!p[0] || !p[1] || p[1].visible === far) return;
  p[0].visible = !far;
  p[1].visible = far;
}
