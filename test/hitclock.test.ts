// How often a shooter's hits on one body are believed (src/sim/hitclock.ts): an automatic's rounds that arrive two
// together are both believed; a run of hits faster than the gun fires is not; a shell's pellets on several bodies are,
// up to three bodies inside one gap.
import assert from 'node:assert/strict';
import { paced, type Hits } from '../src/sim/hitclock';

let n = 0;
const ok = (c: boolean, what: string) => {
  assert.ok(c, what);
  n++;
};
// the AK: a round each tenth of a second, a hit believed no oftener than 0.7 of that
const GAP = 100 * 0.7;

{
  // fired 100 ms apart, arriving as a line carries them: the second and third together
  const m: Hits = new Map();
  const arrived = [0, 190, 200, 300, 400, 520, 530, 600];
  const believed = arrived.filter((t) => paced(m, 'i1', t, GAP));
  ok(believed.length === arrived.length, `every round of a burst whose arrivals bunch is believed (${believed.length} of ${arrived.length})`);
}
{
  // a game that sends hits as fast as it likes: held to the gun's pace over the run, with one early
  const m: Hits = new Map();
  let got = 0;
  for (let t = 0; t <= 1000; t += 10) if (paced(m, 'i1', t, GAP)) got++;
  ok(got <= Math.floor(1000 / GAP) + 2, `a hundred hits in a second are held to the gun's pace (${got} believed)`);
  ok(got >= Math.floor(1000 / GAP), `and as many as the gun could have fired are (${got})`);
}
{
  // two arriving together after a pause: both; a third at once: not
  const m: Hits = new Map();
  ok(paced(m, 'p7', 5000, GAP) && paced(m, 'p7', 5001, GAP), 'two together are both believed');
  ok(!paced(m, 'p7', 5002, GAP), 'a third with them is not');
}
{
  // a shell's pellets on four bodies at once: three of them
  const m: Hits = new Map();
  const bodies = ['i1', 'i2', 'i3', 'i4'].filter((b) => paced(m, b, 100, GAP));
  ok(bodies.length === 3, `a shell reaches three bodies inside a gap, not four (${bodies.length})`);
}
{
  // and what is long past is forgotten
  const m: Hits = new Map();
  paced(m, 'i1', 0, GAP);
  paced(m, 'i2', 10, GAP);
  paced(m, 'i3', 9000, GAP);
  ok(!m.has('i1') && !m.has('i2') && m.has('i3'), 'hits more than five seconds old are let go of');
}
console.log(`hitclock: ${n} checks passed`);
