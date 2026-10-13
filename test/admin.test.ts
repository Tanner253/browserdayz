// Admins, and who they have banned (server/index.ts `command`, api/admin.ts). The real game server is started on
// a port of its own, twice, with a stand-in for the site on this machine: the real api/admin code over a store
// that is a variable. Nothing here touches the real site or its store. About four minutes.
//   npx tsx test/admin.test.ts
//   npx tsx test/admin.test.ts hold     the last part by itself (things given, and the inventory that never fills): under a minute

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { admin, type AdminState } from '../api/admin';
import { keep } from '../api/keep';
import type { Store } from '../api/_lib/store';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { BODY_GRID, PlayerInventory, bagGrid, heldIn, type SerializedInventory } from '../src/sim/inventory';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';
import { CARRY_POWERS, carriedOf, refill, refilledWords, roundsSpent, weightFelt } from '../src/sim/powers';

const PORT = 8143, SITE = 8144;
// (a password made up here, for this test's stand-in site and nothing else)
const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- the site, standing here: one file, in a variable
const files = new Map<string, { text: string; mark: number }>();
let writes = 0;
const store: Store = {
  async read<T>(p: string) {
    const f = files.get(p);
    return f ? { data: JSON.parse(f.text) as T, mark: String(f.mark) } : null;
  },
  async glance<T>(p: string) {
    const f = files.get(p);
    return f ? (JSON.parse(f.text) as T) : null;
  },
  async swap(p, data, mark) {
    const f = files.get(p);
    if ((f ? String(f.mark) : null) !== mark) return false;
    writes++;
    files.set(p, { text: JSON.stringify(data), mark: (f?.mark ?? 0) + 1 });
    return String((f?.mark ?? 0) + 1);
  },
  async list() {
    return [...files.keys()];
  },
};
const site = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${SITE}`);
  // (what was sent is read whole and passed on: the keep, which only the last part of this file turns on, is sent the world to hold)
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(url, { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) });
  const env = { ADMIN_PASSWORD: PASSWORD };
  const out = url.pathname === '/api/admin' ? await admin(request, store, `http://127.0.0.1:${PORT}`, env) : url.pathname === '/api/keep' ? await keep(request, store, env) : new Response('not here', { status: 404 });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(await out.text());
});
await new Promise<void>((done) => site.listen(SITE, '127.0.0.1', done));
const kept = () => JSON.parse(files.get('zona/admin.json')?.text ?? '{"roles":{},"bans":[]}') as AdminState;

let n = 0;
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  id = 0;
  shut = false;
  /** @param ip where they are said to play from (an address out of the range kept for examples) */
  constructor(public name: string, public ip = `203.0.113.${++n}`, public key = `admin-test-key-${name}-${String(n).padStart(20, '0')}`) {}
  async join(): Promise<boolean> {
    this.got = [];
    this.shut = false;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { 'x-forwarded-for': this.ip } });
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    this.ws.on('close', () => (this.shut = true));
    await new Promise<void>((done, fail) => {
      this.ws.once('open', () => done());
      this.ws.once('error', fail);
    });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: this.key, name: this.name }));
    for (let k = 0; k < 160 && !this.shut && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    const w = this.got.find((m) => m.t === 'welcome') as { you: number } | undefined;
    if (!w) return false;
    this.id = w.you;
    return true;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  /** an order, typed where talk is typed; @returns what the server said back */
  async order(text: string): Promise<string> {
    const from = this.got.length;
    this.send({ t: 'chat', ch: 'global', text });
    await sleep(900);
    return this.got.slice(from).filter((m) => m.t === 'sys').map((m) => (m as { text: string }).text).join('\n');
  }
  get role() {
    return (this.got.filter((m) => m.t === 'role').pop() as { role: string | null } | undefined)?.role;
  }
  get kicked(): string | undefined {
    return (this.got.find((m) => m.t === 'kick') as { reason: string } | undefined)?.reason;
  }
  heard(text: string) {
    return this.got.some((m) => m.t === 'chat' && (m as { text: string }).text.includes(text));
  }
}

async function withServer(play: (log: () => string) => Promise<void>, more: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-admin-'));
  const server: ChildProcess = spawn(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: `http://127.0.0.1:${SITE}`, DATA_DIR: dir, INFECTED: 'off', LINGER_S: '0', CHECKS: 'watch', ...more },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logged = '';
  server.stdout!.on('data', (d) => (logged += d));
  server.stderr!.on('data', (d) => (logged += d));
  let failed: unknown = null;
  try {
    for (let k = 0; k < 600 && !logged.includes('listening'); k++) await sleep(100);
    assert.ok(logged.includes('listening'), `the server did not start:\n${logged.slice(-600)}`);
    for (let k = 0; k < 100 && !logged.includes('lists read from the site'); k++) await sleep(100);
    assert.ok(logged.includes('lists read from the site'), `the lists were not read:\n${logged.slice(-600)}`);
    await play(() => logged);
  } catch (e) {
    failed = e;
  } finally {
    server.kill();
    await sleep(500);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* the server still letting go of it */
    }
  }
  if (failed) {
    console.error(logged.slice(-1200));
    throw failed;
  }
}

let checks = 0;
/** `npx tsx test/admin.test.ts hold` runs the last part alone (it makes its own admin): everything else is as ever */
const ALL = !process.argv.includes('hold');
const ann = new Player('Ann'), bob = new Player('Bob'), cat = new Player('Cat'), dan = new Player('Dan');

if (ALL) await withServer(async (log) => {
  for (const p of [ann, bob, cat, dan]) assert.ok(await p.join(), `${p.name} was not let in`);

  // ---- nobody has a role to begin with, and an order is not talk
  assert.match(await dan.order('/ban Ann'), /not a thing you can do/);
  assert.match(await dan.order('/admin hunter2'), /not a thing you can do/);
  assert.ok(!ann.heard('/ban') && !ann.heard('hunter2'), 'an order was said to everybody');
  assert.ok(!log().includes('hunter2'), 'what was typed after /admin was written down');
  checks++;
  console.log('  ok  with no role an order does nothing, is said to nobody and is not written down');

  // ---- the password: wrong, then right
  ann.send({ t: 'admin', pw: 'not-it' });
  await sleep(1200);
  assert.ok(ann.got.some((m) => m.t === 'sys' && /not the password/.test((m as { text: string }).text)), 'a wrong password was not refused');
  assert.equal(ann.role, undefined);
  ann.send({ t: 'admin', pw: PASSWORD });
  await sleep(1500);
  assert.equal(ann.role, 'admin', `the right password made nobody an admin:\n${log().slice(-400)}`);
  assert.ok(!log().includes(PASSWORD), 'the password was written down');
  assert.equal(Object.values(kept().roles).filter((r) => r.role === 'admin').length, 1, 'the site did not keep her role');
  assert.ok(!JSON.stringify(kept()).includes(ann.key), 'her key is in the file as it is');
  checks++;
  console.log('  ok  a wrong password is refused; the right one makes an admin, kept by the site, and is written down nowhere');

  // ---- she sees who is here, makes a mod, and the mod can kick but not ban
  assert.match(await ann.order('/players'), /Bob[\s\S]*Cat|Cat[\s\S]*Bob/);
  assert.match(await ann.order('/mod Cat'), /Cat is a mod/);
  await sleep(300);
  assert.equal(cat.role, 'mod');
  assert.match(await cat.order('/ban Dan'), /Only an admin/);
  assert.match(await cat.order('/kick Dan being a test'), /Dan is off the server/);
  await sleep(300);
  assert.match(dan.kicked ?? '', /put off the server: being a test/);
  assert.ok(await dan.join(), 'somebody kicked could not come back');
  checks++;
  console.log('  ok  a mod kicks and cannot ban; whoever is kicked can come back');

  // ---- a timeout keeps somebody off; a ban keeps them off and is kept by the site
  assert.match(await cat.order('/timeout Dan 5 cooling off'), /off the server for 5 minutes/);
  await sleep(300);
  assert.ok(!(await dan.join()), 'somebody timed out was let straight back in');
  assert.match(dan.kicked ?? '', /kept off this server/);
  assert.match(await ann.order('/ban Bob flying'), /Bob is banned/);
  await sleep(300);
  assert.match(bob.kicked ?? '', /banned/);
  assert.ok(!(await bob.join()), 'somebody banned was let back in');
  assert.match(bob.kicked ?? '', /You are banned/);
  assert.equal(kept().bans.length, 1);
  assert.equal(kept().bans[0].name, 'Bob');
  assert.equal(kept().bans[0].why, 'flying');
  assert.match(await ann.order('/bans'), /1\. Bob/);
  checks++;
  console.log('  ok  a timeout keeps somebody off for its minutes; a ban puts them off, keeps them off, and is written to the site');

  // ---- a ban is of an address too, and bites there and then: whoever else is on from it goes with the one named
  const gus = new Player('Gus', '203.0.113.200'), hob = new Player('Hob', '203.0.113.200');
  assert.ok(await gus.join());
  assert.ok(await hob.join());
  assert.match(await ann.order('/ban Gus two of them'), /Gus is banned[\s\S]*from now[\s\S]*Put out with them: Hob/);
  await sleep(300);
  assert.match(gus.kicked ?? '', /banned/);
  assert.match(hob.kicked ?? '', /banned/, 'somebody else at a banned address was left in the world');
  assert.ok(!(await hob.join()), 'somebody at a banned address was let back in');
  assert.match(await ann.order('/unban Gus'), /no longer banned/);
  checks++;
  console.log('  ok  a ban puts out, at once, everybody on from the address it is of');
  // (two to an address here, for that: the rule of one is tried further down, on a server that has it)
}, { PER_ADDRESS: '2' });

// ---- the server restarts, and forgets nothing of it
if (ALL) await withServer(async () => {
  assert.ok(await ann.join(), 'the admin was not let in');
  await sleep(400);
  assert.equal(ann.role, 'admin', 'after a restart she is no admin');
  assert.ok(!(await bob.join()), 'after a restart the ban is forgotten');
  assert.ok(await dan.join(), 'a timeout outlived the restart (it is not meant to)');
  // somebody at Bob's address with another game is kept off too; and the admin, were she at that address, is not
  const alt = new Player('Robert', bob.ip);
  assert.ok(!(await alt.join()), 'a ban did not keep off another game at the same address');
  ann.ws.close();
  await sleep(300);
  ann.ip = bob.ip;
  assert.ok(await ann.join(), 'an admin was kept off by a ban of the address she plays from');
  // somebody else, with his name, another game and another address, is not Bob
  const bob2 = new Player('Bob');
  assert.ok(await bob2.join(), 'a ban kept off somebody else of the same name');
  // one player to an address: a second game from where Dan plays is turned away, and let in when he has gone
  const twin = new Player('Twin', dan.ip);
  assert.ok(!(await twin.join()), 'a second game from one address was let in');
  assert.match(twin.kicked ?? '', /one player to a connection/);
  // (he leaves; banned after he has gone, he is kept off all the same)
  bob2.ws.close();
  await sleep(400);
  assert.match(await ann.order('/recent'), /Bob/);
  assert.match(await ann.order('/ban Bob gone but not forgotten'), /Bob is banned/);
  assert.ok(!(await bob2.join()), 'somebody banned after leaving was let back in');
  const before = writes;
  assert.match(await ann.order('/unban 1'), /no longer banned/);
  assert.equal(writes, before + 1, 'an unban was not one write');
  assert.ok(await bob.join(), 'somebody unbanned was not let in');
  assert.match(await ann.order('/demote Cat'), /Nobody online is "Cat"/);
  checks++;
  console.log('  ok  after a restart the admin is an admin and the banned are banned; a ban is of a key, not a name; one who has left can be banned; an unban lets them in');
});

