// What is done in a crate, a body, a stash, a drop, a piece of furniture or a bag lying on the ground, as moves of one
// thing each (2026-10-23, the owner, of "Someone else is searching that": players locked out of a body or a crate
// somebody else had open; "We should not have cut any corners on anything"). A game said what was in the whole crate
// after each change, and so only one could have it open: two would have written over each other. Now a game says what
// it did (`diffOps`: this taken, this put there, this moved, this many more on that pile) and the server does each to
// the crate as it is now (`applyOps`), so that any number can go through it at once. What cannot be done (taken by
// somebody else first, no room left) is said back, and the game puts it right.

import { Container, bagGrid } from './inventory';
import { ITEMS, type ItemInstance, type Placed } from './items';

/** a thing in a crate's grid, where it lies in it */
export type Laid = ItemInstance & { x: number; y: number; rot: boolean };

/** One move in a crate, or in a bag inside it (`in`: that bag's number, however deep it lies). */
export type BoxOp =
  | { o: 'take'; uid: string; in?: string; n?: number }
  | { o: 'put'; item: Laid; in?: string }
  | { o: 'move'; uid: string; in?: string; x: number; y: number; rot: boolean }
  | { o: 'add'; uid: string; in?: string; n: number };

/** What could not be done: things the game took that were gone (and how many of a pile), and things it put that found no room or may not go in. */
export interface Refused {
  took: { uid: string; id: string; n?: number }[];
  back: Laid[];
}

const laidOf = (p: Placed): Laid => ({ ...p.item, x: p.x, y: p.y, rot: p.rot });

/** the things in a bag, where each lies in it */
export const laidIn = (item: ItemInstance): Laid[] => (item.cargo ?? []).map(laidOf);

/** what a game did in a grid, from what it said was in it (`before`) to what is in it now: the moves of one thing each */
export function diffOps(before: Laid[], after: Laid[], inside?: string): BoxOp[] {
  const ops: BoxOp[] = [];
  const was = new Map(before.map((it) => [it.uid, it]));
  const now = new Map(after.map((it) => [it.uid, it]));
  const at = inside ? { in: inside } : {};
  for (const [uid] of was) if (!now.has(uid)) ops.push({ o: 'take', uid, ...at });
  for (const [uid, it] of now) {
    const old = was.get(uid);
    if (!old) {
      ops.push({ o: 'put', item: it, ...at });
      continue;
    }
    if (it.qty !== old.qty) ops.push(it.qty < old.qty ? { o: 'take', uid, n: old.qty - it.qty, ...at } : { o: 'add', uid, n: it.qty - old.qty, ...at });
    if (it.x !== old.x || it.y !== old.y || !!it.rot !== !!old.rot) ops.push({ o: 'move', uid, x: it.x, y: it.y, rot: !!it.rot, ...at });
    // (what is in a bag inside it: gone through as a grid of its own)
    if (it.cargo || old.cargo) ops.push(...diffOps((old.cargo ?? []).map(laidOf), (it.cargo ?? []).map(laidOf), uid));
  }
  return ops;
}

/** a bag lying anywhere in these things, by its number */
function bagIn(items: ItemInstance[], uid: string): ItemInstance | null {
  for (const it of items) {
    if (it.uid === uid) return it;
    const deeper = bagIn((it.cargo ?? []).map((p) => p.item), uid);
    if (deeper) return deeper;
  }
  return null;
}

/** laid by the grid's own rules: where it was put, or wherever there is room */
function placed(grid: Container, it: ItemInstance, x: number, y: number, rot: boolean): boolean {
  if (!grid.accepts(it)) return false;
  const room = grid.fits(it, x, y, rot) ? { x, y, rot } : grid.findSpace(it);
  return !!room && grid.place(it, room.x, room.y, room.rot);
}

/** is a thing of this number anywhere in these things */
const anywhere = (items: ItemInstance[], uid: string) => !!bagIn(items, uid);

