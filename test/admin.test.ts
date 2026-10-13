// Admins, and who they have banned (server/index.ts `command`, api/admin.ts). The real game server is started on
// a port of its own, twice, with a stand-in for the site on this machine: the real api/admin code over a store
// that is a variable. Nothing here touches the real site or its store. About half a minute.
//   npx tsx test/admin.test.ts

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { admin, type AdminState } from '../api/admin';
import type { Store } from '../api/_lib/store';
import { PROTOCOL, type S2C } from '../src/net/protocol';

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
  const out = url.pathname === '/api/admin' ? await admin(new Request(url, { method: 'POST' }), store, `http://127.0.0.1:${PORT}`, { ADMIN_PASSWORD: PASSWORD }) : new Response('not here', { status: 404 });
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
const ann = new Player('Ann'), bob = new Player('Bob'), cat = new Player('Cat'), dan = new Player('Dan');

await withServer(async (log) => {
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
await withServer(async () => {
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
await withServer(async () => {
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

  assert.match(await ann.order('/give bandage 3'), /3 × .* at your feet/);
  const made = last(eve, 'loot+');
  assert.ok(made && made.l.item.id === 'bandage' && made.l.item.qty === 3, 'what was given did not appear in the world');
  assert.match(await ann.order(`/give ak #${eve.id}`), /at Eve's feet/);
  assert.match(await ann.order('/give dogtag'), /Not a dog tag/);
  assert.match(await ann.order('/give zzzz'), /No thing is/);
  assert.match(await ann.order(`/kit assault #${eve.id}`), /Eve has the Assault kit/);
  const kit = last(eve, 'kit');
  assert.ok(kit && kit.by === 'Ann' && kit.items.some((it) => it.id === 'ar15' && it.mag === 'mag_ar_60' && it.loaded === 61 && it.mods?.includes('suppressor_556')), 'a kit did not reach who it was for with its rifle fitted out');
  assert.ok(new Set(kit.items.map((it) => it.uid)).size === kit.items.length && !kit.items.some((it) => it.id === 'dogtag'), 'a kit has a thing twice over, or a dog tag');
  assert.match(await ann.order('/kit nothing'), /The kits are: assault/);
  checks++;
  console.log('  ok  a thing given lies in the world for everybody; a dog tag is never made');

  assert.match(await ann.order('/god'), /Nothing hurts you/);
  // (the two choices for an admin's own death are made for them, until they make them otherwise)
  assert.deepEqual({ ...last(ann, 'powers'), t: 0 }, { t: 0, god: true, hidden: false, clip: false, voidInv: true, voidTag: true });
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
});

site.close();
console.log(`\n${checks} checks passed`);
