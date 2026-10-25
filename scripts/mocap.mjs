// The survivors' movements, motion capture from Higgsfield's rigging library carried onto our skeleton (the owner,
// 2026-10-25: "i want to make use of their body rigging and animations so we can rehaul our body movement"; "we want
// tarkov quality military animations realism"): how each is carried is scripts/mocap-carry.mjs, what is done to each
// once on our body (squared, stood up, its heel first, cut) scripts/mocap-pose.mjs.
//   node scripts/mocap.mjs              public/assets/characters/moves.glb and moves-late.glb, their table src/game/avatar/moves.json
//   node scripts/mocap.mjs --cands      every movement harvested, on the whole body, for the sandbox (progress/anim-tools/cands.glb)
import { prune, cloneDocument, resample } from '@gltf-transform/functions';
import * as THREE from 'three';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { heelFirst, leftOf, reshape, trim, wayOf, facing, readClip, goes } from './mocap-pose.mjs';
import { ROOT, SRC, io, loadBody, carry as carryOnto } from './mocap-carry.mjs';
export { meshyBone } from './mocap-carry.mjs';

/**
 * The movements kept, by the game's name. `from` the library's; `way` which way a step goes (F B L R and the corners:
 * a loop, stepped by the game in time with the ground); `gait` which set of steps it is one of; `mirror` the library's
 * done the other way about; `square` turned to face ahead, its hips kept turned by that share (see reshape); `stand`
 * a crouched one stood up (to the hips of `stand`, and squared); `head` let down until its head is that high on the
 * whole (metres, as the file stands); `cut` the seconds of it kept;
 * `late` loaded the first time it is wanted, not with the body. The owner, 2026-10-25: "we want tarkov quality military
 * animations realism".
 */
export const MOVES = {
  // standing still, breathing, the weight shifting a little (the library's 'Idle' turns round to look behind it: a
  // body that is seen to look elsewhere than it aims tells lies in a shooter)
  idle: { from: 'Idle_02', square: 0.5 },
  // standing, nothing held up: an easy walk
  walkF: { from: 'walking_2', way: 'F', gait: 'walk' },
  walkB: { from: 'Walk_Backward', way: 'B', gait: 'walk' },
  // a gun up: the knees soft, the chest still over them (the bow's walk: the arms are the gun's)
  // (raised toward the walk's hips and its chest's lean, as far as the legs let them: the eye does not go down with the
  // knees, and a head drawn under the eye was a head under cover the eye could shoot over)
  aimF: { from: 'Walk_Forward_with_Bow_Aimed', way: 'F', gait: 'aim', square: 0, stand: 'walkF' },
  aimB: { from: 'Walk_Backward_with_Bow_Aimed', way: 'B', gait: 'aim', square: 0, stand: 'walkB' },
  // (no side steps: the library's one standing is a crouched one, and stood up it was a bow-legged cross-step. The walks
  // and the crouch go to a side as the old clips did, ahead with the hips turned: see src/game/avatar/gait.ts GAITS)
  // a jog, eight ways (left and right are the corners between)
  jogF: { from: 'Run_02', way: 'F', gait: 'jog' },
  jogFL: { from: 'ForwardLeft_Run_Fight', way: 'FL', gait: 'jog', square: 0.5 },
  // (its feet are not read: it is the other's twin, at the other's pace)
  jogFR: { from: 'ForwardRight_Run_Fight', way: 'FR', gait: 'jog', pace: 5.321, square: 0.5 },
  jogBL: { from: 'BackLeft_run', way: 'BL', gait: 'jog', square: 0.5 },
  jogBR: { from: 'BackRight_Run', way: 'BR', gait: 'jog', square: 0.5 },
  // flat out: empty handed, and with a gun (the arms are the gun's)
  sprint: { from: 'run_fast_2', way: 'F', gait: 'sprint' },
  sprintGun: { from: 'Rifle_Charge', way: 'F', gait: 'sprint' },
  // the cautious crouch, ahead and back (to a side it is turned, as the walks are), let down to the old crouch's head
  // (0.92 m as the file stands, under the crouched eye: the library's carries it a third of a metre higher)
  crouchF: { from: 'Cautious_Crouch_Walk_Forward', way: 'F', gait: 'crouch', square: 0.4, head: 0.92 },
  crouchB: { from: 'Cautious_Crouch_Walk_Backward', way: 'B', gait: 'crouch', square: 0.4, head: 0.92 },
  // on a broken leg
  limpF: { from: 'Limping_Walk_1', way: 'F', gait: 'limp', square: 0.5 },
  limpB: { from: 'Injured_Walk_Backward', way: 'B', gait: 'limp', square: 0.5 },
  // going down: shot onto the back (the stagger before it cut), pitched onto the face, folded onto the side; where each
  // ends up lying is said (`rest`), for the box searched on the body
  deathB: { from: 'Shot_and_Fall_Backward', cut: [1.3, 3.53] },
  deathF: { from: 'Shot_and_Fall_Forward' },
  deathS: { from: 'Fall_Dead_from_Abdominal_Injury' },
  // a shot taken, in the body and in the head
  hitBody: { from: 'Hit_Reaction', cut: [0, 1.0] },
  hitHead: { from: 'Gunshot_Reaction', cut: [0, 0.9] },
  // the everyday things the hands do: something taken up off the ground, a drink
  pickUp: { from: 'Male_Bend_Over_Pick_Up', cut: [0.7, 2.5] },
  // a blow with what is in the right fist (a hatchet, a knife, a bat): drawn up and back, and brought down across
  slash: { from: 'Right_Hand_Sword_Slash' },
  drink: { from: 'Stand_and_Drink', cut: [1.8, 6.0], mirror: true },
  // and the rarer, fetched the first time any is wanted: a ladder, the water, a bedroll, a hatchet, a sledgehammer, a
  // grenade, a wall to go over, fists
  ladder: { from: 'Ladder_Climb_Loop', still: true, late: true },
  swim: { from: 'Swim_Forward', still: true, late: true },
  tread: { from: 'Swim_Idle', still: true, late: true },
  sleep: { from: 'Sleep_Normally', still: true, late: true },
  chop: { from: 'Charged_Axe_Chop', cut: [2.6, 5.4], late: true },
  hammer: { from: 'Heavy_Hammer_Swing', late: true },
  throw: { from: 'Crouch_Pull_and_Throw', cut: [3.3, 5.3], late: true },
  vault: { from: 'Unarmed_Vault', late: true },
  jabR: { from: 'Right_Jab_from_Guard', cut: [0, 1.0], late: true },
  jabL: { from: 'Left_Jab_from_Guard', cut: [0, 1.0], late: true },
};

