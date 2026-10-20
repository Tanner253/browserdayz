// The server: the roles as the panel's Roles shows them, and whether an admin leaves a dog tag, set by an admin above them.

import { ADMIN, keyHash, over, roleOf, tagLock } from './gate';
import { saveAdmin, savedWords, setPower, sys, whoIs } from './keep';
import { clients, type Client } from './players';
import { log } from './index';

/** a role as the panel's Roles names it: `r:` and the start of the key's hash it is kept under */
export const roleId = (k: string) => `r:${k.slice(0, 16)}`;
/** the key's hash of the one role a word names (its roleId, or the name it was given under), or null */
export function roleKey(word: string): string | null {
  const roles = ADMIN.state.roles, w = word.toLowerCase();
  const hits = /^r:[0-9a-f]{6,}$/i.test(word) ? Object.keys(roles).filter((k) => k.startsWith(w.slice(2))) : Object.keys(roles).filter((k) => roles[k].name.toLowerCase() === w);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Every role for an admin's panel: its id; `low` where this admin is above it and may take it away, online or not;
 * `tag` whether they leave a dog tag (`by` whoever set it for them, else it is their own choice); `tagMine` where this
 * admin may set it.
 */
export function roleRows(c: Client) {
  const me = keyHash(c.key), on = new Map([...clients.values()].map((o) => [keyHash(o.key), o]));
  const chose = new Map([...ADMIN.voids].map(([k, v]) => [keyHash(k), v.voidTag]));
  return Object.entries(ADMIN.state.roles).map(([k, r]) => {
    const set = ADMIN.state.tags?.[k], low = k !== me && over(me, k), o = on.get(k);
    // (their own choice, where none is set: an admin leaves none until they choose to, as asAdmin has it)
    const leaves = set ? set.on : o ? !o.power.voidTag : chose.has(k) ? !chose.get(k) : r.role !== 'admin';
    return {
      name: r.name, role: r.role, by: r.by, at: r.at.slice(0, 10), id: roleId(k),
      ...(low ? { low: true as const } : {}),
      tag: { on: leaves, ...(set ? { by: set.by } : {}) },
      ...(low && (!set || set.up === me || over(me, set.up)) ? { tagMine: true as const } : {}),
    };
  });
}

/** why somebody's own /voidtag, or another admin's for them, is refused: their tag is set (see tagLock); else null */
export function tagSet(c: Client, t: Client): string | null {
  if (tagLock(t.key) === undefined) return null;
  const s = ADMIN.state.tags![keyHash(t.key)];
  return t === c ? `Your dog tag is set ${s.on ? 'on' : 'off'} for you by ${s.by}: it is not yours to change.` : `${t.name}’s dog tag is set ${s.on ? 'on' : 'off'} by ${s.by}: change it in Roles (/dogtag).`;
}

/**
 * `/dogtag who on|off`: whether somebody below you leaves a dog tag when they die, set for them and no longer theirs to
 * choose (the owner, 2026-10-19: "some admins i cannot trust to self regulate their powers and turn on void dogtag or
 * not farm them for their friends. As the owner/head admin i should be able to to turn this on or off for admins in the
 * roles panel. Dogtag:on/off is fine"). Online or not (who is a name, #number or the Roles id). Only whoever set it, or
 * somebody above them, changes it: an admin in between cannot undo what the owner set.
 */
export async function dogtag(c: Client, rest: string[], above: (name: string) => void) {
  const say = rest.find((w) => w === 'on' || w === 'off'), who = rest.find((w) => w !== 'on' && w !== 'off');
  if (!say || !who) return void sys(c, 'Say whom, and on or off: /dogtag Fay off (on: they leave a tag when they die, as anybody does; off: they leave none).');
  const t = whoIs(who), rk = t ? keyHash(t.key) : roleKey(who);
  if (!rk) return void sys(c, `Nobody online is "${who}" (or more than one is), and nobody with a role is.`);
  const r = ADMIN.state.roles[rk], name = t?.name ?? r?.name ?? who, me = keyHash(c.key);
  if (rk === me) return void sys(c, 'Not yourself: whoever is above you sets yours.');
  if (!r && !(t && roleOf(t))) return void sys(c, `${name} has no role: they leave a tag when they die, as anybody does.`);
  if (!over(me, rk)) return above(name);
  const was = ADMIN.state.tags?.[rk];
  if (was && was.up !== me && !over(me, was.up)) return void sys(c, `${was.by} set ${name}’s dog tag, and is above you: only they, or somebody above them, can change it.`);
  const on = say === 'on';
  log(`[admin] ${c.name} set ${name}'s dog tag ${say}`);
  const kept = await saveAdmin({ ...ADMIN.state, tags: { ...ADMIN.state.tags, [rk]: { on, by: c.name, up: me, at: new Date().toISOString() } } });
  if (t) {
    if (roleOf(t) === 'admin') setPower(t, 'voidTag', !on);
    sys(t, `${c.name} has set your dog tag ${on ? 'on: when you die it is on your body, as anybody’s is' : 'off: when you die no dog tag of yours is left'}. It is no longer yours to change.`);
  }
  sys(c, `${name}: dog tag ${say}, and no longer theirs to change.${savedWords(kept)}`);
}
