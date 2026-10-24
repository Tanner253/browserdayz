// The page's half of scripts/rejoin-check.ts (run inside the game by play.mjs): join, then lose the line twice and
// say how the game came back each time. `closed`: the socket shut under the game, as a dropped line does. `silent`:
// nothing the server says reaches the game while what it says still goes out (the "parallel universe": see Net.dead).
// A page loaded again ends this script with it, which play.mjs reports as a failure: the game is to come back on the
// page as it is.
const g = window.__game, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (window.__rejoinMark = Math.random());
await g.join();
for (let k = 0; k < 600 && !g.online; k++) await sleep(100);
if (!g.online) return 'REJOIN ' + JSON.stringify({ online: false, refused: g.net.refused ?? null });
if (g.paused) g.unpause();
// (stood in the world long enough to be a body the server keeps: it has heard where we stand)
await sleep(5000);
const kit = () => Object.values(g.inv.slots).filter(Boolean).map((it) => it.uid).sort().join(',');
const at = () => [g.player.pos.x, g.player.pos.z];
const out = { first: g.net.id, kit: kit(), runs: [] };
for (const how of ['closed', 'silent']) {
  const before = { id: g.net.id, kit: kit(), at: at() }, t0 = performance.now();
  const ws = g.net.ws;
  if (how === 'closed') ws.close();
  else ws.onmessage = () => {};
  // (offline at once for a closed line; for a silent one, once the game has given it up)
  for (let k = 0; k < 400 && g.online; k++) await sleep(100);
  const lost = Math.round(performance.now() - t0);
  for (let k = 0; k < 900 && !(g.online && g.started); k++) await sleep(100);
  const back = Math.round(performance.now() - t0);
  if (g.paused) g.unpause();
  await sleep(1500);
  const [x0, z0] = before.at, [x1, z1] = at();
  out.runs.push({ how, lost, back, online: g.online, id: g.net.id, newId: g.net.id !== before.id, sameKit: kit() === before.kit, kit: kit(), moved: Math.round(Math.hypot(x1 - x0, z1 - z0) * 10) / 10, samePage: window.__rejoinMark === mark });
}
return 'REJOIN ' + JSON.stringify(out);
