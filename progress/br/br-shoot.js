// The battle royale's shots in the game (2026-10-21): in the waiting area, a gun off the ground, a second player 8 m
// off in the open, fired at; then the same player behind a building's wall. Hits counted from the server's 'hitok'.
// node assets-src/_wf/me/play.mjs progress/br/br-shoot.js progress/br/shoot 1280 720 "http://localhost:5173/br?wager=br&size=1&kills=2&loadout=find"
const g = window.__game, out = { errors: T.errors };
await T.boot();
for (let k = 0; k < 80 && !g.net?.id; k++) await T.wait(250);
if (!g.net?.id) return 'not online';
await T.wait(2000);
let hits = 0;
g.net.on('hitok', () => hits++);
// a gun of the waiting area's, into a slot
const p = g.player.pos;
const gun = [...g.br.ground.values()].filter((x) => x.item && /^(m9|colt|scorpion|mpa|aks74u|mp7a1|ak|ar15|a91|deagle)$/.test(x.item.id)).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
if (!gun) return 'no gun in the waiting area';
// (walked there in steps: the server sends back a body that goes faster than a run)
const walkTo = async (x, z) => {
  const a = g.player.pos.clone(), n = Math.ceil(Math.hypot(x - a.x, z - a.z) / 1.5);
  for (let k = 1; k <= n; k++) {
    T.tp(a.x + ((x - a.x) * k) / n, a.z + ((z - a.z) * k) / n, 0);
    await T.wait(160);
  }
};
await walkTo(gun.x + 1, gun.z);
await T.wait(800);
T.aim(gun.x, gun.y + 0.1, gun.z);
await T.wait(500);
T.key('KeyF');
await T.wait(1200);
T.key('Digit2');
await T.wait(1500);
out.held = g.weapons.equippedItem?.id;
// the second player, standing 8 m off
const { PROTOCOL } = await import('/src/net/protocol.ts');
const two = new WebSocket(`ws://${location.host}/arena?w=br&size=1&kills=2&loadout=find`);
await new Promise((r) => two.addEventListener('open', r));
two.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: 'br-shoot-second-player-00000000000000', name: 'Target' }));
await T.wait(1500);
const me = g.player.pos, tx = me.x + 8, tz = me.z;
const { heightAt } = await import('/src/world/worldgen.ts');
const ty = heightAt(g.s.world.heights, tx, tz);
const stand = setInterval(() => two.send(JSON.stringify({ t: 's', p: [tx, ty, tz, 0, 0, 8], w: null, m: [] })), 100);
await T.wait(1200);
T.aim(tx, ty + 1.2, tz);
await T.wait(600);
const sent = [];
const s0 = g.net.ws ? null : null;
const ws0 = WebSocket.prototype.send;
WebSocket.prototype.send = function (d) {
  if (typeof d === 'string' && d.includes('"t":"shot"')) sent.push(JSON.parse(d));
  return ws0.call(this, d);
};
for (let k = 0; k < 6; k++) {
  await T.fire(60);
  await T.wait(350);
}
await T.wait(800);
out.openHits = hits;
out.shots = sent.slice(0, 2).map((m) => ({ o: m.o.map((v) => +v.toFixed(2)), wall: m.wall, w: m.w }));
out.target = [tx, ty, tz].map((v) => +v.toFixed(2));
out.me = [g.player.pos.x, g.player.pos.y, g.player.pos.z].map((v) => +v.toFixed(2));
out.remotes = [...g.remotes.values()].map((r) => [r.pos.x, r.pos.y, r.pos.z].map((v) => +v.toFixed(1)));
await shot('open');
clearInterval(stand);
two.close();
return JSON.stringify(out);
