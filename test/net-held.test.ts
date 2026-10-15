// What the server says between letting a game in and the game listening is not lost (src/net/client.ts, `held`).
//
//   npx tsx test/net-held.test.ts
//
// 2026-10-13: "when the server restarts or i relog in my admin status is not loading properly and i have to
// reenter my admin password every time". The server says "you are an admin" in the same breath as the welcome; the
// game, putting the welcomed world together, waited on the models of the stashes in it before it said what it does
// with any message; and everything said in that wait fell on nobody. A stand-in for the browser's WebSocket says
// here what a server says, when this test tells it to.

import assert from 'node:assert/strict';

type Listener = ((e: { data: unknown }) => void) | null;
class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 1;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: Listener = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.());
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  /** the server says a thing */
  says(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}
const store = new Map<string, string>();
Object.assign(globalThis, {
  WebSocket: FakeSocket,
  location: { search: '', protocol: 'http:', host: 'localhost:5173', hostname: 'localhost' },
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
});

const { Net } = await import('../src/net/client');

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  n++;
  console.log(`  ok  ${name}`);
};
const tick = () => new Promise((r) => setTimeout(r, 5));

await ok('what is said after the welcome and before the game listens is heard when it does, all of it and in its order', async () => {
  const net = new Net();
  const coming = net.connect('Ada');
  await tick();
  const server = FakeSocket.last;
  assert.ok(server.sent.some((s) => JSON.parse(s).t === 'hello'), 'the game did not say hello');
  server.says({ t: 'welcome', you: 7 });
  // (in the same breath, as the server says them)
  server.says({ t: 'role', role: 'admin' });
  server.says({ t: 'powers', god: false });
  const w = await coming;
  assert.equal(w?.you, 7);
  // the game is putting its world together: it waits on a model, and the server goes on talking
  await tick();
  server.says({ t: 'chat', from: 'Bo', text: 'one' });
  server.says({ t: 'chat', from: 'Bo', text: 'two' });
  const heard: string[] = [];
  net.on('role', (m) => heard.push(`role ${m.role}`));
  net.on('powers', () => heard.push('powers'));
  net.on('chat', (m) => heard.push(`chat ${m.text}`));
  assert.deepEqual(heard, [], 'something was heard before the game said it was listening');
  net.listen();
  assert.deepEqual(heard, ['role admin', 'powers', 'chat one', 'chat two']);
  // and from then on a thing said is heard as it is said
  server.says({ t: 'chat', from: 'Bo', text: 'three' });
  assert.deepEqual(heard.at(-1), 'chat three');
  // (saying it twice hands nothing over twice)
  net.listen();
  assert.equal(heard.length, 5);
});

await ok('before the welcome nothing is kept back: the line, the range and a refusal are heard as they are said', async () => {
  const net = new Net();
  const heard: string[] = [];
  net.on('range', () => heard.push('range'));
  net.on('kick', (m) => heard.push(`kick ${m.reason}`));
  const coming = net.connect('Cy');
  await tick();
  const server = FakeSocket.last;
  server.says({ t: 'range', turn: 0, go: 0, need: 6, secs: 60 });
  assert.deepEqual(heard, ['range']);
  server.says({ t: 'kick', reason: 'no' });
  assert.deepEqual(heard, ['range', 'kick no']);
  server.close();
  assert.equal(await coming, null);
});

console.log(`\n${n} checks passed`);
process.exit(0);
