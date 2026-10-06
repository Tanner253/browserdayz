# ZONA — browser survival shooter

A DayZ-style multiplayer survival FPS that runs in the browser: one shared world, loot economy, grid inventory with clothing and bags, ballistics, PvP with hit zones, lootable bodies, stash crates.

You spawn on the edge of the map with bare hands, something to eat and something to drink. The best loot is in the middle: the police station in Zelenaya Dolina has guns, ammunition and attachments. Other survivors can kill you and take everything you carry.

## Run it locally

Needs Node 20 or newer.

```bash
npm install
```

Game server (world, loot, PvP) on port 8080:

```bash
npm run server
```

Client with hot reload on port 5173 (it talks to the server through a dev proxy):

```bash
npm run dev
```

Open http://localhost:5173. Open it in a second browser profile, or add `?key=anything` to the address, to be a second player on the same machine.

With no server running the game still works: it falls back to a single-player world saved in the browser, with training dummies to shoot at.

## Deploy to Render

The repository has a Render Blueprint (`render.yaml`): one web service that serves the built client and runs the WebSocket game server on the same URL.

1. Render dashboard → **New** → **Blueprint** → pick this repository.
2. Accept the defaults. Render runs `npm ci --include=dev && npm run build`, then `npm start`.
3. Share the service URL. Everyone who opens it lands in the same world.

Things to know about the free plan:

- The service sleeps after about 15 minutes with no traffic; the first visitor then waits for it to wake up.
- There is no persistent disk. The world (loot, stashes) is saved to `data/world.json` every minute and on shutdown, but that file is lost whenever the service restarts or redeploys. Add a Render disk mounted at `/opt/render/project/src/data` (or set `DATA_DIR`) to keep stashes across restarts.
- Characters are remembered by the server for 30 minutes after you disconnect, in memory.

The client can also be hosted on its own (Vercel): `vercel.json` builds it with `VITE_SERVER_URL=https://browserdayz.onrender.com`, so that copy plays on the Render server. If the Render service is asleep the game waits for it to wake up before joining. Change the URL there if the server moves.

## Controls

| Key | Action |
| --- | --- |
| WASD · Shift · Alt | move · sprint · walk |
| C · Space · Q / E | crouch · jump · lean |
| LMB · RMB | fire / punch · aim / raise fists |
| R · X | reload · holster (bare hands) |
| 1 2 3 4 · wheel | primary · secondary · pistol · melee |
| 5 6 7 8 | quick keys: eat, drink, bandage (hover an item in the inventory and press the number to assign) |
| F · G | take / open doors / search crates and bodies · pack up an empty stash |
| Tab | inventory (right-click an item for everything it can do) |
| V | third person |
| Esc | release the mouse / pause |
| F3 | performance overlay |

## How it is built

- **Client**: TypeScript, three.js (WebGL, cascaded shadows, post-processing), Rapier physics, Vite. Assets are CC0 from Poly Haven, processed by `npm run assets`.
- **Server**: Node + `ws`, run with `tsx` (`server/`). It imports the same world generator and item / economy code as the client (`src/sim`, `src/world`), so loot points, crates and spawn points line up without sending the map.
- **Who decides what** (`src/net/protocol.ts`):
  - the server owns the loot economy, who picked an item up first, what is inside crates, stashes and bodies, door states, how much a hit hurts, who is alive and where you spawn;
  - the client owns its own movement, aim and inventory, and whether its shot hit.

  That split keeps the server light enough for a free instance, and it means a modified client could cheat (teleport, invent items). Good for playing with friends; a public server would need server-side movement and inventory checks.

## Project layout

```
server/          game server (http + websocket)
src/sim/         items, inventory, loot economy, combat rules (shared with the server)
src/net/         wire protocol and client connection
src/world/       world generation, terrain, buildings, vegetation
src/game/        player, weapons, avatars, loot, the game loop
src/ui/          HUD and inventory screen
scripts/         asset pipeline
```
