// npx tsx test/karambit-relog.test.ts: a karambit with an emerald finish comes back as itself after a logout and a
// restart (the owner, 2026-10-25: "i logged out with a karambit in my hand, emerald and logged back in with a nickel
// plated combat knife"). The server's whole path: the store's form and finish put on a knife, the record kept and read
// back on a fresh server, and the pockets the game says it carries cleaned, held or in a pocket.
import assert from 'node:assert/strict';
import type { ItemId } from '../api/_lib/shop-items';
import { plating } from '../server/plates';
import { cleanInventory as cleanCarried } from '../src/sim/inventory';

/** as server/players.ts cleanInventory: the pockets made safe, each thing wearing what the record says */
const cleanInventory = (raw: unknown) => plating.stampAll(cleanCarried(raw, (v) => String(v ?? '')));

const owned: ItemId[] = ['karambit', 'knife_emerald'];
const skin = (want: ItemId) => (gun: string) => (gun === 'knife' || gun === 'karambit' ? want : null) as ItemId | null;
const knife = (uid: string) => ({ uid, id: 'knife', qty: 1 });
const inv = (held: object | null, pocket: object | null) => ({ slots: { held, tags: null }, containers: pocket ? [{ id: 'pockets', items: [{ ...pocket, x: 0, y: 0, rot: false }] }] : [], hot: [] });

// made a karambit, then plated emerald: in the hands, and a second one in a pocket
for (const uid of ['k-held', 'k-pocket']) {
  const where = uid === 'k-held' ? inv(knife(uid), null) : inv(null, knife(uid));
  for (const f of owned) assert.ok(typeof plating.apply(where as never, uid, skin(f)) !== 'string', `${uid}: ${f} put on`);
}
// kept over a restart, and read back on a fresh server (the map emptied, as a new process has it)
const kept = JSON.parse(JSON.stringify(plating.keep()));
for (const [uid] of kept) (plating as unknown as { forget?: (u: string) => void }).forget?.(uid);
plating.restore(kept);
// the game logs back in saying it carries a knife (an older save, or one that never heard it was made a karambit)
const back = cleanInventory(inv(knife('k-held'), knife('k-pocket')));
const held = back!.slots.held!, pocket = back!.containers.flatMap((c) => c.items).find((i) => i.uid === 'k-pocket')!;
for (const [where, it] of [['held', held], ['in a pocket', pocket]] as const) {
  assert.equal(it.id, 'karambit', `${where}: came back as ${it.id}`);
  assert.equal(it.finish, 'knife_emerald', `${where}: came back wearing ${it.finish}`);
}
// and with the record lost (the owner's case on live): what the holder bought comes back as itself; what they did not, not
const lost = () => inv({ uid: 'k-lost', id: 'karambit', qty: 1, finish: 'knife_emerald' }, null);
const theirs = plating.stampAll(cleanCarried(lost(), (v) => String(v ?? '')), (f) => owned.includes(f))!.slots.held!;
assert.equal(theirs.id, 'karambit', `a lost record, bought: came back as ${theirs.id}`);
assert.equal(theirs.finish, 'knife_emerald', `a lost record, bought: came back wearing ${theirs.finish}`);
const stranger = plating.stampAll(cleanCarried(inv({ uid: 'k-other', id: 'karambit', qty: 1, finish: 'knife_ruby' }, null), (v) => String(v ?? '')), () => false)!.slots.held!;
assert.equal(stranger.id, 'knife', 'not bought: a plain combat knife');
assert.equal(stranger.finish, undefined, 'not bought: no finish');
console.log('karambit relog: the emerald karambit comes back as itself, held and in a pocket, and with its record lost');
