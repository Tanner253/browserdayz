// A base's doors in the game (2026-10-24, base building's fourth step): F at one opens or shuts it, asked of the
// server online (server/doors.ts), done here by the same rules alone; its leaves swing in src/game/building/draw.ts.
// The owner: "airlock mechanics like rust has doors that swing open 1 way with collision".

import type * as THREE from 'three';
import { audio } from '../../core/audio';
import type { Input } from '../../core/input';
import { PIECES } from '../../sim/build/pieces';
import { toLocal, toWorld, type Base, type Piece } from '../../sim/build/snap';
import { inTheWay, middleOf, swings } from '../../sim/build/doors';
import type { Bases } from '../../sim/build/bases';
import type { C2S, S2C } from '../../net/protocol';
import type { BaseDraw } from './draw';

export interface DoorHost {
  input: Input;
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  me: () => THREE.Vector3;
  camera: () => THREE.Camera;
}

/** what a swinging kind is called to a player */
export const doorWord = (kind: string) => (PIECES[kind].fits === 'hatch' ? 'hatch' : PIECES[kind].fits === 'window' ? 'shutters' : kind.startsWith('gate_') ? 'gate' : 'door');

export class DoorView {
  constructor(private h: DoorHost, private store: () => Bases, private draw: BaseDraw) {
    draw.onSwing = (b, p, at) => {
      const d = at.distanceTo(h.camera().position), [x, y, z] = toWorld(b, ...middleOf(p));
      if (PIECES[p.k].only === 3 || PIECES[p.k].fits === 'hatch') audio.locker(!!p.open, { x, y, z }, d);
      else audio.door(!!p.open, { x, y, z }, d);
    };
  }

  /** a door looked at (`t`): what the corner says, and F swings it */
  frame(ok: boolean, t: { base: Base; id: number } | null): string | null {
    const p = t?.base.pieces.get(t.id);
    if (!t || !p || !swings(p.k)) return null;
    if (ok && this.h.input.pressed('KeyF')) this.toggle(t.base, p);
    return `<kbd>F</kbd>${p.open ? 'Close' : 'Open'} ${doorWord(p.k)}`;
  }

  private toggle(base: Base, p: Piece) {
    if (this.h.online()) return void this.h.send({ t: 'bdoor', b: base.id, p: p.id, open: !p.open });
    // (alone: the server's own rule, against the one body there is)
    const me = this.h.me(), [x, y, z] = toLocal(base, me.x, me.y, me.z);
    if (inTheWay(p, [{ x, y, z }])) return void this.h.note('Someone is in the way of it', 'warn');
    p.open = !p.open;
    this.draw.swing(base.id, p.id);
  }

  onDoor(m: Extract<S2C, { t: 'bdoor' }>) {
    const p = this.store().bases.get(m.b)?.pieces.get(m.p);
    if (!p) return;
    p.open = m.o === 1;
    this.draw.swing(m.b, m.p);
  }

  /** a knock: three raps, from the door */
  onKnock(m: Extract<S2C, { t: 'knock' }>) {
    const d = this.h.camera().position.distanceTo({ x: m.x, y: m.y, z: m.z } as THREE.Vector3);
    for (let i = 0; i < 3; i++) setTimeout(() => audio.impact(m.metal ? 'metal' : 'wood', { x: m.x, y: m.y, z: m.z }, d), i * 170);
  }
}
