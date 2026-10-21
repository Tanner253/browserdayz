// What is drawn on a mode's page at fixed spots (2026-10-21, every mode built whole and switched in place: "nothing ships
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
/** a frame's draws and triangles, the picture's and the shadow maps', and its time: the average of 60 frames */
const count = async () => {
  const main = [0, 0], shadow = [0, 0], N = 60, names = new Map();
  let on = false;
  const rbd = R.renderBufferDirect.bind(R);
  R.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
    if (!on) return rbd(camera, scene, geometry, material, object, group);
    const m = material.isMeshDepthMaterial || material.isMeshDistanceMaterial || /Depth|Distance/.test(material.type) ? shadow : main;
    const t0 = R.info.render.triangles;
    const r = rbd(camera, scene, geometry, material, object, group);
    m[0]++;
    m[1] += R.info.render.triangles - t0;
    if (m === main) {
      // (by what is drawn: its nearest named parent, as progress/opt/draw-census.js)
      let name = '';
      for (let o = object; o && !name; o = o.parent) name = o.name;
      name = (name || object.type).replace(/:\d+$/, '').slice(0, 28);
      const e = names.get(name) ?? [0, 0];
      e[0]++;
      e[1] += R.info.render.triangles - t0;
      names.set(name, e);
    }
    return r;
  };
  const tick = () => new Promise((r) => raf(r));
  await tick();
  on = true;
  busy = 0;
  gpu = gpuN = 0;
  const t0 = performance.now();
  for (let k = 0; k < N; k++) await tick();
  const ms = (performance.now() - t0) / N, cpu = busy / N;
  on = false;
  R.renderBufferDirect = rbd;
  const top = [...names].sort((a, b) => b[1][1] - a[1][1]).slice(0, Q_ALL ? 999 : 12).map(([k, [d, t]]) => `${k} ${Math.round(d / N)}/${Math.round(t / N / 1000)}k`);
  return { top, draws: Math.round(main[0] / N), tris: Math.round(main[1] / N / 1000) + 'k', shadowDraws: Math.round(shadow[0] / N), shadowTris: Math.round(shadow[1] / N / 1000) + 'k', ms: Math.round(ms * 10) / 10, cpu: Math.round(cpu * 100) / 100, gpu: gpuN ? Math.round((gpu / gpuN) * 100) / 100 : null };
};
// (`#settle`: a minute at the first spot before anything is counted, for whatever the page still does behind the menu)
let first = location.hash === '#settle';
for (const [name, at, to] of spots) {
  pose = [at, to];
  if (first) {
    T.tp(at[0], at[2], 0);
    await T.wait(60000);
    first = false;
  }
  // (the player stood there too: what is shown by nearness to the player, door handles and cellars' bulbs, as in a game)
  T.tp(at[0], at[2], 0);
  await T.wait(7000);
  out.spots[name] = await count();
  await shot(name);
}
out.trees = g.s.world.trees.length;
out.buildings = g.s.world.buildings.length;
return JSON.stringify(out);
