// The battle royale's screens for the owner (2026-10-21): the door (address "/", with PLAY_NOWAIT), or, on
// /battleroyale?kills=2, its menu, the lobby, loot on the ground, the slots with a gun in hand, and the circle's HUD
// after the drop (a second player, from this page, to vote with). The local arena server must be up (zona-arena-local).
//   PLAY_NOWAIT=1 node assets-src/_wf/me/play.mjs tools/br/br-pics.js <out> 2560 1440 "http://localhost:5173/"
//   node assets-src/_wf/me/play.mjs tools/br/br-pics.js <out> 2560 1440 "http://localhost:5173/battleroyale?kills=2"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (location.pathname === '/') {
  for (let k = 0; k < 60 && !document.querySelector('#door .door-card'); k++) await sleep(250);
  await sleep(2500);
  await shot('1-door');
  return 'door';
}
const g = window.__game, out = { errors: T.errors };

for (let k = 0; k < 60 && !document.querySelector('#br-menu.show'); k++) await T.wait(250);
await T.wait(1500);
await shot('2-menu');
// (in as Find match goes in: the match put in the page's address, then the game's own join)
history.replaceState(null, '', '/battleroyale?wager=br&size=1&kills=2&loadout=find');
await T.boot();
for (let k = 0; k < 80 && !g.net?.id; k++) await T.wait(250);
if (!g.net?.id) return 'not online';
if (g.paused) g.unpause();
await T.wait(7000);
console.warn('br-pics: lobby', g.paused, g.br?.phase);
await shot('3-lobby');
const walkTo = async (x, z) => {
  const a = g.player.pos.clone(), n = Math.ceil(Math.hypot(x - a.x, z - a.z) / 1.5);
  for (let k = 1; k <= n; k++) {
    T.tp(a.x + ((x - a.x) * k) / n, a.z + ((z - a.z) * k) / n, 0);
    await T.wait(160);
  }
};
// the second player, to vote with
const { PROTOCOL } = await import('/src/net/protocol.ts');
const two = new WebSocket(`ws://${location.host}/arena?w=br&size=1&kills=2&loadout=find`);
await new Promise((r) => two.addEventListener('open', r));
two.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: 'br-pics-second-player-0000000000000', name: 'Second' }));
await T.wait(1000);
two.send(JSON.stringify({ t: 'br', k: 'vote', yes: true }));
T.key('KeyV');
for (let k = 0; k < 60 && g.br.phase !== 'plane'; k++) await T.wait(500);
console.warn('br-pics: plane', g.br.phase);
await T.wait(2500);
T.key('Space');
for (let k = 0; k < 200 && g.br.air; k++) await T.wait(250);
console.warn('br-pics: down', g.br.air);
await T.wait(1500);
// loot: the nearest gun, looked at from a step off; then taken, and in hand
const p = g.player.pos;
// (one lying in the open, on the ground itself: not on a shelf, in a cellar or up a tower)
const { heightAt } = await import('/src/world/worldgen.ts');
const gun = [...g.br.ground.values()].filter((x) => x.item && /^(m9|colt|scorpion|mpa|aks74u|mp7a1|ak|ar15|a91|deagle|mosin|benelli|vssk)$/.test(x.item.id) && Math.abs(x.y - heightAt(g.s.world.heights, x.x, x.z)) < 0.25).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
if (gun) {
  await walkTo(gun.x + 1.6, gun.z + 0.6);
  await T.wait(800);
  T.aim(gun.x, gun.y + 0.1, gun.z);
  await T.wait(900);
  await shot('4-loot');
  T.key('KeyF');
  await T.wait(1200);
  T.key('Digit2');
  await T.wait(1800);
  T.aim(gun.x + 30, gun.y + 1.5, gun.z + 10);
  await T.wait(800);
  await shot('5-slots');
}
out.slots = g.br.me?.slots.map((s) => s?.id ?? '-');
two.close();
return JSON.stringify(out);
