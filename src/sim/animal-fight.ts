// The animals that fight (2026-10-23): a bear's warning, rush and chase, and a wolf pack's hunt of whoever comes too
// near, and, hungry, of deer (src/sim/animal-mind.ts calls these for its own). The owner: "the bear should be dangerous,
// needs a paw swipe animation and bite for attacking, and basic ai etc... player should be able to outrun it if breaks
// line of sight and or isnt too close when the bear first engages".

import { ANIMALS, A_ALERT, A_GRAZE, A_IDLE, A_ROAR, KINDS, smellReach, yawTo, type Kind } from './animals';
import type { Beast, Group, Herd, Seen, Turn } from './animal-mind';
import { DAY } from './daynight';

const PI2 = Math.PI * 2;
const turnTo = (a: number, b: number, max: number) => a + Math.max(-max, Math.min(max, Math.atan2(Math.sin(b - a), Math.cos(b - a))));
const angleOff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
const isNight = (p: number) => p >= 0.73 || p < 0.02;
/** how near its middle comes to whoever it fights: its muzzle at them, not in them (a bear stopped 1.2 m off had its head through the man) */
const close = (k: Kind) => k.len / 2 + 0.45;
/**
 * Whoever it fights is up out of its reach (on a roof, a rock, in the air) or well below it: no blow lands (2026-10-24:
 * "when im flying the bear can hit me its ignoring height"). A bear stood up reaches its own height and most of a metre more.
 */
