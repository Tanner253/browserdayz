// The note each start leaves (src/core/device.ts), read by the next: a start that died says where; a game that died in
// play says 'playing' (2026-10-23: iPhones reached the menu and were closed after it, and nothing said so); a game put
// away or shut is no death; a start put away still is. A phone after any death is LEAN. Each page load is the module
// imported afresh over the same storage. Under a second.
//   npx tsx test/boot-note.test.ts

import assert from 'node:assert/strict';

const store = new Map<string, string>();
let on: Record<string, (() => void)[]> = {};
const g = globalThis as unknown as Record<string, unknown>;
const doc = { visibilityState: 'visible', addEventListener: (k: string, f: () => void) => (on[k] ??= []).push(f) };
const fire = (k: string) => (on[k] ?? []).forEach((f) => f());
Object.assign(g, {
  window: { addEventListener: (k: string, f: () => void) => (on[k] ??= []).push(f) },
  document: doc,
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  matchMedia: () => ({ matches: true }),
  location: { search: '' },
  setInterval: () => 0,
});
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 5 }, configurable: true });

let n = 0;
type Device = typeof import('../src/core/device');
/** a page load: the module afresh, its listeners its own */
const load = async (): Promise<Device> => {
  on = {};
  doc.visibilityState = 'visible';
  return (await import(`../src/core/device.ts?load=${++n}`)) as Device;
};

let d = await load();
assert.equal(d.TOUCH, true);
assert.equal(d.DIED_AT, '');

// (a start that died at the forest)
d.bootStage('forest');
d = await load();
assert.equal(d.DIED_AT, 'forest');
assert.equal(d.DEATHS, 1);
assert.equal(d.LEAN, true);

// (a start that came up, then a game that died in play)
d.bootStage('shaders');
d.bootDone();
d = await load();
assert.equal(d.DIED_AT, 'playing', 'a game that died in play is said');
assert.equal(d.LEAN, true);

// (a game put away, and shut by the phone while it was)
d.bootDone();
doc.visibilityState = 'hidden';
fire('visibilitychange');
d = await load();
assert.equal(d.DIED_AT, '', 'a game put away and shut is no death');
assert.equal(d.LEAN, false);

// (put away, looked at again, then died in play)
d.bootDone();
doc.visibilityState = 'hidden';
fire('visibilitychange');
doc.visibilityState = 'visible';
fire('visibilitychange');
d = await load();
assert.equal(d.DIED_AT, 'playing', 'a game come back to and then dead is a death');

// (a game shut by its player)
d.bootDone();
fire('pagehide');
d = await load();
assert.equal(d.DIED_AT, '');

// (a start put away and shut is still a start that died)
d.bootStage('forest');
doc.visibilityState = 'hidden';
fire('visibilitychange');
d = await load();
assert.equal(d.DIED_AT, 'forest');
console.log('ok   starts that died, games that died in play, games put away or shut');
