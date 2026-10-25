// The server: the animals (2026-10-23). It moves every one itself (src/sim/animal-mind.ts): five times a second the
// herds near anybody think, each player is told of the ones near them, and a blow from a bear or a wolf is
// dealt here. A shot on one is judged as a shot on the infected is; a body is gutted here, and what it gives falls on
// the ground by it, as loot does, for anyone there to take (DayZ).

import { Herd, type Seen } from '../src/sim/animal-mind';
import type { Ground } from '../src/sim/animal-ground';
import { ANIMALS, BLADES, CALLS, KINDS, KIND, yieldOf, type AnimalRow } from '../src/sim/animals';
import { phaseOf } from '../src/sim/daynight';
import { WEAPON_RULES, hitDamage, piercedBy, type HitZone } from '../src/sim/combat';
import { makeItem } from '../src/sim/items';
import { markMade } from '../src/sim/cooking';
import { F_CROUCH, F_PRONE, type C2S } from '../src/net/protocol';
import { HELI } from '../src/sim/heli';
import { inBunker } from '../src/sim/bunker';
import { judge, lyingBlast, type Vec3 } from '../src/sim/grenades';
import { JEEP } from '../src/sim/vehicles';
import { clients, num, send, type Client } from './players';
import { economy, log, world } from './index';
import { seatOf } from './acts';
import { dealt } from './checks';
import { away } from './gate';
import { mayHit } from './tags';

let ground: Ground;
export let herd: Herd;

/** Made once the world is (server/index.ts): every herd on its ground. ANIMALS=off for none. */
export function startAnimals() {
  ground = world.animalGround();
  herd = new Herd(ground, (k) => process.env.ANIMALS === 'all' || (process.env.ANIMALS !== 'off' && world.hasModel(k.model)), (now) => phaseOf(now / 1000));
  herd.populate(Date.now());
  log(`[animals] ${Object.entries(herd.counts()).map(([k, n]) => `${n} ${k}`).join(', ') || 'none (no models)'}`);
}

/** where each player was a moment ago, for how fast they are going */
const was = new Map<number, { x: number; z: number; t: number; v: number }>();
/** when each player last heard one of the herds' calls */
const heardAt = new Map<number, number>();
/** what each player was last told of each animal near them, so that one standing still is not told of again */
const toldOf = new Map<number, Map<number, string>>();
const rowKey = (row: AnimalRow) => row.slice(2).join(',');
let beat = 0;

/** a player as the animals know of them (null: nobody they can know of, dead or under the ground; a vanished admin is there and never noticed) */
function seenOf(c: Client, now: number): Seen | null {
  if (!c.alive) return null;
  const [x, y, z] = c.pose, flags = c.pose[5] ?? 0;
  if (world.castleUnder(x, y, z) || world.basementUnder(x, y, z) || world.caveUnder(x, y, z) || (world.bunker && inBunker(world.bunker, x, y + 1, z, 1))) return null;
  const w = was.get(c.id);
  let v = w?.v ?? 0;
  if (w && now - w.t >= 150) {
    v = Math.min(60, Math.hypot(x - w.x, z - w.z) / ((now - w.t) / 1000));
    was.set(c.id, { x, z, t: now, v });
  } else if (!w) was.set(c.id, { x, z, t: now, v: 0 });
  const at = seatOf(c);
  return {
    id: c.id, x, y, z, crouch: !!(flags & F_CROUCH), prone: !!(flags & F_PRONE), speed: v,
    ride: at ? (at.v.k === HELI.kind ? 'air' : 'car') : '',
    sheltered: ground.roofed(x, z),
    ...(c.power.hidden ? { unseen: true } : {}),
  };
}

