# The wager arena

A server of its own for wager matches: team against team (1v1 to 3v3) in rounds, as CS:GO has them, on small maps
cut from the open world. The first map is the fort (Orlinoye), a 100 m square round it. It holds no keys and talks
to nothing but the games that come to it. No money moves yet: the stake is shown, nothing is paid.

- `server.ts`: the entry. Makes the map (the game's own seed, so the same fort), and serves `GET /healthz`,
  `GET /arena/lobbies` (the menu's list) and the websocket `/arena`.
- `match.ts`: lobbies, matches and rounds. **The server decides every hit and every health point**: it traces each
  shot itself through the fort's walls (a physics world of its own) to the others as they stood when it was fired.
- `render.yaml`: its Render Blueprint, apart from the game server's (the `render.yaml` at the repository's root).

What both sides share is in `src/`: the rules (`src/sim/arena.ts`), the protocol (`src/net/protocol.ts`, the same
`PROTOCOL` as the game server), and the map (`src/world/`). The game finds the arena at `?arena=` on the page,
else `VITE_ARENA_URL` (set in Vercel, Production, and read when the site is built), else `https://zona-arena-1.onrender.com` (the service the owner made).

## Run it locally
The launch entry `zona-arena-local` (port 8090), beside `zona-dev`: the dev page sends `/arena` to it. Open the menu's
Wagers tab; a second player needs a second browser or a private window (one browser is one player).

## Deploy
1. Render: New, Blueprint, this repository, Blueprint Path `arena/render.yaml` (or a Web Service by hand with what
   that file says: no root directory, build `npm ci --include=dev`, start `node --import tsx arena/server.ts`, health
   check `/healthz`, `NODE_VERSION` 22). It deploys from `main` (a push to `main` is made only by
   `node scripts/deploy.mjs`, which also publishes the site).
2. Vercel: `VITE_ARENA_URL` = the service's `.onrender.com` address (Production; set 2026-10-14), then deploy the
   site. Nothing else is set anywhere: the arena holds no keys (`ORIGINS` only to let in pages from elsewhere).
On the free plan it sleeps after 15 minutes with nobody on it; the first page to ask wakes it (about a minute).

Environment: `PORT` (Render sets it; 8090 otherwise), `ORIGINS` (hosts whose pages may connect, comma between, on
top of zonapvp.fun and its Vercel builds; `off` for anybody).

Test: `npx tsx test/arena.test.ts` (a match played to three, and practice).
