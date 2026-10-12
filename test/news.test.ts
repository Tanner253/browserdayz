// The changelog's hearts and comments: the rules alone (src/sim/news.ts). Who may say what, how often, what is
// refused, what the page is told, and that it all comes back from what was kept.
//
//   npx tsx test/news.test.ts
import assert from 'node:assert/strict';
import { NEWS, News } from '../src/sim/news';

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);
const fresh = () => {
  const n = new News();
  n.known = new Set(['first-playable', 'the-gas']);
  return n;
};
const T0 = 1_760_000_000_000;

ok('a heart is given once by a browser, and taken back by the same', () => {
  const n = fresh();
  assert.deepEqual(n.heart('the-gas', A, '1.1.1.1', T0), { ok: true, hearts: 1, mine: true });
  assert.deepEqual(n.heart('the-gas', B, '1.1.1.2', T0), { ok: true, hearts: 2, mine: true });
  assert.deepEqual(n.heart('the-gas', A, '1.1.1.1', T0 + 1), { ok: true, hearts: 1, mine: false });
  assert.deepEqual(n.view(B)['the-gas'], { hearts: 1, mine: true, comments: [] });
  assert.equal(n.view(A)['the-gas'].mine, false);
});

ok('only an entry the page has, and only a browser that says who it is', () => {
  const n = fresh();
  assert.equal(n.heart('no-such-entry', A, '1.1.1.1', T0).ok, false);
  assert.equal(n.heart('The Gas', A, '1.1.1.1', T0).ok, false);
  assert.equal(n.heart('the-gas', 'nobody', '1.1.1.1', T0).ok, false);
  assert.equal(n.heart('the-gas', undefined, '1.1.1.1', T0).ok, false);
  assert.equal(n.say('__proto__', A, '1.1.1.1', 'x', 'hello there', T0).ok, false);
  assert.deepEqual(n.view(), {});
});

ok('a comment is taken as plain words, with a name, and shown oldest first', () => {
  const n = fresh();
  const r = n.say('the-gas', A, '1.1.1.1', '  Sable‮  ', '  the mask   is too rare\n\n<b>please</b>  ', T0);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && [r.comment.name, r.comment.text, r.comment.mine], ['Sable', 'the mask is too rare <b>please</b>', true]);
  assert.ok(n.say('the-gas', B, '1.1.1.2', '', 'more places like it', T0 + 5).ok);
  const seen = n.view(B)['the-gas'].comments;
  assert.deepEqual(seen.map((c) => [c.name, c.mine ?? false]), [['Sable', false], ['Survivor', true]]);
  // (who wrote it is not told to the page)
  assert.ok(!('by' in seen[0]));
});

ok('no links, none of the worst words, nothing empty, nothing too long', () => {
  const n = fresh();
  for (const bad of ['buy at http://x.example', 'join discord.gg/abc', 'see www.thing.io now', 'cheap gold at shop.xyz', 't.me/pump']) assert.equal(n.say('the-gas', A, '1.1.1.1', 'x', bad, T0).ok, false, bad);
  assert.equal(n.say('the-gas', A, '1.1.1.1', 'x', ' ', T0).ok, false);
  assert.equal(n.say('the-gas', A, '1.1.1.1', 'x', 'y'.repeat(NEWS.maxText + 1), T0).ok, false);
  assert.equal(n.say('the-gas', A, '1.1.1.1', 'x', 'kys', T0).ok, false);
  assert.equal(n.say('the-gas', A, '1.1.1.1', 'visit my.site', 'a fine update', T0).ok, false);
  // (a full stop in a sentence is not an address)
  assert.ok(n.say('the-gas', A, '1.1.1.1', 'x', 'Good update. More please. The M9 feels right now', T0).ok);
});

ok('not one after another, not all day, and not round it by another browser at the same address', () => {
  const n = fresh();
  assert.ok(n.say('the-gas', A, '1.1.1.1', 'x', 'one', T0).ok);
  assert.equal(n.say('the-gas', A, '1.1.1.1', 'x', 'two', T0 + 1000).ok, false);
  assert.equal(n.say('the-gas', B, '1.1.1.1', 'x', 'two, from the next tab', T0 + 1000).ok, false);
  assert.ok(n.say('the-gas', C, '9.9.9.9', 'x', 'somebody else is not held up', T0 + 1000).ok);
  let taken = 1;
  for (let k = 1; k < 40; k++) if (n.say('first-playable', A, '1.1.1.1', 'x', `number ${k}`, T0 + k * (NEWS.everyMs + 1)).ok) taken++;
  assert.equal(taken, NEWS.perDay);
  // (and the next day they may again)
  assert.ok(n.say('first-playable', A, '1.1.1.1', 'x', 'the day after', T0 + 86_400_000 + 40 * NEWS.everyMs).ok);
});

ok('hearts are not rained from one address', () => {
  const n = fresh();
  let taken = 0;
  for (let k = 0; k < NEWS.heartsPerHour + 30; k++) if (n.heart('the-gas', A, '1.1.1.1', T0 + k).ok) taken++;
  assert.equal(taken, NEWS.heartsPerHour);
  assert.ok(n.heart('the-gas', A, '1.1.1.1', T0 + 3_600_001 + NEWS.heartsPerHour).ok);
});

ok('a comment is taken down by whoever wrote it, or by an admin, and by nobody else', () => {
  const n = fresh();
  const r = n.say('the-gas', A, '1.1.1.1', 'x', 'mine to take back', T0);
  assert.ok(r.ok);
  const id = r.ok ? r.comment.id : -1;
  assert.equal(n.remove(id, B), false);
  assert.equal(n.remove(id, A), true);
  const again = n.say('the-gas', B, '1.1.1.2', 'x', 'an admin takes this one', T0);
  assert.equal(n.remove(again.ok ? again.comment.id : -1), true);
  assert.deepEqual(n.view()['the-gas'], undefined);
});

ok('all of it comes back from what was kept, and what cannot be made sense of is left out', () => {
  const n = fresh();
  n.heart('the-gas', A, '1.1.1.1', T0);
  n.say('the-gas', A, '1.1.1.1', 'Sable', 'kept through a restart', T0);
  n.say('first-playable', B, '1.1.1.2', 'Rook', 'and this', T0);
  const kept = JSON.parse(JSON.stringify(n.keep()));
  const m = fresh();
  m.restore({ ...kept, comments: [...kept.comments, { id: 'x' }, null, { id: 99, entry: 'BAD ENTRY', name: 'x', text: 'y', at: 1, by: A }] });
  assert.deepEqual(m.view(A), n.view(A));
  // (numbers go on from where they were: a comment taken down is not another's number later)
  const next = m.say('the-gas', C, '3.3.3.3', 'x', 'after the restart', T0 + 1);
  assert.equal(next.ok && next.comment.id, 3);
  m.restore(null);
  m.restore('nonsense');
  assert.equal(Object.keys(m.view()).length, 2);
});

ok('no more is kept under one entry than there may be: the oldest go', () => {
  const n = fresh();
  for (let k = 0; k < NEWS.perEntry + 5; k++) n.say('the-gas', `${k.toString(16).padStart(4, '0')}${'d'.repeat(28)}`, `7.7.${k >> 8}.${k & 255}`, 'x', `comment ${k}`, T0 + k);
  const seen = n.view()['the-gas'].comments;
  assert.equal(seen.length, NEWS.perEntry);
  assert.equal(seen[0].text, 'comment 5');
});

console.log(`${passed} checks passed`);
