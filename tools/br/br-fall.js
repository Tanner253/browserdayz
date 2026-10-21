// The battle royale's drop, as another player sees it (2026-10-21): a jump before the plane is over the map is refused,
// then a second player (from this page) comes down in front of this one under a canopy, then in freefall. And the
// waiting area's spawn: in the open. The local arena server must be up (zona-arena-local).
//   node assets-src/_wf/me/play.mjs tools/br/br-fall.js <out> 1280 720 "http://localhost:5173/battleroyale?kills=2"
const g = window.__game, out = { errors: T.errors };
history.replaceState(null, '', '/battleroyale?wager=br&size=1&kills=2&loadout=find');
await T.boot();
for (let k = 0; k < 80 && !g.net?.id; k++) await T.wait(250);
if (!g.net?.id) return 'not online';
await T.wait(3000);
// the spawn: nothing over it
const p = g.player.pos;
const up = T.physics.raycast({ x: p.x, y: p.y + 0.3, z: p.z }, { x: 0, y: 1, z: 0 }, 30);
out.spawnUnderSomething = !!up;
await shot('1-spawn');
const { PROTOCOL } = await import('/src/net/protocol.ts');
const two = new WebSocket(`ws://${location.host}/arena?w=br&size=1&kills=2&loadout=find`);
let twoId = 0;
two.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'welcome') twoId = m.you;
});
await new Promise((r) => two.addEventListener('open', r));
two.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: 'br-fall-second-player-00000000000000', name: 'Second' }));
await T.wait(1000);
two.send(JSON.stringify({ t: 'br', k: 'vote', yes: true }));
T.key('KeyV');
for (let k = 0; k < 60 && g.br.phase !== 'plane'; k++) await T.wait(500);
await T.wait(1500);
// a jump before the plane is over the map: refused
out.jumpInAtStart = g.br.jumpIn();
T.key('Space');
await T.wait(800);
out.airAfterEarlySpace = g.br.air;
out.phaseText = document.querySelector('.br-phase')?.textContent + ' ' + document.querySelector('.br-time')?.textContent;
await shot('2-plane-wait');
for (let k = 0; k < 120 && g.br.jumpIn() > 0; k++) await T.wait(250);
two.send(JSON.stringify({ t: 'br', k: 'jump' }));
T.key('Space');
await T.wait(600);
out.airAfterJump = g.br.air;
for (let k = 0; k < 200 && g.br.air; k++) await T.wait(250);
await T.wait(1500);
// the other player, in front of this one, coming down under a canopy, then falling
const me = g.player.pos, yaw = g.player.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
const ox = me.x + fx * 14, oz = me.z + fz * 14;
const pose = (y) => two.send(JSON.stringify({ t: 's', p: [ox, y, oz, yaw + Math.PI, 0, 0], w: null, m: [] }));
two.send(JSON.stringify({ t: 'br', k: 'air', s: 'chute' }));
for (let k = 0; k < 20; k++) {
  pose(me.y + 22 - k * 0.3);
  await T.wait(100);
}
T.aim(ox, me.y + 18, oz);
await T.wait(800);
await shot('3-other-canopy');
two.send(JSON.stringify({ t: 'br', k: 'air', s: 'fall' }));
for (let k = 0; k < 10; k++) {
  pose(me.y + 30 - k * 2);
  await T.wait(100);
}
T.aim(ox, me.y + 12, oz);
await T.wait(600);
await shot('4-other-fall');
out.seen = { canopies: g.br.look.canopy ? 'made' : 'none', remote: [...g.remotes.keys()] };
two.close();
return JSON.stringify(out);
