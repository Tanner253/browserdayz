// A battle royale match played in the headless game (2026-10-21), a picture at each stage, to find what is not yet a
// battle royale: the lobby, the plane, the fall, the canopy, the landing, a door, a jeep, the pause, the end (a second
// player, from this page, votes and then leaves). The local arena server must be up (zona-arena-local).
//   node assets-src/_wf/me/play.mjs tools/br/br-play.js <out> 2560 1440 "http://localhost:5173/battleroyale?kills=2"
const g = window.__game, out = { errors: T.errors, notes: [] };
const say = (s) => console.warn('br-play: ' + s);
const items = () => [...Object.values(g.inv.slots).filter(Boolean).map((i) => i.id), ...g.inv.containers.flatMap((c) => c.items.map((q) => q.item.id))];
history.replaceState(null, '', '/battleroyale?wager=br&size=1&kills=2&loadout=find');
await T.boot();
for (let k = 0; k < 80 && !g.net?.id; k++) await T.wait(250);
if (!g.net?.id) return 'not online';
await T.wait(5000);
out.lobbyCarried = items();
out.vitals = { ...g.player.vitals };
await shot('1-lobby');
const walkTo = async (x, z, step = 1.5) => {
  const a = g.player.pos.clone(), n = Math.ceil(Math.hypot(x - a.x, z - a.z) / step);
  for (let k = 1; k <= n; k++) {
    T.tp(a.x + ((x - a.x) * k) / n, a.z + ((z - a.z) * k) / n, 0);
    await T.wait(150);
  }
};
const { PROTOCOL } = await import('/src/net/protocol.ts');
const two = new WebSocket(`ws://${location.host}/arena?w=br&size=1&kills=2&loadout=find`);
await new Promise((r) => two.addEventListener('open', r));
two.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: 'br-play-second-player-000000000000000', name: 'Second' }));
await T.wait(1000);
two.send(JSON.stringify({ t: 'br', k: 'vote', yes: true }));
T.key('KeyV');
await T.wait(3000);
await shot('2-count');
for (let k = 0; k < 60 && g.br.phase !== 'plane'; k++) await T.wait(500);
await T.wait(2500);
await shot('3-plane');
T.key('Space');
await T.wait(2500);
await shot('4-fall');
for (let k = 0; k < 80 && g.br.air === 'fall'; k++) await T.wait(250);
await T.wait(2000);
await shot('5-canopy');
for (let k = 0; k < 160 && g.br.air; k++) await T.wait(250);
await T.wait(2500);
out.landedCarried = items();
await shot('6-landed');
// a door: the nearest, walked to and opened
const p = g.player.pos;
// (each door by the middle of its leaf, not its hinge)
const doors = g.s.buildings.doors.map((d) => ({ d, at: new T.THREE.Box3().setFromObject(d.pivot).getCenter(new T.THREE.Vector3()) })).sort((a, b) => a.at.distanceTo(p) - b.at.distanceTo(p));
const door = doors[0];
if (door && door.at.distanceTo(p) < 1500) {
  say('door ' + door.at.distanceTo(p).toFixed(0) + ' m');
  const off = new T.THREE.Vector3(p.x - door.at.x, 0, p.z - door.at.z).normalize().multiplyScalar(1.4);
  await walkTo(door.at.x + off.x, door.at.z + off.z);
  await T.wait(800);
  T.aim(door.at.x, door.at.y, door.at.z);
  await T.wait(600);
  out.doorPrompt = g.prompt;
  const was = door.d.open;
  T.key('KeyF');
  await T.wait(1200);
  out.door = { was, now: door.d.open };
  T.key('KeyF');
  await T.wait(1200);
  out.door.again = door.d.open;
  await shot('7-door');
}
// a jeep: the nearest, walked to and got into, driven a little
const jeeps = [...g.garage.jeeps.values()].sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos));
const jeep = jeeps[0];
if (jeep) {
  say('jeep ' + jeep.pos.distanceTo(g.player.pos).toFixed(0) + ' m');
  await walkTo(jeep.pos.x + 2.4, jeep.pos.z + 2.4);
  await T.wait(800);
  T.aim(jeep.pos.x, jeep.pos.y + 1, jeep.pos.z);
  await T.wait(600);
  out.jeepPrompt = g.prompt;
  T.key('KeyF');
  await T.wait(2000);
  out.ride = !!g.garage.ride;
  if (g.garage.ride) {
    T.key('KeyW', 2500);
    await T.wait(3000);
    await shot('8-jeep');
    T.key('KeyF');
    await T.wait(1500);
  }
}
// the pause
g.pause();
await T.wait(1200);
await shot('9-pause');
document.querySelector('#br-menu .bm-resume')?.click();
await T.wait(1500);
// the end: the other player leaves, and is out after their grace
two.close();
for (let k = 0; k < 90 && !document.querySelector('.br-hud.ended'); k++) await T.wait(500);
await T.wait(1500);
out.ended = !!document.querySelector('.br-hud.ended');
await shot('10-end');
return JSON.stringify(out);
