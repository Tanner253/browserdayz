// What a survivor's body does besides stepping, on the same motion capture as its steps (src/game/avatar/gait.ts): how
// it goes down and how it takes a shot (in the body's own blend, in place of the old clips), and the things it does now
// and then, played over everything else: something picked up, a drink, a hatchet or a sledgehammer swung, a grenade
// thrown, a wall gone over, a ladder climbed, the water swum, a bedroll slept in. The everyday ones come with the body
// (moves.glb); the rest are fetched the first time any is wanted (moves-late.glb), and the body does without them till then.

import * as THREE from 'three';
import { assets } from '../../core/assets';
import TABLE from './moves.json';

type Row = { way?: string; dur: number; late?: boolean; rest?: number[]; rise?: number };
export const MOVES = TABLE as Record<string, Row>;

/** the old clips' deaths and flinches (DEATHS, `hit`, `hitHead` in pose.ts) -> the motion capture's */
export const MOCAP: Record<string, string> = { death: 'deathB', deathFront: 'deathF', deathSide: 'deathS', hit: 'hitBody', hitHead: 'hitHead' };

/** where a survivor lies once down, as DEATH_REST says it for the old falls (the infected's): from the motion capture's own */
export const MOCAP_REST = (['deathB', 'deathF', 'deathS'] as const).map((n) => (MOVES[n].rest ?? [0, 0]) as [number, number]);

/** a performance done once (the name of its movement) or kept up until told otherwise (`stay`) */
export type Deed = 'pickUp' | 'drink' | 'chop' | 'hammer' | 'throw' | 'vault' | 'jabR' | 'jabL';
export type Stay = 'ladder' | 'swim' | 'tread' | 'sleep';

let late: Promise<THREE.AnimationClip[]> | null = null;
const lateClips = () => (late ??= assets.loadGLTF('assets/characters/moves-late.glb').then((g) => g.animations));
let soon = false;
/** the late ones fetched a while after the first body is made, off the way in: the first grenade thrown is seen thrown */
export function lateSoon() {
  if (soon) return;
  soon = true;
  setTimeout(() => void lateClips().catch(() => (late = null)), 12000);
}

export class Deeds {
  private acts = new Map<string, THREE.AnimationAction>();
  private loading = false;
  constructor(private mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]) {
    for (const c of clips) if (MOVES[c.name] && !MOVES[c.name].way) this.add(c);
    lateSoon();
  }

  private add(c: THREE.AnimationClip) {
    const a = this.mixer.clipAction(c);
    // (scrubbed by hand, as every clip of the body is)
    a.timeScale = 0;
    a.setEffectiveWeight(0);
    a.play();
    this.acts.set(c.name, a);
  }

  /** the movement, made this body's own; a late one is sent for, and is null until it has come */
  get(name: string): THREE.AnimationAction | null {
    const a = this.acts.get(name);
    if (a || !MOVES[name]?.late) return a ?? null;
    if (!this.loading) {
      this.loading = true;
      void lateClips()
        .then((clips) => {
          for (const c of clips) if (!this.acts.has(c.name)) this.add(c);
        })
        .catch(() => (this.loading = false));
    }
    return null;
  }

  /** one of them in the body's own blend, at this weight and moment */
  set(name: string, weight: number, time: number) {
    const a = this.get(name);
    if (!a) return;
    a.setEffectiveWeight(weight);
    a.time = THREE.MathUtils.clamp(time, 0, a.getClip().duration - 1e-3);
  }

  /** none of them */
  mute() {
    for (const a of this.acts.values()) a.setEffectiveWeight(0);
  }
}
