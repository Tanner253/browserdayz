// The server: handle, every message a player sends, checked and acted on.
// (One part of index.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { holdOnlyEmpties } from '../src/sim/inventory';
import { ITEMS, GEAR_SLOTS, holds, TAG_HOLD, type ItemInstance } from '../src/sim/items';
import { BURY, noBurying } from '../src/sim/stash';
import { CALL } from '../src/sim/drops';
import { ANIMALS } from '../src/sim/animals';
import { WEAPON_RULES, hitDamage, piercedBy } from '../src/sim/combat';
import { THROWN, LAUNCHED, pullPin, letGo, judge, launch } from '../src/sim/grenades';
import { BARREL } from '../src/sim/barrels';
import { JEEP, POLICE_CAR, SEATS, carDamage, crashDamage } from '../src/sim/vehicles';
import { HELI, heliCrash, seatsOf } from '../src/sim/heli';
import { INFECTED, guarded } from '../src/sim/infected';
import { EMOTE, EMOTE_GAP, SHOUT_RANGE } from '../src/sim/emotes';
import { bloodOf, bleedOf } from '../src/sim/blood';
import { type C2S, F_DEAD, F_SEAT, type S2C, ACTS, type Slung, F_GUARD, MAX_STAMINA, type StashInfo, type StoredItem, CHAT_RANGE, type ZedSpot } from '../src/net/protocol';
import { FIRE } from '../src/sim/fires';
import { FUEL } from '../src/sim/cooking';
import { BARREL_RESPAWN, barrelsGone, boxes, cargoOf, doors, economy, hearths, horde, invented, isVState, issue, log, stashItem, stoppingNow, takeOut, tellSeats, things, vehicles, world } from './index';
import { TAG_FRESH_MS, tagTime, CARD_GRACE_MS, CASH_HOLD_MS, SAID_BY_ITSELF, bunkerDoor, cardSeen, carriedTags, carries, isWallet, lootedTags, mayHit, namesOf, notEarned, pairPaidAt, recordCashIn, seenOf, tagSeen, theirOwn, voided } from './tags';
import { CHECK, CHECKS, bodyCheck, buried, dealt, flag, gaitCheck, hillBetween, moveCheck, takenTag, touched, underCheck, zoneCheck } from './checks';
import { ADMIN, LOGOUT_MS, LOGOUT_STIR, away, handBlast, keptOffNow, pockets, roleOf, stayOn } from './gate';
import { shortDevice } from './device';
import { KEPT, sys } from './keep';
import { elite } from './elite';
import { perks } from './perks';
import { plating } from './plates';
import { storeOrder } from './store-admin';
import { baited, banId, command, login, offId } from './admin';
import { roleRows } from './roles';

/** how far a thing lying about may be from somebody for them to go through it with their pockets ('lopen'): their game shows what is within 2.3 m of them (Game.around), and the server's place for them is a step behind */
const LYING_REACH = 4;
import { broadcast, broadcastNear, cleanInventory, cleanItem, cleanStored, clients, isPose, isVec3, num, pickSpawn, records, send, type Client } from './players';
import { shotHeard } from '../src/sim/heard';
import { findCarried, hurtJeep, infectedBody, kill, leaveSeat, releaseLock, seatOf } from './acts';
import { cameTo, holdsTag, keepToTheirs, payingTags, wentFrom } from './custody';
import { boxItems, boxOps, boxSet, goneFrom, hasOpen, laidIn, lyingOps, lyingSet, mayPeek, openIt, refusedNow, shutIt } from './searched';
import { scores } from './queue';
import { partyAct, partyCommand } from './party';
import { sendDrop } from './drops';
import { seen } from './seen';
import { pinned } from './pinned';
import { stashBuriedNear } from './stash-sight';
import { hidden } from './storages';
import { espAnswer, espRows } from './esp';
import { landing, tossed } from './throws';
import { aimWatch, looked } from './aimwatch';
import { animalHit, animalSkin, animalsHear, herd } from './animals';
import { chop, keepWear, mine, saw } from './gather';
import { craft } from './craft';
import { hammer, lay, owing, print, sightFor, takeDown } from './build';
import { blastFrom, blastWalled, stepWalled, walled, zoneAt } from './solid';
import { knock, swing } from './doors';
import { tellBeds, wakeAt } from './beds';
import { code as lockCode, cutKey, fit as fitLock, lockLets, onOff as lockOnOff, unfit as unfitLock } from './locks';
import { join as joinClaim } from './claims';
import { POISON } from '../src/sim/sickness';

