// A controller read and laid out (src/core/pad-layout.ts): a PlayStation pad however the browser lists it, the pad in
// the hands picked from what is listed, and the player's own layout with no two things on one button.
// npx tsx test/pad.test.ts

import assert from 'node:assert/strict';
import { B, PAD_ACTIONS, bindPad, buttonName, padButtons, padKind, pickPad, readPad } from '../src/core/pad-layout';

let failed = 0;
const ok = (name: string, f: () => void) => {
  try {
    f();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  NOT OK  ${name}\n          ${(e as Error).message}`);
  }
};

type Pad = { id: string; mapping: GamepadMappingType; connected: boolean; buttons: { pressed: boolean; value: number; touched: boolean }[]; axes: number[] };
const pad = (id: string, mapping: GamepadMappingType, n: number, down: number[], axes: number[]): Pad => ({
  id, mapping, connected: true, axes,
  buttons: Array.from({ length: n }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0, touched: false })),
});
const DS4 = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';

console.log('A controller: read, picked and laid out');

ok('a DualShock 4 the browser lays out as standard is read as it is', () => {
  const r = readPad(pad(DS4, 'standard', 17, [B.cross, B.r2], [0.5, -0.5, 0, 0]));
  assert.ok(r.pressed[B.cross] && r.pressed[B.r2] && !r.pressed[B.l2]);
  assert.deepEqual(r.axes, [0.5, -0.5, 0, 0]);
});

ok('one it does not (Bluetooth, Firefox; Windows and macOS): □ ✕ ○ △ first, the right stick on axes 2 and 5, the triggers by their buttons, the D-pad a hat', () => {
  // (✕ is its button 1; the right stick pushed right; the triggers' axes, 3 and 4, at 0 as before they are touched)
  const r = readPad(pad('054c-05c4-Wireless Controller', '', 14, [1, 7], [0, 0, 1, 0, 0, 0.2, 0, 0, 0, -1]), 'Win32');
  assert.ok(r.pressed[B.cross] && !r.pressed[B.square], 'cross');
  assert.ok(r.pressed[B.r2] && !r.pressed[B.l2], 'the triggers fire by their axes at rest');
  assert.deepEqual(r.axes, [0, 0, 1, 0.2]);
  assert.ok(r.pressed[B.up] && !r.pressed[B.down], 'the hat: up');
  const left = readPad(pad('054c-05c4-Wireless Controller', '', 14, [], [0, 0, 0, -1, -1, 0, 0, 0, 0, 0.714]), 'Win32');
  assert.ok(left.pressed[B.left] && !left.pressed[B.up]);
  const none = readPad(pad('054c-05c4-Wireless Controller', '', 14, [], [0, 0, 0, -1, -1, 0, 0, 0, 0, 1.2857]), 'Win32');
  assert.ok(!none.pressed.some(Boolean), 'the hat let go');
});

ok('and on Linux (evdev): ✕ ○ △ □ first, the right stick on axes 3 and 4, the D-pad on 6 and 7', () => {
  const r = readPad(pad('Sony Interactive Entertainment Wireless Controller (Vendor: 054c Product: 0ce6)', '', 13, [3, 11], [0, 0, -1, 0.7, -0.3, -1, 1, 0]), 'Linux x86_64');
  assert.ok(r.pressed[B.square] && r.pressed[B.l3] && !r.pressed[B.cross]);
  assert.deepEqual(r.axes, [0, 0, 0.7, -0.3]);
  assert.ok(r.pressed[B.right] && !r.pressed[B.l2], 'the D-pad right; the trigger at rest is no pull');
});

ok('the pad in the hands: a standard one before its motion sensors or a copy a driver makes; PlayStation names for Sony, Xbox for the rest', () => {
  const motion = pad('054c Motion Sensors', '', 0, [], [0, 0, 0]), raw = pad('054c-09cc-Wireless Controller', '', 14, [], []), std = pad(DS4, 'standard', 17, [], []);
  assert.equal(pickPad([motion, raw, std]), std);
  assert.equal(pickPad([motion, raw]), raw);
  assert.equal(pickPad([motion, null]), null);
  assert.equal(padKind(DS4), 'ps');
  assert.equal(padKind('DualSense Wireless Controller'), 'ps');
  assert.equal(padKind('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'xbox');
  assert.equal(buttonName(B.triangle, 'ps'), '△');
  assert.equal(buttonName(B.triangle, 'xbox'), 'Y');
});

ok("the player's own layout: a thing put on a button, what was there changes places with it, and none share one", () => {
  const first = padButtons({});
  assert.equal(first.jump, B.cross);
  assert.equal(new Set(Object.values(first)).size, PAD_ACTIONS.length, 'two things on one button as made');
  const r = bindPad({}, 'jump', B.circle);
  assert.equal(r.swapped, 'crouch');
  const now = padButtons(r.moved);
  assert.equal(now.jump, B.circle);
  assert.equal(now.crouch, B.cross);
  assert.equal(new Set(Object.values(now)).size, PAD_ACTIONS.length);
  // (put back, it is as made and nothing is kept for it)
  const back = bindPad(r.moved, 'jump', B.cross);
  assert.deepEqual(back.moved, {});
  // (a free button: nothing changes places)
  const free = bindPad({}, 'light', B.pad);
  assert.equal(free.swapped, null);
  assert.equal(padButtons(free.moved).light, B.pad);
});

console.log(failed ? `PAD TEST FAILED: ${failed}` : 'PAD TEST PASSED');
process.exit(failed ? 1 : 0);
