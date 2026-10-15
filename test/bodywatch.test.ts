// How a body moves, watched for a program walking it (server/bodywatch.ts). What has to hold, in the owner's words
// ("we need to detect bots within a minute of joining"; "what about players falling a large distance or making a
// jump"):
//   - a new arrival who walks, sprints, jumps, falls a long way, climbs stairs, dances, strafes in a fight or steps
//     round a body they are looting is never sent back, in their first minute or in the five after it;
//   - the bots of 2026-10-15 are sent back inside their first minute: walking on air over the dips of the ground,
//     jittering to and fro with the head twitching, pacing to and fro with the head still.
//   npx tsx test/bodywatch.test.ts
import assert from 'node:assert/strict';
import { BodyWatch, FIRST, type Body } from '../server/bodywatch';

let checks = 0;
const ok = (what: string) => {
  checks++;
  console.log(`  ok  ${what}`);
};

/** rolling ground, with dips and rises of a few metres */
const ground = (x: number, z: number) => 120 + Math.sin(x / 23) * 4 + Math.cos(z / 31) * 3;
/** a building stands here, 12 by 10, with stairs to a roof 7 m up */
const HOUSE = { x: 300, z: 300, w: 12, d: 10 };
const nearHouse = (x: number, z: number) => Math.abs(x - HOUSE.x) < HOUSE.w / 2 + 4 && Math.abs(z - HOUSE.z) < HOUSE.d / 2 + 4;

/**
 * Plays a body for `secs` seconds at 15 tellings a second, the game's clock and the server's together.
 * @param at where the body is at t seconds: its x, its height over the ground (or `abs`: its height), its z, and whether a person's doing just happened
 * @returns the verdict and when it came (seconds after coming in), or null
 */
function run(secs: number, at: (t: number) => { x: number; z: number; h?: number; abs?: number; did?: boolean; free?: boolean }) {
  const joined = 1_000_000, w = new BodyWatch(joined);
  let did = -1e9;
  for (let k = 0; k <= secs * 15; k++) {
    const t = k / 15, now = joined + t * 1000, p = at(t);
    if (p.did) did = now;
    const y = p.abs ?? ground(p.x, p.z) + (p.h ?? 0);
    const b: Body = { t: 5_000_000 + t * 1000, x: p.x, y, z: p.z, under: ground(p.x, p.z), near: nearHouse(p.x, p.z), by: nearHouse(p.x, p.z), free: !!p.free, did };
    const v = w.see(b, now);
    if (v) return { why: v.why, at: t };
  }
  return null;
}

const SIX = 360;

// ---- people, in their first minute and the five after it: never sent back
{
  const people: [string, (t: number) => ReturnType<Parameters<typeof run>[1]>][] = [
    // walks and sprints across the rolling ground, stopping to look about now and then
    ['walks and sprints', (t) => ({ x: 100 + t * 4 + Math.sin(t / 3) * 6, z: 50 + Math.sin(t / 7) * 30, did: t % 40 < 0.07 })],
    // jumps as they go, a jump every two seconds: up 1.2 m and down inside 0.7 s
    ['jumps as they go', (t) => {
      const u = t % 2;
      return { x: 100 + t * 3, z: 80, h: u < 0.7 ? Math.max(0, 4.8 * u - 6.9 * u * u) : 0 };
    }],
    // falls a long way: out of a helicopter at 80 m (in its seat until 10 s), down at the pace of anything falling
    ['falls 80 m out of a helicopter', (t) => {
      if (t < 10) return { x: 200, z: 200, h: 80, free: true };
      const f = t - 10, h = Math.max(0, 80 - 4.9 * f * f);
      return { x: 200 + f * 2, z: 200, h };
    }],
    // climbs the house's stairs to its roof, stands there, comes down
    ['climbs stairs to a roof and stands on it', (t) => ({ x: HOUSE.x - 3 + (t % 30) / 10, z: HOUSE.z, h: Math.min(7, Math.max(0, ((t % 60) - 5) * 0.8)) })],
    // dances: an emote, chosen, and the feet on one spot (the dance moves them a little)
    ['dances', (t) => ({ x: 150 + Math.sin(t * 6) * 0.02, z: 150, did: true })],
    // strafes left and right in a fight, firing
    ['strafes in a fight', (t) => ({ x: 160 + Math.sin(t * 2.5) * 2, z: 160, did: t % 1.5 < 0.07 })],
    // steps round a body looting it, taking things
    ['steps round a body while looting it', (t) => ({ x: 170 + Math.sin(t) * 1.2, z: 170 + Math.cos(t) * 1.2, did: t % 3 < 0.07 })],
    // stands still a long while, watching a road
    ['stands still watching a road', () => ({ x: 180, z: 180 })],
    // walks round a tree in circles, doing nothing else
    ['walks round and round a tree', (t) => ({ x: 190 + Math.sin(t / 2) * 3, z: 190 + Math.cos(t / 2) * 3 })],
    // up a house's switchback stairs to the floor above, a flight of 4 m each way and 1.5 m up, turning at each landing,
    // and round its rooms there, taking a thing now and then (2026-10-15: a player sent back for "26 m walked, 8
    // turn-backs in 15 s", having gone up a house's stairs)
    ['goes up switchback stairs and round the rooms above', (t) => {
      const tri = (u: number, n: number) => n - Math.abs((u % (2 * n)) - n);
      if (t < 12) return { x: HOUSE.x - 2 + tri(t * 1.4, 4), z: HOUSE.z + (Math.floor((t * 1.4) / 4) % 2), h: Math.min(6, t * 0.5) };
      return { x: HOUSE.x - 4 + tri(t * 1.2, 7), z: HOUSE.z - 2 + Math.sin(t / 3) * 2, h: 6, did: t % 14 < 0.07 };
    }],
    // up the stairs and down again, and up again, doing nothing else for a minute
    ['goes up and down a house\'s stairs', (t) => {
      const tri = (u: number, n: number) => n - Math.abs((u % (2 * n)) - n);
      return { x: HOUSE.x - 2 + tri(t * 1.4, 4), z: HOUSE.z, h: tri(t * 0.5, 6) };
    }],
  ];
  for (const [what, at] of people) {
    const v = run(FIRST / 1000 + SIX, at);
    assert.equal(v, null, `somebody who ${what} was sent back: ${v?.why} at ${v?.at.toFixed(1)} s`);
  }
  ok(`people, in their first minute and six after: ${people.map(([w]) => w).join(', ')}: never sent back`);
}

