// Where the animals are (2026-10-23): the herds' ground, each one's place in its herd and room from the rest, and
// whether a place will do for one (src/sim/animal-mind.ts calls these for its own). The owner: "make sure animals dont
// spawn in impossible places", "animals dont spawn in towns they spawn in wilderness's", "they spawned inside
// eachother in the images".

import { ANIMALS, KIND, KINDS, type Biome, type HerdKind } from './animals';
import type { Beast, Group, Herd } from './animal-mind';

const PI2 = Math.PI * 2;

/**
 * How wild a place is for a herd's ground, or -1 where it will not do: ground it can stand on, with both what it feeds
 * on and cover to lie up in within its reach, off the roads and away from people (the owner: "animals dont spawn in
 * towns they spawn in wilderness's"). The further from people the wilder; and a herd that feeds in the open likes
 * ground a high seat looks over (the owner: "the only exception to the animal near building rule is hunting towers").
 */
export function groundFor(herd: Herd, h: HerdKind, x: number, z: number): number {
  const steep = Math.min(...h.of.map(([id]) => KIND[id].steep)), K = ANIMALS.keepOff, b = herd.ground.biome(x, z);
  if (!h.feed.includes(b) && !h.rest.includes(b)) return -1;
  if (!herd.ground.open(x, z, steep)) return -1;
  const road = herd.ground.road(x, z), near = herd.ground.people(x, z);
  if (road < K.road.home || near.town < K.town.home || near.camp < K.camp.home || near.house < K.house.home) return -1;
  let feed = 0, rest = 0;
  for (let n = 0; n < 16; n++) {
    const a = n * 2.39996, d = h.range * Math.sqrt((n + 0.5) / 16), c = herd.ground.biome(x + Math.cos(a) * d, z + Math.sin(a) * d);
    if (h.feed.includes(c)) feed++;
    if (h.rest.includes(c)) rest++;
  }
  if (feed < 4 || rest < 3) return -1;
  const seat = h.feed.includes('field') && herd.ground.towers.some((t) => Math.hypot(t.x - x, t.z - z) < h.range * 0.8 && herd.ground.biome(t.x + 40, t.z) === 'field');
  return Math.min(near.town, 1500) + 0.6 * Math.min(near.camp, 900) + 0.5 * Math.min(near.house, 600) + 0.3 * Math.min(road, 300) + (seat ? 500 : 0);
}

/** where the herds of a kind live: of all the places that will do, the wildest first, apart from each other */
export function* homesFor(herd: Herd, h: HerdKind, pick: () => number, out: { x: number; z: number }[]): Generator<void> {
  const { x0, x1, z0, z1 } = herd.ground.bounds;
  const found: { x: number; z: number; wild: number }[] = [];
  for (let tries = 0; tries < 3000; tries++) {
    if (tries % 25 === 24) yield;
    const x = x0 + 60 + pick() * (x1 - x0 - 120), z = z0 + 60 + pick() * (z1 - z0 - 120), wild = groundFor(herd, h, x, z);
    if (wild >= 0) found.push({ x, z, wild });
  }
  found.sort((a, b) => b.wild - a.wild);
  for (const f of found) {
    if (out.length >= h.count) break;
    if (!out.some((o) => Math.hypot(o.x - f.x, o.z - f.z) < h.apart)) out.push({ x: f.x, z: f.z });
  }
  // (two that live far apart, the bears: the wildest first took the middle, and nothing was left far enough from it.
  // The two wildest together that are far enough apart, then)
  if (h.count === 2 && out.length < 2) {
    let best = -1;
    for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) {
      const a = found[i], b = found[j];
      if (a.wild + b.wild > best && Math.hypot(a.x - b.x, a.z - b.z) >= h.apart) {
        best = a.wild + b.wild;
        out.splice(0, out.length, { x: a.x, z: a.z }, { x: b.x, z: b.z });
      }
    }
  }
}

/** its own kind of country (a cell called water may be the dry edge a herd drinks at: open() says where it is wet) */
export const onCountry = (lives: Biome[], b: Biome) => b === 'water' || lives.includes(b);

/**
 * whether a wild one may be sent to a place (`spot`: to feed or lie up there) or stand there (`walk`): ground it can
 * stand on, not water, off the roads, out of the towns; and a spot well away from people. A farm's are let be.
 */
