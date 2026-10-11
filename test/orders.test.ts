// What the chat box offers as an order is typed (src/net/orders.ts). No server, no game: the list and the
// function that reads a half-typed line.
//   npx tsx test/orders.test.ts

import assert from 'node:assert/strict';
import { ORDERS, offer, ordersOf } from '../src/net/orders';

const here = [{ id: 4, name: 'Bob' }, { id: 12, name: 'Big Bad Wolf' }, { id: 31, name: 'cat' }];
let checks = 0;

// ---- with no role nothing is offered, and talk is never an order
assert.equal(offer('/', null, here), null);
assert.equal(offer('hello /kick', 'admin', here), null);
assert.equal(offer('', 'admin', here), null);
checks++;

// ---- a mod is offered a mod's orders and no more; an admin every one of them
const mod = offer('/', 'mod', here)!, admin = offer('/', 'admin', here)!;
assert.deepEqual(mod.picks.map((p) => p.fill.trim()), ordersOf('mod').map((o) => `/${o.name}`));
assert.ok(!mod.picks.some((p) => /^\/(ban|unban|admin|mod|demote|roles|bans)\b/.test(p.fill)), 'a mod was offered an admin order');
assert.equal(admin.picks.length, ORDERS.length);
assert.equal(offer('/ban', 'mod', here), null);
checks++;

// ---- a name half typed narrows it; one with nothing after it is given whole, one with more to it is not
const k = offer('/kic', 'admin', here)!;
assert.deepEqual(k.picks.map((p) => [p.fill, p.whole]), [['/kick ', false]]);
const b = offer('/ban', 'admin', here)!;
assert.deepEqual(b.picks.map((p) => [p.fill, p.whole]), [['/ban ', false], ['/bans', true]]);
checks++;

// ---- who: everybody online, by number; narrowed by a part of the name or by the number
const who = offer('/kick ', 'mod', here)!;
assert.equal(who.order?.name, 'kick');
assert.equal(who.at, 0);
assert.deepEqual(who.picks.map((p) => p.fill), ['/kick #4 ', '/kick #12 ', '/kick #31 ']);
assert.deepEqual(offer('/kick bo', 'mod', here)!.picks.map((p) => p.fill), ['/kick #4 ']);
assert.deepEqual(offer('/kick #1', 'mod', here)!.picks.map((p) => p.fill), ['/kick #12 ']);
assert.deepEqual(offer('/kick BAD', 'mod', here)!.picks.map((p) => p.label), ['#12  Big Bad Wolf']);
checks++;

// ---- the words after: minutes are offered, a reason is not; past the last word nothing is
const t = offer('/timeout #4 ', 'mod', here)!;
assert.equal(t.at, 1);
assert.deepEqual(t.picks.map((p) => p.fill), ['/timeout #4 5 ', '/timeout #4 10 ', '/timeout #4 30 ', '/timeout #4 60 ']);
assert.deepEqual(offer('/timeout #4 3', 'mod', here)!.picks.map((p) => p.label), ['30']);
const why = offer('/timeout #4 30 for being a bob', 'mod', here)!;
assert.equal(why.at, 2);
assert.equal(why.picks.length, 0);
assert.equal(offer('/say bob is here', 'mod', here)!.picks.length, 0);
checks++;

// ---- a ban finds who has left: by a word of the name, newest first, and never somebody who is back
const ban = offer('/ban ', 'admin', here, ['Old Tom', 'Zed', 'Bob', 'x'])!;
assert.deepEqual(ban.picks.map((p) => p.fill), ['/ban #4 ', '/ban #12 ', '/ban #31 ', '/ban Zed ', '/ban Old ']);
assert.deepEqual(offer('/ban to', 'admin', here, ['Old Tom', 'Zed'])!.picks.map((p) => p.label), ['Old Tom']);
assert.ok(!offer('/kick ', 'admin', here, ['Zed'])!.picks.some((p) => p.label === 'Zed'), 'somebody who has left was offered to be kicked');
checks++;

console.log(`${checks} checks passed`);
