// npx tsx scripts/test-load.ts [load] [who]: A LOAD FOR TRYING THE GAME, PUT ON A PLAYER ON THE LOCAL SERVER (8080).
//   midgame (the default)  what a player carries some hours into a life (src/sim/kits.ts TEST_KITS), in place of
//                          what they carry: put it on again to fill the inventory afresh
//   all                    one of every thing (a full pile of what piles), added to what they carry, `bottomless`
//                          on for them so that none of it lands at their feet
// Who: a name; with none, the one other player on. A helper joins for a moment and asks as an admin, which on the
// local server everybody is (.env.local-server's LOCAL_ADMIN). Only ever 127.0.0.1:8080: the live server would not
// take the order from a stranger, and would not know these loads.
import WebSocket from 'ws';
import { PROTOCOL, type S2C } from '../src/net/protocol';
import { ITEMS } from '../src/sim/items';
import { TEST_KITS } from '../src/sim/kits';

const load = (process.argv[2] ?? 'midgame').toLowerCase(), sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
if (load !== 'all' && !TEST_KITS.some((k) => k.id === load)) throw new Error(`the loads are: all, ${TEST_KITS.map((k) => k.id).join(', ')}`);
const health = await fetch('http://127.0.0.1:8080/healthz').then((r) => r.json()).catch(() => null);
if (!health?.ok) throw new Error('no local server on 8080 (launch entry zona-server-local)');

const ws = new WebSocket('ws://127.0.0.1:8080/ws');
const got: S2C[] = [];
ws.on('message', (d) => got.push(JSON.parse(String(d)) as S2C));
await new Promise<void>((done, fail) => { ws.once('open', () => done()); ws.once('error', fail); });
ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: 'test-load-helper-key'.padEnd(40, '0'), name: 'TestLoad' }));
for (let k = 0; k < 200 && !got.some((m) => m.t === 'welcome'); k++) await sleep(50);
const welcome = got.find((m) => m.t === 'welcome') as Extract<S2C, { t: 'welcome' }> | undefined;
if (!welcome) throw new Error(`not let in: ${JSON.stringify(got).slice(0, 300)}`);

const others = welcome.players.filter((p) => p.id !== welcome.you).map((p) => p.name);
const who = process.argv[3] ?? (others.length === 1 ? others[0] : null);
if (!who) throw new Error(`say who: ${others.length ? others.join(', ') : 'nobody else is on'}`);

const say = (text: string) => ws.send(JSON.stringify({ t: 'chat', ch: 'global', text }));
if (load === 'all') {
  say(`/bottomless on ${who}`);
  await sleep(200);
  for (const [id, d] of Object.entries(ITEMS)) {
    if (id === 'dogtag') continue; // (the server never makes one)
    say(`/give ${id} ${d.stack ?? 1} ${who}`);
    await sleep(60);
  }
} else say(`/kit ${load} ${who}`);
await sleep(800);
const told = got.filter((m) => m.t === 'sys').map((m) => JSON.stringify(m)).filter((s) => /No thing|Nobody|kits are|dead/i.test(s));
console.log(told.length ? `the server said:\n${told.slice(0, 10).join('\n')}` : `${load === 'all' ? 'one of everything' : `the ${load} load`} put on ${who}`);
ws.close();
