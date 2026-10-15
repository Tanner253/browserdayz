// The emotes (src/sim/emotes.ts): every call says something and does something; every one of the pack's movements has
// a number of its own that fits the pose flags beside the others, and a clip in the built file
// (public/assets/characters/emotes.glb, scripts/emotes.mjs); the wheel's first eight are all there.
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { EMOTE, EMOTES, EMOTE_BY_N, EMOTE_MASK, EMOTE_SHIFT, WHEEL_DEFAULT, WHEEL_SLOTS } from '../src/sim/emotes';
import { F_CROUCH, F_DANCE, F_LIGHT, F_PRONE, F_SIT } from '../src/net/protocol';

let n = 0;
const ok = (c: boolean, what: string) => {
  assert.ok(c, what);
  n++;
};

ok(new Set(EMOTES.map((e) => e.id)).size === EMOTES.length, 'every emote has an id of its own');
for (const e of EMOTES.filter((x) => x.kind === 'call')) ok(!!e.say && !!e.move && (e.dur ?? 0) > 0, `the call ${e.id} says something and does something`);
for (const id of ['dontshoot', 'yes', 'no', 'follow', 'wait']) ok(EMOTE[id]?.kind === 'call', `the call ${id} is there`);

const pack = EMOTES.filter((e) => e.clip);
ok(pack.length === 28, `the owner's 28 from the pack (${pack.length})`);
const nums = pack.map((e) => e.n!);
ok(new Set(nums).size === nums.length && nums.every((x) => x >= 1 && x <= 127), 'each has a number of its own, 1 to 127');
for (const e of pack) ok(EMOTE_BY_N[e.n!] === e && e.hold === 'dance', `${e.id} is found by its number, and danced`);
// (the number rides in the pose flags above every flag there is, and comes back out whole)
const flags = F_CROUCH | F_DANCE | F_SIT | F_PRONE | F_LIGHT;
ok((flags & EMOTE_MASK) === 0, 'no flag is where the number goes');
for (const e of pack) {
  const f = flags | (e.n! << EMOTE_SHIFT);
  ok((f & EMOTE_MASK) >> EMOTE_SHIFT === e.n && (f & ~EMOTE_MASK) === flags, `${e.id}'s number in the flags comes back as it went`);
}

ok(WHEEL_DEFAULT.length === WHEEL_SLOTS && WHEEL_DEFAULT.every((id) => !!EMOTE[id]), 'the first wheel is eight that are there');

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read('public/assets/characters/emotes.glb');
const clips = new Set(doc.getRoot().listAnimations().map((a) => a.getName()));
for (const e of pack) ok(clips.has(e.clip!), `the built file has ${e.clip}`);
// (every number in every track a number: one track of a single key once made the dab's whole upper body NaN)
for (const a of doc.getRoot().listAnimations()) ok(a.listChannels().every((c) => [...c.getSampler()!.getOutput()!.getArray()!].every(Number.isFinite)), `every value of ${a.getName()} is a number`);

console.log(`emotes: ${n} checks passed`);
