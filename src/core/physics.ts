// Rapier (Rust, compiled to WASM) physics. The same engine runs natively on the
// authoritative server later, so collision results match between client and server.

import RAPIER from '@dimforge/rapier3d-compat';

export type Surface = 'grass' | 'dirt' | 'gravel' | 'rock' | 'wood' | 'metal' | 'concrete' | 'asphalt' | 'flesh' | 'foliage' | 'glass' | 'plaster' | 'cloth';

// interaction groups: membership << 16 | filter
export const G_WORLD = 0x0001;
export const G_PLAYER = 0x0002;
export const G_ITEM = 0x0004;
export const G_TRIGGER = 0x0008;
export const G_FOLIAGE = 0x0010; // bushes: block bullets a little, never block movement
export const G_GLASS = 0x0020; // window panes: block players, not bullets
export const G_HITBOX = 0x0040; // character hit zones: stop bullets and melee, never movement
export const groups = (member: number, filter: number) => (member << 16) | filter;

export const WORLD_GROUPS = groups(G_WORLD, 0xffff);
/** a door that is open or swinging: part of the world for a shot, a thrown thing or a look, but no body is stopped by it */
export const AJAR_GROUPS = groups(G_WORLD, 0xffff & ~G_PLAYER);
/** finds the bodies of players (for asking whether one stands in a given place) */
export const BODY_QUERY = groups(0xffff, G_PLAYER);
export const GLASS_GROUPS = groups(G_GLASS, G_PLAYER);
export const PLAYER_GROUPS = groups(G_PLAYER, G_WORLD | G_ITEM | G_GLASS);
export const ITEM_GROUPS = groups(G_ITEM, G_WORLD | G_ITEM);
/** what bullets can hit */
export const SHOT_GROUPS = groups(0xffff, G_WORLD | G_ITEM | G_FOLIAGE | G_HITBOX);
/** solid world only (terrain, buildings, props): used to rest loot on surfaces */
export const SOLID_GROUPS = groups(0xffff, G_WORLD);
/** what hides one person from another: walls, ground, trunks, rocks and bushes (glass does not) */
export const SIGHT_GROUPS = groups(0xffff, G_WORLD | G_FOLIAGE);
export const HITBOX_GROUPS = groups(G_HITBOX, 0xffff);
/** what the player's interaction ray can hit */
export const USE_GROUPS = groups(0xffff, G_WORLD | G_ITEM | G_TRIGGER);

export interface ColliderTag {
  surface: Surface;
  /** optional gameplay owner, e.g. a world item or container */
  owner?: unknown;
  /** hit zone of a character (damage multiplier is looked up from this) */
  zone?: 'head' | 'torso' | 'legs' | 'arms';
  /** a round goes through it and flies on: a curtain, a door of boards. A body, a look and a thrown thing are stopped by it as by anything */
  thin?: boolean;
}

export class Physics {
  world!: RAPIER.World;
  R = RAPIER;
  readonly tags = new Map<number, ColliderTag>();
  readonly fixedDt = 1 / 60;
  private acc = 0;

