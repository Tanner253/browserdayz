// Only plain world data crosses the worker boundary; its typed-array storage is transferred once.
import { generateWorld } from './worldgen';
import type { World } from './worldgen';
import { cachedWorld } from './world-cache';
import { withCaves } from './caves-carved';
import { looksWhole, unpackWorld } from './world-file';

const endpoint = globalThis as unknown as {
  onmessage: (() => void) | null;
  postMessage: (value: unknown, transfer?: ArrayBuffer[]) => void;
};

endpoint.onmessage = () => { void make(); };

/**
 * The map as the site was built with it: the file beside this worker, named after it (vite.config.ts `worldFile`), so
 * never the map of another build. Null where it cannot be had (a development page, an old browser, no network): the
 * map is then made here, as it always was.
 */
async function fetched(here: string): Promise<World | null> {
  try {
    if (typeof DecompressionStream !== 'function') return null;
    const res = await fetch(here.replace(/\.js(\?.*)?$/, '.bin'));
    if (!res.ok) return null;
    let bytes = new Uint8Array(await res.arrayBuffer());
    // (gzipped as it is kept; a host that unpacked it on the way has sent it plain)
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const world = unpackWorld(bytes);
    return looksWhole(world) ? world : null;
  } catch {
    return null;
  }
}

async function make() {
  try {
    // Vite's content-hashed worker URL changes with the generator and its dependencies. Development never caches.
    const key = import.meta.env.PROD && typeof location !== 'undefined' ? location.href : undefined;
    const world = (key && (await fetched(key))) || (await cachedWorld(key, () => withCaves(generateWorld())));
    const buffers = new Set<ArrayBuffer>();
    const seen = new Set<object>();
    const collect = (value: unknown) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (ArrayBuffer.isView(value)) buffers.add(value.buffer as ArrayBuffer);
      else for (const child of Object.values(value)) collect(child);
    };
    collect(world);
    endpoint.postMessage({ world }, [...buffers]);
  } catch (error) {
    endpoint.postMessage({ error: String(error) });
  }
}
