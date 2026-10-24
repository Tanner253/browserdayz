// The animals that fight (2026-10-23): a bear's warning, rush and chase, and a wolf pack's hunt,
// of whoever comes too near (src/sim/animal-mind.ts calls these for its own). The owner: "the bear should be dangerous,
// needs a paw swipe animation and bite for attacking, and basic ai etc... player should be able to outrun it if breaks
// line of sight and or isnt too close when the bear first engages".

import { ANIMALS, A_ALERT, A_GRAZE, A_IDLE, A_ROAR, KINDS, smellReach, yawTo, type Kind } from './animals';
import type { Beast, Group, Herd, Seen, Turn } from './animal-mind';

const PI2 = Math.PI * 2;
const turnTo = (a: number, b: number, max: number) => a + Math.max(-max, Math.min(max, Math.atan2(Math.sin(b - a), Math.cos(b - a))));
const angleOff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
const isNight = (p: number) => p >= 0.73 || p < 0.02;
/** how near its middle comes to whoever it fights: its muzzle at them, not in them (a bear stopped 1.2 m off had its head through the man) */
const close = (k: Kind) => k.len / 2 + 0.45;

/**
 * A bear: the warning, the rush, the chase, the blows, and giving up. A bear that
 * has lost sight and smell of whoever it was after for `lose` seconds, or been led `leash` metres off, gives up;
 * so does one whose quarry has got under a roof or into a car.
 */
export function fighter(h: Herd, b: Beast, k: Kind, now: number, dt: number, people: Seen[], turn: Turn, from: Seen | null): boolean {
  const f = k.fight!;
  if (b.hp < k.hp * f.breakAt) {
    // hurt enough to break off (Rust): it runs, and fights nobody for a minute
    if (b.foe) giveUp(b, now, 60_000);
    return false;
  }
  if (!b.foe) {
    if (now < b.calmUntil) return false;
    const hurt = b.hurtBy && now - b.hurtAt < 8000 ? people.find((q) => q.id === b.hurtBy) : undefined;
    const night = isNight(h.phase(now));
    const near = from && !from.ride && !from.sheltered && b.aware >= (k.temper === 'bear' ? ANIMALS.alert : ANIMALS.fleeAt) && Math.hypot(from.x - b.x, from.z - b.z) < f.engage[night ? 1 : 0] ? from : undefined;
    const foe = hurt && !hurt.ride && Math.hypot(hurt.x - b.x, hurt.z - b.z) < (k.temper === 'bear' ? 60 : f.engage[1]) ? hurt : near;
    if (!foe) return false;
    b.foe = foe.id;
    b.fightAt = now;
    b.fightX = b.x;
    b.fightZ = b.z;
    b.sensedAt = now;
    b.seenX = foe.x;
    b.seenZ = foe.z;
    b.warnUntil = now + f.warn * 1000;
    b.rushUntil = b.warnUntil + f.rushFor * 1000;
    b.move = null;
  }
  const foe = people.find((q) => q.id === b.foe);
  if (!foe || foe.ride || Math.hypot(b.x - b.fightX, b.z - b.fightZ) > f.leash) return giveUp(b, now, 20_000), false;
  const d = Math.hypot(foe.x - b.x, foe.z - b.z);
  const eye = h.ground.height(b.x, b.z) + k.tall;
  // (it sees whoever is in the open with no hill between; among trees not half so far: the way to lose a bear)
  const sees = d < 70 * (1 - 0.6 * h.ground.cover(foe.x, foe.z)) && h.ground.clear(b.x, eye, b.z, foe.x, foe.y + 1.2, foe.z);
  if (d < 6 || sees || d < smellReach(k, b.x, b.z, foe.x, foe.z) * 0.4) {
    if (!foe.sheltered) b.sensedAt = now;
    b.seenX = foe.x;
    b.seenZ = foe.z;
  }
  if (now - b.sensedAt > f.lose * (foe.sheltered ? 3 : 1) * 1000) return giveUp(b, now, 20_000), false;
  // (past its rush it keeps after them only so long, unless it is on them: a sprint begun far enough off gets away)
  if (now > b.rushUntil + f.chaseFor * 1000 && d > 6) return giveUp(b, now, 20_000), false;
  if (now < b.warnUntil) {
    b.yaw = turnTo(b.yaw, yawTo(foe.x - b.x, foe.z - b.z), 3 * dt);
    b.speed = 0;
    b.mode = A_ROAR;
    return true;
  }
  const pace = now < b.rushUntil ? f.rush : f.chase;
  if (blows(h, b, k, foe, now, dt, turn, pace)) return true;
  h.go(b, k, b.seenX, b.seenZ, pace, dt, foe.sheltered ? 3 : close(k));
  return true;
}

