// (a copy of census.js's set-up, see passes below) What is drawn on a mode's page at fixed spots (2026-10-21, every mode built whole and switched in place: "nothing ships
// slower"): triangles and draws in the picture and in the shadow maps, and the frame's time, for the battle royale's
// map (`?kills=`) or the Arena's fort, the page as it comes up (nobody joins). Run on the old cut and on the new.
//   node assets-src/_wf/me/play.mjs tools/modes/census.js <out> 1600 900 "http://localhost:5173/battleroyale?kills=2"
//   node assets-src/_wf/me/play.mjs tools/modes/census.js <out> 1600 900 "http://localhost:5173/arena?server=http://127.0.0.1:9"
const g = window.__game, R = g.s.r.renderer, cam = g.s.r.camera, out = { at: location.pathname + location.search, spots: {} };
while (!g.isLoaded) await T.wait(250);
const { MAPS } = await import('/arena/br/rules.ts');
const { arenaCorners } = await import('/arena/rules.ts');
const { heightAt } = await import('/src/world/worldgen.ts');
const H = (x, z) => heightAt(g.s.world.heights, x, z);
const br = location.pathname.startsWith('/battleroyale');
// (`#all`: every name drawn, not the top twelve)
const Q_ALL = location.hash === '#all';
let spots;
if (br) {
  const m = MAPS[Number(new URLSearchParams(location.search).get('kills') ?? 2)], cz = (m.z0 + m.z1) / 2, cx = (m.x0 + m.x1) / 2;
  spots = [
    ['lobby', [m.wait.x, H(m.wait.x, m.wait.z) + 1.7, m.wait.z], [m.wait.x + 200, H(m.wait.x, m.wait.z) + 1.7, m.wait.z + 60]],
    ['edge', [m.x1 - 90, H(m.x1 - 90, cz) + 1.7, cz], [m.x1 + 400, H(m.x1 - 90, cz) + 1.7, cz]],
    ['air', [cx, 420, m.z0 - 150], [cx, 0, cz]],
  ];
} else {
  const c = arenaCorners(g.s.world), cx = c.reduce((s, p) => s + p[0], 0) / 4, cz = c.reduce((s, p) => s + p[1], 0) / 4;
  spots = [
    ['yard', [cx, H(cx, cz) + 1.7, cz], [c[0][0], H(cx, cz) + 1.7, c[0][1]]],
    ['wall', [(c[0][0] + c[1][0]) / 2, H((c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2) + 6, (c[0][1] + c[1][1]) / 2], [cx + (c[0][0] + c[1][0] - 2 * cx) * 6, H(cx, cz), cz + (c[0][1] + c[1][1] - 2 * cz) * 6]],
    ['air', [cx + 250, H(cx, cz) + 220, cz + 250], [cx, H(cx, cz), cz]],
  ];
}
let pose = null;
// (the menu's own camera held still at the spot: nothing else moves it on a page nobody has joined)
g.menu.update = () => false;
g.menuCamera = () => {
  if (!pose) return;
  cam.position.set(...pose[0]);
  cam.lookAt(...pose[1]);
};
T.hour(0.5);
// (the game's own work in a frame, its callback's time: what is the processor's and not the card's)
const raf = window.requestAnimationFrame.bind(window);
let busy = 0, gpu = 0, gpuN = 0;
// (and the card's: a timer asked around the game's own frame, read back when the card has it)
const gl = R.getContext(), tq = gl.getExtension('EXT_disjoint_timer_query_webgl2'), queries = [];
const poll = () => {
  while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
    const q = queries.shift();
    if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) {
      gpu += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gpuN++;
    }
    gl.deleteQuery(q);
  }
};
window.requestAnimationFrame = (cb) => raf((t) => {
  const a = performance.now();
  let q = null;
  if (tq) {
    q = gl.createQuery();
    gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
  }
  cb(t);
  if (q) {
    gl.endQuery(tq.TIME_ELAPSED_EXT);
    queries.push(q);
  }
  busy += performance.now() - a;
  if (tq) poll();
});
// (passes.js) At the wall spot: the card's time a frame with everything on, and with one thing off at a time (the sun's
// shadow maps not drawn again; each pass of the composer), flipped every half second in turn, six rounds.
const [, at, to] = spots[1];
pose = [at, to];
T.tp(at[0], at[2], 0);
await T.wait(20000);
const comp = g.s.r.composer;
const passes = (comp?.passes ?? []).map((p, i) => [p, `${i}:${p.name || p.constructor.name}`]);
const states = [['all', () => {}, () => {}], ['noShadows', () => { R.shadowMap.autoUpdate = false; R.shadowMap.needsUpdate = false; }, () => { R.shadowMap.autoUpdate = true; }]];
for (const [p, label] of passes) states.push([`-${label}`, () => { p.__was = p.enabled; p.enabled = false; }, () => { p.enabled = p.__was; }]);
const got = Object.fromEntries(states.map((s) => [s[0], []]));
for (let round = 0; round < 6; round++) for (const [sn, on, off] of states) {
  on();
  await T.wait(200);
  gpu = gpuN = 0;
  await T.wait(300);
  if (gpuN) got[sn].push(gpu / gpuN);
  off();
}
const med = (a) => { const v = [...a].sort((p, q) => p - q); return +(v[v.length >> 1] ?? 0).toFixed(2); };
return JSON.stringify(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, med(v)])));
