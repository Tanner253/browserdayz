# ZONA: what every agent working here must know

Read this whole file before touching anything, then `docs/HANDOFF.md` (where the work stands right now). The long history
of decisions is in the memory notes (`MEMORY.md` and its files); read the ones that touch your task. The notes are
history: some are out of date. WHERE A NOTE DISAGREES WITH THIS FILE OR WITH `docs/HANDOFF.md`, THESE TWO WIN (for example older
notes describe other ways to deploy, one lane at a time, or publishing the site freely: all superseded).

## The project
ZONA is a browser PvP survival shooter in the manner of DayZ, where a dog tag taken from a kill and held pays SOL.
- Site and serverless API: Vercel project `dayz-web-slice`, https://www.zonapvp.fun (`/version.json` gives the protocol; `/changelog/`, `/payouts`).
- Game server: Render, https://browserdayz.onrender.com (`/healthz`, websocket `/ws`). **A push to `main` redeploys it.**
- Repo: https://github.com/Tanner253/browserdayz. `main` is what is live; `battle-royale` is the working branch (the name is historical: it holds everything; `next` is old); `site-live` and `hotfix` mark what the site and server were last deployed from.
- Stack: Vite + TypeScript + three.js + Rapier (character controller), a Node `ws` server that shares `src/sim` with the game, Vercel functions in `api/`.

