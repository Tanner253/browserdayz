// The how-to-play panels of the three games' menus, as a screen shows them (the owner, 2026-10-21: "the how to play
// panel's are not cropped properly ... and doesnt resizee right for 21:9"): ZONA's start screen (/zona), the Arena's
// menu (/arena) and the battle royale's (/battleroyale), each at the size given, the panel scrolled to
// its foot as well.
//   node assets-src/_wf/me/play.mjs tools/br/howto-look.js <out> 3440 1440 "http://localhost:5173/zona?server=http://127.0.0.1:9"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = innerWidth, H = innerHeight, at = `${W}x${H}`, out = { at };
const panelOf = () => {
  if (location.pathname.startsWith('/battleroyale')) return { open: '#br-menu .bm-nav [data-p="how"]', panel: '#br-menu .bm-main', name: 'br' };
  if (location.pathname.startsWith('/arena')) return { open: '#arena-menu .am-nav [data-p="how"]', panel: '#arena-menu .am-main', name: 'arena' };
  return { open: '[data-tab="howto"]', panel: '.hud-start .sm-panel.on, .hud-start [data-panel="howto"], .hud-start .sm-body', name: 'zona' };
};
const p = panelOf();
for (let k = 0; k < 80 && !document.querySelector(p.open); k++) await sleep(250);
document.querySelector(p.open)?.click();
await sleep(1500);
await shot(`${p.name}-${at}-top`);
// (every element that scrolls, scrolled to its foot)
const scrollers = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.clientHeight > 100);
out.scrollers = scrollers.map((e) => `${e.className || e.id} ${e.clientWidth}x${e.clientHeight} of ${e.scrollHeight}`).slice(0, 6);
for (const e of scrollers) e.scrollTop = e.scrollHeight;
await sleep(600);
await shot(`${p.name}-${at}-foot`);
return JSON.stringify(out);
