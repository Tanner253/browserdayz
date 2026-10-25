// Ladders in the game (2026-10-24, base building's fourth step): a ladder leant on a wall, and the ladder under a hatch.
// Walked into, facing it, W climbs it (the body's own climbing is src/game/player.ts, climbStep); at its top, F climbs
// down it. Ladders stood one on another are climbed as one. Plan v2: "Ladder ... Leans on any wall. Raiders' ladders
// work anywhere too".

import type * as THREE from 'three';
import type { Input } from '../../core/input';
import { audio } from '../../core/audio';
import { shapeOf } from '../../sim/build/solids';
import { inBase } from '../../sim/build/doors';
import { toWorld, worldYaw } from '../../sim/build/snap';
import type { Bases } from '../../sim/build/bases';

/** a climbable line in the world: where it stands, the way out from its rungs to whoever climbs it, its foot and top */
interface Line {
  x: number;
  z: number;
  nx: number;
  nz: number;
  y0: number;
  y1: number;
}

export interface Climber {
  pos: THREE.Vector3;
  yaw: number;
  dead: boolean;
  climb: Line | null;
  hang: (x: number, y: number, z: number) => void;
}

const card = (head: string, keys: string, kbd?: string) => `<span class="bc">${kbd ? `<kbd>${kbd}</kbd>` : ''}<b>${head}</b><i>${keys}</i></span>`;

export class LadderView {
  private lines: Line[] = [];
  private t = 0;
  /** till the next creak of the rungs, s */
  private creakT = 0;

  constructor(private input: Input, private store: () => Bases, private body: () => Climber) {}

  /** the ladders near: every piece with a ladder's line, joined where one stands on another */
  private gather(at: THREE.Vector3) {
    const all: Line[] = [];
    for (const b of this.store().near(at.x, at.z, 30)) {
      for (const p of b.pieces.values()) {
        const c = shapeOf(p.k).climb;
        if (!c) continue;
        const [x, y, z] = toWorld(b, ...inBase(p, [c.x, 0, c.z]));
        const a = worldYaw(b, p.r), s = Math.sin(a), co = Math.cos(a);
        // (the way out, turned as the piece is: three.js's turn of (x, z) by `a`)
        const nx = c.out[0] * co + c.out[1] * s, nz = -c.out[0] * s + c.out[1] * co;
        all.push({ x, z, nx, nz, y0: y + c.y0, y1: y + c.y1 });
      }
    }
    all.sort((a, b) => a.y0 - b.y0);
    const out: Line[] = [];
    for (const l of all) {
      const under = out.find((o) => Math.hypot(o.x - l.x, o.z - l.z) < 0.05 && o.nx * l.nx + o.nz * l.nz > 0.99 && Math.abs(o.y1 - l.y0) < 0.1);
      if (under) under.y1 = l.y1;
      else out.push({ ...l });
    }
    this.lines = out;
  }

  /** each frame: on a ladder, what the keys do; at one, W into it climbs it, and at its top F climbs down */
  frame(dt: number, ok: boolean): string | null {
    const me = this.body();
    if (me.climb) {
      if (me.dead) me.climb = null;
      // (its rungs creak under a body going up or down them)
      if (me.climb && (this.input.held('KeyW') || this.input.held('KeyS')) && (this.creakT -= dt) <= 0) {
        this.creakT = 0.55 + Math.random() * 0.4;
        audio.built('creak', { x: me.pos.x, y: me.pos.y + 0.6, z: me.pos.z }, 0.7, 0.92 + Math.random() * 0.16);
      }
      return me.climb ? card('On the ladder', 'W up · S down · Space lets go') : null;
    }
    if ((this.t -= dt) <= 0) {
      this.t = 0.5;
      this.gather(me.pos);
    }
    if (!ok) return null;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    for (const l of this.lines) {
      const rx = me.pos.x - l.x, rz = me.pos.z - l.z, d = rx * l.nx + rz * l.nz, lat = Math.abs(rx * l.nz - rz * l.nx), feet = me.pos.y;
      // (in front of it, facing it: W climbs)
      if (lat < 0.45 && d > 0.05 && d < 0.95 && feet > l.y0 - 0.4 && feet < l.y1 - 0.3) {
        if (fx * -l.nx + fz * -l.nz > 0.4 && this.input.held('KeyW')) me.climb = { ...l };
        return null;
      }
      // (at its top, over it: F climbs down)
      if (lat < 0.6 && Math.abs(feet - l.y1) < 0.45 && d > -1.1 && d < 0.5) {
        if (this.input.pressed('KeyF')) {
          me.climb = { ...l };
          me.hang(l.x + l.nx * 0.5, l.y1 - 0.6, l.z + l.nz * 0.5);
        }
        return card('Climb down', 'the ladder', 'F');
      }
    }
    return null;
  }
}
