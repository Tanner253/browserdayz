// The wager arena's own server (2026-10-14): a service of its own, apart from the game server (the owner: "i will
// deploy this new game server to render via github ... make sure its seperate from our current build for zona").
// It is deployed by arena/render.yaml and run as `node --import tsx arena/server.ts`; locally the launch entry
// `zona-arena-local` runs it on 8090 (the dev page sends /arena there). It talks to nothing else: no site, no payouts,
// no keys. It makes the map the game makes (the same seed, so the same fort) and serves:
//   GET /healthz          that it is up, and its protocol
//   GET /arena/lobbies    the wagers open and being fought, for the menu's list
//   ws  /arena            a game in a wager (arena/match.ts)
import http from 'node:http';
import { generateWorld } from '../src/world/worldgen';
import { PROTOCOL } from '../src/net/protocol';
import { arenaList, arenaUpgrade, startArena } from './match';

const PORT = Number(process.env.PORT) || 8090;
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

/**
 * Whose pages may open a wager: on Render, the game's own (zonapvp.fun, and its Vercel builds) and whatever ORIGINS
 * adds (hosts, comma between; "off" lets anybody); anywhere else (a development machine, a test), anybody.
 */
const ORIGINS = (() => {
  const set = process.env.ORIGINS ?? '';
  if (set === 'off' || (!process.env.RENDER && !set)) return null;
  return new Set(['www.zonapvp.fun', 'zonapvp.fun', ...set.split(',').map((s) => s.trim()).filter(Boolean)]);
})();
const fromOurPage = (req: http.IncomingMessage) => {
  if (!ORIGINS) return true;
  let host = '';
  try {
    host = new URL(String(req.headers.origin ?? '')).host;
  } catch {
    return false;
  }
  return ORIGINS.has(host) || /^dayz-web-slice[\w-]*\.vercel\.app$/.test(host);
};

const t0 = Date.now();
log('making the map…');
const world = generateWorld();
log(`the map is made in ${Date.now() - t0} ms`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const head = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  if (url.pathname === '/healthz') return void res.writeHead(200, head).end(JSON.stringify({ ok: true, protocol: PROTOCOL, lobbies: arenaList().length }));
  if (url.pathname === '/arena/lobbies') return void res.writeHead(200, head).end(JSON.stringify({ lobbies: arenaList() }));
  res.writeHead(404, head).end('{}');
});

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path !== '/arena' || !fromOurPage(req)) return void socket.destroy();
  arenaUpgrade(req, socket, head as Buffer);
});

await startArena(world);
server.listen(PORT, () => log(`the arena is listening on :${PORT}`));
