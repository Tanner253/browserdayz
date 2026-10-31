// npx tsx test/chat-translate.test.ts: CHAT IN THE READER'S LANGUAGE (src/sim/chat-translate.ts) on this tree's server,
// booted on a port of its own (8440) as test/party.test.ts boots it, with a stand-in for the translator on 8441 (nothing
// leaves this machine; no key is real). Three readers of three languages: each has one line in their own, whoever typed it
// has it as typed, the translator is asked once whoever many read it, a slow translator holds nothing up and its words
// follow, a broken one costs nobody the line, and no key at all is the game as it was. The catalogs' {0}s are checked too.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { ChatTranslator, deliver, settled } from '../src/sim/chat-translate';
import { langOf, type Lang } from '../src/sim/langs';

const PORT = 8440, FAKE = 8441, SITE = 'http://127.0.0.1:9';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => unknown) => {
  for (let i = 0; i < 40 && !f(); i++) await sleep(50);
};
assert.match(readFileSync('.env.local-server', 'utf8'), /^SITE_URL=http:\/\/127\.0\.0\.1:9\s*$/m, '.env.local-server does not hold SITE_URL=http://127.0.0.1:9: not starting');

// ---- what is decided with nobody asked
assert.equal(settled('need ammo at the fort', 'en', 'en'), true, 'English among English is left alone');
assert.equal(settled('hola amigo', 'en', 'en'), false, 'an English page that types Spanish is still translated');
assert.equal(settled('гг', 'ru', 'ru'), true, 'Russian among Russians');
assert.equal(settled('привет', 'en', 'en'), false, 'Cyrillic is no English');
assert.equal(settled('gg', 'ru', 'en'), true, 'gg is gg');
assert.equal(settled('1234 567', 'es', 'en'), true, 'figures need no translator');
assert.equal(settled('hello', 'es', 'en'), false, 'a reader of another language');
assert.equal(langOf('xx'), 'en', 'a language unknown is English');
assert.equal(langOf('tr'), 'tr');

// ---- every catalog keeps every {0} of its English, or the game would show a hole
for (const f of readdirSync('src/i18n/lang')) {
  const d = JSON.parse(readFileSync(path.join('src/i18n/lang', f), 'utf8')) as Record<string, string>;
  const holes = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
  for (const [from, to] of Object.entries(d)) assert.equal(holes(to), holes(from), `${f}: "${from}" -> "${to}"`);
}

// ---- the stand-in: asked for languages, it answers `[es] line`, after `delay`, or not at all
let asked = 0, delay = 0, broken = false;
const fake: Server = createServer((q, a) => {
  let body = '';
  q.on('data', (d) => (body += d));
  q.on('end', async () => {
    asked++;
    await sleep(delay);
    if (broken) { a.statusCode = 500; return void a.end('{}'); }
    const said = (JSON.parse(body) as { messages: { content: string }[] }).messages[0].content;
    const langs = /Languages: (.*)\n/.exec(said)![1].split(', '), line = /<chat>(.*)<\/chat>/s.exec(said)![1];
    a.setHeader('content-type', 'application/json');
    a.end(JSON.stringify({ id: 'x', type: 'message', role: 'assistant', model: 'stand-in', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify({ out: langs.map((l) => `[${l}] ${line}`) }) }] }));
  });
});
await new Promise<void>((r) => fake.listen(FAKE, '127.0.0.1', r));

