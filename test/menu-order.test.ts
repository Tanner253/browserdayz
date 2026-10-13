// The order the menu's scenes are shown in, which of them are said to be new, and what a browser remembers of
// having been shown them (src/game/menu-order.ts): what a visitor has not been shown comes first, the newest
// first; "New" is for what came since they were last here, or within the last fortnight; and somebody who has seen
// it all has the ordinary round. And the table of scenes itself (src/game/menu-scenes.ts), read as it is written:
// every one has an id of its own and a day it was added. No game, no browser:
//   npx tsx test/menu-order.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRESH_DAYS, KEPT, menuOrder, recall, remember, visit, type Keeper, type SceneRow } from '../src/game/menu-order';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const DAY = 86_400_000;
const at = (day: string, hour = 12) => Date.parse(`${day}T00:00:00Z`) + hour * 3_600_000;
// a table of six, in the order of an ordinary round: two of one day, and one that is three weeks old by "now"
const TABLE: SceneRow[] = [
  { id: 'fight', added: '2026-10-01' },
  { id: 'ward', added: '2026-10-12' },
  { id: 'gun', added: '2026-10-09' },
  { id: 'bury', added: '2026-10-11' },
  { id: 'morgue', added: '2026-10-12' },
  { id: 'old', added: '2026-09-20' },
];
const NOW = at('2026-10-13');
const ids = (o: { id: string }[]) => o.map((x) => x.id);
const fresh = (o: { id: string; fresh: boolean }[]) => o.filter((x) => x.fresh).map((x) => x.id);
const none = new Set<string>();
/** somewhere to keep things that is not a browser's: what is in it can be looked at */
const box = (held: Record<string, string> = {}): Keeper & { held: Record<string, string> } => ({
  held,
  getItem: (k) => held[k] ?? null,
  setItem: (k, v) => void (held[k] = v),
});

ok('somebody here for the first time is shown the newest first, and told only of what is lately new', () => {
  const o = menuOrder(TABLE, none, null, NOW);
  // (two of one day keep the table's order: the ward before the morgue)
  assert.deepEqual(ids(o), ['ward', 'morgue', 'bury', 'gun', 'fight', 'old']);
  // (the oldest is twenty-three days old: it is shown, and not called new)
  assert.deepEqual(fresh(o), ['ward', 'morgue', 'bury', 'gun', 'fight']);
  // (and a fortnight is the measure: a day short of it is new, the day of it is not)
  const edge: SceneRow[] = [{ id: 'in', added: '2026-10-01' }, { id: 'out', added: '2026-09-29' }];
  assert.deepEqual(fresh(menuOrder(edge, none, null, at('2026-10-14', 23))), ['in']);
  assert.deepEqual(fresh(menuOrder(edge, none, null, at('2026-10-15', 0) + 1)), []);
  assert.equal(FRESH_DAYS, 14);
});

ok('somebody who has seen them all has the ordinary round, and nothing is called new', () => {
  const o = menuOrder(TABLE, new Set(ids(TABLE)), at('2026-10-12'), NOW);
  assert.deepEqual(ids(o), ids(TABLE));
  assert.deepEqual(fresh(o), []);
});

ok('what an update added is the first thing whoever comes back is shown', () => {
  // (they saw the three there were on the 10th; the 11th and the 12th added three more)
  const o = menuOrder(TABLE, new Set(['fight', 'gun', 'old']), at('2026-10-10'), NOW);
  assert.deepEqual(ids(o), ['ward', 'morgue', 'bury', 'fight', 'gun', 'old']);
  assert.deepEqual(fresh(o), ['ward', 'morgue', 'bury']);
});

ok('a scene they left before reaching is shown first too, and called new only if it lately is', () => {
  // (here yesterday, and went in before the old one or the gun came round)
  const o = menuOrder(TABLE, new Set(['fight', 'ward', 'bury', 'morgue']), at('2026-10-12', 20), NOW);
  assert.deepEqual(ids(o), ['gun', 'old', 'fight', 'ward', 'bury', 'morgue']);
  assert.deepEqual(fresh(o), ['gun']);
});

ok('back after two months, everything added in them is new, however long ago it was', () => {
  const now = at('2026-12-20'), last = at('2026-10-05');
  const o = menuOrder(TABLE, new Set(['fight', 'old']), last, now);
  assert.deepEqual(ids(o), ['ward', 'morgue', 'bury', 'gun', 'fight', 'old']);
  assert.deepEqual(fresh(o), ['ward', 'morgue', 'bury', 'gun']);
  // (the same visitor with nothing kept of when they were last here is told of none of it: it is all months old)
  assert.deepEqual(fresh(menuOrder(TABLE, new Set(['fight', 'old']), null, now)), []);
});

ok('what was added on the day of the last visit counts as added since it', () => {
  const rows: SceneRow[] = [{ id: 'a', added: '2026-10-01' }, { id: 'b', added: '2026-10-02' }];
  // (here on the morning of the 2nd, before that day's update; back in December)
  assert.deepEqual(fresh(menuOrder(rows, new Set(['a']), at('2026-10-02', 8), at('2026-12-01'))), ['b']);
  // (here on the 3rd and never shown it: by December it is neither new since then nor lately new)
  assert.deepEqual(fresh(menuOrder(rows, new Set(['a']), at('2026-10-03', 8), at('2026-12-01'))), []);
});

