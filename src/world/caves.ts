// The pass's walls and its caves, drawn and made solid (the plan is src/sim/pass.ts). Not placed: the world's generator
// carves the pass; whoever lays the world in builds this once the ground is up:
//
//   const caves = new PassCaves(scene, atmo, pass, (x, z) => terrain.heightAt(x, z));
//   await caves.build({ carved });   // `carved` from the world's worker (carveCave), or left out to carve here in slices
//   caves.update(camera.position);                                   // each frame (cheap: it re-sorts only as the eye moves on)
//   under = Math.max(under, caves.dark(x, y, z));                      // with the bunker's and the cellars' dark
//
// Each cave is one carved surface of rock (src/world/cave-carve.ts), closed but for its mouths, its own collider the
// same surface: nothing between pieces to see the sky through or walk through. It is painted with the scanned rock's
// pictures from its three sides (no seams to stretch them) and the trail's gravel on its floors, shaded in its
// crevices, and lit a few metres in by the day's light off the ground at its mouth. The pass's walls are dressed with
// the scanned cliffs, rubble at their feet and on their lips, each mouth framed (src/sim/pass.ts rockPieces), drawn and
// made solid by a RockField (src/world/rock-field.ts: each piece by its own shape, fading into the ground).

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import type { Atmosphere } from './atmosphere';
import { carving, type Carved } from './cave-carve';
import { CANYON_ROCK_TINT, KINDS } from './ground';
import { CANYON_BEDS_GLSL, canyonBedsUniforms } from './canyon-beds';
import { CANYON_FACE_GLSL, GROUND_KNEE } from './rock-blend';
import { RockField } from './rock-field';
import { passData } from './worldgen';
import { CAVES, caveDark, caveMouths, galleries, passGround, rockPieces, type Gallery, type Pass, type RockPiece } from '../sim/pass';

/**
 * metres from the eye within which a wall piece is drawn as its world copy (its far copy beyond: the world copies are
 * 45,000 triangles, and with the walls dressed close a pass seen from its floor held some forty of them in 70 m)
 */
const NEAR = 45;
/** metres from the eye within which a wall piece is solid */
const SOLID = 60;
/**
 * the rock's pictures: the walls and roofs the canyon's own rock, the floors the pass floor's grit, each as the ground
 * lays it (its size, its tint), so that a mouth's rock and the ground round it are one rock
 */
const ROCK = { wall: KINDS.canyon, floor: KINDS.grit };
/** milliseconds of carving to a frame, when it is carved here */
const SLICE = 6;

export class PassCaves {
  readonly group = new THREE.Group();
  readonly pieces: RockPiece[];
  /** the caves as carved (for numbers, and for the server or a cache to keep) */
  carved: Carved[] = [];
  /** the walls' rock pieces, drawn and solid */
  field: RockField | null = null;
  private gs: Gallery[];

  constructor(
    private scene: THREE.Scene,
    private atmo: Atmosphere,
    readonly pass: Pass,
    /** the ground's height (the terrain's); the plan's own terraces if not given */
    private ground: (x: number, z: number) => number = (x, z) => passGround(pass, x, z),
  ) {
    // (nothing stood on a ramp the world keeps between its shelves)
    this.pieces = rockPieces(pass, { ramps: passData().ramps, ground });
    this.gs = galleries(pass);
    this.group.name = 'pass caves';
  }

  /** How dark it is at a point (0 to 1): for `atmo.cover.ground`, with the bunker's and the cellars'. */
  dark(x: number, y: number, z: number) {
    return caveDark(this.pass, x, y, z, this.gs);
  }

