// Bodies cleared away by an admin, with whatever is on them: one (the one looked at, by its number, or the nearest), or
// every one within so many metres, as /delz puts down the infected (the owner, 2026-10-23: "admin needs a way to get rid
// of corpses ... and a way to delete corpses in bulk like the kill zombies in bulk vicinity control"). A player's body,
// and one of the infected's, with or without something on it. The rules of what is a body are in server/bodies.ts.

import { boxes, horde, locks, log } from './index';
import { broadcast, type Client } from './players';
import { bodiesWithin, tagsIn, zedUid, type Lying } from './bodies';

/** the bodies about an admin cleared away, metres: as many as not said, and the most */
export const BODIES_NEAR = 60, BODIES_MOST = 400;
/** `/delbody` with nothing after it: the nearest body, if it is as near as this, metres */
const NEAREST = 50;

/** a body taken out of the world for everybody, with whatever is in it @returns how many things were in it, and how many of them (or in them) dog tags */
export function takeBody(l: Lying): { n: number; tags: number } {
  let n = 0, tags = 0;
  if ('box' in l) {
    const items = boxes.get(l.box)?.items ?? [];
    n = items.length;
    tags = tagsIn(items);
    locks.delete(l.box);
    boxes.delete(l.box);
    broadcast({ t: 'corpse-', uid: l.box });
  }
  if (l.zed !== undefined && horde.clear(l.zed)) broadcast({ t: 'i-', i: l.zed });
  return { n, tags };
}

/** what went with them, said back: a dog tag on a body is somebody's kill that was waiting to be taken, and is gone with it */
const things = ({ n, tags }: { n: number; tags: number }, on: string) => (n ? `, with the ${n} thing${n > 1 ? 's' : ''} on ${on}${tags ? ` (${tags} of them dog tag${tags > 1 ? 's' : ''})` : ''}` : '');

/** the body of one of the infected, by its number: null if none of them lies dead with that number */
export function zedLying(i: number): Lying | null {
  const b = horde.bodies.get(i);
  if (!b?.diedAt) return null;
  const box = boxes.get(zedUid(i));
  return box ? { box: box.cid, zed: i, x: box.x, z: box.z } : { zed: i, x: b.s[0], z: b.s[2] };
}

/**
 * `/delbody [number]`: the body of that number (a player's body by the number the Delete key and the panel give, as
 * corpse_12_abc; one of the infected's by its own, as /del z has it), or with none, the nearest. `/delbodies [metres]`:
 * every one within so many metres. @returns what is said back
 */
export function bodyOrder(c: Client, cmd: 'delbody' | 'delbodies', rest: string[]): string {
  const [x, , z] = c.pose;
  if (cmd === 'delbodies') {
    if (rest[0] && !(Number(rest[0]) > 0)) return `/delbodies takes away every body within ${BODIES_NEAR} metres of you; /delbodies 120, within 120 (up to ${BODIES_MOST}).`;
    const within = Math.min(BODIES_MOST, Math.max(5, Number(rest[0]) || BODIES_NEAR));
    const all = bodiesWithin(boxes.values(), horde.bodies.values(), x, z, within);
    if (!all.length) return `No body lies within ${within} metres of you.`;
    const n = all.reduce((sum, l) => {
      const t = takeBody(l);
      return { n: sum.n + t.n, tags: sum.tags + t.tags };
    }, { n: 0, tags: 0 }), zeds = all.filter((l) => l.zed !== undefined).length;
    log(`[admin] ${c.name} took away ${all.length} bodies (${zeds} of the infected's) within ${within} m of ${x.toFixed(0)}, ${z.toFixed(0)}, ${n.n} things on them, ${n.tags} dog tags`);
    return `Taken away: ${all.length} bod${all.length > 1 ? 'ies' : 'y'} within ${within} metres of you${zeds ? ` (${zeds} of the infected's)` : ''}${things(n, all.length > 1 ? 'them' : 'it')}.`;
  }
  const id = (rest[0] ?? '').replace(/^#/, '');
  let l: Lying | null | undefined;
  if (/^\d+$/.test(id)) l = zedLying(Number(id));
  else if (id) {
    const b = boxes.get(id);
    l = b?.kind === 'corpse' && !b.ride ? { box: b.cid, ...(b.zed !== undefined ? { zed: b.zed } : {}), x: b.x, z: b.z } : null;
  } else l = bodiesWithin(boxes.values(), horde.bodies.values(), x, z, NEAREST)[0];
  if (!l) return id ? 'No body of that number lies anywhere.' : `No body lies within ${NEAREST} metres of you.`;
  const whose = 'box' in l && l.zed === undefined ? `${boxes.get(l.box)?.name ?? 'somebody'}'s body` : 'the body of one of the infected';
  const n = takeBody(l);
  log(`[admin] ${c.name} took away ${whose} at ${l.x.toFixed(0)}, ${l.z.toFixed(0)} (${n.n} things on it, ${n.tags} dog tags)`);
  return `Taken away: ${whose}${things(n, 'it')}.`;
}