ok('every scene is in a round once, whatever the browser remembers, and nothing given is changed', () => {
  const table = TABLE.map((r) => ({ ...r })), seen = new Set(['gone-from-the-game', 'gun', 'gun2']);
  const o = menuOrder(table, seen, at('2026-10-01'), NOW);
  assert.deepEqual([...ids(o)].sort(), [...ids(TABLE)].sort());
  assert.deepEqual(table, TABLE);
  assert.deepEqual([...seen], ['gone-from-the-game', 'gun', 'gun2']);
  assert.deepEqual(menuOrder([], none, null, NOW), []);
  // (a clock that is behind the day a scene was added: it is new, and nothing breaks)
  assert.deepEqual(fresh(menuOrder([{ id: 'tomorrow', added: '2026-10-14' }], none, null, NOW)), ['tomorrow']);
});

ok('what is shown is written down, with what another window wrote, and the next visit finds it', () => {
  const b = box();
  // (nothing kept yet: nobody has been here)
  assert.deepEqual(recall(b), { seen: new Set(), last: null });
  visit(NOW, b);
  assert.deepEqual([...remember('ward', TABLE, b)], ['ward']);
  // (another window of the game shows the gun meanwhile)
  b.held[KEPT.seen] = JSON.stringify(['ward', 'gun']);
  assert.deepEqual([...remember('bury', TABLE, b)].sort(), ['bury', 'gun', 'ward']);
  const next = recall(b);
  assert.deepEqual([...next.seen].sort(), ['bury', 'gun', 'ward']);
  assert.equal(next.last, NOW);
  // (and the round that visit is given: the three it has not seen first, newest first, then the three it has)
  assert.deepEqual(ids(menuOrder(TABLE, next.seen, next.last, NOW + DAY)), ['morgue', 'fight', 'old', 'ward', 'gun', 'bury']);
});

ok('a scene the table no longer has is forgotten, and what is kept amiss is read as nothing', () => {
  const b = box({ [KEPT.seen]: JSON.stringify(['ward', 'taken-out-of-the-game', 7, null]), [KEPT.visit]: 'yesterday' });
  assert.deepEqual(recall(b), { seen: new Set(['ward', 'taken-out-of-the-game']), last: null });
  assert.deepEqual([...remember('gun', TABLE, b)], ['ward', 'gun']);
  assert.equal(b.held[KEPT.seen], JSON.stringify(['ward', 'gun']));
  for (const bad of ['{not json', '"a word"', '{"seen":["ward"]}', '']) assert.deepEqual(recall(box({ [KEPT.seen]: bad })).seen, new Set(), `kept as ${bad}`);
});

ok('a browser that keeps nothing, or refuses to be asked, breaks nothing: every visit is a first one', () => {
  const refuses: Keeper = {
    getItem: () => {
      throw new Error('storage is off');
    },
    setItem: () => {
      throw new Error('storage is off');
    },
  };
  for (const b of [null, refuses]) {
    assert.deepEqual(recall(b), { seen: new Set(), last: null });
    visit(NOW, b);
    // (what has just been shown is all there is to say)
    assert.deepEqual([...remember('ward', TABLE, b)], ['ward']);
    assert.deepEqual(recall(b), { seen: new Set(), last: null });
  }
  // (and with nothing handed in, where there is no browser at all, which is here)
  assert.deepEqual(recall(), { seen: new Set(), last: null });
  visit(NOW);
  assert.deepEqual([...remember('ward', TABLE)], ['ward']);
});

ok('the table of scenes: an id of its own and a day for each, and a phone has the shorter list', () => {
  // (read as it is written: the file itself brings the whole game with it, and is not to be run here)
  const src = readFileSync(new URL('../src/game/menu-scenes.ts', import.meta.url), 'utf8');
  const table = src.slice(src.indexOf('private static readonly TABLE'));
  const rows = [...table.matchAll(/\{ id: '([^']*)', added: '([^']*)', phone: (true|false), make: /g)].map((m) => ({ id: m[1], added: m[2], phone: m[3] === 'true' }));
  assert.ok(rows.length >= 17, `only ${rows.length} scenes were read out of the table`);
  // (every row is written the one way: one that is not would be missed here, and is refused)
  assert.equal(rows.length, [...table.matchAll(/\bmake: /g)].length, 'a row of the table is not written as the others are');
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'two scenes have one id: a browser could not tell which it had shown');
  for (const r of rows) {
    assert.match(r.id, /^[a-z0-9-]+$/, `the id '${r.id}'`);
    assert.match(r.added, /^\d{4}-\d{2}-\d{2}$/, `${r.id} was added on '${r.added}'`);
    const day = Date.parse(`${r.added}T00:00:00Z`);
    assert.ok(Number.isFinite(day), `${r.id}: '${r.added}' is no day`);
    // (the game was first played on the first of October 2026: nothing in it is older)
    assert.ok(day >= Date.parse('2026-10-01T00:00:00Z'), `${r.id} is older than the game`);
  }
  const phone = rows.filter((r) => r.phone);
  assert.ok(phone.length >= 5 && phone.length < rows.length, `a phone is shown ${phone.length} of ${rows.length}`);
  // (what the real table gives somebody new, a day after its newest scene: newest first, and a whole round of them)
  const newest = rows.map((r) => r.added).sort().pop()!;
  const o = menuOrder(rows, none, null, Date.parse(`${newest}T00:00:00Z`) + DAY);
  assert.equal(o.length, rows.length);
  assert.equal(rows.find((r) => r.id === o[0].id)!.added, newest);
  assert.ok(o[0].fresh);
});

console.log(`\n${n} checks passed`);
