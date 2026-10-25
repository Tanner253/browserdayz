// The infected in the sandbox as the game draws them (src/dev/sandbox.ts, &infected=): made by the game's own Avatar,
// with their kind's movements and the look their number gives them, and stepped by the game's own pose code, so that
// what is judged here is what is played.
//   &infected=nurse,nurse,nurse&n=3,17,40   three nurses, by those numbers (each its own look and size)
//   &speed=0.6                              metres a second they go at, on the spot (0 standing, 3.3 after somebody)
//   &roused=1                               after somebody: arms out at them, the run's head down
//   &act=claw|eat|scream|hit|hithead        a blow thrown, a body torn at, a scream, a shot taken, from the strip's start
//   &act=fall0|fall1|fall2                  shot dead from in front (falls back), from behind (forward), from the side
//   &far=1 (or 0,1,0,1: one each)           their far copies
//   &round=1                                gathered round the survivor as the game keeps them apart (`gatherRound`)
// With &strip=N the strip runs over `&secs` seconds (2 by default).

import * as THREE from 'three';
import type { Atmosphere } from '../world/atmosphere';
import { Avatar } from '../game/avatar';
import { lookFor } from '../game/look';
import { bodyOf, drawFar, type InfectedKind } from '../game/infected-kinds';
import { infectedMoves } from '../game/infected-moves';
import { infectedLook, sizeOf } from '../game/infected-look';
import { parting } from '../sim/infected';

/** what a body needs of the world's light: only that its patch is laid on (the sandbox has no fog, no hour) */
const bare = { register: (mat: THREE.Material, patch?: (s: never) => void) => (patch && (mat.onBeforeCompile = (s) => patch(s as never)), mat) } as unknown as Atmosphere;

export interface StagedInfected {
  root: THREE.Object3D;
  name: string;
  /** where it stands (the sandbox sets it, laying them in a line) */
  pos: THREE.Vector3;
  /** posed `t` seconds into the strip */
  at(t: number): void;
  /** turned to face that way (0 looks down -z) */
  face(yaw: number): void;
}

export async function stageInfected(q: URLSearchParams): Promise<StagedInfected[]> {
  const list = (k: string) => (q.get(k) ?? '').split(',').filter(Boolean);
  const kinds = list('infected') as InfectedKind[], nums = list('n').map(Number);
  const speed = +(q.get('speed') ?? 0), roused = +(q.get('roused') ?? 0), act = q.get('act'), fars = list('far');
  const out: StagedInfected[] = [];
  for (const [k, kind] of kinds.entries()) {
    const i = nums[k] ?? k + 1, body = new Avatar();
    body.zombieMoves = await infectedMoves(kind, i);
    body.zombieLook = infectedLook(kind, i);
    await body.load(bare, 0, false, lookFor(''), `zombie_${bodyOf(kind, i).body}`);
    body.sick = { roused, claw: -1, seed: (i * 7.31) % 20 };
    const [across, up] = sizeOf(kind, i);
    body.root.scale.set(across, up, across);
    drawFar(body.root, (fars[k] ?? fars[0]) === '1');
    // (facing the camera that looks at the line of them from in front: the game's bodies face -z)
    let yaw = Math.PI;
    const pos = new THREE.Vector3(), vel = new THREE.Vector3(0, 0, speed);
    let t = 0;
    const extra = act === 'eat' || act === 'scream' ? body.mixer.clipAction(body.zombieMoves.extras[act === 'eat' ? 'zEat' : 'zScream']) : null;
    if (extra) {
      extra.timeScale = 0;
      extra.setEffectiveWeight(0);
      extra.play();
    }
    const step = (dt: number) => {
      t += dt;
      if (extra) body.zombieAct = { a: extra, t: (act === 'scream' ? 0.35 : 0) + (t % extra.getClip().duration), k: Math.min(1, t / 0.25), legs: act === 'eat' ? 1 : 0 };
      body.root.position.copy(pos);
      body.update(dt, pos, dead ? vel.set(0, 0, 0) : vel, yaw, false, dead, false, 0, true, false);
    };
    const dead = /^fall/.test(act ?? '');
    if (act === 'claw') body.claw();
    if (act === 'hit' || act === 'hithead') body.hit(act === 'hithead');
    if (dead) body.setDeath(+act!.slice(4));
    step(0);
    out.push({
      root: body.root,
      name: `${bodyOf(kind, i).body} #${i}`,
      pos,
      at(want: number) {
        // (stepped to the moment at the game's own rate, a frame at a time; and posed where it was put, at its start)
        if (want <= t + 1e-4) step(0);
        while (t < want - 1e-4) step(Math.min(1 / 60, want - t));
      },
      face(to: number) {
        yaw = to;
        step(0);
      },
    });
  }
  return out;
}

/**
 * &round=1: they come at the survivor (at the middle of the floor) from its left, a little behind, all from nearly one
 * spot, as the game moves them: each in to arm's length (where its chase stops walking), and every two kept a body's
 * width apart by the game's own rule (`parting`, src/sim/infected.ts). Then each faces the survivor.
 */
export function gatherRound(staged: StagedInfected[]) {
  const at = staged.map((_, k) => ({ x: -2.2 - k * 0.05, z: -0.9 + (k - (staged.length - 1) / 2) * 0.1 }));
  for (let f = 0; f < 360; f++) {
    for (const p of at) {
      const d = Math.hypot(p.x, p.z);
      if (d > 1.0) (p.x -= (p.x / d) * 0.02), (p.z -= (p.z / d) * 0.02);
    }
    for (let a = 0; a < at.length; a++)
      for (let b = a + 1; b < at.length; b++) {
        const s = parting(at[a].x, at[a].z, a, at[b].x, at[b].z, b);
        if (!s) continue;
        at[a].x += s[0];
        at[a].z += s[1];
        at[b].x -= s[0];
        at[b].z -= s[1];
      }
  }
  for (const [k, s] of staged.entries()) {
    s.root.position.set(at[k].x, 0, at[k].z);
    s.pos.copy(s.root.position);
    s.face(Math.atan2(at[k].x, at[k].z));
  }
}
