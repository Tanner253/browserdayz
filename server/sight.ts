// Where everybody is, told only to those who could see them (the owner, 2026-10-27: "someone is cheating running code
// in the browser to get ESP hacks on"). Every player's position went to every page fifteen times a second, and a
// script in a page reads whatever it is sent; now a page hears of nobody further off than the furthest draw distance,
// nor of anybody a wall, a rock, a base or the ground hides from them (`Sight`, the owner: "then we can work on a
// rudimentary LOS detection"), but its own party (their marks on the map and the compass) and, for an admin,
// everybody (the far sight; "as admin i should eb able to see everyone"). One who goes out of sight is said to be
// ('out'), so the page stops drawing them where they were last.
import type { Vec3 } from '../src/sim/grenades';

/** metres: told of within `near` (src/core/settings.ts DRAWS, the furthest); one already told of is kept to `keep`, so nobody on the edge comes and goes */
export const SIGHT = { near: 1500, keep: 1600 };

/**
 * Of `rows`, those somebody at `me` is told of: themselves, their party, whoever is within reach and seen, or all of
 * them; and who they were told of last time and are not now. `told` is what they were told of, and is made what they are.
 */
export function inSight<R extends { id: number; x: number; z: number }>(me: { id: number; x: number; z: number }, rows: R[], told: Set<number>, mates: ReadonlySet<number>, all = false, seen: (r: R) => boolean = () => true): { see: R[]; out: number[] } {
  const see: R[] = [], was = new Set(told);
  told.clear();
  for (const r of rows) {
    const reach = was.has(r.id) ? SIGHT.keep : SIGHT.near;
    if (!all && r.id !== me.id && !mates.has(r.id) && ((r.x - me.x) ** 2 + (r.z - me.z) ** 2 > reach * reach || !seen(r))) continue;
    see.push(r);
    told.add(r.id);
  }
  const out: number[] = [];
  for (const id of was) if (!told.has(id)) out.push(id);
  return { see, out };
}

/** a body as the line of sight asks of it: where it stands, how (crouched, lying: the pose's flags), and how it is going (m/s) */
export interface Body {
  id: number;
  x: number;
  y: number;
  z: number;
  /** crouched, lying down (src/net/protocol F_CROUCH, F_PRONE) */
  low: 0 | 1 | 2;
  vx: number;
  vz: number;
}

/** how often a pair is looked at again (ms, near and far), how long one seen stays told of, how far ahead each is
 * taken to be going (s), a lean's width (m), and the most lines traced in one tick (what is not looked at is seen) */
export const LOOK = { near: 60, nearMs: 0, farMs: 250, keepMs: 1000, ahead: 0.25, lean: 0.45, most: 2000 };

/** the eye over the feet, standing, crouched, lying; and the head and chest */
const EYE = [1.6, 1.1, 0.4], HEAD = [1.65, 1.1, 0.3], CHEST = [1.25, 0.8, 0.3];

/**
 * Whether one body can see another, through what `clear` says of a line (the map's walls, bases and the ground): a line
 * clear from the eye, or a lean to either side, or where they are heading, to the other's head or chest, a lean to
 * either side of it, or where it is heading. Kept a while each way (LOOK), and never more than LOOK.most lines a tick:
 * past that, whoever is not looked at is taken as seen, so that nobody comes into sight late.
 */
export class Sight {
  private pairs = new Map<string, { at: number; until: number }>();
  private left = LOOK.most;
  /** lines traced, for /healthz and the log */
  traced = 0;

  constructor(private clear: (a: Vec3, b: Vec3) => boolean) {}

  /** a new tick: its share of lines */
  tick() {
    this.left = LOOK.most;
  }

  sees(me: Body, them: Body, now: number): boolean {
    const key = `${me.id}:${them.id}`, was = this.pairs.get(key);
    const d = Math.hypot(them.x - me.x, them.z - me.z), every = d < LOOK.near ? LOOK.nearMs : LOOK.farMs;
    if (was && now - was.at < every) return now < was.until;
    if (this.left <= 0) return true;
    const ok = this.look(me, them, d);
    this.pairs.set(key, { at: now, until: ok ? now + LOOK.keepMs : was && was.until > now ? was.until : 0 });
    return ok || (!!was && now < was.until);
  }

  /** pairs not looked at for a while, gone (players who left) */
  prune(now: number) {
    for (const [k, p] of this.pairs) if (now - p.at > 10_000) this.pairs.delete(k);
  }

  private look(me: Body, them: Body, d: number): boolean {
    const dx = (them.x - me.x) / (d || 1), dz = (them.z - me.z) / (d || 1), sx = -dz, sz = dx, a = LOOK.ahead, w = LOOK.lean;
    const ey = me.y + EYE[me.low], hy = them.y + HEAD[them.low], cy = them.y + CHEST[them.low];
    const eyes: Vec3[] = [[me.x, ey, me.z], [me.x + sx * w, ey, me.z + sz * w], [me.x - sx * w, ey, me.z - sz * w], [me.x + me.vx * a, ey, me.z + me.vz * a]];
    const aims: Vec3[] = [[them.x, hy, them.z], [them.x, cy, them.z], [them.x + sx * w, hy, them.z + sz * w], [them.x - sx * w, hy, them.z - sz * w], [them.x + them.vx * a, hy, them.z + them.vz * a]];
    for (const e of eyes) for (const t of aims) {
      if (this.left-- <= 0) return true;
      this.traced++;
      if (this.clear(e, t)) return true;
    }
    return false;
  }
}