// ---- what an admin can do that nobody else can: the lists, going and bringing, things, the powers
if (ALL) await withServer(async () => {
  const eve = new Player('Eve'), fay = new Player('Fay');
  for (const p of [ann, eve, fay]) assert.ok(await p.join(), `${p.name} was not let in`);
  await sleep(300);
  const last = <T extends S2C['t']>(p: Player, t: T) => p.got.filter((m) => m.t === t).pop() as Extract<S2C, { t: T }> | undefined;

  ann.send({ t: 'adm' });
  eve.send({ t: 'adm' });
  await sleep(400);
  const lists = last(ann, 'adm');
  assert.ok(lists, 'an admin was not sent the lists');
  assert.deepEqual(lists.players.map((p) => p.name).sort(), ['Ann', 'Eve', 'Fay']);
  assert.equal(lists.players.find((p) => p.name === 'Ann')?.role, 'admin');
  assert.ok(lists.roles.some((r) => r.role === 'admin'), 'the roles are not in the lists of an admin');
  assert.ok(!last(eve, 'adm'), 'somebody with no role was sent the lists');
  for (const o of ['/god', '/noclip', '/vanish', '/tp 5 5', '/give bandage', `/slay #${ann.id}`]) assert.match(await eve.order(o), /not a thing you can do/);
  checks++;
  console.log('  ok  the lists go to whoever has a role and to nobody else; with no role no power is to be had');

  assert.match(await ann.order('/tp 100 -50'), /You are at 100, -50/);
  const put = last(ann, 'put');
  assert.ok(put && put.x === 100 && put.z === -50 && put.y === undefined && put.by === undefined, 'an admin was not put where they asked');
  assert.match(await ann.order(`/bring #${eve.id}`), /Eve is with you/);
  const brought = last(eve, 'put');
  assert.ok(brought && Math.hypot(brought.x - 100, brought.z + 50) < 3 && brought.by === 'Ann', 'somebody brought was not put beside the admin, or not told by whom');
  assert.match(await ann.order(`/goto #${fay.id}`), /You are with Fay/);
  ann.send({ t: 'adm' });
  await sleep(700);
  const fayAt = last(ann, 'adm')!.players.find((p) => p.name === 'Fay')!, annAt = last(ann, 'adm')!.players.find((p) => p.name === 'Ann')!;
  assert.ok(Math.hypot(fayAt.x - annAt.x, fayAt.z - annAt.z) < 3, 'an admin who went to somebody is not beside them');
  assert.match(await ann.order('/tp 99999 0'), /off the map/);
  checks++;
  console.log('  ok  an admin goes to a place, goes to a player and brings one, and whoever is brought is told by whom');

  // (into the inventory of whoever it is for, since 2026-10-13; on the ground when the order says so, as it always was. The whole of it is the last part of this file.)
  const markEve = eve.got.length;
  assert.equal(await ann.order('/give bandage 3'), '3 × Bandage: in your inventory; what finds no room there is at your feet.');
  const gift = last(ann, 'kit');
  assert.ok(gift && gift.adds && gift.gift === '3 × Bandage' && gift.by === undefined && gift.items.length === 1 && gift.items[0].id === 'bandage' && gift.items[0].qty === 3, 'what was given was not handed to her game to put away');
  assert.ok(!eve.got.slice(markEve).some((m) => m.t === 'loot+'), 'a thing given into an inventory was put on the ground as well');
  assert.equal(await ann.order('/give bandage 3 ground'), '3 × Bandage at your feet.');
  const made = last(eve, 'loot+');
  assert.ok(made && made.l.item.id === 'bandage' && made.l.item.qty === 3, 'what was given to the ground did not appear in the world');
  assert.equal(await ann.order(`/give ak #${eve.id}`), 'AK: in Eve\'s inventory; what finds no room there is at their feet.');
  const handed = last(eve, 'kit');
  assert.ok(handed && handed.adds && handed.by === 'Ann' && handed.gift === 'AK' && handed.items.length === 1 && handed.items[0].id === 'ak', 'a thing given to somebody else was not handed to their game, or not said to be from her');
  assert.match(await ann.order(`/give ak feet #${eve.id}`), /^AK at Eve's feet\.$/);
  assert.match(await ann.order('/give dogtag'), /Not a dog tag/);
  assert.match(await ann.order('/give zzzz'), /No thing is/);
  assert.match(await ann.order(`/kit assault #${eve.id}`), /Eve has the Assault kit/);
  const kit = last(eve, 'kit');
  assert.ok(kit && kit.by === 'Ann' && kit.items.some((it) => it.id === 'ar15' && it.mag === 'mag_ar_60' && it.loaded === 61 && it.mods?.includes('suppressor_556')), 'a kit did not reach who it was for with its rifle fitted out');
  assert.ok(new Set(kit.items.map((it) => it.uid)).size === kit.items.length && !kit.items.some((it) => it.id === 'dogtag'), 'a kit has a thing twice over, or a dog tag');
  assert.match(await ann.order('/kit nothing'), /The kits are: assault/);
  checks++;
  console.log('  ok  a thing given goes to the game of whoever it is for, or lies in the world for everybody when the ground is asked for; a dog tag is never made');

  assert.match(await ann.order('/god'), /Nothing hurts you/);
  // (the two choices for an admin's own death are made for them, until they make them otherwise)
  // (and the two that are about what is carried are off until they are put on: see the last part of this file)
  assert.deepEqual({ ...last(ann, 'powers'), t: 0 }, { t: 0, god: true, hidden: false, clip: false, voidInv: true, voidTag: true, weightless: false, endless: false, bottomless: false });
  assert.match(await ann.order('/voidtag off'), /your dog tag is on your body/);
  assert.equal(last(ann, 'powers')?.voidTag, false, 'what an admin chose for their death was not said back');
  assert.match(await ann.order('/voidtag'), /no dog tag of your own/);
  assert.match(await ann.order('/voidinv on'), /nothing you carried is left/);
  assert.ok(last(ann, 'powers')?.voidInv && last(ann, 'powers')?.voidTag, 'what an admin chose for their death was not said back');
  assert.match(await eve.order('/voidinv'), /not a thing you can do/);
  const seen = fay.got.length;
  assert.match(await ann.order('/vanish'), /Nobody but an admin sees you/);
  assert.ok(fay.got.slice(seen).some((m) => m.t === 'leave' && m.id === ann.id), 'a vanished admin was not taken out of the game of everybody else');
  const late = new Player('Gus');
  assert.ok(await late.join());
  const welcome = last(late, 'welcome')!;
  assert.ok(!welcome.players.some((p) => p.id === ann.id), 'somebody who came in was shown a vanished admin');
  assert.match(await ann.order('/vanish'), /seen again/);
  await sleep(200);
  assert.ok(fay.got.some((m) => m.t === 'join' && m.p.id === ann.id), 'an admin seen again was not put back in the game of everybody else');
  assert.match(await ann.order('/noclip on'), /You fly/);
  assert.equal(last(ann, 'powers')?.clip, true);
  checks++;
  console.log('  ok  god mode, vanish and noclip are put on and off, and said to whoever has them; vanished is gone from the game of everybody else');

  assert.match(await ann.order(`/mute #${eve.id} 5`), /Eve is muted for 5 minutes/);
  eve.send({ t: 'chat', ch: 'global', text: 'can anybody hear this' });
  await sleep(700);
  assert.ok(!fay.heard('can anybody hear this'), 'somebody muted was heard');
  assert.match(await ann.order(`/unmute #${eve.id}`), /heard again/);
  await sleep(600);
  eve.send({ t: 'chat', ch: 'global', text: 'and now' });
  await sleep(500);
  assert.ok(fay.heard('and now'), 'somebody unmuted was not heard');
  ann.send({ t: 'chat', ch: 'global', text: 'said by an admin' });
  await sleep(500);
  assert.equal((fay.got.find((m) => m.t === 'chat' && m.text === 'said by an admin') as { role?: string } | undefined)?.role, 'admin', 'a line of chat from an admin does not say so');
  assert.match(await ann.order(`/warn #${eve.id} stop that`), /has been warned/);
  assert.ok(eve.got.some((m) => m.t === 'tell' && /warns you: stop that/.test(m.text)), 'a warning did not reach who it was for');
  assert.match(await ann.order(`/heal #${eve.id}`), /Eve is whole/);
  assert.ok(last(eve, 'mend'), 'somebody healed was not told');
  assert.match(await ann.order(`/slay #${eve.id}`), /Eve is dead/);
  await sleep(200);
  assert.ok(fay.got.some((m) => m.t === 'death' && m.k.id === eve.id), 'somebody slain did not die for everybody');
  checks++;
  console.log('  ok  a mute silences and is lifted; the chat of an admin says so; a warning, a healing and a killing reach who they are for');

  // ---- another admin: the two death choices made for them, the vanished shown to them faintly, their powers an admin's to change
  assert.match(await ann.order(`/admin #${fay.id}`), /Fay is an admin/);
  await sleep(300);
  assert.ok(last(fay, 'powers')?.voidInv && last(fay, 'powers')?.voidTag, 'somebody made an admin does not have the two choices for their death made for them');
  const from = fay.got.length;
  assert.match(await ann.order('/vanish on'), /Nobody but an admin/);
  await sleep(400);
  assert.ok(fay.got.slice(from).some((m) => m.t === 'ghost' && m.id === ann.id && m.on), 'another admin was not told somebody had vanished');
  assert.ok(!fay.got.slice(from).some((m) => m.t === 'leave' && m.id === ann.id), 'a vanished admin was taken out of another admin\u2019s game');
  assert.ok(last(fay, 'ps')?.s.some((r) => r[0] === ann.id), 'another admin is not told where a vanished admin is');
  assert.ok(!last(late, 'ps')?.s.some((r) => r[0] === ann.id), 'somebody with no role is told where a vanished admin is');
  assert.match(await ann.order('/vanish off'), /seen again/);
  assert.match(await ann.order(`/god #${fay.id} on`), /Fay: god mode is on/);
  assert.equal(last(fay, 'powers')?.god, true, 'an admin\u2019s power was not put on by another admin');
  assert.match(await ann.order(`/noclip #${late.id}`), /not an admin/);
  checks++;
  console.log('  ok  somebody made an admin leaves nothing when they die until they choose to; admins see the vanished; an admin puts another admin\u2019s powers on');

  // ---- said to everybody, said to one, and two orders one on the heels of the other
  ann.send({ t: 'chat', ch: 'global', text: '/say hello all' });
  ann.send({ t: 'chat', ch: 'global', text: `/msg #${late.id} a word with you` });
  await sleep(700);
  assert.ok(late.got.some((m) => m.t === 'announce' && m.text === 'hello all' && m.by === 'Ann'), 'what was said to everybody did not reach everybody');
  assert.ok(late.got.some((m) => m.t === 'pm' && m.text === 'a word with you' && m.from === 'Ann' && m.role === 'admin'), 'the second of two orders given at once was lost, or a private word did not arrive');
  assert.ok(!fay.got.some((m) => m.t === 'pm'), 'a private word was heard by somebody else');
  assert.match(await ann.order(`/inv #${late.id}`), /Gus carries/);
  checks++;
  console.log('  ok  what is said to everybody reaches everybody; a private word reaches one; two orders at once are two orders');

  // ---- the staff channel, the tag put off, a kit of nothing, and a thing taken out of somebody's pockets
  {
    const from = { late: late.got.length, fay: fay.got.length, ann: ann.got.length };
    ann.send({ t: 'chat', ch: 'staff', text: 'for staff only' });
    late.send({ t: 'chat', ch: 'staff', text: 'let me in' });
    await sleep(600);
    assert.ok(fay.got.slice(from.fay).some((m) => m.t === 'chat' && m.ch === 'staff' && m.text === 'for staff only' && m.role === 'admin'), 'what one of the staff said to the staff did not reach another of them');
    assert.ok(!late.got.slice(from.late).some((m) => m.t === 'chat' && m.ch === 'staff'), 'somebody with no role heard the staff');
    assert.ok(!fay.got.slice(from.fay).some((m) => m.t === 'chat' && m.text === 'let me in'), 'somebody with no role spoke on the staff channel');
    ann.send({ t: 'tint', color: 'off' });
    await sleep(900);
    ann.send({ t: 'chat', ch: 'global', text: 'said as anybody' });
    await sleep(600);
    const plain = late.got.slice(from.late).find((m) => m.t === 'chat' && m.text === 'said as anybody') as { role?: string } | undefined;
    assert.ok(plain && plain.role === undefined, 'an admin who put their tag off was still said to be one');
    ann.send({ t: 'tint', color: null });
    await sleep(900);
    ann.send({ t: 'chat', ch: 'global', text: 'said as an admin' });
    await sleep(600);
    assert.ok(late.got.slice(from.late).some((m) => m.t === 'chat' && m.text === 'said as an admin' && m.role === 'admin'), 'the tag did not come back');
    assert.match(await ann.order(`/clear #${late.id}`), /carries nothing now/);
    const kit = late.got.slice(from.late).filter((m) => m.t === 'kit').pop() as { name: string; items: unknown[]; adds?: true } | undefined;
    assert.ok(kit && kit.name === '' && kit.items.length === 0 && !kit.adds, 'emptying somebody was not a kit of nothing in place of what they carry');
    assert.match(await late.order('/clear'), /Only an admin|not a thing you can do/);
    assert.match(await ann.order(`/trash #${late.id} no-such-thing`), /does not carry that/);
    await ann.order(`/pockets #${late.id}`);
    assert.ok(ann.got.slice(from.ann).some((m) => m.t === 'inv' && m.id === late.id), 'what somebody carries was not sent to the admin who asked');
    checks++;
    console.log('  ok  the staff channel is the staff’s alone; a tag put off is off; everything emptied is a kit of nothing; pockets are sent to the admin who asks');
  }

  // ---- taken out of the world by an admin: a thing on the ground; and a restart said to everybody
  const at = ann.got.filter((m) => m.t === 'welcome').pop() as unknown as { spawn: { x: number; z: number } };
  // (she has been about: she says where she stands, and puts it down there)
  ann.send({ t: 's', p: [at.spawn.x, 0, at.spawn.z, 0, 0, 0], w: null, m: [] });
  await sleep(200);
  ann.send({ t: 'drop', l: { item: { uid: 'admin-test-tin', id: 'beans', qty: 1 }, x: at.spawn.x, y: 0, z: at.spawn.z, rot: 0 } });
  await sleep(300);
  assert.ok(late.got.some((m) => m.t === 'loot+' && m.l.uid === 'admin-test-tin'), 'a thing put down does not lie there');
  assert.match(await late.order('/del item admin-test-tin'), /not a thing you can do/, 'somebody with no role took a thing out of the world');
  assert.ok(!late.got.some((m) => m.t === 'loot-' && m.uid === 'admin-test-tin'), 'somebody with no role took a thing out of the world');
  assert.match(await ann.order('/del item admin-test-tin'), /Taken away: /);
  await sleep(300);
  assert.ok(late.got.some((m) => m.t === 'loot-' && m.uid === 'admin-test-tin'), 'a thing an admin took away still lies there for everybody else');
  assert.match(await ann.order('/del item admin-test-tin'), /Nothing of that number/);
  assert.match(await ann.order('/del box no-such-box'), /No body, drop or buried stash/);
  assert.match(await ann.order('/del'), /Take away what/);
  assert.match(await ann.order('/restart 45 update: buildings'), /restarts in 45 s \(update: buildings\)/);
  await sleep(300);
  const said = late.got.filter((m) => m.t === 'restart').pop() as { why: string; in: number } | undefined;
  assert.ok(said && said.why === 'update: buildings' && said.in === 45, 'a restart an admin warned of was not said to everybody');
  checks++;
  console.log('  ok  an admin takes a thing out of the world, and nobody else does; a restart warned of is said to everybody, with why');

  // ---- stood in the world by an admin, and taken out of it: cars of both kinds, the infected. Nobody else can.
  {
    const orders = ['/spawn jeep', '/spawn infected 3', '/delcar', '/wrecks', '/delz'];
    for (const o of orders) assert.match(await late.order(o), /not a thing you can do/, `somebody with no role gave ${o}`);
    assert.match(await ann.order(`/mod #${late.id}`), /Gus is a mod/);
    await sleep(300);
    const mark = late.got.length;
    for (const o of orders) assert.match(await late.order(o), /Only an admin/, `a mod gave ${o}`);
    assert.ok(!late.got.slice(mark).some((m) => m.t === 'v+' || m.t === 'v-' || m.t === 'i+' || m.t === 'ihp'), 'a mod put something in the world, or took something out of it');

    // a jeep a few steps in front of her; a police car at the map numbers given
    assert.match(await ann.order('/tp 200 200'), /You are at 200, 200/);
    assert.match(await ann.order('/spawn jeep'), /^Jeep at -?\d+, -?\d+ \(number \d+\)/);
    const jeep = late.got.slice(mark).filter((m) => m.t === 'v+').pop() as Extract<S2C, { t: 'v+' }> | undefined;
    assert.ok(jeep && Math.hypot(jeep.v.s[0] - 200, jeep.v.s[2] - 200) < 10 && jeep.v.k === undefined && jeep.v.hp > 0 && jeep.v.seats.every((s) => s === null), 'a jeep an admin stood is not there for everybody, a few steps in front of the admin');
    assert.match(await ann.order('/spawn police 1 230 215'), /^Police car at 230, 215/);
    const cop = late.got.slice(mark).filter((m) => m.t === 'v+').pop() as Extract<S2C, { t: 'v+' }> | undefined;
    assert.ok(cop && cop.v.i !== jeep.v.i && cop.v.k === 1 && Math.abs(cop.v.s[0] - 230) < 0.01 && Math.abs(cop.v.s[2] - 215) < 0.01, 'a police car was not stood at the map numbers given');
    assert.match(await ann.order('/spawn dragon'), /Stand what\? One of: jeep, police, infected/);
    assert.match(await ann.order('/spawn jeep 1 99999 0'), /off the map/);
    assert.match(await ann.order('/spawn jeep two'), /how many/);
    // (two numbers could be how many and half a place, or a place: nothing is stood, and it is asked again)
    assert.match(await ann.order('/spawn jeep 230 215'), /how many \(up to 4\), and then/);
    assert.equal(late.got.slice(mark).filter((m) => m.t === 'v+').length, 2, 'an order that could not be read stood something');
    // (somebody who comes in afterwards is shown them, as any car)
    ann.send({ t: 'adm' });
    await sleep(700);
    const cars = last(ann, 'adm')!.stats?.cars ?? 0;
    assert.ok(cars >= 2 && last(ann, 'adm')!.stats?.wrecks === 0, 'the lists do not say how many cars stand');

    // taken away by its number, and the nearest with no number
    assert.match(await ann.order(`/delcar ${cop.v.i}`), /Taken away: the police car, number/);
    assert.ok(late.got.slice(mark).some((m) => m.t === 'v-' && m.i === cop.v.i), 'a car an admin took away by its number is still there for everybody else');
    assert.match(await ann.order('/delcar 99999'), /No car of that number/);
    assert.match(await ann.order('/delcar soon'), /takes away the car nearest you/);

    // burned out (her own grenades: she is proof against them), and the wreck cleared away
    assert.match(await ann.order('/wrecks'), /No car is burned out/);
    ann.send({ t: 'nade', o: [200, 1, 200], v: [0, 2, -6] });
    await sleep(100);
    for (let k = 0; k < 7; k++) ann.send({ t: 'vhit', i: jeep.v.i, w: 'grenade' });
    await sleep(500);
    assert.ok(late.got.slice(mark).some((m) => m.t === 'vboom' && m.i === jeep.v.i), 'the jeep did not burn: there is no wreck to try the order on');
    ann.send({ t: 'adm' });
    await sleep(700);
    assert.equal(last(ann, 'adm')!.stats?.wrecks, 1, 'the lists do not count a burned-out car');
    assert.match(await ann.order('/wrecks'), /Cleared away: 1 burned-out car\./);
    assert.ok(late.got.slice(mark).some((m) => m.t === 'v-' && m.i === jeep.v.i), 'a wreck an admin cleared away is still there for everybody else');
    assert.match(await ann.order('/spawn jeep'), /^Jeep at/);
    const near = late.got.slice(mark).filter((m) => m.t === 'v+').pop() as Extract<S2C, { t: 'v+' }>;
    assert.match(await ann.order('/delcar'), /Taken away: the jeep, number/);
    assert.ok(late.got.slice(mark).some((m) => m.t === 'v-' && m.i === near.v.i), 'the car nearest an admin was not the one taken away');
    ann.send({ t: 'adm' });
    await sleep(700);
    assert.equal(last(ann, 'adm')!.stats?.cars, cars - 2, 'what was taken away is still counted');

    // the infected: as many as asked for, each a pace from the next, where she is; no more than the most at once; and put down
    assert.match(await ann.order('/delz'), /None of the infected is on its feet within 60 metres/);
    assert.match(await ann.order('/spawn infected 3'), /^3 of the infected at/);
    const stood = late.got.slice(mark).filter((m) => m.t === 'i+') as Extract<S2C, { t: 'i+' }>[];
    assert.equal(stood.length, 3, 'the infected an admin stood are not there for everybody');
    assert.ok(stood.every((m) => Math.hypot(m.b.s[0] - 200, m.b.s[2] - 195) < 6 && m.b.hp > 0 && m.b.own === null), 'the infected were not stood a few steps in front of the admin');
    assert.ok(stood.every((a) => stood.every((b) => a === b || Math.hypot(a.b.s[0] - b.b.s[0], a.b.s[2] - b.b.s[2]) > 1.5)), 'two of the infected were stood in one place');
    assert.match(await ann.order('/spawn zombie 999 260 260'), /^25 of the infected at 260, 260/);
    ann.send({ t: 'adm' });
    await sleep(700);
    assert.equal(last(ann, 'adm')!.stats?.infected, 28);
    assert.match(await ann.order('/delz 30'), /Put down: 3 of the infected within 30 metres/);
    const down = late.got.slice(mark).filter((m) => m.t === 'ihp' && m.dead).map((m) => (m as Extract<S2C, { t: 'ihp' }>).i).sort();
    assert.deepEqual(down, stood.map((m) => m.b.i).sort(), 'the infected an admin put down did not fall for everybody, or others fell with them');
    assert.match(await ann.order('/delz 400'), /Put down: 25 of the infected/);
    // (and the server's clock has gone round with them there: it still answers)
    await sleep(1200);
    assert.match(await ann.order('/delz 400'), /None of the infected/);
    checks++;
    console.log('  ok  an admin stands a jeep, a police car and the infected in the world and takes them out of it, for everybody; a mod and a player cannot');
  }

  // ---- a ban is lifted by its own id: two bans of one name, a list that has moved since it was read, and a name that means more than one
  {
    const sam = new Player('Sam'), other = new Player('Sam');
    assert.ok(await sam.join(), 'Sam was not let in');
    assert.ok(await other.join(), 'the other Sam was not let in');
    assert.match(await ann.order(`/ban #${sam.id} the first of them`), /Sam is banned/);
    assert.match(await ann.order(`/ban #${other.id} the second of them`), /Sam is banned/);
    ann.send({ t: 'adm' });
    await sleep(700);
    const listed = last(ann, 'adm')!.bans, rows = listed.filter((b) => b.name === 'Sam');
    assert.equal(rows.length, 2);
    assert.ok(listed.every((b) => /^a:[0-9a-f]{8}$/.test(b.id ?? '')) && new Set(listed.map((b) => b.id)).size === listed.length, 'a ban in the lists has no id of its own');
    assert.ok(!JSON.stringify(listed).includes(sam.key) && !JSON.stringify(listed).includes(sam.ip), 'the lists say whose key or address a ban is of');
    const read = await ann.order('/bans');
    assert.ok(rows.every((b) => read.includes(`[${b.id}]`)), '/bans does not print the ids');
    // the name alone means both: neither is lifted, and both are read out with their ids
    const both = await ann.order('/unban Sam');
    assert.match(both, /More than one ban is "Sam", and none of them is lifted/);
    assert.ok(rows.every((b) => both.includes(`/unban ${b.id} `)), 'the bans a name could mean were not read out with their ids');
    assert.equal(kept().bans.filter((b) => b.name === 'Sam').length, 2, 'a name that two bans have lifted one of them');
    // the list moves under the panel (another ban above them is lifted): the id still lifts the one it was read for
    assert.ok(listed.length > rows.length && listed[0].name !== 'Sam', 'there is no older ban to lift: the list cannot be made to move');
    assert.match(await ann.order('/unban 1'), new RegExp(`${listed[0].name} is no longer banned`));
    assert.match(await ann.order(`/unban ${rows[1].id}`), /Sam is no longer banned/);
    assert.equal(kept().bans.filter((b) => b.name === 'Sam').length, 1);
    assert.ok(await other.join(), 'the ban lifted by its id was not the one that was meant');
    assert.ok(!(await sam.join()), 'a ban lifted by its id lifted another of the same name');
    assert.match(await ann.order(`/unban ${rows[1].id}`), /No ban is/);
    // one banned and one kept off for a while, of the same name: the name means both, across the two lists
    assert.match(await ann.order(`/timeout #${other.id} 5 cooling off`), /off the server for 5 minutes/);
    ann.send({ t: 'adm' });
    await sleep(700);
    const off = last(ann, 'adm')!.bans.filter((b) => b.name === 'Sam');
    assert.deepEqual(off.map((b) => b.id?.slice(0, 2)).sort(), ['a:', 't:'], 'somebody kept off for a while has no id of their own in the lists');
    const mixed = await ann.order('/unban sam');
    assert.match(mixed, /More than one ban is "sam"/);
    assert.ok(off.every((b) => mixed.includes(`/unban ${b.id} `)));
    assert.ok(!(await other.join()), 'a name that a ban and a time off both have lifted the time off');
    assert.match(await ann.order(`/unban ${off.find((b) => b.id?.startsWith('t:'))!.id}`), /Sam is no longer kept off/);
    assert.ok(await other.join(), 'a time off lifted by its id still keeps them off');
    assert.ok(!(await sam.join()), 'lifting a time off lifted a ban of the same name');
    // (and the one ban of that name left is lifted by the name, as ever)
    assert.match(await ann.order('/unban Sam'), /Sam is no longer banned/);
    assert.ok(await sam.join(), 'the last ban of a name was not lifted by the name');
    checks++;
    console.log('  ok  a ban has an id of its own, and is lifted by it whatever the list has become; a name that more than one ban has lifts none, and they are read out');
  }
});

// ---- what an admin carries, and fires (2026-10-13): weightless, endless ammunition, and the refill (the rules of
// them are src/sim/powers.ts, tried by themselves in test/powers.test.ts). On a server that ENFORCES its checks, as
// the live one does: no check may fire on an admin who uses them, nor on anybody they are used on. And since no
// check ever looks at an admin (`flag` in server/index.ts), what an admin's game says with the powers on is said
// here by a plain player's too, whom every check does look at; and the checks are shown, last of all, to be awake.
if (ALL) await withServer(async (log) => {
  const ivy = new Player('Ivy'), moe = new Player('Moe'), ned = new Player('Ned');
  for (const p of [ann, ivy, moe, ned]) assert.ok(await p.join(), `${p.name} was not let in`);
  await sleep(400);
  const last = <T extends S2C['t']>(p: Player, t: T) => p.got.filter((m) => m.t === t).pop() as Extract<S2C, { t: T }> | undefined;
  const powers = (p: Player) => ({ ...last(p, 'powers'), t: 0 });
  const lists = async () => {
    ann.send({ t: 'adm' });
    await sleep(700);
    return last(ann, 'adm')!;
  };
  /** an order from somebody with a role (theirs are not held half a second apart, as talk is): what is said back, as soon as it is */
  const tell = async (p: Player, text: string, until: S2C['t'] = 'sys') => {
    const from = p.got.length;
    p.send({ t: 'chat', ch: 'global', text });
    for (let k = 0; k < 80 && !p.got.slice(from).some((m) => m.t === until); k++) await sleep(25);
    await sleep(80);
    return p.got.slice(from).filter((m) => m.t === 'sys').map((m) => (m as { text: string }).text).join('\n');
  };
  /**
   * Waited for, a little at a time. Nothing that one player's game is to see of what another's did is taken on the
   * strength of a sleep: two connections are read by the server in no order when it has been held up, and the
   * machine this runs on can be held up for a second.
   */
  const until = async (good: () => boolean | Promise<boolean>, what: string, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await good()) return;
    assert.fail(`waited ${ms / 1000} s for it, and it never was so: ${what}`);
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  /** where the server has somebody: their own row of what it says of everybody, many times a second */
  const row = (p: Player) => last(p, 'ps')!.s.find((r) => r[0] === p.id)!;
  const apart = (a: Player, b: Player) => Math.hypot(row(a)[1] - row(b)[1], row(a)[3] - row(b)[3]);
  /** their game says where it stands (there), and what is in its hands */
  const stand = (p: Player, w: string | null = null) => {
    const r = row(p);
    p.send({ t: 's', p: [r[1], r[2], r[3], 0, 0, r[6]], w, m: [] });
  };
  /** and goes to and fro on the spot at the pace of somebody who carries nothing, head turning as it goes: 7.4 m/s, for two and a half seconds */
  const run = async (p: Player, w: string) => {
    const r = row(p);
    for (let k = 1; k <= 26; k++) {
      p.send({ t: 's', p: [r[1] + (k % 2) * 0.74, r[2], r[3], k * 0.2, 0, r[6]], w, m: [] });
      await sleep(100);
    }
  };
  /** what a game does with a kit (`kitUp` in src/game/game.ts): each thing put on or away */
  const wear = (p: Player) => {
    const inv = new PlayerInventory(), things = last(p, 'kit')!.items;
    for (const it of things) assert.equal(inv.add(it), null, `${p.name}'s game found no room for ${it.id}`);
    return { inv, pick: (id: string) => things.filter((it) => it.id === id) };
  };
  /** a game says what it carries, as it does after anything */
  const say = (p: Player, inv: PlayerInventory) => p.send({ t: 'me', inv: inv.serialize(), vitals: { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false } });
  /** every gun and magazine in an inventory as it is kept and sent, wherever it is: which it is, and what is in it */
  const within = (things: ItemInstance[]): ItemInstance[] => things.flatMap((it) => [it, ...within((it.cargo ?? []).map((q) => q.item))]);
  const fed = (inv: SerializedInventory | null) => within(carriedOf(inv)).filter((it) => ITEMS[it.id].weapon || ITEMS[it.id].mag).map((it) => [it.uid, it.id, it.mag ?? null, it.loaded ?? null, it.rounds ?? null]).sort();
  const sent = (inv: PlayerInventory) => JSON.parse(JSON.stringify(inv.serialize())) as SerializedInventory;
  /** the server's own copy of what somebody carries (`/pockets`, the panel's Inventory page) */
  const copy = async (of: Player) => {
    await tell(ann, `/pockets #${of.id}`, 'inv');
    return last(ann, 'inv')!.inv;
  };
  /**
   * A game fires a gun at Ivy, a shot at a time at the AK's pace, saying what it carries as it goes. The round each
   * shot takes out of the gun is what the game itself takes (`tryFire` in src/game/weapons.ts): one, or none with
   * endless ammunition on. An empty gun does not fire. @returns how many shots went
   */
  const fire = async (p: Player, gun: ItemInstance, inv: PlayerInventory, shots: number, endless: boolean) => {
    const r = row(p);
    let fired = 0;
    for (let k = 0; k < shots && (gun.loaded ?? 0) > 0; k++) {
      gun.loaded = (gun.loaded ?? 0) - roundsSpent(endless);
      p.send({ t: 'shot', o: [r[1], r[2] + 1.6, r[3]], d: [0, 0, -1], w: gun.id, sup: false });
      p.send({ t: 'hit', to: ivy.id, zone: 'legs', w: gun.id, dist: 2, sup: false, bonus: 0 });
      fired++;
      if (k % 10 === 9) say(p, inv);
      await sleep(100);
    }
    say(p, inv);
    await sleep(200);
    return fired;
  };
  await until(() => [ann, ivy, moe, ned].every((p) => !!last(p, 'ps')?.s.some((r) => r[0] === p.id)), 'everybody is told where they are');
  for (const p of [ann, ivy, moe, ned]) stand(p);
  assert.equal((await lists()).checks, 'enforce', 'this server is not enforcing its checks');

  // ---- nobody but an admin: a player and a mod are refused all three, in the words every admin's order is refused in
  const three = ['/weightless on', '/ammo on', '/refill'];
  // (What somebody with no role types is not heard twice inside half a second, and a held-up machine can bring two
  // lines that close together: one that got no answer at all is typed again, as anybody would.)
  const typed = async (p: Player, text: string) => {
    for (let k = 0; k < 3; k++) {
      const back = await p.order(text);
      if (back) return back;
      await sleep(700);
    }
    return '';
  };
  for (const o of three) assert.equal(await typed(ned, o), 'That is not a thing you can do here.', `somebody with no role gave ${o}`);
  assert.match(await tell(ann, `/mod #${moe.id}`), /Moe is a mod/);
  await sleep(200);
  assert.equal(await tell(moe, '/god'), 'Only an admin can do that.');
  for (const o of [...three, '/weightless', '/ammo off', `/refill #${ned.id}`, `/ammo #${ann.id} on`]) assert.equal(await tell(moe, o), 'Only an admin can do that.', `a mod gave ${o}`);
  assert.ok(![ann, moe, ned].some((p) => p.got.some((m) => m.t === 'refill')), 'an order that was refused filled something');
  assert.ok(![moe, ned].some((p) => p.got.some((m) => m.t === 'powers')), 'somebody who is no admin was told of powers');
  assert.deepEqual(powers(ann), { t: 0, god: false, hidden: false, clip: false, voidInv: true, voidTag: true, weightless: false, endless: false, bottomless: false }, 'an order that was refused put a power on');
  checks++;
  console.log('  ok  a player and a mod are refused weightless, endless ammunition and the refill, in the words the other admin’s orders are refused in');

  // ---- put on and off by their words, turned over with no word, said back in words and in the `powers` message
  assert.equal(await tell(ann, '/weightless on'), 'What you carry weighs nothing now: however much it is, it never slows you.');
  assert.deepEqual(powers(ann), { t: 0, god: false, hidden: false, clip: false, voidInv: true, voidTag: true, weightless: true, endless: false, bottomless: false });
  assert.equal(await tell(ann, '/weightless off'), 'What you carry weighs what it weighs again.');
  assert.equal(last(ann, 'powers')?.weightless, false);
  assert.match(await tell(ann, '/weightless'), /weighs nothing now/);
  assert.match(await tell(ann, '/ammo on'), /^Firing takes no round out of your gun now: it never runs dry\./);
  assert.equal(last(ann, 'powers')?.endless, true);
  assert.equal(await tell(ann, '/ammo'), 'Your gun spends its rounds again.');
  assert.equal(last(ann, 'powers')?.endless, false);
  assert.match(await tell(ann, '/ammo on'), /takes no round/);
  // (a word that says which way turns nothing over: on, and put on again, it is on)
  assert.match(await tell(ann, '/ammo on'), /takes no round/);
  assert.deepEqual(powers(ann), { t: 0, god: false, hidden: false, clip: false, voidInv: true, voidTag: true, weightless: true, endless: true, bottomless: false });
  const listed = (await lists()).players;
  assert.ok(listed.find((p) => p.name === 'Ann')?.weightless && listed.find((p) => p.name === 'Ann')?.endless, 'the lists do not say which of the two an admin has on');
  assert.ok(listed.filter((p) => p.name !== 'Ann').every((p) => !p.weightless && !p.endless), 'the lists say somebody else has them on');
  checks++;
  console.log('  ok  weightless and endless ammunition are put on and off, turned over with no word, and said back in words, in the powers message and in the lists');

  // ---- another admin's are an admin's to put on and off, the word and the name in either order; nobody's who is not one
  assert.match(await tell(ann, `/admin #${ivy.id}`), /Ivy is an admin/);
  await sleep(200);
  assert.equal(await tell(ann, `/ammo #${ivy.id} on`), 'Ivy: endless ammunition is on.');
  assert.equal(await tell(ann, `/weightless on #${ivy.id}`), 'Ivy: weightless is on.');
  await until(() => !!last(ivy, 'powers')?.weightless, 'Ivy is told of the power put on for her');
  assert.deepEqual(powers(ivy), { t: 0, god: false, hidden: false, clip: false, voidInv: true, voidTag: true, weightless: true, endless: true, bottomless: false }, 'another admin was not told the powers put on for them');
  assert.ok(ivy.got.some((m) => m.t === 'sys' && m.text === 'Ann has put endless ammunition on for you.'), 'another admin was not told who put a power on for them');
  assert.equal(await tell(ann, `/weightless #${ivy.id} off`), 'Ivy: weightless is off.');
  await until(() => last(ivy, 'powers')?.weightless === false, 'Ivy is told of the power put off for her');
  assert.equal(last(ivy, 'powers')?.endless, true, 'one power put off put the other off');
  assert.equal(await tell(ann, `/ammo on #${ned.id}`), 'Ned is not an admin: these are an admin\'s.');
  assert.equal(await tell(ann, `/weightless #${moe.id}`), 'Moe is not an admin: these are an admin\'s.');
  assert.match(await tell(ann, '/ammo on #999'), /Nobody online is "#999"/);
  assert.ok(![moe, ned].some((p) => p.got.some((m) => m.t === 'powers')), 'somebody who is no admin was given a power');
  checks++;
  console.log('  ok  an admin puts another admin’s two on and off, and they are told by whom; nobody who is not an admin has either');

  // ---- kept: through her death, and when she goes and comes back in (until the server restarts, as what she chose for her death is)
  assert.match(await tell(ann, '/die'), /You are dead/);
  ann.send({ t: 'respawn' });
  await sleep(400);
  const back = (await lists()).players.find((p) => p.name === 'Ann')!;
  assert.ok(back.alive && back.weightless && back.endless, 'an admin who died and came back to life has lost the two powers she had on');
  ann.ws.close();
  await sleep(500);
  assert.ok(await ann.join(), 'the admin could not come back in');
  await until(() => !!last(ann, 'powers') && !!last(ann, 'ps')?.s.some((r) => r[0] === ann.id), 'she is told what she is and where');
  stand(ann);
  assert.deepEqual(powers(ann), { t: 0, god: false, hidden: false, clip: false, voidInv: true, voidTag: true, weightless: true, endless: true, bottomless: false }, 'an admin who went and came back in was not told she still has the two powers on');
  checks++;
  console.log('  ok  both are kept through an admin’s death, and are hers again, and said to her again, when she comes back in');

  // ---- the refill: a known set of guns and magazines, part shot off, one of them in a bag in her pack
  assert.match(await tell(ann, '/kit heavy', 'kit'), /You have the Heavy kit/);
  const hers = wear(ann);
  const [ak] = hers.pick('ak'), [deagle] = hers.pick('deagle'), [drum] = hers.pick('drum_ak'), aks = hers.pick('mag_ak'), [ext] = hers.pick('mag_deagle_ext');
  assert.deepEqual([ak.mag, ak.loaded, deagle.mag, deagle.loaded, drum.rounds, aks.map((m) => m.rounds), ext.rounds], ['drum_ak', 76, 'mag_deagle_ext', 11, 75, [30, 30, 30], 10]);
  ak.loaded = 12;
  deagle.loaded = 0;
  drum.rounds = 0;
  aks[0].rounds = 7;
  aks[1].rounds = 0;
  ext.rounds = 3;
  const bag = makeItem('black_bag');
  hers.inv.remove(aks[1]);
  // (room for the bag is made in her pack, which the kit fills: things that are neither a gun nor a magazine come out of it until the bag fits)
  const pack = hers.inv.cargoOf(hers.inv.slots.back!)!;
  for (const q of [...pack.items]) if (!pack.hasRoom(bag) && !ITEMS[q.item.id].weapon && !ITEMS[q.item.id].mag) hers.inv.remove(q.item);
  assert.ok(bagGrid(bag)!.add(aks[1]) === null && pack.add(bag) === null, 'the bag did not go into her pack');
  say(ann, hers.inv);
  await sleep(300);
  assert.deepEqual(fed(await copy(ann)), fed(sent(hers.inv)), 'the server does not have what her game said it carries');
  // (four magazines and two guns took rounds: the third AK magazine was full, and is not counted)
  assert.equal(await tell(ann, '/refill'), '4 magazines and 2 guns filled.');
  const told = last(ann, 'refill');
  assert.ok(told && told.by === undefined, 'her game was not told to fill what it carries');
  // the server's own copy, there and then, before her game has said a word
  const theirs = fed(await copy(ann));
  assert.deepEqual(theirs.map(([, id, mag, loaded, rounds]) => [id, mag, loaded, rounds]).sort(), [
    ['ak', 'drum_ak', 76, null], ['deagle', 'mag_deagle_ext', 11, null], ['drum_ak', null, null, 75],
    ['mag_ak', null, null, 30], ['mag_ak', null, null, 30], ['mag_ak', null, null, 30], ['mag_deagle_ext', null, null, 10],
  ].sort(), 'the server’s copy of what she carries is not full after a refill');
  // her game does as it was told, by the same rule, and says what it carries: the two agree, thing for thing
  assert.equal(refilledWords(refill(hers.inv.topLevel())), '4 magazines and 2 guns filled');
  assert.deepEqual(fed(sent(hers.inv)), theirs, 'her game and the server’s copy do not agree after a refill');
  say(ann, hers.inv);
  await sleep(300);
  assert.deepEqual(fed(await copy(ann)), theirs, 'what her game said it carries after the refill is not what the server has');
  assert.equal(await tell(ann, '/refill'), 'Every magazine and gun you carry is full already.');
  checks++;
  console.log('  ok  a refill fills every gun and magazine an admin carries, the one in a bag in her pack too, says how many, and the server’s own copy agrees with her game’s');

  // ---- endless ammunition, weightless, and a very heavy kit: she fires more rounds than the drum holds at somebody
  // nothing hurts, and goes about at the pace of somebody who carries nothing
  const kg = hers.inv.weight();
  // (a survivor carries 18 kg before it slows them: CARRY_LIMIT in src/game/player.ts)
  assert.ok(kg > 2 * 18, `what she carries weighs ${kg.toFixed(1)} kg: not much of a weight to try this with`);
  assert.equal(weightFelt(kg, !!last(ann, 'powers')?.weightless), 0, 'with the power on her legs are still told a weight');
  assert.match(await tell(ann, `/goto #${ned.id}`), /You are with Ned/);
  assert.match(await tell(ann, `/bring #${ivy.id}`), /Ivy is with you/);
  assert.match(await tell(ann, `/god #${ivy.id} on`), /Ivy: god mode is on/);
  await until(() => apart(ann, ned) < 5 && apart(ann, ivy) < 5 && apart(ned, ivy) < 5, 'the three of them are told they stand together');
  stand(ann, 'ak');
  await sleep(150);
  assert.equal(await fire(ann, ak, hers.inv, 80, !!last(ann, 'powers')?.endless), 80, 'her gun ran dry with endless ammunition on');
  assert.equal(ak.loaded, 76, 'a round was spent with endless ammunition on');
  assert.deepEqual(fed(await copy(ann)), theirs, 'after eighty shots the server does not have her gun as full as it was');
  await run(ann, 'ak');
  // (and the server still takes her shots: Ivy can be hurt again, and one lands)
  assert.match(await tell(ann, `/god #${ivy.id} off`), /Ivy: god mode is off/);
  assert.equal(await fire(ann, ak, hers.inv, 1, true), 1);
  await until(() => ann.got.some((m) => m.t === 'hitok' && m.to === ivy.id), 'after all that, a shot of hers is taken by the server');
  assert.match(await tell(ann, `/god #${ivy.id} on`), /Ivy: god mode is on/);
  checks++;
  console.log(`  ok  an admin with endless ammunition fires eighty rounds from a drum of seventy-five and has it full; weightless, she goes about under ${kg.toFixed(0)} kg; and her shots still land`);

  // ---- used on somebody who is no admin: Ned is a player like any other, and every check looks at him
  assert.match(await tell(ann, `/kit breacher #${ned.id}`), /Ned has the Breacher kit/);
  await until(() => !!last(ned, 'kit'), 'Ned is handed the kit');
  const his = wear(ned);
  const [shotgun] = his.pick('benelli'), [smg] = his.pick('mpa'), mpas = his.pick('mag_mpa');
  assert.deepEqual([shotgun.mag ?? null, shotgun.loaded, smg.mag, smg.loaded, mpas.map((m) => m.rounds)], [null, 7, 'mag_mpa', 31, [30, 30, 30]]);
  shotgun.loaded = 1;
  smg.loaded = 0;
  mpas[0].rounds = 5;
  mpas[1].rounds = 0;
  say(ned, his.inv);
  await until(async () => same(fed(await copy(ned)), fed(sent(his.inv))), 'the server has what his game said it carries');
  assert.equal(await tell(ann, `/refill #${ned.id}`), '2 magazines and 2 guns filled, for Ned.');
  await until(() => !!last(ned, 'refill'), 'his game is told to fill what it carries');
  assert.equal(last(ned, 'refill')?.by, 'Ann', 'his game was not told by whom');
  const kept = fed(await copy(ned));
  assert.deepEqual(kept.map(([, id, mag, loaded, rounds]) => [id, mag, loaded, rounds]).sort(), [['benelli', null, 7, null], ['mag_mpa', null, null, 30], ['mag_mpa', null, null, 30], ['mag_mpa', null, null, 30], ['mpa', 'mag_mpa', 31, null]].sort(), 'the server’s copy of what he carries is not full after a refill');
  assert.equal(refilledWords(refill(his.inv.topLevel())), '2 magazines and 2 guns filled');
  assert.deepEqual(fed(sent(his.inv)), kept, 'his game and the server\u2019s copy do not agree after a refill');
  // (and when his game has said what it carries, the server's copy is that still)
  say(ned, his.inv);
  await sleep(500);
  assert.deepEqual(fed(await copy(ned)), kept, 'what his game said it carries after the refill is not what the server has');
  // he fires the shells he was given, and the tube is empty when it ought to be
  stand(ned, 'benelli');
  await sleep(150);
  assert.equal(await fire(ned, shotgun, his.inv, 9, false), 7, 'a tube of seven did not fire seven');
  await until(async () => same(fed(await copy(ned)), fed(sent(his.inv))), 'the server has his tube empty');
  // Refilled again, his game is made to say what an admin's says with the two powers on: twelve shots from a tube of
  // seven and seven still in it, and two and a half seconds at an unladen run under everything he carries. No check
  // looks at an admin, so this is where it is seen that none of them counts a round or weighs a pack. (The day one
  // does, this fails, and an admin with the power on has to be let past it there.)
  assert.equal(await tell(ann, `/refill #${ned.id}`), '1 gun filled, for Ned.');
  refill(his.inv.topLevel());
  assert.equal(await fire(ned, shotgun, his.inv, 12, true), 12);
  assert.equal(shotgun.loaded, 7);
  assert.ok(his.inv.weight() > 2 * 18, `what he carries weighs ${his.inv.weight().toFixed(1)} kg`);
  await run(ned, 'benelli');
  // and he puts the gun that was refilled down: a thing put down is asked of the server's list of what it put in the world
  his.inv.remove(smg);
  ned.send({ t: 'drop', l: { item: smg, x: row(ned)[1], y: row(ned)[2], z: row(ned)[3], rot: 0 } });
  say(ned, his.inv);
  await until(() => ann.got.some((m) => m.t === 'loot+' && m.l.uid === smg.uid && m.l.item.loaded === 31), 'the gun that was refilled lies where he put it down, for everybody');
  await until(async () => same(fed(await copy(ned)), fed(sent(his.inv))), 'the server has what he carries now');
  checks++;
  console.log('  ok  a refill an admin does for a player fills what they carry and is said to them; what an admin’s game says with the two powers on is said by a player’s');

  // ---- and nobody was flagged, by a server that refuses what it flags
  const now = await lists();
  assert.deepEqual(now.players.map((p) => [p.name, p.flags]).sort(), [['Ann', 0], ['Ivy', 0], ['Moe', 0], ['Ned', 0]], 'a check fired on somebody');
  assert.equal(await tell(ann, '/flagged'), 'Nobody online has been flagged.');
  assert.ok(!log().includes('[check:'), `a check wrote something down:\n${log().split('\n').filter((l) => l.includes('[check:')).join('\n')}`);
  assert.ok(![ann, ivy, moe, ned].some((p) => p.shut || p.kicked), 'somebody was put off the server');
  // (the checks are awake: a gun the server never made, in the pockets of the player it has just looked at so long, is flagged and is taken out of its copy)
  assert.equal(his.inv.add(makeItem('m9')), null);
  say(ned, his.inv);
  await until(async () => ((await lists()).players.find((p) => p.name === 'Ned')?.flags ?? 0) > 0, 'a gun the server never put in the world is flagged (if it is not, the checks were asleep all along)');
  // (once, and nobody else at all: his game had said everything else of his before this, and none of that was flagged)
  assert.deepEqual(last(ann, 'adm')!.players.map((p) => [p.name, p.flags]).sort(), [['Ann', 0], ['Ivy', 0], ['Moe', 0], ['Ned', 1]]);
  assert.deepEqual(log().split('\n').filter((l) => l.includes('[check:')).map((l) => l.trim().replace(/^\S+ /, '').replace(/ \(\S+\),/, ',')), ['[check:enforce] Ned carries M9 Pistol, which the server never put in the world (1 so far)']);
  assert.ok(!fed(await copy(ned)).some(([, id]) => id === 'm9'), 'an invented gun was left in the server’s copy of his pockets');
  checks++;
  console.log('  ok  with the checks enforcing, nobody was flagged by any of it; and a gun the server never made, in the same pockets, is');

  // ---- no longer an admin, they have neither; and nothing is kept for if they are made one again
  assert.match(await tell(ann, `/demote #${ivy.id}`), /Ivy is no longer either/);
  await sleep(200);
  assert.deepEqual(powers(ivy), { t: 0, god: false, hidden: false, clip: false, voidInv: false, voidTag: false, weightless: false, endless: false, bottomless: false }, 'somebody who is no longer an admin still has a power');
  assert.match(await tell(ann, `/admin #${ivy.id}`), /Ivy is an admin/);
  await sleep(200);
  assert.deepEqual(powers(ivy), { t: 0, god: false, hidden: false, clip: false, voidInv: true, voidTag: true, weightless: false, endless: false, bottomless: false }, 'the powers somebody had as an admin were theirs again when they were made one again');
  checks++;
  console.log('  ok  whoever is no longer an admin has neither power, and has neither when made an admin again');
}, { CHECKS: 'enforce' });

// ---- an admin's loot goes into inventories, and an admin's inventory that never fills (2026-10-13: "admins need an
// infinite inventory option and a spawnin inventory option for loot. in fact the default mode for spawning loot for
// somone should be in their inventory unless on space"). On a server that enforces its checks and keeps what is
// carried between restarts, as the live one does: and it is stopped dead and started again half-way, with forty
// rifles in an admin's hold. Each player's game is played here by the rules the game itself goes by
// (PlayerInventory): what `kitUp` in src/game/game.ts does with things given, and `emptyHold` with a hold put off.
// (The hold by itself, with no server: test/inventory.test.ts.)
{
  const ned = new Player('Ned'), moe = new Player('Moe');
  const KEEPS = { CHECKS: 'enforce', KEEP: 'on', KEEP_EVERY_MIN: '0.04', KEEP_WAIT_S: '3' };
  const AK = ITEMS.ak.name, vitals = { health: 100, energy: 80, water: 80, stamina: 300, bleeding: false };
  const last = <T extends S2C['t']>(p: Player, t: T) => p.got.filter((m) => m.t === t).pop() as Extract<S2C, { t: T }> | undefined;
  const until = async (good: () => boolean | Promise<boolean>, what: string, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await good()) return;
    assert.fail(`waited ${ms / 1000} s for it, and it never was so: ${what}`);
  };
  /** an order from somebody with a role: what is said back, as soon as it is */
  const tell = async (p: Player, text: string, wait: S2C['t'] = 'sys') => {
    const from = p.got.length;
    p.send({ t: 'chat', ch: 'global', text });
    for (let k = 0; k < 80 && !p.got.slice(from).some((m) => m.t === wait); k++) await sleep(25);
    await sleep(80);
    return p.got.slice(from).filter((m) => m.t === 'sys').map((m) => (m as { text: string }).text).join('\n');
  };
  /** (what somebody with no role types is not heard twice inside half a second: a line that got no answer is typed again) */
  const typed = async (p: Player, text: string) => {
    for (let k = 0; k < 3; k++) {
      const back = await p.order(text);
      if (back) return back;
      await sleep(700);
    }
    return '';
  };
  const lists = async () => {
    ann.send({ t: 'adm' });
    await sleep(700);
    return last(ann, 'adm')!;
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const row = (p: Player) => last(p, 'ps')!.s.find((r) => r[0] === p.id)!;
  const placed = (...who: Player[]) => until(() => who.every((p) => !!last(p, 'ps')?.s.some((r) => r[0] === p.id)), `${who.map((p) => p.name).join(' and ')} told where they are`);
  const stand = (p: Player) => p.send({ t: 's', p: [row(p)[1], row(p)[2], row(p)[3], 0, 0, row(p)[6]], w: null, m: [] });
  const say = (p: Player, inv: PlayerInventory) => p.send({ t: 'me', inv: inv.serialize(), vitals });
  const within = (things: ItemInstance[]): ItemInstance[] => things.flatMap((it) => [it, ...within((it.cargo ?? []).map((q) => q.item))]);
  /** the server's own copy of what somebody carries (`/pockets`) */
  const copy = async (of: Player) => {
    await tell(ann, `/pockets #${of.id}`, 'inv');
    return last(ann, 'inv')!.inv;
  };
  /** the rifles in what is carried, wherever they are, by their numbers */
  const rifles = (inv: SerializedInventory | null) => within(carriedOf(inv)).filter((it) => it.id === 'ak').map((it) => it.uid).sort();
  const hasHold = (inv: SerializedInventory | null) => !!inv?.containers.some((g) => g.id === 'hold');
  /** what has been put on the ground beside somebody since a moment, as one player's game was told of it */
  const lain = (seenBy: Player, from: number, by: Player) => seenBy.got.slice(from).filter((m): m is Extract<S2C, { t: 'loot+' }> => m.t === 'loot+').map((m) => m.l).filter((l) => Math.hypot(l.x - row(by)[1], l.z - row(by)[3]) < 3);
  /** the things an admin gave, as they reached a game since a moment */
  const given = (p: Player, from: number) => p.got.slice(from).find((m): m is Extract<S2C, { t: 'kit' }> => m.t === 'kit')!;
  /**
   * What a game does with things an admin has given it: each is put on or away as a thing picked up is, and what
   * finds no room is put down at the feet, which is said to the server thing by thing; then what is carried is said.
   * @returns what found no room
   */
  const take = (p: Player, inv: PlayerInventory, kit: Extract<S2C, { t: 'kit' }>) => {
    const over = kit.items.filter((it) => inv.add(it));
    for (const it of over) p.send({ t: 'drop', l: { item: it, x: row(p)[1], y: row(p)[2], z: row(p)[3], rot: 0 } });
    say(p, inv);
    return over;
  };
  let forty: string[] = [];

  await withServer(async (log) => {
    // (a server that keeps what is carried lets nobody in until it has read what was kept: here, nothing)
    await until(() => log().includes('[keep] '), 'the server has looked for what was kept', 20_000);
    for (const p of [ann, ned, moe]) assert.ok(await p.join(), `${p.name} was not let in`);
    // (run by itself, this part makes its own admin; after the parts before it, she is one already, and is told so a moment after she is in)
    await sleep(400);
    if (ann.role !== 'admin') {
      ann.send({ t: 'admin', pw: PASSWORD });
      await until(() => ann.role === 'admin', 'the password makes her an admin');
    }
    await until(() => !!last(ann, 'powers'), 'she is told her powers');
    assert.match(await tell(ann, `/mod #${moe.id}`), /Moe is a mod/);
    await placed(ann, ned, moe);
    for (const p of [ann, ned, moe]) stand(p);
    assert.equal((await lists()).checks, 'enforce', 'this server is not enforcing its checks');

    // ---- the power is an admin's and nobody else's: a player and a mod are refused it, and nobody gives it to them
    assert.equal(await typed(ned, '/bottomless on'), 'That is not a thing you can do here.');
    for (const o of ['/bottomless', '/bottomless on', `/bottomless on #${ann.id}`]) assert.equal(await tell(moe, o), 'Only an admin can do that.', `a mod gave ${o}`);
    assert.equal(await tell(ann, `/bottomless on #${ned.id}`), 'Ned is not an admin: these are an admin\'s.');
    assert.equal(await tell(ann, `/bottomless #${moe.id}`), 'Moe is not an admin: these are an admin\'s.');
    assert.ok(![moe, ned].some((p) => p.got.some((m) => m.t === 'powers')), 'somebody who is no admin was told of powers');
    assert.equal(last(ann, 'powers')?.bottomless, false, 'an order that was refused put the power on, or it was on before it was asked for');
    const help = await tell(ann, '/help');
    assert.ok(help.includes('/bottomless [on|off] [who]') && help.includes('/give item [count] [who] [ground]'), '/help does not list the new order, or how a thing is put on the ground');
    checks++;
    console.log('  ok  a player and a mod are refused the inventory that never fills, and an admin cannot put it on for either; /help lists it');

    // ---- a thing given goes INTO the inventory of whoever it is for; what finds no room there is put at their feet by their own game
    const his = new PlayerInventory();
    say(ned, his);
    let from = ann.got.length;
    assert.equal(await tell(ann, `/give ak 3 #${ned.id}`), `3 × ${AK}: in Ned's inventory; what finds no room there is at their feet.`);
    await until(() => !!last(ned, 'kit'), 'Ned is handed the three rifles');
    const gift = last(ned, 'kit')!;
    assert.ok(gift.adds && gift.by === 'Ann' && gift.gift === `3 × ${AK}` && gift.name === gift.gift && gift.items.length === 3 && gift.items.every((it) => it.id === 'ak') && new Set(gift.items.map((it) => it.uid)).size === 3, 'what was given did not reach his game as three rifles to add to what he carries, from her');
    assert.equal(lain(ann, from, ned).filter((l) => l.item.id === 'ak').length, 0, 'what was given into an inventory was put on the ground as well');
    const over = take(ned, his, gift);
    // (two places on his back, and a rifle goes into no pocket: the third finds no room)
    assert.deepEqual([his.slots.primary?.uid, his.slots.secondary?.uid, over.map((it) => it.uid)], [gift.items[0].uid, gift.items[1].uid, [gift.items[2].uid]]);
    await until(() => lain(ann, from, ned).some((l) => l.uid === over[0].uid), 'the rifle that found no room lies at his feet, for everybody');
    await until(async () => same(rifles(await copy(ned)), [gift.items[0].uid, gift.items[1].uid].sort()), 'the server has the two rifles that found room, and not the third');
    checks++;
    console.log('  ok  three rifles given to a player go to his game to be put away: two find room on his back, and the third, which finds none, lies at his feet for everybody');

    // ---- `ground` (or `feet`, or `floor`), anywhere after the thing, puts it at their feet as it always was; and so it is for the dead
    from = ann.got.length;
    const kits = ned.got.filter((m) => m.t === 'kit').length;
    assert.equal(await tell(ann, `/give ak 2 #${ned.id} ground`), `2 × ${AK} at Ned's feet.`);
    await until(() => lain(ann, from, ned).filter((l) => l.item.id === 'ak').length === 2, 'two rifles lie at his feet');
    assert.equal(await tell(ann, '/give bandage feet 3'), '3 × Bandage at your feet.');
    assert.equal(await tell(ann, `/give bandage 2 floor #${ned.id}`), '2 × Bandage at Ned\'s feet.');
    await until(() => lain(ann, from, ann).some((l) => l.item.id === 'bandage' && l.item.qty === 3) && lain(ann, from, ned).some((l) => l.item.id === 'bandage' && l.item.qty === 2), 'the dressings lie at her feet and at his');
    assert.equal(ned.got.filter((m) => m.t === 'kit').length, kits, 'what was given to the ground was handed to his game as well');
    assert.equal(ann.got.slice(from).filter((m) => m.t === 'kit').length, 0, 'what she gave to the ground at her own feet was handed to her game as well');
    assert.match(await tell(ann, `/slay #${moe.id}`), /Moe is dead/);
    from = ann.got.length;
    assert.equal(await tell(ann, `/give ak #${moe.id}`), `${AK} at Moe's feet (Moe is dead: nothing goes into an inventory).`);
    await until(() => lain(ann, from, moe).some((l) => l.item.id === 'ak'), 'what is given to the dead lies at their feet');
    assert.ok(!moe.got.some((m) => m.t === 'kit'), 'a thing was handed to the game of somebody dead');
    checks++;
    console.log('  ok  with the word ground, feet or floor a thing given lies at their feet and is handed to nobody’s game; what is given to the dead lies at their feet');

    // ---- nobody without the power has the room: a game that is no admin's says it keeps its rifles in a hold, and nothing in it is kept
    const told = his.serialize();
    const lie = { ...told, slots: { ...told.slots, primary: null, secondary: null }, containers: [...told.containers, { id: 'hold', items: [{ ...his.slots.primary!, x: 0, y: 0, rot: false }, { ...his.slots.secondary!, x: 0, y: 3, rot: false }] }] };
    ned.send({ t: 'me', inv: lie, vitals });
    await until(async () => {
      const c = await copy(ned);
      return !!c && rifles(c).length === 0 && !hasHold(c);
    }, 'a hold made up by a game that is no admin’s has nothing kept in it, and is no grid');
    say(ned, his);
    await until(async () => rifles(await copy(ned)).length === 2, 'what he does carry is kept again');
    assert.ok(!ned.got.some((m) => m.t === 'powers'), 'somebody who made a hold up was told of powers');
    checks++;
    console.log('  ok  a game that is no admin’s and says it keeps things in a hold has none of them kept there');

    // ---- the power on: forty rifles given all find room, and the server has every one
    assert.equal(await tell(ann, '/bottomless on'), CARRY_POWERS.bottomless.on);
    assert.equal(last(ann, 'powers')?.bottomless, true);
    assert.ok((await lists()).players.every((p) => !!p.bottomless === (p.name === 'Ann')), 'the lists do not say who has it on, or say somebody else has');
    const hers = new PlayerInventory();
    hers.bottomless = true;
    from = ned.got.length;
    for (let k = 0; k < 4; k++) {
      const at = ann.got.length;
      assert.equal(await tell(ann, '/give ak 10'), `10 × ${AK}: in your inventory; what finds no room there is at your feet.`);
      const kit = given(ann, at);
      assert.ok(kit && kit.adds && kit.by === undefined && kit.gift === `10 × ${AK}` && kit.items.length === 10, 'ten rifles did not reach her game');
      assert.equal(take(ann, hers, kit).length, 0, 'a rifle found no room in an inventory that never fills');
    }
    forty = [...hers.carried()].filter((it) => it.id === 'ak').map((it) => it.uid).sort();
    assert.equal(new Set(forty).size, 40);
    assert.equal(hers.theHold.items.length, 38, 'the two places on her back were not filled before the hold');
    assert.deepEqual(rifles(await copy(ann)), forty, 'the server does not have all forty');
    assert.equal(heldIn(await copy(ann)).length, 38, 'the server did not read her hold whole');
    assert.equal(lain(ned, from, ann).filter((l) => l.item.id === 'ak').length, 0, 'one of the forty lies on the ground');
    checks++;
    console.log('  ok  with the power on, forty rifles given to an admin all find room: two on her back and thirty-eight in the hold, and the server has every one');

    // ---- she leaves and comes back: all forty, nothing at her feet, and the power still hers (the welcome first, the powers after it)
    const comeBack = async (why: string) => {
      ann.ws.close();
      await sleep(500);
      assert.ok(await ann.join(), 'the admin could not come back in');
      await until(() => !!last(ann, 'powers'), 'she is told her powers');
      await placed(ann);
      assert.ok(ann.got.findIndex((m) => m.t === 'welcome') < ann.got.findIndex((m) => m.t === 'powers'), 'the powers came before what she carries');
      assert.equal(last(ann, 'powers')?.bottomless, true, why);
      const back = new PlayerInventory();
      // (her game lays what the welcome says she carries, before it has heard of any power: the hold is laid shut, and nothing of it is put down)
      assert.deepEqual(back.load(last(ann, 'welcome')!.me!.inv), [], 'something of hers was at her feet when she came back');
      assert.ok(!back.bottomless && back.theHold.items.length === 38, 'her hold did not come back whole, or was open before the server said so');
      back.bottomless = !!last(ann, 'powers')!.bottomless;
      assert.deepEqual([...back.carried()].filter((it) => it.id === 'ak').map((it) => it.uid).sort(), forty, 'she did not come back with the forty she had');
      stand(ann);
      return back;
    };
    let back = await comeBack('an admin who went and came back in has lost the inventory that never fills');
    checks++;
    console.log('  ok  she goes and comes back in: all forty are hers still, none at her feet, and the power is still on');

    // ---- with the power off, a hold only ever gets emptier; and an admin who comes in with things in one has the room they lie in
    assert.equal(await tell(ann, '/bottomless off'), CARRY_POWERS.bottomless.off);
    assert.equal(last(ann, 'powers')?.bottomless, false);
    // (her game has put nothing down yet, and says one more thing lies in the hold than did: that one is not kept)
    const stray = makeItem('beans');
    back.theHold.items.push({ item: stray, x: 0, y: back.theHold.used(), rot: false });
    say(ann, back);
    const shut = await copy(ann);
    assert.ok(heldIn(shut).length === 38 && !within(carriedOf(shut)).some((it) => it.uid === stray.uid), 'a thing was put into a hold with the power off, and kept');
    assert.deepEqual(rifles(shut), forty, 'putting the power off lost a rifle from the server’s copy before her game had put any down');
    // (and she goes before her game has emptied it: what a restart of the server does to her, which forgets which powers were on)
    back = await comeBack('an admin who came in with things in her hold was not given the room they lie in');
    checks++;
    console.log('  ok  with the power off nothing more is kept in a hold; and whoever is an admin and comes in with things in one has the power on, and nothing at her feet');

    // (what everybody carries is written to the site, twice over, before the server is stopped dead)
    const written = () => (log().match(/\[keep\] [^\n]*written to the site/g) ?? []).length, was = written();
    await until(() => written() >= was + 2, 'what is carried is written to the site as time goes by', 30_000);
  }, KEEPS);

  // ---- the server is stopped dead and started again: it has never heard of her power, and she has her forty
  await withServer(async (log) => {
    await until(() => /\[keep\] \d+ characters and \d+ stashes as they were kept/.test(log()), 'the server that was started again has read what was kept', 20_000);
    for (const p of [ann, ned]) assert.ok(await p.join(), `${p.name} was not let in after the restart`);
    await until(() => !!last(ann, 'powers'), 'she is told her powers');
    await placed(ann, ned);
    assert.equal(ann.role, 'admin', 'after a restart she is no admin');
    assert.equal(last(ann, 'powers')?.bottomless, true, 'after a restart an admin with things in her hold was not given the room they lie in');
    const w = last(ann, 'welcome')!;
    assert.equal(heldIn(w.me?.inv).length, 38, 'her hold was not kept whole over the restart');
    const hers = new PlayerInventory();
    assert.deepEqual(hers.load(w.me!.inv), [], 'after a restart something of hers was at her feet');
    hers.bottomless = true;
    assert.deepEqual([...hers.carried()].filter((it) => it.id === 'ak').map((it) => it.uid).sort(), forty, 'she did not come back from the restart with the forty she had');
    for (const p of [ann, ned]) stand(p);
    // one more given goes where the rest are, on a server that enforces its checks and has read them all back
    let at = ann.got.length;
    assert.equal(await tell(ann, '/give ak'), `${AK}: in your inventory; what finds no room there is at your feet.`);
    assert.equal(take(ann, hers, given(ann, at)).length, 0);
    const all = [...hers.carried()].filter((it) => it.id === 'ak').map((it) => it.uid).sort();
    assert.equal(all.length, 41);
    assert.deepEqual(rifles(await copy(ann)), all, 'after the restart the server does not have every rifle she carries');
    checks++;
    console.log('  ok  the server is stopped dead and started again: she has all forty, none at her feet, and the room they lie in; and a forty-first goes in with them');

    // ---- put off: what fits what she wears stays, the rest lies at her feet, and every one is counted
    // (dressings she is given go into a pocket, as ever; she moves them into the hold by hand, to see them come back out of it)
    at = ann.got.length;
    assert.equal(await tell(ann, '/give bandage 5'), '5 × Bandage: in your inventory; what finds no room there is at your feet.');
    const pile = given(ann, at).items[0];
    assert.equal(take(ann, hers, given(ann, at)).length, 0);
    assert.ok(hers.jacket.has(pile), 'with the hold open, a thing that fits a pocket did not go into the pocket');
    hers.remove(pile);
    assert.equal(hers.theHold.add(pile), null);
    say(ann, hers);
    assert.equal(await tell(ann, '/bottomless off'), CARRY_POWERS.bottomless.off);
    assert.equal(last(ann, 'powers')?.bottomless, false);
    const from = ned.got.length, down: string[] = [];
    assert.equal(hers.shutHold(), 39, 'what found no room in what she wears is not the thirty-nine rifles that fit nothing she has on');
    assert.ok(hers.jacket.has(pile) && hers.slots.primary && hers.slots.secondary, 'what fits what she wears did not stay');
    // (her game puts the rest down a few at a time, and says what it carries as it goes: `emptyHold`)
    while (hers.theHold.items.length) {
      for (const p of hers.theHold.items.slice(0, 6)) {
        hers.theHold.remove(p.item);
        ann.send({ t: 'drop', l: { item: p.item, x: row(ann)[1], y: row(ann)[2], z: row(ann)[3], rot: 0 } });
        down.push(p.item.uid);
      }
      say(ann, hers);
      await sleep(250);
    }
    await until(() => {
      const seen = new Set(lain(ned, from, ann).map((l) => l.uid));
      return down.every((uid) => seen.has(uid));
    }, 'every rifle that found no room lies at her feet, for everybody');
    const after = await copy(ann);
    assert.ok(after && !hasHold(after), 'a hold that was emptied is still a grid in the server’s copy');
    assert.equal(rifles(after).length, 2);
    assert.deepEqual([...rifles(after), ...down].sort(), all, 'a rifle was lost, or made, in putting the power off');
    assert.ok(within(carriedOf(after)).some((it) => it.uid === pile.uid && it.qty === 5), 'the dressings, which fit a pocket, are not carried');
    checks++;
    console.log('  ok  put off, the dressings that fit a pocket stay and thirty-nine rifles lie at her feet: with the two on her back, forty-one, and not one lost');

    // ---- it is nobody else's: whoever comes in with things in a hold and is no admin is told so, and their game empties it
    assert.match(await tell(ann, `/admin #${ned.id}`), /Ned is an admin/);
    await until(() => !!last(ned, 'powers'), 'Ned is told his powers');
    assert.equal(await tell(ann, `/bottomless on #${ned.id}`), 'Ned: bottomless inventory is on.');
    await until(() => !!last(ned, 'powers')?.bottomless, 'Ned is told of the power put on for him');
    assert.ok(ned.got.some((m) => m.t === 'sys' && m.text === 'Ann has put bottomless inventory on for you.'), 'another admin was not told who put the power on for him');
    const his = new PlayerInventory();
    assert.deepEqual(his.load(last(ned, 'welcome')!.me!.inv), []);
    his.bottomless = true;
    const moved = his.slots.secondary!;
    his.remove(moved);
    assert.equal(his.theHold.add(moved), null);
    say(ned, his);
    await until(async () => heldIn(await copy(ned)).length === 1, 'the server has the rifle in his hold');
    assert.match(await tell(ann, `/demote #${ned.id}`), /Ned is no longer either/);
    await until(() => last(ned, 'powers')?.bottomless === false, 'he is told the power is off, with the rest');
    // (he goes before his game has emptied it, and comes back nobody in particular)
    ned.ws.close();
    await sleep(500);
    assert.ok(await ned.join(), 'he could not come back in');
    await until(() => !!last(ned, 'powers'), 'somebody who came in with things in a hold, and is no admin, is told he has no powers');
    assert.deepEqual({ ...last(ned, 'powers'), t: 0 }, { t: 0, god: false, hidden: false, clip: false, voidInv: false, voidTag: false, weightless: false, endless: false, bottomless: false });
    assert.equal(ned.role, undefined);
    const again = new PlayerInventory();
    assert.deepEqual(again.load(last(ned, 'welcome')!.me!.inv), []);
    assert.equal(again.theHold.items.length, 1);
    // (his game does what that word asks: the rifle goes back to the free place on his back)
    assert.equal(again.shutHold(), 0);
    await placed(ned);
    stand(ned);
    say(ned, again);
    await until(async () => {
      const c = await copy(ned);
      return !!c && rifles(c).length === 2 && !hasHold(c);
    }, 'his two rifles are carried as anybody carries them, and he has no hold');
    checks++;
    console.log('  ok  whoever comes in with things in a hold and is no longer an admin is told he has no powers; his game empties it, and he has no hold');

    // ---- nobody was flagged by any of it, on a server that refuses what it flags
    const now = await lists();
    assert.ok(now.players.every((p) => p.flags === 0), `a check fired: ${JSON.stringify(now.players.map((p) => [p.name, p.flags]))}`);
    assert.ok(!log().includes('[check:'), `a check wrote something down:\n${log().split('\n').filter((l) => l.includes('[check:')).join('\n')}`);
    assert.ok(![ann, ned].some((p) => p.shut || p.kicked), 'somebody was put off the server');

    // ---- she dies with things in the hold: a body has a body's room and no more, and the rest is not thrown about it
    assert.equal(await tell(ann, '/bottomless on'), CARRY_POWERS.bottomless.on);
    hers.bottomless = true;
    at = ann.got.length;
    assert.match(await tell(ann, '/give ak 10'), /in your inventory/);
    assert.equal(take(ann, hers, given(ann, at)).length, 0);
    assert.equal(hers.theHold.items.length, 10);
    assert.equal(heldIn(await copy(ann)).length, 10);
    // (an admin leaves nothing at all until she chooses otherwise: she chooses otherwise)
    assert.match(await tell(ann, '/voidinv off'), /what you carried is on your body/);
    assert.match(await tell(ann, `/bring #${ned.id}`), /Ned is with you/);
    const dead = ned.got.length;
    assert.match(await tell(ann, '/die'), /You are dead/);
    const death = () => ned.got.slice(dead).find((m): m is Extract<S2C, { t: 'death' }> => m.t === 'death' && m.k.id === ann.id);
    await until(() => !!death()?.corpse, 'her body lies where she died');
    const corpse = death()!.corpse!;
    ned.send({ t: 'copen', cid: corpse.uid });
    const searched = () => ned.got.slice(dead).find((m): m is Extract<S2C, { t: 'cdata' }> => m.t === 'cdata' && m.cid === corpse.uid);
    await until(() => !!searched(), 'he searches her body');
    const body = searched()!.items, onBody = new Set(within(body).map((it) => it.uid));
    assert.ok([hers.slots.primary!, hers.slots.secondary!, hers.slots.top!, hers.slots.legs!, pile].every((it) => onBody.has(it.uid)), 'what she wore, and what was in her pockets, is not all on her body');
    const heldOn = hers.theHold.items.filter((p) => onBody.has(p.item.uid)).length;
    assert.ok(heldOn >= 1 && heldOn < 10, `${heldOn} of the ten rifles in her hold are on her body: it is to take what it has room for, and no more`);
    assert.ok(body.reduce((cells, it) => cells + ITEMS[it.id].w * ITEMS[it.id].h, 0) <= BODY_GRID[0] * BODY_GRID[1], 'more lies on her body than a body has room for');
    await sleep(700);
    assert.equal(lain(ned, dead, ann).filter((l) => l.item.id === 'ak').length, 0, 'what her body had no room for was thrown on the ground round it');
    assert.ok(log().includes(`Ann died with 10 things in an admin's hold: ${heldOn} lie on the body, and ${10 - heldOn} found no room there and are gone`), `it was not written down what became of her hold:\n${log().split('\n').filter((l) => l.includes('hold')).join('\n')}`);
    checks++;
    console.log(`  ok  nobody was flagged by any of it; and an admin who dies with ten rifles in her hold leaves a body with a body's load: ${heldOn} of them, and the rest gone`);
  }, KEEPS);
}

site.close();
console.log(`\n${checks} checks passed`);
