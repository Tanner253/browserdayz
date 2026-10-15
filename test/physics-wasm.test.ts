// The separated binary must initialize the same physics engine and step the same world.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { extractPhysicsWasm, physicsWasm } from '../scripts/physics-wasm';

const source = fs.readFileSync('node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', 'utf8');
const result = extractPhysicsWasm(source);
assert.ok(result.code.length < source.length / 2);
const transform = physicsWasm().transform as (code: string, id: string) => { code: string } | undefined;
assert.ok(transform.call({}, source, '/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs?v=dev-cache')?.code.includes(result.fileName));
assert.equal(transform.call({}, source, '/some-other-module.mjs'), undefined);
const savedFetch = globalThis.fetch;
let fetched = 0;
globalThis.fetch = async (input) => {
  assert.equal(input, `/${result.fileName}`);
  fetched++;
  return new Response(new Uint8Array(result.bytes), { headers: { 'content-type': 'application/wasm' } });
};
try {
  const runtime = result.code.replace(/^\/\/# sourceMappingURL=.*$/gm, '');
  const extracted = (await import(`data:text/javascript;base64,${Buffer.from(runtime).toString('base64')}`)).default as typeof RAPIER;
  await Promise.all([RAPIER.init(), extracted.init()]);
  assert.equal(fetched, 1);
  assert.equal(extracted.version(), RAPIER.version());
  const run = (engine: typeof RAPIER) => {
    const world = new engine.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(engine.ColliderDesc.cuboid(10, 0.5, 10));
    const body = world.createRigidBody(engine.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
    world.createCollider(engine.ColliderDesc.ball(0.3), body);
    const positions = [];
    for (let i = 0; i < 180; i++) {
      world.step();
      const p = body.translation();
      positions.push([p.x, p.y, p.z]);
    }
    world.free();
    return positions;
  };
  assert.deepEqual(run(extracted), run(RAPIER));
  console.log(`ok   same Rapier version and 180 identical simulation steps; ${result.bytes.length} WASM bytes extracted unchanged`);
} finally {
  globalThis.fetch = savedFetch;
}
