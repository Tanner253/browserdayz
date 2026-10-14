# ZONA: what every agent working here must know

Read this whole file before touching anything, then `HANDOFF.md` (where the work stands right now). The long history
of decisions is in the memory notes (`MEMORY.md` and its files); read the ones that touch your task. The notes are
history: some are out of date. WHERE A NOTE DISAGREES WITH THIS FILE OR WITH `HANDOFF.md`, THESE TWO WIN (for example older
notes describe other ways to deploy, one lane at a time, or publishing the site freely: all superseded).

## The project
ZONA is a browser PvP survival shooter in the manner of DayZ, where a dog tag taken from a kill and held pays SOL.
- Site and serverless API: Vercel project `dayz-web-slice`, https://www.zonapvp.fun (`/version.json` gives the protocol; `/changelog/`, `/payouts`).
- Game server: Render, https://browserdayz.onrender.com (`/healthz`, websocket `/ws`). **A push to `main` redeploys it.**
- Repo: https://github.com/Tanner253/browserdayz. `main` is what is live; `next` is the working branch; `site-live` and `hotfix` mark what the site and server were last deployed from.
- Stack: Vite + TypeScript + three.js + Rapier (character controller), a Node `ws` server that shares `src/sim` with the game, Vercel functions in `api/`.

## Where things are
- `src/game/` the game in the browser (`game.ts` is the main loop and wiring: very large), `src/world/` the world and how it is drawn (`worldgen.ts` makes the map: very large; `terrain.ts`, `snow.ts`, `seat.ts`, `vegetation.ts`, `castle*.ts` the mountain fort), `src/sim/` rules shared by game and server (items, economy and loot, `castle.ts` the fort's plan, grenades, fires, infected), `src/ui/`, `src/net/protocol.ts` (`PROTOCOL`).
- `server/index.ts` the game server (very large). `api/` payouts (`api/_lib/payouts.ts`), cash-ins, admin, saves.
- `test/*.test.ts` plain scripts run with tsx. `scripts/` deploy, cards, icons, films. `src/trailer/` + `scripts/film.mjs` the films.
- `public/changelog/` the changelog page and its pictures; `marketing/` cards (`node scripts/card.mjs <name>`).
- `assets-src/` (git-ignored, about 10 GB): downloaded packs and model sources. NEVER delete it; it exists only on this machine.

## Running it
- Dev page: `npm run dev` (port 5173; launch entry `zona-dev`). Local game server: launch entry `zona-server-local` ONLY (port 8080; `.env.local-server` sets `LOCAL_ADMIN=1`, so everybody on it is an admin, and `SITE_URL=http://127.0.0.1:9`, an address where nothing answers). The page's `/ws` is proxied to 8080. Restart the local server after any change to the ground or the server, or page and server disagree.
- NEVER start a game server any other way on this machine (`npm run server`, `npm run dev:server`, `npm start`, `tsx server/index.ts` without that env file): with no `SITE_URL` it talks to the LIVE site and calls the live `/api/tick` within 30 seconds, which pays real SOL. Never empty or delete `SITE_URL` in `.env.local-server` either (an empty one also switches local admin off).
- Dev switches on the page: `?at=fort`, `?at=x,z`, `?admin`, `?kit=guns`.
- Headless game: `node assets-src/_wf/me/play.mjs <script.js> <out dir> [w h] [address]` with `PLAY_PORT` (Chrome's own debugging port: never 5173, one per lane) and `PLAY_PRE=assets-src/_wf/me/still.js` (stops the page reloading when files are saved). It needs the dev page running on 5173. `PLAY_GL=swiftshader` draws on the processor instead of the card (slow, but it leaves the card alone). To play offline, pass the address `http://localhost:5173/?server=http://127.0.0.1:9`.
- The owner may be playing on this machine at any time: `curl -s localhost:8080/healthz` (`players`) for the local server, and a busy card in `nvidia-smi` with no lane running means they are in a game.

## Checking work
- Type-check three ways and READ THE EXIT CODE: `npx tsc --noEmit; echo $?`, `npx tsc --noEmit -p tsconfig.server.json; echo $?`, `npx tsc --noEmit -p tsconfig.api.json; echo $?`. (A `| head` once hid an error that broke a Vercel build.)
- Tests: `npx tsx test/<name>.test.ts`. Never run two tests that start a server at once (they clash on ports). The whole suite: `sh $TEMP/zp/review/suite.sh <repo>` runs four at a time and then runs whatever failed again alone (only the second result counts). NEVER run `test/devnet.test.ts` (it uses the public Solana devnet faucet and sends transactions).
- Anything seen must be looked at in the real game before it is called done (stumps set on the ground and gaps at stair heads went live because nobody looked). Things set on the ground are judged where they meet it.

## Deploying (only when the owner says so; when they say so, do it at once)
- ONLY `node scripts/deploy.mjs` (`npm run deploy` is the same): it publishes the site, tells the live server a deploy is coming and waits for it to save, then pushes `main`. `--site` for the site alone, `--server` for the server alone (after a site deploy that stopped half way), `--dry` to rehearse, `--unsaved` only with the owner's word. It publishes HEAD of the branch checked out. Never push `main` by hand. Site-only deploys too need the owner's word.
- After a deploy, move the local markers yourself: `git branch -f main HEAD`, `git branch -f site-live HEAD`, `git branch -f hotfix HEAD` (the script moves only the remote `main`).
- Before: the tree committed and type-checked; `git merge-base --is-ancestor main HEAD` (if not, merge `main` in first: a non-fast-forward stopped one release); `PROTOCOL` raised if the wire format changed; `WORLD_REV` (server/index.ts) and `LOOT_REV` (src/game/game.ts) raised if loot places or the ground changed (everybody is then set down afresh at the map's edge with their gear: tell the owner); `server/restart-note.json` (the reason players see); a changelog entry with pictures (every entry has them; every claim checkable).
- After: `/healthz` (`protocol`, `kept`, `saved`), `/version.json`, and for payouts `/api/cashins?format=status`.
- The app's own safety check may refuse a deploy command; then give the owner the command to run.

## Money, keys and accounts: never break these
- Never enter, type, paste, ask for or log the treasury's private key or `ADMIN_PASSWORD`; the owner sets them in Vercel. Never pull env files (`vercel env pull`); `vercel env ls` (names only) is fine. Do not change the owner's env vars unasked.
- Never send a transaction and never call the live `/api/tick` (it claims and pays real SOL). Safe reads: `/api/cashins?format=status` and `?format=json`, and `npx tsx scripts/treasury.ts` (a dry run). Never open the live `/payouts` page in a browser that runs its script (it calls `/api/tick`); `curl` of it is fine. Payout rule changes need the owner's word and a start moment.
- The payouts store has a small monthly write budget: no polling, no frequent writes.
- Never join the live game server to test (use `assets-src/_wf/me/ws-probe.mjs` / `captcha-probe.mjs`); never solve or tick a CAPTCHA; do not act in the owner's Render, Cloudflare or Canva accounts (no Canva at all).

## Traps that have cost real time
- NEVER run `npm run assets`: it wrecks `public/assets/manifest.json`. Bring a model in as the last single model was (`node scripts/packs.mjs <id>`, `tier-now.mjs`, `lods.mjs`).
- NEVER `git worktree remove` a copy that has a `node_modules` junction: it deleted the real packages once. Order: `cmd //c "rmdir <wt>\node_modules"`, check it is gone, `rm -rf <wt>`, `git worktree prune`.
- Bash heredocs mangle backslashes and apostrophes: write scripts with the Write tool; run Python with `python -I`; Python's text mode writes CRLF on this machine: open files with `newline=''`.
- The graphics card (laptop RTX 3070 Ti, 8 GB) throttles at 88 C. Before any headless game read `nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader` AS ITS OWN COMMAND and do not launch at 70% use or 84 C. Keep the Browser pane closed while the owner plays; never start the game's sound in the pane.
- When the machine is slow, look for leftover processes of finished work (old `tsx` scripts, extra `vite` servers): one ran five hours unseen.
- `git index.lock` can appear while several hands work: retry.

## How the owner works (use they/them)
- Short TL;DRs, not documents. Pictures of work as it goes (send them), and a plan picture before anything big is built: wait for their yes on a design, not on every step.
- Do not over-test. When they say deploy, deploy.
- Do not use Workflows unless they ask for one in that same message.
- Several lanes (sub-agents) at once are fine when each owns separate files and one builder owns each area; brief each from a file under `%TEMP%/zp/briefs/`. A lane that has finished a round is near the end of its room: start the next round with a fresh one and the last one's notes.
- Keep what they loved: change only what was asked, and prove nothing else was lost.
- When they ask for one change (turn it), make that change and solve what it costs; do not offer a different change because it is cheaper.
- Real, downloaded models only, never shapes made by hand for real things; never lower a model's quality. Poly Haven (CC0) may be used freely; any other site needs their yes; nothing ripped or decompiled.
- DayZ is the rule for anything they have not said.
- Every number on a page or in a film must be true and checkable; there is no player count anywhere.

## Code style
Comments are prose that say WHY, with the owner's words quoted where they are the reason. Keep them tight. Match the file you are in.
