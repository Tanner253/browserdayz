// The menu's scenes of what came to the game after 2026-10-13 (the owner, 2026-10-31: "update the main menu scenes to show
// new content etc... same high quality", "give players stuff to chew on so theres no doubts things are being added"):
// nothing in the table was newer than the snow, so eighteen days of work had never been seen from the front page. Each
// is a function the table in ./menu-scenes.ts calls, as the others there are, and most are set in the low sun (the
// `hour` of a Vignette) so that an update reads as new at a glance.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { CELL } from '../sim/build/pieces';
import { toWorld, worldYaw } from '../sim/build/snap';
import { HELI } from '../sim/heli';
import { SITE, type Base28 } from '../trailer/base28';
import { MODES, stagePoser } from './animals';
import { FIRE } from './craft-forge';
import { fromHeli } from './garage';
import type { MenuScenes, Vignette } from './menu-scenes';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mix = THREE.MathUtils.lerp, ease = THREE.MathUtils.smoothstep;
/** low evening sun, and the last of it: src/sim/daynight.ts */
const EVENING = 0.7, DUSK = 0.725;

type Poser = NonNullable<Awaited<ReturnType<typeof stagePoser>>>;

/** `n` of a kind as the game draws them, out of sight until a scene stands them up (they are there when they have come) */
function beasts(m: MenuScenes, kind: string, n: number) {
  const all: Poser[] = [];
  void (async () => {
    for (let k = 0; k < n; k++) {
      const p = await stagePoser(kind);
      if (!p || m.gone) return;
      p.root.visible = false;
      p.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = mesh.receiveShadow = true;
        // (a skinned thing's box is where its rest pose stood)
        mesh.frustumCulled = false;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.h.atmo.register(mat);
      });
      m.h.scene.add(p.root);
      m.props.push(p.root);
      all.push(p);
    }
  })().catch(() => {});
  return all;
}

/** a straight run of open ground `len` metres long, trees along it and nothing on it, out from the valley's towns */
function lane(m: MenuScenes, id: string, len: number, width: number) {
  const w = m.h.world, c = w.pois[0];
  let best: { at: THREE.Vector3; to: THREE.Vector3 } | null = null, top = -1e9;
  for (let R = 130; R <= 340; R += 14) {
    for (let a = 0; a < Math.PI * 2; a += 0.13) {
      const at = m.on(c.x + Math.cos(a) * R, c.z + Math.sin(a) * R);
      if (m.count(at.x, at.z, 8, true) || w.pois.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < p.radius + 8)) continue;
      for (let b = 0; b < Math.PI * 2; b += 0.4) {
        const to = V(Math.cos(b), 0, Math.sin(b)), far = m.on(at.x + to.x * len, at.z + to.z * len), mid = m.on(at.x + (to.x * len) / 2, at.z + (to.z * len) / 2);
        if (Math.abs(far.y - at.y) > 3 || Math.abs(mid.y - at.y) > 2 || !m.open(at, far, width) || !m.clear(at.clone().setY(at.y + 1.2), far.clone().setY(far.y + 1.2))) continue;
        const score = Math.min(m.count(mid.x, mid.z, 24), 16) - m.rough(mid.x, mid.z, 10) * 3;
        if (score > top) {
          top = score;
          best = { at, to };
        }
      }
    }
  }
  return best ?? m.no(id, `no open run of ${len} m was found`);
}

/**
 * A wolf pack running a man down: he comes at the lens flat out with four of them closing behind him, as they do in
 * the game (a sprint is 6.2 m/s, a wolf 7).
 */
