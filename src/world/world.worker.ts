// Only plain world data crosses the worker boundary; its typed-array storage is transferred once.
import { generateWorld } from './worldgen';
import { cachedWorld } from './world-cache';
import { withCaves } from './caves-carved';

const endpoint = globalThis as unknown as {
  onmessage: (() => void) | null;
  postMessage: (value: unknown, transfer?: ArrayBuffer[]) => void;
};

endpoint.onmessage = () => { void make(); };

async function make() {
  try {
    // Vite's content-hashed worker URL changes with the generator and its dependencies. Development never caches.
    const key = import.meta.env.PROD && typeof location !== 'undefined' ? location.href : undefined;
    const world = await cachedWorld(key, () => withCaves(generateWorld()));
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
