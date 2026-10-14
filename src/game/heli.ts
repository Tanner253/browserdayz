// The helicopter as it is in one game (2026-10-14): a Jeep (src/game/vehicle.ts) in everything but how it moves and
// what turns on it, so that getting in and out, the seats, the view, being told of it by the server and telling it,
// crashing, burning and being shot at are the jeep's own. The owner: "we just want flight controls and a functioning
// simple helicopter with good physics" ("theres no parts for now"). So it is a game's helicopter, not a simulator's:
//
//   - the rotor pushes along the helicopter's own up, so tipping its nose is what moves it forward, and leaning is
//     what turns it at speed (a banked turn swings its nose round with it, as a real one's does);
//   - how hard it pushes is set for the climb asked for: hands off the climb and descend keys, it holds its height;
//   - the keys ask for a tip and a lean, not for a spin: it eases to them, and back to level when they are let go,
//     so it can be flown with a keyboard and stood still in the air;
//   - the air holds it back by the square of its speed, nose first least, so it has a top speed and stops when it
//     is let alone; and a rotor's breadth over the ground the air under it holds it up a little more;
//   - the rotor comes up to speed over some seconds with a pilot in and runs down without one: left in the air, it
//     falls, and comes down as hard as it comes down (a crash, as a jeep's).
// Every number is HELI's (src/sim/heli.ts). What it reports (VState) is a jeep's: its steer is how fast its rotor
// turns (0..1), its throttle how hard the rotor pushes (0..1), so other games turn its rotors as this one does.
import * as THREE from 'three';
import { physics, groups, G_PLAYER, G_WORLD, SOLID_GROUPS } from '../core/physics';
import { HELI } from '../sim/heli';
import { RIDE_HEIGHT, type VState } from '../sim/vehicles';
import { Jeep, type Controls, type Ground } from './vehicle';

const BODY_GROUPS = groups(G_WORLD, G_WORLD | G_PLAYER);
const UP = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _w = new THREE.Vector3(), _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const clamp = (x: number, a = -1, b = 1) => Math.min(b, Math.max(a, x));

/**
 * What stops it, in its own frame (x to its right, y up, z back; its middle RIDE_HEIGHT over the bottom of its
 * skids, where every vehicle's is): measured on the model as it is built (the MD-500: its cabin from the nose 1.9 m
 * ahead of the rotor's hub to 1 m behind it, 0.6 to 2.25 m over the skids; the tail boom out to 5 m behind; the
 * skids 1.9 m apart). [half width, half height, half length, middle's y, middle's z]
 */
const SHAPE = {
  /**
   * The cabin as a floor, a roof (the engine's housing over it) and a wall behind the seats, and nothing between:
   * its glass stops nobody's shot (the owner: "Make sure players are killable/shoot able out of the heli"), as a
   * car's open windows do. Whatever strikes the rest of it is the helicopter's own damage.
   */
  cabin: [0.75, 0.83, 1.43, 0.63, -0.43],
  floor: [0.75, 0.13, 1.43, -0.07, -0.43],
  roof: [0.6, 0.13, 1.1, 1.33, -0.1],
  back: [0.75, 0.83, 0.3, 0.63, 0.7],
  boom: [0.2, 0.25, 2.0, 0.95, 3.0],
  /** the skids: rods (radius, half length, middle's y, middle's z). (Boxes twelve centimetres thick, set on the ground by their middles, had their ends a hand's depth into ground that was not dead level, and were held down by it: the ground pushed them on through.) */
  skid: [0.1, 1.3, -0.7, -0.2],
  skidApart: 0.95,
} as const;

/** the four ends of the skids, in its own frame (x, z) */
const SKID_ENDS: [number, number][] = [-1, 1].flatMap((side) => [-1, 1].map((end): [number, number] => [side * SHAPE.skidApart, SHAPE.skid[3] + end * SHAPE.skid[1]]));

