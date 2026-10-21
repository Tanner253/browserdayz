// The battle royale in the game, on the local arena server: the lobby, a second player to vote with, the plane, the
// jump, the canopy, the landing, a gun taken off the ground. Pictures at each.
const g = window.__game, out = { errors: T.errors };
await T.boot();
for (let k = 0; k < 80 && !g.net?.id; k++) await T.wait(250);
if (!g.net?.id) return 'not online: ' + JSON.stringify(out);
await T.wait(2500);
out.lobby = { phase: g.br?.phase, ground: g.br?.ground.size, slots: g.br?.me?.slots.map((s) => s?.id ?? '-') };
await shot('1-lobby');
// a second player, from this page, to vote with
const { PROTOCOL } = await import('/src/net/protocol.ts');
const two = new WebSocket(`ws://${location.host}/arena?w=br&size=1&kills=2&loadout=find`);
await new Promise((r) => two.addEventListener('open', r));
two.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: 'br-look-second-player-000000000000000', name: 'Second' }));
await T.wait(1500);
two.send(JSON.stringify({ t: 'br', k: 'vote', yes: true }));
T.key('KeyV');
await T.wait(1500);
out.count = { phase: g.br.phase, hud: document.querySelector('.br-lobby')?.textContent };
for (let k = 0; k < 60 && g.br.phase !== 'plane'; k++) await T.wait(500);
await T.wait(2500);
out.plane = { phase: g.br.phase, air: g.br.air, y: Math.round(g.player.pos.y) };
await shot('2-plane');
T.key('Space');
await T.wait(3000);
out.fall = { air: g.br.air, y: Math.round(g.player.pos.y) };
await shot('3-fall');
for (let k = 0; k < 80 && g.br.air === 'fall'; k++) await T.wait(250);
await T.wait(1500);
out.chute = { air: g.br.air, y: Math.round(g.player.pos.y) };
await shot('4-chute');
for (let k = 0; k < 120 && g.br.air; k++) await T.wait(250);
await T.wait(1500);
out.landed = { air: g.br.air, x: Math.round(g.player.pos.x), z: Math.round(g.player.pos.z) };
await shot('5-landed');
// the nearest gun on the ground: stand by it, look at it, F
const p = g.player.pos;
const guns = [...g.br.ground.values()].filter((x) => x.item && g.s.world && /^(m9|colt|mosin9130|scorpion|mpa|benelli|deagle|dual_sawnoff|aks74u|mp7a1|ak|mosin|dual_smg|ar15|a91|vssk|dual_mac10|barrett|sniper50)$/.test(x.item.id));
guns.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
const gun = guns[0];
out.gun = gun && { id: gun.item.id, far: Math.round(Math.hypot(gun.x - p.x, gun.z - p.z)) };
if (gun) {
  T.tp(gun.x + 1.2, gun.z, 0, gun.y + 0.05);
  await T.wait(1200);
  T.aim(gun.x, gun.y + 0.1, gun.z);
  await T.wait(800);
  out.prompt = g.prompt;
  await shot('6-loot');
  T.key('KeyF');
  await T.wait(1500);
  T.key('Digit2');
  await T.wait(2000);
  out.slots = g.br.me.slots.map((s) => s?.id ?? '-');
  out.held = g.weapons.equippedItem?.id;
  out.pools = g.br.me.pools;
  await shot('7-gun');
}
two.close();
return JSON.stringify(out);
