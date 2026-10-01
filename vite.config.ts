import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    // `npm run server` runs the game server on :8080; the dev page talks to it through here
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true }, '/healthz': 'http://localhost:8080' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