export function wolfPack(m: MenuScenes): Vignette | null {
  const man = m.men[1], seconds = 8.5, way = lane(m, 'wolves', 62, 2.6);
  if (!way || !man) return null;
  const { at, to } = way, side = V(-to.z, 0, to.x), pack = beasts(m, 'wolf', 4);
  const P = (far: number, right: number) => m.on(at.x + to.x * far + side.x * right, at.z + to.z * far + side.z * right);
  /** how far behind him each runs at the start, and to which side */
  const RUNS: [number, number][] = [[5, -1.3], [7, 1.5], [9, -0.3], [11, 2.3]];
  const yaw = Math.atan2(to.x, to.z), running = Math.atan2(-to.x, -to.z), SPEED = 6.2, WOLF = 7;
  return {
    caption: 'Wolf packs · they hunt people too, and howl when they have you',
    seconds,
    hour: EVENING,
    setup: () => {
      m.put(man, at.x, at.z, yaw);
      m.arm(man, 'none');
    },
    tick: (t, dt) => {
      const end = P(60, 0);
      m.go(man, end.x, end.z, SPEED, dt);
      pack.forEach((w, k) => {
        const [back, right] = RUNS[k], gone = t * WOLF - back, p = P(gone, right);
        if (!w.root.visible || t < dt * 2) {
          w.root.visible = true;
          w.pose(MODES.run, k * 0.17);
        }
        w.root.position.copy(p);
        w.root.rotation.y = running;
        w.mixer.update(dt);
      });
    },
    view: (t) => {
      // (a pace or two ahead of him, low, going backward as fast as he comes)
      const k = Math.min(1, t / seconds), far = Math.min(61, t * SPEED + mix(12, 10, k)), p = P(far, 1.1);
      p.y += 0.95;
      const look = P(t * SPEED - 2.5, 0.2);
      look.y += 0.9;
      return m.lens(p, look, 27, 0.2);
    },
  };
}

/**
 * The bear: it walks in, stands and roars, and comes on at nine metres a second with a man emptying a rifle at it (the
 * rule in src/sim/animals.ts: it roars at 20 m, and inside 12 m or hurt nothing outruns it for eight seconds).
 */
export function bearCharge(m: MenuScenes): Vignette | null {
  const man = m.men[2], seconds = 8, way = lane(m, 'bear', 34, 2.4);
  if (!way || !man) return null;
  const { at, to } = way, side = V(-to.z, 0, to.x), bear = beasts(m, 'bear', 1);
  const P = (far: number, right = 0) => m.on(at.x + to.x * far + side.x * right, at.z + to.z * far + side.z * right);
  const WALK = 2.4, ROARS = 3.4, CHARGE = 9, START = 30, facing = Math.atan2(to.x, to.z);
  /** where it is along the lane after so long */
  const along = (t: number) => (t < WALK ? START - t * 1.8 : t < ROARS ? START - WALK * 1.8 : START - WALK * 1.8 - (t - ROARS) * CHARGE);
  let doing = -1, shot = 0;
  return {
    caption: 'The bear · inside 12 metres nothing outruns it',
    seconds,
    hour: EVENING,
    close: () => (man.kits.get('ar15')?.obj ? [man.kits.get('ar15')!.obj] : []),
    setup: () => {
      m.put(man, at.x, at.z, 0);
      const it = P(START);
      man.face(it.x, it.z);
      m.arm(man, man.kits.has('ar15') ? 'ar15' : 'own');
      man.aim = true;
      doing = -1;
      shot = 0;
    },
    tick: (t, dt) => {
      const b = bear[0];
      if (!b) return;
      const mode = t < WALK ? MODES.walk : t < ROARS ? MODES.roar : MODES.run;
      if (mode !== doing) {
        doing = mode;
        b.pose(mode, 0);
      }
      b.root.visible = true;
      b.root.position.copy(P(Math.max(5.5, along(t))));
      b.root.rotation.y = facing;
      b.mixer.update(dt);
      if (t > ROARS + 0.1 && t - shot > 0.14) {
        shot = t;
        m.fire(man, null);
      }
    },
    view: (t) => {
      // (over his shoulder, and easing down as it comes)
      const k = ease(t, 0, seconds), p = P(-mix(3.2, 2.5, k), mix(-1.5, -1.2, k));
      p.y += mix(1.65, 1.5, k);
      const look = P(mix(14, 8, k), 0.5);
      look.y += 1.1;
      return m.lens(p, look, 34, 0.2);
    },
  };
}

