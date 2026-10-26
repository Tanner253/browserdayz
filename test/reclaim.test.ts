// A survivor's gear taken back off their own body at one press, and what was in the hands on the ground (the owner,
// 2026-10-25: "button on corpse small that auto takes everything and fills all equipment and back slots from the
// body"; "Item in hand when a player dies should drop on the ground like rust"). What has to hold:
//   - the gun in the hands at the death lies on the ground beside the body, its magazine and what is fitted on it;
//   - nobody else's press does anything to a body, and nobody else is told it is theirs;
//   - on their own body every worn and slung thing goes back into its place with what was in it, the clothes they came
//     back in lying on the body instead.
// The real server on a port of its own, players over the wire. About ten seconds.
//   npx tsx test/reclaim.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { PlayerInventory } from '../src/sim/inventory';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';
import { generateWorld, heightAt } from '../src/world/worldgen';

const PORT = 8331;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const world = generateWorld();
const ground = (x: number, z: number) => heightAt(world.heights, x, z);

class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string, public key = `reclaim-test-key-${name}-000000000000000000`) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d, bin) => !bin && this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => (this.ws.once('open', () => done()), this.ws.once('error', fail)));
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    assert.ok(this.got.some((m) => m.t === 'welcome'), `${this.name} was not let in`);
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  at(x: number, z: number) {
    this.send({ t: 's', p: [x, ground(x, z), z, 0, 0, 0], w: null, m: [] });
  }
  carry(inv: PlayerInventory) {
    this.send({ t: 'me', inv: inv.serialize(), vitals: { health: 100, energy: 100, water: 100 } });
  }
  async next<T extends S2C['t']>(t: T, of: (m: Extract<S2C, { t: T }>) => boolean = () => true, ms = 3000) {
    const from = this.got.length;
    for (let k = 0; k < ms / 50; k++) {
      const m = this.got.slice(from).find((x) => x.t === t && of(x as Extract<S2C, { t: T }>));
      if (m) return m as Extract<S2C, { t: T }>;
      await sleep(50);
    }
    return null;
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-reclaim-'));
// (the site it would report a cash-in to is nowhere: nothing in this test is paid, and nothing may be)
const server = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SITE_URL: 'http://127.0.0.1:9', DATA_DIR: dir, INFECTED: 'off', CHECKS: 'watch', LOCAL_ADMIN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logged = '';
server.stdout!.on('data', (d) => (logged += d));
server.stderr!.on('data', (d) => (logged += d));
let failed: unknown = null;
try {
  for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
  assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
  const ann = new Player('Ann'), vic = new Player('Vic');
  await ann.join();
  await vic.join();
  ann.at(20, 0);
  vic.at(60, 0);

  // what Ann has on: the clothes she began in with something in the jacket, a vest, a pack, a rifle on her back, a
  // pistol in the holster, and a second rifle in her hands, loaded, with whatever fits it fitted
  const had = new PlayerInventory();
  const medic = Object.values(ITEMS).find((d) => d.category === 'medical' && !d.slot && !d.stack)!.id;
  for (const id of ['chest_rig', 'sack_pack', 'mosin', 'colt', medic]) assert.equal(had.add(makeItem(id)), null, `no room for ${id}`);
  const gun = makeItem('mosin9130'), optic = Object.values(ITEMS).find((d) => d.attach?.slot !== 'magazine' && d.attach?.fits.includes('mosin9130'));
  gun.mag = ITEMS.mosin9130.weapon!.mag;
  gun.loaded = 3;
  if (optic) gun.mods = [optic.id];
  had.slots.held = gun;
  const worn = Object.fromEntries((['top', 'legs', 'vest', 'back', 'primary', 'holster'] as const).map((s) => [s, had.slots[s]!.uid]));
  ann.carry(had);
  await sleep(300);
  ann.send({ t: 'died', cause: 'test' });
  const death = await ann.next('death');
  const body = death?.corpse;
  assert.ok(body, 'no body was left');

  // ---- the gun in her hands lies on the ground beside the body, as it was
  const lies = (await vic.next('loot+', (m) => m.l.item.uid === gun.uid, 1000)) ?? (vic.got.find((m) => m.t === 'loot+' && m.l.item.uid === gun.uid) as Extract<S2C, { t: 'loot+' }> | undefined);
  assert.ok(lies, 'what was in the hands is not on the ground');
  assert.ok(Math.hypot(lies.l.x - body.x, lies.l.z - body.z) < 1, `it lies ${Math.hypot(lies.l.x - body.x, lies.l.z - body.z).toFixed(2)} m from the body`);
  assert.equal(lies.l.item.mag, gun.mag, 'its magazine is not in it');
  assert.equal(lies.l.item.loaded, 3, 'its rounds are not in it');
  assert.deepEqual(lies.l.item.mods ?? [], gun.mods ?? [], 'what was fitted to it is not');

  // ---- she comes back in fresh clothes
  ann.send({ t: 'respawn' });
  assert.ok(await ann.next('spawn'), 'she did not come back');
  const now = new PlayerInventory();
  // (whatever a new life begins dressed in: src/sim/items.ts CLOTHES)
  const fresh = Object.values(now.slots).flatMap((it) => (it ? [it.uid] : []));
  ann.carry(now);

  // ---- somebody else's press does nothing, and they are not told the body is theirs
  vic.at(body.x + 1, body.z);
  await sleep(300);
  vic.send({ t: 'copen', cid: body.uid });
  const seen = await vic.next('cdata', (m) => m.cid === body.uid);
  assert.ok(seen && !seen.own, 'somebody else is told the body is theirs');
  vic.send({ t: 'reclaim', cid: body.uid });
  assert.equal(await vic.next('reclaimed', () => true, 600), null, 'somebody else took her gear back');
  vic.send({ t: 'copen', cid: body.uid });
  assert.equal((await vic.next('cdata', (m) => m.cid === body.uid))?.items.length, seen.items.length, "somebody else's press changed what is on the body");

  // ---- her press puts it all back where it was
  ann.at(body.x - 1, body.z);
  await sleep(300);
  ann.send({ t: 'copen', cid: body.uid });
  assert.equal((await ann.next('cdata', (m) => m.cid === body.uid))?.own, true, 'she is not told the body is hers');
  ann.send({ t: 'reclaim', cid: body.uid });
  const back = await ann.next('reclaimed');
  assert.ok(back, 'her press did nothing');
  for (const [s, uid] of Object.entries(worn)) assert.equal(back.inv.slots[s]?.uid, uid, `${s} is not what she wore there`);
  assert.ok(back.inv.slots.top?.cargo?.some((p) => p.item.id === medic), 'what was in her jacket is not in it');
  assert.equal(back.inv.slots.held ?? null, null, 'something was put in her hands');
  await sleep(200);
  const left = vic.got.filter((m): m is Extract<S2C, { t: 'cdata' }> => m.t === 'cdata' && m.cid === body.uid).at(-1);
  assert.deepEqual(new Set(left?.items.map((p) => p.uid)), new Set(fresh), 'what lies on the body is not the clothes she came back in');

  // ---- a whole kit, as the server hands it, gone back on whole (the owner, 2026-10-26: "when I died and came back to
  // my body and hit reclaim I lost most of my gear, all my items are gone"): every thing she had is on her after it, on
  // the body still, or on the ground (the gun that was in her hands), and nowhere is anything lost
  // (everybody is an admin on this server, as on the local one: and an admin there leaves what they carry as anybody does)
  const kat = new Player('Kat');
  await kat.join();
  kat.at(140, 0);
  kat.send({ t: 'chat', ch: 'global', text: '/kit assault' });
  const kit = await kat.next('kit');
  assert.ok(kit, 'no kit came');
  const kitted = new PlayerInventory();
  kitted.clear();
  assert.deepEqual(kit.items.filter((it) => kitted.add(it)).map((it) => it.id), [], 'the kit did not all go on');
  const rifle = kitted.find((it) => !!ITEMS[it.id].weapon && ITEMS[it.id].slot === 'long')!;
  assert.ok(kitted.hold(rifle), 'the rifle did not come into the hands');
  const deep = (its: (ItemInstance | null | undefined)[], out = new Set<string>()): Set<string> => {
    for (const it of its) if (it && !out.has(it.uid)) (out.add(it.uid), deep((it.cargo ?? []).map((p) => p.item), out));
    return out;
  };
  const owned = new Set(kitted.everything().keys());
  kat.carry(kitted);
  await sleep(300);
  kat.send({ t: 'died', cause: 'test' });
  const kBody = (await kat.next('death'))?.corpse;
  assert.ok(kBody, 'no body was left of the kit');
  kat.send({ t: 'respawn' });
  assert.ok(await kat.next('spawn'), 'she did not come back');
  const second = new PlayerInventory();
  for (const id of ['beans', 'milk', 'bandage']) second.add(makeItem(id));
  kat.carry(second);
  kat.at(kBody.x - 1, kBody.z);
  await sleep(300);
  kat.send({ t: 'copen', cid: kBody.uid });
  assert.ok(await kat.next('cdata', (m) => m.cid === kBody.uid), 'her body did not open');
  kat.send({ t: 'reclaim', cid: kBody.uid });
  const kBack = await kat.next('reclaimed');
  assert.ok(kBack, 'her press did nothing');
  await sleep(200);
  // (as her game takes it: what it is told she carries put on, and what finds no room let fall at her feet)
  const worn2 = new PlayerInventory(), atFeet = worn2.load(kBack.inv);
  const onHer = new Set([...worn2.everything().keys(), ...deep(atFeet)]);
  const kLeft = kat.got.filter((m): m is Extract<S2C, { t: 'cdata' }> => m.t === 'cdata' && m.cid === kBody.uid).at(-1)!;
  const onBody = deep(kLeft.items);
  const lost = [...owned].filter((uid) => uid !== rifle.uid && !onHer.has(uid) && !onBody.has(uid));
  assert.deepEqual(lost, [], `${lost.length} of ${owned.size} things were lost: ${lost.map((u) => kitted.everything().get(u)?.id).join(', ')}`);
  for (const s of ['vest', 'back', 'head', 'feet', 'holster'] as const) if (kitted.slots[s]) assert.equal(worn2.slots[s]?.uid, kitted.slots[s]!.uid, `${s} is not what she wore there`);
  console.log(`reclaim: the kit (${owned.size} things) came back whole, ${onBody.size} left on the body`);
  console.log(`reclaim: ok (the gun in the hands wore ${optic?.id ?? 'nothing fitted'})`);
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