  /** `heightTex`: the terrain's heights, for the rock to fade into the ground (src/world/rock-blend.ts) */
  /**
   * Done once the caves stand and are solid (their rock as carved): what opens their mouths in the ground waits for it,
   * or a body there has no floor (main.ts). The walls' pieces follow, their models loaded first (`dressed`).
   */
  async build(o: { solid?: boolean; carved?: Carved[]; heightTex?: THREE.Texture } = {}) {
    this.carved = o.carved ?? (await this.carveAll());
    const mat = this.rockMaterial();
    for (const k of this.carved) {
      const pos = new THREE.BufferAttribute(k.pos, 3), nor = new THREE.BufferAttribute(k.nor, 3), ao = new THREE.BufferAttribute(k.ao, 1);
      // (carved before the bounce was: none, the dark as it was)
      const bounce = new THREE.BufferAttribute(k.bounce ?? new Float32Array(k.ao.length), 1);
      // (two meshes on the same points: the cave's own, which casts no shadow, the ground over it does; and the rock
      // round its mouths, which takes the ground's place there and so casts the ground's)
      for (const [index, casts] of [[k.index, false], [k.face, true]] as const) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', pos);
        geo.setAttribute('normal', nor);
        geo.setAttribute('aAo', ao);
        geo.setAttribute('aBounce', bounce);
        geo.setIndex(new THREE.BufferAttribute(index, 1));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = casts;
        mesh.receiveShadow = true;
        mesh.name = `cave ${CAVES[k.cave].name}${casts ? ' mouths' : ''}`;
        this.group.add(mesh);
      }
      if (o.solid !== false) {
        const all = new Uint32Array(k.index.length + k.face.length);
        all.set(k.index);
        all.set(k.face, k.index.length);
        physics.addStatic(physics.R.ColliderDesc.trimesh(k.pos, all, physics.R.TriMeshFlags.FIX_INTERNAL_EDGES), 'rock', { x: 0, y: 0, z: 0 });
      }
    }
    this.scene.add(this.group);
    // (the scans washed with the pass's beds' red, so that a piece stands in the wall and not on it: src/world/ground.ts)
    // (its mouths' holes in the ground floored as the caves are: a block by a mouth reads the rock cut away there)
    this.field = new RockField(this.scene, this.atmo, this.pieces, { name: 'pass walls', near: NEAR, solid: SOLID, heightTex: o.heightTex, tint: CANYON_ROCK_TINT, flat: 'grit', holes: caveMouths(this.pass) });
    this.dressed = this.field.build({ solid: o.solid });
  }

  /** done when the walls' pieces are drawn and solid near the eye (after `build`) */
  dressed: Promise<void> = Promise.resolve();

  /** every cave carved here, a few milliseconds at a time between frames */
  private async carveAll() {
    const out: Carved[] = [];
    for (let ci = 0; ci < CAVES.length; ci++) {
      const it = carving(this.pass, ci, this.ground);
      let t = performance.now();
      for (;;) {
        const r = it.next();
        if (r.done) {
          out.push(r.value);
          break;
        }
        if (performance.now() - t > SLICE) {
          await new Promise((go) => setTimeout(go, 0));
          t = performance.now();
        }
      }
    }
    return out;
  }

  /**
   * The rock: its pictures laid from the three sides and blended by which way the rock faces (a carved surface has no
   * seams to lay one picture along), the gravel where it faces up; darker in its crevices (`aAo`, from the carving).
   * A side that hardly shows is not read at all (most of a wall reads one side, or two): with a cave filling a 1080p
   * screen the pictures cost the card 0.6 to 0.8 ms a frame read from all three sides (2026-10-16, an RTX 3070 Ti
   * laptop). Its roughness is the rock's own, even: its picture of it changed nothing seen in a cave.
   */
  private rockMaterial() {
    const tex = (id: string) => {
      const t = assets.manifest.textures[id];
      return { diff: assets.texture(t.diff, { srgb: true, repeat: true }), nor: assets.texture(t.nor, { repeat: true }), arm: assets.texture(t.arm, { repeat: true }) };
    };
    const wall = tex(ROCK.wall.tex), floor = tex(ROCK.floor.tex);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    this.atmo.register(mat, (shader) => {
      Object.assign(shader.uniforms, {
        tWall: { value: wall.diff }, tWallN: { value: wall.nor }, tWallArm: { value: wall.arm }, tFloor: { value: floor.diff }, tFloorN: { value: floor.nor },
        uRockSize: { value: new THREE.Vector2(ROCK.wall.size, ROCK.floor.size) },
        uWallTint: { value: new THREE.Vector3(...ROCK.wall.tint) }, uFloorTint: { value: new THREE.Vector3(...ROCK.floor.tint) },
        ...canyonBedsUniforms(),
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAo;\nattribute float aBounce;\nvarying float vAo;\nvarying float vBounce;\nvarying vec3 vRockPos;\nvarying vec3 vRockNor;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAo = aAo;\nvBounce = aBounce;\nvRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRockNor = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
          uniform sampler2D tWall, tWallN, tWallArm, tFloor, tFloorN;
          // (how shut in each point of the rock's picture is, the cracks dark: the terrain shades its own sky light by
          // it, 85%, and the walls in shadow are that light; without it the carved rock round a mouth was flat, a patch)
          float rockShade;
          uniform vec2 uRockSize;
          uniform vec3 uWallTint, uFloorTint;
          ${GROUND_KNEE}
          ${CANYON_BEDS_GLSL}
          ${CANYON_FACE_GLSL}
          varying float vAo;
          varying float vBounce;
          varying vec3 vRockPos;
          varying vec3 vRockNor;
          // (a picture read with its slopes given, so that it may be read or not, point by point)
          #define ROCK_READ( t, uv, d ) textureGrad( t, uv, d.xy, d.zw )`)
        .replace('#include <map_fragment>', /* glsl */ `
          vec3 rN = normalize(vRockNor), rB = pow(abs(rN), vec3(4.0));
          rB /= rB.x + rB.y + rB.z;
          // (the canyon's beds, and its picture on a face read as the terrain reads it there, bowed with them: the rock
          // round a mouth runs on into the wall's beds in the same colours at the same heights, never a paler patch)
          float bow;
          vec3 beds = canyonBeds(vRockPos, bow);
          vec2 uX = canyonFaceUv(vRockPos, vec3(1.0, 0.0, 0.0), bow) / uRockSize.x, uY = vRockPos.xz / uRockSize.x, uZ = canyonFaceUv(vRockPos, vec3(0.0, 0.0, 1.0), bow) / uRockSize.x, uF = vRockPos.xz / uRockSize.y;
          vec4 dX = vec4(dFdx(uX), dFdy(uX)), dY = vec4(dFdx(uY), dFdy(uY)), dZ = vec4(dFdx(uZ), dFdy(uZ)), dF = vec4(dFdx(uF), dFdy(uF));
          float onFloor = smoothstep(0.55, 0.85, rN.y);
          // (the sides that show: under 3 in 100 of the blend, not read, and the rest made whole again)
          vec3 use = step(vec3(0.03), rB);
          rB = rB * use / max(dot(rB, use), 1e-4);
          vec3 rockCol = vec3(0.0), tX = vec3(0.0, 0.0, 1.0), tY = tX, tZ = tX;
          rockShade = 0.0;
          // (read down the face, as the terrain reads it: the bumps' up the other way; and their relief held to 60%,
          // as the terrain's is seen from across the pass: at full the cracks stood out, a grain the wall round it had not)
          if (use.x > 0.5) { rockCol += canyonFace(tWall, uX, dX.xy, dX.zw, ${KINDS.canyon.far.toFixed(3)}, vRockPos) * uWallTint * beds * rB.x; tX = ROCK_READ(tWallN, uX, dX).xyz * 2.0 - 1.0; tX.xy *= vec2(0.6, -0.6); rockShade += ROCK_READ(tWallArm, uX, dX).r * rB.x; }
          if (use.z > 0.5) { rockCol += canyonFace(tWall, uZ, dZ.xy, dZ.zw, ${KINDS.canyon.far.toFixed(3)}, vRockPos) * uWallTint * beds * rB.z; tZ = ROCK_READ(tWallN, uZ, dZ).xyz * 2.0 - 1.0; tZ.xy *= vec2(0.6, -0.6); rockShade += ROCK_READ(tWallArm, uZ, dZ).r * rB.z; }
          if (use.y > 0.5) {
            vec3 top = vec3(0.0), topN = vec3(0.0);
            if (onFloor < 0.99) { top += ROCK_READ(tWall, uY, dY).rgb * uWallTint * beds * (1.0 - onFloor); topN += (ROCK_READ(tWallN, uY, dY).xyz * 2.0 - 1.0) * (1.0 - onFloor); }
            if (onFloor > 0.01) { top += ROCK_READ(tFloor, uF, dF).rgb * uFloorTint * onFloor; topN += (ROCK_READ(tFloorN, uF, dF).xyz * 2.0 - 1.0) * onFloor; }
            rockCol += top * rB.y;
            rockShade += rB.y;
            tY = topN;
          }
          diffuseColor.rgb *= groundKnee(rockCol) * mix(1.0, vAo, 0.6);`)
        .replace('#include <normal_fragment_maps>', /* glsl */ `{
          // (each side's picture's bumps brought into the world and blended: the "whiteout" blend)
          tX = vec3(tX.xy + rN.zy, abs(tX.z) * rN.x);
          tY = vec3(tY.xy + rN.xz, abs(tY.z) * rN.y);
          tZ = vec3(tZ.xy + rN.xy, abs(tZ.z) * rN.z);
          normal = normalize((viewMatrix * vec4(normalize(tX.zyx * rB.x + tY.xzy * rB.y + tZ.xyz * rB.z), 0.0)).xyz);
        }`)
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAo * mix(1.0, rockShade, 0.85);\nreflectedLight.indirectSpecular *= vAo;\n' +
          // (the day's light come in at the mouth off the ground outside, warm, a few metres in and dying away: not the
          // sky's, which the dark inside takes away, so that one step in is lit as a cave's mouth is)
          'reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.9, 0.78) * 0.85 * uDaylight * vBounce * vBounce * mix(0.6, 1.0, vAo);');
    }, 'cave-rock');
    return mat;
  }

  /** Each frame: which wall pieces are drawn near and which far, and which are solid (cheap: only as the eye moves on). */
  update(eye: THREE.Vector3) {
    this.field?.update(eye);
  }

  dispose() {
    this.group.removeFromParent();
    this.field?.dispose();
  }
}
