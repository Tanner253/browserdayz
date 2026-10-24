// The map is the same deterministic data on a worker; older browsers retain the staged path.
import type { World } from './worldgen';
import { generateWorldSoftly } from './worldgen/generate';
import { withCaves } from './caves-carved';

/** how the map was had (the built file, kept in this browser, made by the worker or by the page) and in how many seconds: said in the start's report */
export const mapFrom = { how: '', secs: 0 };

export async function loadWorld(): Promise<World> {
  let worker: Worker | undefined;
  const t0 = performance.now();
  const done = (how: string) => Object.assign(mapFrom, { how, secs: Math.round((performance.now() - t0) / 100) / 10 });
  try {
    worker = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' });
    return await new Promise<World>((resolve, reject) => {
      worker!.onmessage = (event: MessageEvent<{ world?: World; how?: string; error?: string }>) => {
        if (event.data.world) resolve((done(event.data.how ?? ''), event.data.world));
        else reject(new Error(event.data.error ?? 'world worker failed'));
      };
      worker!.onerror = (event) => { event.preventDefault(); reject(new Error(event.message)); };
      worker!.onmessageerror = () => reject(new Error('world data could not be transferred'));
      worker!.postMessage(null);
    });
  } catch (error) {
    console.warn('world worker unavailable; using staged generation', error);
    const world = withCaves(await generateWorldSoftly(() => new Promise((resolve) => setTimeout(resolve, 0))));
    done('page');
    return world;
  } finally {
    worker?.terminate();
  }
}
