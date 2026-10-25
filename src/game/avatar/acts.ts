// What the body is told to do: blows, flinches, deaths, gestures, emotes and the wheel's calls, lying, sitting, leaning; and a clip laid over the rest.
// (Methods of Avatar cut out of avatar.ts whole on 2026-10-24, so that they can be read and worked on alone: put back on
// Avatar.prototype as the file loads. Nothing in them was changed but `this: Avatar` said as the first parameter.)

import * as THREE from 'three';
import { POSE, DEATHS, type Gesture, type Move, type Hold, type SeatPose, type Clip, CLIPS } from './pose';
import { CUT, _a, _q1, _q2, _q3, emoteClips, type Avatar } from '../avatar';
import { DRAW } from '../melee/cuts';
import type { Cut } from '../held-mocap';
import { MOVES, type Deed, type Stay } from './deeds';

export const actsMethods = {
  /**
   * A blow. With something in the right hand it is swung, overhand; with nothing a punch is
   * thrown from a guard, left and right in turn.
   * @param overhand swing the empty arm all the same (a throw)
   * @param cut the captured blow it throws, where it has one (src/game/melee/cuts.ts)
   */
  swing(this: Avatar, overhand = false, seconds = 0.62, cut: Cut | null = null) {
    // (a survivor throws on the motion capture: from the arm drawn back, so the hand comes through as it lets go, a
    // sixth of a second on, which is when the game throws it)
    // (the arms and the chest: the captured throw goes down into a crouch that a body throwing standing does not)
    if (overhand && this.deeds && !this.held) return this.perform('throw', { from: 0.12, to: 0.5, dur: 0.8, legs: 0.25 });
    if (this.inHand && !overhand) {
      // something in the fist to strike with: its captured blow (melee/cuts.ts), done as any deed is, the hips with it
      // standing; or (none, or its movement not here yet) the library's
      const len = cut && this.deeds?.get(cut.clip) ? MOVES[cut.clip]?.dur : 0;
      if (cut && len) {
        this.perform(cut.clip as Deed, { from: cut.from / len, hit: cut.hit / len, to: cut.to / len, at: 0.35, dur: seconds, legs: 0.6 });
        this.strikeT = -1;
        return;
      }
      this.strikeT = 0;
      this.strikeDur = seconds;
      return;
    }
    if (overhand || this.held) {
      this.swingT = 0;
      return;
    }
    this.punchSide = -this.punchSide;
    this.punchT = 0;
    this.fistsHold = POSE.punch[1];
  },

  /**
   * Something done once on the motion capture, over whatever else the body is doing (a survivor's body only; the
   * infected and a body without it do nothing). `dur` stretches it to the time the game gives it; `legs` how much of
   * the lower body goes with it standing (none while walking: the legs go on walking).
   */
  perform(this: Avatar, name: Deed, o: { dur?: number; legs?: number; k?: number; from?: number; to?: number; hit?: number; at?: number; way?: 'draw' | 'stow' } = {}) {
    if (!this.deeds) return;
    this.deeds.get(name);
    const from = o.from ?? 0, to = o.to ?? 1;
    this.deed = { name, t: 0, dur: o.dur ?? (MOVES[name]?.dur ?? 1) * Math.abs(to - from), legs: o.legs ?? (name === 'drink' ? 0 : 1), k: o.k ?? 1, from, to, hit: o.hit, at: o.at, way: o.way };
  },

  /** Something long drawn off the back, or put away there (melee/cuts.ts DRAW). Whether it could be (its movement is here). */
  carry(this: Avatar, way: 'draw' | 'stow') {
    const d = DRAW[way], len = this.deeds?.get(d.clip) ? MOVES[d.clip]?.dur : 0;
    if (!len) return false;
    this.perform(d.clip as Deed, { from: d.from / len, hit: d.hit / len, to: d.to / len, at: DRAW.at, dur: DRAW.dur, legs: 0, way });
    return true;
  },

  /**
   * Something taken up (the act 'take', seen by everybody): bent right down for it, or a little toward somewhere
   * higher. Which is said by how long it takes, the one number an act carries: a short one is not off the ground.
   */
  pickUp(this: Avatar, dur = 1.4) {
    this.perform('pickUp', { dur, k: dur < 1.2 ? 0.45 : 1 });
  },

  /**
   * Kept up until told otherwise, the whole body: on a ladder, swimming, treading water, asleep in a bedroll. `rate`
   * how fast its movement plays (a ladder climbed faster or down: negative); null stops it.
   */
  setStay(this: Avatar, name: Stay | null, rate = 1) {
    if (!this.deeds) return;
    if (!name) this.stay = null;
    else if (this.stay?.name === name) this.stay.rate = rate;
    else {
      this.deeds.get(name);
      this.stay = { name, t: 0, rate };
    }
  },

  /** A shot or a blow landed: the body jolts (the head snaps back if that is where it landed). */
  hit(this: Avatar, head = false) {
    this.hitT = 0;
    this.hitClip = head ? 'hitHead' : 'hit';
  },

  /** The infected strike: both arms brought down on whoever is in front of them. */
  claw(this: Avatar) {
    if (this.sick) this.sick.claw = 0;
  },

  /** Which way it goes down the next time it dies: an index into DEATHS. */
  setDeath(this: Avatar, variant: number) {
    this.deathClip = DEATHS[((variant % DEATHS.length) + DEATHS.length) % DEATHS.length];
  },

  /** A body that was already lying there when we arrived: no fall to watch. */
  layDown(this: Avatar, variant = 0) {
    this.setDeath(variant);
    this.downT = 1e3;
  },

  /** The hands start on something: working the bolt, a reload, eating, dressing a wound. null stops it. */
  act(this: Avatar, kind: Gesture | null, dur = 1) {
    // (broken off, the hands are not put back where they were in one frame: see `stop`)
    if (kind) this.gesture = { kind, t: 0, dur };
    else if (this.gesture && this.gesture.stop === undefined) this.gesture.stop = this.gesture.t + CUT;
  },

  /** A call from the wheel: what the arms do with it (a wave, a point). null drops them. */
  emote(this: Avatar, kind: Move | null, dur = 1.5) {
    if (kind) this.move = { kind, t: 0, dur };
    else if (this.move && this.move.stop === undefined) this.move.stop = this.move.t + CUT;
  },

  /** Dancing, standing with the hands up, or neither. */
  /**
   * One of the emote pack's movements, danced (with setHold('dance')) in place of the body's own dance; null: the
   * body's own. Played once (`once`) it stops on its last moment and says so (emoteOver).
   */
  setClip(this: Avatar, id: string | null, once = false) {
    if ((this.emo?.id ?? null) === id) return;
    this.emo?.act?.setEffectiveWeight(0);
    this.emoteOver = false;
    this.emo = id ? { id, act: this.emoActs.get(id) ?? null, t: 0, once } : null;
  },

  /** the movement wanted, made an action of this body's own once the pack has come */
  loadEmote(this: Avatar, id: string) {
    this.emoLoading = true;
    void emoteClips()
      .then((lib) => {
        const clip = lib.get(id);
        if (!clip || !this.mixer) return;
        const a = this.mixer.clipAction(clip);
        // (scrubbed by hand, as every clip is: see update())
        a.timeScale = 0;
        a.setEffectiveWeight(0);
        a.play();
        this.emoActs.set(id, a);
        if (this.emo?.id === id) this.emo.act = a;
      })
      .catch(() => {})
      .finally(() => (this.emoLoading = false));
  },

  setHold(this: Avatar, hold: Hold | null) {
    this.hold = hold;
  },

  /**
   * Where the body is, in the world, as it stands this frame: the middle of the head, the
   * base of the neck and the hips. Whatever is to be hit is hung on these, so that a shot at
   * the head that is seen is a shot at the head that counts, whatever the body is doing.
   * @returns false until the body has been loaded
   */
  frame(this: Avatar, head: THREE.Vector3, neck: THREE.Vector3, pelvis: THREE.Vector3): boolean {
    const j = this.joints;
    if (!j.head || !j.neck || !j.pelvis) return false;
    j.head.updateWorldMatrix(true, false);
    // (the middle of the head as this body draws it; where that is not known, the joint is at the base of the skull
    // and the middle of the head is a hand's breadth up it)
    if (this.headMid) head.copy(this.headMid).applyMatrix4(j.head.matrixWorld);
    else head.setFromMatrixPosition(j.head.matrixWorld).addScaledVector(_a.setFromMatrixColumn(j.head.matrixWorld, 1).normalize(), 0.097);
    neck.setFromMatrixPosition(j.neck.matrixWorld);
    pelvis.setFromMatrixPosition(j.pelvis.matrixWorld);
    return true;
  },

  /** Lying down, or up again. */
  setProne(this: Avatar, on: boolean) {
    this.prone = on;
  },

  /** Sitting in a jeep's seat (whoever seats it puts it there and turns it with the jeep: see Garage.seatBody). */
  setSeat(this: Avatar, on: boolean, how: SeatPose | null = null) {
    this.seated = on;
    if (on) this.seatHow = how;
  },

  /** Leaning out to one side: -1 all the way left, 1 all the way right, 0 upright. */
  setLean(this: Avatar, lean: number) {
    this.leanT = THREE.MathUtils.clamp(lean, -1, 1);
  },

  /**
   * One clip at one moment, laid over the body as the others have left it: the chest, the
   * arms and the head take it (see LAID), and the legs go on with what they were doing.
   * @param legs 0..1: how far the hips and legs are given over to it as well (the whole body lunges)
   */
  layer(this: Avatar, clip: Clip | THREE.AnimationAction, time: number, weight: number, legs = 0) {
    if (weight <= 0.001) return;
    // (the clip alone on the skeleton the clips play on: the body's own, or a movement of the motion capture's)
    const own = typeof clip === 'string';
    for (const n of CLIPS) this.actions[n].setEffectiveWeight(n === clip ? 1 : 0);
    this.gait?.mute();
    this.deeds?.mute();
    if (own) this.actions[clip].time = THREE.MathUtils.clamp(time, 0, this.dur[clip] - 1e-3);
    else {
      clip.setEffectiveWeight(1);
      clip.time = THREE.MathUtils.clamp(time, 0, clip.getClip().duration - 1e-3);
    }
    this.mixer.update(0);
    // The clip turns its hips as it pleases (a blow is thrown side-on). When the hips are not
    // given over to it, the lowest bone that is has to end up facing the way the CLIP has it
    // face, not that way again from wherever these hips are: so that one is set by where it
    // points from the root, and the ones above it follow from there as the clip has them.
    let seam = legs < 0.999;
    for (const [from, to, share, low] of this.laid) {
      const k = weight * (low ? legs : Math.max(share, legs));
      if (k <= 0.001) continue;
      if (seam && !low) {
        seam = false;
        this.driverRoot.updateWorldMatrix(true, true);
        this.modelRoot.updateWorldMatrix(true, false);
        to.parent!.updateWorldMatrix(true, false);
        const want = this.driverRoot.getWorldQuaternion(_q1).invert().multiply(from.getWorldQuaternion(_q2));
        const have = this.modelRoot.getWorldQuaternion(_q3).invert().multiply(to.parent!.getWorldQuaternion(_q2));
        to.quaternion.slerp(have.invert().multiply(want), k);
        continue;
      }
      to.quaternion.slerp(from.quaternion, k);
      if (low === 2) to.position.lerp(from.position, k);
    }
  },

  /** Development: stand in one clip at one moment, nothing blended. */
  debugPose(this: Avatar, clip: Clip, time: number) {
    for (const n of CLIPS) {
      this.actions[n].setEffectiveWeight(n === clip ? 1 : 0);
      if (n === clip) this.actions[n].time = Math.min(this.dur[n] - 1e-3, time);
    }
    this.mixer.update(0);
    for (const [from, to] of this.drive) {
      to.position.copy(from.position);
      to.quaternion.copy(from.quaternion);
    }
  },

  clipLength(this: Avatar, clip: Clip) {
    return this.dur[clip];
  },
};
