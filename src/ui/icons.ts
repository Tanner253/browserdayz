// Inventory icons rendered from the real 3D models at startup (no hand-made sprites).
// Each item is framed to its grid footprint so the picture fills its cells.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ITEMS } from '../sim/items';
import { assets } from '../core/assets';
import type { ItemModels } from '../game/loot';
import { wearFinish, type Finish } from '../game/finish';
import { BEARD, HAIR_STYLES, loadCharacter, lookPatch, lookUniforms, setLookUniforms, suitPatch, type Look } from '../game/look';
import { BODY_SCALE, GEAR, WORN, placeWorn } from '../game/avatar';
import { hangFit } from '../game/avatar/gear';
import { MOVE_FILE } from '../game/avatar/gait';
import { sortWorn, wearBody, wearOn, type BodyFit } from '../game/survivors';
import { made, programsOf } from '../core/renderer';

const PX = 64; // pixels per grid cell

/** changed whenever the way a picture is made here changes: every picture kept from before is then made again (see `iconSig`) */
const ICONS_REV = 3;

/**
 * Things whose picture is turned head over heels from how the rules below stand them. A tool is stood with its
 * grip uppermost, which is right for a knife or a shovel and wrong for an axe: an axe is drawn head up.
 * (2026-10-13: "the hatchet is updside down in inventory".)
 */
// (and the First Aid Kit, whose lid was drawn with its words upside down: looked at on the sheet of every picture, 2026-10-13;
// and the stick grenade, drawn handle up: "the stick grenade in this image is upside down in the icon", 2026-10-19;
// and, every picture looked at on 2026-10-19 ("you should check all the icons for proper orientations"), two boxes of
// rounds whose printing read upside down and the tin of tomatoes standing on its lid)
// (and the Mosin's clip, its rounds tip down as it came: 2026-10-19; and the long tools, which lie head down: 2026-10-25,
// "make sure the model photos are upright"; and crafting's, the same day: the stone hatchet and the sledgehammer head up,
// the bone knife grip up as the combat knife)
const HEAD_UP = new Set(['hatchet', 'firstaid', 'grenade', 'box_739', 'box_9mm', 'tomatoes', 'clip_mosin', 'felling_axe', 'hammer', 'pickaxe', 'stone_hatchet', 'sledgehammer', 'bone_knife']);
/**
 * And every gun. A gun on the ground has lain on its thinnest side since 2026-10-13 (with what is fitted to it: see
 * `lay` in src/game/loot.ts), and the pictures made after that had every gun on its back: magazine and grip
 * uppermost, muzzle to the left. They went out so. ("the pictures you sent in chat all the models are upside
 * donw?": they were, and so were the game's.) Turned right over in the plane of the picture, it is the gun as it
 * was drawn before: muzzle to the right, magazine down.
 */
const headUp = (id: string) => HEAD_UP.has(id);
/**
 * A GUN IS DRAWN FLAT: its side square to the eye, level, muzzle to the right, filling its cells from end to end, as
 * a gun is in DayZ's inventory or on Counter-Strike's buy screen. (They were drawn as everything else is, turned a
 * little and tipped a little, and so lay aslant across their cells and small in them: "the guns are not flat
 * lookimg, loook at csgo gunm icons or dayuz, why ... are they anhnglerd and so small?", 2026-10-13.)
 *
 * Which of its two sides is shown, and whether that is turned right over in the picture, cannot be told from the
 * shape of a gun: each gun says [turned over, seen from its other side]. Set by LOOKING: every gun was drawn all
 * four ways on one sheet and the one with its grip down and its muzzle to the right taken. A new gun is looked at
 * the same way (`__GUN_VIEW` below is how the sheet is made).
 */