  async init() {
    // (The binary is a file of its own, 3 MB, fetched by Rapier's start once (scripts/physics-wasm.ts): one request
    // dropped on a slow line stopped the whole game at its first stage, "Load failed" in Safari on a Mac five starts
    // running, 2026-10-24: "ios user cant load game on mac or iphone". It is asked for again, as every other file of the
    // start is: Rapier fetches afresh on each call, and keeps nothing of one that failed.)
    for (let go = 0; ; go++) {
      try {
        await RAPIER.init();
        break;
      } catch (e) {
        if (go >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (go + 1)));
      }
    }
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.fixedDt;
  }

  tag(c: RAPIER.Collider, tag: ColliderTag) {
    this.tags.set(c.handle, tag);
    return c;
  }

  tagOf(c: RAPIER.Collider | null | undefined): ColliderTag | undefined {
    return c ? this.tags.get(c.handle) : undefined;
  }

  /** Static collider attached to a fixed body at a world transform. */
  addStatic(desc: RAPIER.ColliderDesc, surface: Surface, pos: { x: number; y: number; z: number }, rotY = 0, owner?: unknown) {
    const half = rotY / 2;
    desc.setTranslation(pos.x, pos.y, pos.z).setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    desc.setCollisionGroups(WORLD_GROUPS).setSolverGroups(WORLD_GROUPS);
    const c = this.world.createCollider(desc);
    return this.tag(c, { surface, owner });
  }

  addStaticQuat(desc: RAPIER.ColliderDesc, surface: Surface, pos: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }, owner?: unknown, collisionGroups = WORLD_GROUPS) {
    desc.setTranslation(pos.x, pos.y, pos.z).setRotation(q);
    desc.setCollisionGroups(collisionGroups).setSolverGroups(collisionGroups);
    const c = this.world.createCollider(desc);
    return this.tag(c, { surface, owner });
  }

  /** Steps the simulation with a fixed timestep; returns the number of substeps run. */
  step(dt: number, onSubstep?: (h: number) => void) {
    this.acc = Math.min(this.acc + dt, 0.25);
    let n = 0;
    while (this.acc >= this.fixedDt) {
      onSubstep?.(this.fixedDt);
      this.stepWorld();
      this.acc -= this.fixedDt;
      n++;
    }
    return n;
  }

  /**
   * World.step() follows every step with a JS-side rescan of all bodies and colliders
   * (to pick up ones created inside WASM). With ~15k static colliders that is ~30k
   * WASM<->JS calls and ~1 MB of garbage per step, which fed ever-longer GC pauses.
   * Everything here is created and removed through the JS API, which keeps those maps
   * current itself, so run the pipeline directly.
   */
  private stepWorld() {
    const w = this.world;
    w.physicsPipeline.step(w.gravity, w.integrationParameters, w.islands, w.broadPhase, w.narrowPhase, w.bodies, w.colliders, w.softBodies, w.impulseJoints, w.multibodyJoints, w.ccdSolver);
  }

  get alpha() {
    return this.acc / this.fixedDt;
  }

  /** true if an oriented box overlaps any collider in the given groups */
  boxOverlaps(center: { x: number; y: number; z: number }, rotY: number, hx: number, hy: number, hz: number, filterGroups = SOLID_GROUPS) {
    const half = rotY / 2;
    const shape = new RAPIER.Cuboid(hx, hy, hz);
    return this.world.intersectionWithShape(center, { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, shape, undefined, filterGroups) !== null;
  }

  /**
   * The ground's collider, and where it is open: over a basement's steps (src/sim/basements.ts) it is not drawn, a
   * ray goes on through it, and the player's controller does not meet it (see Player). Said by the terrain.
   */
  ground: RAPIER.Collider | null = null;
  holes: ((x: number, z: number) => boolean) | null = null;

  raycast(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxToi: number, filterGroups = SHOT_GROUPS, exclude?: RAPIER.Collider): { collider: RAPIER.Collider; toi: number; point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number }; tag: ColliderTag | undefined } | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxToi, true, undefined, filterGroups, exclude, undefined);
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    // (the ground where it is open: on through it, as if it were not there)
    if (hit.collider === this.ground && this.holes?.(p.x, p.z) && exclude !== this.ground) {
      const go = hit.timeOfImpact + 0.01, on = this.raycast({ x: origin.x + dir.x * go, y: origin.y + dir.y * go, z: origin.z + dir.z * go }, dir, maxToi - go, filterGroups, this.ground);
      return on ? { ...on, toi: on.toi + go } : null;
    }
    return { collider: hit.collider, toi: hit.timeOfImpact, point: p, normal: hit.normal, tag: this.tagOf(hit.collider) };
  }

  /** what the player's controller is to leave out where it stands: the ground, over a basement's open steps */
  through(x: number, z: number): ((c: RAPIER.Collider) => boolean) | undefined {
    const g = this.ground;
    return g && this.holes?.(x, z) ? (c) => c !== g : undefined;
  }
}

export const physics = new Physics();

/**
 * A hit zone that a body bends (a head, a chest): a collider of its own, put where it is in the world, and not a
 * collider on the body moved about on it. Rapier 0.21 makes the step after a collider is moved about its body
 * (setTranslationWrtParent) cost a millisecond and a half however few are moved, and with anybody else in sight one
 * was, every frame: measured 2026-10-14, one head moved so cost 1.43 ms a step, five colliders of their own put
 * where they are 0.013 ms.
 */
export class FreeZone {
  readonly collider: RAPIER.Collider;
  /** where it is on its body, in the body's own frame (x to its right, z behind it) */
  readonly at = { x: 0, y: 0, z: 0 };
  /** and how it is turned there */
  readonly turn = { x: 0, y: 0, z: 0, w: 1 };

  /** @param desc its shape and groups (its place is `at`) */
  constructor(desc: RAPIER.ColliderDesc, at: { x: number; y: number; z: number }) {
    this.collider = physics.world.createCollider(desc);
    Object.assign(this.at, at);
  }

  /** what it was last put at: its body's place and turn, and its own on the body (put there again, nothing is said) */
  private was = new Float64Array(11).fill(NaN);

  /** where it is now, its body at (x, y, z) turned `yaw` about the upright (as a body is turned by { 0, sin yaw/2, 0, cos yaw/2 }) */
  place(x: number, y: number, z: number, yaw: number) {
    const a = this.at, t = this.turn, w = this.was;
    if (w[0] === x && w[1] === y && w[2] === z && w[3] === yaw && w[4] === a.x && w[5] === a.y && w[6] === a.z && w[7] === t.x && w[8] === t.y && w[9] === t.z && w[10] === t.w) return;
    w.set([x, y, z, yaw, a.x, a.y, a.z, t.x, t.y, t.z, t.w]);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.collider.setTranslation({ x: x + a.x * c + a.z * s, y: y + a.y, z: z - a.x * s + a.z * c });
    const hy = Math.sin(yaw / 2), hw = Math.cos(yaw / 2);
    this.collider.setRotation({ x: hw * t.x + hy * t.z, y: hw * t.y + hy * t.w, z: hw * t.z - hy * t.x, w: hw * t.w - hy * t.y });
  }
}
