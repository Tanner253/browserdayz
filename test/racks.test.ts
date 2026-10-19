// Every rack on the map, the gun rack and the racks of boards, in a building, a field post, the bunker or the fort,
// stands into nothing (a wall, a door's way, a window, another piece of furniture) and has its back to a wall, square
// to it: scripts/rack-audit.ts, which says which and where when one does not. Racks were stood by numbers typed by eye,
// and every barracks' gun rack stood 9 cm into its wall ("the weapon rack in zstava and pretty much all location slips
// into the wall", the owner, 2026-10-19). `npx tsx test/racks.test.ts`.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const run = spawnSync(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/rack-audit.ts'], { encoding: 'utf8' });
process.stdout.write(run.stdout.split('\n')[0] + '\n');
assert.equal(run.status, 0, `racks stood wrong:\n${run.stdout}${run.stderr}`);
console.log('racks: all clear');