// (Set by looking in the world. At the menu five guns' models lie the other way round, and every picture made there,
// 2026-10-19, had the pistols grip up and the sniper rifle and the Scorpion muzzle left: "pistols reported". So
// scripts/icons.mjs makes them in the world.)
const GUN_VIEW: Record<string, [boolean, boolean]> = { ak: [true, false], ar15: [true, false], a91: [true, false], mosin: [true, false], mpa: [true, false], scorpion: [true, false], mp7a1: [true, false], aks74u: [true, false], dual_smg: [true, false], dual_mac10: [true, false], dual_sawnoff: [false, false], db12: [false, false], sniper50: [true, false], barrett: [true, false], vssk: [true, false], colt: [true, false], deagle: [true, false], m9: [true, false], benelli: [false, false] };
const gunView = (id: string): [boolean, boolean] => (globalThis as { __GUN_VIEW?: Record<string, [boolean, boolean]> }).__GUN_VIEW?.[id] ?? GUN_VIEW[id] ?? [false, false];
/**
 * What is built lying on its back, its face to the sky, and is stood up to look out of its picture. (The gas mask's
 * hood, since it lost its hose and was laid down, 2026-10-13: drawn as it lay it was seen from the side, one
 * eyepiece and the valve, and read as a flask.)
 */
const FACE_UP = new Set(['gasmask']);
/**
 * A thing whose picture the rules above leave on its side or edge on, posed by hand (2026-10-24, the owner: "make sure
 * the model photos are upright and look proper in the icon images for items not upside down or backwards"): `pivot`
 * how the model is stood (in place of the rules' turn), `frame` how the whole is then turned to the eye. The rules
 * turned the key lock's back plate to the eye, looked at the saw along its length, and laid the clipboard across its
 * tall place: each is turned face to the eye, the saw's handle and the clipboard's clip at the ends they are held by.
 */
const POSED: Record<string, { pivot?: [number, number, number]; frame?: [number, number, number] }> = {
  key_lock: { pivot: [0.15, -Math.PI / 2 + 0.35, 0] },
  // (its keypad and timer to the eye: the model has them to +x)
  c4: { pivot: [0.15, -Math.PI / 2 + 0.35, 0] },
  hand_saw: { pivot: [Math.PI / 2 - 0.2, 0, 0], frame: [0, 0, Math.PI] },
  building_plan: { pivot: [Math.PI / 2 - 0.25, 0, 0], frame: [0, 0, -Math.PI / 2] },
};

/** a gun, a magazine, or a part that is fitted to a gun: its picture is lit up (see where the pictures are made), by this much where it is painted with a picture and where it is a bare colour */
const LIT = (d: (typeof ITEMS)[string]) => !!(d.weapon || d.mag || d.attach);
const LIFT = [1.5, 1.3, 0.006];
/**
 * The lamps a picture is taken by: the one in front, the one behind and to one side (which is what picks the edge of
 * a dark thing out of a dark cell), and how much of the sky is on the thing. They are set by what kind of thing it
 * is. Only guns and their parts had the bright ones, and a black pack, a helmet or the gas mask was a hole in its
 * cell. (2026-10-13: "we should also upgrade the user inventory ensuring all items are properly bright and seeable
 * in the inventory".) What is worn or is a bag (`worn`), and tools, things to hit with and oddments (`kit`), are
 * mostly dark cloth, rubber and steel: more light, and more of it from behind. What is eaten, drunk or is a
 * dressing (`plain`) is mostly pale and keeps the lamps it had: more would wash a bandage or a tin out.
 */
const LAMPS = { plain: [1.8, 0.9, 0.75], gun: [3.6, 1.9, 1.7], worn: [2.6, 2.0, 1.2], kit: [2.4, 1.6, 1.1] };
const lampsOf = (d: (typeof ITEMS)[string]): keyof typeof LAMPS =>
  LIT(d) || d.iconBright ? 'gun' : d.category === 'clothing' || d.category === 'stash' ? 'worn' : d.category === 'tool' || d.category === 'melee' || d.category === 'misc' ? 'kit' : 'plain';

