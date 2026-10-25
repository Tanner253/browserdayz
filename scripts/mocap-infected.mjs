// The infected's own movements, from Higgsfield's rigging library (the owner, 2026-10-25: "our zombies animations and
// rigging is subject to be redone now as well ... higgsfield can give us way better dyanmic zombies"). scripts/mocap.mjs
// carries them onto the skeleton with the survivors' and writes them to a file of their own,
// public/assets/characters/moves-infected.glb, and their table to src/game/infected-moves.json. What they share with
// a survivor (standing, a flinch, a fall) they take from the survivors' file (moves.glb) as it is.
//
// Most were played by Meshy on the Villager (assets-src/incoming/higgsfield/zombies/anim, 8 credits a movement, 2026-10-25);
// a few the movement path had already harvested on the survivor (`mocap`).
import * as THREE from 'three';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readClip, writeClip } from './mocap-pose.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = process.env.ZONA_MAIN ?? ROOT;
const under = (...p) => [path.join(ROOT, 'assets-src', ...p), path.join(MAIN, 'assets-src', ...p), path.resolve(ROOT, '..', '..', '..', 'assets-src', ...p)].find(existsSync);
const ZOMBIES = under('incoming', 'higgsfield', 'zombies', 'anim');
const MOCAP = under('incoming', 'higgsfield', 'anim', 'mocap');

/**
 * name -> { from, dir, way/gait/square as the survivors' are, `blow` [from, lands, to] seconds of the source: a blow, warped
 * to the game's lunge (see `warp`), `cut` [from, to] }. A walk and a chase are read for their pace.
 */
export const INFECTED_MOVES = {
  // shambling about: every kind has its own few (src/game/infected-kinds.ts says whose is whose)
  zUnsteady: { from: 'Unsteady_Walk', dir: ZOMBIES, way: 'F', gait: 'walk' },
  zStumble: { from: 'Stumble_Walk', dir: ZOMBIES, way: 'F', gait: 'walk', square: 0.5 },
  zShaky: { from: 'Elderly_Shaky_Walk', dir: ZOMBIES, way: 'F', gait: 'walk' },
  zDrag: { from: 'Slow_Orc_Walk', dir: ZOMBIES, way: 'F', gait: 'walk' },
  zMummy: { from: 'Mummy_Stagger', dir: ZOMBIES, way: 'F', gait: 'walk' },
  zMonster: { from: 'Monster_Walk', dir: ZOMBIES, way: 'F', gait: 'walk' },
  zInjured: { from: 'Injured_Walk', dir: MOCAP, way: 'F', gait: 'walk', square: 0.5 },
  zLimp: { from: 'Limping_Walk', dir: MOCAP, way: 'F', gait: 'walk' },
  zLimp2: { from: 'Limping_Walk_2', dir: MOCAP, way: 'F', gait: 'walk' },
  // after somebody
  zCharge: { from: 'Male_Head_Down_Charge', dir: ZOMBIES, way: 'F', gait: 'run' },
  zChargeF: { from: 'Female_Head_Down_Charge', dir: ZOMBIES, way: 'F', gait: 'run' },
  zSprint: { from: 'Lean_Forward_Sprint', dir: MOCAP, way: 'F', gait: 'run' },
  zRun: { from: 'Run_03', dir: MOCAP, way: 'F', gait: 'run' },
  // the blow: both arms thrown at whoever is in front, an arm brought down from overhead, a chop from the shoulder
  // (each [from, through, to] read off the whole of its source in strips, progress/zombies/raw-*)
  zLunge: { from: 'Punch_Forward_with_Both_Fists', dir: ZOMBIES, blow: [1.4, 2.3, 3.1], square: 0 },
  zGrab: { from: 'Grip_and_Throw_Down', dir: ZOMBIES, blow: [2.6, 3.5, 4.3] },
  zSlam: { from: 'Charged_Axe_Chop', dir: MOCAP, blow: [3.6, 4.4, 5.2], square: 0 },
  // what else it does: tears at what lies on the ground, screams on seeing somebody, holds its head, and is thrown back
  zEat: { from: 'Pull_Radish', dir: ZOMBIES, still: true },
  zScream: { from: 'Zombie_Scream', dir: ZOMBIES },
  zPain: { from: 'Head_Hold_in_Pain', dir: ZOMBIES, square: 0.3 },
  zBlown: { from: 'Shot_and_Blown_Back', dir: ZOMBIES },
  // (shot from in front: the survivors' fall backwards, from where it is already going over. Their cut starts with the
  // arms flung out level for half a second, standing: on one of the infected it read as a T-pose)
  zFallBack: { from: 'Shot_and_Fall_Backward', dir: MOCAP, cut: [1.85, 3.53] },
};

/** where the game's lunge has a blow's arm (src/game/avatar.ts strikeAt): drawn back by then, through by then, home by then */
const AT = { from: 0.07, lands: 0.43, to: 1.1 };

/**
 * A blow made to keep the game's time: its source from `a` to `b` seconds, the arm going through at `i`, played back so
 * that it starts at AT.from, goes through at AT.lands and is done at AT.to. (So the game's lunge, which lands at its own
 * windup, needs no table of when each blow lands: every one lands at the same moment of its clip.)
 */
export function warp(doc, sk, name, [a, i, b]) {
  const clip = readClip(doc, sk, name), fps = clip.frames / clip.dur, n = Math.round(AT.to * 30);
  const src = (s) => {
    const f = THREE.MathUtils.clamp(s * fps, 0, clip.frames), f0 = Math.floor(f), f1 = Math.min(clip.frames, f0 + 1), k = f - f0;
    const q0 = clip.qAt(f0), q1 = clip.qAt(f1), t0 = clip.tAt(f0), t1 = clip.tAt(f1);
    return { q: q0.map((q, j) => (q && q1[j] ? q.clone().slerp(q1[j], k) : q)), t: t0.clone().lerp(t1, k) };
  };
  const Q = [], T = [];
  for (let f = 0; f <= n; f++) {
    const tau = (f / n) * AT.to;
    const s = tau < AT.from ? a : tau < AT.lands ? a + ((i - a) * (tau - AT.from)) / (AT.lands - AT.from) : i + ((b - i) * (tau - AT.lands)) / (AT.to - AT.lands);
    const p = src(s);
    Q.push(p.q);
    T.push(p.t);
  }
  writeClip(doc, clip, Q, T, AT.to);
}
