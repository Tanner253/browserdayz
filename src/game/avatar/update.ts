// Each frame: the clips blended by what the body is doing, and everything posed on top of them.
// (Methods of Avatar cut out of avatar.ts whole on 2026-10-24, so that they can be read and worked on alone: put back on
// Avatar.prototype as the file loads. Nothing in them was changed but `this: Avatar` said as the first parameter.)

import * as THREE from 'three';
import { stretch } from './gait';
import { MOCAP, MOVES } from './deeds';
import { slashAt } from '../held-mocap';
import type { HandGrip } from '../arms';
import { holdLeft, lookOverBody } from '../melee/body';
import { DRAW, GUARD } from '../melee/cuts';
import { POSE, type Clip, CLIPS, type Stride, STRIDES, SIT, PRONE, type Stance } from './pose';
import { CLAW, CLAW_HIT, CUT, FP_BACK, HOLD_GONE, SHOULDER, SICK_GAIT, THUMB_SEEN, UP, _X, _Z, _a, _aimQ, _b, _euler, _fwd, _head, _k1, _k2, _k3, _k4, _k5, _k6, _k7, _k8, _kq, _kr, _m1, _q1, _q2, _qa, _qb, _right, _slide, _v1, _v2, _w, settle, strikeAt, strikeShare, wrap, Avatar, type ArmRig } from '../avatar';

const _way = new THREE.Vector3();

