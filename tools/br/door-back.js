// The front door over the battle royale's page and back (the owner, 2026-10-21: "take me to main menu without having to
// reload everything"): All games opens the door with the page kept; the battle royale picked again is its menu at once.
//   node assets-src/_wf/me/play.mjs tools/br/door-back.js <out> 1600 1000 "http://localhost:5173/battleroyale?kills=2"
const out = {};
for (let k = 0; k < 120 && !document.querySelector('#br-menu.show'); k++) await T.wait(250);
window.__kept = 1;
document.querySelector('#br-menu .bm-zona').click();
await T.wait(1500);
out.door = { shown: !!document.querySelector('#door'), at: location.pathname, kept: window.__kept === 1 };
await shot('1-door');
document.querySelector('#door [data-mode="br"]').click();
await T.wait(1500);
out.back = { door: !!document.querySelector('#door'), menu: !!document.querySelector('#br-menu.show'), at: location.pathname + location.search, kept: window.__kept === 1 };
await shot('2-back');
return JSON.stringify(out);