export function handle(c: Client, m: C2S) {
  // anything a person does counts as being there; what the game reports on its own does not
  // (What the game reports on its own: where it stands, what it carries and wears, a ping; and, for whichever game
  // moves them, where the infected and the jeeps near it are. Those last were counted as something a person did
  // until 2026-10-13: anybody within reach of an infected was never away, however long their hands were off the
  // keys, and was never looked at by the check below.)
  if (!SAID_BY_ITSELF.has(m.t)) {
    c.activeAt = c.handAt = c.check.acted = Date.now();
    // (and whoever is doing things is not a body being walked up and down: see gaitCheck, bodyCheck)
    c.check.gait = undefined;
  }
  switch (m.t) {
    case 's': {
      if (!isPose(m.p)) return;
      // (a step, or a turn of the head)
      const was = c.pose;
      // (A game still dead on its own screen, while this server has it alive again: what it sent from where it fell
      // before it heard it was back. Taken in the moment after coming back, when anything is, it put them back by
      // their body; their first steps at the start were hundreds of metres from it, refused fifty times in three
      // seconds, and they were put off the server (2026-10-19: "moved 745 m in 2.36 s on foot").)
      if (c.alive && m.p[5] & F_DEAD) m.p = [was[0], was[1], was[2], m.p[3], m.p[4], m.p[5]];
      {
        const stepped = Math.abs(m.p[0] - was[0]) + Math.abs(m.p[2] - was[2]) > 0.02, turned = Math.abs(m.p[3] - was[3]) + Math.abs(m.p[4] - was[4]) > 0.004;
        if (stepped || turned) c.activeAt = Date.now();
        // (carried in a seat is not their own doing: see zoneCheck)
        if (turned || (stepped && !(m.p[5] & F_SEAT))) c.handAt = Date.now();
      }
      // (somewhere they cannot have got to: they are kept where they were, and only the way they look is taken)
      // (heard from again after the server kept their life for them: its figure is the figure)
      if (c.kept) {
        c.kept = false;
        c.bled = 0;
        if (c.alive && c.vitals) send(c, { t: 'hp', health: c.vitals.health, bleeding: !!c.vitals.bleeding, blood: bloodOf(c.vitals), bleed: c.vitals.bleeding ? bleedOf(c.vitals) : 0 });
      }
      c.heardAt = Date.now();
      // (their first move in the world: they have played today, for the door's count)
      if (!c.spoke) seen.mark(c.key);
      c.spoke = true;
      if (c.logoutAt && Math.hypot(m.p[0] - c.logoutFrom[0], m.p[2] - c.logoutFrom[1]) > LOGOUT_STIR) stayOn(c, 'you moved');
      c.pose = moveCheck(c, m.p, Date.now()) ? m.p : [was[0], was[1], was[2], m.p[3], m.p[4], m.p[5]];
      // (nor through a base's wall, floor or shut door: server/solid.ts)
      if (c.pose === m.p && stepWalled(c, was, m.p)) c.pose = [was[0], was[1], was[2], m.p[3], m.p[4], m.p[5]];
      // (where they look, kept a moment for the aim's own checks: see aimwatch.ts)
      looked(c, m.p[3], m.p[4]);
      // (dead here is dead in what is passed on, whatever their own game had heard when it sent this)
      if (!c.alive) c.pose[5] |= F_DEAD;
      zoneCheck(c);
      underCheck(c);
      gaitCheck(c, was);
      bodyCheck(c, was, m.p, m.n);
      const w = typeof m.w === 'string' && ITEMS[m.w] ? m.w : null;
      c.w = w;
      c.m = Array.isArray(m.m) ? m.m.filter((x) => typeof x === 'string').slice(0, 4) : [];
      c.f = plating.held(c.inv, w, m.u);
      // (when their game says this was so, by its own clock: passed on as it is, for the others to space what they are shown by)
      c.n = typeof m.n === 'number' && Number.isFinite(m.n) ? Math.round(m.n) : undefined;
      return;
    }
    case 'shot': {
      if (!c.alive || !isVec3(m.o) || !isVec3(m.d) || !WEAPON_RULES[m.w] || WEAPON_RULES[m.w].melee) return;
      stayOn(c, 'you fired');
      // (to whoever is within earshot of that gun, and a little more for those on the move: see src/sim/heard.ts)
      broadcastNear({ t: 'shot', id: c.id, o: m.o, d: m.d, w: m.w, sup: !!m.sup }, m.o[0], m.o[2], shotHeard(m.w, !!m.sup)[1] + 50, c);
      // (and every animal within earshot hears it)
      animalsHear(m.o[0], m.o[2], shotHeard(m.w, !!m.sup));
      return;
    }
    case 'swing': {
      if (c.alive) broadcast({ t: 'swing', id: c.id }, c);
      return;
    }
    case 'pin': {
      // (the pin of a grenade is out: its fuse runs from now, by this clock and nobody else's)
      if (!c.alive || typeof m.w !== 'string' || !THROWN[m.w]) return;
      if (pullPin(c.nades, m.w, Date.now()) === 'ok') stayOn(c, 'you pulled a pin');
      return;
    }
    case 'nade': {
      if (!c.alive || !isVec3(m.o) || !isVec3(m.v)) return;
      // It has to leave from where the thrower is, at a speed an arm can give it, and its pin has to be out. Which
      // grenade it is and how much of its fuse is left are what the server heard and counted: the game is not
      // asked, and everybody else is told the server's figure. (Until 2026-10-13 any game could say a grenade had
      // been thrown, and every hit it then claimed in nine seconds was believed.)
      const out = letGo(c.nades, m.o, m.v, [c.pose[0], c.pose[1], c.pose[2]], Date.now());
      if (!out) return;
      if (out.hand) handBlast(c, out.w, out.o);
      else broadcast({ t: 'nade', id: c.id, o: out.o, v: m.v, w: out.w, f: out.left }, c);
      return;
    }
    case 'launch': {
      // A grenade fired from a launcher. The launcher is for admins only (the owner: "the grenade launcher and its
      // ammo is an admin only weapon"): from anybody else it is not believed, nor anything its blast is said to reach.
      if (!c.alive || roleOf(c) !== 'admin' || !isVec3(m.o) || !isVec3(m.v) || typeof m.w !== 'string' || !LAUNCHED[m.w]) return;
      if (!launch(c.nades, m.w, m.o, m.v, [c.pose[0], c.pose[1], c.pose[2]], Date.now())) return;
      broadcast({ t: 'launch', id: c.id, o: m.o, v: m.v, w: m.w }, c);
      return;
    }
    case 'bunker': {
      // a keycard at the door, by somebody standing at it (the card is theirs to use up: what they carry is their own game's to say)
      const d = world.bunkerDoor;
      if (!c.alive || !d || Math.hypot(c.pose[0] - d[0], c.pose[1] - d[1], c.pose[2] - d[2]) > 6) return;
      // (And they have a card, or had one a moment ago: their game takes it out of their pockets as it says this,
      // and which of the two reaches here first is not certain. Until 2026-10-13 nothing was asked: anybody who
      // sent this from the doorway had the bunker open, card or no card, and sent again each minute it stayed
      // open for good, which now would also keep its infected from ever coming back.)
      const had = cardSeen.get(c.id) ?? 0;
      if (!carries(c.inv, 'keycard') && Date.now() - had > CARD_GRACE_MS) return void flag(c, 'opened the bunker with no keycard', false);
      cardSeen.delete(c.id);
      bunkerDoor.emptyAt = Date.now();
      if (bunkerDoor.open) return;
      bunkerDoor.open = true;
      broadcast({ t: 'bunker', open: true });
      return;
    }
    case 'fire': {
      // lit by somebody standing beside it (a couple of metres' grace: where they are is told a moment late)
      if (!c.alive || !hearths.light(m.i, c.pose[0], c.pose[2], Date.now() / 1000, 2.5)) return;
      broadcast({ t: 'fire', i: m.i, left: FIRE.burns });
      return;
    }
    case 'build': {
      // a fire built from firewood at the feet of whoever built it, on open ground (src/sim/fires.ts FIRE.built)
      if (!c.alive || !isVec3([m.x, m.y, m.z]) || Math.hypot(m.x - c.pose[0], m.z - c.pose[2]) > FIRE.built.reach || Math.abs(m.y - c.pose[1]) > 2) return;
      const now = Date.now() / 1000, i = hearths.build(m.x, m.y, m.z, c.id, now);
      if (i < 0) return void send(c, { t: 'sys', text: 'Too many fires are standing: let one go out first.' });
      broadcast({ t: 'fire+', i, x: m.x, y: m.y, z: m.z });
      broadcast({ t: 'fire', i, left: hearths.left(i, now) });
      return;
    }
    case 'feed': {
      // firewood put on a fire that is alight: it burns that much longer
      const now = Date.now() / 1000;
      if (!c.alive || !hearths.feed(m.i, FUEL.firewood, c.pose[0], c.pose[2], now, 2.5)) return;
      broadcast({ t: 'fire', i: m.i, left: hearths.left(m.i, now) });
      return;
    }
    case 'barrel': {
      const b = world.barrels[m.i];
      if (!c.alive || !Number.isInteger(m.i) || !b || barrelsGone.has(m.i)) return;
      const now = Date.now();
      c.blasts = c.blasts.filter((q) => now - q.at < 5000);
      // a bullet's reach, or the next drum along from one of theirs that has just gone up
      const near = Math.hypot(b.x - c.pose[0], b.z - c.pose[2]) < WEAPON_RULES.barrel.range;
      const chained = c.blasts.some((q) => Math.hypot(world.barrels[q.i].x - b.x, world.barrels[q.i].y - b.y, world.barrels[q.i].z - b.z) < WEAPON_RULES.barrel.blast! + 1);
      if ((!near && !chained) || c.blasts.length >= 12) return;
      barrelsGone.set(m.i, now + BARREL_RESPAWN * 1000);
      c.blasts.push({ i: m.i, at: now, hits: 0 });
      broadcast({ t: 'boom', i: m.i, by: c.id }, c);
      return;
    }
    case 'emote': {
      const e = EMOTE[m.e];
      const now = Date.now();
      if (!c.alive || !e?.say || now - c.lastEmote < EMOTE_GAP * 800) return;
      c.lastEmote = now;
      // a voice carries so far and no further
      const s = JSON.stringify({ t: 'emote', id: c.id, e: e.id } satisfies S2C);
      for (const o of clients.values()) {
        if (o !== c && o.ws.readyState === 1 && Math.hypot(o.pose[0] - c.pose[0], o.pose[1] - c.pose[1], o.pose[2] - c.pose[2]) < SHOUT_RANGE) o.ws.send(s);
      }
      return;
    }
    case 'act': {
      if (!c.alive || !ACTS.includes(m.a)) return;
      broadcast({ t: 'act', id: c.id, a: m.a, d: num(m.d) ? Math.max(0, Math.min(12, m.d)) : 1 }, c);
      return;
    }
    case 'gear': {
      // only things that are worn, and only as many as there are places to wear them (there were six places, and
      // the list was cut to six: there are eleven now, and whatever is drawn of any of them has room in it)
      c.g = (Array.isArray(m.g) ? m.g : []).filter((x) => typeof x === 'string' && !!ITEMS[x]?.wear).slice(0, GEAR_SLOTS.length);
      broadcast({ t: 'gear', id: c.id, g: c.g }, c);
      return;
    }
    case 'back': {
      // what is slung on a back: two places, a gun or a thing to hit with in each, and only things fitted to it
      c.b = (Array.isArray(m.b) ? m.b : [])
        .filter((e) => Array.isArray(e) && typeof e[0] === 'string' && !!(ITEMS[e[0]]?.weapon || ITEMS[e[0]]?.melee))
        .slice(0, 2)
        .map((e): Slung => [e[0], (Array.isArray(e[1]) ? e[1] : []).filter((x) => typeof x === 'string' && !!(ITEMS[x]?.attach || ITEMS[x]?.mag)).slice(0, 8)]);
      broadcast({ t: 'back', id: c.id, b: c.b }, c);
      return;
    }
    case 'hit': {
      const target = clients.get(m.to);
      const rule = WEAPON_RULES[m.w];
      if (!target || !target.alive || !c.alive || !rule || target === c) return;
      if (!['head', 'torso', 'legs', 'arms'].includes(m.zone)) return;
      const now = Date.now();
      // (nobody is hit from under the ground: see UNDER)
      if (buried(c, now)) return;
      const d = Math.hypot(c.pose[0] - target.pose[0], c.pose[1] - target.pose[1], c.pose[2] - target.pose[2]);
      if (d > rule.range + 4) return;
      let amount: number;
      /** where it came from, for the one who is hit: the shooter, or whatever went off */
      let from: [number, number] = [c.pose[0], c.pose[2]];
      if (m.w === 'barrel') {
        // a drum they set off in the last moments, near enough to the one it is said to have reached
        const reach = rule.blast! + 1.5;
        let best: { q: (typeof c.blasts)[number]; d: number } | null = null;
        for (const q of c.blasts) {
          const b = world.barrels[q.i];
          const bd = Math.hypot(b.x - target.pose[0], b.y + BARREL.centre - (target.pose[1] + 1.1), b.z - target.pose[2]);
          if (now - q.at < 4000 && bd < reach && (!best || bd < best.d)) best = { q, d: bd };
        }
        if (!best || ++best.q.hits > 12 || !num(m.dist)) return;
        const drum = world.barrels[best.q.i];
        if (blastWalled([drum.x, drum.y + BARREL.centre - 0.3, drum.z], [target.pose[0], target.pose[1] + 1.1, target.pose[2]])) return;
        // the game says how far off they were; it is not believed by more than a couple of metres
        amount = hitDamage(m.w, 'torso', Math.max(0, m.dist, best.d - 2));
        m.zone = 'torso';
        from = [world.barrels[best.q.i].x, world.barrels[best.q.i].z];
      } else if (rule.blast) {
        // A grenade of theirs, gone off when the server's own count of its fuse says, no further from where it left
        // the hand than it can have flown, and reaching this body for the first time: see `judge`. The game says how
        // far off they were; it is believed no nearer than the grenade can have got.
        const chest: [number, number, number] = [target.pose[0], target.pose[1] + 1.1, target.pose[2]];
        const far = num(m.dist) ? judge(c.nades, m.w, `p${target.id}`, chest, m.dist, now, undefined, blastFrom(chest)) : null;
        if (far === null) return;
        amount = hitDamage(m.w, 'torso', far);
        m.zone = 'torso';
      } else if (m.w === 'jeep') {
        // run down: by whoever is at the wheel of a jeep that is right there, going fast enough
        const at = seatOf(c);
        if (!at || at.seat !== 0 || !num(m.dist) || now - c.lastHit < rule.interval * 1000) return;
        if (Math.hypot(at.v.s[0] - target.pose[0], at.v.s[2] - target.pose[2]) > 7) return;
        c.lastHit = now;
        const speed = Math.min(m.dist, Math.hypot(at.v.s[7], at.v.s[8], at.v.s[9]) + 3);
        amount = Math.max(0, speed - JEEP.bumpFrom) * JEEP.bumpPer;
        m.zone = 'torso';
      } else {
        // you can only hit with what you are holding (fists are always there)
        if (m.w !== 'fists' && c.w !== m.w) return;
        if (!mayHit(c, `p${target.id}`, now, rule.interval * 700)) return;
        // (and what is held has to be in the pockets the server knows of: an invented gun is in nobody's)
        if (m.w !== 'fists' && CHECKS !== 'off' && c.inv && !carries(c.inv, m.w) && flag(c, `hit ${target.name} with ${ITEMS[m.w]?.name ?? m.w}, which is not in their pockets`)) return;
        // (a round does not go through a hill)
        const hill = rule.melee || CHECKS === 'off' ? 0 : hillBetween(c.pose, target.pose);
        if (hill && flag(c, `shot ${target.name} through ${hill.toFixed(1)} m of hill at ${Math.round(d)} m`)) return;
        // (nor through a base's wall, floor or shut door, nor struck through one: server/solid.ts)
        if (walled(c.pose, zoneAt(target.pose, m.zone))) return void log(`${c.name} hit ${target.name} through a base: not let through`);
        c.lastHit = now;
        // (what the round left in the bodies it went through first: see PIERCE)
        amount = hitDamage(m.w, m.zone, d, !!m.sup, num(m.bonus) ? m.bonus : 0, num(m.n) ? m.n : 1) * piercedBy(m.w, m.p);
      }
      if (amount <= 0) return;
      const len = Math.max(0.001, Math.hypot(target.pose[0] - from[0], target.pose[2] - from[1]));
      if (target.power.god) return;
      target.lastHitBy = { id: c.id, name: c.name, w: m.w, zone: m.zone, dist: d, at: now };
      dealt(target, amount, m.zone, m.w);
      send(target, { t: 'dmg', from: c.id, amount, zone: m.zone, w: m.w, dir: [(target.pose[0] - from[0]) / len, 0, (target.pose[2] - from[1]) / len] });
      send(c, { t: 'hitok', to: target.id, amount, zone: m.zone });
      // (a gun's hit on a player: the course's judging of an aim, asked out here too)
      if (!rule.melee && !rule.blast && m.w !== 'barrel' && m.w !== 'jeep') aimWatch(c, target, now);
      return;
    }
    case 'is': {
      // where the infected this player's game moves have got to: passed on to everybody else
      const s = horde.report(c.id, m.s, Date.now());
      if (s.length) broadcast({ t: 'is', s }, c);
      return;
    }
    case 'ihit': {
      const b = horde.bodies.get(m.i);
      const rule = WEAPON_RULES[m.w];
      if (!b || b.diedAt || !c.alive || !rule || m.w === 'infected') return;
      if (!['head', 'torso', 'legs', 'arms'].includes(m.zone)) return;
      const now = Date.now();
      const d = Math.hypot(c.pose[0] - b.s[0], c.pose[1] - b.s[1], c.pose[2] - b.s[2]);
      if (d > rule.range + 6) return;
      let amount: number;
      if (rule.blast) {
        // something of theirs went off: a drum set off in the last few seconds, or a grenade, held to what any
        // blast of a grenade is held to (when, where, and each of them once: `judge`)
        if (!num(m.dist)) return;
        const chest: [number, number, number] = [b.s[0], b.s[1] + 1.2, b.s[2]];
        const far = m.w === 'barrel' ? (Math.min(...c.blasts.map((q) => now - q.at), Infinity) > 9000 ? null : Math.max(0, m.dist)) : judge(c.nades, m.w, `i${m.i}`, chest, m.dist, now, undefined, blastFrom(chest));
        if (far === null) return;
        amount = hitDamage(m.w, 'torso', far);
        m.zone = 'torso';
      } else if (m.w === 'jeep') {
        // run down, by whoever is at the wheel of a jeep that is right there
        const at = seatOf(c);
        if (!at || at.seat !== 0 || !num(m.dist) || Math.hypot(at.v.s[0] - b.s[0], at.v.s[2] - b.s[2]) > 7) return;
        amount = Math.max(0, Math.min(m.dist, Math.hypot(at.v.s[7], at.v.s[8], at.v.s[9]) + 3) - JEEP.bumpFrom) * JEEP.bumpPer;
        m.zone = 'torso';
      } else {
        if (m.w !== 'fists' && c.w !== m.w) return;
        if (!mayHit(c, `i${m.i}`, now, rule.interval * 700)) return;
        if (walled(c.pose, zoneAt([b.s[0], b.s[1], b.s[2], 0, 0, 0], m.zone))) return;
        c.lastHit = now;
        amount = hitDamage(m.w, m.zone, d, !!m.sup, num(m.bonus) ? m.bonus : 0, num(m.n) ? m.n : 1) * piercedBy(m.w, m.p);
      }
      const r = horde.hurt(m.i, amount, now);
      if (!r) return;
      const len = Math.max(0.001, Math.hypot(b.s[0] - c.pose[0], b.s[2] - c.pose[2]));
      const dir: [number, number] = [(b.s[0] - c.pose[0]) / len, (b.s[2] - c.pose[2]) / len];
      // (what it had on it is in its body)
      const body = r.dead ? infectedBody(b, dir) : undefined;
      broadcast({ t: 'ihp', i: m.i, hp: r.hp, dead: r.dead, by: c.id, zone: m.zone, dir, melee: !!rule.melee && !rule.blast, ...(body ? { body } : {}) });
      return;
    }
    case 'ahit':
      return animalHit(c, m);
    case 'askin':
      return animalSkin(c, m);
    case 'chop':
      return chop(c, m);
    case 'mine':
      return mine(c, m);
    case 'saw':
      return saw(c, m);
    case 'craft':
      return craft(c, m);
    case 'blay':
      return lay(c, m);
    case 'bup':
      return hammer(c, m);
    case 'bdel':
      return takeDown(c, m);
    case 'bprint':
      return print(c, m);
    case 'bjoin':
      return joinClaim(c, m);
    case 'mybeds':
      return tellBeds(c);
    case 'bdoor':
      return swing(c, m);
    case 'bknock':
      return knock(c, m);
    case 'block':
      return fitLock(c, m);
    case 'bcode':
      return lockCode(c, m);
    case 'blockon':
      return lockOnOff(c, m);
    case 'bkey':
      return cutKey(c, m);
    case 'bunlock':
      return unfitLock(c, m);
    case 'iatk': {
      // one of them that this player's game moves has struck somebody (as likely as not, this player)
      const target = clients.get(m.to);
      const b = horde.bodies.get(m.i);
      // (Not somebody whose connection has gone, or who has said nothing for a while: the body left standing is there
      // for whoever they were fighting, not for the infected another player's game moves about it. Players came back
      // after a dropped connection to find themselves eaten, all they carried lost, 2026-10-16.)
      if (!b || !target?.alive || target.power.hidden || away(target)) return;
      if (!horde.strikes(m.i, c.id, { id: target.id, x: target.pose[0], z: target.pose[2] }, Date.now())) return;
      // On guard (fists, or something in the hand to strike with), facing it, with the wind to
      // hold it off: nothing lands, and the one that threw it is stopped for a moment.
      const hands = target.w === null || WEAPON_RULES[target.w]?.melee;
      if (target.pose[5] & F_GUARD && hands && (target.vitals?.stamina ?? MAX_STAMINA) >= INFECTED.guardCost && guarded(target.pose[0], target.pose[2], target.pose[3], b.s[0], b.s[2])) {
        if (target.vitals) target.vitals.stamina -= INFECTED.guardCost;
        broadcast({ t: 'iblk', i: m.i, to: target.id });
        return;
      }
      const len = Math.max(0.001, Math.hypot(target.pose[0] - b.s[0], target.pose[2] - b.s[2]));
      if (target.power.god) return;
      const bite = INFECTED.damage + Math.round((Math.random() - 0.5) * 6);
      dealt(target, bite, 'torso', 'infected');
      send(target, { t: 'dmg', from: 0, amount: bite, zone: 'torso', w: 'infected', dir: [(target.pose[0] - b.s[0]) / len, 0, (target.pose[2] - b.s[2]) / len] });
      return;
    }
    case 'radio': {
      // a field radio keyed: one aircraft, so one call in five minutes, whoever makes it
      if (!c.alive) return;
      const wait = Math.ceil(lastCall + CALL.every - economy.time);
      if (wait > 0) {
        send(c, { t: 'radio-', why: `No aircraft to send: one went out a moment ago. Try again in ${wait} s.` });
        return;
      }
      lastCall = economy.time;
      // (in front of the caller, and far enough off to be seen coming down: see `callSite`. Where they stand is
      // where they may still be standing when it lands.)
      const at = world.callSite(c.pose[0], c.pose[1], c.pose[2], c.pose[3]);
      // (it comes by helicopter from the map's edge, as every drop does: the flight says who called it, and when it is down)
      sendDrop(at, c.id);
      log(`${c.name} called a supply drop to ${Math.round(at.x)}, ${Math.round(at.z)}`);
      return;
    }
    case 'take': {
      if (typeof m.uid !== 'string' || !c.alive) return;
      // (nothing is picked up from under the ground)
      if (buried(c)) {
        send(c, { t: 'denied', uid: m.uid });
        return;
      }
      // first request wins; the economy's despawn event tells everyone it is gone
      // (and nobody reaches the ground from a jeep's seat)
      const lying = economy.loot.get(m.uid);
      const far = lying && CHECKS !== 'off' ? Math.hypot(lying.x - c.pose[0], lying.z - c.pose[2]) : 0;
      if (lying && far > CHECK.reach && flag(c, `took ${ITEMS[lying.item.id]?.name ?? lying.item.id} from ${Math.round(far)} m away`)) {
        send(c, { t: 'denied', uid: m.uid });
        return;
      }
      if (c.seatAt || !economy.take(m.uid)) return void send(c, { t: 'denied', uid: m.uid });
      // (a tag in what was picked up is theirs from now on, its clock started now: custody.ts)
      if (lying) for (const t of payingTags(lying.item)) cameTo(c.key, t.uid);
      // (a pack picked up that others were going through where it lay: gone from under them, told by 'loot-')
      goneFrom(`l:${m.uid}`);
      return;
    }
    case 'lopen': {
      // What lies within reach that holds things, gone through where it lies as a crate is, by as many as like at
      // once (searched.ts). Nothing from a seat, or from under the ground.
      if (!Array.isArray(m.uids) || !c.alive || c.seatAt || buried(c)) return;
      for (const uid of m.uids.slice(0, 16)) {
        if (typeof uid !== 'string' || c.openLying.has(uid)) continue;
        const l = economy.loot.get(uid);
        if (!l || !holds(l.item.id) || Math.hypot(l.x - c.pose[0], l.z - c.pose[2]) > LYING_REACH) continue;
        openIt(c, `l:${uid}`);
        c.openLying.add(uid);
        send(c, { t: 'ldata', uid, items: laidIn(l.item) });
      }
      return;
    }
    case 'lops':
    case 'lset': {
      if (typeof m.uid !== 'string' || !hasOpen(c, `l:${m.uid}`) || c.seatAt || !c.alive) return;
      const l = economy.loot.get(m.uid);
      if (!l || !holds(l.item.id) || Math.hypot(l.x - c.pose[0], l.z - c.pose[2]) > LYING_REACH + 2) return;
      if (m.t === 'lops') lyingOps(c, l, Array.isArray(m.ops) ? m.ops : []);
      else lyingSet(c, l, m.items);
      return;
    }
    case 'lclose': {
      for (const uid of c.openLying) shutIt(c, `l:${uid}`);
      c.openLying.clear();
      return;
    }
    case 'drop': {
      const l = m.l;
      const item = cleanItem(l?.item);
      if (!item || !num(l.x) || !num(l.y) || !num(l.z) || !num(l.rot) || economy.loot.has(item.uid)) return;
      // (nor what somebody else took out of a crate first, which their game has yet to hear: searched.ts)
      if (refusedNow(c).has(item.uid)) return;
      // (within reach of where they stand; or thrown there, no further than that throw carries it: server/throws.ts)
      const land = landing(c, item.uid, [l.x, l.y, l.z], world.groundAt, Date.now());
      if (land === 'free' ? Math.hypot(l.x - c.pose[0], l.z - c.pose[2]) > 12 : land !== 'ok') return void (land !== 'free' && log(`${c.name} threw ${ITEMS[item.id]?.name ?? item.id} ${land}: not let through`));
      if (CHECKS !== 'off' && [...things({ slots: { it: item }, containers: [] })].some(invented) && flag(c, `put down ${ITEMS[item.id].name}, which the server never put in the world`)) return;
      // (a tag is put down only by whoever holds it, and is then on the ground and theirs no more: custody.ts)
      const tags = payingTags(item);
      if (tags.some((t) => !holdsTag(c.key, t.uid))) return void log(`${c.name} put down a dog tag they do not hold (${tags.find((t) => !holdsTag(c.key, t.uid))!.uid.slice(0, 12)}): not let through`);
      for (const t of tags) wentFrom(c.key, t.uid, 'g');
      if (tags.length) takeOut(c.inv, new Set(tags.map((t) => t.uid)));
      economy.drop(item, l.x, l.y, l.z, l.rot);
      return;
    }
    case 'toss': {
      // something thrown from the hands: believed from where they stand and no faster than its power throws it, and shown to whoever is near
      if (!c.alive || c.seatAt || typeof m.id !== 'string' || !ITEMS[m.id]) return;
      const t = tossed(c, m.uid, m.o, m.v, m.pw, [c.pose[0], c.pose[1], c.pose[2]], Date.now());
      if (t) broadcastNear({ t: 'tossed', by: c.id, id: findCarried(c, m.uid)?.id ?? m.id, o: m.o, v: m.v }, c.pose[0], c.pose[2], 160, c);
      return;
    }
    case 'copen': {
      const b = boxes.get(m.cid);
      // (a body, a crate, a stash, a drop: none of them is searched from a jeep's seat; nor a body still in the air in one)
      if (!b || !c.alive || c.seatAt || buried(c) || b.buried || b.ride) return;
      if (Math.hypot(b.x - c.pose[0], b.z - c.pose[2]) > 6) return;
      // (a base's box or claim with a lock on it opens only for whoever the lock lets in: server/locks.ts)
      if (!lockLets(c, m.cid)) return void send(c, { t: 'tell', kind: 'warn', text: 'It is locked' });
      // (open by as many as like at once: searched.ts. Another crate they had open is shut first.)
      if (c.openCid && c.openCid !== m.cid) shutIt(c, c.openCid);
      if (!hasOpen(c, m.cid)) openIt(c, m.cid);
      c.openCid = m.cid;
      touched(b);
      send(c, { t: 'cdata', cid: m.cid, items: boxItems(b) });
      return;
    }
    case 'cpeek': {
      // What is in it, asked for on the way to it: told, and nothing else (no doors, nobody holds it). See box-ops.ts.
      const b = typeof m.cid === 'string' ? boxes.get(m.cid) : undefined;
      if (!b || !c.alive || c.seatAt || buried(c) || b.buried || b.ride) return;
      if (Math.hypot(b.x - c.pose[0], b.z - c.pose[2]) > 6 || !mayPeek(c, m.cid)) return;
      send(c, { t: 'cdata', cid: m.cid, items: boxItems(b) });
      return;
    }
    case 'cops':
    case 'cset': {
      const b = boxes.get(m.cid);
      if (!b || !hasOpen(c, m.cid) || c.seatAt) return;
      if (m.t === 'cops') boxOps(c, b, Array.isArray(m.ops) ? m.ops : []);
      else boxSet(c, b, m.items);
      return;
    }
    case 'cclose': {
      shutIt(c, m.cid);
      if (c.openCid === m.cid) c.openCid = null;
      return;
    }
    case 'bury': {
      // A shovel in the hands, beside a case, a suitcase or a bag lying on the ground: it goes under the ground, with
      // what is in it, and all that is left to see is the turned earth. Or beside such a place: what is under it
      // comes up, and lies there again. Anybody's shovel brings up anybody's; it is the finding of the place that
      // keeps it.
      if (!c.alive || c.seatAt || c.w !== 'shovel' || typeof m.uid !== 'string') return;
      if (m.on) {
        const l = economy.loot.get(m.uid);
        if (!l || ITEMS[l.item.id]?.category !== 'stash' || boxes.has(m.uid)) return;
        if (Math.hypot(l.x - c.pose[0], l.z - c.pose[2]) > BURY.reach) return;
        // (out in the country and nowhere else: not in a town or a camp, not in a building, not beside one)
        const no = noBurying(l.x, l.y, l.z, world.groundAt(l.x, l.z), world.places, world.buildings);
        if (no) return void send(c, { t: 'tell', kind: 'warn', text: `${no}.` });
        const def = ITEMS[l.item.id], [w, h] = def.stash ?? [8, 6];
        if (!economy.take(m.uid)) return;
        const st: StashInfo = { uid: m.uid, x: l.x, y: world.groundAt(l.x, l.z), z: l.z, rot: l.rot, ...(def.id === 'stash_kit' ? {} : { item: def.id }), buried: true };
        boxes.set(m.uid, { cid: m.uid, kind: 'stash', w, h, items: cargoOf(l.item), ...st, emptiedAt: -1, touchedAt: Date.now() });
        KEPT.dirty = true;
        log(`${c.name} buried a ${def.name.toLowerCase()} at ${l.x.toFixed(0)}, ${l.z.toFixed(0)}`);
        // (to those near enough to see it go in, not to everybody: server/stash-sight.ts)
        stashBuriedNear(st, clients.values(), send);
        return;
      }
      const b = boxes.get(m.uid);
      if (!b || b.kind !== 'stash' || !b.buried) return;
      if (Math.hypot(b.x - c.pose[0], b.z - c.pose[2]) > BURY.reach) return;
      goneFrom(m.uid);
      boxes.delete(m.uid);
      KEPT.dirty = true;
      log(`${c.name} dug up a ${(ITEMS[b.item ?? 'stash_kit']?.name ?? 'stash').toLowerCase()} at ${b.x.toFixed(0)}, ${b.z.toFixed(0)}`);
      broadcast({ t: 'stash-', uid: m.uid });
      economy.drop(stashItem(b), b.x, b.y + 0.02, b.z, b.rot);
      return;
    }
    case 'door': {
      if (!num(m.i) || m.i < 0 || m.i >= world.doorCount) return;
      const swing = m.swing > 0 ? 1 : -1;
      doors.set(m.i, [!!m.open, swing]);
      broadcast({ t: 'door', i: m.i, open: !!m.open, swing }, c);
      return;
    }
    case 'me': {
      if (!c.alive) return;
      const had = c.inv;
      c.inv = cleanInventory(m.inv);
      // (of the tags that can pay, only those the server has seen this player take: one they dropped, put on a body,
      // or had trashed, said to be in their pockets still, is not: custody.ts)
      const notTheirs = keepToTheirs(c.key, c.inv);
      // (nor anything they took out of a crate that somebody else had taken first: their game is being told, searched.ts)
      const refused = refusedNow(c);
      if (notTheirs.length || refused.size) takeOut(c.inv, new Set([...notTheirs, ...refused]));
      // (no tag of their own round the neck of somebody alive less than TAG_FRESH: their game puts it on then, and an
      // admin looking in their pockets before that sees none)
      if (c.inv?.slots?.neck && tagTime(c) < TAG_FRESH_MS) c.inv.slots.neck = null;
      // (nobody without the power puts a thing in a hold: see `carryOrder`)
      if (c.inv && !c.power.bottomless) holdOnlyEmpties(c.inv, had);
      // (no tool newer than the server has worn it: server/gather.ts; and nothing the server took to build with still in them: server/build.ts)
      keepWear(c.inv, had);
      owing(c, m.sp);
      pockets(c);
      // (somebody with a keycard: remembered a moment, for when they put it in the bunker's reader)
      if (carries(c.inv, 'keycard')) cardSeen.set(c.id, Date.now());
      // the clock on a looted tag starts the first time the server sees it in somebody else's pockets
      for (const t of carriedTags(c.inv)) {
        const from = lootedTags.get(t.uid);
        if (from && !theirOwn(from, c.key) && !tagSeen.has(seenOf(c.key) + t.uid)) tagSeen.set(seenOf(c.key) + t.uid, Date.now());
      }
      // (there is no honest way to come by one in a seat: see 'take' and 'copen')
      if (c.seatAt && takenTag(c)) {
        leaveSeat(c);
        send(c, { t: 'tell', kind: 'warn', text: JEEP.noTag });
      }
      const v = m.vitals;
      // (less health than the server allowed them is taken at their word; more is not)
      if (v && num(v.health)) c.check.hp = Math.min(c.check.hp, Math.max(0, v.health) + 1);
      // (and while the server is keeping their life for them, what their game says puts no health back)
      const held = c.kept && c.vitals ? c.vitals : null;
      if (v && num(v.health) && num(v.energy) && num(v.water)) {
        // (nor any blood, and no wound of theirs is closed by it)
        const bleeding = held ? held.bleeding || !!v.bleeding : !!v.bleeding;
        const bleed = bleeding ? Math.max(held?.bleeding ? bleedOf(held) : 0, v.bleeding ? bleedOf(v) : 0) : 0;
        c.vitals = { health: held ? Math.min(held.health, v.health) : v.health, energy: v.energy, water: v.water, stamina: num(v.stamina) ? v.stamina : MAX_STAMINA, bleeding, blood: held ? Math.min(bloodOf(held), bloodOf(v)) : bloodOf(v), bleed, broken: !!v.broken, ...(num(v.ill) && v.ill > 0 ? { ill: Math.min(POISON.lasts, v.ill) } : {}), ...(num(v.guard) && v.guard > 0 ? { guard: Math.min(1200, v.guard) } : {}) };
      }
      return;
    }
    case 'died': {
      kill(c, typeof m.cause === 'string' ? m.cause.slice(0, 24) : 'unknown', num(m.v) ? Math.max(0, Math.min(2, Math.floor(m.v))) : 0);
      return;
    }
    case 'respawn': {
      // (Dead on their own screen, by what their game last said of where they are, and alive here: this server was
      // not told of the death, or took a return to life that their game never acted on. Whichever it was, they
      // are looking at the word Respawn and pressing it, and were left looking at it for good; and everybody
      // else saw them standing over their own body. What they carried is left where they are, and they come back.)
      if (c.alive) {
        if (!(c.pose[5] & F_DEAD)) return;
        log(`${c.name} asks to come back while alive here and dead by their own game: taken as a death`);
        kill(c, 'injuries');
      }
      // (at a bed of their own, if they asked and may: server/beds.ts; else at the map's edge as ever)
      const bed = m.bed ? wakeAt(c, m.bed) : null;
      if (m.bed && !bed) return;
      const sp = bed ?? pickSpawn({ x: c.pose[0], z: c.pose[2] });
      c.alive = true;
      c.lifeAt = Date.now();
      c.zonaMs = 0;
      c.inv = null;
      c.vitals = null;
      c.pose = [sp.x, bed ? bed.y : world.groundAt(sp.x, sp.z), sp.z, sp.yaw, 0, 0];
      c.check.free = Date.now() + CHECK.free;
      c.check.hp = 100;
      c.check.hpAt = Date.now();
      c.check.downAt = 0;
      // (the bases about a bed told before they are stood on it)
      sightFor(c);
      send(c, { t: 'spawn', x: sp.x, z: sp.z, yaw: sp.yaw, ...(bed ? { y: bed.y } : {}) });
      broadcast({ t: 'alive', id: c.id }, c);
      return;
    }
    case 'chat': {
      const text = String(m.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
      const now = Date.now();
      if (!text || (now - c.lastChat < 500 && !(text.startsWith('/') && roleOf(c)))) return;
      c.lastChat = now;
      // (an order, and never talk: whatever begins with a stroke is said to nobody and is not written down)
      if (text.startsWith('/') && partyCommand(c, text)) return;
      if (text.startsWith('/')) return void command(c, text).catch((e) => log('[admin] an order failed:', e instanceof Error ? e.message : e));
      const quiet = ADMIN.muted.get(c.key) ?? 0;
      if (quiet > now) return void sys(c, `You are muted for ${Math.ceil((quiet - now) / 60000)} more minutes: what you type and say reaches nobody.`);
      // (the word before a name: their role, in the colour they chose; or nothing, for an admin who has put the tag off)
      // (and the Elite's crown, whatever their role: see elite.ts)
      // (and the store's [VIP], and a coffee's cup: server/perks.ts)
      const worn = ADMIN.tints.get(c.id), crown = elite.has(c.key) ? { elite: true } : {};
      const badge = { ...(worn === 'off' ? {} : { role: roleOf(c) ?? undefined, tint: worn }), ...crown, ...(perks.vip(c.key) ? { vip: true } : {}), ...(perks.cup(c.key) ? { cup: true } : {}) };
      if (m.ch === 'staff') {
        // those with a role, to one another, wherever they are: nobody else is sent it, or told that anything was said
        if (!roleOf(c)) return;
        const out: S2C = { t: 'chat', ch: 'staff', from: c.name, text, role: roleOf(c) ?? undefined, ...(worn && worn !== 'off' ? { tint: worn } : {}), ...crown };
        for (const o of clients.values()) if (roleOf(o)) send(o, out);
        return;
      }
      if (m.ch === 'near') {
        // proximity: only players standing within earshot get it (the speaker included)
        const out: S2C = { t: 'chat', ch: 'near', from: c.name, text, ...badge };
        for (const o of clients.values()) {
          if (Math.hypot(o.pose[0] - c.pose[0], o.pose[1] - c.pose[1], o.pose[2] - c.pose[2]) <= CHAT_RANGE) send(o, out);
        }
      } else broadcast({ t: 'chat', ch: 'global', from: c.name, text, ...badge });
      return;
    }
    case 'admin':
      return void login(c, m.pw).catch(() => sys(c, 'The site did not answer: try again in a minute.'));
    // (they have just bought at the store: the site's list is asked for again, so their VIP shows within a minute)
    case 'perks':
      return void perks.bought();
    case 'store':
      return void storeOrder(c, m.act);
    // (their finish put on a gun they carry, for good: plates.ts)
    case 'finish': {
      const it = c.alive ? plating.apply(c.inv, m.uid, (gun) => perks.skin(c.key, gun)) : 'Not now';
      if (typeof it === 'string') return send(c, { t: 'tell', kind: 'warn', text: it });
      return send(c, { t: 'finish', uid: it.uid, f: it.finish! });
    }
    case 'tint': {
      if (roleOf(c) !== 'admin') return;
      // ('off': no tag at all before their name where everybody talks: they are read as anybody is)
      if (m.color === 'off') ADMIN.tints.set(c.id, 'off');
      else if (typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color)) ADMIN.tints.set(c.id, m.color.toLowerCase());
      else ADMIN.tints.delete(c.id);
      return;
    }
    case 'logout': {
      if (m.cancel) return void stayOn(c, 'you called it off');
      if (!c.alive || c.logoutAt) return;
      c.logoutAt = Date.now() + LOGOUT_MS;
      c.logoutFrom = [c.pose[0], c.pose[2]];
      return void send(c, { t: 'logout', left: Math.round(LOGOUT_MS / 1000) });
    }
    case 'esp': {
      // an admin's far sight, about wherever their view is (server/esp.ts)
      const x = num(m.x) ? m.x : c.pose[0], z = num(m.z) ? m.z : c.pose[2];
      const l = espAnswer(c, roleOf(c), Date.now(), () => espRows(economy.loot.values(), boxes.values(), x, z, hidden));
      if (l) send(c, { t: 'esp', l });
      return;
    }
    case 'adist':
      // how far off their game draws animals: a player's to ANIMALS.told, an admin's to ANIMALS.admin (the admin panel)
      if (num(m.m)) c.animalsFar = Math.max(100, Math.min(roleOf(c) ? ANIMALS.admin : ANIMALS.told, m.m));
      return;
    case 'aesp': {
      // and of every animal on the map (a hundred and twenty at most: src/sim/animals.ts ANIMALS.max), and every one
      // of the infected, as asked
      const r1 = (v: number) => Math.round(v * 10) / 10;
      const r = espAnswer(c, roleOf(c), Date.now(), () => ({
        ...(m.a ? { r: herd.rows(0, 0, Infinity) } : {}),
        ...(m.z ? { z: [...horde.bodies.values()].map((b): ZedSpot => [b.i, r1(b.s[0]), r1(b.s[1]), r1(b.s[2]), b.diedAt ? 1 : 0]) } : {}),
      }), 'far');
      if (r) send(c, { t: 'aesp', ...r });
      return;
    }
    case 'adm': {
      const role = roleOf(c), now = Date.now();
      if (!role || now - (ADMIN.asked.get(c.id) ?? 0) < 600) return;
      ADMIN.asked.set(c.id, now);
      const admin = role === 'admin';
      return void send(c, {
        t: 'adm',
        players: [...clients.values()].map((o) => ({
          id: o.id, name: o.name, role: roleOf(o), x: Math.round(o.pose[0]), z: Math.round(o.pose[2]), yaw: Math.round(o.pose[3] * 100) / 100, alive: o.alive, flags: o.check.flags, mins: Math.round((now - o.joinedAt) / 60000),
          hp: Math.round(o.vitals?.health ?? 100), kills: scores.get(o.key)?.kills ?? 0, tags: scores.get(o.key)?.tags ?? 0,
          ...(o.power.hidden ? { hidden: true as const } : {}), ...(o.power.god ? { god: true as const } : {}), ...(o.power.clip ? { clip: true as const } : {}),
          ...((ADMIN.muted.get(o.key) ?? 0) > now ? { muted: true as const } : {}), ...(o.seatAt ? { seat: true as const } : {}),
          ...(o.power.voidInv ? { voidInv: true as const } : {}), ...(o.power.voidTag ? { voidTag: true as const } : {}), ...(pinned.of(o.key) ? { pinned: true as const } : {}),
          ...(o.power.weightless ? { weightless: true as const } : {}), ...(o.power.endless ? { endless: true as const } : {}), ...(o.power.bottomless ? { bottomless: true as const } : {}),
          ...(o.asleep ? { asleep: true as const } : away(o, now) && o.alive ? { away: true as const } : {}),
          ...(o.fp ? { dev: shortDevice(o.fp) } : {}),
        })),
        gone: ADMIN.gone.slice(-20).reverse().map((g) => ({ id: g.id, name: g.name, mins: Math.round((now - g.at) / 60000) })),
        bans: admin
          ? [
              ...ADMIN.state.bans.map((b, i) => ({ n: i + 1, id: banId(b), name: b.name, why: b.why, by: b.by, at: b.at.slice(0, 10) })),
              // (and whoever is kept off for a while: lifted the same way)
              ...keptOffNow(now).map((b, i) => ({ n: ADMIN.state.bans.length + i + 1, id: offId(b), name: b.name, why: `${b.why} (for ${Math.ceil((b.until - now) / 60000)} more minutes)`, by: b.why.startsWith('timed out') ? 'a timeout' : 'the checks', at: new Date(b.until).toISOString().slice(11, 16) + ' UTC' })),
            ]
          : [],
        // (whoever was turned away at the door lately, newest first, for the Pardon button)
        ...(admin ? { turned: [...ADMIN.turned].reverse().map((t) => ({ id: t.n, name: t.name, why: t.why, mins: Math.round((now - t.at) / 60000), ...(t.fp ? { dev: shortDevice(t.fp) } : {}) })) } : {}),
        roles: admin ? roleRows(c) : [],
        checks: CHECKS,
        stats: { up: Math.round(process.uptime() / 60), today: seen.today(), loot: economy.loot.size, stashes: [...boxes.values()].filter((b) => b.kind === 'stash').length + [...economy.loot.values()].filter((l) => l.keptAt !== undefined).length, kept: KEPT.chars.size + records.size, asleep: [...clients.values()].filter((o) => o.asleep).length, cars: vehicles.size, wrecks: [...vehicles.values()].filter((v) => v.goneAt).length, infected: [...horde.bodies.values()].filter((b) => !b.diedAt).length },
      });
    }
    case 'vin': {
      const v = vehicles.get(m.i);
      if (!v || !c.alive || v.goneAt || c.seatAt || !Number.isInteger(m.seat) || m.seat < 0 || m.seat >= seatsOf(v.k) || v.seats[m.seat] !== null) return;
      if (Math.hypot(c.pose[0] - v.s[0], c.pose[1] - v.s[1], c.pose[2] - v.s[2]) > JEEP.reach + 3) return;
      // A tag taken off somebody is carried on foot, for fifteen minutes, with the map showing
      // everybody where: not driven round in circles.
      // (a keycard went on foot as well until 2026-10-14: "players can drive a vehicle with bunker cards now its ok just not dogtags")
      if (takenTag(c)) {
        send(c, { t: 'tell', kind: 'warn', text: JEEP.noTag });
        return;
      }
      // (and whatever they were searching is shut: nothing is searched from a seat)
      releaseLock(c);
      v.seats[m.seat] = c.id;
      c.seatAt = Date.now();
      c.check.free = Date.now() + CHECK.free;
      // whoever takes the wheel moves it from now on; a passenger changes nothing about that
      if (m.seat === 0) {
        v.sim = c.id;
        v.heard = Date.now();
      }
      tellSeats(v);
      return;
    }
    case 'vout': {
      leaveSeat(c);
      return;
    }
    case 'vtake': {
      // A parked vehicle with nobody in it that another has run into: the game of whoever ran into it moves it until it
      // is at rest again (see 'vrest'), as a vehicle somebody got out of is moved by theirs. (Asked only by somebody
      // close to it: their own vehicle is touching it.)
      const v = vehicles.get(m.i);
      if (!v || v.goneAt || !c.alive || v.sim !== null || v.seats.some((s) => s !== null)) return;
      if (Math.hypot(c.pose[0] - v.s[0], c.pose[2] - v.s[2]) > 30) return;
      v.sim = c.id;
      v.heard = Date.now();
      tellSeats(v);
      return;
    }
    case 'vswap': {
      // From one seat to another free one of the same vehicle. Whoever moves into the front seat drives it (or flies
      // it) from now on; whoever moves out of it leaves it to their game until it is at rest, as a driver who got out
      // does (a helicopter with nobody at the controls comes down).
      const at = seatOf(c);
      if (!at || !c.alive || at.v.goneAt || !Number.isInteger(m.seat) || m.seat < 0 || m.seat >= seatsOf(at.v.k) || at.v.seats[m.seat] !== null) return;
      at.v.seats[at.seat] = null;
      at.v.seats[m.seat] = c.id;
      if (m.seat === 0) {
        at.v.sim = c.id;
        at.v.heard = Date.now();
      }
      tellSeats(at.v);
      return;
    }
    case 'v': {
      const v = vehicles.get(m.i);
      if (!v || v.sim !== c.id || (v.goneAt && !v.falling) || !isVState(m.s) || !num(m.at)) return;
      const now = Date.now();
      // passed straight on, not held for the next tick: every wait here is a wobble there
      broadcast({ t: 'vs', s: [[v.i, m.at, ...m.s]] }, c);
      // what the engine burns: flat out for a minute is JEEP.burn litres
      if (v.seats[0] === c.id && v.fuel > 0) {
        const had = v.fuel;
        v.fuel = Math.max(0, v.fuel - (Math.abs(m.s[11]) * JEEP.burn * Math.min(1, (now - v.heard) / 1000)) / 60);
        if (Math.floor(had) !== Math.floor(v.fuel) || !v.fuel) broadcast({ t: 'vfuel', i: v.i, fuel: Math.round(v.fuel * 10) / 10 });
      }
      v.s = m.s;
      v.heard = now;
      return;
    }
    case 'vrest': {
      const v = vehicles.get(m.i);
      if (!v || v.sim !== c.id || !isVState(m.s)) return;
      v.s = [m.s[0], m.s[1], m.s[2], m.s[3], m.s[4], m.s[5], m.s[6], 0, 0, 0, 0, 0];
      v.falling = false;
      // (with somebody still at the wheel it is only standing, not left)
      if (v.seats[0] === c.id) return;
      v.sim = null;
      tellSeats(v, true);
      return;
    }
    case 'vhorn': {
      // (the one at the wheel of a car, not a helicopter's; a siren only on a police car; a horn pressed no more often than ten times a second)
      const v = vehicles.get(m.i);
      if (!v || v.goneAt || v.seats[0] !== c.id || v.k === HELI.kind) return;
      const now = Date.now();
      if (m.horn === true && now - (hornAt.get(c) ?? 0) < 100) return;
      if (m.horn !== undefined) hornAt.set(c, now);
      const out: { t: 'vhorn'; i: number; horn?: boolean; siren?: boolean } = { t: 'vhorn', i: v.i };
      if (typeof m.horn === 'boolean') out.horn = m.horn;
      if (typeof m.siren === 'boolean' && v.k === POLICE_CAR.kind) out.siren = v.siren = m.siren;
      if (out.horn !== undefined || out.siren !== undefined) broadcast(out, c);
      return;
    }
    case 'vflip': {
      const v = vehicles.get(m.i);
      if (!v || !c.alive || v.goneAt || v.sim !== null || v.seats.some((s) => s !== null)) return;
      if (Math.hypot(c.pose[0] - v.s[0], c.pose[2] - v.s[2]) > JEEP.reach + 3) return;
      // their game stands it up and lets it settle, then hands it back (see 'vrest')
      v.sim = c.id;
      v.heard = Date.now();
      tellSeats(v);
      return;
    }
    case 'vhit': {
      const v = vehicles.get(m.i);
      const rule = WEAPON_RULES[m.w];
      if (!v || !c.alive || !rule || rule.melee || v.goneAt) return;
      const now = Date.now();
      const d = Math.hypot(c.pose[0] - v.s[0], c.pose[1] - v.s[1], c.pose[2] - v.s[2]);
      if (d > rule.range + 6) return;
      const amount = carDamage(rule);
      if (rule.blast) {
        // A drum set off in the last moments; or a grenade of theirs gone off when its fuse said, near enough to
        // reach it (a car is reached from seven tenths as far as a body), which it takes once from each grenade.
        // (It took one from every message that said so: one stick grenade, said twice, was the end of a car.)
        const recent = m.w === 'barrel' ? c.blasts.some((q) => now - q.at < 4000) : judge(c.nades, m.w, `v${v.i}`, [v.s[0], v.s[1], v.s[2]], 0, now, rule.blast * 0.7) !== null;
        if (!recent) return;
      } else {
        if (c.w !== m.w || now - c.lastVHit < rule.interval * 700) return;
      }
      c.lastVHit = now;
      hurtJeep(v, amount, c);
      return;
    }
    case 'vcrash': {
      const v = vehicles.get(m.i);
      if (!v || v.sim !== c.id || v.goneAt || !num(m.n) || m.n <= 0) return;
      // the jeep takes it first; from a real smash, so does everybody in it
      const cost = v.k === HELI.kind ? heliCrash(Math.min(40, m.n)) : crashDamage(Math.min(40, m.n));
      const riders = v.seats.slice();
      hurtJeep(v, cost.jeep, c);
      if (cost.people > 0) {
        for (const id of riders) {
          const o = id === null ? undefined : clients.get(id);
          if (!o?.alive || o.power.god) continue;
          dealt(o, cost.people, 'torso', 'crash');
          send(o, { t: 'dmg', from: 0, amount: cost.people, zone: 'torso', w: 'crash', dir: [0, 0, 0] });
        }
      }
      return;
    }
    case 'vfuel': {
      const v = vehicles.get(m.i);
      if (!v || !c.alive || v.goneAt || v.fuel >= JEEP.tank - 0.5) return;
      if (Math.hypot(c.pose[0] - v.s[0], c.pose[2] - v.s[2]) > JEEP.reach + 3) return;
      v.fuel = Math.min(JEEP.tank, v.fuel + JEEP.can);
      broadcast({ t: 'vfuel', i: v.i, fuel: Math.round(v.fuel * 10) / 10 });
      return;
    }
    case 'cash': {
      // the tag has to be one this player really carries, with its time (nearly) served:
      // our copy of their inventory is a few seconds behind theirs
      const tag = findCarried(c, m.uid);
      const seenAt = tag ? tagSeen.get(seenOf(c.key) + tag.uid) : undefined;
      if (!tag || tag.id !== 'dogtag' || ((tag.held ?? 0) < TAG_HOLD - 30 && !(seenAt !== undefined && Date.now() - seenAt >= CASH_HOLD_MS))) return;
      // (and one that can pay is cashed in only by whoever the server saw take it, and still holds it: custody.ts)
      if (lootedTags.has(tag.uid) && !holdsTag(c.key, tag.uid)) return void log(`${c.name} asked to cash in a dog tag they do not hold (${tag.uid.slice(0, 12)}): refused`);
      // (nothing is earned by somebody nothing can hurt, nobody can see, or no wall stops)
      if (c.power.god || c.power.hidden || c.power.clip) return void sys(c, 'No tag is cashed in with god mode, vanish or noclip on: put them off first.');
      // (nor once the last word is written: one cashed after it would be in the pockets, and on the list, of the server that comes next)
      if (stoppingNow()) return void send(c, { t: 'tell', kind: 'warn', text: 'The server is restarting: cash the tag in when it is back. It is kept.' });
      tag.held = 0;
      const owner = tag.owner ?? 'Survivor';
      const from = lootedTags.get(tag.uid);
      const now = Date.now();
      // (a tag this server knows nothing of: taken before tags were kept through a restart, see keepTags)
      const why = buried(c, now) ? 'it was cashed in from under the ground' : voided.has(tag.uid) ? 'it was carried out of the Zona or under the ground' : from ? notEarned(c, from, seenAt, now) : 'the server restarted while you were carrying it';
      log(`${c.name} cashed in ${owner}'s dog tag${why ? ` (not listed for a reward: ${why})` : ''}`);
      lootedTags.delete(tag.uid);
      tagSeen.delete(seenOf(c.key) + tag.uid);
      if (from && !why) {
        // one tag, one reward
        for (const a of namesOf(c.key, c.ip)) for (const b of namesOf(from.ownerKey, from.ownerIp)) pairPaidAt.set(`${a}>${b}`, now);
        // (the name and wallet fixed at the first: server/pinned.ts. One given since, other than the one fixed, is told so)
        const given = isWallet(m.wallet) ? m.wallet : '', { pin, fresh } = pinned.cash(c.key, c.name, given);
        recordCashIn(c, from.owner, pin.wallet);
        if (fresh) send(c, { t: 'pinned', pin: { name: pin.name, wallet: pin.wallet } });
        else if (given && given !== pin.wallet) send(c, { t: 'tell', kind: 'warn', text: `Listed for ${pin.wallet.slice(0, 4)}…${pin.wallet.slice(-4)}: your wallet is fixed since your first cashed tag. An admin can change it.` });
      } else send(c, { t: 'tell', kind: 'warn', text: `No reward for ${owner}'s tag: ${why}.` });
      broadcast({ t: 'cashed', id: c.id, name: c.name, owner });
      return;
    }
    case 'party':
      return partyAct(c, m);
    case 'ping':
      send(c, { t: 'pong', n: m.n });
      return;
    case 'bait':
      return void baited(c, String(m.what));
  }
}

/** economy time of the last call answered on a field radio */
let lastCall = -1e9;
/** when each driver last pressed or let go of their horn (see 'vhorn') */
const hornAt = new WeakMap<Client, number>();
