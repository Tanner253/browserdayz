// Buried stashes told to a player only near them (the owner, 2026-10-23: "Fix the buried stash leak now: the server stops
// sending buried stashes in the welcome, digging still works"). server/stash-sight.ts, and the lines of the server that
// used to send them to everybody.
//   npx tsx test/stash-sight.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEE_M, stashBuriedNear, stashesSeen, type Kept, type Seer } from '../server/stash-sight';
import type { S2C } from '../src/net/protocol';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

const player = (x: number, z: number): Seer => ({ pose: [x, 0, z, 0], ws: { readyState: 1 } });
const stash = (cid: string, x: number, z: number, buried = true): Kept => ({ cid, kind: 'stash', buried, x, y: 10, z, rot: 0 });
const inbox = () => {
  const got = new Map<Seer, string[]>();
  const send = (c: Seer, m: S2C) => {
    if (m.t === 'stash+') got.set(c, [...(got.get(c) ?? []), m.s.uid]);
  };
  return { got, send };
};

ok('a buried stash is told only to a player within SEE_M of it, and only once', () => {
  const near = player(0, 0), far = player(SEE_M + 30, 0), { got, send } = inbox();
  const boxes = [stash('a', 10, 0), stash('b', 500, 500)];
  stashesSeen([near, far], boxes, send);
  stashesSeen([near, far], boxes, send);
  assert.deepEqual(got.get(near), ['a']);
  assert.equal(got.get(far), undefined);
});

ok('a player who walks up to one is told of it then', () => {
  const p = player(400, 400), { got, send } = inbox(), boxes = [stash('b', 420, 400)];
  stashesSeen([p], [stash('b', 500, 500)], send);
  assert.equal(got.get(p), undefined);
  stashesSeen([p], boxes, send);
  assert.deepEqual(got.get(p), ['b']);
});

ok('one lying open on the ground is not this rule (the welcome has it), and a closed line is skipped', () => {
  const p = player(0, 0), shut: Seer = { pose: [0, 0, 0, 0], ws: { readyState: 3 } }, { got, send } = inbox();
  stashesSeen([p, shut], [stash('open', 5, 0, false), stash('c', 5, 5)], send);
  assert.deepEqual(got.get(p), ['c']);
  assert.equal(got.get(shut), undefined);
});

ok('one going into the ground is told to whoever is near, the one burying it among them, and nobody far off', () => {
  const digger = player(100, 100), watcher = player(130, 100), far = player(900, 900), { got, send } = inbox();
  stashBuriedNear({ uid: 'new', x: 101, y: 5, z: 100, rot: 0, buried: true }, [digger, watcher, far], send);
  assert.deepEqual(got.get(digger), ['new']);
  assert.deepEqual(got.get(watcher), ['new']);
  assert.equal(got.get(far), undefined);
});

ok('the server no longer sends buried stashes to everybody', () => {
  const players = readFileSync('server/players.ts', 'utf8'), handle = readFileSync('server/handle.ts', 'utf8');
  const keep = readFileSync('server/keep.ts', 'utf8'), index = readFileSync('server/index.ts', 'utf8');
  assert.match(players, /stashes: \[\.\.\.boxes\.values\(\)\]\.filter\(\(b\) => b\.kind === 'stash' && !b\.buried\)/);
  for (const [name, src] of [['handle', handle], ['keep', keep], ['index', index]] as const) assert.doesNotMatch(src, /broadcast\(\{ t: 'stash\+'/, `${name}.ts broadcasts a stash`);
  assert.match(handle, /stashBuriedNear\(st, clients\.values\(\), send\)/);
  assert.match(index, /stashesSeen\(clients\.values\(\), boxes\.values\(\), send\)/);
});

console.log(`${n} checks passed`);