/**
 * A blow wound up, and landing (or missing: whoever got out of reach in the windup is not hit). It lunges as it
 * swings, at the pace it was going, and slows after. True while it is at it.
 */
export function blows(h: Herd, b: Beast, k: Kind, foe: Seen, now: number, dt: number, turn: Turn, pace: number): boolean {
  const d = Math.hypot(foe.x - b.x, foe.z - b.z);
  if (b.move) {
    const mode = b.move.mode;
    if (d > close(k)) h.go(b, k, foe.x, foe.z, pace, dt, close(k));
    b.yaw = turnTo(b.yaw, yawTo(foe.x - b.x, foe.z - b.z), 2.4 * dt);
    b.mode = mode;
    if (now >= b.moveAt) {
      const m = b.move, hd = Math.hypot(foe.x - b.x, foe.z - b.z);
      b.move = null;
      b.restUntil = now + m.recover * 1000;
      if (!foe.sheltered && hd < m.reach + 0.6 && angleOff(b.yaw, yawTo(foe.x - b.x, foe.z - b.z)) < 1.3) {
        turn.strikes.push({ i: b.i, on: foe.id, damage: Math.round(m.damage * (0.85 + h.rnd() * 0.3)), bleed: h.rnd() < m.bleed, mode: m.mode, from: [b.x, b.z] });
      }
    }
    return true;
  }
  if (now < b.restUntil) {
    if (d > close(k) + 0.3) h.go(b, k, foe.x, foe.z, pace * 0.35, dt, close(k) + 0.3);
    else {
      b.speed = 0;
      b.mode = A_IDLE;
    }
    return true;
  }
  // (it starts its swing as it closes, by as much as it covers in the windup)
  const moves = k.fight!.moves.filter((m) => d < m.reach + pace * m.windup * 0.6);
  if (!moves.length || foe.sheltered) return false;
  let r = h.rnd() * moves.reduce((a, m) => a + m.weight, 0);
  const m = moves.find((mm) => (r -= mm.weight) < 0) ?? moves[0];
  b.move = m;
  b.moveAt = now + m.windup * 1000;
  if (d > close(k)) h.go(b, k, foe.x, foe.z, pace, dt, close(k));
  b.mode = m.mode;
  return true;
}

export function giveUp(b: Beast, now: number, calm: number) {
  b.foe = 0;
  b.move = null;
  b.calmUntil = now + calm;
  b.aware = Math.min(b.aware, ANIMALS.alert * 0.8);
}

/**
 * A wolf, in its pack. The pack hunts whoever comes inside its reach (further in the dark): it circles them a dozen
 * and more metres off and sends one in at a time to bite and break away (so it can be fought, and is not a swarm),
 * until half the pack is down, the quarry is under a roof or in a car, or it loses them. At night, with nobody to
 * hunt, it runs down a deer now and then, and stands over the kill.
 */
