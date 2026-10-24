// The animals' calls (2026-10-23): when a herd is heard, and which of it. The server says each one, so that everybody
// near hears the same stag (server/animals.ts); playing alone the game says them to itself. The numbers: CALLS.

import { CALLS, HERDS, KINDS, type Call } from './animals';
import type { Beast, Group, Herd, Turn } from './animal-mind';

/** one call a herd may make now, by its kind and the hour: and the seconds after which it is asked again */
export function herdCall(h: Herd, g: Group, living: Beast[], now: number, phase: number, turn: Turn) {
  if (now < g.callAt) return;
  const id = HERDS[g.herd].id, [call, c] = (Object.entries(CALLS) as [Call, (typeof CALLS)['roar']][]).find(([, v]) => v.herd === id) ?? [];
  // (the first of each herd's comes at a random moment of its first wait: herds woken together do not call together)
  if (!g.callAt) return void (g.callAt = now + (c ? c.every[1] * h.rnd() : 600) * 1000);
  const quiet = !c || !!g.flee || !!g.hunt || !!g.meal || living.some((b) => b.foe) || !c.hours.some(([a, b]) => phase >= a && phase < b);
  const who = c && !quiet ? (call === 'roar' ? living.find((b) => KINDS[b.k].id === 'stag') : living[Math.floor(h.rnd() * living.length)]) : undefined;
  if (!who || !call || !c) return void (g.callAt = now + 30_000);
  turn.calls.push({ i: who.i, call, x: who.x, z: who.z });
  g.callAt = now + (c.every[0] + h.rnd() * (c.every[1] - c.every[0])) * 1000;
}

/** a deer's bark as its herd bolts: one of them, once a minute at most */
export function alarm(g: Group, b: Beast, now: number, turn: Turn) {
  if (HERDS[g.herd].id !== 'deer' || now < g.barkAt) return;
  g.barkAt = now + CALLS.bark.every * 1000;
  turn.calls.push({ i: b.i, call: 'bark', x: b.x, z: b.z });
}
