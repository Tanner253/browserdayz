// What the chat box offers as an order is typed (src/net/orders.ts). No server, no game: the list and the
// function that reads a half-typed line.
//   npx tsx test/orders.test.ts

import assert from 'node:assert/strict';
import { ENTITIES, GROUND, ORDERS, entityBy, offer, ordersOf } from '../src/net/orders';

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

// ---- what can be stood in the world: every row of the one list is offered after /spawn, by its word or its name;
// the orders that put things in the world and take them out are an admin's alone
const sp = offer('/spawn ', 'admin', here)!;
assert.equal(sp.order?.name, 'spawn');
assert.deepEqual(sp.picks.map((p) => p.fill), ENTITIES.map((e) => `/spawn ${e.id} `));
assert.deepEqual(offer('/spawn po', 'admin', here)!.picks.map((p) => p.label), ['police']);
assert.deepEqual(offer('/spawn zombie', 'admin', here)!.picks.map((p) => p.label), ['infected']);
assert.equal(offer('/spawn jeep 2', 'admin', here)!.picks.length, 0);
assert.equal(entityBy('Zombie')?.id, 'infected');
assert.equal(entityBy('car')?.kind, 'car');
// (the MD-500 is spawned as `heli`, by its other names too, since f6ae9bf)
assert.equal(entityBy('helicopter')?.id, 'heli');
assert.equal(entityBy('aeroplane'), null);
assert.equal(new Set(ENTITIES.flatMap((e) => [e.id, ...(e.also ?? [])])).size, ENTITIES.flatMap((e) => [e.id, ...(e.also ?? [])]).length, 'two things answer to one word');
for (const o of ['spawn', 'delcar', 'wrecks', 'delz']) {
  assert.ok(ORDERS.find((x) => x.name === o)?.admin, `/${o} is not an admin's alone`);
  assert.equal(offer(`/${o} `, 'mod', here), null, `a mod was offered /${o}`);
  assert.ok(!mod.picks.some((p) => p.fill.trim() === `/${o}`), `a mod was offered /${o}`);
}
assert.deepEqual(offer('/delz ', 'admin', here)!.picks.map((p) => p.label), ['30', '60', '120', '250']);
// (an order all of whose words can be left out is given whole by Enter: the nearest car, every wreck, the infected about)
assert.deepEqual(offer('/delca', 'admin', here)!.picks.map((p) => [p.fill, p.whole]), [['/delcar', true]]);
assert.deepEqual(offer('/wre', 'admin', here)!.picks.map((p) => [p.fill, p.whole]), [['/wrecks', true]]);
checks++;

// ---- what an admin carries, and fires (2026-10-13): weightless, endless ammunition, and the refill. An admin's
// alone, offered by their names, and each given whole by Enter (a switch with no word after it is turned over; a
// refill with nobody named is one's own)
for (const o of ['weightless', 'ammo', 'bottomless', 'refill']) {
  assert.ok(ORDERS.find((x) => x.name === o)?.admin, `/${o} is not an admin's alone`);
  assert.equal(offer(`/${o} `, 'mod', here), null, `a mod was offered /${o}`);
  assert.ok(!mod.picks.some((p) => p.fill.trim() === `/${o}`), `a mod was offered /${o}`);
  assert.ok(admin.picks.some((p) => p.fill === `/${o}` && p.whole), `/${o} is not offered to an admin, or is not given whole by Enter`);
}
assert.deepEqual(offer('/wei', 'admin', here)!.picks.map((p) => [p.fill, p.whole]), [['/weightless', true]]);
assert.deepEqual(offer('/am', 'admin', here)!.picks.map((p) => [p.fill, p.whole]), [['/ammo', true]]);
assert.deepEqual(offer('/ref', 'admin', here)!.picks.map((p) => [p.fill, p.whole]), [['/refill', true]]);
assert.deepEqual(offer('/refill ', 'admin', here)!.picks.map((p) => p.fill), ['/refill #4 ', '/refill #12 ', '/refill #31 ']);
checks++;

