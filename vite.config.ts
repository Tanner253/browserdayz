import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { physicsWasm } from './scripts/physics-wasm.ts';

/**
 * Which version of each file under public/assets this is, by what is in it: assets/versions.json, made as the site
 * is built (and worked out afresh for the dev page whenever a file changes). The game puts a file's version in the
 * address it fetches it by (src/core/assets.ts), and the browser keeps a file for a year under its address: so
 * what has not changed since somebody last played is not fetched again, and what has changed is.
 */
function assetVersions(): Plugin {
  const root = path.resolve('public/assets');
  const known = new Map<string, [number, number, string]>();
  const all = () => {
    const out: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, f.name);
        if (f.isDirectory()) {
          walk(file);
          continue;
        }
        const st = fs.statSync(file);
        let was = known.get(file);
        if (!was || was[0] !== st.size || was[1] !== st.mtimeMs) known.set(file, (was = [st.size, st.mtimeMs, createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10)]));
        out[`assets/${path.relative(root, file).split(path.sep).join('/')}`] = was[2];
      }
    };
    walk(root);
    return JSON.stringify(out);
  };
  return {
    name: 'asset-versions',
    configureServer(server) {
      server.middlewares.use('/assets/versions.json', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-cache');
        res.end(all());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'assets/versions.json', source: all() });
    },
  };
}

/**
 * version.json: which version of the wire this build of the site speaks (PROTOCOL in src/net/protocol.ts). A page
 * that the server has turned away for its version asks the site for this, to tell whether it is itself the old
 * one (and is to be loaded again) or the server is (and is to be waited for): see the game's `start`. And where
 * the game server is (VITE_SERVER_URL), for a page of the site that is not the game: the changelog asks it for its
 * hearts and comments.
 */
function siteVersion(): Plugin {
  const said = () => JSON.stringify({ protocol: Number(/export const PROTOCOL = (\d+)/.exec(fs.readFileSync(path.resolve('src/net/protocol.ts'), 'utf8'))?.[1]), server: (process.env.VITE_SERVER_URL ?? '').replace(/\/ws$/, '').replace(/\/$/, '') });
  return {
    name: 'site-version',
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(said());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: said() });
    },
  };
}

