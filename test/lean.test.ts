// A computer's copies of the model files (scripts/lean.mjs) are of the files as they are now. A copy is named by the
// version of the file it was made from, so a model changed since is loaded whole (the same picture, all of its bytes
// downloaded): this says which, so the copies are made again before a deploy. Under a second.
//   npx tsx test/lean.test.ts

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('public/assets');
const LEAN = path.join(ROOT, 'lean');
const copies = new Map<string, Set<string>>();
for (const cap of fs.existsSync(LEAN) ? fs.readdirSync(LEAN) : []) {
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, f.name);
      if (f.isDirectory()) walk(file);
      const m = /^(.*)\.([0-9a-f]{10})\.glb$/.exec(path.relative(path.join(LEAN, cap), file).split(path.sep).join('/'));
      if (m) copies.set(m[1], (copies.get(m[1]) ?? new Set()).add(m[2]));
    }
  };
  walk(path.join(LEAN, cap));
}
assert.ok(copies.size > 0, 'no copies: node scripts/lean.mjs');
const stale: string[] = [];
for (const [rel, versions] of copies) {
  const file = path.join(ROOT, `${rel}.glb`);
  const now = fs.existsSync(file) ? createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10) : 'gone';
  if (!versions.has(now)) stale.push(`${rel}.glb`);
}
assert.deepEqual(stale, [], `copies made from older files (node scripts/lean.mjs): ${stale.join(', ')}`);
console.log(`lean: ${copies.size} copies, all of the files as they are`);