export function fit(h: Herd, x: number, z: number, steep: number, as: 'spot' | 'walk', farm: boolean, lives?: Biome[]) {
  const b = h.ground.biome(x, z), K = ANIMALS.keepOff;
  if (!h.ground.open(x, z, steep) || (lives && !onCountry(lives, b))) return false;
  if (farm) return true;
  if (b === 'town' || h.ground.road(x, z) < K.road[as]) return false;
  if (as === 'walk') return true;
  const near = h.ground.people(x, z);
  return near.town >= K.town.spot && near.camp >= K.camp.spot && near.house >= K.house.spot;
}

/** room for two, centre to centre (`herd`: of one herd) */
export function room(a: number, b: number, herd: boolean) {
  return (KINDS[a].len + KINDS[b].len) * (herd ? ANIMALS.room.herd : ANIMALS.room.other);
}

/**
 * Its place in the herd, off the herd's spot: the first free one along a sunflower spiral, so that no two places
 * ever fall within room of each other (they were thrown at random, and two herd mates stood in one another).
 */
export function slotFor(h: Herd, g: Group, k: number, ok?: (x: number, z: number) => boolean): [number, number] {
  const taken = g.members.map((i) => h.beasts.get(i)!).filter((o) => !o.diedAt);
  if (!taken.length && g.wants.length <= 1) return [0, 0];
  const turn = (g.i * 2.39996) % PI2;
  for (let n = 0; n < 64; n++) {
    const r = KINDS[k].len * 1.05 * Math.sqrt(n + 0.5), a = turn + n * 2.39996;
    const s: [number, number] = [Math.cos(a) * r, Math.sin(a) * r];
    if (taken.every((o) => Math.hypot(o.slot[0] - s[0], o.slot[1] - s[1]) >= room(o.k, k, true)) && (!ok || ok(g.at.x + s[0], g.at.z + s[1]))) return s;
  }
  return [0, 0];
}

/**
 * Once a whole herd has moved: any two of it still closer than their room are put apart, half the gap each, where
 * they can stand (each one's own step already pushes it off those that moved before it; this is for the order they
 * moved in: a herd bolting together at 11 m/s came within 0.41 of their two lengths for a step)
 */
export function apart(h: Herd, living: Beast[]) {
  for (let n = 0; n < 2; n++) {
    for (let i = 0; i < living.length; i++) {
      const a = living[i];
      if (KINDS[a.k].still) continue;
      for (let j = i + 1; j < living.length; j++) {
        const o = living[j], dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz), need = room(a.k, o.k, true);
        if (d >= need || d < 0.01 || KINDS[o.k].still) continue;
        const push = (need - d) / 2, ux = dx / d, uz = dz / d;
        if (h.ground.open(a.x + ux * push, a.z + uz * push, KINDS[a.k].steep) && onCountry(KINDS[a.k].lives, h.ground.biome(a.x + ux * push, a.z + uz * push))) {
          a.x += ux * push;
          a.z += uz * push;
        }
        if (h.ground.open(o.x - ux * push, o.z - uz * push, KINDS[o.k].steep) && onCountry(KINDS[o.k].lives, h.ground.biome(o.x - ux * push, o.z - uz * push))) {
          o.x -= ux * push;
          o.z -= uz * push;
        }
      }
    }
  }
}

/** the nearest living one it stands too close to, and how far it should step to make room (null: it has room) */
export function crowd(h: Herd, b: Beast): { o: Beast; by: number } | null {
  let best: { o: Beast; by: number } | null = null;
  const hunts = (x: Beast) => KINDS[x.k].temper === 'pack' || KINDS[x.k].temper === 'bear';
  for (const o of h.beasts.values()) {
    // (a wolf at the deer it pulls down is meant to be on it)
    if (o === b || o.diedAt || (o.g !== b.g && (hunts(o) || hunts(b)))) continue;
    const ox = b.x - o.x, oz = b.z - o.z;
    if (Math.abs(ox) > 6 || Math.abs(oz) > 6) continue;
    const by = room(o.k, b.k, o.g === b.g) - Math.hypot(ox, oz);
    if (by > 0 && (!best || by > best.by)) best = { o, by };
  }
  return best;
}