// ---- deliver alone: slow and broken translators
{
  const tr = new ChatTranslator('test-key', `http://127.0.0.1:${FAKE}`);
  const got: Record<string, unknown[]> = { es: [], late: [] };
  const line = { t: 'chat', text: 'a line for the slow one' };
  const readers: Lang[] = ['es'];
  const io = { from: 'en' as Lang, who: 'x', lang: (c: Lang) => c, send: (_: Lang, m: { text: string }) => void got.es.push(m), late: (_: Lang, mid: number, text: string) => void got.late.push({ mid, text }) };
  delay = 900;
  const began = Date.now();
  deliver(tr, line, readers, io);
  assert.equal(got.es.length, 0, 'a moment is given');
  await sleep(600);
  const m = got.es[0] as { text: string; mid: number };
  assert.ok(m && Date.now() - began < 800, 'a slow translator does not hold the line up');
  assert.equal(m.text, line.text, 'and it goes as typed');
  // (the SDK's first load under tsx is part of this first call)
  for (let i = 0; i < 80 && !got.late.length; i++) await sleep(100);
  assert.deepEqual(got.late, [{ mid: m.mid, text: `[es] ${line.text}` }], 'and the translation follows it');
  delay = 0;
  broken = true;
  const line2 = { t: 'chat', text: 'a line for the broken one' };
  got.es.length = 0;
  deliver(tr, line2, readers, io);
  await sleep(200);
  assert.deepEqual(got.es.map((x) => (x as { text: string }).text), [line2.text], 'a broken translator costs nobody the line');
  broken = false;
  // no key: what was typed, and the translator never asked
  const none = new ChatTranslator('', `http://127.0.0.1:${FAKE}`);
  asked = 0;
  got.es.length = 0;
  const line3 = { t: 'chat', text: 'no key on this server' };
  deliver(none, line3, readers, io);
  assert.deepEqual(got.es.map((x) => (x as { text: string }).text), ['no key on this server'], 'with no key the game works as it did');
  assert.equal(asked, 0);
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'zona-chat-tr-'));
let server: ChildProcess | undefined;
let logged = '';
const boot = async (key: string) => {
  server = spawn(process.execPath, ['--env-file=.env.local-server', path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SITE_URL: SITE, DATA_DIR: dir, BOTCHECK: 'off', LINGER_S: '0', TRANSLATE_API_KEY: key, TRANSLATE_URL: `http://127.0.0.1:${FAKE}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => (logged += d));
  server.stderr!.on('data', (d) => (logged += d));
  // (the world is made before it answers: most of a minute under load)
  for (let i = 0; i < 1500; i++) {
    const ok = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await sleep(100);
  }
  throw new Error(`the server did not start:\n${logged.slice(-2000)}`);
};
class Player {
  ws!: WebSocket;
  got: S2C[] = [];
  constructor(public name: string, public lang: string) {}
  async join() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.got.push(JSON.parse(String(d)) as S2C));
    await new Promise<void>((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: `chat-tr-key-${this.name}-`.padEnd(40, '0'), name: this.name, lang: this.lang }));
    for (let k = 0; k < 300 && !this.got.some((m) => m.t === 'welcome'); k++) await sleep(50);
    assert.ok(this.got.some((m) => m.t === 'welcome'), `${this.name} was not let in`);
  }
  say(text: string) { this.ws.send(JSON.stringify({ t: 'chat', ch: 'global', text })); }
  heard() { return this.got.filter((m): m is Extract<S2C, { t: 'chat' }> => m.t === 'chat').at(-1); }
}

let failed: unknown = null;
try {
  await boot('test-key');
  const en = new Player('Ann', 'en'), es = new Player('Ben', 'es'), es2 = new Player('Bea', 'es'), ru = new Player('Cid', 'ru');
  for (const p of [en, es, es2, ru]) await p.join();
  // (the first call a server makes may take longer than a line waits: it follows its line, as a slow one does)
  en.say('a first word');
  for (let i = 0; i < 4; i++) await until(() => es.got.some((m) => m.t === 'chatx' || (m.t === 'chat' && m.orig)));
  assert.ok(es.got.some((m) => m.t === 'chatx' || (m.t === 'chat' && m.orig)), 'the first line is translated, with it or after it');
  // (a player's lines are half a second apart at the least)
  await sleep(600);
  asked = 0;
  en.say('the fort has fallen');
  await until(() => ru.heard()?.text.includes('fort'));
  assert.equal(en.heard()?.text, 'the fort has fallen', 'whoever typed it has it as typed');
  assert.equal(en.heard()?.orig, undefined);
  assert.equal(es.heard()?.text, '[es] the fort has fallen', 'Spanish reads Spanish');
  assert.equal(es.heard()?.orig, 'the fort has fallen', 'and has the original to show');
  assert.equal(es2.heard()?.text, '[es] the fort has fallen');
  assert.equal(ru.heard()?.text, '[ru] the fort has fallen', 'and Russian Russian');
  assert.equal(asked, 1, 'one call for one line, whoever reads it and in however many languages');
  await sleep(600);
  en.say('the fort has fallen');
  await sleep(200);
  assert.equal(asked, 1, 'a line said again is remembered');
  es.say('xyzzy qwerty');
  await until(() => en.heard()?.text.includes('xyzzy'));
  assert.equal(es.heard()?.text, 'xyzzy qwerty', 'theirs as typed, in any language');
  assert.equal(en.heard()?.text, '[en] xyzzy qwerty', 'and English readers have it in English');
  // the language changed in Settings
  ru.ws.send(JSON.stringify({ t: 'lang', l: 'tr' }));
  await sleep(600);
  en.say('now in turkish');
  await until(() => ru.heard()?.text.includes('turkish'));
  assert.equal(ru.heard()?.text, '[tr] now in turkish', 'chat follows the language chosen');
  for (const p of [en, es, es2, ru]) p.ws.close();
  console.log('chat translation: ok');
} catch (e) {
  failed = e;
}
server?.kill();
fake.close();
await sleep(200);
rmSync(dir, { recursive: true, force: true });
if (failed) {
  console.log(logged.slice(-1500));
  throw failed;
}
process.exit(0);
