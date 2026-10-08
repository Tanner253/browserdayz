// Where the payout system keeps what it must not forget: small JSON files in Vercel Blob.
//
// Three things are asked of it, and each matters for a different reason:
//   create  a file that must not exist yet. Two workers that both try get one yes and one
//           no: this is what stops a tag being paid twice.
//   read    always the file as it is now, never a copy a cache has been holding.
//   swap    replace a file only if nobody has changed it since it was read: for the one
//           file that is rewritten (the book the payouts page is drawn from).

import { BlobPreconditionFailedError, get, list, put } from '@vercel/blob';

export interface Store {
  /** @returns false if there was already a file there (nothing is written) */
  create(path: string, data: unknown): Promise<boolean>;
  /** @returns the contents and a mark of this version for swap(), or null if there is no such file */
  read<T>(path: string): Promise<{ data: T; mark: string } | null>;
  /** @param mark from read(), or null for "there was no file" @returns false if somebody else got there first */
  swap(path: string, data: unknown, mark: string | null): Promise<boolean>;
  /** every path that begins with this (one call to the service per thousand: used sparingly) */
  list(prefix: string): Promise<string[]>;
}

const JSON_FILE = { access: 'public', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60 } as const;

export const blobStore: Store = {
  async create(path, data) {
    try {
      await put(path, JSON.stringify(data), { ...JSON_FILE, allowOverwrite: false });
      return true;
    } catch (e) {
      // refused because it is there already, or failed for some other reason? Only the first is a "no".
      if (await get(path, { access: 'public', useCache: false }).catch(() => null)) return false;
      throw e;
    }
  },
  async read<T>(path: string) {
    const r = await get(path, { access: 'public', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return { data: (await new Response(r.stream).json()) as T, mark: r.blob.etag };
  },
  async swap(path, data, mark) {
    if (mark === null) return this.create(path, data);
    try {
      await put(path, JSON.stringify(data), { ...JSON_FILE, allowOverwrite: true, ifMatch: mark });
      return true;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) return false;
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

/** The same promises, kept in memory: for the tests. */
export class MemoryStore implements Store {
  files = new Map<string, { text: string; mark: number }>();
  private n = 0;
  /** counts of what was asked, to see how much of the service's allowance a payout uses */
  ops = { create: 0, read: 0, swap: 0, list: 0 };
  /** called before every operation: a test can make one fail or wait here */
  before: (op: string, path: string) => void | Promise<void> = () => {};

  async create(path: string, data: unknown) {
    await this.before('create', path);
    this.ops.create++;
    if (this.files.has(path)) return false;
    this.files.set(path, { text: JSON.stringify(data), mark: ++this.n });
    return true;
  }
  async read<T>(path: string) {
    await this.before('read', path);
    this.ops.read++;
    const f = this.files.get(path);
    return f ? { data: JSON.parse(f.text) as T, mark: String(f.mark) } : null;
  }
  async swap(path: string, data: unknown, mark: string | null) {
    await this.before('swap', path);
    this.ops.swap++;
    const f = this.files.get(path);
    if (mark === null ? !!f : !f || String(f.mark) !== mark) return false;
    this.files.set(path, { text: JSON.stringify(data), mark: ++this.n });
    return true;
  }
  async list(prefix: string) {
    await this.before('list', prefix);
    this.ops.list++;
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}
