import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

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
  plugins: [
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
    // `npm run server` runs the game server on :8080; the dev page talks to it through here
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true }, '/healthz': 'http://localhost:8080' },
  },
  // (Written for the browsers of the last few years, and for an iPhone back to iOS 15: built for 2022's language
  // alone, the game had six things in it that an iPhone older than iOS 16.4 cannot read, and on one of those it
  // was a loading screen that never moved.)
  build: { target: ['es2022', 'safari15'], chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