/**
 * How bright a picture is to be when it is done, whatever it is of: the mean of what is seen of the thing, as the
 * screen has it (0 to 255). A thing painted black stays near black under any lamp, so the lamps cannot do this by
 * themselves: a picture darker than `floor` is opened up, as a photograph of a black thing is printed lighter
 * (never by more than `least`, so that a black pack is still the darkest thing in a pocket), and one paler than
 * `ceil` is brought down to it (never by more than `most`). Between the two a picture is left as the lamps made it.
 */
const TONE = { floor: 72, ceil: 150, least: 0.5, most: 1.4 };

/** A picture's pixels (four numbers each, as a canvas has them) brought to the brightness above, where they stand. */
function tone(px: Uint8ClampedArray) {
  // (At its edge a pixel is part thing and part nothing, and is kept as the colour times how much of it is thing: it
  // is counted, and changed, as the colour it is of.)
  const seen = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a < 128) continue;
    seen[Math.min(255, Math.round(((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * 255) / a))]++;
    n++;
  }
  if (!n) return;
  const meanAt = (g: number) => {
    let s = 0;
    for (let v = 1; v < 256; v++) s += seen[v] * 255 * Math.pow(v / 255, g);
    return s / n;
  };
  /** the curve between these two that leaves the mean at `want` (the mean falls as the curve's number rises) */
  const solve = (lo: number, hi: number, want: number) => {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (meanAt(mid) > want) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const mean = meanAt(1);
  const g = mean < TONE.floor ? (meanAt(TONE.least) < TONE.floor ? TONE.least : solve(TONE.least, 1, TONE.floor)) : mean > TONE.ceil ? (meanAt(TONE.most) > TONE.ceil ? TONE.most : solve(1, TONE.most, TONE.ceil)) : 1;
  if (g === 1) return;
  const curve = new Uint8Array(256);
  for (let v = 0; v < 256; v++) curve[v] = Math.round(255 * Math.pow(v / 255, g));
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (!a) continue;
    for (let c = 0; c < 3; c++) px[i + c] = a === 255 ? curve[px[i + c]] : Math.round((curve[Math.min(255, Math.round((px[i + c] * 255) / a))] * a) / 255);
  }
}

/** whether a thing has a second picture, for the place on the body it is worn in (kept as `slot:<id>`) */
export const hasSlotIcon = (id: string): boolean => ITEMS[id]?.category === 'clothing' && !!ITEMS[id].slot;

/**
 * What an item's picture is made from, in one word: how the game's list says it looks, and which version of its
 * model's file that is. The picture kept on disk for it (public/assets/icons, made by `npm run icons`) is good for
 * exactly as long as this is what it was made from: change the model, the dye or the shape of its place in a
 * pocket and the game makes the picture itself, as it used to make all of them, until they are made again.
 */
export function iconSig(id: string): string {
  const of = (d: (typeof ITEMS)[string] | undefined) => {
    if (!d) return [];
    const file = d.model.startsWith('@') ? '@' : assets.stamp(assets.manifest.models[d.model]?.url ?? '');
    // (a file the build has no version for: nothing made from it can be told to be current)
    return [d.model, file || Math.random(), d.node ?? '', d.nodeRe ?? '', d.tint ?? '', d.paint ?? '', d.scale ?? '', d.w, d.h, d.category, d.pile ?? '', !!d.mag, d.stack ? 1 : 0, d.weapon ? [d.weapon.mag ?? '', d.weapon.shows ?? '', (d.weapon as { hides?: unknown }).hides ?? '', d.weapon.never ?? ''] : '', ...(d.iconBright ? ['bright'] : [])];
  };
  const d = ITEMS[id];
  const text = JSON.stringify([ICONS_REV, of(d), of(d.weapon?.mag ? ITEMS[d.weapon.mag] : undefined), ...(headUp(id) ? ['head up'] : []), ...(d.weapon ? ['flat', ...gunView(id)] : []), 'lamps', ...LAMPS[lampsOf(d)], ...(LIT(d) ? ['lit', ...LIFT] : []), 'tone', TONE.floor, TONE.ceil, TONE.least, TONE.most]);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}