/** Five times a second: the herds near anybody think; their blows land; each player is told of the animals near them. */
export function animalsTick(now: number) {
  const people: Seen[] = [];
  for (const c of clients.values()) {
    const s = seenOf(c, now);
    if (s) people.push(s);
  }
  for (const id of was.keys()) if (!clients.has(id)) was.delete(id);
  const turn = herd.tick(now, people);
  for (const s of turn.strikes) {
    const target = clients.get(s.on), b = herd.beasts.get(s.i);
    if (!target?.alive || !b || target.power.god || away(target)) continue;
    const kind = KINDS[b.k], len = Math.max(0.001, Math.hypot(target.pose[0] - s.from[0], target.pose[2] - s.from[1]));
    dealt(target, s.damage, 'torso', kind.id);
    send(target, { t: 'dmg', from: 0, amount: s.damage, zone: 'torso', w: kind.id, dir: [(target.pose[0] - s.from[0]) / len, 0, (target.pose[2] - s.from[1]) / len], bleed: s.bleed });
  }
  // what is heard of them: by whoever is within its carry, and nobody two of the herds' calls within CALLS.apart
  // seconds (an alarm, or a pack's howl as it locks on, is not held back: it says something)
  for (const k of turn.calls) {
    const reach = k.call === 'bark' ? CALLS.bark.heard : CALLS[k.call].heard;
    for (const c of clients.values()) {
      if (c.ws.readyState !== 1 || Math.hypot(c.pose[0] - k.x, c.pose[2] - k.z) > reach) continue;
      const says = k.call === 'bark' || !!k.tell;
      if (!says && now - (heardAt.get(c.id) ?? 0) < CALLS.apart * 1000) continue;
      if (!says) heardAt.set(c.id, now);
      send(c, { t: 'acall', i: k.i, c: k.call, x: Math.round(k.x * 10) / 10, z: Math.round(k.z * 10) / 10 });
    }
  }
  for (const id of heardAt.keys()) if (!clients.has(id)) heardAt.delete(id);
  // (every one within their reach that has changed since they were last told of it, five times a second, however far:
  // once a second it was beyond 140 m, and those were seen stop and jump; and all within reach once a second, so that
  // whatever has gone from it is dropped)
  const all = beat++ % 5 === 0;
  for (const c of clients.values()) {
    if (c.ws.readyState !== 1) continue;
    const rows = herd.rows(c.pose[0], c.pose[2], c.animalsFar ?? ANIMALS.told);
    let was = toldOf.get(c.id);
    if (!was) toldOf.set(c.id, (was = new Map()));
    const r = all ? rows : rows.filter((row) => was.get(row[0]) !== rowKey(row));
    if (all) was.clear();
    for (const row of r) was.set(row[0], rowKey(row));
    if (!r.length && !all) continue;
    send(c, { t: 'an', r, ...(all ? { all: true } : {}) });
  }
  for (const id of toldOf.keys()) if (!clients.has(id)) toldOf.delete(id);
}

/** a shot fired: everything within earshot of it hears it */
export function animalsHear(x: number, z: number, range: [number, number]) {
  herd.heard(x, z, range, Date.now());
}

/**
 * A shot, a blow, a blast or a car on an animal, judged as one on the infected is ('ihit' in server/handle.ts): a
 * blast of theirs held to what any is (`judge`), a car only from its driver's seat beside it, and the rest in range,
 * with what is in the hands, no faster than it fires. (2026-10-24: "all damage should work. like grenades".)
 */
export function animalHit(c: Client, m: Extract<C2S, { t: 'ahit' }>) {
  const b = herd.beasts.get(m.i), rule = WEAPON_RULES[m.w];
  if (!b || b.diedAt || !c.alive || !rule) return;
  if (!['head', 'torso', 'legs', 'arms'].includes(m.zone)) return;
  const now = Date.now(), d = Math.hypot(c.pose[0] - b.x, c.pose[2] - b.z);
  if (d > rule.range + 6) return;
  let amount: number, zone = m.zone;
  if (rule.blast) {
    if (!num(m.dist)) return;
    const chest: Vec3 = [b.x, ground.height(b.x, b.z) + KINDS[b.k].tall * 0.6, b.z];
    const far = m.w === 'barrel' ? (Math.min(...c.blasts.map((q) => now - q.at), Infinity) > 9000 ? null : Math.max(0, m.dist)) : judge(c.nades, m.w, `a${m.i}`, chest, m.dist, now);
    if (far === null) return;
    amount = hitDamage(m.w, 'torso', far);
    zone = 'torso';
  } else if (m.w === 'jeep') {
    const at = seatOf(c);
    if (!at || at.seat !== 0 || !num(m.dist) || Math.hypot(at.v.s[0] - b.x, at.v.s[2] - b.z) > 7) return;
    amount = Math.max(0, Math.min(m.dist, Math.hypot(at.v.s[7], at.v.s[8], at.v.s[9]) + 3) - JEEP.bumpFrom) * JEEP.bumpPer;
    zone = 'torso';
  } else {
    if (m.w !== 'fists' && c.w !== m.w) return;
    if (!mayHit(c, `a${m.i}`, now, rule.interval * 700)) return;
    c.lastHit = now;
    const n = typeof m.n === 'number' && Number.isFinite(m.n) ? Math.max(1, Math.min(12, Math.round(m.n))) : 1;
    amount = hitDamage(m.w, m.zone, d, !!m.sup, 0, n) * piercedBy(m.w, m.p);
  }
  told(m.i, herd.hurt(m.i, amount, seenOf(c, now), now), c.id, zone);
}

