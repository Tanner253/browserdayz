// The wager arena's own server (2026-10-14): a service of its own, apart from the game server (the owner: "i will
// deploy this new game server to render via github ... make sure its seperate from our current build for zona").
// It is deployed by arena/render.yaml and run as `node --import tsx arena/server.ts`; locally the launch entry
// `zona-arena-local` runs it on 8090 (the dev page sends /arena there). It talks to nothing else: no site, no payouts,
// no keys. It makes the map the game makes (the same seed, so the same fort) and serves:
//   GET /healthz          that it is up, and its protocol
//   GET /arena/lobbies    the wagers open and being fought, for the menu's list
//   ws  /arena            a game in a wager (arena/match.ts), or in the battle royale (?w=br: arena/br/match.ts)
//   GET /br/lobbies       the battle royale's open lobbies;  GET /br/next?size=  the map a page should be cut to
//   GET /br/board         the battle royale's board (wins, kills and the rest) and its last matches
import http from 'node:http';
import { generateWorld } from '../src/world/worldgen';
import { PROTOCOL } from '../src/net/protocol';
import { arenaList, arenaPlayers, arenaUpgrade, startArena } from './match';
import { brBoard, brList, brNext, brPlayers, startBr } from './br/match';
import { modeOfSize } from './br/rules';

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
  // (/status as well: see the game server's, which a blocklist's `||onrender.com/health` refused)
  if (url.pathname === '/healthz' || url.pathname === '/status') return void res.writeHead(200, head).end(JSON.stringify({ ok: true, protocol: PROTOCOL, lobbies: arenaList().length, players: arenaPlayers() + brPlayers(), br: { lobbies: brList().length, players: brPlayers() }, branch: process.env.RENDER_GIT_BRANCH ?? null, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null }));
  if (url.pathname === '/arena/lobbies') return void res.writeHead(200, head).end(JSON.stringify({ lobbies: arenaList() }));
  if (url.pathname === '/br/lobbies') return void res.writeHead(200, head).end(JSON.stringify({ lobbies: brList() }));
  if (url.pathname === '/br/next') return void res.writeHead(200, head).end(JSON.stringify({ map: brNext(modeOfSize(Number(url.searchParams.get('size')) || 1)) }));
  if (url.pathname === '/br/board') return void res.writeHead(200, head).end(JSON.stringify(brBoard()));
  res.writeHead(404, head).end('{}');
});

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path !== '/arena' || !fromOurPage(req)) return void socket.destroy();
  arenaUpgrade(req, socket, head as Buffer);
});

await startArena(world);
await startBr(world);
server.listen(PORT, () => log(`the arena is listening on :${PORT}`));
