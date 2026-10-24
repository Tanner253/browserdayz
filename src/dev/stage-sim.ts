// The stage's behaviour checks (2026-10-24, the owner: "all sessions should use the stage for development right?
// wouldnt it make it faster turn around speed? then once its all tested in the stage we can plug it in to the world").
// The animals' own minds (src/sim/animal-mind.ts) run on the stage's flat floor with a fixed clock and seed, and the
// moments that matter are drawn in one picture from a high camera, each animal posed as the game poses it
// (stagePoser, src/game/animals.ts). No world, no wait for night, no hunting for a herd.
//   &sim=wolves-vs-deer   a hungry pack 120 m from a herd of five: up on them, the run, the chase, the kill, the meal
//   &sim=lockon           at night, a hungry pack and a survivor standing 55 m off: the lock-on and its howl, the walk
//                         in, the ring, one stopped snarling, the lunge
//   &seed=1  &night=1     the minds' dice; the other hour (day for the lock-on, night for the hunt)

import * as THREE from 'three';
import { A_DEAD, KINDS, type Biome } from '../sim/animals';
import { Herd, seeded, type Seen } from '../sim/animal-mind';
import type { Ground } from '../sim/animal-ground';
import { stagePoser } from '../game/animals';

/** the floor, to the animals: open grass everywhere, flat, nobody's, nothing in the way */
const FLAT: Ground = {
  height: () => 0, slope: () => 0, biome: (): Biome => 'field', open: () => true, road: () => 999,
  people: () => ({ town: 9999, camp: 9999, house: 9999 }), towers: [], roofed: () => false, cover: () => 0, clear: () => true,
  water: () => null, farms: [], bounds: { x0: -3000, x1: 3000, z0: -3000, z1: 3000 },
};

interface Row { i: number; k: number; x: number; z: number; yaw: number; mode: number; down: number; snarl: boolean }
interface Moment { t: number; what: string; rows: Row[]; look: [number, number][]; person?: [number, number] }

const STEP = 200;
const snap = (h: Herd, t: number): Row[] => [...h.beasts.values()].map((b) => ({ i: b.i, k: b.k, x: b.x, z: b.z, yaw: b.yaw, mode: b.mode, down: b.diedAt ? (t - b.diedAt) / 1000 : 0, snarl: b.snarlUntil > t }));
const at = (rows: Row[], ids: number[]) => rows.filter((r) => ids.includes(r.i)).map((r) => [r.x, r.z] as [number, number]);