/** the one base the scenes are set at, raised a moment before the first of them is cut to and left standing while the menu is up */
function site(m: MenuScenes) {
  let base: Base28 | null = null, failed = false;
  const raise = () => {
    if (base || failed) return;
    try {
      const b = m.h.base();
      b.begin();
      b.whole();
      for (const p of b.base!.pieces.values()) if (p.k === 'foundation') b.tier(p.id, 2);
      base = b;
      m.undo.push(() => b.clear());
    } catch (e) {
      failed = true;
      console.warn('menu base:', e);
    }
  };
  return { raise, get: () => base };
}
let shared: { key: MenuScenes; site: ReturnType<typeof site> } | null = null;
const siteOf = (m: MenuScenes) => (shared?.key === m ? shared.site : (shared = { key: m, site: site(m) }).site);

/** a place in front of the house, in the base's own measure: `right` along its front, `out` from it */
const front = (b: Base28, right: number, out: number) => b.at(CELL + right, 0, CELL * 2.5 + out);

/** A raid: a charge on the base's metal door at dusk, two men going to ground, and in through the smoke. */
export function raid(m: MenuScenes): Vignette | null {
  const s = siteOf(m), one = m.men[2], two = m.men[1], seconds = 9, BLOWS = 2.7;
  if (!one || !two) return null;
  let blown = false, eye: THREE.Vector3 | null = null;
  return {
    caption: 'Raids · C4 from a level III bench, through the door of a base',
    seconds,
    hour: DUSK,
    lead: 6,
    early: () => s.raise(),
    setup: () => {
      s.raise();
      const b = s.get();
      if (!b) return;
      b.door(true);
      blown = false;
      const a = front(b, -2.6, 6.2), c = front(b, -5.4, 8), door = front(b, 0, 0);
      eye = null;
      for (const [right, out] of [[-9.5, 12.5], [-11.5, 10], [-7.5, 14], [-13, 7.5], [-5.5, 15.5], [8.5, 12.5], [11, 9.5]]) {
        const q = front(b, right, out), g = m.on(q.x, q.z);
        g.y += 1.5;
        if (!m.count(q.x, q.z, 2.6, true) && m.clear(g, door.clone().setY(door.y + 1.4), 1)) {
          eye = g;
          break;
        }
      }
      m.put(one, a.x, a.z, 0);
      m.put(two, c.x, c.z, 0);
      for (const e of [one, two]) {
        e.face(door.x, door.z);
        e.crouch = true;
        e.aim = true;
        m.arm(e, e.kits.has('ar15') ? 'ar15' : e.kits.has('ak') ? 'ak' : 'own');
      }
    },
    tick: (t, dt) => {
      const b = s.get();
      if (!b) return;
      const door = front(b, 0, 0);
      if (t >= BLOWS && !blown) {
        blown = true;
        m.h.effects.explode(door.clone().setY(door.y + 1.2), 'grenade');
        b.door(false);
      }
      if (t > BLOWS + 1.3) {
        const inside = front(b, 0, -3);
        for (const e of [one, two]) {
          e.crouch = false;
          m.go(e, inside.x, inside.z, 5.2, dt);
        }
      }
    },
    view: (t) => {
      const b = s.get();
      const k = ease(t, 0, seconds);
      if (!b) return m.lens(V(SITE.x, m.ground(SITE.x, SITE.z) + 20, SITE.z + 30), V(SITE.x, m.ground(SITE.x, SITE.z), SITE.z), 40, 0.1);
      const door = front(b, -0.5, 0);
      const p = (eye ?? front(b, -9.5, 12.5)).clone().lerp(door, mix(0, 0.1, k));
      return m.lens(p, door.clone().setY(door.y + 1.5), 42, 0.24);
    },
  };
}

