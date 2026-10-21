// The battle royale's how-to pictures (public/howto/br-*.jpg, its menu's How to play; the owner, 2026-10-21, "how to
// play is missing graphiscs"): the waiting area, the drop (a second player under a canopy below, the map under both), a
// gun on the ground in its rarity's ring, the circle's wall, and the win. The HUD hidden for all but the win. The local
// arena server must be up (zona-arena-local).
//   node assets-src/_wf/me/play.mjs tools/br/howto-pics.js <out> 1600 1000 "http://localhost:5173/battleroyale?kills=2"
const g = window.__game, out = { errors: T.errors };
const hud = (on) => (document.getElementById('hud').style.visibility = on ? '' : 'hidden');
const { heightAt } = await import('/src/world/worldgen.ts');
history.replaceState(null, '', '/battleroyale?wager=br&size=1&kills=2&loadout=find');
await T.boot();
for (let k = 0; k < 240 && !g.net?.id; k++) await T.wait(250);
if (!g.net?.id) return 'not online';
if (g.paused) g.unpause();
await T.wait(6000);
const near = (f, lo, hi) => {
  const p = g.player.pos;
  return [...g.br.ground.values()].filter((x) => x.item && f(x.item.id) && Math.hypot(x.x - p.x, x.z - p.z) > lo && Math.hypot(x.x - p.x, x.z - p.z) < hi);
};
const GUN = (id) => /^(m9|colt|scorpion|mpa|aks74u|mp7a1|ak|ar15|a91|deagle|mosin|benelli|vssk)$/.test(id);
// 1, the waiting area: a gun lying a few steps off in its ring, the field beyond
hud(false);
const far = near(GUN, 3, 9)[0] ?? near(GUN, 0, 30)[0];
if (far) T.aim(far.x, far.y + 0.9, far.z);
await T.wait(2500);
out.lobbyGun = far?.item.id;
await shot('1-lobby');
hud(true);
// 3, loot: a gun in the waiting area, on flat grass, from a step off (walked to: the server minds a jump in place)
const walkTo = async (x, z) => {
  const a = g.player.pos.clone(), n = Math.ceil(Math.hypot(x - a.x, z - a.z) / 1.5);
  for (let k = 1; k <= n; k++) {
    T.tp(a.x + ((x - a.x) * k) / n, a.z + ((z - a.z) * k) / n, 0);
    await T.wait(160);
  }
};
const gun = near((id) => /^(ak|ar15|a91|mosin|vssk|benelli|aks74u|mpa|mp7a1|scorpion)$/.test(id), 0, 40)[0] ?? far;
if (gun) {
  await walkTo(gun.x + 1.5, gun.z + 0.7);
  await T.wait(1500);
  T.aim(gun.x, gun.y + 0.1, gun.z);
  hud(false);
  await T.wait(2500);
  out.lootShown = !!g.br.look.shown.get(gun.id)?.model;
  await shot('3-loot');
  hud(true);
}
out.gun = gun?.item.id;

// the second player, to vote and to fall beside
const { PROTOCOL } = await import('/src/net/protocol.ts');
const two = new WebSocket(`ws://${location.host}/arena?w=br&size=1&kills=2&loadout=find`);
await new Promise((r) => two.addEventListener('open', r));
two.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: 'br-howto-second-player-000000000000', name: 'Second' }));
await T.wait(1000);
two.send(JSON.stringify({ t: 'br', k: 'vote', yes: true }));
T.key('KeyV');
for (let k = 0; k < 60 && g.br.phase !== 'plane'; k++) await T.wait(500);
for (let k = 0; k < 160 && g.br.jumpIn() > 0; k++) await T.wait(250);
await T.wait(1500);
two.send(JSON.stringify({ t: 'br', k: 'jump' }));
T.key('Space');
await T.wait(2500);
// 2, the drop: under our own canopy, the other's ahead and below, the map under both
T.key('Space');
await T.wait(1200);
two.send(JSON.stringify({ t: 'br', k: 'air', s: 'chute' }));
hud(false);
for (let k = 0; k < 16; k++) {
  const me = g.player.pos, yaw = g.player.yaw;
  const ox = me.x - Math.sin(yaw) * 16 + Math.cos(yaw) * 4, oz = me.z - Math.cos(yaw) * 16 - Math.sin(yaw) * 4;
  two.send(JSON.stringify({ t: 's', p: [ox, me.y - 6, oz, yaw, 0, 0], w: null, m: [] }));
  T.aim(ox, me.y - 7.5, oz);
  await T.wait(100);
}
await shot('2-drop');
hud(true);
out.air = g.br.air;
for (let k = 0; k < 400 && g.br.air; k++) await T.wait(250);
await T.wait(1500);

// 4, the circle: from just outside it, in the gas (its tint at the screen's edges), back at the wall and the map inside,
// where the ground runs level and nothing stands between
const wall = g.br.look.wall;
out.circle = wall.visible;
if (wall.visible) {
  const cx = wall.position.x, cz = wall.position.z, r = wall.scale.x, a0 = Math.atan2(g.player.pos.z - cz, g.player.pos.x - cx);
  const H = (x, z) => heightAt(g.s.world.heights, x, z);
  let best = null;
  for (let k = 0; k < 120 && !best; k++) {
    const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.03;
    const x = cx + Math.cos(a) * (r + 14), z = cz + Math.sin(a) * (r + 14), ix = cx + Math.cos(a) * (r - 70), iz = cz + Math.sin(a) * (r - 70);
    if ([0.25, 0.5, 0.75, 1].some((f) => Math.abs(H(x + (ix - x) * f, z + (iz - z) * f) - H(x, z)) > 5)) continue;
    const o = { x, y: H(x, z) + 1.7, z }, d = { x: ix - x, y: H(ix, iz) + 1.7 - o.y, z: iz - z }, L = Math.hypot(d.x, d.y, d.z);
    if (T.physics.raycast(o, { x: d.x / L, y: d.y / L, z: d.z / L }, L)) continue;
    best = { x, z, ix, iz };
  }
  out.circleSpot = !!best;
  if (best) {
    await walkTo(best.x, best.z);
    await T.wait(3000);
    T.aim(best.ix, H(best.ix, best.iz) + 6, best.iz);
    // (the HUD hidden but for the gas's own tint and word)
    hud(false);
    document.querySelector('#hud .br-gas').style.visibility = 'visible';
    await T.wait(1200);
    out.gassed = !!document.querySelector('#hud .br-hud.gassed');
    await shot('4-circle');
    document.querySelector('#hud .br-gas').style.visibility = '';
    hud(true);
  }
}

// 5, the win: the other leaves
two.send(JSON.stringify({ t: 'br', k: 'leave' }));
await T.wait(4000);
await shot('5-win');
out.ended = !!document.querySelector('#hud .br-hud.ended');
two.close();
// and back to the menu with the page as it is (the owner: "should not trigger a total reload"), then into a lobby again
window.__kept = 1;
document.querySelector('#hud .br-again')?.click();
await T.wait(2500);
out.back = { kept: window.__kept === 1, menu: !!document.querySelector('#br-menu.show'), hudIdle: !!document.querySelector('#hud .br-hud.idle'), at: location.pathname + location.search };
await shot('6-back');
document.querySelector('#br-menu .bm-find')?.click();
for (let k = 0; k < 60 && !document.querySelector('#hud .br-hud:not(.idle)'); k++) await T.wait(250);
await T.wait(3000);
out.again = { kept: window.__kept === 1, online: !!g.net?.id, phase: g.br.phase, lobby: document.querySelector('.br-lobby-n')?.textContent };
await shot('7-again');
return JSON.stringify(out);
