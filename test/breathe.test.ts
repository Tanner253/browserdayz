// Work shared out a little to a frame (src/core/breathe.ts): that all of it gets done, in the order asked for, and
// that no frame is given more than its share and one piece over.
//   npx tsx test/breathe.test.ts
import assert from 'node:assert/strict';

// a page with frames sixty times a second, as far as the thing under test can tell
const frames: (() => void)[] = [];
let perFrame = 0, worstFrame = 0, frameCount = 0;
(globalThis as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f) => frames.push(f);
(globalThis as unknown as { document: { hidden: boolean } }).document = { hidden: false };
const tick = setInterval(() => {
  worstFrame = Math.max(worstFrame, perFrame);
  perFrame = 0;
  frameCount++;
  for (const f of frames.splice(0)) f();
}, 16);

const { breathe, Line } = await import('../src/core/breathe');

/** a piece of work that takes this long */
const busy = (ms: number) => {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { /* working */ }
  perFrame += ms;
};

// --- many bodies asked for at once, made one after another through a line, the marked ones first
{
  const line = new Line(), order: string[] = [];
  const body = (name: string, first: boolean) =>
    line.take(first, async () => {
      for (let part = 0; part < 21; part++) {
        await breathe();
        busy(1.2);
      }
      order.push(name);
    });
  const all = [];
  for (let i = 0; i < 40; i++) all.push(body(`infected ${i}`, false));
  all.push(body('a player', true));
  // meanwhile, things for the ground being shaped, each with a few big pieces
  const shaped: number[] = [];
  const things = new Line();
  for (let i = 0; i < 12; i++) {
    all.push(things.take(false, async () => {
      for (let part = 0; part < 6; part++) {
        await breathe();
        busy(2.5);
      }
      shaped.push(i);
    }));
  }
  const t0 = performance.now(), f0 = frameCount;
  await Promise.all(all);
  const took = performance.now() - t0, work = 41 * 21 * 1.2 + 12 * 6 * 2.5;
  assert.equal(order.length, 41, 'every body is made');
  assert.equal(order[0], 'infected 0', 'the one being made when the player was asked for is finished first');
  assert.equal(order[1], 'a player', 'and the player next, before the rest of the infected');
  assert.deepEqual(order.slice(2), Array.from({ length: 39 }, (_, i) => `infected ${i + 1}`), 'the rest in the order they were asked for');
  assert.deepEqual(shaped, Array.from({ length: 12 }, (_, i) => i), 'things are shaped in order');
  // (A share is 3 ms or a fifth of the frame, and a piece begun inside it may run over: 2.5 ms here. This machine's
  // clock gives frames of 16 or of 31 ms, so a share is up to 6.2. Let go all at once, as they were before they
  // were made to take turns, it would be 49.)
  assert.ok(worstFrame <= 6.2 + 2.5 + 2.5, `no frame is given more than its share and a piece over: the most was ${worstFrame.toFixed(1)} ms`);
  // (and the share is used: the work is not left waiting on frames that had room for it)
  assert.ok(frameCount - f0 <= (work / 3) * 1.6 + 10, `it took ${frameCount - f0} frames for ${work.toFixed(0)} ms of work`);
  console.log(`ok   41 bodies and 12 things: ${work.toFixed(0)} ms of work over ${frameCount - f0} frames (${took.toFixed(0)} ms), the most in one frame ${worstFrame.toFixed(1)} ms`);
}

// --- a page nobody is looking at: done at once, no frames waited for
{
  (globalThis as unknown as { document: { hidden: boolean } }).document.hidden = true;
  const f0 = frameCount, t0 = performance.now();
  for (let part = 0; part < 30; part++) {
    await breathe();
    busy(1);
  }
  assert.ok(frameCount - f0 <= 3, 'hidden: no waiting on frames');
  console.log(`ok   hidden page: 30 ms of work in ${(performance.now() - t0).toFixed(0)} ms`);
  (globalThis as unknown as { document: { hidden: boolean } }).document.hidden = false;
}

// --- slow frames (five a second): the share grows with them
{
  clearInterval(tick);
  worstFrame = 0;
  const slow = setInterval(() => {
    worstFrame = Math.max(worstFrame, perFrame);
    perFrame = 0;
    frameCount++;
    // (the frame itself is long: the page is busy drawing for most of it)
    const t0 = performance.now();
    while (performance.now() - t0 < 150) { /* drawing */ }
    for (const f of frames.splice(0)) f();
  }, 200);
  const f0 = frameCount, t0 = performance.now();
  for (let part = 0; part < 100; part++) {
    await breathe();
    busy(2);
  }
  clearInterval(slow);
  const took = performance.now() - t0;
  // (200 ms of work: at a fixed 3 ms a frame it would be 67 frames, 13 seconds; a fifth of each frame is 7 frames or so)
  assert.ok(took < 5000, `slow frames: 200 ms of work took ${took.toFixed(0)} ms`);
  console.log(`ok   slow frames: 200 ms of work in ${frameCount - f0} frames (${took.toFixed(0)} ms), the most in one ${worstFrame.toFixed(0)} ms`);
}
process.exit(0);