// ---- a switch: its two words are offered first, then whose it is; and the other way about, a name or a number
// begun where the word would be is taken for who, and then the words are offered. With both said, nothing more.
const sw = offer('/ammo ', 'admin', here)!;
assert.equal(sw.order?.name, 'ammo');
assert.equal(sw.at, 0);
assert.deepEqual(sw.picks.map((p) => [p.fill, p.note]), [['/ammo on ', 'put it on'], ['/ammo off ', 'put it off']]);
assert.deepEqual(offer('/ammo o', 'admin', here)!.picks.map((p) => p.label), ['on', 'off']);
assert.deepEqual(offer('/weightless of', 'admin', here)!.picks.map((p) => p.fill), ['/weightless off ']);
assert.equal(offer('/ammo on', 'admin', here)!.picks.length, 0);
assert.deepEqual(offer('/ammo on ', 'admin', here)!.picks.map((p) => p.fill), ['/ammo on #4 ', '/ammo on #12 ', '/ammo on #31 ']);
assert.deepEqual(offer('/ammo on bo', 'admin', here)!.picks.map((p) => p.fill), ['/ammo on #4 ']);
assert.deepEqual(offer('/weightless bo', 'admin', here)!.picks.map((p) => p.fill), ['/weightless #4 ']);
assert.deepEqual(offer('/weightless #1', 'admin', here)!.picks.map((p) => p.fill), ['/weightless #12 ']);
assert.deepEqual(offer('/weightless #4 ', 'admin', here)!.picks.map((p) => p.fill), ['/weightless #4 on ', '/weightless #4 off ']);
assert.deepEqual(offer('/weightless #4 of', 'admin', here)!.picks.map((p) => p.fill), ['/weightless #4 off ']);
assert.equal(offer('/weightless #4 off ', 'admin', here)!.picks.length, 0);
assert.equal(offer('/weightless off #4 ', 'admin', here)!.picks.length, 0);
// (the powers that were there before are offered as they were: whose, and nothing else)
assert.deepEqual(offer('/god ', 'admin', here)!.picks.map((p) => p.fill), ['/god #4 ', '/god #12 ', '/god #31 ']);
// (and the inventory that never fills is a switch like the other two)
assert.deepEqual(offer('/bot', 'admin', here)!.picks.map((p) => [p.fill, p.whole]), [['/bottomless', true]]);
assert.deepEqual(offer('/bottomless ', 'admin', here)!.picks.map((p) => p.fill), ['/bottomless on ', '/bottomless off ']);
assert.deepEqual(offer('/bottomless off ', 'admin', here)!.picks.map((p) => p.fill), ['/bottomless off #4 ', '/bottomless off #12 ', '/bottomless off #31 ']);
checks++;

// ---- a thing given (2026-10-13): into the inventory unless the word `ground` says otherwise. After the thing,
// how many, who for and that word are each offered until they have been said, in whichever order they are typed.
const things = [{ id: 'ak', name: 'AK' }, { id: 'bandage', name: 'Bandage' }, { id: 'mag_ak', name: 'AK Magazine' }];
const give = ORDERS.find((o) => o.name === 'give')!;
assert.deepEqual(give.args, ['item', '[count]', '[who]', '[ground]']);
assert.match(give.does, /into your inventory/i);
assert.match(give.does, /ground/);
assert.deepEqual(offer('/give a', 'admin', here, [], things)!.picks.map((p) => p.fill), ['/give ak ', '/give bandage ', '/give mag_ak ']);
const after = offer('/give ak ', 'admin', here, [], things)!;
assert.deepEqual(after.picks.map((p) => p.fill), ['/give ak #4 ', '/give ak #12 ', '/give ak #31 ', '/give ak ground ']);
assert.match(after.picks[3].note, /at their feet/);
// (a number being typed is how many, and nothing is offered over it; after it, who and the word)
assert.equal(offer('/give ak 2', 'admin', here, [], things)!.picks.length, 0);
assert.deepEqual(offer('/give ak 2 ', 'admin', here, [], things)!.picks.map((p) => p.fill), ['/give ak 2 #4 ', '/give ak 2 #12 ', '/give ak 2 #31 ', '/give ak 2 ground ']);
assert.deepEqual(offer('/give ak 2 bo', 'admin', here, [], things)!.picks.map((p) => p.fill), ['/give ak 2 #4 ']);
assert.deepEqual(offer('/give ak 2 #4 ', 'admin', here, [], things)!.picks.map((p) => p.fill), ['/give ak 2 #4 ground ']);
assert.deepEqual(offer('/give ak #4 gr', 'admin', here, [], things)!.picks.map((p) => p.fill), ['/give ak #4 ground ']);
// (the word first, then who; with both said, nothing more; and the word half typed is not also somebody's name)
assert.deepEqual(offer('/give ak ground ', 'admin', here, [], things)!.picks.map((p) => p.fill), ['/give ak ground #4 ', '/give ak ground #12 ', '/give ak ground #31 ']);
assert.equal(offer('/give ak 2 #4 ground ', 'admin', here, [], things)!.picks.length, 0);
assert.equal(offer('/give ak ground', 'admin', here, [], things)!.picks.length, 0);
assert.deepEqual(GROUND, ['ground', 'feet', 'floor']);
assert.equal(offer('/give ', 'mod', here, [], things), null, 'a mod was offered /give');
checks++;

console.log(`${checks} checks passed`);