const outOfReach = (h: Herd, b: Beast, k: Kind, foe: Seen) => {
  const up = foe.y - h.ground.height(b.x, b.z);
  return up > k.tall + 0.9 || up < -1.5;
};
/** and with nothing solid between: "should not be able to hit me through walls" (2026-10-24) */
const unreached = (h: Herd, b: Beast, k: Kind, foe: Seen) => foe.sheltered || outOfReach(h, b, k, foe) || h.ground.walled(b.x, b.z, foe.x, foe.z);

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
    // (hurt, it comes at once, with no warning)
    b.warnUntil = foe === hurt ? now : now + f.warn * 1000;
    b.rushUntil = f.charge && foe !== hurt ? 0 : b.warnUntil + f.rushFor * 1000;
    b.move = null;
  }
  const foe = people.find((q) => q.id === b.foe);
  if (!foe || foe.ride || Math.hypot(b.x - b.fightX, b.z - b.fightZ) > f.leash) return giveUp(b, now, 20_000), false;
  const d = Math.hypot(foe.x - b.x, foe.z - b.z);
  const eye = h.ground.height(b.x, b.z) + k.tall;
  // (it sees whoever is in the open with no hill between; among trees not half so far: the way to lose a bear)
  const sees = d < 70 * (1 - 0.6 * h.ground.cover(foe.x, foe.z)) && h.ground.clear(b.x, eye, b.z, foe.x, foe.y + 1.2, foe.z);
  const high = outOfReach(h, b, k, foe);
  if (d < 6 || sees || d < smellReach(k, b.x, b.z, foe.x, foe.z) * 0.4) {
    // (one out of its reach above is no more within its grasp than one under a roof: it gives up on them as slowly)
    if (!foe.sheltered && !high) b.sensedAt = now;
    b.seenX = foe.x;
    b.seenZ = foe.z;
  }
  if (now - b.sensedAt > f.lose * (foe.sheltered || high ? 3 : 1) * 1000) return giveUp(b, now, 20_000), false;
  // (walking in: within `charge` of them, or hurt, and it rushes, from the end of its roar)
  if (!b.rushUntil && (d < f.charge! || (b.hurtBy && now - b.hurtAt < 1000))) b.rushUntil = Math.max(now, b.warnUntil) + f.rushFor * 1000;
  // (past its rush it keeps after them only so long, unless it is on them: a sprint begun far enough off gets away)
  if (b.rushUntil && now > b.rushUntil + f.chaseFor * 1000 && d > 6) return giveUp(b, now, 20_000), false;
  if (now < b.warnUntil) {
    b.yaw = turnTo(b.yaw, yawTo(foe.x - b.x, foe.z - b.z), 3 * dt);
    b.speed = 0;
    b.mode = A_ROAR;
    return true;
  }
  if (!b.rushUntil) {
    // (and whoever backs well off while it walks is let go)
    if (d > f.engage[1] + 12) return giveUp(b, now, 20_000), false;
    h.go(b, k, b.seenX, b.seenZ, f.stalk!, dt, close(k));
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
      if (!unreached(h, b, k, foe) && hd < m.reach + 0.6 && angleOff(b.yaw, yawTo(foe.x - b.x, foe.z - b.z)) < 1.3) {
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
  if (!moves.length || unreached(h, b, k, foe)) return false;
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

/** how long after a meal a pack is hungry again, milliseconds (ANIMALS.hunger.hours of the Zone's day) */
export const HUNGRY_MS = ANIMALS.hunger.hours * (DAY.length / 24) * 1000;

/**
 * A wolf, in its pack. DayZ's first (the owner, 2026-10-24: "only trying to enhance the exisitng dayz logic";
 * dayz.wiki.gg/wiki/Wolf): once it has found somebody it comes on quietly at a walk (at a run after whoever runs: they
 * cannot be outrun), circles them a dozen and more metres off and sends one in at a time from about the ring, which
 * stops and snarls before it lunges; the pack runs once three of it are dead, and turns on whoever shoots at it
 * running. Ours on top: it is fed or hungry. Fed, it lies up and goes only for whoever comes right up to it. Hungry,
 * it locks on to whoever comes inside its reach (further in the dark) with one howl (the owner: "start howling when
 * theyre locked in on people"), and with nobody about it goes for the nearest deer herd, runs at it, singles one out
 * and pulls it down; then the whole pack eats it where it fell (DayZ's wolves eat what they find dead), growls at
 * whoever comes near, and drives them off. A wolf hurt past bearing breaks off on its own (Rust).
 */
export function pack(h: Herd, b: Beast, g: Group, k: Kind, now: number, dt: number, people: Seen[], turn: Turn, from: Seen | null, phase: number): boolean {
  const f = k.fight!, H = ANIMALS.hunger, wolves = g.members.map((i) => h.beasts.get(i)!);
  const alive = wolves.filter((w) => !w.diedAt);
  // (shot at as it runs, it turns on them, and fights on: DayZ)
  if (g.brokeAt && !g.rallied && alive.some((w) => w.hurtBy && w.hurtAt > g.brokeAt)) {
    g.rallied = true;
    g.flee = null;
  }
  const broken = !g.rallied && wolves.length - alive.length >= Math.min(ANIMALS.packBreaks, wolves.length - 1);
  if (!broken && b.hp < k.hp * f.breakAt) {
    // (one hurt past bearing breaks off on its own, away from whoever hurt it; the rest fight on)
    const q = people.find((p) => p.id === (b.hurtBy || g.hunt?.foe));
    if (q) {
      b.fearX = q.x;
      b.fearZ = q.z;
    }
    const ax = b.x - b.fearX, az = b.z - b.fearZ, d = Math.hypot(ax, az) || 1;
    b.foe = 0;
    b.move = null;
    b.dashUntil = 0;
    h.go(b, k, b.x + (ax / d) * 30, b.z + (az / d) * 30, k.run, dt);
    return true;
  }
  if (broken) {
    // (the pack breaks: everybody runs, from whoever broke it)
    if (!g.brokeAt) g.brokeAt = now;
    const q = g.hunt && g.hunt.foe > 0 ? people.find((p) => p.id === g.hunt!.foe) : null;
    if (q) {
      b.fearX = q.x;
      b.fearZ = q.z;
    }
    g.hunt = null;
    g.meal = null;
    b.aware = 1;
    if (!g.flee) g.flee = { x: b.fearX, z: b.fearZ, until: now + (k.flee / k.run + 2) * 1000 };
    return false;
  }
  const hungry = now - g.ateAt > HUNGRY_MS;
  if (g.meal && !g.hunt) return eat(h, b, g, k, now, dt, people);
  if (!g.hunt) {
    const night = isNight(phase);
    const hurt = b.hurtBy && now - b.hurtAt < 10_000 ? people.find((q) => q.id === b.hurtBy) : undefined;
    const reach = hungry ? f.engage[night ? 1 : 0] : H.defend;
    const q = hurt ?? (from && b.aware >= ANIMALS.alert && Math.hypot(from.x - b.x, from.z - b.z) < reach ? from : undefined);
    if (q && !q.ride && !q.sheltered && now > b.calmUntil) {
      g.hunt = { foe: q.id, since: now, x: b.x, z: b.z };
      g.nextDash = now + 2500;
      // (DayZ's tell: the pack howls as it locks on, once, and then it comes. A fed pack seen off is not hunting.)
      if (hungry) turn.calls.push({ i: b.i, call: 'howl', x: b.x, z: b.z, tell: true });
    } else if (hungry && ANIMALS.huntsDeer && now > b.calmUntil) {
      let deer: Beast | undefined, best: number = H.scent;
      for (const o of h.beasts.values()) {
        const d = Math.hypot(o.x - b.x, o.z - b.z);
        if (!o.diedAt && d < best && (KINDS[o.k].id === 'doe' || KINDS[o.k].id === 'stag')) [deer, best] = [o, d];
      }
      if (deer) g.hunt = { foe: -deer.i, since: now, x: b.x, z: b.z };
    }
  }
  if (!g.hunt) return false;
  if (g.hunt.foe < 0) return chaseDeer(h, b, g, k, now, dt, turn, alive);
  const foe = people.find((q) => q.id === g.hunt!.foe);
  // (seen off its kill: as far as it drives them, and back to it)
  const off = g.hunt.guard && g.meal && foe ? Math.hypot(foe.x - g.meal.x, foe.z - g.meal.z) > H.guard : false;
  const lost = !foe || foe.ride || off || Math.hypot(b.x - g.hunt.x, b.z - g.hunt.z) > f.leash || now - g.hunt.since > 150_000;
  if (lost || (foe!.sheltered && now - b.sensedAt > 12_000)) {
    g.hunt = null;
    g.warnAt = 0;
    for (const w of alive) giveUp(w, now, off ? 0 : 30_000);
    return false;
  }
  const q = foe!, d = Math.hypot(q.x - b.x, q.z - b.z);
  if (!q.sheltered) b.sensedAt = now;
  b.foe = q.id;
  // one at a time, in turn, runs in
  if (now > g.nextDash && !alive.some((w) => w.dashUntil > now)) {
    // (from the ring, once it is there: none is sent in from far off)
    const order = alive.filter((w) => w.restUntil < now && w.hp >= k.hp * f.breakAt && Math.hypot(w.x - q.x, w.z - q.z) < ANIMALS.circle[1] + 6);
    const w = order[g.dasher++ % Math.max(1, order.length)];
    if (w) {
      w.snarlUntil = now + ANIMALS.snarl * 1000;
      w.dashUntil = w.snarlUntil + 3000;
    }
    g.nextDash = now + (ANIMALS.dash[0] + h.rnd() * (ANIMALS.dash[1] - ANIMALS.dash[0])) * 1000;
  }
  if (b.dashUntil > now || b.move) {
    if (b.snarlUntil > now) {
      // (stood, facing them, snarling: the moment to shoot it, as in DayZ)
      b.speed = 0;
      b.yaw = turnTo(b.yaw, yawTo(q.x - b.x, q.z - b.z), 4 * dt);
      b.mode = A_ALERT;
      return true;
    }
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
  // (from far off at a quiet walk, unless they run: DayZ's wolves come on at a walking pace, and are not outrun)
  h.go(b, k, tx, tz, d > R + 15 ? (q.speed > 3.5 ? f.chase : k.walk * 1.6) : k.trot, dt, 2);
  if (Math.hypot(tx - b.x, tz - b.z) < 2.5) {
    b.yaw = turnTo(b.yaw, yawTo(q.x - b.x, q.z - b.z), 3 * dt);
    b.mode = A_ALERT;
  }
  return true;
}

/**
 * A hungry pack after a deer herd: it trots up on the herd, runs at it from `rush` off, and the herd bolts; the deer
 * nearest the pack as it runs is the one it means to have, and the rest it lets go. The deer tires before a wolf does
 * (ANIMALS: its wind against theirs); one that gets clean away is let go, and the pack, hungry still, tries again.
 */
export function chaseDeer(h: Herd, b: Beast, g: Group, k: Kind, now: number, dt: number, turn: Turn, alive: Beast[]): boolean {
  const H = ANIMALS.hunger, hunt = g.hunt!;
  let deer = h.beasts.get(-hunt.foe);
  if (!deer || deer.diedAt || now - hunt.since > 120_000) {
    g.hunt = null;
    for (const w of alive) w.calmUntil = now + 60_000;
    return false;
  }
  if (!hunt.rush) {
    // up on them at a trot, together; from near enough, at them, and the one to have is the nearest
    if (Math.hypot(deer.x - b.x, deer.z - b.z) > H.rush) {
      h.go(b, k, deer.x, deer.z, k.trot, dt, 3);
      return true;
    }
    hunt.rush = true;
    hunt.since = now;
    let best = Infinity;
    for (const o of h.beasts.values()) {
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      if (!o.diedAt && o.g === deer.g && d < best) [deer, best] = [o, d];
    }
    hunt.foe = -deer.i;
  }
  deer.aware = 1;
  deer.fearX = b.x;
  deer.fearZ = b.z;
  h.go(b, k, deer.x, deer.z, k.run, dt, 0.5);
  if (Math.hypot(deer.x - b.x, deer.z - b.z) < 1.8) {
    // down: the pack stops where it is, and the herd runs on without it
    h.die(deer, now, b);
    deer.eaten = true;
    turn.died.push(deer.i);
    g.hunt = null;
    g.meal = { i: deer.i, x: deer.x, z: deer.z, since: now };
  }
  return true;
}

/**
 * The pack at its kill: each at its own place round it, eating, for ANIMALS.hunger.eat seconds, and then fed. Whoever
 * comes near is growled at; whoever stays, or comes close, is gone for and driven off it.
 */
function eat(h: Herd, b: Beast, g: Group, k: Kind, now: number, dt: number, people: Seen[]): boolean {
  const H = ANIMALS.hunger, meal = g.meal!, body = h.beasts.get(meal.i);
  const done = now - meal.since > H.eat * 1000;
  if (done || !body || body.skinner) {
    // (fed as much as it ate)
    g.ateAt = now - HUNGRY_MS * (1 - Math.min(1, (now - meal.since) / (H.eat * 1000)));
    g.meal = null;
    g.warnAt = 0;
    g.spot = 'rest';
    g.nextSpot = now + 240_000;
    return false;
  }
  let near: Seen | undefined, nd: number = H.growl;
  for (const q of people) {
    const d = Math.hypot(q.x - meal.x, q.z - meal.z);
    if (!q.ride && d < nd) [near, nd] = [q, d];
  }
  if (!near) g.warnAt = 0;
  else if (!g.warnAt) g.warnAt = now;
  if (near && (nd < H.drive || now - g.warnAt > H.warn * 1000) && !near.sheltered) {
    g.hunt = { foe: near.id, since: now, x: meal.x, z: meal.z, guard: true };
    g.nextDash = now;
    return true;
  }
  // its own place round the body, facing it
  const n = g.members.indexOf(b.i), a = (n / Math.max(1, g.members.length)) * PI2 + 0.4;
  const tx = meal.x + Math.cos(a) * 1.5, tz = meal.z + Math.sin(a) * 1.5;
  if (Math.hypot(tx - b.x, tz - b.z) > 0.6) {
    h.go(b, k, tx, tz, k.trot, dt, 0.4);
    return true;
  }
  b.speed = 0;
  if (near) {
    // (head up at them, growling)
    b.yaw = turnTo(b.yaw, yawTo(near.x - b.x, near.z - b.z), 3 * dt);
    b.mode = A_ALERT;
  } else {
    b.yaw = turnTo(b.yaw, yawTo(meal.x - b.x, meal.z - b.z), 3 * dt);
    b.mode = A_GRAZE;
  }
  return true;
}
