// The page's half of scripts/split/online-check.ts (run inside the game by play.mjs): join the server the address
// names, stand a few seconds in the world, and say what the game has. A picture is taken of it.
const g = window.__game, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await g.join();
for (let k = 0; k < 200 && !g.online; k++) await sleep(100);
if (!g.online) return JSON.stringify({ online: false, refused: g.net.refused ?? null });
if (g.paused) g.unpause();
await sleep(6000);
await shot('online');
const out = { online: g.online, id: g.net.id, items: Object.values(g.inv.slots).filter(Boolean).length, at: g.player?.position ? [g.player.position.x, g.player.position.y, g.player.position.z].map((v) => Math.round(v)) : null };
return 'ONLINE ' + JSON.stringify(out);
