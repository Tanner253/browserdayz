// How the infected move: motion capture from Higgsfield's library (the owner, 2026-10-25: "our zombies animations and
// rigging is subject to be redone now as well"; scripts/mocap-infected.mjs, public/assets/characters/moves-infected.glb).
// Each kind has a few walks, runs and blows of its own, and each one of them takes one of each by its number, so that a
// crowd never moves as one: the same walk at another pace, in another moment of its stride, or another walk. What they
// share with a survivor (standing, a flinch, a fall) is the survivors' own (moves.glb). Every game picks the same.

import type * as THREE from 'three';
import { assets } from '../core/assets';
import { moveClips } from './avatar/gait';
import { roll, type InfectedKind } from './infected-kinds';
import TABLE from './infected-moves.json';

export const INFECTED_MOVE_FILE = 'assets/characters/moves-infected.glb';
let lib: Promise<THREE.AnimationClip[]> | null = null;
const infectedClips = () => (lib ??= assets.loadGLTF(INFECTED_MOVE_FILE).then((g) => g.animations));

type Name = keyof typeof TABLE;
/**
 * Each kind's: how it shambles about, how it comes after somebody, and how it strikes. (The old shake is not among the
 * walks: drawn at a fifth of a metre a second, at the pace they wander it was a scurry.)
 */
const KIND_MOVES: Record<InfectedKind, { walk: Name[]; run: Name[]; blow: Name[] }> = {
  villager: { walk: ['zUnsteady', 'zStumble', 'zLimp', 'zInjured'], run: ['zCharge', 'zRun'], blow: ['zLunge', 'zGrab'] },
  babushka: { walk: ['zLimp2', 'zUnsteady', 'zInjured'], run: ['zChargeF'], blow: ['zGrab', 'zLunge'] },
  oldman: { walk: ['zLimp2', 'zInjured', 'zMummy'], run: ['zChargeF', 'zCharge'], blow: ['zGrab'] },
  worker: { walk: ['zStumble', 'zMonster', 'zLimp'], run: ['zCharge', 'zRun'], blow: ['zSlam', 'zLunge'] },
  conscript: { walk: ['zMonster', 'zLimp', 'zUnsteady'], run: ['zRun', 'zCharge'], blow: ['zSlam', 'zLunge'] },
  militia: { walk: ['zLimp', 'zUnsteady', 'zMonster'], run: ['zCharge'], blow: ['zLunge', 'zSlam'] },
  patient: { walk: ['zMummy', 'zInjured', 'zLimp2'], run: ['zChargeF', 'zSprint'], blow: ['zGrab', 'zLunge'] },
  nurse: { walk: ['zUnsteady', 'zLimp2', 'zMummy'], run: ['zChargeF'], blow: ['zGrab', 'zLunge'] },
  hazmat: { walk: ['zStumble', 'zInjured', 'zMonster'], run: ['zCharge', 'zRun'], blow: ['zLunge', 'zSlam'] },
  bloated: { walk: ['zDrag'], run: ['zCharge'], blow: ['zSlam'] },
  starved: { walk: ['zMonster', 'zMummy'], run: ['zSprint'], blow: ['zLunge', 'zGrab'] },
  burned: { walk: ['zMummy', 'zStumble', 'zInjured'], run: ['zCharge', 'zSprint'], blow: ['zSlam', 'zGrab'] },
};

/** what the infected do besides walking, running and striking, by the body's own names for them (see Avatar.act) */
export const EXTRAS = ['zEat', 'zScream', 'zPain'] as const;

export interface InfectedMoves {
  /** every one of the body's clips (CLIPS in avatar/pose.ts), by its name */
  clips: Record<string, THREE.AnimationClip>;
  /** the paces its walk and run were captured at, metres a second (the body steps them in time with the ground) */
  paces: { walk: number; run: number };
  extras: Record<(typeof EXTRAS)[number], THREE.AnimationClip>;
}

/** the `i`th one's movements, of its kind */
export async function infectedMoves(kind: InfectedKind, i: number): Promise<InfectedMoves> {
  const [own, shared] = await Promise.all([infectedClips(), moveClips()]);
  const z = (n: string) => own.find((c) => c.name === n)!, s = (n: string) => shared.find((c) => c.name === n)!;
  const m = KIND_MOVES[kind], one = <T>(of: T[], salt: number) => of[Math.floor(roll(i, salt) * of.length)];
  const walk = one(m.walk, 11), run = one(m.run, 12), blow = one(m.blow, 13);
  const idle = s('idle'), fall = s('deathF');
  // (what an infected never does, crouch, jump, dance, sit or hold a gun, stands in as standing: its weight is always none)
  const clips: Record<string, THREE.AnimationClip> = {
    idle, walk: z(walk), run: z(run), strike: z(blow),
    hit: s('hitBody'), hitHead: s('hitHead'), death: s('deathB'), deathFront: fall, deathSide: s('deathS'),
    proneDown: fall, crawl: fall,
    crouchIdle: idle, crouchWalk: idle, jumpStart: idle, jumpLoop: idle, jumpLand: idle, dance: idle, sit: idle, armed: idle,
  };
  const pace = (n: Name) => (TABLE as Record<string, { pace?: number }>)[n].pace ?? 1;
  return { clips, paces: { walk: pace(walk), run: pace(run) }, extras: { zEat: z('zEat'), zScream: z('zScream'), zPain: z('zPain') } };
}
