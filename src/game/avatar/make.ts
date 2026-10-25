// The body: making it from its file (the skeleton the clips play on, the one drawn, the first-person copy), its look, and putting it away.
// (Methods of Avatar cut out of avatar.ts whole on 2026-10-24, so that they can be read and worked on alone: put back on
// Avatar.prototype as the file loads. Nothing in them was changed but `this: Avatar` said as the first parameter.)

import * as THREE from 'three';
import { breathe } from '../../core/breathe';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { type Atmosphere, castsInto } from '../../world/atmosphere';
import { type Look, type LookUniforms, lookFor, type BodyFile, loadCharacter, HAIR_STYLES, BEARD, lookUniforms, stainPatch, suitPatch, lookPatch, setLookUniforms } from '../look';
import { restBones } from '../../core/bones';
import { WornTag } from '../worn-tag';
import { CLIPS } from './pose';
import { AVATAR_LAYER, BODY_REACH, BODY_SCALE, CLEAN, FP_BODY_LAYER, FP_HIDDEN, LAID, SOLE_UNDER, WOUND_BONES, _m1, _q1, _v1, _v2, _v3, shareSkeleton, unread, Avatar, type ArmRig } from '../avatar';

/** (the wounds those paints show: none; see CLEAN) */
let CLEAN_U: LookUniforms | null = null;

