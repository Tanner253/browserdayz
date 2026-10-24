// The server: the animals (2026-10-23). It moves every one itself (src/sim/animal-mind.ts): five times a second the
// herds near anybody think, each player is told of the ones near them, and a blow from a bear or a wolf is
// dealt here. A shot on one is judged as a shot on the infected is; a body is gutted here, and what it gives falls on
// the ground by it, as loot does, for anyone there to take (DayZ).

import { Herd, type Seen } from '../src/sim/animal-mind';
import type { Ground } from '../src/sim/animal-ground';
import { ANIMALS, BLADES, CALLS, KINDS, KIND, yieldOf } from '../src/sim/animals';
import { phaseOf } from '../src/sim/daynight';
import { WEAPON_RULES, hitDamage, piercedBy } from '../src/sim/combat';
import { makeItem } from '../src/sim/items';
import { markMade } from '../src/sim/cooking';
import { F_CROUCH, F_PRONE, type C2S } from '../src/net/protocol';
import { HELI } from '../src/sim/heli';
import { inBunker } from '../src/sim/bunker';
import { clients, send, type Client } from './players';
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
  // seconds (an alarm is not held back: it says something)
  for (const k of turn.calls) {
    const reach = k.call === 'bark' ? CALLS.bark.heard : CALLS[k.call].heard;
    for (const c of clients.values()) {
      if (c.ws.readyState !== 1 || Math.hypot(c.pose[0] - k.x, c.pose[2] - k.z) > reach) continue;
      if (k.call !== 'bark' && now - (heardAt.get(c.id) ?? 0) < CALLS.apart * 1000) continue;
      if (k.call !== 'bark') heardAt.set(c.id, now);
      send(c, { t: 'acall', i: k.i, c: k.call, x: Math.round(k.x * 10) / 10, z: Math.round(k.z * 10) / 10 });
    }
  }
  for (const id of heardAt.keys()) if (!clients.has(id)) heardAt.delete(id);
  // (near ones every time; all within reach once a second, so that whatever has gone from it is dropped)
  const all = beat++ % 5 === 0;
  for (const c of clients.values()) {
    if (c.ws.readyState !== 1) continue;
    const r = herd.rows(c.pose[0], c.pose[2], all ? ANIMALS.told : ANIMALS.near);
    if (!r.length && !all) continue;
    send(c, { t: 'an', r, ...(all ? { all: true } : {}) });
  }
}

/** a shot fired: everything within earshot of it hears it */
export function animalsHear(x: number, z: number, range: [number, number]) {
  herd.heard(x, z, range, Date.now());
}

/** A shot or a blow on an animal, judged as one on the infected is: in range, with what is in the hands, no faster than it fires. */
export function animalHit(c: Client, m: Extract<C2S, { t: 'ahit' }>) {
  const b = herd.beasts.get(m.i), rule = WEAPON_RULES[m.w];
  if (!b || b.diedAt || !c.alive || !rule || rule.blast) return;
  if (!['head', 'torso', 'legs', 'arms'].includes(m.zone)) return;
  const now = Date.now(), d = Math.hypot(c.pose[0] - b.x, c.pose[2] - b.z);
  if (d > rule.range + 6) return;
  if (m.w !== 'fists' && c.w !== m.w) return;
  if (!mayHit(c, `a${m.i}`, now, rule.interval * 700)) return;
  c.lastHit = now;
  const n = typeof m.n === 'number' && Number.isFinite(m.n) ? Math.max(1, Math.min(12, Math.round(m.n))) : 1;
  const amount = hitDamage(m.w, m.zone, d, !!m.sup, 0, n) * piercedBy(m.w, m.p);
  const r = herd.hurt(m.i, amount, seenOf(c, now), now);
  if (!r) return;
  // (told to whoever can see it: its fall, its flinch)
  for (const o of clients.values()) if (Math.hypot(o.pose[0] - b.x, o.pose[2] - b.z) < ANIMALS.told) send(o, { t: 'ahp', i: m.i, hp: Math.round(r.hp), dead: r.dead, by: c.id, zone: m.zone });
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
  for (const [id, qty] of yieldOf(done.kind, blade * (done.eaten ? 0.5 : 1))) {
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

/** An admin's `/spawn <kind> [n]` at a place: `n` of it as one herd or pack (how many were stood: 0, no such kind or no model for it) */
export function spawnAnimal(kind: string, x: number, z: number, n = 1): number {
  const k = KIND[kind];
  if (!k || !(process.env.ANIMALS === 'all' || world.hasModel(k.model))) return 0;
  return herd.place(kind, x, z, Date.now(), n).length;
}

