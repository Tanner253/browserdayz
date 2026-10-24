// Who holds each dog tag that can pay (one in `lootedTags`), as this server saw it change hands (2026-10-23, the
// owner: "i keep getting paid for tags as admin that i either trashed, or deleted or dropped on the ground"). A
// player's game says what it carries, and a tag it had dropped, put on a body or seen trashed was still in what it
// said: the server's copy had the tag twice, on the ground and in the pockets, and it was cashed in from the pockets.
//
// So a tag is a player's only once the server has seen them take it: off a body, off the ground. It leaves them when
// the server sees it go: dropped, put on a body, trashed by an admin, their own body made at their death. What a game
// says it carries is kept to the tags it holds by this (`keepToTheirs`), and only those are cashed in. Each time a
// tag comes to somebody its clock starts again (`tagSeen`): one dropped and picked up again had kept its old start,
// and was cashed in at once.

import type { ItemInstance } from '../src/sim/items';
import type { SerializedInventory } from '../src/sim/inventory';
import { carriedTags, custody, lootedTags, seenOf, tagSeen } from './tags';

const theirs = (key: string) => `p:${seenOf(key)}`;

/** every tag that can pay in a thing and in what is in it, the thing itself included */
export function payingTags(it: ItemInstance | null | undefined, out: ItemInstance[] = []): ItemInstance[] {
  if (!it) return out;
  if (it.id === 'dogtag' && lootedTags.has(it.uid)) out.push(it);
  for (const p of it.cargo ?? []) payingTags(p.item, out);
  return out;
}

export const holdsTag = (key: string, uid: string) => custody.get(uid) === theirs(key);

/** the server saw this player take it: theirs, and its clock started now */
export function cameTo(key: string, uid: string, now = Date.now()) {
  custody.set(uid, theirs(key));
  tagSeen.set(seenOf(key) + uid, now);
}

/** the server saw it leave this player, for the ground or a body (or for nowhere: trashed) */
export function wentFrom(key: string, uid: string, to: string | null) {
  if (to) custody.set(uid, to);
  else custody.delete(uid);
  tagSeen.delete(seenOf(key) + uid);
}

/** a body made, or a thing laid on the ground by the server: the tags in it are there */
export function lieAt(items: ItemInstance[], at: string) {
  for (const it of items) for (const t of payingTags(it)) custody.set(t.uid, at);
}

/**
 * What a game says it carries, kept to the tags this player holds: any other tag that can pay is taken out of the
 * server's copy, and its clock for them stopped. (A tag the server knows of but has never seen change hands, carried
 * since before this was kept, is theirs if its clock was running for them.)
 * @returns the uids taken out
 */
export function keepToTheirs(key: string, inv: SerializedInventory | null): string[] {
  const out: string[] = [];
  for (const t of carriedTags(inv)) {
    if (!lootedTags.has(t.uid) || holdsTag(key, t.uid)) continue;
    if (!custody.has(t.uid) && tagSeen.has(seenOf(key) + t.uid)) {
      custody.set(t.uid, theirs(key));
      continue;
    }
    out.push(t.uid);
    tagSeen.delete(seenOf(key) + t.uid);
  }
  return out;
}

/** these tags taken out of a thing, wherever in it they are */
export function stripTags(it: ItemInstance, gone: Set<string>) {
  if (!it.cargo) return;
  it.cargo = it.cargo.filter((p) => !gone.has(p.item.uid));
  for (const p of it.cargo) stripTags(p.item, gone);
}
