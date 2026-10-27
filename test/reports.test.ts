// Reports from the death screen (server/reports.ts): one a death, only of a recent death, with the death as the server
// knew it in the admin's lines; kept and read back.
import assert from 'node:assert/strict';
import { ago, reportLines, reports, type DeathRecord } from '../server/reports';

const death = (): DeathRecord => ({ at: Date.now(), cause: 'shot', by: { name: 'Wallman', key: 'k-wall', fp: 'abcdef1234', flags: 3, at: [10, 2, 20] }, w: 'mosin', zone: 'head', dist: 41, at3: [40, 2, 30] });

assert.equal(reports.make({ name: 'Ann', key: 'k-ann' }, undefined, 'Aimbot', 'x'), 'There is no death of yours to report');
const d = death();
const r = reports.make({ name: 'Ann', key: 'k-ann' }, d, 'Shot through a wall', '  he shot me   through the barn  ');
assert.ok(typeof r !== 'string');
assert.equal(r.text, 'he shot me through the barn');
assert.equal(reports.make({ name: 'Ann', key: 'k-ann' }, d, 'Aimbot', ''), 'That death is reported already', 'one report a death');
assert.equal((reports.make({ name: 'Bo', key: 'k-bo' }, death(), 'made up', '') as { reason: string }).reason, 'Something else', 'a reason not on the list');
const old = death();
old.at -= 60 * 60_000;
assert.equal(reports.make({ name: 'Cy', key: 'k-cy' }, old, 'Aimbot', ''), 'There is no death of yours to report', 'a death an hour old');

const lines = reportLines(r, ago).join('\n');
for (const s of ['Ann reports Wallman', 'Shot through a wall', 'killed by Wallman with mosin, head at 41 m', 'flagged 3x', 'dev:abcdef12']) assert.ok(lines.includes(s), `the lines miss "${s}":\n${lines}`);
assert.equal(reports.latest(5)[0].from.name, 'Bo', 'the newest first');
reports.restore(JSON.parse(JSON.stringify(reports.keep())));
assert.equal(reports.latest(10).length, 2, 'read back over itself: none twice');
console.log('reports ok');