/** Felling: a man with the axe at a pine by the site, the house he built on the ground behind him. */
export function sawLogs(m: MenuScenes): Vignette | null {
  const s = siteOf(m), man = m.men[3] ?? m.men[0], seconds = 8, STROKE = 1.15;
  const axe = man && m.h.held('felling_axe', []);
  if (!man || !axe) return m.no('felling', 'no axe to hold');
  man.kits.set('axe', { ...axe, quiet: true });
  // the pine nearest the house on its near side
  const trees = m.h.world.trees as { kind?: string; x: number; z: number }[];
  let tree: (typeof trees)[number] | null = null, near = 1e9;
  for (const t of trees) {
    if (!/pine|spruce|fir/i.test(t.kind ?? '')) continue;
    const d = Math.hypot(t.x - (SITE.x + 34), t.z - (SITE.z + 22));
    if (d < near) {
      near = d;
      tree = t;
    }
  }
  if (!tree) return m.no('felling', 'no pine by the site');
  const from = Math.atan2(SITE.x - tree.x, SITE.z - tree.z) + 1.0, at = V(tree.x + Math.sin(from) * 1.65, 0, tree.z + Math.cos(from) * 1.65);
  const hub = m.on(tree.x, tree.z);
  let struck = -1;
  return {
    caption: 'Felling · logs make planks, and planks make a base',
    seconds,
    hour: EVENING,
    close: () => [axe.obj],
    lead: 6,
    early: () => s.raise(),
    setup: () => {
      s.raise();
      m.put(man, at.x, at.z, 0);
      man.face(tree!.x, tree!.z);
      m.arm(man, 'axe');
      struck = -1;
    },
    tick: (t) => {
      const n = Math.floor((t - 0.3) / STROKE);
      if (t >= 0.3 && n > struck) {
        struck = n;
        man.body.swing(false, STROKE);
      }
      // (the blow lands a third of the way through the stroke)
      if (Math.abs(((t - 0.3) % STROKE) - STROKE * 0.38) < 0.012) {
        const out = V(at.x - tree!.x, 0, at.z - tree!.z).normalize();
        m.h.effects.impact('wood', hub.clone().addScaledVector(out, 0.2).setY(hub.y + 1.05), out, false);
      }
    },
    view: (t) => {
      const k = ease(t, 0, seconds), a = from + 0.95, r = mix(5.4, 4.6, k);
      const p = m.on(tree!.x + Math.sin(a) * r, tree!.z + Math.cos(a) * r);
      p.y += 1.35;
      return m.lens(p, hub.clone().setY(hub.y + 1.2), 42, 0.14);
    },
  };
}

/** Along the ground floor of the base at dusk: the bench, the forge burning, the rack, by the torches. */
export function forge(m: MenuScenes): Vignette | null {
  const s = siteOf(m), man = m.men[0], seconds = 8.5;
  if (!man) return null;
  const owed = { flame: 0, smoke: 0 };
  let fire: THREE.Vector3 | null = null, stood = false;
  /** the base's forge stood in the world (the game draws one from what the server says of it, and here there is no server) */
  const stand = () => {
    s.raise();
    const b = s.get()?.base, p = b && [...b.pieces.values()].find((q) => q.k === 'forge');
    if (stood || !b || !p) return;
    stood = true;
    const [x, y, z] = toWorld(b, p.x, p.y, p.z), yaw = worldYaw(b, p.r);
    fire = new THREE.Vector3(...FIRE.at).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, y, z));
    void assets.model('forge_hf').then((model) => {
      if (m.gone) return;
      const root = model.clone();
      root.position.set(x, y, z);
      root.rotation.y = yaw;
      m.h.scene.add(root);
      m.props.push(root);
    }).catch(() => {});
  };
  const burn = (dt: number) => fire && m.h.effects.campfire(fire, owed, dt, 0.2, true);
  return {
    caption: 'A forge of your own · fragments into iron, iron into guns at the bench',
    seconds,
    hour: DUSK,
    lead: 7,
    early: (dt) => {
      stand();
      burn(dt);
    },
    setup: () => {
      const b = s.get();
      if (!b) return;
      stand();
      const p = b.at(CELL * 2.6, 0, CELL * 1.8), f = b.at(CELL * 3.2, 0, CELL * 2.05);
      m.put(man, p.x, p.z, 0);
      man.face(f.x, f.z);
      m.arm(man, 'none');
    },
    tick: (_t, dt) => burn(dt),
    view: (t) => {
      const b = s.get(), k = ease(t, 0, seconds);
      if (!b) return m.lens(V(SITE.x, m.ground(SITE.x, SITE.z) + 20, SITE.z + 30), V(SITE.x, m.ground(SITE.x, SITE.z), SITE.z), 40, 0.1);
      const p = b.at(mix(CELL * 1.2, CELL * 1.55, k), 1.45, mix(CELL * 2.2, CELL * 2.12, k)), look = b.at(CELL * 3, 0.9, CELL * 2.0);
      return m.lens(p, look, 46, 0.2);
    },
  };
}

