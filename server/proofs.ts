// What a page was banned for running, in full (the owner, 2026-10-27: "any code sumbitted by the browser ... needs to be
// flagged and banned (show the code ran in the admin panel in ban information)"). A ban's reason is cut at 120 letters by
// the site (api/admin.ts), so the proof is kept here by the banned game's key hash: the stack of whatever read a trap
// (a pasted script's lines, an extension's or a userscript's name), or the source of what hooked the game
// (src/net/hook-trap.ts). Kept with the world (keep.ts); on the panel's ban rows, and /proof.

export interface Proof {
  at: number;
  name: string;
  what: string;
  text: string;
}

/** the most kept (the latest) */
const MOST = 500;
const byKey = new Map<string, Proof>();

export const proofs = {
  set(key: string, p: Proof) {
    byKey.delete(key);
    byKey.set(key, p);
    if (byKey.size > MOST) byKey.delete(byKey.keys().next().value!);
  },
  get(key: string): Proof | undefined {
    return byKey.get(key);
  },
  /** the proof of whoever went by a name with `text` in it, the latest first */
  find(text: string): Proof[] {
    const t = text.toLowerCase();
    return [...byKey.values()].filter((p) => p.name.toLowerCase().includes(t)).reverse();
  },
  keep(): [string, Proof][] {
    return [...byKey];
  },
  restore(kept: unknown) {
    if (!Array.isArray(kept)) return;
    for (const e of kept) if (Array.isArray(e) && typeof e[0] === 'string' && e[1] && !byKey.has(e[0])) byKey.set(e[0], e[1] as Proof);
  },
};
