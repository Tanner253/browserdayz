// The game: gutting and skinning an animal (2026-10-23). A body looked at from close by, a blade in the hands (DayZ),
// F, and six seconds kneeling at it; the server times it and lays what it gives on the ground by the body
// (server/animals.ts). Walk off, or put the blade away, and it is broken off.

import * as THREE from 'three';
import type { Game } from '../game';
import type { S2C } from '../../net/protocol';
import { BLADES, SKIN } from '../../sim/animals';

export const huntMethods = {
  /** looking at a body near enough to gut: what it says, and F begins it. True when there was one to say anything of. */
  skinPrompt(this: Game, cam: THREE.Camera, dir: THREE.Vector3): boolean {
    if (!this.online) return false;
    const b = this.wild.bodyAt(this.player.pos, SKIN.reach);
    if (!b) return false;
    const to = new THREE.Vector3(b.x, this.player.pos.y + 0.3, b.z).sub(cam.position).normalize();
    if (to.dot(dir) < 0.6) return false;
    const held = this.weapons.equippedItem?.id, blade = held ? BLADES[held] : undefined;
    if (!blade) {
      this.prompt = `<small>A dead ${b.name.toLowerCase()} · a knife, a machete or a hatchet in your hands to gut and skin it</small>`;
      return true;
    }
    this.prompt = this.use ? null : `<kbd>F</kbd>Gut and skin the ${b.name.toLowerCase()}`;
    if (!this.use && this.input.pressed('KeyF') && !this.hud.chatOpen) this.net.send({ t: 'askin', i: b.i, go: 1 });
    return true;
  },

  /** the server's word on gutting: begun (kneel for SKIN.time), refused, or done */
  onSkin(this: Game, m: Extract<S2C, { t: 'askin' }>) {
    if (m.done) {
      this.hud.note('Gutted and skinned: what it gave is on the ground by it', 'good');
      return;
    }
    if (!m.ok) {
      if (m.why) this.hud.note(m.why, 'warn');
      return;
    }
    const b = this.wild.beasts.get(m.i);
    if (!b || this.use) return;
    const held = this.weapons.equippedItem?.id;
    const near = () => !b.gone && Math.hypot(b.x - this.player.pos.x, b.z - this.player.pos.z) < SKIN.reach + 0.6 && this.weapons.equippedItem?.id === held;
    this.use = { label: `Gutting and skinning the ${b.name.toLowerCase()}`, t: 0, dur: SKIN.time, sound: null, soundT: 0, valid: near, lost: 'You stopped: the body is where you left it', done: () => {
      if (near()) this.net.send({ t: 'askin', i: m.i, go: 2 });
    } };
  },
};