/**
 * The moves done to a grid of w x h as it is now, each as far as it can be: what is taken is out of it, what is put
 * is in it where it was put (or wherever there is room), what is moved is moved if there is room there.
 * @param mayPut whether a thing may go in at all (a dog tag nowhere but on a body, and only by whoever holds it); one that may not is given back
 * @param clean what a game says a thing is, made safe (the server's own way: cleanItem)
 * @param loose the grid itself takes things by room alone (a crate or a body, as the server has always laid them: what may go in at all is `mayPut`'s); a bag in it, and a bag lying about, by its own rules
 * @param like the grid whose rules it keeps (a bag lying about: `bagGrid`, which takes no bag with things in it)
 * @returns what is in it now, what was taken out of it and put into it, and what could not be done
 */
export function applyOps(items: Laid[], w: number, h: number, ops: BoxOp[], mayPut: (it: ItemInstance) => boolean, clean: (raw: unknown) => ItemInstance | null, loose = false, like?: Container): { items: Laid[]; took: ItemInstance[]; put: ItemInstance[]; refused: Refused } {
  const top = Object.assign(new Container('box', 'box', w, h, [], like?.holdsBags ?? true), { depth: like?.depth ?? 0, of: like?.of });
  for (const s of items) {
    const { x, y, rot, ...it } = s;
    // (where it lies, or wherever there is room; never lost, whatever the grid's rules now)
    if (!top.restore(it, x, y, rot)) top.items.push({ item: it, x, y, rot });
  }
  const took: ItemInstance[] = [], put: ItemInstance[] = [];
  const refused: Refused = { took: [], back: [] };
  const all = () => top.items.map((p) => p.item);
  const gridOf = (inside?: string): Container | null => {
    if (!inside) return top;
    const bag = bagIn(all(), inside);
    return bag ? bagGrid(bag, 1) : null;
  };
  for (const op of ops.slice(0, 200)) {
    const grid = gridOf(op.in);
    if (op.o === 'put') {
      const it = clean(op.item);
      if (!it) continue;
      // (already in it: said twice)
      if (anywhere(all(), it.uid)) continue;
      const x = Number(op.item.x), y = Number(op.item.y), rot = !!op.item.rot;
      if (grid && mayPut(it) && (loose && grid === top ? top.restore(it, x, y, rot) : placed(grid, it, x, y, rot))) put.push(it);
      else refused.back.push({ ...it, x, y, rot });
      continue;
    }
    const p = grid?.items.find((q) => q.item.uid === op.uid);
    if (op.o === 'take') {
      const n = op.n !== undefined && Number.isFinite(op.n) ? Math.max(1, Math.floor(op.n)) : undefined;
      if (!p || (n !== undefined && n > p.item.qty)) {
        refused.took.push({ uid: op.uid, id: p?.item.id ?? '', ...(n !== undefined ? { n } : {}) });
        continue;
      }
      if (n === undefined || n >= p.item.qty) {
        grid!.remove(p.item);
        took.push(p.item);
      } else {
        p.item.qty -= n;
        took.push({ ...p.item, qty: n });
      }
      continue;
    }
    if (!p) continue;
    if (op.o === 'move') {
      const x = Number(op.x), y = Number(op.y), rot = !!op.rot;
      if (grid!.free(p.item, x, y, rot, p.item) && grid!.fits(p.item, x, y, rot, p.item)) Object.assign(p, { x, y, rot });
      continue;
    }
    if (op.o === 'add') {
      const cap = ITEMS[p.item.id]?.stack ?? 1, n = Math.max(0, Math.floor(Number(op.n) || 0));
      const fit = Math.min(n, cap - p.item.qty);
      p.item.qty += fit;
      if (fit > 0) put.push({ ...p.item, qty: fit });
      // (more than the pile takes: given back)
      if (n > fit) refused.back.push({ ...p.item, uid: `${p.item.uid}-back-${Date.now().toString(36)}`, qty: n - fit, x: p.x, y: p.y, rot: p.rot });
    }
  }
  return { items: top.items.map(laidOf), took, put, refused };
}
