// The battle royale's open lobby on another map than the page was made for (2026-10-21): once a page loaded again for
// that map, now the same page with that map shown (src/game/modes.ts). Somebody waits on Green West; this page, made
// for Kamenka, presses Find match and is let into their lobby. Needs zona-arena-local (8090).
//   node assets-src/_wf/me/play.mjs tools/modes/remap.js <out> 1600 900 "http://localhost:5173/battleroyale?kills=2"
const g = window.__game, out = {};
while (!g.isLoaded) await T.wait(250);
for (let k = 0; k < 160 && !document.querySelector('#br-menu.show'); k++) await T.wait(250);
window.__kept = 1;
const { PROTOCOL } = await import('/src/net/protocol.ts');
const two = new WebSocket(`ws://${location.host}/arena?w=br&size=1&kills=1&loadout=find`);
await new Promise((r) => two.addEventListener('open', r));
two.send(JSON.stringify({ t: 'hello', v: PROTOCOL, key: 'modes-remap-waiting-player-000000000', name: 'Waiting' }));
// (the menu's counts asked again: the waiting player seen on Green West)
await T.wait(7000);
out.before = { map: g.modes.brMap, counts: [...document.querySelectorAll('.bm-count')].map((e) => e.textContent) };
document.querySelector('#br-menu .bm-find').click();
for (let k = 0; k < 200 && !(g.modes.brMap === 1 && g.net?.online && g.br?.phase); k++) await T.wait(250);
await T.wait(5000);
if (g.paused) g.unpause();
await T.wait(1500);
out.after = { kept: window.__kept === 1, map: g.modes.brMap, at: location.pathname + location.search, online: g.net.online, lobby: document.querySelector('.br-lobby-n')?.textContent };
await shot('lobby-green-west');
two.close();
out.errors = T.errors;
return JSON.stringify(out);