export function pack(h: Herd, b: Beast, g: Group, k: Kind, now: number, dt: number, people: Seen[], turn: Turn, from: Seen | null, phase: number): boolean {
  const f = k.fight!, wolves = g.members.map((i) => h.beasts.get(i)!);
  const alive = wolves.filter((w) => !w.diedAt);
  if (alive.length * 2 < wolves.length || b.hp < k.hp * f.breakAt) {
    // (the pack breaks: everybody runs, from whoever broke it)
    const q = g.hunt && g.hunt.foe > 0 ? people.find((p) => p.id === g.hunt!.foe) : null;
    if (q) {
      b.fearX = q.x;
      b.fearZ = q.z;
    }
    g.hunt = null;
    b.aware = 1;
    if (!g.flee) g.flee = { x: b.fearX, z: b.fearZ, until: now + (k.flee / k.run + 2) * 1000 };
    return false;
  }
  if (!g.hunt) {
    const night = isNight(phase);
    const hurt = b.hurtBy && now - b.hurtAt < 10_000 ? people.find((q) => q.id === b.hurtBy) : undefined;
    const q = hurt ?? (from && b.aware >= ANIMALS.alert && Math.hypot(from.x - b.x, from.z - b.z) < f.engage[night ? 1 : 0] ? from : undefined);
    if (q && !q.ride && !q.sheltered && now > b.calmUntil) {
      g.hunt = { foe: q.id, since: now, x: b.x, z: b.z };
      g.nextDash = now + 2500;
    } else if (night && ANIMALS.huntsDeer && g.huntedDay !== Math.floor(now / 1920_000)) {
      const deer = [...h.beasts.values()].find((o) => !o.diedAt && (KINDS[o.k].id === 'doe' || KINDS[o.k].id === 'stag') && Math.hypot(o.x - b.x, o.z - b.z) < 90);
      if (deer) g.hunt = { foe: -deer.i, since: now, x: b.x, z: b.z };
    }
  }
  if (!g.hunt) return false;
  if (g.hunt.foe < 0) return chaseDeer(h, b, g, k, now, dt, turn);
  const foe = people.find((q) => q.id === g.hunt!.foe);
  const lost = !foe || foe.ride || Math.hypot(b.x - g.hunt.x, b.z - g.hunt.z) > f.leash || now - g.hunt.since > 150_000;
  if (lost || (foe!.sheltered && now - b.sensedAt > 12_000)) {
    g.hunt = null;
    for (const w of alive) giveUp(w, now, 30_000);
    return false;
  }
  const q = foe!, d = Math.hypot(q.x - b.x, q.z - b.z);
  if (!q.sheltered) b.sensedAt = now;
  b.foe = q.id;
  // one at a time, in turn, runs in
  if (now > g.nextDash && !alive.some((w) => w.dashUntil > now)) {
    const order = alive.filter((w) => w.restUntil < now);
    const w = order[g.dasher++ % Math.max(1, order.length)];
    if (w) w.dashUntil = now + 3000;
    g.nextDash = now + (ANIMALS.dash[0] + h.rnd() * (ANIMALS.dash[1] - ANIMALS.dash[0])) * 1000;
  }
  if (b.dashUntil > now || b.move) {
    if (blows(h, b, k, q, now, dt, turn, f.rush)) {
      if (!b.move) b.dashUntil = 0;
      return true;
    }
    h.go(b, k, q.x, q.z, f.rush, dt, close(k));
    return true;
  }
  // round them, each at its own place on the ring, the ring turning
  const n = alive.indexOf(b), a = (n / alive.length) * PI2 + now / 9000, R = ANIMALS.circle[0] + (n % 2) * (ANIMALS.circle[1] - ANIMALS.circle[0]);
  const tx = q.x + Math.cos(a) * R, tz = q.z + Math.sin(a) * R;
  h.go(b, k, tx, tz, d > R + 15 ? f.chase : k.trot, dt, 2);
  if (Math.hypot(tx - b.x, tz - b.z) < 2.5) {
    b.yaw = turnTo(b.yaw, yawTo(q.x - b.x, q.z - b.z), 3 * dt);
    b.mode = A_ALERT;
  }
  return true;
}

export function chaseDeer(h: Herd, b: Beast, g: Group, k: Kind, now: number, dt: number, turn: Turn): boolean {
  const deer = h.beasts.get(-g.hunt!.foe);
  if (!deer || now - g.hunt!.since > 60_000) {
    g.hunt = null;
    g.huntedDay = Math.floor(now / 1920_000);
    return false;
  }
  if (deer.diedAt) {
    // standing over the kill
    if (Math.hypot(deer.x - b.x, deer.z - b.z) > 3) h.go(b, k, deer.x, deer.z, k.trot, dt);
    else {
      b.speed = 0;
      b.mode = A_GRAZE;
    }
    if (now - deer.diedAt > 90_000) {
      g.hunt = null;
      g.huntedDay = Math.floor(now / 1920_000);
    }
    return true;
  }
  deer.aware = 1;
  deer.fearX = b.x;
  deer.fearZ = b.z;
  h.go(b, k, deer.x, deer.z, k.run, dt);
  if (Math.hypot(deer.x - b.x, deer.z - b.z) < 1.8) {
    h.die(deer, now, b);
    deer.eaten = true;
    turn.died.push(deer.i);
  }
  return true;
}