const cands = process.argv.includes('--cands');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const body = await loadBody(), { doc, sk } = body;
const report = {};
const carry = async (file, clip, o) => (report[clip] = await carryOnto(body, file, clip, o));

if (!cands) {
  const left = leftOf(sk), table = {};
  // (in an order that has each one a crouch is stood up to already made)
  const names = Object.keys(MOVES).sort((a, b) => !!MOVES[a].stand - !!MOVES[b].stand);
  for (const name of names) {
    const m = MOVES[name];
    await carry(m.from, name, { mirror: !!m.mirror, still: m.still ?? !!m.way });
    const said = {};
    said.was = facing(doc, sk, name);
    if (m.square !== undefined || m.stand || m.head) Object.assign(said, reshape(doc, sk, name, { keep: m.square ?? 0, ref: m.stand ?? null, head: m.head ?? null }));
    if (m.way) said.start = +heelFirst(doc, sk, name, wayOf(m.way, left)).toFixed(3);
    if (m.cut) trim(doc, sk, name, m.cut[0], m.cut[1]);
    const r = report[name], got = readClip(doc, sk, name);
    // (its pace: by the hips where it travels, by the feet where it was drawn on the spot; and a loop that goes another
    // way than it is said to stops the build: the library's 'Walk_Left_with_Gun' steps to the right, and was laid in
    // as a step to the left, its feet sliding along with the body)
    if (m.way) {
      const went = goes(doc, sk, name), want = { F: 0, FL: 45, L: 90, BL: 135, B: 180, BR: -135, R: -90, FR: -45 }[m.way];
      if (Math.abs(((went.deg - want + 540) % 360) - 180) > 40) throw new Error(`${name} goes ${went.deg} degrees to the left of its front, not ${m.way}`);
    }
    table[name] = { ...(m.way ? { way: m.way, gait: m.gait, pace: m.pace ?? (r.hips > 0.3 ? r.hips : r.pace) } : {}), dur: +got.dur.toFixed(3), ...(m.late ? { late: true } : {}) };
    // (a fall: where the hips end up lying from where it stood, metres ahead and to the left)
    if (/^death/.test(name)) {
      const P = sk.index('pelvis'), a = sk.pose(got.qAt(0), got.tAt(0))[P], b = sk.pose(got.qAt(got.frames), got.tAt(got.frames))[P];
      const d = new THREE.Vector3().setFromMatrixPosition(b).sub(new THREE.Vector3().setFromMatrixPosition(a));
      table[name].rest = [+d.z.toFixed(2), +(d.x * left).toFixed(2)];
    }
    // (a climb: how far the hips rise a second, as captured)
    if (name === 'ladder') table[name].rise = +(r.along[1] / r.dur).toFixed(3);
    if (Object.keys(said).length) console.log(' ', name, JSON.stringify(said));
  }
  // (and as they are on the body, beside its old clips: for the sandbox)
  await io.write(path.join(ROOT, 'progress', 'anim-tools', 'moves-body.glb'), doc);
  // the body's own file of them, and the late one: the skeleton and the movements, nothing of the body
  for (const late of [false, true]) {
    const out = cloneDocument(doc), r = out.getRoot();
    // (an animation let go of takes its channels and samplers with it, or what they hold is written all the same)
    for (const a of r.listAnimations()) {
      if (MOVES[a.getName()] && !!MOVES[a.getName()].late === late) continue;
      for (const c of a.listChannels()) c.dispose();
      for (const x of a.listSamplers()) x.dispose();
      a.dispose();
    }
    for (const n of r.listNodes()) {
      n.setMesh(null);
      n.setSkin(null);
    }
    for (const m of r.listMeshes()) m.dispose();
    for (const s of r.listSkins()) s.dispose();
    for (const t of r.listTextures()) t.dispose();
    for (const m of r.listMaterials()) m.dispose();
    // (keys a straight line between their neighbours would give are left out, and every turn is kept in 16 bits, as
    // glTF lets a turn be: the movements in half the bytes, none of it to be seen)
    await out.transform(resample({ tolerance: 2e-3 }), prune({ keepLeaves: true }));
    for (const a of r.listAnimations()) for (const c of a.listChannels()) {
      if (c.getTargetPath() !== 'rotation') continue;
      const acc = c.getSampler().getOutput(), v = acc.getArray();
      if (!(v instanceof Float32Array)) continue;
      acc.setArray(Int16Array.from(v, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767))).setNormalized(true);
    }
    // (the relaxed hand is the same in every movement: one key, one accessor a finger joint, shared by all of them)
    const one = out.createAccessor().setType('SCALAR').setArray(new Float32Array([0])), held = new Map();
    for (const a of r.listAnimations()) for (const c of a.listChannels()) {
      const n = c.getTargetNode(), s = c.getSampler();
      if (c.getTargetPath() !== 'rotation' || !/^(thumb|index|middle|ring|pinky)_/.test(n.getName())) continue;
      if (!held.has(n)) held.set(n, out.createAccessor().setType('VEC4').setArray(s.getOutput().getArray().slice(0, 4)).setNormalized(s.getOutput().getNormalized()));
      s.setInput(one).setOutput(held.get(n)).setInterpolation('STEP');
    }
    // (no meshopt: it packs meshes, and laid over movements it gave back their 32 bits)
    await out.transform(prune({ keepLeaves: true }));
    for (const e of r.listExtensionsUsed()) e.dispose();
    const file = path.join(ROOT, 'public', 'assets', 'characters', late ? 'moves-late.glb' : 'moves.glb');
    await io.write(file, out);
    console.log('wrote', path.relative(ROOT, file));
  }
  writeFileSync(path.join(ROOT, 'src', 'game', 'avatar', 'moves.json'), JSON.stringify(table, null, 1) + '\n');
  // Where the hands go in the movements the first-person arms are moved by (src/game/held-mocap.ts): each hand's
  // place and turn from the head, frame by frame, in the eye's own measure (x to the right, y up, z back), and for a
  // drink how near the right hand is to the mouth. What is seen from the eye is then what everybody else sees.
  const hands = {}, H = sk.index('Head'), HR = sk.index('hand_r'), HL = sk.index('hand_l');
  const eye = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), left > 0 ? Math.PI : 0);
  const round = (x) => +x.toFixed(4);
  for (const name of ['drink', 'throw', 'jabR', 'jabL', 'slash', 'chop', 'hammer', 'pickUp', 'ladder', 'swim']) {
    const c = readClip(doc, sk, name), r = [], l = [], mouth = [];
    for (let f = 0; f <= c.frames; f++) {
      const W = sk.pose(c.qAt(f), c.tAt(f)), head = new THREE.Vector3().setFromMatrixPosition(W[H]);
      const of = (i, to) => {
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        W[i].decompose(p, q, s);
        p.sub(head).applyQuaternion(eye);
        q.premultiply(eye);
        to.push([p.x, p.y, p.z, q.x, q.y, q.z, q.w].map(round));
        return p;
      };
      const pr = of(HR, r);
      of(HL, l);
      // (the mouth: a hand's breadth down from the head joint and a little ahead of it)
      mouth.push(round(pr.distanceTo(new THREE.Vector3(0, -0.06, -0.1))));
    }
    const near = Math.min(...mouth), far = Math.max(...mouth);
    hands[name] = { dur: +c.dur.toFixed(3), r, l, ...(name === 'drink' ? { mouth: mouth.map((d) => round(1 - (d - near) / Math.max(1e-3, far - near))) } : {}) };
  }
  writeFileSync(path.join(ROOT, 'src', 'game', 'avatar', 'hands.json'), JSON.stringify(hands) + '\n');
  console.log('wrote src/game/avatar/hands.json', (JSON.stringify(hands).length / 1024).toFixed(0), 'KB');
}

if (cands) {
  // every movement harvested, as it came, beside the old clips: for judging in the sandbox
  const files = readdirSync(SRC).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).filter((f) => !only || only.includes(f));
  const once = /Fall|Knock|Reaction|Pick_Up|Drink|Chop|Swing|Throw|Vault|Jab/;
  for (const f of files) {
    await carry(f, 'mc_' + f, { still: !once.test(f) });
    if (/Left/.test(f) && !files.includes(f.replace('Left', 'Right'))) await carry(f, 'mc_' + f.replace('Left', 'Right') + '_M', { mirror: true });
  }
  const out = path.join(ROOT, 'progress', 'anim-tools', 'cands.glb');
  await io.write(out, doc);
  writeFileSync(path.join(ROOT, 'progress', 'anim-tools', 'cands.json'), JSON.stringify(report, null, 1));
  console.log('wrote', path.relative(ROOT, out));
}