## Where things are
`docs/ARCHITECTURE.md` is the map: every file, its size and what it is (`node scripts/architecture.mjs` rebuilds it; do so after adding or moving a file). Look there before searching the tree.
- `src/game/` the game in the browser (`game.ts` the Game class: its fields, its constructor, and a list of which file in `src/game/game/` each of its methods is in), `src/world/` the world and how it is drawn (`worldgen.ts` makes the map, its parts in `src/world/worldgen/`: `generate.ts` is one long function with an index of its stages at its head; `terrain.ts`, `snow.ts`, `seat.ts`, `vegetation.ts`, `castle*.ts` the mountain fort), `src/sim/` rules shared by game and server (items, economy and loot, `castle.ts` the fort's plan, grenades, fires, infected), `src/ui/`, `src/net/protocol.ts` (`PROTOCOL`).
- `server/index.ts` the game server as it starts (what it does at start-up, in order; the world state; the loops; http and ws), its parts beside it in `server/` (`handle.ts` is every message a player sends, `admin.ts` every admin command). `api/` payouts (`api/_lib/payouts.ts`), cash-ins, admin, saves.
- `test/*.test.ts` plain scripts run with tsx. `scripts/` deploy, cards, icons, films. `src/trailer/` + `scripts/film.mjs` the films; their stage page and clock are in `tools/` (`tools/trailer.html`, takes in `tools/trailer/out`), beside the other dev pages (`tools/viewer.html`, `tools/poster.html`, `tools/reel.html`). `docs/` the admin guide, this map and the handoff.
- `public/changelog/` the changelog page and its pictures; `marketing/` cards (`node scripts/card.mjs <name>`).
- `progress/` (git-excluded, kept for the story, the owner 2026-10-15: "just for us and our story"): every plan, design picture and picture of work as it goes is saved here, never only in a scratch folder. Plan pages stay `marketing/plan-*.html` -> `zona-plan-*.png` (also excluded) so the card tool renders them.
- `assets-src/` (git-ignored, about 10 GB): downloaded packs and model sources. NEVER delete it; it exists only on this machine.

## Running it
- Dev page: `npm run dev` (port 5173; launch entry `zona-dev`). Local game server: launch entry `zona-server-local` ONLY (port 8080; `.env.local-server` sets `LOCAL_ADMIN=1`, so everybody on it is an admin, and `SITE_URL=http://127.0.0.1:9`, an address where nothing answers). The page's `/ws` is proxied to 8080. Restart the local server after any change to the ground or the server, or page and server disagree.
- NEVER start a game server any other way on this machine (`npm run server`, `npm run dev:server`, `npm start`, `tsx server/index.ts` without that env file): with no `SITE_URL` it talks to the LIVE site and calls the live `/api/tick` within 30 seconds, which pays real SOL. Never empty or delete `SITE_URL` in `.env.local-server` either (an empty one also switches local admin off).
- Dev switches on the page: `?at=fort`, `?at=x,z`, `?admin`, `?kit=guns`.
- Headless game: `node assets-src/_wf/me/play.mjs <script.js> <out dir> [w h] [address]` with `PLAY_PORT` (Chrome's own debugging port: never 5173, one per lane) and `PLAY_PRE=assets-src/_wf/me/still.js` (stops the page reloading when files are saved). It needs the dev page running on 5173. `PLAY_GL=swiftshader` draws on the processor instead of the card (slow, but it leaves the card alone). To play offline, pass the address `http://localhost:5173/?server=http://127.0.0.1:9`. One run on the card at a time, across lanes (`scripts/card-lock.mjs`; films and stills wait too): `waiting for the graphics card` means queued, not stuck. `PLAY_LIGHT=1` for a check that judges no picture (640×360, lowest settings); `PLAY_LOCK=0` only to run two at once on purpose.
- The owner may be playing on this machine at any time: `curl -s localhost:8080/healthz` (`players`) for the local server, and a busy card in `nvidia-smi` with no lane running means they are in a game.

## Checking work
- Type-check and READ THE EXIT CODE: `node scripts/typecheck.mjs; echo $?` (game, server and api at once, each remembering its last run: about a second after a small change, against 46 cold under load). (A `| head` once hid an error that broke a Vercel build.)
- Fast, lean development (the owner, 2026-10-24: "no usage wasted with junk testing, built optimized first so less time needs to be spent testing, we want fast efficient development. the agents should build and verify their work quickly, then send it up to you to evaluate then to me if it gets through your sniff test and quality testing"; "sandbox should make deliverig faster for agents. dont need to run long test suites"). Build it right and cheap the first time; check it in the sandbox and with the one or two tests that cover what changed; then send it to the navigator, who judges it before the owner sees it. A session never runs the whole suite: the navigator runs it once, before a release.
- Work on without stopping to ask (the owner, 2026-10-25: "do not stop or ask me for permission to run mcp ocmmands or anything"); the one limit is deploying (below). Commit small and often ("commit often").
- The cleanup catalog (the owner, 2026-10-25: "keep a catalog of what is being replaced and what needs to be cleaned and scruibbbed from the codebase so we dont have speghetti code bloat after the fact"): every path keeps `docs/cleanup/<path>.md`, each thing replaced and each file, function, model or asset now dead. The navigator deletes what is listed before a release.
- Tests: `npx tsx test/<name>.test.ts`. The whole suite (the navigator's, before a release): `node scripts/test-all.mjs` (eight at a time; it refuses to start if two test files use one port, so give a new test ports of its own; whatever fails is run again alone and only that second result counts). NEVER run `test/devnet.test.ts` (it uses the public Solana devnet faucet and sends transactions).
- A change meant to change nothing (moving code, tightening comments): `npx tsx scripts/split/fingerprint.ts <file.json>` before (writes the world's prints) and after (compares: generateWorld, the server's world, the fort, byte for byte); `npx tsx scripts/split/join-check.ts` (this tree's server boots on its own port and lets two players in); `npx tsx scripts/split/online-check.ts` (the game comes up online in headless Chrome with no page errors).
- Develop and picture single things in the sandbox first (the stage until 2026-10-24: "lets rename this to the sanbox"; `tools/sandbox.html`, `src/dev/sandbox.ts`: plain grid floor, fixed sun and cameras, a survivor for size, every view in one picture; screens of the game over it, `&ui=inventory`; headless on the processor with `PLAY_NOWAIT=1 PLAY_GL=swiftshader` and `assets-src/_wf/me/sandbox-shot.js`, no card queue), then plug them into the world for one final check (the owner, 2026-10-24: "all sessions should use the stage for development ... then once its all tested in the stage we can plug it in to the world"; "use the stage for all pictures and animations"). Places, terrain and load or memory timings still need the world.
- Anything seen must be looked at in the real game before it is called done (stumps set on the ground and gaps at stair heads went live because nobody looked). Things set on the ground are judged where they meet it.

## Cloud sessions (code-only work, off this machine)
The owner, 2026-10-18, with this machine's card and processor holding up their lanes: code-only pieces may run as cloud sessions, on Anthropic's machines, using nothing of this PC's.
- Fit: server rules, `src/sim`, the API and payouts code, tests. Not: anything drawn or looked at (no card, no `assets-src/`, no headless game, no films), models, deploys.
- It clones from GitHub: push the working branch first (never `main`) and name it in the brief. It pushes a branch of its own, merged here. Never merge its pull request on GitHub: a merge into `main` redeploys the live server unsaved.
- The environment (the owner's, at claude.ai/code): setup `npm ci`; `SITE_URL=http://127.0.0.1:9` among its variables, as a cloud copy has no `.env.local-server`; network access limited, not full.
- Every rule here holds there: no deploy, no live server, no transaction, no `test/devnet.test.ts`.

## Deploying (only when the owner says so; when they say so, do it at once)
- ONLY `node scripts/deploy.mjs` (`npm run deploy` is the same): it publishes the site, tells the live server a deploy is coming and waits for it to save, then pushes `main`. `--site` for the site alone, `--server` for the server alone (after a site deploy that stopped half way), `--dry` to rehearse, `--unsaved` only with the owner's word. It publishes HEAD of the branch checked out. Never push `main` by hand. No deploy of any kind, `--site` included, before the owner has tested the build (the owner, 2026-10-25: "the only limitation you have is do not deploy to production without me testing"; this ends the free site-only deploys of 2026-10-19).
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
- NEVER run `npm run assets`: it wrecks `public/assets/manifest.json`. Bring a model in as the last single model was (`node scripts/packs.mjs <id>`, `tier-now.mjs`, `lods.mjs`), then `npx tsx scripts/lean.mjs` (a computer's copies at the size it draws them; `test/lean.test.ts` says when they are behind).
- NEVER `git worktree remove` a copy that has a `node_modules` junction: it deleted the real packages once. Order: `cmd //c "rmdir <wt>\node_modules"`, check it is gone, `rm -rf <wt>`, `git worktree prune`.
- Edit code with the Edit tool; the project's scripts are Node (`node`, `npx tsx`). Python is only an occasional helper for a multi-part patch or for reading JSON, never the default (when used: `python -I`, and open files with `newline=''`, as its text mode writes CRLF here). Bash heredocs mangle backslashes and apostrophes: write any script with the Write tool.
- The card's heat: the owner, 2026-10-14, with one chat working at a time: "Don't concern yourself with temps ... dont need to pause or wait." Run headless games when needed; do not read the card first or wait for it to cool. (Still keep the Browser pane closed while the owner plays, and never start the game's sound in the pane.)
- Hands: our body's fingers rest FLAT, and a retarget carries each joint's turn from the source's rest, so lay fingers along the source's (`rig.dir` in scripts/emotes.mjs) and give every custom pose its own curl; never a fixed curl on top. Judge hands in third person in the game (`assets-src/_wf/me/emote-hands.js`). Memory note: hand-animation-lessons.
- When the machine is slow, look for leftover processes of finished work (old `tsx` scripts, extra `vite` servers): one ran five hours unseen.
- `git index.lock` can appear while several hands work: retry.

## How the owner works (use they/them)
- Short TL;DRs, not documents. Pictures of work as it goes (send them), and a plan picture before anything big is built: wait for their yes on a design, not on every step.
- Do not over-test. When they say deploy, deploy.
- No performance measuring in feature work (the owner, 2026-10-24: "just focus on getting the build done and we will optimize ourselves ... taking too many tests and running comparison heads etc its nonsense"): build things cheap by design (instancing, shared materials, LODs), but run no heli flights, A/B pairs or frame-cost runs. Performance gets its own pass when the owner asks.
- Do not use Workflows unless they ask for one in that same message.
- NO sub-agents or lanes: do the work yourself, one thing at a time. The owner, 2026-10-14, watching the weekly token limit: "i would prefer that you do not run multiple lanes or agents at once and do everything yourself." Spend tokens with care: read only the parts of a file you need (grep first), do not re-read what you have, no long polling. The one exception: a cloud session for a code-only piece when the owner asks for one (see Cloud sessions).
- Keep what they loved: change only what was asked, and prove nothing else was lost.
- When they ask for one change (turn it), make that change and solve what it costs; do not offer a different change because it is cheaper.
- Real, downloaded models only, never shapes made by hand for real things; never lower a model's quality. AI-made models from Higgsfield (Meshy, Tripo, Hunyuan3D in its catalogue) are allowed too (the owner, 2026-10-24: "you can use higgsfield AI to make models at equal or higher quality for cheaper than the models we have"), judged on the stage beside the model they would replace, with the plan's licence checked for commercial use. Poly Haven (CC0) may be used freely; any other site needs their yes; nothing ripped or decompiled.
- Textures of a model brought in from 2026-10-17 on: 2048 a side at most, set at the source (`tex: 2048`), held guns too (the owner: "2048 should be our max for new models").
- DayZ is the rule for anything they have not said.
- Every number on a page or in a film must be true and checkable; there is no player count anywhere.

## Code style
Comments are prose that say WHY, with the owner's words quoted where they are the reason. Keep them tight. Match the file you are in.
- Keep files under about 800 lines: split by feature as the 2026-10-14 split did (`scripts/split/cut.ts` moves top-level code, `scripts/split/methods.ts` moves a class's methods; both change no line of what they move), the old path re-exporting.
- When you work in a file, tighten its comments as you go (comments were 17 to 38% of the big files: every read pays for them): keep the why and the owner's words, cut the rest. Never as a pass of its own over files you are not working in.
- `Game` (src/game/game.ts and src/game/game/) holds some two hundred fields every feature reaches into. When a feature is worked on, move its own state into a class of its own (as `Garage`, `Airdrops`, `LootManager` are), one feature at a time; never as a rewrite of its own.