/** what a hit did, told to whoever can see it: its fall, its flinch */
function told(i: number, r: { hp: number; dead: boolean } | null, by: number, zone: HitZone) {
  const b = herd.beasts.get(i);
  if (!r || !b) return;
  for (const o of clients.values()) if (Math.hypot(o.pose[0] - b.x, o.pose[2] - b.z) < ANIMALS.told) send(o, { t: 'ahp', i, hp: Math.round(r.hp), dead: r.dead, by, zone });
}

/** A grenade gone off where it lay (`fellBlast` in server/gate.ts): every animal in its reach takes it, by how far it stands, as a body does. */
export function animalsBlast(by: Client, w: string, at: Vec3) {
  const now = Date.now();
  for (const b of [...herd.beasts.values()]) {
    if (b.diedAt) continue;
    const amount = lyingBlast(w, at, [b.x, ground.height(b.x, b.z) + KINDS[b.k].tall * 0.6, b.z]);
    if (amount > 0) told(b.i, herd.hurt(b.i, amount, seenOf(by, now), now), by.id, 'torso');
  }
}

/**
 * Gutting and skinning: begun with a blade in the hands at the body, and done six seconds later still there. What it
 * gives (by the blade: Rust) falls about the body. Half as much of a kill the wolves have been at.
 */
export function animalSkin(c: Client, m: Extract<C2S, { t: 'askin' }>) {
  if (!c.alive || typeof m.i !== 'number') return;
  const now = Date.now(), blade = c.w ? BLADES[c.w] : undefined;
  if (m.go === 1) {
    const why = blade ? herd.startSkin(m.i, c.id, c.pose[0], c.pose[2], now) : 'You need a blade in your hands: a knife, a machete or a hatchet.';
    send(c, { t: 'askin', i: m.i, ok: !why, ...(why ? { why } : {}) });
    return;
  }
  if (!blade) return;
  const done = herd.endSkin(m.i, c.id, c.pose[0], c.pose[2], now);
  if (!done) return;
  const y = world.standAt(done.x, c.pose[1] + 1, done.z);
  let k = 0;
  for (const [id, qty] of yieldOf(done.kind, blade, done.eaten)) {
    // (meat a piece at a time, as DayZ's steaks are; the rest a pile each)
    const pieces = KIND[done.kind.id] && id.startsWith('meat_') ? qty : 1;
    for (let p = 0; p < pieces; p++) {
      const it = markMade(makeItem(id, pieces > 1 ? 1 : qty), now / 1000);
      const a = (k++ / 6) * Math.PI * 2, r = 0.5 + (k % 3) * 0.3;
      economy.drop(it, done.x + Math.cos(a) * r, y + 0.03, done.z + Math.sin(a) * r, Math.random() * Math.PI * 2);
    }
  }
  send(c, { t: 'askin', i: m.i, ok: true, done: true });
}

/** An admin's `/del animal <number>` (the Delete key on one): taken out of the world. Its name; null, none of that number. */
export function takeAnimal(i: number): string | null {
  const b = herd.remove(i);
  return b ? KINDS[b.k].name : null;
}

/** An admin's `/delanimals [metres]`: every animal within so far of a place taken out of the world; how many */
export function takeAnimals(x: number, z: number, within: number): number {
  let n = 0;
  for (const b of [...herd.beasts.values()]) if (Math.hypot(b.x - x, b.z - z) <= within && herd.remove(b.i)) n++;
  return n;
}

/** An admin's `/spawn <kind> [n]` at a place: `n` of it as one herd or pack (how many were stood: 0, no such kind or no model for it) */
export function spawnAnimal(kind: string, x: number, z: number, n = 1): number {
  const k = KIND[kind];
  if (!k || !(process.env.ANIMALS === 'all' || world.hasModel(k.model))) return 0;
  return herd.place(kind, x, z, Date.now(), n).length;
}