/** @param only the items to make pictures of (all of them, where not said) */
/** @param finish a store finish on the gun: its picture as `<id>|<finish>`, the plate laid over it (src/game/finish.ts) */
export async function renderIcons(renderer: THREE.WebGLRenderer, models: ItemModels, env: THREE.Texture, only?: string[], finish?: Finish): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.75;
  const key = new THREE.DirectionalLight(0xfff4e6, 1.8);
  key.position.set(2, 4, 3);
  const rim = new THREE.DirectionalLight(0xbcd2ff, 0.9);
  rim.position.set(-3, 2, -2);
  scene.add(key, rim);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  const prevTarget = renderer.getRenderTarget();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  // Drawing a thing puts every picture it is painted with on the graphics card, and there they stay: the pictures
  // of every item in the game, most of which are never seen in a given hour, sat there from the first second (with
  // every model at the size it came, some gigabytes of them: more than many cards have). What was put there for
  // these pictures is taken off again when they are made, and goes back the first time the thing itself is drawn.
  const used = new Set<THREE.Texture>(), copies: THREE.Material[] = [];

  for (const [id, def] of Object.entries(ITEMS)) {
    if (only && !only.includes(id)) continue;
    // (a gun fed by a magazine is drawn with its own in it: without, it is a gun with a hole in it)
    const tpl = await models.get(id, def.weapon?.mag ? [def.weapon.mag] : []);
    [key.intensity, rim.intensity, scene.environmentIntensity] = LAMPS[lampsOf(def)];
    const w = def.w * PX, h = def.h * PX;
    const rt = new THREE.WebGLRenderTarget(w * 2, h * 2, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    const obj = tpl.group.clone();
    obj.scale.setScalar(1);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // icon scene has no cascaded shadow lights: use plain material copies
      const src = m.material as THREE.MeshStandardMaterial;
      const c = src.clone();
      if (c.defines) {
        delete c.defines.USE_CSM;
        delete c.defines.CSM_CASCADES;
        delete c.defines.CSM_FADE;
      }
      c.onBeforeCompile = () => {};
      c.customProgramCacheKey = () => 'icon';
      // Loose rounds are brass, and brass is all shine: under this light it is a mirror of a dim sky, and the
      // pictures of every round were dark brown. In its picture a round is given less of the mirror and more of its
      // own colour, lit up: brass that reads as brass, and the bullet's tip to be told from its case.
      if (def.category === 'ammo' && def.stack) {
        c.metalness = Math.min(c.metalness, 0.5);
        c.metalnessMap = null;
        c.roughness = Math.max(c.roughness, 0.4);
        c.roughnessMap = null;
        c.envMapIntensity = 1.6;
      }
      // A gun is gunmetal, and gunmetal under this light is a black shape: its picture in a pocket could not be
      // read. ("the inventory items for the guns seem way too dark", 2026-10-13.) In its picture a gun, and what
      // is fitted to one, keeps less of the mirror and is lit up, as the guns in the hands are (see liftPack).
      // (More light on it, as a photograph of a black thing is given more: see where each is drawn. Its steel is
      // left steel, so that what shows its shape, the light along its edges, is brighter with the rest. And what
      // is painted black stays black however it is lit: a very little light of its own, so that it is not a hole.)
      if (LIT(def)) {
        c.color.multiplyScalar(c.map ? LIFT[0] : LIFT[1]);
        if (!c.emissiveMap) c.emissive.addScalar(LIFT[2]);
      }
      for (const t of [src.map, src.normalMap, src.roughnessMap, src.metalnessMap, src.aoMap, src.emissiveMap, src.alphaMap]) if (t) used.add(t);
      copies.push(c);
      m.material = c;
    });
    const pivot = new THREE.Group();
    pivot.add(obj);
    // orient so the item's longest horizontal axis runs along the icon's long side
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const iconLandscape = def.w >= def.h;
    const modelLong = size.x >= size.z ? 'x' : 'z';
    const upright = size.y > Math.max(size.x, size.z) * 1.2;
    // What is worn stands as it is worn, whatever the shape of its place in a pocket: a vest three cells wide and
    // two tall was laid on its side to fill them, and was a vest on its side in the vest's own slot.
    const worn = def.category === 'clothing';
    // (and the foregrip, the M32's vertical grip, stands as it is fitted: lying in its tall place it was a speck)
    if (def.mag || id === 'foregrip') {
      // A magazine stands on its end, the end that goes into the gun uppermost, its broad side to the eye, whatever
      // the shape of its place in a pocket. It lies on its side in the world, and by the rules below was drawn on
      // its side, on its head, or across a tall picture, one magazine one way and the next another. Its longest
      // side is stood up, its thinnest turned to the eye. (As they are laid in the world the top of every one of
      // them is toward the low end of the axis it lies along: that end is put uppermost. Looked at, 2026-10-10: the
      // round in each is at the top.)
      const dims: [number, 'x' | 'y' | 'z'][] = [[size.x, 'x'], [size.y, 'y'], [size.z, 'z']];
      dims.sort((p, q) => q[0] - p[0]);
      const unit = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
      const up = unit[dims[0][1]].clone().multiplyScalar(dims[0][1] === 'y' ? 1 : -1), side = unit[dims[1][1]].clone();
      const out = new THREE.Vector3().crossVectors(side, up);
      // (what takes the model's own axes to the picture's: the inverse of the frame made of where each is to go)
      pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, out).invert());
    } else if (def.weapon) {
      // (flat: see GUN_VIEW. Its longest side along the picture, its thinnest toward the eye.)
      const dims: [number, 'x' | 'y' | 'z'][] = [[size.x, 'x'], [size.y, 'y'], [size.z, 'z']];
      dims.sort((p, q) => q[0] - p[0]);
      const unit = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
      const [turned, other] = gunView(id);
      const side = unit[dims[0][1]].clone().multiplyScalar(turned ? -1 : 1), out = unit[dims[2][1]].clone().multiplyScalar(other ? -1 : 1);
      const up = new THREE.Vector3().crossVectors(out, side);
      pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, out).invert());
    } else {
      if (upright && iconLandscape && def.w > def.h && !worn) pivot.rotation.z = Math.PI / 2;
      // (What is worn is not tipped over to fill a tall place either: a pair of boots was drawn from over the top of
      // them, toes down. "the boots icon is backwards or upside down", 2026-10-12.)
      if (!upright && !iconLandscape && !worn) pivot.rotation.x = Math.PI / 2;
      if (modelLong === 'z' && !upright) pivot.rotation.y = Math.PI / 2;
      pivot.rotation.y += 0.35;
      // something as flat as a dog tag is looked at from above, or it is only a sliver
      const flat = size.y < Math.min(size.x, size.z) * 0.1;
      pivot.rotation.x += upright ? 0.15 : flat ? 1.15 : 0.55;
    }
    if (FACE_UP.has(id)) pivot.rotation.set(Math.PI / 2 - 0.15, 0, 0);
    const posed = POSED[id];
    if (posed?.pivot) pivot.rotation.set(...posed.pivot);
    // (in a frame of its own, which is what is turned if the turns above left it across the picture)
    const frame = new THREE.Group();
    frame.add(pivot);
    if (FACE_UP.has(id)) frame.rotation.y = 0.4;
    if (posed?.frame) frame.rotation.set(...posed.frame);
    // (a magazine is looked at a little from one side and a little from above, as a thing stood on a table is)
    if (def.mag) frame.rotation.set(0.12, 0.45, 0);
    scene.add(frame);
    frame.updateMatrixWorld(true);
    let b2 = new THREE.Box3().setFromObject(frame);
    let s2 = b2.getSize(new THREE.Vector3());
    // However the model lies as it comes, its long side goes along the picture's long side. (A
    // bat comes lying along x and is six cells tall: it was drawn across the middle of its
    // picture, a hair's width of it, and looked like no picture at all.)
    const across = s2.x > s2.y * 1.3, along = s2.y > s2.x * 1.3;
    if (!def.mag && !worn && ((across && h > w) || (along && w > h))) {
      frame.rotation.z = across ? Math.PI / 2 : -Math.PI / 2;
      frame.updateMatrixWorld(true);
      b2 = new THREE.Box3().setFromObject(frame);
      s2 = b2.getSize(new THREE.Vector3());
    }
    // (and one that reads upside down as it then stands is turned right over, in the plane of the picture)
    if (headUp(id)) frame.rotation.z += Math.PI;
    /** the thing as it stands in the scene, drawn to fill a picture of this many pixels each way */
    const shoot = (pw: number, ph: number, target: THREE.WebGLRenderTarget): string => {
      frame.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(frame), ss = bb.getSize(new THREE.Vector3()), c2 = bb.getCenter(new THREE.Vector3());
      const aspect = pw / ph;
      const half = Math.max(ss.x / 2, ss.y / 2 * aspect) * 1.08;
      cam.left = -half;
      cam.right = half;
      cam.top = half / aspect;
      cam.bottom = -half / aspect;
      cam.position.set(c2.x, c2.y, c2.z + 10);
      cam.lookAt(c2);
      cam.updateProjectionMatrix();
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, cam);
      const buf = new Uint8Array(pw * ph * 4);
      renderer.readRenderTargetPixels(target, 0, 0, pw, ph, buf);
      canvas.width = pw;
      canvas.height = ph;
      const img = ctx.createImageData(pw, ph);
      // flip rows (GL origin is bottom-left)
      for (let y = 0; y < ph; y++) img.data.set(buf.subarray((ph - 1 - y) * pw * 4, (ph - y) * pw * 4), y * pw * 4);
      // (and brought to the brightness every picture is to have: see TONE)
      tone(img.data);
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL('image/png');
    };
    if (finish) wearFinish(obj, id, finish, true);
    out[finish ? `${id}|${finish}` : id] = shoot(w * 2, h * 2, rt);
    // What is worn has a second picture, for the place on the body it is worn in: the thing by itself, as big as a
    // square will hold. (Its picture for a pocket is the shape of its place in a pocket: a pair of gloves two cells
    // wide and one tall was a small pair of gloves in the middle of a wide picture, and smaller again in a slot.
    // "when equipped the gloves and boots icons are to small", 2026-10-12.)
    if (hasSlotIcon(id) && !finish) {
      // (a thing that lies low, a pair of gloves or of boots, is looked at from further over it: from near level it
      // is a thin strip across the square)
      if (size.y < Math.max(size.x, size.z) * 0.62) pivot.rotation.x = def.slot === 'hands' ? 1.02 : 0.72;
      const side = 3 * PX;
      const sq = new THREE.WebGLRenderTarget(side, side, { samples: 4, colorSpace: THREE.SRGBColorSpace });
      out[`slot:${id}`] = shoot(side, side, sq);
      sq.dispose();
    }
    scene.remove(frame);
    rt.dispose();
  }
  renderer.setRenderTarget(prevTarget);
  // (Only what can go back from the page's own copy: not a full-size picture on the card, sent there in strips or
  // with its page copy let go of, which the gun in the hands is painted with. Taken off, it came back blank: the
  // Scorpion in the hands was drawn black from the moment its magazine's picture was made, 2026-10-17.)
  for (const t of used) if (!(t as THREE.FramebufferTexture).isFramebufferTexture && (t.image as { width?: number } | null)?.width) t.dispose();
  for (const c of copies) c.dispose();
  return out;
}