// ---- the bots of 2026-10-15: sent back inside their first minute
{
  const bots: [string, (t: number) => ReturnType<Parameters<typeof run>[1]>][] = [
    // walking a straight line at one height, the ground falling away under it: 3 to 10 m up over the dips
    ['walks on air over the dips of the ground', (t) => ({ x: 400 + t * 3, z: 60, abs: 130 })],
    // jitters to and fro on the spot, the head twitching (what is not said is nothing done)
    ['jitters to and fro on the spot', (t) => ({ x: 220 + Math.sin(t * 9) * 0.5 + Math.sin(t * 2.3) * 0.2, z: 220 + Math.cos(t * 7) * 0.3 })],
    // paces to and fro, five metres each way
    ['paces to and fro', (t) => ({ x: 230 + Math.abs(((t * 4) % 10) - 5), z: 230 })],
    // hangs a few metres up and drifts
    ['hangs 4 m up and drifts', (t) => ({ x: 240 + Math.sin(t / 4) * 3, z: 240, h: 4 })],
    // paces to and fro on the flat, five metres each way, up and down a hand's breadth (the ground's own rise)
    ['paces to and fro on the flat', (t) => ({ x: 250 + Math.abs(((t * 4) % 10) - 5), z: 250, h: Math.sin(t) * 0.1 })],
  ];
  for (const [what, at] of bots) {
    const v = run(FIRST / 1000, at);
    assert.ok(v && v.at <= 60, `a program that ${what} was not sent back inside its first minute`);
    console.log(`      ${what}: sent back at ${v!.at.toFixed(0)} s (${v!.why})`);
  }
  ok(`the bots of 2026-10-15, sent back inside their first minute: ${bots.map(([w]) => w).join(', ')}`);
}

// ---- one pacing on one spot by a house, nothing done: by the gentler rules, sent back still, after a minute and a half of it
{
  const v = run(FIRST / 1000 + 240, (t) => ({ x: HOUSE.x + Math.abs(((t * 4) % 10) - 5), z: HOUSE.z + 7 }));
  assert.ok(v && v.at > 60 && v.at <= 240, `a program pacing by a house was ${v ? `sent back at ${v.at.toFixed(0)} s` : 'never sent back'}`);
  ok(`one pacing by a house is sent back by the gentler rules: at ${v!.at.toFixed(0)} s (${v!.why})`);
}

// ---- a sniper side to side behind cover in the open, watching a field and not firing, for two and a half minutes: not sent back
{
  const v = run(FIRST / 1000 + 150, (t) => (t < 70 ? { x: 100 + t * 2, z: 400 } : { x: 240 + Math.sin(t * 1.3) * 1.6, z: 400 }));
  assert.equal(v, null, `a sniper peeking behind cover was sent back: ${v?.why} at ${v?.at.toFixed(0)} s`);
  ok('a sniper peeking side to side behind cover for two and a half minutes is not sent back');
}

console.log(`\n${checks} checks passed`);
