// The walk-through audit's standing checks, after any change to how the body moves: steps lost on open floors by
// kind of building, slides along the police station's walls, sprints across open country. (Each part by itself:
// more than about 20 s of it in one go is cut off.)
const g = window.__game;
await T.boot();
await (await import('/tmp-audit.js?v=' + Date.now())).install();
const A = window.A;
A.fresh();
A.doorsSolid(false);
const out = [];
for (const t of ['police', 'guardpost', 'house_brick', 'house_small', 'barn', 'cabin']) {
  const r = A.floorAudit(A.pick(t));
  out.push(`floor ${t.padEnd(12)} ${r.steps} steps: ${r.lost} lost, ${r.short} short, ${r.air} off the ground`);
  await T.wait(50);
}
const w = A.wallSlides(A.pick('police'), A.POLICE_WALLS);
out.push(`wall slides: ${w.tests} runs, ${w.steps} steps, ${w.lost} lost; share of the frictionless pace, least / middle / most: ${w.pct.join(' / ')} %; slowest: ${w.slowest.join('; ')}`);
await T.wait(50);
const c = A.country(40);
out.push(`open country: ${c.runs} sprints, ${c.steps} steps: ${c.slow} slow, ${c.lost} lost, ${c.air} off the ground`);
A.doorsSolid(true);
return out.join('\n');
