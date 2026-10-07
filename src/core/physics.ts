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
  zone?: 'head' | 'torso' | 'legs';
}

export class Physics {
  world!: RAPIER.World;
  R = RAPIER;
  readonly tags = new Map<number, ColliderTag>();
  readonly fixedDt = 1 / 60;
  private acc = 0;

  async init() {
    await RAPIER.init();
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

  raycast(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxToi: number, filterGroups = SHOT_GROUPS, exclude?: RAPIER.Collider) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxToi, true, undefined, filterGroups, exclude, undefined);
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return { collider: hit.collider, toi: hit.timeOfImpact, point: p, normal: hit.normal, tag: this.tagOf(hit.collider) };
  }
}

export const physics = new Physics();