export class Heli extends Jeep {
  /** how fast its rotor turns, 0..1 (as `steer` tells it to other games) */
  rpm = 0;
  private rotor: THREE.Object3D | null = null;
  private tail: THREE.Object3D | null = null;
  private spin = 0;

  constructor(i: number, groundAt: (x: number, z: number) => Ground) {
    super(i, groundAt, undefined, HELI.kind);
  }

  /** @param visual the model: its body, and its main and tail rotors, each turning about its own hub (as `wheels`) */
  override build(scene: THREE.Scene, s: VState, visual: { body: THREE.Object3D; wheels: THREE.Object3D[] }) {
    const R = physics.R, F = HELI;
    const [cw, ch, cl] = SHAPE.cabin, m = F.mass / 12, w = cw * 2, h = ch * 2, l = 6.9;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(s[0], s[1], s[2])
        .setRotation({ x: s[3], y: s[4], z: s[5], w: s[6] })
        .setAdditionalMassProperties(F.mass, { x: 0, y: 0.45, z: -0.2 }, { x: m * (h * h + l * l) * F.inertia[1], y: m * (w * w + l * l) * F.inertia[2], z: m * (w * w + h * h) * F.inertia[0] }, { x: 0, y: 0, z: 0, w: 1 })
        .setCanSleep(true),
    );
    void cl;
    const add = (desc: ReturnType<typeof R.ColliderDesc.cuboid>) => {
      const c = physics.world.createCollider(desc.setDensity(0).setCollisionGroups(BODY_GROUPS).setSolverGroups(BODY_GROUPS).setFriction(0.6).setRestitution(0.02), this.body);
      physics.tag(c, { surface: 'metal', owner: this });
      this.colliders.push(c);
    };
    const box = (b: readonly number[], x = 0) => add(R.ColliderDesc.cuboid(b[0], b[1], b[2]).setTranslation(x, b[3], b[4]));
    box(SHAPE.floor);
    box(SHAPE.roof);
    box(SHAPE.back);
    box(SHAPE.boom);
    for (const x of [-SHAPE.skidApart, SHAPE.skidApart]) add(R.ColliderDesc.capsule(SHAPE.skid[1], SHAPE.skid[0]).setTranslation(x, SHAPE.skid[2], SHAPE.skid[3]).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }));
    // (the model stands on the bottom of its skids: its middle is RIDE_HEIGHT over that)
    visual.body.position.y = -RIDE_HEIGHT;
    this.root.add(visual.body);
    [this.rotor, this.tail] = [visual.wheels[0] ?? null, visual.wheels[1] ?? null];
    for (const o of visual.wheels) {
      o.position.y -= RIDE_HEIGHT;
      this.root.add(o);
    }
    scene.add(this.root);
    this.pos.set(s[0], s[1], s[2]);
    this.quat.set(s[3], s[4], s[5], s[6]);
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.draw(0);
  }

  /** (no springs) */
  override tune() {}

  override step(h: number, c: Controls | null) {
    const b = this.body, F = HELI;
    const t = b.translation(), rot = b.rotation();
    this.prevPos.set(t.x, t.y, t.z);
    this.prevQuat.set(rot.x, rot.y, rot.z, rot.w);
    if (this.mode !== 'sim') return;
    const lv = b.linvel(), av = b.angvel();
    // What the last step did to it that the rotor and the air did not: it ran into something, or came down hard.
    if (this.hasPost) {
      const hard = Math.hypot(lv.x - this.post.x, (lv.y - this.post.y + 9.81 * h) * 0.6, lv.z - this.post.z);
      if (hard > F.crash) this.onCrash(hard);
    }
    _q.set(rot.x, rot.y, rot.z, rot.w);
    _f.set(0, 0, -1).applyQuaternion(_q);
    _u.set(0, 1, 0).applyQuaternion(_q);
    _r.set(1, 0, 0).applyQuaternion(_q);

    // --- the rotor: up to speed with somebody at the controls and fuel in it, down without
    const flown = !!c && this.fuel > 0 && !this.wreck;
    this.rpm = flown ? Math.min(1, this.rpm + h / F.spinUp) : Math.max(0, this.rpm - h / F.spinDown);
    if (this.rpm > 0) b.wakeUp();

    // --- how far over what is under it its skids are: under its middle, and under each skid's two ends (on a slope
    // the ground under its middle is further down than under a skid, and it never knew it had landed)
    const hit = physics.world.castRay(new physics.R.Ray(t, { x: 0, y: -1, z: 0 }), F.agl + 60, true, undefined, SOLID_GROUPS, undefined, b);
    let above = hit ? hit.timeOfImpact - RIDE_HEIGHT : F.agl + 60;
    for (const [sx, sz] of SKID_ENDS) {
      _w.set(sx, SHAPE.skid[2] - SHAPE.skid[0] + 0.5, sz).applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
      const end = physics.world.castRay(new physics.R.Ray(_w, { x: 0, y: -1, z: 0 }), 3, true, undefined, SOLID_GROUPS, undefined, b);
      if (end) above = Math.min(above, end.timeOfImpact - 0.5);
    }
    // (down: its skids on or near what is under it and hardly moving up or down; on a slope the ground under its middle is lower than under a skid)
    const down = above < 0.5 && Math.abs(lv.y) < 1.5;
    this.grounded = down ? 4 : 0;

    // --- what the pilot asks: W/S tip the nose, A/D turn it round, Q/E lean, the climb and descend keys
    const pitchIn = c ? clamp(c.throttle) : 0, turnIn = c ? clamp(c.steer) : 0, liftIn = c ? clamp(c.lift ?? 0) : 0, leanIn = c ? clamp(c.roll ?? 0) : 0;

    // --- the push: set for the climb asked for (holding its height when none is), no more than the rotor has
    const weight = F.mass * 9.81;
    let push = 0;
    if (this.rpm > 0) {
      const most = F.lift * weight * this.rpm * this.rpm * (1 + F.ground * Math.max(0, 1 - above / F.rotorD));
      // (standing on its skids and not asked up: no push, so that its whole weight is on them and it stays where it is put)
      if (down && liftIn <= 0) push = 0;
      else {
        // (coming down, slower the nearer the ground: a quarter of the rate in the last few metres)
        let climb = liftIn > 0 ? liftIn * F.climb : liftIn * F.sink * Math.min(1, Math.max(0.25, above / 12));
        // (never more than F.agl over what is under it, the ground rising and falling: over a cliff's edge it settles down to it again)
        climb = Math.max(-F.sink, Math.min(climb, Math.min(F.agl - above, F.ceiling - t.y) * 0.8));
        push = clamp((F.mass * (9.81 + F.hold * (climb - lv.y))) / Math.max(0.35, _u.y), 0, most);
      }
    }
    this.throttle = push / (F.lift * weight);
    // --- the air: by the square of the speed along each of its own ways
    const vf = lv.x * _f.x + lv.y * _f.y + lv.z * _f.z, vu = lv.x * _u.x + lv.y * _u.y + lv.z * _u.z, vr = lv.x * _r.x + lv.y * _r.y + lv.z * _r.z;
    const [dr, du, df] = F.drag;
    // (Near the ground the push stands straight up, not along its tilt: a skid still down with the push along a tilt
    // is a pivot, and it went over on it, as a real one can (a "dynamic rollover"), on any ground not dead level.)
    const low = Math.max(0, 1 - above / F.low);
    _w.copy(_u).lerp(UP, low).normalize().multiplyScalar(push).addScaledVector(_u, -du * vu * Math.abs(vu)).addScaledVector(_f, -df * vf * Math.abs(vf)).addScaledVector(_r, -dr * vr * Math.abs(vr));
    b.applyImpulse({ x: _w.x * h, y: _w.y * h, z: _w.z * h }, true);

    // --- how it stands: eased to the tip and the lean asked for, its turning to the turn asked for and its bank's own
    if (this.rpm > 0.3 && (!down || liftIn > 0)) {
      const pitch = Math.asin(clamp(_f.y)), lean = -Math.asin(clamp(_r.y));
      const flat = Math.hypot(lv.x, lv.z);
      // (hands off, it brings itself to a stop: its nose up against going forward, a lean against drifting sideways)
      const holdPitch = pitchIn ? -pitchIn * F.pitch : clamp(vf * F.brake, -F.brakeMost, F.brakeMost), holdLean = leanIn ? leanIn * F.roll : clamp(-vr * F.brake, -F.brakeMost, F.brakeMost);
      // (nose down for W; lean right for E; round to the right for D; and at speed the bank swings the nose round with it)
      const wPitch = F.level * (holdPitch - pitch), wLean = F.level * (holdLean - lean);
      const wTurn = -turnIn * F.yaw - (flat > 6 ? ((9.81 * Math.tan(lean)) / flat) * F.coordinate : 0);
      _v.copy(_r).multiplyScalar(wPitch).addScaledVector(_f, wLean).addScaledVector(UP, wTurn);
      // (and near the ground it is held to how it is asked to stand at once, every step: nothing it touches can tip it)
      const k = low > 0 ? 1 : 1 - Math.exp(-F.response * this.rpm * h);
      b.setAngvel({ x: av.x + (_v.x - av.x) * k, y: av.y + (_v.y - av.y) * k, z: av.z + (_v.z - av.z) * k }, true);
    } else if (down) {
      // (on the ground: its skids hold it, as a jeep's brakes hold one, on any slope it can stand on)
      const k = Math.exp(-4 * h), slow = Math.exp(-6 * h), now = b.linvel();
      b.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, false);
      b.setLinvel({ x: now.x * slow, y: now.y, z: now.z * slow }, false);
    }
    // (never faster than the server lets a vehicle go)
    const now = b.linvel(), speed = Math.hypot(now.x, now.y, now.z);
    if (speed > F.top) b.setLinvel({ x: (now.x * F.top) / speed, y: (now.y * F.top) / speed, z: (now.z * F.top) / speed }, true);

    this.speed = vf;
    this.steer = this.rpm;
    this.slide = 0;
    const after = b.linvel();
    this.post.set(after.x, after.y, after.z);
    this.hasPost = true;
    if (this.rpm > 0) this.fuel = Math.max(0, this.fuel - (Math.max(0.25, this.throttle) * this.rpm * F.burn * h) / 60);
    // (at rest: down, still, and its rotor stopped)
    const quiet = down && Math.hypot(lv.x, lv.y, lv.z) < 0.15 && Math.hypot(av.x, av.y, av.z) < 0.1 && this.rpm < 0.02;
    this.still = quiet ? this.still + h : 0;
  }

  /** as a jeep is put somewhere at once, its rotor at the speed it was said to be turning at */
  override place(s: VState) {
    super.place(s);
    this.rpm = s[10];
  }

  protected override draw(dt: number) {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    // (standing where it was left, its rotor is still; moved here or elsewhere, it turns as fast as it was last said to)
    const rpm = this.mode === 'sim' ? this.rpm : this.mode === 'parked' ? 0 : this.steer;
    this.spin = (this.spin + rpm * HELI.rotorRate * dt) % (Math.PI * 2 * 1000);
    if (this.rotor) this.rotor.rotation.y = this.spin;
    if (this.tail) this.tail.rotation.x = this.spin * HELI.tailRate;
  }

  override dispose(scene: THREE.Scene) {
    scene.remove(this.root);
    for (const c of this.colliders) physics.tags.delete(c.handle);
    physics.world.removeRigidBody(this.body);
  }
}
