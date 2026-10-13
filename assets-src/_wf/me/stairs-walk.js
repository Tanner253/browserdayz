// The stair of a Kamenka brick block walked with the player's real physics, as the user walks it: up each flight
// looking straight up it, with W alone and with A or D held as well (a shoulder on the wall or the rail). For
// each: how many steps to the top against walking it straight, the longest run of steps that went nowhere, and
// which side it ended on.   ?b=<type> for another building of that kind near Kamenka (the first found).
const g = window.__game;
await T.boot();
await (await import('/tmp-audit.js?v=' + Date.now())).install();
const A = window.A, P = g.player;
const b = g.s.world.buildings.find((q) => q.type === 'townhouse' && Math.hypot(q.x - 625, q.z - 365) < 200);
T.tp(b.x, b.z, 0, b.floorY + 0.3);
await T.wait(2500);
const c = Math.cos(b.rot), s = Math.sin(b.rot);
/** [name, where it starts (x, z, height), which way it runs (z: +1 or -1), the z it is done at] */
const flights = [
  ['first flight (up, +z)', [2.0, 1.0, 0.36], 1, 3.0],
  ['from the hall (up, +z)', [2.0, 0.1, 0.25], 1, 3.0],
  ['second flight (up, -z)', [3.2, 3.4, 2.15], -1, 1.35],
  ['first flight (down, -z)', [2.0, 3.0, 1.6], -1, 0.3],
  ['second flight (down, +z)', [3.2, 1.0, 3.4], 1, 3.3],
];
const out = [`${b.id}`];
for (const [name, from, dz, end] of flights) {
  // (looking along the building's z, the way the flight runs)
  const wx = dz * s, wz = dz * c, yaw = Math.atan2(-wx, -wz);
  for (const held of [['KeyW'], ['KeyW', 'KeyA'], ['KeyW', 'KeyD'], ['KeyW', 'ShiftLeft'], ['KeyW', 'ShiftLeft', 'KeyA'], ['KeyW', 'ShiftLeft', 'KeyD']]) {
    A.place(b, from);
    P.yaw = yaw;
    A.settle(20);
    const rec = A.walk(held, 300, { yawAt: () => yaw, until: (p) => { const l = A.toLocal(b, p.x, p.z); return dz > 0 ? l.z >= end : l.z <= end; } });
    let stuck = 0, worst = 0;
    for (const r of rec.slice(8)) { if (r.s3 < 0.5) { stuck++; worst = Math.max(worst, stuck); } else stuck = 0; }
    const at = A.here(b), done = dz > 0 ? at[1] >= end : at[1] <= end;
    out.push(`${name.padEnd(26)} ${held.map((k) => k.replace('Key', '').replace('ShiftLeft', 'sprint')).join('+').padEnd(12)} ${done ? 'TOP' : 'NOT THERE'} in ${String(rec.length).padStart(3)} steps, longest stuck ${String(worst).padStart(3)}; ends at ${at.join(', ')}`);
  }
}
return out.join('\n');
