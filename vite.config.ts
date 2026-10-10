import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      // The site's own news (api/updates.ts) is a function of the site, which the dev page has none of: here it
      // is run in place, so the menu shows the same posts at a desk as it does live. (Nothing else under /api is:
      // the rest is the payouts, and is not for running from a desk.)
      name: 'updates-at-a-desk',
      configureServer(server) {
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
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
