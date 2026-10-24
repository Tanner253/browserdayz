// THE MAP AS A FILE (2026-10-23): the world made once as the site is built (scripts/world-file.ts, run by the build:
// vite.config.ts `worldFile`) and fetched by the page, instead of made by every browser after every release. It took
// 30 s of a desktop's processor, and minutes of a cheap phone's: Androids sat at "world" for over 50 s, the iPhone of
// a start report for nine minutes. The file is the same data as `withCaves(generateWorld())`, value for value (held
// to that by test/world-file.test.ts): numbers as JSON writes them (every double read back as it was written), -0,
// NaN, the infinities and `undefined` said outright, an object found in two places one object in both (as a worker's
// copy of the world keeps it), each typed array its own bytes. The grids are laid out to pack small: a float grid as
// the steps between neighbours' bits, a grid of bytes channel by channel, a grid that is another but for a few points
// as those points (`surface` is `heights` but for the bunker's roof). Gzipped whole.
import type { World } from './worldgen';

const MAGIC = 0x3146575a; // "ZWF1"
type Typed = Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array | Uint8ClampedArray;
const KINDS = { Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Uint8ClampedArray } as const;
type Kind = keyof typeof KINDS;
/** how a typed array's bytes are kept: as they are; a grid `row` wide (`k` bytes a point: 4 for a float grid, steps between neighbours' bits; else channels, steps between neighbours); or array `of` but for the points listed */
type Layout = { kind: Kind; n: number; bytes: number } & ({ how: 'raw' } | { how: 'grid'; row: number; k: number } | { how: 'like'; of: number; at: number });

const bytesOf = (a: Typed) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** a grid's bytes, `k` to a point, as planes (each byte of a point with its own kind), each the steps between neighbours (left, or above at a row's start) */
function gridPack(src: Uint8Array, row: number, k: number, words: boolean): Uint8Array {
  const n = src.length / k;
  if (words) {
    // (a float grid: the steps between neighbours' bits, as whole words, then split into planes)
    const u = new Uint32Array(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength)), d = new Uint32Array(n);
    for (let i = 0; i < n; i++) d[i] = (u[i] - (i % row ? u[i - 1] : i >= row ? u[i - row] : 0)) >>> 0;
    const b = new Uint8Array(d.buffer), out = new Uint8Array(src.length);
    for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) out[j * n + i] = b[i * 4 + j];
    return out;
  }
  const out = new Uint8Array(src.length);
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < n; i++) {
      const prev = i % row ? src[(i - 1) * k + j] : i >= row ? src[(i - row) * k + j] : 0;
      out[j * n + i] = (src[i * k + j] - prev) & 255;
    }
  }
  return out;
}
function gridUnpack(src: Uint8Array, row: number, k: number, words: boolean): Uint8Array<ArrayBuffer> {
  const n = src.length / k;
  if (words) {
    const d = new Uint32Array(n);
    for (let i = 0; i < n; i++) d[i] = src[i] | (src[n + i] << 8) | (src[2 * n + i] << 16) | (src[3 * n + i] << 24);
    for (let i = 0; i < n; i++) d[i] = (d[i] + (i % row ? d[i - 1] : i >= row ? d[i - row] : 0)) >>> 0;
    return new Uint8Array(d.buffer);
  }
  const out = new Uint8Array(src.length);
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < n; i++) {
      const prev = i % row ? out[(i - 1) * k + j] : i >= row ? out[(i - row) * k + j] : 0;
      out[i * k + j] = (src[j * n + i] + prev) & 255;
    }
  }
  return out;
}

/**
 * The world as the file's bytes, before they are gzipped. `row`: the width of the map's grids, in points.
 * `smallest(bytes)` says how big a choice of layout packs (the build gzips each to choose): left out, every array is kept as it is.
 */
