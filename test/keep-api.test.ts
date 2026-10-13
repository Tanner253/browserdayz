// What the site does with what the game server hands it to keep (api/keep.ts), over a store that is a variable.
// The two rules that came of the night of 2026-10-13, when a last word was written and then written over:
//   - a store that cannot be read just now, because it has a newer copy than its cache serves, says so (`stale`)
//     and is not an error: the game server waits for it;
//   - nothing is written over a copy its writer has not seen (`newer`): it is handed back to be taken in first.
//   npx tsx test/keep-api.test.ts

import assert from 'node:assert/strict';
import { pepperOf } from '../api/admin';
import { keep, keepAuth, type Kept } from '../api/keep';
import type { Store } from '../api/_lib/store';

const PASSWORD = `test-only-${Math.random().toString(36).slice(2)}`;
const env = { ADMIN_PASSWORD: PASSWORD };
const files = new Map<string, { text: string; mark: number }>();
let old = false;
const store: Store = {
  async read<T>(p: string) {
    if (old) throw new Error('the file store is serving an old copy');
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
    files.set(p, { text: JSON.stringify(data), mark: (f?.mark ?? 0) + 1 });
    return String((f?.mark ?? 0) + 1);
  },
  async list() {
    return [...files.keys()];
  },
};
const ask = async (op: Record<string, unknown>, sign = true) => {
  const body = JSON.stringify(op), at = String(Date.now());
  const r = await keep(new Request('http://site.test/api/keep', { method: 'POST', headers: { 'x-zona-at': at, 'x-zona-auth': sign ? keepAuth(pepperOf(PASSWORD), at, body) : 'no' }, body }), store, env);
  return { status: r.status, ...((await r.json()) as { ok?: boolean; stale?: boolean; newer?: boolean; save?: Kept | null; why?: string; mark?: string }) };
};
const held = () => JSON.parse(files.get('zona/world.json')!.text) as Kept;
let n = 0;
const ok = (name: string) => (n++, console.log('  ok  ' + name));

// ---- only the game server is heard
assert.equal((await ask({ op: 'load' }, false)).status, 403);
assert.deepEqual(await ask({ op: 'load' }), { status: 200, ok: true, save: null });
ok('only the game server is heard; with nothing kept, nothing is what it is told');

// ---- the first server writes, and writes again; it is read back
assert.equal((await ask({ op: 'save', at: '2026-10-13T00:35:19.901Z', boot: 'aaaa', final: false, z: 'QUJD', seen: '' })).ok, true);
assert.equal((await ask({ op: 'save', at: '2026-10-13T01:44:45.000Z', boot: 'aaaa', final: true, z: 'REVG', seen: '' })).ok, true, 'a server was kept from writing over its own copy');
assert.deepEqual([held().final, held().z], [true, 'REVG']);
ok('a server writes, and writes over what it wrote itself');

// ---- the store has a newer copy than it can serve: said so, and no error
old = true;
const stale = await ask({ op: 'load' });
assert.deepEqual([stale.status, stale.ok, stale.stale], [200, false, true], JSON.stringify(stale));
const stale2 = await ask({ op: 'save', at: '2026-10-13T01:46:27.000Z', boot: 'bbbb', final: false, z: 'R0hJ', seen: '2026-10-13T00:35:19.901Z' });
assert.deepEqual([stale2.status, stale2.ok, stale2.stale, held().z], [200, false, true, 'REVG'], 'something was written while the store could not be read');
old = false;
ok('a store that has a newer copy than it can serve says so, to a reading and to a writing, and nothing is written');

// ---- the night of 2026-10-13: the new server read the 00:35 copy, never saw the last word, and writes
const over = await ask({ op: 'save', at: '2026-10-13T01:46:27.000Z', boot: 'bbbb', final: false, z: 'R0hJ', seen: '2026-10-13T00:35:19.901Z' });
assert.deepEqual([over.ok, over.newer, over.save?.z, over.save?.at, held().z], [false, true, 'REVG', '2026-10-13T01:44:45.000Z', 'REVG'], `the last word was written over: ${JSON.stringify(over)}`);
// (it takes that in, and says it has seen it: now it is written)
const then = await ask({ op: 'save', at: '2026-10-13T01:46:28.000Z', boot: 'bbbb', final: false, z: 'R0hJ', seen: over.save!.at });
assert.deepEqual([then.ok, held().z, held().boot], [true, 'R0hJ', 'bbbb']);
// (and a server that had nothing to read, and so has seen nothing, is not let write over what there is either)
const blind = await ask({ op: 'save', at: '2026-10-13T02:00:00.000Z', boot: 'cccc', final: false, z: 'SktM', seen: '' });
assert.deepEqual([blind.ok, blind.newer, held().z], [false, true, 'R0hJ']);
ok('nothing is written over a copy its writer has not seen: it is handed back to be taken in first');

// ---- a server's own next writing does not wait on the store's cache: it says the mark its last writing was given
{
  const first = await ask({ op: 'save', at: '2026-10-13T03:00:00.000Z', boot: 'cccc', final: false, z: 'UVJT', seen: held().at });
  assert.ok(first.ok && typeof first.mark === 'string' && first.mark, `a writing is not answered with its mark: ${JSON.stringify(first)}`);
  old = true;
  // (the last word, a moment later, with the store unreadable: written, because the file is still this server's own)
  const last = await ask({ op: 'save', at: '2026-10-13T03:02:30.000Z', boot: 'cccc', final: true, z: 'VldY', seen: '2026-10-13T03:00:00.000Z', mark: first.mark });
  assert.deepEqual([last.ok, held().z, held().final], [true, 'VldY', true], `the last word was not written while the store could not be read: ${JSON.stringify(last)}`);
  // (and again on the mark that one was given)
  assert.equal((await ask({ op: 'save', at: '2026-10-13T03:02:40.000Z', boot: 'cccc', final: true, z: 'WVpB', mark: last.mark })).ok, true);
  // (another server, or the same with a mark that is no longer the file's: told it is stale, and nothing written)
  const other = await ask({ op: 'save', at: '2026-10-13T03:03:00.000Z', boot: 'dddd', final: false, z: 'QkJC', seen: '', mark: first.mark });
  assert.deepEqual([other.ok, other.stale, held().z], [false, true, 'WVpB']);
  const none = await ask({ op: 'save', at: '2026-10-13T03:03:00.000Z', boot: 'dddd', final: false, z: 'QkJC', seen: '' });
  assert.deepEqual([none.ok, none.stale, held().z], [false, true, 'WVpB']);
  old = false;
  ok('a server\'s own next writing is made on the mark of its last, though the store cannot be read; nobody else\'s is');
}

// ---- a server from before the rule says nothing of what it has seen, and is written as it always was
assert.equal((await ask({ op: 'save', at: '2026-10-13T02:10:00.000Z', boot: 'dddd', final: true, z: 'TU5P' })).ok, true);
assert.equal(held().z, 'TU5P');
ok('a server from before the rule is written as it always was');

console.log(`${n} checks passed`);
