// The map is the same deterministic data on a worker; older browsers retain the staged path.
import type { World } from './worldgen';
import { generateWorldSoftly } from './worldgen/generate';

export async function loadWorld(): Promise<World> {
  let worker: Worker | undefined;
  try {
    worker = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' });
    return await new Promise<World>((resolve, reject) => {
      worker!.onmessage = (event: MessageEvent<{ world?: World; error?: string }>) => {
        if (event.data.world) resolve(event.data.world);
        else reject(new Error(event.data.error ?? 'world worker failed'));
      };
      worker!.onerror = (event) => { event.preventDefault(); reject(new Error(event.message)); };
      worker!.onmessageerror = () => reject(new Error('world data could not be transferred'));
      worker!.postMessage(null);
    });
  } catch (error) {
    console.warn('world worker unavailable; using staged generation', error);
    return generateWorldSoftly(() => new Promise((resolve) => setTimeout(resolve, 0)));
  } finally {
    worker?.terminate();
  }
}
