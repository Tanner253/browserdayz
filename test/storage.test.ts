// Furniture that holds things (src/sim/storage.ts, server/storages.ts; the owner, 2026-10-17: "make all furniture have
// storage by default like the bunker has", "we should do it for all furniture with containers"). The registry, where
// the pieces stand and which places are in them, then the real server on a port of its own: a piece opened shows what
// the economy put in it (which nobody was told of as lying anywhere), a thing taken out of it is gone from it, and a
// thing left in another stays there. About half a minute.
//   npx tsx test/storage.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C, type StoredItem } from '../src/net/protocol';
import { CRATE_SPECS } from '../src/sim/crates';
import { ITEMS } from '../src/sim/items';
import { FURNITURE, economyCargo } from '../src/sim/storage';
import { buildWorldData } from '../server/world';

const PORT = 8241;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (name: string) => {
  checks++;
  console.log('  ok  ' + name);
};

// ---- the registry
{
  const models = (JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'assets', 'manifest.json'), 'utf8')) as { models: Record<string, unknown> }).models;
  for (const [kind, def] of Object.entries(FURNITURE)) {
    assert.ok(models[kind], `${kind} is no model`);
    assert.ok(def.grid[0] >= 4 && def.grid[1] >= 3, `${kind}: a grid of ${def.grid} holds too little`);
    if (def.cargo === 'table') assert.ok(CRATE_SPECS[kind], `${kind} is filled from a list, and there is none`);
  }
  ok(`${Object.keys(FURNITURE).length} kinds of furniture hold things, each a model with a grid, and each that is filled from a list has one`);
}

// ---- where they stand, and which places are in them
const data = buildWorldData(process.cwd());
const pieces = data.crates.filter((c) => economyCargo(c.kind));
{
  assert.ok(pieces.length >= 500, `only ${pieces.length} pieces of furniture hold things`);
  assert.equal(new Set(data.crates.map((c) => c.cid)).size, data.crates.length, 'two searched things go by one name');
  const ids = new Set(pieces.map((c) => c.cid));
  const inside = data.lootPoints.filter((p) => p.inside);
  assert.ok(inside.length >= 300, `only ${inside.length} places are in furniture`);
  for (const p of inside) assert.ok(ids.has(p.inside!), `a place is in ${p.inside}, which is not a piece that holds things`);
  // (and they are places on furniture, never on a floor)
  assert.ok(inside.every((p) => p.surf && !p.floor), 'a place on a floor is said to be in furniture');
  ok(`${pieces.length} pieces of furniture hold things; ${inside.length} places for loot are in them`);
}

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string, public key = `storage-test-key-${name}-${String(++n).padStart(20, '0')}`) {}
  async join(): Promise<boolean> {
    this.got = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    return this.got.some((m) => m.t === 'welcome');
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  say(x: number, z: number) {
    this.send({ t: 's', p: [x, data.groundAt(x, z), z, 0, 0, 0], w: null, m: [] });
  }
  /** what a container holds, as the server says when it is opened */
  async open(cid: string): Promise<StoredItem[] | null> {
    const from = this.got.length;
    this.send({ t: 'copen', cid });
    for (let k = 0; k < 40; k++) {
      const m = this.got.slice(from).find((q): q is Extract<S2C, { t: 'cdata' }> => q.t === 'cdata' && q.cid === cid);
      if (m) return m.items;
      await sleep(50);
    }
    return null;
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-storage-'));
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LINGER_S: '0', KEEP: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const ann = new Player('Ann');
  assert.ok(await ann.join());
  const welcome = ann.got.find((m): m is Extract<S2C, { t: 'welcome' }> => m.t === 'welcome')!;
  // nothing in furniture is told of as lying anywhere
  assert.ok(welcome.loot.every((l) => !(l.point >= 0 && data.lootPoints[l.point]?.inside)), 'a thing in furniture was told of as lying on the map');
  const told = new Set(welcome.loot.map((l) => l.item.uid));
  ok('nothing the economy put in furniture is told of as lying on the map');

  // a piece the economy has put something in: opened, it shows it
  const withPlaces = pieces.filter((c) => data.lootPoints.some((p) => p.inside === c.cid));
  let found: { cid: string; items: StoredItem[] } | null = null, other: string | null = null;
  for (const c of withPlaces.slice(0, 120)) {
    ann.say(c.x + 0.6, c.z);
    await sleep(60);
    const items = await ann.open(c.cid);
    ann.send({ t: 'cclose', cid: c.cid });
    if (items?.length && !found) found = { cid: c.cid, items };
    else if (items && !other && found && Math.hypot(c.x - pieces.find((q) => q.cid === found!.cid)!.x, c.z - pieces.find((q) => q.cid === found!.cid)!.z) < 5) other = c.cid;
    if (found && other) break;
  }
  assert.ok(found, 'no piece of furniture held anything the economy put in it');
  assert.ok(found.items.every((it) => !told.has(it.uid) && ITEMS[it.id]), 'what a piece held was told of as lying on the map, or is no thing');
  ok(`a ${pieces.find((q) => q.cid === found!.cid)!.kind} opened shows what the economy put in it: ${found.items.map((it) => it.id).join(', ')}`);

  // taken out: gone from it the next time it is opened
  const piece = pieces.find((q) => q.cid === found!.cid)!;
  ann.say(piece.x + 0.6, piece.z);
  await sleep(60);
  const before = await ann.open(found.cid);
  const taken = before![0];
  ann.send({ t: 'cset', cid: found.cid, items: before!.slice(1) });
  await sleep(150);
  ann.send({ t: 'cclose', cid: found.cid });
  await sleep(100);
  const after = await ann.open(found.cid);
  assert.ok(after && !after.some((it) => it.uid === taken.uid), `${taken.id} taken out of it is in it still`);
  ann.send({ t: 'cclose', cid: found.cid });
  ok(`${taken.id} taken out of it is gone from it`);

  // left in another piece (or this one again): there the next time
  const into = other ?? found.cid;
  const at = pieces.find((q) => q.cid === into)!;
  ann.say(at.x + 0.6, at.z);
  await sleep(60);
  const was = (await ann.open(into)) ?? [];
  ann.send({ t: 'cset', cid: into, items: [...was, { ...taken, x: 0, y: 0, rot: false }].filter((it, i, all) => all.findIndex((q) => q.uid === it.uid) === i) });
  await sleep(150);
  ann.send({ t: 'cclose', cid: into });
  await sleep(100);
  const kept = await ann.open(into);
  assert.ok(kept?.some((it) => it.uid === taken.uid), `${taken.id} left in a piece was not there when it was opened again`);
  ok(`${taken.id} left in a piece is there when it is opened again`);
} catch (e) {
  failed = e;
} finally {
  server.kill();
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
if (failed) {
  console.error(logged.slice(-1500));
  throw failed;
}
console.log(`${checks} checks passed`);
process.exit(0);