/** a hungry pack and a herd of five 120 m apart, left to it */
function wolvesVsDeer(seed: number, night: boolean): Moment[] {
  const h = new Herd(FLAT, (k) => ['wolf', 'stag', 'doe'].includes(k.id), () => (night ? 0.85 : 0.3), seeded(seed));
  const deer = h.place('stag', 0, -120, 0, 5), pack = h.place('wolf', 0, 0, 0, 4), g = h.groups[pack[0].g];
  const herdIds = deer.map((b) => b.i), packIds = pack.map((b) => b.i);
  const all: { t: number; rows: Row[] }[] = [];
  let rushAt = 0, killAt = 0, target = 0;
  for (let t = 0; t <= 240_000 && (!killAt || t < killAt + 61_000); t += STEP) {
    // (a vanished watcher beside the pack keeps it awake, and is never noticed)
    const w: Seen = { id: 9, x: pack[0].x + 40, y: 0, z: pack[0].z, crouch: false, prone: false, speed: 0, ride: '', sheltered: false, unseen: true };
    h.tick(t, [w]);
    all.push({ t, rows: snap(h, t) });
    if (!rushAt && g.hunt?.rush) [rushAt, target] = [t, -g.hunt.foe];
    if (!killAt && g.meal) killAt = t;
  }
  if (!rushAt || !killAt) return [{ t: all.at(-1)!.t, what: `no kill (${rushAt ? 'ran at them' : 'never ran at them'})`, rows: all.at(-1)!.rows, look: at(all.at(-1)!.rows, [...packIds, ...herdIds]) }];
  const when = (t: number) => all.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  const living = (rows: Row[]) => rows.filter((r) => herdIds.includes(r.i) && !r.down).map((r) => r.i);
  const gap = (rows: Row[]) => {
    const o = rows.find((r) => r.i === target)!, w = rows.find((r) => r.i === nearest(rows, target, packIds))!;
    return Math.round(Math.hypot(o.x - w.x, o.z - w.z));
  };
  // (of `ids`, the one nearest `to`)
  const nearest = (rows: Row[], to: number, ids: number[]) => {
    const o = rows.find((r) => r.i === to)!, by = (r: Row) => Math.hypot(r.x - o.x, r.z - o.z);
    return rows.filter((r) => ids.includes(r.i)).sort((a, b) => by(a) - by(b))[0]?.i ?? to;
  };
  // (each framed on what it is about: the cells are small, and the whole chase is half a kilometre)
  const plan: [number, string | ((rows: Row[]) => string), (rows: Row[]) => number[]][] = [
    [0, 'a hungry pack (the herd 120 m off)', () => packIds],
    [rushAt / 2, 'up on them at a trot', () => packIds],
    [rushAt + 1000, 'it runs at them: the herd bolts', () => herdIds],
    [rushAt + (killAt - rushAt) * 0.35, (rows) => 'one singled out, ' + gap(rows) + ' m ahead of the nearest wolf', (rows) => [target, nearest(rows, target, packIds)]],
    [rushAt + (killAt - rushAt) * 0.8, (rows) => 'she tires: ' + gap(rows) + ' m', (rows) => [target, nearest(rows, target, packIds)]],
    [killAt + 3000, 'down: the pack stops', () => [...packIds, target]],
    [killAt + 20_000, 'the pack eats her where she fell', () => [...packIds, target]],
    [killAt + 20_000, (rows) => {
      const b = rows.find((r) => r.i === target)!, l = rows.filter((r) => living(rows).includes(r.i));
      return `the other ${l.length}, unharmed, ${Math.round(Math.min(...l.map((r) => Math.hypot(r.x - b.x, r.z - b.z))))} m on`;
    }, (rows) => [target, nearest(rows, target, living(rows))]],
  ];
  return plan.map(([t, what, look]) => {
    const s = when(t);
    return { t: s.t, what: typeof what === 'string' ? what : what(s.rows), rows: s.rows, look: at(s.rows, look(s.rows)) };
  });
}

/** at night (DayZ's wolves are "mostly found at night"), a hungry pack, and a survivor standing 55 m off where the wind carries them to it */
function lockOn(seed: number, night: boolean): Moment[] {
  const h = new Herd(FLAT, (k) => k.id === 'wolf', () => (night ? 0.3 : 0.85), seeded(seed));
  const pack = h.place('wolf', 0, 0, 0, 4), ids = pack.map((b) => b.i);
  const man: Seen = { id: 1, x: -44, y: 0, z: -33, crouch: false, prone: false, speed: 0, ride: '', sheltered: false };
  const all: { t: number; rows: Row[]; howl: boolean; bite: boolean }[] = [];
  for (let t = 0; t <= 40_000; t += STEP) {
    const turn = h.tick(t, [man]);
    all.push({ t, rows: snap(h, t), howl: turn.calls.some((c) => c.tell), bite: turn.strikes.length > 0 });
  }
  const first = (ok: (s: (typeof all)[number]) => boolean, from = 0) => all.find((s) => s.t >= from && ok(s));
  const howl = first((s) => s.howl), ring = first((s) => s.rows.every((r) => Math.hypot(r.x - man.x, r.z - man.z) < 21), howl?.t);
  const snarl = first((s) => s.rows.some((r) => r.snarl), howl?.t), bite = first((s) => s.bite, snarl?.t);
  const second = first((s) => s.rows.some((r) => r.snarl), (bite?.t ?? 0) + 1000);
  const plan: [(typeof all)[number] | undefined, string][] = [
    [all[0], 'night: a hungry pack; a survivor 55 m off'],
    [howl, 'locked on: one howl'],
    [howl && first((s) => s.t >= howl.t + 3000), 'in at a walk'],
    [ring, 'round them'],
    [snarl, 'one stops and snarls'],
    [bite, 'the lunge'],
    [bite && first((s) => s.t >= bite.t + 1600), 'back to the ring'],
    [second, 'the next one'],
  ];
  return plan.filter(([s]) => s).sort(([a], [b]) => a!.t - b!.t).map(([s, what]) => ({ t: s!.t, what, rows: s!.rows, look: [...at(s!.rows, ids), [man.x, man.z]], person: [man.x, man.z] as [number, number] }));
}

