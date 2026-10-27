// Everybody who has played, kept with the world, so that an admin can find and ban somebody who is neither on nor in
// "Left lately" (the owner, 2026-10-27: "as admin i need a way to search all players so i can ban a player who is
// offline and also not int he recently left list"). Only what a ban takes: their game's key and their address as
// hashes (gate.ts keyHash, ipHash, done by whoever marks them), their device as /players shows it, the names they
// went by, and when.

/** how long somebody is kept after they last played, ms; the most kept (the latest); the names kept of each */
const KEEP_MS = 90 * 24 * 3600_000, MOST = 20_000, NAMES = 4;

export interface Known {
  /** their game's key, hashed: what a ban holds */
  key: string;
  /** their address, hashed ('' when it could not be told) */
  ip: string;
  /** their device ('' unknown) */
  fp: string;
  /** the names they went by, the latest last */
  names: string[];
  first: number;
  last: number;
}

const known = new Map<string, Known>();

const prune = (now: number) => {
  for (const [k, p] of known) if (now - p.last > KEEP_MS) known.delete(k);
  if (known.size > MOST) for (const p of [...known.values()].sort((a, b) => a.last - b.last).slice(0, known.size - MOST)) known.delete(p.key);
};

export const roster = {
  /** somebody in the world (their key and address hashed): noted, or their names, address, device and time brought up to date */
  mark(c: { key: string; ip: string; fp: string; name: string }) {
    const key = c.key, was = known.get(key), now = Date.now();
    known.set(key, { key, ip: c.ip || was?.ip || '', fp: c.fp || was?.fp || '', names: [...(was?.names ?? []).filter((n) => n !== c.name), c.name].slice(-NAMES), first: was?.first ?? now, last: now });
  },
  /** whoever went by a name with `text` in it (or on a device starting `dev`): one who went by just that name first, then the latest */
  find(text: string, dev = '', most = 15): Known[] {
    const t = text.toLowerCase(), exact = (p: Known) => (p.names.some((n) => n.toLowerCase() === t) ? 1 : 0);
    const hits = [...known.values()].filter((p) => (dev ? p.fp.startsWith(dev) : t.length > 1 && p.names.some((n) => n.toLowerCase().includes(t))));
    return hits.sort((a, b) => exact(b) - exact(a) || b.last - a.last).slice(0, most);
  },
  keep(): Known[] {
    prune(Date.now());
    return [...known.values()];
  },
  /** what was kept (or a copy that turned up late): the later of the two wins */
  restore(list: unknown) {
    if (!Array.isArray(list)) return;
    for (const p of list as Known[]) {
      if (!p || typeof p.key !== 'string' || !Array.isArray(p.names) || typeof p.last !== 'number') continue;
      const was = known.get(p.key);
      if (!was || was.last < p.last) known.set(p.key, { key: p.key, ip: String(p.ip ?? ''), fp: String(p.fp ?? ''), names: p.names.map(String).slice(-NAMES), first: Math.min(p.first ?? p.last, was?.first ?? Infinity), last: p.last });
    }
    prune(Date.now());
  },
};
