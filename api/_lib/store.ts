// Where the payout system keeps what it must not forget: one small JSON file (the book) in
// Vercel Blob.
//
// Three things are asked of it:
//   read    the file as it is now, never a copy a cache has been holding. The files are
//           served through a cache, so a read first asks the service itself which version is
//           current, and takes no copy that is not that version.
//   swap    write the file only if nobody has changed it since it was read (or, for a new
//           file, only if there is none yet). Two workers that both try get one yes and one
//           no: this is what keeps two of them from both acting on the same reading.
//   glance  a copy that may be a minute old. For showing, and for answers that cannot be
//           taken back (a tag once paid stays paid): never for deciding to pay.
//
// What it costs matters as much as what it promises. The service allows so many operations a
// month and stops answering for the rest of it when they are used up: 2,000 writes and
// listings, 10,000 reads that the cache could not answer. So a glance is used wherever a
// glance will do (it costs nothing while the file has not changed), a read only on the way
// to a write, and nothing is written that says nothing new.

import { createHash } from 'node:crypto';
import { BlobNotFoundError, BlobPreconditionFailedError, get, head, list, put } from '@vercel/blob';

export interface Store {
  /** @returns the contents and a mark of this version for swap(), or null if there is no such file */
  read<T>(path: string): Promise<{ data: T; mark: string } | null>;
  /** @returns a copy that may be a minute or so behind, or null if there is (or was) no such file */
  glance<T>(path: string): Promise<T | null>;
  /** @param mark from read() or from an earlier swap(), or null for "there is no file" @returns the mark of what was written, or false if somebody else got there first */
  swap(path: string, data: unknown, mark: string | null): Promise<string | false>;
  /** every path that begins with this (counted as a write: used once, ever) */
  list(prefix: string): Promise<string[]>;
}

// (kept by the cache for an hour: it is told of every change within a minute, and a version asked for by name never changes)
const JSON_FILE = { access: 'public', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 3600 } as const;
const bare = (tag: string | null | undefined) => (tag ?? '').replace('W/', '').split('"').join('');
const md5 = (text: string) => createHash('md5').update(text).digest('hex');

/** the file's current version by the service's own word, and that version's contents fetched by name */
async function current(path: string, attempt = 0): Promise<{ mark: string; text: string; ok: boolean; via: Record<string, unknown> } | null> {
  const now = await head(path).catch((e) => {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  });
  if (!now) return null;
  // (asked for by version, so that a cache holding an older one has nothing to answer with)
  const r = await fetch(`${now.url}?v=${encodeURIComponent(bare(now.etag))}${attempt ? '.' + attempt : ''}`, { cache: 'no-store' });
  const text = r.ok ? await r.text() : '';
  // it is that version if the cache says so, or if its contents add up to the version's own name
  const ok = r.ok && (bare(r.headers.get('etag')) === bare(now.etag) || md5(text) === bare(now.etag));
  return { mark: now.etag, text, ok, via: { status: r.status, version: now.etag, served: r.headers.get('etag'), sum: md5(text), cache: r.headers.get('x-vercel-cache'), age: r.headers.get('age') } };
}

export const blobStore: Store = {
  async read<T>(path: string) {
    for (let i = 0; i < 5; i++) {
      const now = await current(path, i);
      if (!now) return null;
      if (now.ok) return { data: JSON.parse(now.text) as T, mark: now.mark };
      await new Promise((done) => setTimeout(done, 200 * (i + 1)));
    }
    throw new Error('the file store is serving an old copy');
  },
  async glance<T>(path: string) {
    const r = await get(path, { access: 'public' });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return (await new Response(r.stream).json()) as T;
  },
  async swap(path, data, mark) {
    try {
      const done = await put(path, JSON.stringify(data), mark === null ? { ...JSON_FILE, allowOverwrite: false } : { ...JSON_FILE, allowOverwrite: true, ifMatch: mark });
      return done.etag;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) return false;
      // refused because it is there already, or failed for some other reason? Only the first is a "no".
      if (mark === null && (await head(path).then(() => true, () => false))) return false;
      throw e;
    }
  },
  async list(prefix) {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, limit: 1000, cursor });
      for (const b of page.blobs) out.push(b.pathname);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
};

