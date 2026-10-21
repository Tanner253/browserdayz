// Every game on one page (2026-10-21, the owner: "Shouldn't I be able to switch between all modes without refresh"): the
// battle royale's menu, the main menu over it, the Arena, the Zone played online and left by the main menu, the battle
// royale again and a lobby joined and left. The page is never loaded again (window.__kept), and nothing of one game is
// left in the next. Needs zona-server-local (8080) and zona-arena-local (8090).
//   node assets-src/_wf/me/play.mjs tools/modes/switch.js <out> 1600 900 "http://localhost:5173/battleroyale?kills=2"
const g = window.__game, out = { steps: [] };
const items = () => g.inv.containers.reduce((n, c) => n + (c.items?.length ?? 0), 0) + (g.weapons.equippedItem ? 1 : 0);
const left = () => ({ loot: g.economy.loot.size, remotes: g.remotes.size, infected: g.horde.all.size, jeeps: g.garage.jeeps.size, corpses: g.corpses.size, stashes: g.loot.stashes.length, items: items(), started: g.started });
const say = (step, extra = {}) => out.steps.push({ step, at: location.pathname + location.search, kept: window.__kept === 1, mode: g.modes.mode, body: document.body.className, ...extra });
const until = async (sel, n = 160) => {
  for (let k = 0; k < n && !document.querySelector(sel); k++) await T.wait(250);
  return !!document.querySelector(sel);
};
while (!g.isLoaded) await T.wait(250);
await until('#br-menu.show');
window.__kept = 1;
say('br menu', { brMenu: !!document.querySelector('#br-menu.show') });
await shot('1-br-menu');

// the main menu over the page, and the Arena from it
document.querySelector('#br-menu .bm-zona').click();
await T.wait(1500);
say('door', { door: !!document.querySelector('#door') });
await shot('2-door');
document.querySelector('#door [data-mode="arena"]').click();
await until('#arena-menu.show');
await T.wait(4000);
say('arena', { arenaMenu: !!document.querySelector('#arena-menu.show'), brMenu: !!document.getElementById('br-menu') });
await shot('3-arena');

// the Arena's ZONA: the Zone's way in
document.querySelector('#arena-menu .am-zona').click();
await T.wait(3000);
say('zona', { start: !!document.querySelector('#hud .hud-start.show'), arenaMenu: !!document.getElementById('arena-menu') });
await shot('4-zona');

// into the Zone on the local server, a while there
await T.boot();
for (let k = 0; k < 160 && !g.net?.id; k++) await T.wait(250);
await T.wait(6000);
say('zona online', { online: g.net.online, ...left() });
await shot('5-zona-in');

// out of it by the main menu (Esc, All games), to the battle royale
g.pause();
await T.wait(1200);
document.querySelector('#hud .sm-arena').click();
await T.wait(1500);
say('door from zona', { door: !!document.querySelector('#door') });
document.querySelector('#door [data-mode="br"]').click();
await until('#br-menu.show');
await T.wait(3000);
say('br again', { online: g.net.online, brMenu: !!document.querySelector('#br-menu.show'), ...left() });
await shot('6-br-again');

// a lobby joined, then left by the pause
document.querySelector('#br-menu .bm-find').click();
for (let k = 0; k < 160 && !(g.br && g.net?.id && g.net.online); k++) await T.wait(250);
await T.wait(5000);
if (g.paused) g.unpause();
await T.wait(1500);
say('br lobby', { online: g.net.online, phase: g.br?.phase, lobby: document.querySelector('.br-lobby-n')?.textContent, ...left() });
await shot('7-br-lobby');
g.pause();
await T.wait(800);
document.querySelector('#br-menu .bm-leave').click();
await T.wait(2500);
say('br left', { online: g.net.online, brMenu: !!document.querySelector('#br-menu.show'), ...left() });
await shot('8-br-left');
out.errors = T.errors;
return JSON.stringify(out, null, 1);
