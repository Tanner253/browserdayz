// The server: traps set on the ground (the rules are src/sim/traps.ts). Kept here and nowhere else. A game asks to set one
// and is told when it has been ('trapok', and only then does the item leave its pockets); each game is told only of those
// within sight of it, once a second, and of one going off near it. They are not kept over a restart.

import { TRAPS, TRAP_KEEP, isTrap, steppedOn, type TrapKind } from '../src/sim/traps';
import type { C2S } from '../src/net/protocol';
import { broadcastNear, clients, isVec3, send, type Client } from './players';
import { dealt } from './checks';
import { fellBlast } from './gate';
import { carries } from './tags';
import { vehicles } from './index';

interface Trap {
  i: number;
  k: TrapKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** whose it is, by their key: what `most` counts */
  key: string;
  armed: number;
  ends: number;
}

const set = new Map<number, Trap>();
let next = 1;
/** where each foot was at the last look */
const feet = new WeakMap<Client, [number, number]>();
/** what each game was last told is near it */
const told = new WeakMap<Client, string>();

/** nobody's: what a mine does, it does in nobody's name, and no tag comes of it */
const nobody = (t: Trap) => ({ id: 0, name: 'a land mine', alive: false, pose: [t.x, t.y, t.z, 0, 0, 0] }) as unknown as Client;

function go(t: Trap, how: 'snap' | 'boom' | 'take') {
  set.delete(t.i);
  broadcastNear({ t: 'trapgo', i: t.i, k: t.k, o: [t.x, t.y, t.z], how }, t.x, t.z, how === 'boom' ? 900 : 120);
}

export function setTrap(c: Client, m: Extract<C2S, { t: 'trap' }>) {
  if (!c.alive || c.seatAt || !isTrap(m.k) || !isVec3(m.o) || !Number.isFinite(m.yaw) || typeof m.uid !== 'string') return;
  if (Math.hypot(m.o[0] - c.pose[0], m.o[2] - c.pose[2]) > TRAP_KEEP.reach || Math.abs(m.o[1] - c.pose[1]) > TRAP_KEEP.reach || !carries(c.inv, m.k)) return;
  const now = Date.now();
  if ([...set.values()].filter((t) => t.key === c.key).length >= TRAP_KEEP.most) return void send(c, { t: 'tell', kind: 'warn', text: `You have ${TRAP_KEEP.most} set already: take one up first` });
  const t: Trap = { i: next++, k: m.k, x: m.o[0], y: m.o[1], z: m.o[2], yaw: m.yaw, key: c.key, armed: now + TRAPS[m.k].arm * 1000, ends: now + TRAP_KEEP.lasts };
  set.set(t.i, t);
  send(c, { t: 'trapok', uid: m.uid });
  told.delete(c);
}

export function takeTrap(c: Client, m: Extract<C2S, { t: 'untrap' }>) {
  const t = Number.isInteger(m.i) ? set.get(m.i) : undefined;
  if (!t || !c.alive || c.seatAt || Math.hypot(t.x - c.pose[0], t.z - c.pose[2]) > TRAP_KEEP.reach) return;
  go(t, 'take');
  send(c, { t: 'trapback', k: t.k });
}

function spring(t: Trap, c: Client | null) {
  if (t.k === 'land_mine') {
    go(t, 'boom');
    return fellBlast(nobody(t), 'land_mine', [t.x, t.y + 0.15, t.z]);
  }
  go(t, 'snap');
  if (!c) return;
  const amount = TRAPS.bear_trap.damage;
  dealt(c, amount, 'legs', 'trap');
  send(c, { t: 'dmg', from: 0, amount, zone: 'legs', w: 'trap', dir: [0, 0, 0] });
}

/** Eight times a second: whoever has come over one that is armed. */
export function trapsTick(now: number) {
  if (!set.size) return;
  for (const t of [...set.values()]) if (now > t.ends) go(t, 'take');
  for (const c of clients.values()) {
    const was = feet.get(c), x = c.pose[0], z = c.pose[2];
    feet.set(c, [x, z]);
    if (!c.alive || c.seatAt || c.power.god || !was) continue;
    for (const t of set.values()) {
      if (now < t.armed || Math.abs(c.pose[1] - t.y) > TRAP_KEEP.up) continue;
      if (Math.abs(x - t.x) < 3 && Math.abs(z - t.z) < 3 && steppedOn(was[0], was[1], x, z, t.x, t.z, TRAPS[t.k].reach)) {
        spring(t, c);
        break;
      }
    }
  }
  // (a car over a mine: a bear trap is nothing to a tyre)
  for (const v of vehicles.values()) {
    if (v.goneAt) continue;
    for (const t of set.values()) if (t.k === 'land_mine' && now >= t.armed && Math.hypot(v.s[0] - t.x, v.s[1] - t.y, v.s[2] - t.z) < TRAP_KEEP.car) {
      spring(t, null);
      break;
    }
  }
}

/** Once a second: each game is told what lies near it, if that has changed. */
export function trapSight() {
  for (const c of clients.values()) {
    const near = [...set.values()].filter((t) => Math.hypot(t.x - c.pose[0], t.z - c.pose[2]) < TRAP_KEEP.sight).map((t) => [t.i, t.k, t.x, t.y, t.z, t.yaw] as [number, string, number, number, number, number]);
    const said = near.map((n) => n[0]).join(',');
    if (told.get(c) === said) continue;
    told.set(c, said);
    send(c, { t: 'traps', near });
  }
}