export default defineConfig({
  // (when this build of the site was made: the door says how long ago, "last updated 2 h ago", see src/ui/door.ts)
  define: { __BUILT__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    // (the physics' engine shipped as a file of its own, not written into the script: cached compiled by the browser)
    physicsWasm(),
    assetVersions(),
    siteVersion(),
    {
      // The site's own news (api/updates.ts) is a function of the site, which the dev page has none of: here it
      // is run in place, so the menu shows the same posts at a desk as it does live. (Nothing else under /api is:
      // the rest is the payouts, and is not for running from a desk.)
      name: 'updates-at-a-desk',
      configureServer(server) {
        // (and the changelog is a page of its own in public/, which the dev page serves by its file's name only)
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/changelog' || req.url === '/changelog/') req.url = '/changelog/index.html';
          next();
        });
        // The store (api/store.ts) runs here too, so that it can be bought from at a desk: its book a file in
        // data/local-store/ (not the site's), the chain read on mainnet as live, an admin's orders asked of the local
        // game server. data/local-store/desk.json: {"wallet": the store's, "at": a moment (ms) the desk's clock stands
        // at, "rate": dollars a SOL}: a past payment on mainnet can be bought with as if it had just been made.
        server.middlewares.use('/api/store', (req, res) => {
          void (async () => {
            try {
              const dir = path.resolve('data/local-store');
              const { MemoryStore } = (await server.ssrLoadModule('/api/_lib/store.ts')) as typeof import('./api/_lib/store');
              const { storeApi } = (await server.ssrLoadModule('/api/store.ts')) as typeof import('./api/store');
              const book = path.join(dir, 'book.json'), mem = new MemoryStore();
              if (fs.existsSync(book)) mem.put('store/book.json', fs.readFileSync(book, 'utf8'));
              mem.after = () => (fs.mkdirSync(dir, { recursive: true }), fs.writeFileSync(book, mem.files.get('store/book.json')!.text));
              const desk = (fs.existsSync(path.join(dir, 'desk.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'desk.json'), 'utf8')) : {}) as { wallet?: string; at?: number; rate?: number };
              const chunks: Buffer[] = [];
              for await (const c of req) chunks.push(c as Buffer);
              const r = await storeApi(new Request(`http://localhost/api/store${req.url === '/' ? '' : req.url}`, { method: req.method, headers: { 'x-forwarded-for': '127.0.0.1' }, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) }), {
                store: mem, env: { STORE_WALLET: process.env.STORE_WALLET ?? desk.wallet ?? '' }, game: 'http://127.0.0.1:8080',
                ...(desk.at ? { now: () => desk.at! } : {}), ...(desk.rate ? { rate: async () => desk.rate! } : {}),
              });
              res.statusCode = r.status;
              res.setHeader('content-type', 'application/json');
              res.end(await r.text());
            } catch (e) {
              res.statusCode = 500;
              res.end(String(e));
            }
          })();
        });
        server.middlewares.use('/api/updates', (_req, res) => {
          void (async () => {
            try {
              const { GET } = (await server.ssrLoadModule('/api/updates.ts')) as { GET: () => Promise<Response> };
              const r = await GET();
              res.statusCode = r.status;
              res.setHeader('content-type', 'application/json');
              res.end(await r.text());
            } catch (e) {
              res.statusCode = 500;
              res.end(String(e));
            }
          })();
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    // (the page may sample its own processor time, `new Profiler(...)`: the frame's costs found in the real game, not headless)
    headers: { 'Document-Policy': 'js-profiling' },
    // `npm run server` runs the game server on :8080; the dev page talks to it through here
    // (and the arena's list and matches to the local arena on :8090, or to the one ARENA_TARGET names, as the site's own
    // page would reach it; the Arena's page itself, /arena, is the game's page)
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/healthz': 'http://localhost:8080',
      // (only the arena server's own two: its socket, /arena?..., and its list, /arena/lobbies. Not what else is under
      // /arena: arena/rules.ts is the game's own code, served here, and forwarded it stopped every page loading)
      '^/arena(/lobbies)?(\\?.*)?$': {
        target: process.env.ARENA_TARGET ?? 'http://localhost:8090',
        ws: true,
        changeOrigin: !!process.env.ARENA_TARGET,
        ...(process.env.ARENA_TARGET ? { headers: { origin: 'https://www.zonapvp.fun' } } : {}),
        bypass: (req) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined),
      },
      // (the battle royale's three, on the same arena server: its page itself, /br, is the game's page)
      // (a pattern's `\\?` is the question mark itself: written `\?` in a string it is a bare `?`, and `(?.*)` is no
      // pattern at all, so a dev server started afresh would not start)
      '^/(battleroyale|br)/(lobbies|next|board)(\\?.*)?$': { target: process.env.ARENA_TARGET ?? 'http://localhost:8090', changeOrigin: !!process.env.ARENA_TARGET },
      // (and its game's socket, /battleroyale?...; the page itself, /battleroyale, is the game's page)
      '^/battleroyale(\\?.*)?$': {
        target: process.env.ARENA_TARGET ?? 'http://localhost:8090',
        ws: true,
        changeOrigin: !!process.env.ARENA_TARGET,
        bypass: (req) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined),
      },
    },
  },
  // (Written for the browsers of the last few years, and for an iPhone back to iOS 15: built for 2022's language
  // alone, the game had six things in it that an iPhone older than iOS 16.4 cannot read, and on one of those it
  // was a loading screen that never moved.)
  build: { target: ['es2022', 'safari15'], chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