export const updateMethods = {
  /**
   * @param firstPerson the body squares up to the look direction (it is what you see when you look down)
   * @param pitch aim pitch in radians: the chest and the held weapon follow it
   * @param grounded feet on the ground (false while jumping or falling)
   * @param aiming weapon up at the eye
   */
  update(this: Avatar, dt: number, pos: THREE.Vector3, velocity: THREE.Vector3, facingYaw: number, crouched: boolean, dead: boolean, firstPerson = false, pitch = 0, grounded = true, aiming = false) {
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    const speedNow = Math.hypot(velocity.x, velocity.z);
    this.speed += (speedNow - this.speed) * ease(12);
    const speed = this.speed;
    const armed = !!this.held;
    if (this.gesture) {
      this.gesture.t += dt;
      if (this.gesture.t >= Math.min(this.gesture.dur, this.gesture.stop ?? Infinity) || dead) this.gesture = null;
    }
    const ges = this.gesture;
    if (this.move) {
      this.move.t += dt;
      if (this.move.t >= Math.min(this.move.dur, this.move.stop ?? Infinity) || dead) this.move = null;
    }
    const mv = this.move;
    this.danceT += ((this.hold === 'dance' && !dead ? 1 : 0) - this.danceT) * ease(7);
    this.groundT += ((this.hold === 'sit' && !dead ? 1 : 0) - this.groundT) * ease(5);
    // Lying down is the movement made for it, at its own pace, from a crouch: from standing too (the owner, 2026-10-14:
    // "we should play the crouch to prone even if proning from standing"); getting up is the same, back. Moving the
    // while, it is hurried, so that a body is never drawn kneeling where the player already crawls or runs. `proneT`
    // is how far down it has come: what the place it lies at, the hands on a gun and the eyes go by.
    const lieEnd = this.dur.proneDown - 1e-3;
    if (!dead) this.lieT = this.prone ? Math.min(lieEnd, this.lieT + dt * (speedNow > 0.3 ? 2 : 1)) : Math.max(0, this.lieT - dt * (speedNow > 1 ? 3 : POSE.rise));
    this.proneT = dead ? this.proneT - this.proneT * ease(6) : THREE.MathUtils.smoothstep(this.lieT, POSE.lie[0], POSE.lie[1]);
    this.crawlK += ((this.prone && !dead && this.lieT >= lieEnd && speedNow > 0.15 ? 1 : 0) - this.crawlK) * ease(8);
    this.handsT += ((this.hold === 'surrender' && !dead ? 1 : 0) - this.handsT) * ease(9);
    // eating, drinking, dressing a wound, waving, dancing: whatever was in the hands is put away for it
    this.seatT += ((this.seated && !dead ? 1 : 0) - this.seatT) * ease(9);
    // (and sat in a jeep it is slung)
    const using = (!!ges && ges.kind !== 'bolt' && ges.kind !== 'reload' && ges.kind !== 'check') || !!mv || this.danceT > 0.25 || this.handsT > 0.25 || this.seatT > 0.25 || this.groundT > 0.25;
    // (the hands come off a gun and go back onto it over a fifth of a second, and one gun is lowered before the next is taken up)
    const busy = (!!ges && ges.kind !== 'bolt' && ges.kind !== 'reload' && ges.kind !== 'check') || !!mv || this.hold !== null || this.seated;
    const wantHold = !!this.held && !busy && !dead && !this.nextHeld;
    if (!this.placed) this.holdT = wantHold ? 1 : 0;
    else this.holdT += ((wantHold ? 1 : 0) - this.holdT) * ease(wantHold ? 11 : dead ? 26 : 16);
    if (this.nextHeld && this.holdT <= HOLD_GONE && this.deed?.way !== 'stow') {
      const n = this.nextHeld;
      this.nextHeld = null;
      this.takeUp(n.obj, n.grips, n.kind);
    }
    const hold = this.held && this.holdT > 0.004 ? this.holdT : 0;
    const held = hold ? this.held : null;
    /** how much of a movement of the hands is left, if it was broken off: 1 until then */
    const left = (m: { t: number; stop?: number } | null) => (m?.stop === undefined ? 1 : 1 - THREE.MathUtils.smoothstep(m.t, m.stop - CUT, m.stop));
    // fists come up for a punch and stay up a while after it; and on guard they are up, with whatever is in them
    this.fistsHold = Math.max(0, this.fistsHold - dt);
    // (with something in the fist, the guard is its parry: see BodyBlow.guard)
    const fists = ((this.fistsHold > 0 && !this.inHand) || (this.guarding && this.strikeT < 0 && !this.inHand)) && !dead && !armed && !using;
    this.fistsT += ((fists ? 1 : 0) - this.fistsT) * ease(fists ? 14 : 6);
    if (!fists) this.punchT = -1;
    // face the movement direction when running unarmed, else the look direction (a punch goes where the eyes do)
    // (a survivor on motion capture steps sideways and back facing the aim: only flat out does the body turn to the way it runs)
    const free = !firstPerson && !armed && !fists && (!this.gait || speedNow > 5.2);
    const velYaw = Math.atan2(-velocity.x, -velocity.z);
    const targetYaw = free && speedNow > 0.6 ? velYaw : facingYaw;
    if (this.placed) this.yaw += wrap(targetYaw - this.yaw) * ease(firstPerson ? 40 : armed ? 18 : 10);
    else this.yaw = targetYaw;
    this.placed = true;

    // --- which way the legs point. Squared up to the aim, walking sideways or backwards
    // would slide the feet across the ground: the hips turn toward the way of travel instead
    // (stepping in reverse when that is behind), and the spine turns the chest back.
    let twistTo = 0;
    let dirSign = 1;
    if (!free && !dead && speedNow > 0.4) {
      const rel = wrap(velYaw - this.yaw);
      const side = Math.abs(rel);
      if (this.backing ? side < 1.4 : side > 1.75) this.backing = !this.backing;
      twistTo = THREE.MathUtils.clamp(this.backing ? wrap(rel + Math.PI) : rel, -POSE.maxTwist, POSE.maxTwist) * Math.min(1, speedNow / 1.2);
      // (on motion capture the legs step the way they go, and are turned only for a gait drawn ahead alone: see Gait)
      if (this.gait && this.proneT < 0.5) twistTo = this.gait.twist;
      if (this.backing) dirSign = -1;
    } else this.backing = false;
    this.twist += (twistTo - this.twist) * ease(9);

    this.crouchT += ((crouched && !dead ? 1 : 0) - this.crouchT) * ease(10);
    this.airT += ((grounded || dead ? 0 : 1) - this.airT) * ease(9);
    this.moveT += (THREE.MathUtils.smoothstep(speed, 0.12, 0.8) - this.moveT) * ease(14);
    // (killed lying down, a body is down already: it does not stand up to fall)
    if (dead && this.downT === 0 && this.proneT > 0.5) {
      this.deathClip = 'deathFront';
      this.downT = this.dur.deathFront;
    }
    if (dead) this.downT = Math.min(this.dur[this.deathClip] - 1e-3, this.downT + dt * POSE.deathRate);
    else this.downT = 0;

    // --- how much of each clip
    const down = dead ? Math.min(1, this.downT / 0.15) : 0;
    // coming down from a jump or a drop, the knees give for a moment: a dip into the crouch
    const inAir = !grounded && !dead;
    if (this.wasAir && !inAir && this.airT > 0.45) {
      this.landT = 0;
      // a hop barely bends the knees; a drop from a roof folds the body right down
      this.landK = THREE.MathUtils.clamp(-this.fallV / 10, 0.28, 1);
    }
    this.fallV = inAir ? Math.min(this.fallV, velocity.y) : 0;
    // leaving the ground upward is a jump: it gets the push-off. Walking off an edge does not.
    // (Known by going up in the first moments off the ground, not on the first frame of it: another player's
    // rise comes smoothed and is not yet there on that frame, so their jumps never had the push-off.)
    this.airFor = inAir ? this.airFor + dt : 0;
    if (inAir && this.jumpT < 0 && this.airFor < 0.15 && velocity.y > 1.5) this.jumpT = 0;
    else if (!inAir) this.jumpT = -1;
    else if (this.jumpT >= 0) this.jumpT += dt;
    this.wasAir = inAir;
    let land = 0;
    if (this.landT >= 0) {
      this.landT += dt;
      if (this.landT > POSE.landing[1] || inAir) this.landT = -1;
      else land = POSE.landing[0] * this.landK * (1 - THREE.MathUtils.smoothstep(this.landT, POSE.landing[1] * 0.3, POSE.landing[1])) * (1 - down);
    }
    const bent = this.crouchT;
    const feet = (1 - this.airT) * (1 - down) * (1 - land);
    const stand = feet * (1 - bent);
    const duck = feet * bent;
    const air = this.airT * (1 - down) * (1 - land);
    const push = this.jumpT >= 0 ? 1 - THREE.MathUtils.smoothstep(this.jumpT, POSE.jump[1] * 0.4, POSE.jump[1]) : 0;
    const move = this.moveT;
    const runK = this.sick ? THREE.MathUtils.smoothstep(speed, SICK_GAIT.from, SICK_GAIT.to) : THREE.MathUtils.clamp((speed - POSE.walkTop) / (POSE.pace.run - POSE.walkTop), 0, 1);
    if (this.sick) this.sickRun += dt * THREE.MathUtils.clamp(speed / SICK_GAIT.pace, SICK_GAIT.give[0], SICK_GAIT.give[1]);
    let hit = 0;
    const hitLen = this.dur[this.hitClip];
    if (this.hitT >= 0) {
      this.hitT += dt;
      if (this.hitT >= hitLen) this.hitT = -1;
      else hit = POSE.flinch * Math.sin((Math.PI * this.hitT) / hitLen) * (1 - down);
    }
    const rest = 1 - hit;
    // the dance takes the place of standing and walking; nobody dances crouched or in the air
    const dn = this.danceT;
    const w: Record<Clip, number> = {
      idle: stand * (1 - move) * (1 - dn) * rest,
      walk: stand * move * (1 - runK) * (1 - dn) * rest,
      run: stand * move * runK * (1 - dn) * rest,
      dance: stand * dn * rest,
      crouchIdle: duck * (1 - move) * rest,
      crouchWalk: duck * move * rest,
      jumpStart: air * push * rest,
      jumpLoop: air * (1 - push) * rest,
      jumpLand: land * rest,
      death: 0,
      deathFront: 0,
      deathSide: 0,
      hit: this.hitClip === 'hit' ? hit : 0,
      hitHead: this.hitClip === 'hitHead' ? hit : 0,
      proneDown: 0,
      crawl: 0,
      sit: 0,
      armed: 0,
      strike: 0,
    };
    // sat down (in a seat, or on the ground), sitting is all of it but the flinch
    const st = Math.max(this.seatT, this.groundT) * (1 - down);
    if (st > 0) {
      for (const n of CLIPS) if (n !== 'hit' && n !== 'hitHead') w[n] *= 1 - st;
      w.sit = st * rest;
    }
    w[this.deathClip] = down;
    // lying down, alive: going down (its last moment is how the body lies) or crawling, and everything else gives way
    // to it, from the first moment of it (it begins in a crouch); `pr` is how far down the body is
    const pr = this.proneT * (1 - down), lying = Math.min(1, this.lieT / 0.15) * (1 - down);
    if (lying > 0.001) {
      for (const n of CLIPS) if (n !== 'hit' && n !== 'hitHead') w[n] *= 1 - lying;
      w.proneDown += lying * (1 - this.crawlK);
      w.crawl += lying * this.crawlK;
    }
    // (a survivor's steps are the motion capture's: its gait takes the walk's, the run's and the crouched walk's share)
    const gait = this.gait;
    if (gait) {
      gait.step(dt, speed, wrap(velYaw - this.yaw), w.walk + w.run, w.crouchWalk, hold, this.limpT);
      w.walk = w.run = w.crouchWalk = 0;
    }
    // (the crawl keeps time with the ground: a pull of the arms for so much of it, backwards when going backwards)
    const pulled = this.crawlAt;
    this.crawlAt = (((this.crawlAt + (dt * speedNow * dirSign) / POSE.crawlStride) % 1) + 1) % 1;
    this.pull = this.crawlK > 0.5 && speedNow > 0.15 && Math.floor(pulled * 2) !== Math.floor(this.crawlAt * 2);
    // --- and where in each. One stride clock for every stepping clip, so the same foot is
    // down in all of them and a blend of two is still a step.
    const rate: Record<Stride, number> = {
      walk: THREE.MathUtils.clamp(Math.min(speed, POSE.walkTop) / POSE.pace.walk, 0.6, 2.1),
      run: THREE.MathUtils.clamp(speed / POSE.pace.run, 1, 1.2),
      // (to 4.8: the hurried crouch is 3.3 m/s, and at 2.8 the legs crept at 1.9 under a body going nearly twice that)
      crouchWalk: THREE.MathUtils.clamp(speed / POSE.pace.crouchWalk, 0.6, 4.8),
    };
    let cadence = 0, stepping = 0;
    for (const n of STRIDES) {
      // (the infected's run keeps its own time: see SICK_GAIT)
      if (this.sick && n === 'run') continue;
      cadence += (w[n] * rate[n]) / this.dur[n];
      stepping += w[n];
    }
    // Twice a stride a foot comes down. Where in the stride that is moves with the pace, so
    // it is counted against where it is now: a change of pace that carries the place past the
    // legs is a foot landing too, and not one that goes unheard.
    let footfall = false;
    const plant = this.plantAt;
    if (stepping > 1e-3 && dirSign === this.dirWas) {
      const adv = (cadence / stepping) * dt * dirSign;
      this.phase = (((this.phase + adv) % 1) + 1) % 1;
      const at = this.halves + (adv - (plant - this.plantWas)) * 2;
      footfall = dirSign > 0 ? Math.floor(at) > Math.floor(this.halves) : Math.ceil(at) < Math.ceil(this.halves);
      this.halves = at;
    } else {
      // standing, in the air, or the legs have just turned to step the other way: count afresh
      if (stepping > 1e-3) this.phase = (((this.phase + (cadence / stepping) * dt * dirSign) % 1) + 1) % 1;
      this.halves = (this.phase - plant) * 2;
    }
    this.plantWas = plant;
    this.dirWas = dirSign;
    // (not two in a breath: the place moving the other way can bring the same foot past it twice)
    this.sinceStep += dt;
    this.footfall = footfall && stepping > 0.35 && speedNow > 0.5 && this.sinceStep > 0.25;
    if (gait) {
      this.phase = gait.phase;
      this.footfall = gait.footfall && this.sinceStep > 0.25;
    }
    if (this.footfall) this.sinceStep = 0;
    this.clock += dt;
    // (one of the pack's movements in place of the body's own dance, with all of the dance's weight: see setClip)
    const emo = this.emo;
    if (emo && this.mixer) {
      if (!emo.act && !this.emoLoading) this.loadEmote(emo.id);
      if (emo.act) {
        const len = emo.act.getClip().duration;
        emo.t += dt;
        if (emo.once && emo.t >= len) this.emoteOver = true;
        emo.act.time = emo.once ? Math.min(emo.t, len - 1e-3) : emo.t % len;
        emo.act.setEffectiveWeight(w.dance);
        w.dance = 0;
      }
    }
    for (const n of CLIPS) {
      const a = this.actions[n];
      a.setEffectiveWeight(w[n]);
      if (n === 'proneDown') a.time = this.lieT;
      else if (n === 'crawl') a.time = this.crawlAt * this.dur[n];
      else if (n === 'death' || n === 'deathFront' || n === 'deathSide') a.time = Math.min(this.downT, this.dur[n] - 1e-3);
      else if (n === 'hit' || n === 'hitHead') a.time = Math.min(Math.max(0, this.hitT), this.dur[n] - 1e-3);
      else if (n === 'jumpStart') a.time = Math.min(this.dur[n] - 1e-3, POSE.jump[0] + Math.max(0, this.jumpT));
      else if (n === 'jumpLand') a.time = Math.min(this.dur[n] - 1e-3, POSE.landFrom + Math.max(0, this.landT));
      else if (n === 'run' && this.sick) a.time = this.sickRun % this.dur[n];
      else if (n === 'walk' || n === 'run' || n === 'crouchWalk') a.time = ((this.phase + POSE.offset[n]) % 1) * this.dur[n];
      else a.time = this.clock % this.dur[n];
    }
    // (a survivor goes down and flinches on the motion capture: the old clips' weights handed to it)
    const deeds = this.deeds;
    if (deeds) {
      deeds.mute();
      const fall = MOCAP[this.deathClip], flinch = MOCAP[this.hitClip];
      if (w[this.deathClip] > 0) deeds.set(fall, w[this.deathClip], this.downT);
      if (w[this.hitClip] > 0) deeds.set(flinch, w[this.hitClip], this.hitT);
      // (and stands on it: see MOVES.idle)
      if (w.idle > 0) deeds.set('idle', w.idle, this.clock % MOVES.idle.dur);
      this.actions.idle.setEffectiveWeight(0);
      this.actions[this.deathClip].setEffectiveWeight(0);
      this.actions.hit.setEffectiveWeight(0);
      this.actions.hitHead.setEffectiveWeight(0);
    }
    this.mixer.update(0);
    for (const [from, to] of this.drive) {
      to.position.copy(from.position);
      to.quaternion.copy(from.quaternion);
    }
    // Sat on the ground. The library's sitting is on a chair: the legs are laid out straight in front instead of
    // going down to a floor that is not there, and the hips are let down to the ground (below, with the body's place).
    const onGround = this.groundT * (1 - down);
    // (and in a low car, the same: see CAR_SIT)
    const how = this.seatHow, inCar = how ? this.seatT * (1 - down) : 0;
    const legs = Math.max(onGround * SIT.legs, inCar * (how?.legs ?? 0));
    if (legs > 0.001) for (const [knee, straight] of this.knees) knee.quaternion.slerp(straight, legs);
    if (how && inCar > 0.001) {
      // (about the body's own line from side to side, wherever it has been turned: forward of it goes up, up goes back)
      settle(this.root);
      _right.setFromMatrixColumn(this.root.matrixWorld, 0).normalize();
      if (how.knees) for (const t of this.thighs) if (t) this.turn(t, _right, how.knees * inCar);
      if (how.back) {
        for (const b of this.spine) this.turn(b, _right, (how.back * inCar) / this.spine.length);
        // (and the head comes up again most of the way: the eyes are on the road, not the roof)
        for (const b of this.neck) this.turn(b, _right, (-how.back * 0.6 * inCar) / this.neck.length);
      }
    }

    // --- a blow with something in the fist, or one of the infected's: the library's drawing of one, laid over all that
    if (this.strikeT >= 0) {
      this.strikeT += dt;
      const u = this.strikeT / this.strikeDur;
      // (a survivor's on the motion capture: the slash, as the eye sees its own: see held-mocap.ts)
      const slash = deeds?.get('slash');
      if (u >= 1 || dead) this.strikeT = -1;
      else if (slash) this.layer(slash, slashAt(u), strikeShare(u));
      else this.layer('strike', strikeAt(u), strikeShare(u));
    }
    // (the guard with something in the fist: a moment of a movement held, laid as a blow is, and a blow thrown from it
    // goes over it; the fists' guard is the body's own, above)
    const guard = this.guarding && !!this.inHand && !dead && !using;
    this.guardK += ((guard ? 1 : 0) - this.guardK) * ease(guard ? 14 : 8);
    if (deeds && this.inHand && this.guardK > 0.01) {
      const g = GUARD[this.inHand.left ? 'two' : 'one'], a = deeds.get(g.clip);
      if (a) this.layer(a, g.at, this.guardK);
    }
    if (this.sick && this.sick.claw >= 0 && !dead) {
      // (it throws its whole body after its arm: the lunge is the clip's own)
      const u = this.sick.claw / CLAW;
      this.layer('strike', strikeAt(u, CLAW_HIT), strikeShare(u), 1);
    }
    // --- on the motion capture: what is kept up (a ladder, the water, a bedroll), the whole body; and what is done once
    // over it, the legs too while standing (a pick-up, a swing, a throw), the arms alone for a drink
    if (deeds) {
      this.stayT += ((this.stay && !dead ? 1 : 0) - this.stayT) * ease(this.stay ? 6 : 4);
      if (this.stay) {
        this.stay.t += dt * this.stay.rate;
        this.stayWas = this.stay.name;
      }
      const kept = this.stay?.name ?? this.stayWas, a = kept && this.stayT > 0.002 ? deeds.get(kept) : null;
      if (a) this.layer(a, ((((this.stay?.t ?? 0) % a.getClip().duration) + a.getClip().duration) % a.getClip().duration), this.stayT, 1);
      else if (!this.stay) this.stayWas = null;
      const d = this.deed;
      if (d) {
        d.t += dt;
        const act = deeds.get(d.name);
        if (d.t >= d.dur || dead) this.deed = null;
        else if (act) {
          const k = d.k * THREE.MathUtils.smoothstep(d.t, 0, Math.min(0.2, d.dur * 0.25)) * (1 - THREE.MathUtils.smoothstep(d.t, d.dur - Math.min(0.3, d.dur * 0.35), d.dur));
          // (evenly through it, or a blow: to the moment it lands in `at` of the time, the rest after)
          const s = d.t / d.dur, at = d.at ?? 0;
          const share = d.hit === undefined ? d.from + (d.to - d.from) * s : s < at ? d.from + ((d.hit - d.from) * s) / at : d.hit + ((d.to - d.hit) * (s - at)) / (1 - at);
          this.layer(act, share * act.getClip().duration, k, d.legs * (1 - this.moveT));
        }
      }
    }

    this.root.position.copy(pos);
    this.root.position.y -= SIT.drop * onGround;
    this.root.rotation.set(0, this.yaw + this.twist, 0);
    if (pr > 0.001) {
      // (the body lies forward of its feet: it is put back so that where the player is, is its chest)
      this.crawl += speed * dt * 2.4;
      const going = Math.min(1, speed / 0.5) * pr * (1 - this.crawlK);
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), back = (firstPerson ? PRONE.backOwn : PRONE.back) * pr;
      this.root.position.x += sy * back;
      this.root.position.z += cy * back;
      // It lies ON the ground, and to the ground: its feet on the ground where they are, its head on the ground
      // where that is, tipped to one side as the ground is. (Laid level at the height of the middle of it, on a
      // hillside one end of it was under the grass and the other in the air.) Under a roof, on a floor that is
      // not the ground's, a floor is level.
      let tip = 0, roll = 0;
      const G = Avatar.ground;
      if (G && Math.abs(G(pos.x, pos.z) - pos.y) < 0.3) {
        const x = this.root.position.x, z = this.root.position.z, feet = G(x, z);
        tip = Math.atan2(G(x - sy * 1.6, z - cy * 1.6) - feet, 1.6);
        const mx = x - sy * 0.9, mz = z - cy * 0.9;
        roll = Math.atan2(G(mx + cy * 0.3, mz - sy * 0.3) - G(mx - cy * 0.3, mz + sy * 0.3), 0.6);
        this.root.position.y += (feet - this.root.position.y) * pr;
      }
      this.root.position.y += PRONE.up * pr;
      this.root.rotation.set(tip * pr, this.yaw + this.twist + Math.sin(this.crawl) * 0.05 * going, roll * pr);
    }
    if (this.dive) this.root.rotation.x = this.dive;
    // (the steps stretched to the pace the body goes at: see Gait's warp. Not past 60 m: a foot that slides is not seen there)
    if (gait && gait.share > 0.02 && Math.abs(gait.warp - 1) > 0.03 && !dead && pr < 0.01 && speedNow > 0.3 && this.joints.pelvis && pos.distanceToSquared(Avatar.eye) < 3600) {
      settle(this.root);
      stretch(this.legs, this.joints.pelvis, _way.set(velocity.x, 0, velocity.z).normalize(), 1 + (gait.warp - 1) * Math.min(1, gait.share) * (1 - this.airT));
    }
    this.heldPivot.visible = !dead && hold > 0.1;
    // (and what is in the fist is put away as a gun is, while the hands are at something else)
    // (a long thing being drawn is out of sight till the hand closes on it behind the shoulder, and put away from when it lets go)
    const way = this.deed?.way, wayU = way ? this.deed!.t / this.deed!.dur : 0;
    if (this.inHand) this.inHand.obj.visible = !using && !(way && (way === 'draw' ? wayU < DRAW.at : wayU >= DRAW.at));
    this.heldPivot.rotation.set(pitch, -this.twist, 0);
    this.aimT += ((aiming && !dead ? 1 : 0) - this.aimT) * ease(12);
    this.carryT += (THREE.MathUtils.smoothstep(speed, 2.6, 3.6) * (1 - this.aimT) - this.carryT) * ease(7);
    const carry = this.carryT * (1 - this.aimT);

    // Dying, what is laid over the clips goes as the clips go: the turn of the waist, the lean, the look up or
    // down and the arms on a gun are let go over the tenth of a second the fall takes to come in. (They were all
    // dropped on the first frame of it, while the body was still nine tenths standing.)
    const alive = 1 - down, gone = dead && alive < 0.001;
    const lean = !gone && (held || Math.abs(pitch) > 0.02);
    const lift = POSE.crouchLift * this.crouchT * alive;
    const over = gone ? 0 : this.leanT * alive;
    // (leaning, the hips go a little the same way: the head ends up where the eyes of whoever is leaning are)
    if (over) this.root.position.addScaledVector(_right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), over * POSE.leanHips);
    if (!gone && (lean || Math.abs(this.twist) > 0.003 || Math.abs(lift) > 0.003 || Math.abs(over) > 0.003 || pr > 0.003)) {
      settle(this.root);
      // the legs have turned; from the waist up the body still faces the aim
      const n = this.spine.length;
      const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
      _right.set(1, 0, 0).applyQuaternion(aimQ);
      // a long gun is held across the body: chest turned off the aim, left shoulder leading,
      // the head still looking down the barrel
      // (and square again for a run, the gun carried across the chest)
      // (aimed, a gun with a butt has the chest come round to it a little: see POSE.hold.cheek)
      const weld = held?.butt ? this.aimT * (1 - pr) : 0;
      const blade = held?.long ? THREE.MathUtils.lerp(POSE.hold.blade, POSE.hold.bladeAim, weld) * (1 - carry) * hold : 0;
      // (the legs' turn and the blade are two turns of the one waist: together they are no more than it can turn.
      // Stepping one way with a long gun they came to 120 degrees.)
      const waist = THREE.MathUtils.clamp(-this.twist - blade, -POSE.maxTwist, POSE.maxTwist) * alive;
      const bladed = (-waist - this.twist) * alive;
      _fwd.set(0, 0, -1).applyQuaternion(aimQ);
      for (const b of this.spine) {
        this.turn(b, UP, waist / n);
        if (lift) this.turn(b, _right, lift / n);
        // leaning out: over from the waist, about the line the body is facing along
        if (over) this.turn(b, _fwd, (over * POSE.leanAngle) / n);
      }
      // (the head stays level: it is the eyes that are being put round the corner)
      if (over) for (const b of this.neck) this.turn(b, _fwd, (-over * POSE.leanAngle * 0.55) / this.neck.length);
      if (Math.abs(bladed) > 1e-4) for (const b of this.neck) this.turn(b, UP, bladed / this.neck.length);
      // Aiming a long gun, the head goes to the gun: the chest leant in, the neck craned toward the stock, the
      // head tipped to it and down, as somebody lining up sights. Less of it under a visor that is down.
      const welded = weld * hold * (1 - carry) * alive;
      if (welded > 0.002 && this.neck.length && held && this.armR) {
        const c = POSE.hold.cheek, g = this.faceGear(), k = welded * (g.under !== null ? c.visored : 1), neck = this.neck[0];
        // The upper body leans into the gun: the chest in and over toward it, the firing shoulder rolled forward
        // and hunched up to the butt.
        if (this.chest) this.turn(this.chest, _right, -c.lean * welded);
        this.turn(this.spine[this.spine.length - 1], _fwd, c.tilt * k * c.body);
        if (this.collarR) {
          this.turn(this.collarR, UP, POSE.hold.reachRight * welded);
          this.turn(this.collarR, _fwd, -c.shrug * welded);
        }
        // The head is laid over onto the stock and nodded,
        for (const b of this.neck) this.turn(b, _fwd, (c.tilt * k * (1 - c.body)) / this.neck.length);
        this.turn(this.neck[this.neck.length - 1], _right, -c.nod * k);
        // and the neck is craned to the gun: toward it, forward, and down until the eye is level with the sights
        // (the butt is where the shoulder will hold it: see the hold, below).
        const chest = this.gearRest.get('spine_03'), face = this.gearRest.get('Head');
        if (neck.parent && chest && face) {
          chest.bone.updateWorldMatrix(true, false);
          face.bone.updateWorldMatrix(true, false);
          const up = _k7.set(0, 1, 0).applyQuaternion(this.heldPivot.getWorldQuaternion(_kr)), a = POSE.hold.butt.aim;
          const butt = this.armR.arm.getWorldPosition(_k8).add(_k6.set(a[0], a[1], a[2]).applyQuaternion(_kr.setFromRotationMatrix(_m1.multiplyMatrices(chest.bone.matrixWorld, chest.inv))));
          _m1.multiplyMatrices(face.bone.matrixWorld, face.inv);
          let over = _k6.set(c.eye[0], c.eye[1], c.eye[2]).applyMatrix4(_m1).sub(butt).dot(up) - held.sight[1];
          // (under a visor that is down, only until its lower edge is on the top of the stock)
          if (g.under !== null) over = Math.min(over, _k6.set(c.plate, g.under, -0.1).applyMatrix4(_m1).sub(butt).dot(up) - held.sight[0] - 0.006);
          neck.getWorldPosition(_k6).addScaledVector(_right, c.crane[0] * k).addScaledVector(_fwd, c.crane[1] * k).addScaledVector(up, -THREE.MathUtils.clamp(over, 0, c.drop) * welded);
          neck.position.copy(neck.parent.worldToLocal(_k6));
          settle(neck);
        }
      }
      // Aiming a pistol, the head goes to the sights the same way, without a stock to lay it on: forward and down.
      const sighted = held && !held.long ? this.aimT * (1 - pr) * hold * (1 - carry) * alive : 0;
      if (sighted > 0.002 && this.neck.length) {
        const c = POSE.hold.sighted, neck = this.neck[0];
        if (this.chest) this.turn(this.chest, _right, -c.lean * sighted);
        this.turn(this.neck[this.neck.length - 1], _right, -c.nod * sighted);
        if (neck.parent) {
          neck.getWorldPosition(_k6).addScaledVector(_fwd, c.forward * sighted).addScaledVector(UP, -c.down * sighted);
          neck.position.copy(neck.parent.worldToLocal(_k6));
          settle(neck);
        }
      }
      if (pr > 0.003) {
        // lying: the chest a little up on the elbows and the head up off the ground, the eyes on what is ahead;
        // and crawling, one knee and then the other drawn out to the side
        if (this.chest) this.turn(this.chest, _right, PRONE.chest * pr);
        for (const b of this.neck) this.turn(b, _right, (PRONE.head * pr) / this.neck.length);
        const pull = Math.sin(this.crawl) * PRONE.knee * Math.min(1, speed / 0.5) * pr * (1 - this.crawlK);
        if (this.thighs[0] && pull > 0) this.turn(this.thighs[0], UP, pull);
        if (this.thighs[1] && pull < 0) this.turn(this.thighs[1], UP, pull);
      }
      if (lean) {
        // (lying, the chest is on the ground and stays there: the head does all of the looking up and down, as far as
        // a neck goes, so that somebody prone is seen to look where they look)
        if (this.chest) this.turn(this.chest, _right, pitch * 0.45 * alive * (1 - pr));
        // and the head goes the rest of the way: you can see where somebody is looking
        const look = THREE.MathUtils.lerp(pitch * POSE.headPitch, THREE.MathUtils.clamp(pitch * 0.85, -0.5, 0.6), pr);
        for (const b of this.neck) this.turn(b, _right, (look * alive) / this.neck.length);
        if (held && this.armR && this.armL) {
          // The weapon hangs from the shoulders, wherever the clips have taken them: down
          // into a crouch, up and down with each stride.
          const mid = this.armL.arm.getWorldPosition(_a).add(this.armR.arm.getWorldPosition(_b)).multiplyScalar(0.5);
          this.root.worldToLocal(mid);
          // (lying, it is held out in front of the shoulders and a little over them, not hung below them)
          this.heldPivot.position.copy(_b.set(0, THREE.MathUtils.lerp(POSE.hold.pivot[0], PRONE.pivot[0], pr), THREE.MathUtils.lerp(POSE.hold.pivot[1], PRONE.pivot[1], pr)).applyAxisAngle(UP, -this.twist)).add(mid);
          // Aimed, the sights come up to the eye, and the stances say where that is from the
          // shoulders of somebody standing: the head a hand and a half above them. Crouched,
          // the back is bent, and the head is forward of the shoulders and hardly above them:
          // the gun was held a hand's breadth over the top of it. It goes where the head has gone.
          if (this.joints.head && this.aimT > 0.001) {
            const head = this.root.worldToLocal(this.joints.head.getWorldPosition(_w));
            this.heldPivot.position.y += (head.y - mid.y - POSE.hold.eye[0]) * this.aimT;
            this.heldPivot.position.z += (head.z - mid.z - POSE.hold.eye[1]) * this.aimT;
          }
          const { obj, grips, long, base } = held;
          const kind = long ? POSE.hold.long : POSE.hold.pistol;
          // (a gun with a way of its own of being stood with, or carried at a run: a submachine gun out in front of the chest; that or a pistol muzzle up in the gun hand)
          const set = grips.stand ? { ...kind, ...grips.stand } : kind;
          const carried: Stance = grips.carry ?? set.carry;
          const wAim = this.aimT, wReady = 1 - wAim - carry;
          const turned = (s: Stance, q: THREE.Quaternion) => q.setFromEuler(_euler.set(s.r[0], s.r[1], s.r[2], 'YXZ'));
          // A long gun with a stock is held by its butt (see POSE.hold.butt): in the pocket of the right shoulder,
          // wherever the chest has taken that. Its muzzle is dipped at the ready; less the further down the eyes
          // already are, and not at all lying down (it would be in the ground).
          const butt = held.butt, chest = butt && this.gearRest.get('spine_03');
          const level = (1 - pr) * THREE.MathUtils.clamp(1 + Math.min(0, pitch) / 0.8, 0, 1);
          const ready: Stance = chest ? { p: set.ready.p, r: [set.ready.r[0] * level, set.ready.r[1] * level, set.ready.r[2]] } : set.ready;
          if (butt && chest) {
            this.heldPivot.updateWorldMatrix(false, false);
            chest.bone.updateWorldMatrix(true, false);
            _kq.setFromRotationMatrix(_m1.multiplyMatrices(chest.bone.matrixWorld, chest.inv));
            this.armR.arm.getWorldPosition(_k1);
          }
          /** where a stance puts the gun's own origin, from the pivot: by its butt if it has one (at `world`, if that is said), by `p` if not */
          const put = (s: Stance, to: [number, number, number] | null, at: THREE.Vector3, world?: THREE.Vector3) => {
            if (!butt || !chest || !to) return at.set(s.p[0], s.p[1], s.p[2]);
            const lie = POSE.hold.butt.prone;
            if (world) at.copy(world);
            else at.set(to[0] + (lie[0] - to[0]) * pr, to[1] + (lie[1] - to[1]) * pr, to[2] + (lie[2] - to[2]) * pr).applyQuaternion(_kq).add(_k1);
            return this.heldPivot.worldToLocal(at).sub(_k2.copy(butt).multiply(obj.scale).applyQuaternion(turned(s, _kr).multiply(base)));
          };
          put(ready, POSE.hold.butt.ready, _k3);
          put(set.aim, POSE.hold.butt.aim, _k4);
          const face = butt && chest && wAim > 0.001 && pr < 0.999 ? this.gearRest.get('Head') : undefined;
          if (face && chest) {
            // Aimed, the gun is put under the eye: its butt at the height the shoulder holds it at (or as high as
            // a stock passes under what is worn in front of the cheek, if that is lower), in line with the right
            // eye, which the head has been brought down and over to it for, and back along the aim to the chest's
            // front, where the butt rests.
            // (Worked in the aim's own frame, the pivot's: x to the aim's right, y up, z back. The gun stands
            // upright in that; the head is tipped in it.)
            const c = POSE.hold.cheek, g = this.faceGear(), [half, rise] = held.sight;
            face.bone.updateWorldMatrix(true, false);
            chest.bone.updateWorldMatrix(true, false);
            _m1.multiplyMatrices(face.bone.matrixWorld, face.inv);
            const eye = this.heldPivot.worldToLocal(_k6.set(c.eye[0], c.eye[1], c.eye[2]).applyMatrix4(_m1));
            const a = POSE.hold.butt.aim, high = this.heldPivot.worldToLocal(_k7.set(a[0], a[1], a[2]).applyQuaternion(_kq).add(_k1)).y;
            const mid = this.heldPivot.worldToLocal(face.bone.getWorldPosition(_k7));
            const out = Math.max(g.under !== null ? c.plate : c.jaw, g.cheek ? g.cheek + c.beside : 0);
            const line = _k8.set(Math.max(eye.x + c.x, mid.x + out), Math.min(high, eye.y - rise), eye.z), eyeY = eye.y;
            // (under a visor: no higher than its lower edge lets the top of the butt pass, where the gun's line is)
            if (g.under !== null) line.y = Math.min(line.y, this.heldPivot.worldToLocal(_k6.set(line.x - mid.x, g.under, -0.1).applyMatrix4(_m1)).y - half - 0.006);
            // and back along the aim to the chest's front, where the butt rests
            const front = _k6.set(0, 0, -1).applyQuaternion(_kq).applyQuaternion(this.heldPivot.getWorldQuaternion(_kr).invert());
            // (a butt held lower than the collar bone, under a visor, rests further down the chest, which stands further forward there)
            const lower = Math.max(0, eyeY - line.y - 0.1) * c.slope;
            const chestAt = this.heldPivot.worldToLocal(_k7.set(0, 1.45, -c.front - lower).applyMatrix4(_m1.multiplyMatrices(chest.bone.matrixWorld, chest.inv)));
            line.z += chestAt.sub(line).dot(front) / Math.min(-0.3, front.z);
            _k4.lerp(put(set.aim, POSE.hold.butt.aim, _k7, this.heldPivot.localToWorld(line)), 1 - pr);
          }
          obj.position.set(0, 0, 0).addScaledVector(_k3, wReady).addScaledVector(_k5.set(carried.p[0], carried.p[1], carried.p[2]), carry).addScaledVector(_k4, wAim);
          turned(ready, _qa);
          if (carry > 0.001) _qa.slerp(turned(carried, _qb), carry / Math.max(1e-4, 1 - wAim));
          if (wAim > 0.001) _qa.slerp(turned(set.aim, _qb), wAim);
          if (hold < 1) {
            // being put away, or taken up: down toward the belt, its muzzle tipped to the ground
            const away = 1 - THREE.MathUtils.smoothstep(hold, 0, 1);
            obj.position.y -= 0.24 * away;
            obj.position.z += 0.1 * away;
            _qa.multiply(_qb.setFromAxisAngle(_X, -0.7 * away));
          }
          obj.quaternion.copy(_qa).multiply(base);
          // the hands at work on the weapon (grip points are in its own space: x toward the muzzle, y up)
          let gripR = grips.right, gripL = grips.left;
          if (ges) {
            const k = ges.t / ges.dur;
            const sm = (a: number, b: number) => THREE.MathUtils.smoothstep(k, a, b);
            const live = left(ges);
            const work = grips.work;
            if (ges.kind === 'check') {
              // Looked over: brought up in front of the chest with its muzzle lifted, turned over to show one side
              // and then the other, and let back down. Both hands stay on it and turn with it.
              const up = sm(0, 0.14) * (1 - sm(0.86, 1)) * live;
              const over = (sm(0.14, 0.32) - sm(0.42, 0.66) * 2 + sm(0.74, 0.88)) * live;
              obj.position.y += 0.07 * up;
              obj.position.z += 0.04 * up;
              obj.quaternion.multiply(_q1.setFromAxisAngle(_Z, 0.45 * up)).multiply(_q2.setFromAxisAngle(_X, 0.85 * over));
            } else if (long && ges.kind === 'bolt' && gripR && work?.bolt) {
              // The right hand leaves the grip for the bolt handle: up with it, back, home, and down. The rifle
              // rolls a little to meet the hand. (It was sent to where the old rifle's bolt was, which on these
              // is further up the gun than the arm is long: the arm went out straight and stopped there.)
              const off = sm(0, 0.16) * (1 - sm(0.84, 1)) * live;
              const lift = sm(0.16, 0.3) - sm(0.7, 0.84), back = sm(0.3, 0.48) - sm(0.52, 0.7);
              gripR = { ...gripR, pos: gripR.pos.clone().lerp(_w.copy(work.bolt).add(_v1.set(-0.085 * back, 0.03 * lift, -0.012 * lift)), off) };
              obj.quaternion.multiply(_q1.setFromAxisAngle(_X, 0.2 * off));
            } else if (long && ges.kind === 'reload' && gripL && work?.feed) {
              // The forward hand leaves the fore-end to feed the gun, and the gun is rolled over to it.
              const t = ges.t, end = ges.dur;
              let at: number;
              if (work.tube) {
                // a shell at a time into the tube: the hand in under the port as each goes home, and away for the next
                at = THREE.MathUtils.smoothstep(t, 0.08, 0.5) * (1 - THREE.MathUtils.smoothstep(t, end - 0.5, end - 0.08));
                // (in, and away between shells only while there are shells going in: eased, at both ends of the loading)
                const fed = THREE.MathUtils.smoothstep(t, 0.3, 0.55) * (1 - THREE.MathUtils.smoothstep(t, end - 0.67, end - 0.42));
                const push = 1 - fed * (0.5 - 0.5 * Math.cos(((t - 0.55) / 0.48) * Math.PI * 2));
                _w.copy(work.feed).add(_v1.set(0.035 * push - 0.03 * (1 - push), 0.02 * push - 0.075 * (1 - push), -0.035 * (1 - push)));
              } else {
                // a magazine: the hand to it, down and away with the old one to the belt, back up with the new, and home
                at = sm(0.06, 0.24) * (1 - sm(0.8, 0.97));
                const away = sm(0.28, 0.42) * (1 - sm(0.48, 0.62));
                _w.copy(work.feed).add(_v1.set(-0.06 * away, -0.26 * away, -0.07 * away));
              }
              at *= live;
              gripL = { ...gripL, pos: gripL.pos.clone().lerp(_w, at) };
              obj.quaternion.multiply(_q1.setFromAxisAngle(_X, (work.tube ? 0.34 : 0.18) * at));
            } else if (!long && gripL) {
              // a fresh magazine: the left hand goes down to the belt for it and comes back up under the grip
              // (to the belt at its own side: 30 cm straight down from the gun is further than the arm is long, and
              // the way there is through the ribs)
              const away = sm(0.1, 0.32) * (1 - sm(0.5, 0.78)) * live;
              gripL = { ...gripL, pos: gripL.pos.clone().add(_w.set(-0.05 * away, -0.19 * away, -0.13 * away)) };
              obj.quaternion.multiply(_q1.setFromAxisAngle(_X, -0.3 * sm(0, 0.15) * (1 - sm(0.8, 1)) * live));
            }
          }
          this.heldPivot.updateMatrixWorld(true);
          // (both shoulders drawn a little forward to a pistol held out in front, as shoulders are when the arms reach
          // ahead of the chest: without it, from behind, the arms went in front of a back as narrow as the chest, and
          // the shoulders looked pinched; see GUN_ELBOW.pistolR)
          if (!long) {
            if (this.collarL) this.turn(this.collarL, UP, -POSE.hold.protract * hold);
            if (this.collarR) this.turn(this.collarR, UP, POSE.hold.protract * hold);
          }
          // the leading shoulder comes forward to the gun
          if (blade && this.collarL) this.turn(this.collarL, UP, -THREE.MathUtils.lerp(POSE.hold.reach, POSE.hold.reachAim, weld) * (1 - carry) * hold);
          // A gun is held no further out than the hands that hold it can reach. The stances are said from the
          // shoulders of a body standing still; crouched, in the air, looking down and at a run the shoulders are
          // somewhere else, and a hand sent past the end of its arm stops short of the gun: a pistol was left 2 to
          // 12 cm out in front of the fists. It is brought in toward the shoulders until both hands of a pistol, and
          // the gun hand of a long gun (whose other hand slides), are on it with a bend left in the elbow.
          for (let pass = 0; pass < 3; pass++) {
            const far = (grip: HandGrip | null, r: ArmRig) => (grip ? _a.copy(grip.pos).applyMatrix4(obj.matrixWorld).distanceTo(r.arm.getWorldPosition(_b)) - (r.la + r.lb) * POSE.hold.within : 0);
            // (and of a long gun, its forward hand too, by up to 15 cm: the hand on the fore-end, not slid back to the magazine)
            const over = Math.max(far(grips.right, this.armR), long ? Math.min(0.15, far(gripL, this.armL)) : far(grips.left, this.armL));
            if (over <= 0.001) break;
            const back = this.armL.arm.getWorldPosition(_a).add(this.armR.arm.getWorldPosition(_b)).multiplyScalar(0.5).sub(obj.getWorldPosition(_w));
            // (aimed, hardly downward at all: the sights stay at the eye)
            back.y *= 1 - 0.8 * this.aimT;
            this.heldPivot.position.add(back.normalize().multiplyScalar(Math.min(0.1, over * 1.2)).applyQuaternion(_q1.copy(this.root.quaternion).invert()));
            this.heldPivot.updateMatrixWorld(true);
          }
          if (gripR) this.solveArm(this.armR, gripR, obj, aimQ, undefined, hold);
          // the forward hand may sit further back along the stock than the first-person arms
          // have it: these arms are only so long
          // (a gun carried in the one hand at a run: the other is let go of it by as much as it is carried so, and swings as the body runs)
          if (gripL) this.solveArm(this.armL, gripL, obj, aimQ, gripR && !(ges && !long) ? _slide.set(0, 0, 1).applyQuaternion(_qa).applyQuaternion(this.heldPivot.getWorldQuaternion(_q1)) : undefined, hold * (grips.carry?.free ? 1 - carry : 1));
        }
      }
    }

    // --- the right arm on its own: a blow, and the fist closed round a handle
    if (!dead && this.armR && (this.swingT >= 0 || this.inHand)) {
      const r = this.armR;
      if (this.swingT >= 0) {
        this.swingT += dt;
        const u = this.swingT / POSE.swing;
        if (u >= 1) this.swingT = -1;
        else {
          // wound up behind the shoulder, then brought down across the body
          const wind = Math.sin(Math.PI * Math.min(1, u / 0.4)) * (u < 0.4 ? 1 : 0), strike = THREE.MathUtils.smoothstep(u, 0.3, 0.6) * (1 - THREE.MathUtils.smoothstep(u, 0.7, 1));
          settle(this.root);
          _right.set(1, 0, 0).applyQuaternion(_aimQ.setFromAxisAngle(UP, this.yaw));
          this.turn(r.arm, _right, 1.5 * wind + 0.9 * strike);
          this.turn(r.fore, _right, 0.9 * wind + 0.2 * strike);
          this.turn(r.arm, UP, 0.5 * strike);
          if (this.chest) this.turn(this.chest, UP, 0.25 * strike - 0.15 * wind);
        }
      }
      if (this.inHand && !using) {
        r.hand.updateWorldMatrix(true, false);
        this.curl(r, this.inHand.curl, r.hand.getWorldQuaternion(_qa));
      }
    }

    // --- a bat, carried: laid back over the right shoulder, the fist on it in front of the chest
    {
      const laid = !!this.inHand?.shoulder && !dead && !using && this.strikeT < 0 && !this.deed && !this.guarding && ges?.kind !== 'check' && this.swingT < 0 && this.fistsT < 0.02;
      this.shoulderT += ((laid ? 1 : 0) - this.shoulderT) * ease(laid ? 6 : 14);
      if (this.shoulderT > 0.02 && this.inHand && this.armR && this.neck.length) {
        settle(this.root);
        const aimQ = _aimQ.setFromAxisAngle(UP, this.yaw);
        const fwd = _fwd.set(0, 0, -1).applyQuaternion(aimQ);
        _right.set(1, 0, 0).applyQuaternion(aimQ);
        const head = this.neck[this.neck.length - 1].getWorldPosition(_head);
        const dirOf = (f: number, u: number, r: number) => new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(UP, u).addScaledVector(_right, r);
        // (the knuckles forward and a little up, the palm in toward the chest: what is in the fist
        // stands out of the thumb's side of it, up and back, and comes down on the shoulder)
        const to = new THREE.Vector3().copy(head).addScaledVector(fwd, SHOULDER.at[0]).addScaledVector(UP, SHOULDER.at[1]).addScaledVector(_right, SHOULDER.at[2]);
        this.reach(this.armR, to, dirOf(...SHOULDER.fingers), dirOf(...SHOULDER.palm), this.inHand.curl, aimQ, this.shoulderT);
      }
    }

    // --- something held in both hands: the left closes on it where its grip says, but while it lies on the shoulder
    if (this.inHand && ges?.kind === 'check' && !dead) lookOverBody(this, ges.t / ges.dur, left(ges));
    else this.inHand?.spin?.rotation.set(0, 0, 0);
    if (this.inHand?.left && !dead && !using && !this.deed?.way) holdLeft(this, 1 - this.shoulderT);

    // --- the arms at their own business: a guard and a punch, hands at work, the wheel's calls (gestures.ts)
    this.gestures(dt, dead, using, ges, mv, pitch);

    if (this.sick && !dead && this.downT <= 0) {
      this.sicken(dt);
      this.plant(dt);
    }
    // (on a broken leg: how much of a limp the steps are, see Gait)
    this.limpT += ((this.limping && !dead ? 1 : 0) - this.limpT) * ease(5);
    // (a thumb is not seen from across the street, nor on the body the eye is in)
    if (!firstPerson && this.root.position.distanceToSquared(Avatar.eye) < THUMB_SEEN * THUMB_SEEN) {
      if (this.armR) this.thumb(this.armR);
      if (this.armL) this.thumb(this.armL);
    }

    if (this.fpBones.length) {
      for (const [from, to, hidden] of this.fpBones) {
        to.position.copy(from.position);
        to.quaternion.copy(from.quaternion);
        if (hidden) to.scale.setScalar(0.0001);
        else to.scale.copy(from.scale);
      }
      this.fpRoot.position.set(pos.x + Math.sin(this.yaw) * FP_BACK, pos.y, pos.z + Math.cos(this.yaw) * FP_BACK);
      this.fpRoot.rotation.set(0, this.yaw + this.twist, 0);
      // Lying down, the body that is seen from its own eyes lies where the body lies: behind them, on the ground
      // and tipped to it. (It was left where a standing body is, a step behind the eyes and upright in its
      // bones' lying pose: a back and a pair of shoulders on the ground in front of the face.)
      const lying = dead ? 0 : this.proneT;
      if (lying > 0.001) {
        this.fpRoot.position.lerp(this.root.position, lying);
        this.fpRoot.rotation.order = 'YXZ';
        this.fpRoot.rotation.copy(this.root.rotation);
      }
      // (And it is not drawn on the way down or the way up: going down, the body fell forward through the eyes
      // and hung in front of them for the half second it took. Lying, it is all behind them, and is drawn again:
      // whoever looks back along themselves sees their own legs.)
      this.fpRoot.visible = lying < 0.02 || lying > 0.97;
      this.fpRoot.scale.copy(this.root.scale);
    }
  },
};
