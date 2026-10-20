// A car's horn (H, held) and a police car's siren (J, on and off): the owner, 2026-10-14, "we need to add honking to
// the cars, and maybe a siren for the cop car, but siren not important definitley need honk". The one at the wheel
// sounds them, the server passes that on to everybody ('vhorn'), and every game sounds them where the car is.
import type * as THREE from 'three';
import { audio, sirenRecording, type HornVoice } from '../core/audio';
import { POLICE_CAR } from '../sim/vehicles';
import type { Jeep } from './vehicle';

/** how near the ears a car's or a helicopter's own sound is heard from the ears, metres (see Garage.heardAt) */
export const NEAR_EARS = 3;

/** somebody else's horn held longer than this is taken to have been let go (the word of it lost on the way), ms */
const HELD_MOST = 8000;
/** no horn or siren is sounded further off than this, metres */
const HEARD = 900;

type Said = { t: 'vhorn'; i: number; horn?: boolean; siren?: boolean };

export class Horns {
  /** the cars whose horn is down, and since when; and those whose siren is going */
  private horn = new Map<number, number>();
  private siren = new Set<number>();
  private voices = new Map<number, HornVoice>();
  /** the car this game's driver has the horn down in (-1: none) */
  private mine = -1;

  constructor(private jeeps: Map<number, Jeep>, private send: (m: Said) => void) {}

  /** what somebody else did, as the server says (or what is known of a car on arriving) */
  heard(i: number, horn?: boolean, siren?: boolean) {
    if (horn === true) this.horn.set(i, performance.now());
    else if (horn === false) this.horn.delete(i);
    if (siren === true) this.siren.add(i);
    else if (siren === false) this.siren.delete(i);
  }

  /** the driver's own keys, each step: `j` is the car this game's player is at the wheel of (null: none) */
  drive(j: Jeep | null, hornHeld: boolean, sirenPressed: boolean) {
    if (this.mine >= 0 && (!j || j.i !== this.mine || !hornHeld)) {
      this.horn.delete(this.mine);
      this.send({ t: 'vhorn', i: this.mine, horn: false });
      this.mine = -1;
    }
    if (!j || j.wreck) return;
    if (hornHeld && this.mine < 0) {
      this.mine = j.i;
      this.horn.set(j.i, performance.now());
      this.send({ t: 'vhorn', i: j.i, horn: true });
    }
    // (the siren's recording asked for once the wheel is taken, so that it is here when J is pressed)
    if (j.kind === POLICE_CAR.kind) void sirenRecording();
    if (sirenPressed && j.kind === POLICE_CAR.kind) {
      const on = !this.siren.has(j.i);
      this.heard(j.i, undefined, on);
      this.send({ t: 'vhorn', i: j.i, siren: on });
    }
  }

  /** each frame: every horn and siren sounding where its car is now */
  frame(listener: THREE.Vector3) {
    const now = performance.now();
    for (const [i, at] of this.horn) if (i !== this.mine && now - at > HELD_MOST) this.horn.delete(i);
    for (const [i, voice] of this.voices) {
      const j = this.jeeps.get(i);
      const horn = !!j && !j.wreck && this.horn.has(i), siren = !!j && !j.wreck && this.siren.has(i);
      if ((horn || siren) && j!.pos.distanceTo(listener) < HEARD) continue;
      voice.stop();
      this.voices.delete(i);
    }
    for (const i of new Set([...this.horn.keys(), ...this.siren])) {
      const j = this.jeeps.get(i);
      if (!j || j.wreck) {
        this.horn.delete(i);
        this.siren.delete(i);
        continue;
      }
      if (j.pos.distanceTo(listener) >= HEARD) continue;
      let voice = this.voices.get(i);
      if (!voice) {
        const made = audio.horn(j.kind === POLICE_CAR.kind);
        if (!made) continue;
        this.voices.set(i, (voice = made));
      }
      // (at the ears for whoever is in it or at it: see Garage.heardAt)
      voice.set(j.pos.distanceTo(listener) < NEAR_EARS ? listener : j.pos, this.horn.has(i), this.siren.has(i));
    }
  }
}