export const makeMethods = {
  load(this: Avatar, atmo: Atmosphere, layer = AVATAR_LAYER, firstPersonBody = false, look: Look = lookFor(''), file: BodyFile = 'survivor') {
    return Avatar.line.take(file === 'survivor', () => this.make(atmo, layer, firstPersonBody, look, file));
  },

  async make(this: Avatar, atmo: Atmosphere, layer: number, firstPersonBody: boolean, look: Look, file: BodyFile) {
    const gltf = await loadCharacter(file);
    // (A body is made over several frames, a part in each: see ../core/breathe.ts. In one go it was 25 to 30 ms
    // every time one of the infected or another player came near, and all sixty-odd of the infected at once on
    // coming into the game. Nothing of it is in the world until it is whole: whoever asked for it puts it there
    // when this is done.)
    await breathe();
    const model = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    await breathe();
    // the model faces +Z; everything in the game (and the camera) faces -Z
    const rig = new THREE.Group();
    rig.rotation.y = Math.PI;
    rig.scale.setScalar(BODY_SCALE);
    rig.add(model);
    this.root.add(rig);
    this.root.rotation.order = 'YXZ';
    this.root.updateMatrixWorld(true);
    const bone = (n: string) => model.getObjectByName(n) as THREE.Bone | undefined;

    // hair is modelled where the head is at rest: hang every style on the head bone, show one
    const head = bone('Head');
    const hang = (name: string) => {
      const o = model.getObjectByName(name);
      if (o && head) head.attach(o);
      return o;
    };
    this.hair = HAIR_STYLES.map(hang);
    this.beard = hang(BEARD);

    this.uniforms = lookUniforms();
    const uniforms = this.uniforms;
    const mats = new Map<string, THREE.Material>();
    // where each shape's points are among the body shape's (worked out below, once the body shape is known)
    const rests: [THREE.SkinnedMesh, THREE.Matrix4][] = [];
    const rest = (m: THREE.SkinnedMesh) => {
      const r = new THREE.Matrix4();
      if (m.isSkinnedMesh) rests.push([m, r]);
      return r;
    };
    // the suit, or the plain body the game had before it (the character build can still make either)
    const suit = !!model.getObjectByName('pads');
    const zombie = file !== 'survivor';
    // (A bent body is not where its shapes say it is, and the library cannot tell whether it is in sight: it was
    // drawn wherever it was, behind the eye as well, and into every map of the sun's shadow. Now it is judged by a
    // ball round its hips that holds it however it is bent, lying or dancing, and drawn into the maps of the shadow
    // its shadow is read from: 29 bodies were 5.8 ms of the card's frame, flying low over the middle (2026-10-15).)
    const hips = bone('Hips') ?? this.root, ball = new THREE.Sphere(new THREE.Vector3(), BODY_REACH);
    const inSight = (f: THREE.Frustum | THREE.FrustumArray) => {
      // (development: every body drawn everywhere again, as it was, to measure the difference: assets-src/_wf/me/bodies-ab.js)
      if (import.meta.env.DEV && (globalThis as { __bodiesEverywhere?: boolean }).__bodiesEverywhere) return true;
      const e = hips.matrixWorld.elements;
      ball.center.set(e[12], e[13], e[14]);
      return castsInto(f, ball.center, ball.radius) && f.intersectsSphere(ball);
    };
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        // (not the hair nor the glasses: a finger's breadth on the shadow of a head; and an infected's from its body
        // alone, its trousers, hair and shoes lying inside that outline to a texel of the map, three of them cut out
        // by their pictures, each a draw of its own in every map of the sun's a body is in, 2026-10-18)
        m.castShadow = zombie ? m.name === 'body' : m.name !== 'hair' && m.name !== 'glass';
        m.receiveShadow = true;
        if (m.isSkinnedMesh) m.intersectsFrustum = inSight;
        const src = m.material as THREE.MeshStandardMaterial;
        if (zombie) {
          // one of the infected: painted as it came, and bloodied by what is done to it. Every infected of a kind
          // shares one paint a piece until it is first hit, and has its own from then (see own()): a paint each was a
          // hundred-odd paints in sight, each made ready again for every draw of it, and every one kept for good by the
          // sun's maps (2026-10-18, the research session's fifth round)
          const at = rest(m), key = `${file}|${m.name}`;
          let mat = CLEAN.get(key);
          if (!mat) {
            const u = (CLEAN_U ??= lookUniforms());
            mat = src.clone();
            atmo.register(mat, (shader) => stainPatch(shader, u, at), 'zombie');
            CLEAN.set(key, mat);
          }
          m.material = mat;
          m.userData.paint = { src, at };
          this.paintAtmo = atmo;
          if (m.name === 'body') this.skin = m;
        } else if (suit) {
          // every piece of it takes this body's stains; the cloth takes its colours as well
          const mat = src.clone(), at = rest(m);
          atmo.register(mat, (shader) => suitPatch(shader, uniforms, at), 'suit');
          m.material = mat;
          if (m.name === 'body') this.skin = m;
          if (m.name.startsWith('gear_')) {
            this.pieces.set(m.name, m);
            m.visible = false;
          }
        } else if (m.name === 'body') {
          const mat = src.clone(), at = rest(m);
          atmo.register(mat, (shader) => lookPatch(shader, uniforms, at), 'survivor');
          m.material = mat;
          this.skin = m;
        } else if (src.name.includes('Hair')) {
          // hair and eyebrows share this player's hair colour
          const mat = src.clone();
          atmo.register(mat);
          this.hairMats.push(mat);
          m.material = mat;
        } else {
          // the whites of the eyes are modelled paper white, which glows in a shaded face
          if (!src.userData.toned) {
            src.userData.toned = true;
            src.color.multiplyScalar(0.72);
            src.roughness = Math.max(src.roughness, 0.5);
          }
          atmo.register(src);
        }
        mats.set(m.name, m.material as THREE.Material);
      }
      o.layers.set(layer);
    });
    this.seenMask = model.layers.mask;
    if (this.layerMask === 0) model.traverse((o) => (o.layers.mask = 0));
    else this.layerMask = this.seenMask;
    if (this.skin) {
      // A file's shapes are each packed into a box of their own, and the unpacking is folded
      // into where each one's bones are said to have been bound. From one shape's numbers to
      // the body shape's is therefore: out through its own first bone, in through the body's.
      const body = this.skin, into = new THREE.Matrix4().copy(body.skeleton.boneInverses[0]).multiply(body.bindMatrix).invert();
      for (const [m, r] of rests) r.copy(into).multiply(m.skeleton.boneInverses[0]).multiply(m.bindMatrix);
      const bones = this.skin.skeleton.bones;
      for (const [name, next] of WOUND_BONES) {
        const i = bones.findIndex((b) => b.name === name);
        if (i >= 0) this.woundBones.push([i, next ? bones.find((b) => b.name === next) : undefined]);
      }
    }
    this.heldPivot.position.set(0, 1.43, 0);
    this.heldPivot.rotation.order = 'YXZ';
    // (turned to where it faces first, and then tipped to the ground it lies on, if it lies)
    this.root.rotation.order = 'YXZ';
    this.root.add(this.heldPivot);

    this.spine = ['spine_01', 'spine_02', 'spine_03'].map(bone).filter((b): b is THREE.Bone => !!b);
    this.chest = bone('spine_02');
    this.neck = ['neck_01', 'Head'].map(bone).filter((b): b is THREE.Bone => !!b);
    this.joints = { head: bone('Head') ?? undefined, neck: bone('neck_01') ?? undefined, pelvis: bone('pelvis') ?? undefined };
    this.headMid = Avatar.headMidOf(file, this.skin);
    // (as the body rests, before anything has moved it, a leg is straight)
    this.knees = ['calf_l', 'calf_r'].map(bone).filter((b): b is THREE.Bone => !!b).map((b) => [b, b.quaternion.clone()]);
    this.thighs = ['thigh_l', 'thigh_r'].map(bone).filter((b): b is THREE.Bone => !!b);
    // The infected's feet, as each body was MADE standing (see `plant`): which way the foot lies, how its toes lie
    // on it, and how high its ankle is over its sole. Not as its skeleton rests: these bodies wear a skeleton
    // that was brought to them, which rests as the game's own body stands and not as they do, and a foot laid
    // as the skeleton rests stood on its toes. What a body was made as is in what its shape is bound by.
    if (file !== 'survivor') {
      model.updateMatrixWorld(true);
      const skinned: THREE.SkinnedMesh[] = [];
      model.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
      });
      const sk = skinned[0]?.skeleton;
      this.soles = [];
      for (const side of ['l', 'r']) {
        const foot = bone(`foot_${side}`), ball = bone(`ball_${side}`);
        const fi = sk && foot ? sk.bones.indexOf(foot) : -1, bi = sk && ball ? sk.bones.indexOf(ball) : -1;
        if (!foot || !ball || !sk || fi < 0 || bi < 0) continue;
        const toFoot = sk.boneInverses[fi];
        const made = new THREE.Quaternion(), toes = new THREE.Quaternion();
        _m1.copy(toFoot).invert().decompose(_v1, made, _v2);
        _m1.copy(sk.boneInverses[bi]).invert().decompose(_v1, toes, _v2);
        // (how far under the ankle the sole is: the lowest of everything that hangs on the foot and its toes.
        // The same for every body made from one file: measured once.)
        const key = `${file}:${side}`;
        let low = SOLE_UNDER.get(key);
        if (low === undefined) {
          const down = _v3.set(0, -1, 0).applyQuaternion(_q1.copy(made).invert());
          low = 0;
          for (const m of skinned) {
            const P = m.geometry.getAttribute('position') as THREE.BufferAttribute, J = m.geometry.getAttribute('skinIndex'), W = m.geometry.getAttribute('skinWeight');
            const mf = m.skeleton.bones.indexOf(foot), mb = m.skeleton.bones.indexOf(ball);
            for (let i = 0; i < P.count; i++) {
              let w = 0;
              for (let c = 0; c < 4; c++) {
                const j = J.getComponent(i, c);
                if (j === mf || j === mb) w += W.getComponent(i, c);
              }
              if (w < 0.6) continue;
              low = Math.max(low, _v1.fromBufferAttribute(P, i).applyMatrix4(m.bindMatrix).applyMatrix4(toFoot).dot(down));
            }
          }
          SOLE_UNDER.set(key, low);
        }
        this.soles.push({ foot, ball, high: low * foot.getWorldScale(_v1).y, made, toe: made.clone().invert().multiply(toes) });
      }
    }
    if (this.skin) shareSkeleton(model, this.skin);
    this.collarL = bone('clavicle_l');
    this.collarR = bone('clavicle_r');
    // a shouldered weapon rides on the upper back: placed where it should be on the standing
    // body, then handed to the spine so it follows every lean and step
    this.slung.position.set(0, 1.3, 0.16);
    this.root.add(this.slung);
    this.root.updateMatrixWorld(true);
    // where the bones that carry gear are while the body stands at rest
    for (const name of ['Head', 'spine_03']) {
      const b = bone(name);
      if (b) this.gearRest.set(name, { bone: b, inv: b.matrixWorld.clone().invert() });
    }
    bone('spine_03')?.attach(this.slung);
    // the dog tag at the breastbone, over whatever is worn there (src/game/worn-tag.ts): shown once it is said which
    const chest = this.gearRest.get('spine_03');
    if (chest) {
      this.tag = new WornTag(this.layerMask);
      this.tag.measure(model, this.pieces);
      this.tag.fit(chest.bone, chest.inv, []);
    }

    // hand frames measured at rest (a T-pose), like the first-person arms
    this.armR = this.makeArm(model, 'r', new THREE.Vector3(0.55, -1, 0.25));
    this.armL = this.makeArm(model, 'l', new THREE.Vector3(-0.7, -1, 0.1));

    // the unseen skeleton the clips play on
    await breathe();
    const driver = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    await breathe();
    const src = new Map<string, THREE.Object3D>();
    driver.traverse((o) => {
      if ((o as THREE.Bone).isBone) src.set(o.name, o);
    });
    model.traverse((o) => {
      const from = (o as THREE.Bone).isBone ? src.get(o.name) : undefined;
      if (!from) return;
      this.drive.push([from, o]);
      this.laid.push([from, o, LAID.find(([re]) => re.test(o.name))?.[1] ?? 0, o.name === 'pelvis' ? 2 : /^(thigh|calf|foot|ball)_/.test(o.name) ? 1 : 0]);
    });
    this.driverRoot = driver;
    this.modelRoot = model;
    // (A bone's turn is never read as angles, and three works the angles out afresh from every turn set on a bone: the
    // clips', the copies' and the arms' alike, two skeletons' worth a body a frame. Its turn is all there is: a sixth
    // of what posing another player cost, and a fifth of the infected (2026-10-18).)
    for (const r of [driver, model]) r.traverse((o) => void ((o as THREE.Bone).isBone && (o.quaternion as unknown as { _onChange(f: () => void): void })._onChange(unread)));
    this.mixer = new THREE.AnimationMixer(driver);
    for (const name of CLIPS) {
      // (the infected's files have no lying down or crawling, and they never do either: a copy of the fall stands in)
      const own = gltf.animations.find((c) => c.name === name);
      const clip = own ?? (name === 'proneDown' || name === 'crawl' ? gltf.animations.find((c) => c.name === 'deathFront')?.clone() : undefined);
      if (!clip) throw new Error(`character has no "${name}" clip`);
      await breathe();
      const a = this.mixer.clipAction(clip);
      // every clip is scrubbed by hand: see update()
      a.timeScale = 0;
      a.setEffectiveWeight(name === 'idle' ? 1 : 0);
      a.play();
      this.actions[name] = a;
      this.dur[name] = clip.duration;
    }

    let fpModel: THREE.Group | null = null;
    if (firstPersonBody) {
      // A second copy of the rig that mirrors the animated one bone for bone, with the head
      // and arms shrunk to nothing: looking down shows your own chest, legs and feet walking.
      await breathe();
      const fp = (fpModel = SkeletonUtils.clone(gltf.scene) as THREE.Group);
      const shown = new Map<string, THREE.Object3D>();
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone) shown.set(o.name, o);
      });
      fp.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = true;
          m.frustumCulled = false;
          // nothing above the neck: the face and hair would only ever be seen from inside
          if (m.name === 'body') m.material = mats.get('body') ?? m.material;
          else m.visible = false;
        }
        o.layers.set(FP_BODY_LAYER);
        const from = (o as THREE.Bone).isBone ? shown.get(o.name) : undefined;
        if (from) this.fpBones.push([from, o, FP_HIDDEN.has(o.name)]);
      });
      const fpRig = new THREE.Group();
      fpRig.rotation.y = Math.PI;
      fpRig.scale.setScalar(BODY_SCALE);
      fpRig.add(fp);
      this.fpRoot.add(fpRig);
    }
    // which survivor this is, and what they wear over their skin (src/game/survivors.ts): put on these bones by name
    if (file === 'survivor' && this.skin && this.uniforms) {
      const named = (r: THREE.Object3D | null) => {
        if (!r) return null;
        const m = new Map<string, THREE.Bone>();
        r.traverse((o) => void ((o as THREE.Bone).isBone && m.set(o.name, o as THREE.Bone)));
        return m;
      };
      const of = (r: THREE.Object3D | null, names: string[]) => (r ? names.map((n) => r.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o) : []);
      const SUIT = ['body', 'head', 'pads'];
      this.wardrobe.attach({
        bones: named(model)!, fpBones: named(fpModel), suit: of(model, SUIT), fpSuit: of(fpModel, ['body']),
        into: this.skin.parent ?? model, fpInto: fpModel?.getObjectByName('body')?.parent ?? null,
        atmo, uniforms: this.uniforms, ref: this.skin, layers: () => this.layerMask, fpLayer: FP_BODY_LAYER, inSight, dressed: (parts) => Avatar.onDressed(parts),
      });
    }
    restBones(this.root);
    restBones(this.fpRoot);
    this.setLook(look);
    await Avatar.onMade(firstPersonBody ? [this.root, this.fpRoot] : [this.root], `${file}|${firstPersonBody ? 'own' : ''}`).catch(() => {});
  },

  /** Dresses the body: jacket and trouser colours, skin tone, hair. */
  /**
   * Not drawn, nor its shadow, for this eye (2026-10-16): a player past a short draw distance, behind a building it
   * leaves undrawn, would be seen through the building (the owner: "lower draw options too for potatoe players").
   * Whatever is put on it meanwhile goes on in the same mask; what stops a shot is not this (the hit zones are).
   */
  veil(this: Avatar, on: boolean) {
    const mask = on ? 0 : this.seenMask;
    if (mask === this.layerMask) return;
    this.layerMask = mask;
    this.root.traverse((o) => (o.layers.mask = mask));
  },

  setLook(this: Avatar, look: Look) {
    if (this.uniforms) setLookUniforms(this.uniforms, look);
    this.hair.forEach((h, i) => h && (h.visible = i === look.hair));
    if (this.beard) this.beard.visible = look.beard;
    for (const m of this.hairMats) m.color.copy(look.hairColor);
  },

  makeArm(this: Avatar, model: THREE.Object3D, side: 'l' | 'r', pole: THREE.Vector3): ArmRig | undefined {
    const B = (n: string) => model.getObjectByName(`${n}_${side}`) as THREE.Bone | undefined;
    const arm = B('upperarm'), fore = B('lowerarm'), hand = B('hand'), mid = B('middle_01'), index = B('index_01'), pinky = B('pinky_01');
    if (!arm || !fore || !hand || !mid || !index || !pinky) return undefined;
    const at = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
    const pa = at(arm), pf = at(fore), ph = at(hand);
    const hq = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    const fingersW = at(mid).sub(ph).normalize();
    // which way the palm faces, from the hand's own shape: across the knuckles, index to pinky
    const palmW = new THREE.Vector3().crossVectors(fingersW, at(pinky).sub(at(index))).normalize();
    if (side === 'l') palmW.negate();
    const fingers = ['index', 'middle', 'ring', 'pinky'].map((f) => [1, 2, 3].map((i) => B(`${f}_0${i}`)).filter((b): b is THREE.Bone => !!b));
    const thumb = ['thumb_01', 'thumb_02', 'thumb_03', 'thumb_04_leaf'].map(B).filter((b): b is THREE.Bone => !!b);
    return { arm, fore, hand, la: pa.distanceTo(pf), lb: pf.distanceTo(ph), fingersLocal: fingersW.applyQuaternion(hq), palmLocal: palmW.applyQuaternion(hq), fingers, open: fingers.map((chain) => chain.map((b) => b.quaternion.clone())), thumb, pole: pole.normalize() };
  },

  /**
   * Drawn faintly, or as anybody is: a vanished admin, as another admin sees them. Each piece is given a faint
   * copy of its own paint (the paints are shared between bodies, and are not touched), and its own back again
   * after. Asked again while it is faint, it catches whatever has been put on or taken up since.
   */
  setGhost(this: Avatar, on: boolean) {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const solid = m.userData.solid as THREE.Material | THREE.Material[] | undefined;
      if (on && !solid) {
        m.userData.solid = m.material;
        const faint = (x: THREE.Material) => {
          const c = x.clone();
          c.transparent = true;
          c.opacity = 0.38;
          c.depthWrite = false;
          return c;
        };
        m.material = Array.isArray(m.material) ? m.material.map(faint) : faint(m.material);
        m.castShadow = false;
      } else if (!on && solid) {
        for (const x of Array.isArray(m.material) ? m.material : [m.material]) x.dispose();
        m.material = solid;
        delete m.userData.solid;
        m.castShadow = true;
      }
    });
  },

  dispose(this: Avatar) {
    this.root.removeFromParent();
    this.fpRoot.removeFromParent();
    this.mixer?.stopAllAction();
    for (const m of this.hairMats) m.dispose();
  },
};
