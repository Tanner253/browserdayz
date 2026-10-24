// A base's boxes in the game (2026-10-24, base building's fourth step; the server's side server/boxes.ts): each a store
// opened with F and filled as a crate is. Plan v2: "Small box · Large box ... 6×5 and 10×8 squares".

import { Stash } from '../loot';
import { PIECES } from '../../sim/build/pieces';
import { toWorld, type Base } from '../../sim/build/snap';
import type { Input } from '../../core/input';

export class BoxView {
  /** each box's store, by its server name (`bbox:<base>:<piece>`) */
  private stores = new Map<string, Stash>();

  constructor(private input: Input, private open: (s: Stash) => void) {}

  /** a base's boxes as it is now: their stores made, or taken away with them */
  sync(b: Base) {
    const pre = `bbox:${b.id}:`;
    for (const cid of [...this.stores.keys()]) if (cid.startsWith(pre) && !b.pieces.has(Number(cid.slice(pre.length)))) this.stores.delete(cid);
    for (const p of b.pieces.values()) {
      const size = PIECES[p.k].store, cid = `${pre}${p.id}`;
      if (!size || this.stores.has(cid)) continue;
      const [x, y, z] = toWorld(b, p.x, p.y, p.z);
      this.stores.set(cid, new Stash(cid, x, y + 0.3, z, 0, size[0], size[1], PIECES[p.k].name));
    }
  }
  forget(b: number) {
    for (const cid of [...this.stores.keys()]) if (cid.startsWith(`bbox:${b}:`)) this.stores.delete(cid);
  }
  clear() {
    this.stores.clear();
  }
  all(): Stash[] {
    return [...this.stores.values()];
  }
  byCid(cid: string): Stash | undefined {
    return this.stores.get(cid);
  }

  /** a box looked at (`t`): what the corner says, and F opens it */
  frame(ok: boolean, t: { base: Base; id: number } | null): string | null {
    const p = t?.base.pieces.get(t.id), s = t && this.stores.get(`bbox:${t.base.id}:${t.id}`);
    if (!p || !s) return null;
    if (ok && this.input.pressed('KeyF')) this.open(s);
    return `<kbd>F</kbd>Open ${PIECES[p.k].name.toLowerCase()}`;
  }
}