export function packWorld(world: World, row: number, smallest?: (b: Uint8Array) => number): Uint8Array {
  // (first, which objects are met more than once: those are given a number where they are first met)
  const met = new Map<object, number>();
  const count = (v: unknown, path: Set<object>) => {
    if (!v || typeof v !== 'object') return;
    if (path.has(v)) throw new Error('the world holds itself');
    const n = (met.get(v) ?? 0) + 1;
    met.set(v, n);
    if (n > 1 || ArrayBuffer.isView(v)) return;
    path.add(v);
    for (const x of Array.isArray(v) ? v : Object.values(v)) count(x, path);
    path.delete(v);
  };
  count(world, new Set());

  const arrays: Typed[] = [], layouts: Layout[] = [], parts: Uint8Array[] = [];
  const ids = new Map<object, number>();
  const put = (a: Typed): Layout => {
    const kind = a.constructor.name as Kind;
    if (!(kind in KINDS)) throw new Error(`a ${kind} cannot be kept`);
    const raw = bytesOf(a);
    let best: { layout: Layout; part: Uint8Array } = { layout: { kind, n: a.length, bytes: raw.length, how: 'raw' }, part: raw };
    if (smallest) {
      let size = smallest(raw);
      const tryIt = (layout: Layout, part: Uint8Array) => {
        const s = smallest(part);
        if (s < size) { size = s; best = { layout: { ...layout, bytes: part.length }, part }; }
      };
      // (a grid of the map: as steps between neighbours)
      for (const k of [1, 2, 3, 4]) {
        if (a.length % (row * k) || a.length / k < row * 2) continue;
        const words = kind === 'Float32Array' || kind === 'Uint32Array' || kind === 'Int32Array';
        if (words && k !== 1) continue;
        if (!words && (kind !== 'Uint8Array' && kind !== 'Int8Array')) continue;
        tryIt({ kind, n: a.length, bytes: 0, how: 'grid', row, k: words ? 4 : k }, gridPack(raw, row, words ? 4 : k, words));
      }
      // (another array but for a few points)
      for (let o = 0; o < arrays.length; o++) {
        const b = arrays[o];
        if (b.constructor !== a.constructor || b.length !== a.length) continue;
        const ab = bytesOf(b), size1 = raw.length / a.length, at: number[] = [];
        for (let i = 0; i < a.length && at.length <= a.length / 50; i++) {
          for (let j = 0; j < size1; j++) if (raw[i * size1 + j] !== ab[i * size1 + j]) { at.push(i); break; }
        }
        if (at.length > a.length / 50) continue;
        const part = new Uint8Array(at.length * 4 + at.length * size1);
        new Uint32Array(part.buffer, 0, at.length).set(at);
        at.forEach((i, q) => part.set(raw.subarray(i * size1, (i + 1) * size1), at.length * 4 + q * size1));
        tryIt({ kind, n: a.length, bytes: 0, how: 'like', of: o, at: at.length }, part);
      }
    }
    arrays.push(a);
    layouts.push(best.layout);
    parts.push(best.part);
    return best.layout;
  };
  const enc = (v: unknown): unknown => {
    if (v === undefined) return { $u: 1 };
    if (typeof v === 'number') {
      if (Object.is(v, -0)) return { $n: '-0' };
      if (!Number.isFinite(v)) return { $n: String(v) };
      return v;
    }
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v !== 'object') throw new Error(`a ${typeof v} cannot be kept`);
    if (ids.has(v)) return { $r: ids.get(v) };
    let out: unknown;
    if (ArrayBuffer.isView(v)) {
      put(v as Typed);
      out = { $t: arrays.length - 1 };
    } else if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (!(i in v)) throw new Error('an array with holes cannot be kept');
      out = v.map(enc);
    } else {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error(`a ${proto?.constructor?.name} cannot be kept`);
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith('$')) throw new Error(`a key "${k}" cannot be kept`);
        o[k] = enc(x);
      }
      out = o;
    }
    if ((met.get(v) ?? 0) > 1) {
      // (numbered where first met, the inner part first: an object inside it met twice is numbered before it)
      const id = ids.size;
      ids.set(v, id);
      return { $id: id, $v: out };
    }
    return out;
  };
  const tree = enc(world);
  const json = new TextEncoder().encode(JSON.stringify({ world: tree, arrays: layouts }));
  const total = 8 + json.length + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, json.length, true);
  out.set(json, 8);
  let at = 8 + json.length;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** The world out of the file's bytes (ungzipped). */
export function unpackWorld(given: Uint8Array): World {
  // (a plain view: a Node Buffer's `slice` copies nothing)
  const bytes = new Uint8Array(given.buffer, given.byteOffset, given.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('not a world file');
  const jsonLen = view.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + jsonLen))) as { world: unknown; arrays: Layout[] };
  const arrays: Typed[] = [];
  let at = 8 + jsonLen;
  for (const l of head.arrays) {
    const part = bytes.subarray(at, at + l.bytes);
    at += l.bytes;
    const Kind = KINDS[l.kind];
    const size1 = Kind.BYTES_PER_ELEMENT;
    let raw: Uint8Array<ArrayBuffer>;
    if (l.how === 'raw') raw = part.slice();
    else if (l.how === 'grid') raw = gridUnpack(part, l.row, l.k, l.k === 4 && size1 === 4);
    else {
      raw = bytesOf(arrays[l.of]).slice();
      const where = new Uint32Array(part.slice(0, l.at * 4).buffer);
      for (let q = 0; q < l.at; q++) raw.set(part.subarray(l.at * 4 + q * size1, l.at * 4 + (q + 1) * size1), where[q] * size1);
    }
    if (raw.length !== l.n * size1) throw new Error('a world file cut short');
    arrays.push(new Kind(raw.buffer, 0, l.n));
  }
  if (at !== bytes.length) throw new Error('a world file of the wrong length');
  const ids: unknown[] = [];
  const dec = (v: unknown): unknown => {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = dec(v[i]);
      return v;
    }
    const o = v as Record<string, unknown>;
    if ('$t' in o) return arrays[o.$t as number];
    if ('$n' in o) return Number(o.$n === '-0' ? -0 : o.$n);
    if ('$u' in o) return undefined;
    if ('$r' in o) return ids[o.$r as number];
    if ('$id' in o) {
      const inner = dec(o.$v);
      ids[o.$id as number] = inner;
      return inner;
    }
    for (const k of Object.keys(o)) o[k] = dec(o[k]);
    return o;
  };
  return dec(head.world) as World;
}

/** what a world read from anywhere must at least be, to be played */
export function looksWhole(world: World | undefined): world is World {
  return !!world && world.heights instanceof Float32Array && world.heights.length > 0 &&
    world.grass instanceof Uint8Array && world.grass.length === world.heights.length &&
    Array.isArray(world.buildings) && Array.isArray(world.trees);
}