/**
 * Down the river through the Red Canyon in the low sun, the walls going by on both sides. (Not Kalat, which is a town of
 * far-off blocks until somebody walks up to it: src/world/ruins.ts. The canyon is all ground, and always drawn whole.)
 */
export function canyon(m: MenuScenes): Vignette | null {
  const pts = (m.h.world.water?.rivers ?? []).flatMap((r) => r.pts).filter((p) => p[0] > -2420 && p[0] < -2120).sort((p, q) => p[0] - q[0]), seconds = 9.5;
  if (pts.length < 4) return m.no('canyon', 'no river through the canyon on this map');
  const along = (u: number) => {
    const f = Math.min(1, Math.max(0, u)) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), t = f - i, p = pts[i], q = pts[i + 1];
    return V(mix(p[0], q[0], t), mix(p[2], q[2], t), mix(p[1], q[1], t));
  };
  return {
    caption: 'The Red Canyon · one pass through the wall to the east',
    seconds,
    hour: EVENING,
    setup: () => {},
    tick: () => {},
    view: (t) => {
      const k = t / seconds, p = along(0.06 + k * 0.24), look = along(0.28 + k * 0.24);
      p.y += mix(19, 13, k);
      look.y += 5;
      return m.lens(p, look, 54, 0.12);
    },
  };
}

/** Orlinoye on its rim from the valley side, and the MD-500 going by toward it. */
export function fortFlight(m: MenuScenes): Vignette | null {
  const c = m.h.world.pois.find((p) => p.name === 'Orlinoye'), seconds = 9;
  if (!c) return m.no('fort', 'no fort on this map');
  const fort = m.on(c.x, c.z), to = V(c.x - m.h.world.pois[0].x, 0, c.z - m.h.world.pois[0].z).normalize(), side = V(-to.z, 0, to.x);
  const lensAt = (t: number) => {
    const k = ease(t, 0, seconds);
    return eye(mix(170, 150, k), mix(-46, -36, k), mix(48, 44, k));
  };
  const eye = (far: number, right: number, up: number) => {
    const p = V(c.x - to.x * far + side.x * right, 0, c.z - to.z * far + side.z * right);
    return p.setY(Math.max(m.ground(p.x, p.z) + 16, fort.y + up));
  };
  let craft: { root: THREE.Object3D; rotor: THREE.Object3D | null; tail: THREE.Object3D | null } | null = null;
  void assets.model(HELI.model).then((model) => {
    if (m.gone) return;
    const { body, wheels } = fromHeli(model);
    const root = new THREE.Group();
    root.add(body, ...wheels);
    root.visible = false;
    m.h.scene.add(root);
    m.props.push(root);
    craft = { root, rotor: wheels[0] ?? null, tail: wheels[1] ?? null };
  }).catch(() => {});
  return {
    caption: 'Orlinoye · a fort on the mountain, and a helicopter to fly up to it',
    seconds,
    hour: EVENING,
    setup: () => {},
    tick: (t) => {
      if (!craft) return;
      // (in from behind the lens on the right, nose down, and on toward the walls)
      const k = t / seconds, from = lensAt(t), goal = fort.clone().setY(fort.y + 24), now = from.clone().lerp(goal, mix(0.1, 0.72, k));
      now.addScaledVector(side, mix(18, -5, k)).setY(now.y + mix(3, 8, k));
      const dir = goal.clone().sub(now).setY(0).normalize();
      craft.root.visible = true;
      craft.root.position.copy(now);
      craft.root.rotation.set(-0.14, Math.atan2(-dir.x, -dir.z), 0.08, 'YXZ');
      if (craft.rotor) craft.rotor.rotation.y = t * HELI.rotorRate;
      if (craft.tail) craft.tail.rotation.x = t * HELI.rotorRate * HELI.tailRate;
    },
    view: (t) => {
      return m.lens(lensAt(t), fort.clone().setY(fort.y + 8), 40, 0.2);
    },
  };
}