/**
 * Portrait of the survivor for the inventory screen's paper doll (transparent PNG data URL).
 * @param worn what is in the slots that show on a body (head, vest, back): the portrait wears it
 * @param models where a pack's own model comes from (the cap, the headset and the plate carrier are pieces of the body itself)
 * @param face the head alone, square and small: who somebody is, in a list of people
 */
/**
 * @param body one of the survivors' bodies (src/game/survivors.ts), as worn in the world: the old suit is drawn only
 * without one. (The owner, 2026-10-25, of the still figure, the old suit at its file's rest with its toes pointed and
 * nothing under it: "looks like hes floating it doesnt look right he feet look weird".)
 */
export async function renderDoll(renderer: THREE.WebGLRenderer, env: THREE.Texture, look: Look, worn: string[] = [], models?: ItemModels, face = false, body: number | null = null): Promise<string> {
  const gltf = await loadCharacter();
  const model = SkeletonUtils.clone(gltf.scene) as THREE.Group;
  model.updateMatrixWorld(true);
  // (the body put on first, its own lengths on the bones, so that what is hung on it is hung where it is: see Avatar.gearFit)
  const skin = body === null ? null : await wearBody(model, body);
  const fit = (skin?.[0]?.userData.fit as BodyFit | undefined) ?? null;
  model.updateMatrixWorld(true);
  const suit = !!model.getObjectByName('pads');
  const shown = new Set(worn.flatMap((id) => WORN[id] ?? []));
  // a pack hangs where it hangs on a body in the world: set on the body as it stands at rest, and carried by the spine from there
  const carried: THREE.Object3D[] = [];
  if (models) {
    for (const id of worn) {
      const g = GEAR[id], bone = g && model.getObjectByName(g.bone);
      if (!g || !bone) continue;
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      // (GEAR is written for a body in the world: turned to face the way the game faces, and at the game's size. This one is as its file has it.)
      // (Put as a body in the world is dressed, with what else is worn: a mask cut under a helmet, the helmet where
      // it rides over a mask. By GEAR alone, the portrait had a hood through its helmet.)
      const thing = (await models.get(id)).group.clone();
      const place = placeWorn(id, thing, worn);
      if (!place) continue;
      const toFile = new THREE.Matrix4().makeScale(1 / BODY_SCALE, 1 / BODY_SCALE, 1 / BODY_SCALE).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      const inv = bone.matrixWorld.clone().invert().multiply(toFile);
      holder.matrix.copy(inv).multiply(hangFit(fit, g, inv)).multiply(place);
      holder.add(thing);
      bone.add(holder);
      carried.push(holder);
    }
  }
  // one hair style (and maybe a beard), carried by the head
  const head = model.getObjectByName('Head');
  [...HAIR_STYLES, BEARD].forEach((name, i) => {
    const o = model.getObjectByName(name);
    if (!o) return;
    head?.attach(o);
    o.visible = name === BEARD ? look.beard : i === look.hair;
  });
  const uniforms = lookUniforms();
  setLookUniforms(uniforms, look);
  const own: THREE.Material[] = [];
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    // (the body's own paint is its own: see wearBody)
    if (!m.isMesh || skin?.includes(m)) return;
    m.frustumCulled = false;
    // (the pieces of the suit that are worn or not: only what is worn)
    if (m.name.startsWith('gear_') && !shown.has(m.name)) m.visible = false;
    const c = (m.material as THREE.MeshStandardMaterial).clone();
    if (c.defines) {
      delete c.defines.USE_CSM;
      delete c.defines.CSM_CASCADES;
      delete c.defines.CSM_FADE;
    }
    if (suit && m.isSkinnedMesh) {
      c.onBeforeCompile = (shader) => suitPatch(shader, uniforms);
      c.customProgramCacheKey = () => 'doll-suit';
    } else if (m.name === 'body') {
      c.onBeforeCompile = (shader) => lookPatch(shader, uniforms);
      c.customProgramCacheKey = () => 'doll';
    } else if (c.name.includes('Hair')) c.color.copy(look.hairColor);
    else {
      c.onBeforeCompile = () => {};
      c.customProgramCacheKey = () => 'icon';
    }
    m.material = c;
    own.push(c);
  });
  // (and what is worn on it, as in the world: their own paints, after the suit's are made the doll's)
  if (skin) await wearOn(model, skin, sortWorn(worn).worn, body ?? 0);
  // (standing as a body in the world stands: the motion capture's idle, its feet flat on the ground; the file's own
  // idle stood the old suit on its toes)
  const moves = skin ? (await assets.loadGLTF(MOVE_FILE)).animations : gltf.animations;
  const idle = moves.find((a) => a.name === 'idle');
  if (idle) {
    // (the hips and the feet as they rest, the soles flat on the ground: played on bare bones the idle lifts the hips
    // and points the toes, which the game's body puts right as it stands, and a still figure would hang in the air)
    const kept = ['foot_l', 'foot_r', 'ball_l', 'ball_r'].flatMap((n) => {
      const b = model.getObjectByName(n);
      return b ? [[b, b.quaternion.clone()] as const] : [];
    });
    const hips = model.getObjectByName('pelvis'), at = hips?.position.clone();
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(idle).play();
    mixer.update(0.4);
    for (const [b, q] of kept) b.quaternion.copy(q);
    if (hips && at) hips.position.copy(at);
  }
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.7;
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
  key.position.set(2.5, 3.5, 4);
  const rim = new THREE.DirectionalLight(0x9fc0ff, 1.4);
  rim.position.set(-3, 2.5, -3);
  scene.add(key, rim, model);
  // (and a shadow under the feet, soft, as the live figure stands on its own: without one it floated on the page)
  if (!face) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = 0.002;
    scene.add(shade);
    own.push(shade.material);
  }
  // (a head in a list of people is an inch across: lit from the front, and well, so that the face is seen)
  if (face) {
    scene.environmentIntensity = 1.3;
    key.intensity = 3.4;
    key.position.set(1.2, 2.2, 4);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  }
  // the model faces +Z: turn it a little so it reads as a figure, not a mugshot
  model.rotation.y = -0.35;
  model.updateMatrixWorld(true);
  const W = face ? 144 : 420, H = face ? 144 : 840;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  // (the head alone: a square about where the head's own bone is, from the collar to over a helmet)
  const at = new THREE.Vector3();
  (head ?? model).getWorldPosition(at);
  const cam = face ? new THREE.OrthographicCamera(at.x - 0.2, at.x + 0.2, at.y + 0.29, at.y - 0.11, 0.01, 50) : new THREE.OrthographicCamera(-0.52, 0.52, 1.93, -0.15, 0.01, 50);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  // The figure is drawn again every time something is put on or taken off, in the middle of play. So nothing of
  // it is waited for inside a frame: the shaders of what is worn are made by the card's own workers and waited
  // for between frames (drawn straight off, each new one was made in the frame: a second and a tenth, the first
  // time a whole kit went on); the picture is read back from the card when the card says it is drawn, not asked
  // for and stood waiting on (12 to 80 ms); and it is packed as a file by the browser's own worker.
  let prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  const programs = programsOf(renderer, renderer.compile(scene, cam) as unknown as Set<THREE.Material>);
  renderer.setRenderTarget(prev);
  await made(programs);
  prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  const buf = new Uint8Array(W * H * 4);
  await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H, buf);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  ctx.putImageData(img, 0, 0);
  rt.dispose();
  for (const m of own) m.dispose();
  const file = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
  const url = file
    ? await new Promise<string>((done) => {
        const reader = new FileReader();
        reader.onload = () => done(String(reader.result));
        reader.onerror = () => done('');
        reader.readAsDataURL(file);
      })
    : '';
  return url || canvas.toDataURL('image/png');
}