export const SIMS: Record<string, (seed: number, night: boolean) => Moment[]> = { 'wolves-vs-deer': wolvesVsDeer, lockon: lockOn };

/** the moments of `name`, each drawn in its own cell from a high camera framed on what matters in it */
export async function stageSim(name: string, s: {
  q: URLSearchParams; scene: THREE.Scene; renderer: THREE.WebGLRenderer; sun: THREE.DirectionalLight; floor: THREE.Object3D;
  cw: number; ch: number; cols: number; rows: number; say: (i: number, text: string) => void; body: () => Promise<THREE.Object3D>;
}) {
  const make = SIMS[name];
  if (!make) throw new Error(`no such sim: ${name} (${Object.keys(SIMS).join(', ')})`);
  const moments = make(+(s.q.get('seed') ?? 1), s.q.get('night') === '1');
  // each animal once, posed again for every moment
  const posers = new Map<number, Awaited<ReturnType<typeof stagePoser>>>();
  for (const r of moments.flatMap((m) => m.rows)) if (!posers.has(r.i)) {
    const p = await stagePoser(KINDS[r.k].id);
    if (p) p.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    posers.set(r.i, p);
    if (p) s.scene.add(p.root);
  }
  const person = moments.some((m) => m.person) ? await s.body() : null;
  if (person) s.scene.add(person);
  const camera = new THREE.PerspectiveCamera(30, s.cw / s.ch, 0.1, 2000);
  // (a floor as big as a chase: four kilometres, still a line every metre)
  const floor = s.floor as THREE.Mesh, grid = (floor.material as THREE.MeshStandardMaterial).map!;
  floor.geometry = new THREE.PlaneGeometry(4000, 4000);
  grid.repeat.set(400, 400);
  const dir = new THREE.Vector3(0.55, 0.85, 0.75).normalize();
  s.renderer.setScissorTest(true);
  moments.forEach((m, n) => {
    for (const [i, p] of posers) {
      const r = m.rows.find((o) => o.i === i);
      if (!p) continue;
      p.root.visible = !!r;
      if (!r) continue;
      p.root.position.set(r.x, 0, r.z);
      p.root.rotation.y = r.yaw;
      // (each at its own point in its gait, as a pack is never in step)
      p.pose(r.mode, r.mode === A_DEAD ? r.down : m.t / 1000 + i * 0.37);
    }
    if (person && m.person) person.position.set(m.person[0], 0, m.person[1]);
    // (framed on what matters in this moment, from high up, never closer than 14 m)
    const box = new THREE.Box3();
    for (const [x, z] of m.look) box.expandByPoint(new THREE.Vector3(x, 0, z)).expandByPoint(new THREE.Vector3(x, 1.5, z));
    box.expandByScalar(2);
    const mid = box.getCenter(new THREE.Vector3()), span = box.getSize(new THREE.Vector3()), big = Math.max(span.x, span.z);
    camera.position.copy(mid).addScaledVector(dir, Math.max(14, big * 1.9 + 8));
    camera.lookAt(mid);
    // (the floor and the sun's shadows go with it: the grid stays where it is in the world, a line every metre)
    s.floor.position.set(Math.round(mid.x / 10) * 10, 0, Math.round(mid.z / 10) * 10);
    s.sun.target.position.copy(mid);
    s.sun.position.copy(mid).add(new THREE.Vector3(6, 9, 4).multiplyScalar(Math.max(1, big / 15)));
    const reach = big * 0.8 + 6;
    Object.assign(s.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, far: reach * 6 });
    s.sun.shadow.camera.updateProjectionMatrix();
    s.scene.updateMatrixWorld(true);
    const vx = (n % s.cols) * s.cw, vy = (s.rows - 1 - Math.floor(n / s.cols)) * s.ch;
    s.renderer.setViewport(vx, vy, s.cw, s.ch);
    s.renderer.setScissor(vx, vy, s.cw, s.ch);
    s.renderer.render(s.scene, camera);
    s.say(n, `${(m.t / 1000).toFixed(1)} s · ${m.what}`);
  });
  return { sim: name, moments: moments.map((m) => ({ t: m.t / 1000, what: m.what })) };
}
