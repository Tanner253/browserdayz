// Ship Rapier's exact binary separately, retaining its compatibility API for the client and server.
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

export function extractPhysicsWasm(code: string, base = '/') {
  const embedded = /[\w$.]+\.toByteArray\((["'][A-Za-z0-9+/=]{100000,}["'])\)\.buffer/.exec(code);
  if (!embedded) throw new Error('Rapier compatibility package changed: embedded WASM could not be located.');
  const bytes = Buffer.from(embedded[1].slice(1, -1), 'base64');
  if (!bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) throw new Error('Rapier payload is not WebAssembly.');
  const fileName = `assets/rapier-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.wasm`;
  return { bytes, fileName, code: code.replace(embedded[0], `fetch(${JSON.stringify(`${base}${fileName}`)})`) };
}

export function physicsWasm(): Plugin {
  let base = '/', production = false;
  let binary: ReturnType<typeof extractPhysicsWasm> | undefined;
  return {
    name: 'physics-binary',
    enforce: 'pre',
    configResolved(config) { base = config.base; production = config.command === 'build'; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!binary || req.url?.split('?')[0] !== `${base}${binary.fileName}`) return next();
        res.setHeader('content-type', 'application/wasm');
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        res.end(binary.bytes);
      });
    },
    transform(code, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/@dimforge/rapier3d-compat/dist/rapier.mjs')) return;
      binary = extractPhysicsWasm(code, base);
      if (production) this.emitFile({ type: 'asset', fileName: binary.fileName, source: binary.bytes });
      return { code: binary.code, map: null };
    },
  };
}