/**
 * Tries the promises above on whatever store it is given, with files of its own that it
 * leaves behind (they are small, and nothing reads them): for seeing that the real service
 * keeps them, from where the real code runs. About twenty writes: run once, not often.
 */
export async function check(store: Store, at: string, sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    const began = Date.now();
    const got = await fn().catch((e) => {
      out[name] = 'FAILED: ' + String((e as Error).message).slice(0, 120);
      return undefined;
    });
    if (got !== undefined) out[name] = got;
    out[name + ' (ms)'] = Date.now() - began;
    return got;
  };
  const file = at + '/a.json';
  await timed('a file that is not there reads as nothing', async () => (await store.read(file)) === null);
  const first = await timed('made, when there was none', () => store.swap(file, { n: 1 }, null));
  if (store === blobStore) await timed('how the service and its cache name that version', async () => (await current(file))?.via ?? null);
  await timed('and read straight back', async () => {
    const r = await store.read<{ n: number }>(file);
    return r ? { n: r.data.n, 'the same mark as the write gave': r.mark === first } : null;
  });
  await timed('made a second time is refused', async () => (await store.swap(file, { n: 99 }, null)) === false);
  await timed('of six making the same file at once, how many are told yes', async () => (await Promise.all(Array.from({ length: 6 }, (_, i) => store.swap(at + '/race.json', { i }, null)))).filter((m) => m !== false).length);
  const second = await timed('changed, with the mark the write gave', () => store.swap(file, { n: 2 }, typeof first === 'string' ? first : 'none'));
  await timed('and the change is what is read, at once', async () => (await store.read<{ n: number }>(file))?.data.n === 2);
  await timed('a change by somebody holding the old mark is refused', async () => (await store.swap(file, { n: 98 }, typeof first === 'string' ? first : 'none')) === false);
  await timed('of six changing it at once from the same reading, how many win', async () => (await Promise.all(Array.from({ length: 6 }, (_, i) => store.swap(file, { n: 10 + i }, typeof second === 'string' ? second : 'none')))).filter((m) => m !== false).length);
  await timed('seconds until a glance shows the latest change', async () => {
    const want = (await store.read<{ n: number }>(file))?.data.n;
    for (let s = 0; s <= 40; s += 4) {
      if ((await store.glance<{ n: number }>(file).catch(() => null))?.n === want) return s;
      await sleep(4000);
    }
    return 'more than 40';
  });
  return out;
}

/** The same promises, kept in memory: for the tests. */
export class MemoryStore implements Store {
  files = new Map<string, { text: string; mark: number }>();
  /** what a glance sees: the files as they were when the cache last caught up */
  private behind = new Map<string, string>();
  /** true makes the cache stop catching up: a glance then shows the files as they were */
  lag = false;
  private n = 0;
  /** counts of what was asked, to see how much of the service's allowance is used */
  ops = { read: 0, glance: 0, swap: 0, list: 0 };
  /** called before every operation, and after every write that went through: a test can make one fail or wait here */
  before: (op: string, path: string) => void | Promise<void> = () => {};
  after: (op: string, path: string) => void | Promise<void> = () => {};
  /** every version of every file there has been */
  history: { path: string; text: string }[] = [];

  async read<T>(path: string) {
    await this.before('read', path);
    this.ops.read++;
    const f = this.files.get(path);
    return f ? { data: JSON.parse(f.text) as T, mark: String(f.mark) } : null;
  }
  async glance<T>(path: string) {
    await this.before('glance', path);
    this.ops.glance++;
    const text = this.lag ? this.behind.get(path) : this.files.get(path)?.text;
    return text === undefined ? null : (JSON.parse(text) as T);
  }
  async swap(path: string, data: unknown, mark: string | null) {
    await this.before('swap', path);
    this.ops.swap++;
    const f = this.files.get(path);
    if (mark === null ? !!f : !f || String(f.mark) !== mark) return false;
    this.put(path, JSON.stringify(data));
    const made = String(this.n);
    await this.after('swap', path);
    return made;
  }
  async list(prefix: string) {
    await this.before('list', prefix);
    this.ops.list++;
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  /** puts a file there as if it had always been (for the tests to set a scene) */
  put(path: string, text: string) {
    this.files.set(path, { text, mark: ++this.n });
    this.history.push({ path, text });
    if (!this.lag) this.behind.set(path, text);
  }
}
