// Two copies of every small thing (2026-10-11).
//
// The pictures a model is painted with are kept at the size they came, four thousand pixels a side for the best
// of them, and each such picture is 85 MB on the graphics card once it is unpacked there. A thing lying on a
// shelf across a room is a hundred pixels of the screen: drawn with those pictures, a walk round one town put
// thirteen gigabytes on a card that has eight, and the game ran at a quarter of its pace.
//
// So a model with a picture bigger than WORLD_CAP is shipped twice. `<id>.glb` is what the world is drawn with
// from a way off: the same model, every triangle of it, its pictures no bigger than WORLD_CAP a side.
// `hi/<id>.glb` is the model as it came, and is what is loaded when the thing is close: in the hands of whoever
// is playing or looked at within arm's reach, if it is a thing that is carried; within a few lengths of itself,
// if it is a house or a car (src/core/assets.ts `sharpen`, src/game/near.ts). Nothing is lowered that is looked
// at from where its pictures can be told apart: what was a matter of every picture being on the card at once is
// now a matter of the few that are near.
//
// This runs over what the rest of the pipeline has made, whichever part of it made it: a file that is still as it
// came (a picture in it bigger than the cap) is a fresh one, and is parted in two.

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

/** the longest side of a picture on a thing as the world is drawn with it: of its colour */
export const WORLD_CAP = 1024;
/**
 * And of what only shapes the light on it (its relief, how rough it is, where it is metal): half that. From as
 * far off as the world's copy is drawn from at all, this is still more than the screen has pixels for, and it is
 * two of every three pictures a thing has.
 */
export const WORLD_CAP_OTHER = 512;
/** what the world's copy says of itself: how it was made. One made another way is made again from the copy as it came. */
const MARK = `world ${WORLD_CAP}/${WORLD_CAP_OTHER}`;
const COLOUR = /baseColor|emissive|diffuse/i;
/**
 * A model whose pictures as they came are bigger than anything on a screen can show of it has them made no bigger
 * than this, in its full-size copy too. The x-ray viewer on the hospital's wall came with ten pictures of 4096 a
 * side: 853 MB on the graphics card for a light box a metre and a half across, painted at two and a half to four
 * thousand pixels to the metre. At 2048 it is painted as finely as the rest of the hospital's furniture came
 * (1,200 to 2,000 to the metre, which is what a 1440-line screen shows of a thing half a metre off) and is 213 MB.
 * Nothing that is held in the hands is in this list.
 */
const HI_CAP = { xray_viewer: 2048 };
/** megabytes a file's pictures are on the graphics card once unpacked there: four bytes a pixel, and a third again for the smaller copies the card makes */
const onCard = (doc) => Math.round(doc.getRoot().listTextures().reduce((s, t) => { const [w, h] = t.getSize() ?? [0, 0]; return s + (w * h * 4 * 4) / 3 / 1048576; }, 0));

let io;
async function getIO() {
  if (io) return io;
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  return io;
}

/**
 * @param entries the manifest's models ({ id: entry }): changed in place (`bytes` of the world's copy, and `hi` where there is a copy as it came)
 * @returns how many were parted this time, and what the two sets weigh
 */
export async function tierModels(entries, { SRC, OUT }) {
  const notes = path.join(SRC, '_tiers.json');
  let seen = {};
  try {
    seen = JSON.parse(await fs.readFile(notes, 'utf8'));
  } catch { /* the first time */ }
  let made = 0, world = 0, full = 0;
  await fs.mkdir(path.join(OUT, 'models', 'hi'), { recursive: true });
  for (const [id, entry] of Object.entries(entries)) {
    const dest = path.join(OUT, 'models', `${id}.glb`), hi = path.join(OUT, 'models', 'hi', `${id}.glb`);
    let st = await fs.stat(dest);
    const was = seen[id];
    // (a file this has looked at before, and that has not been made again since, is not read again)
    if (!was || was.size !== st.size || was.mtime !== st.mtimeMs || (was.parted && was.mark !== MARK)) {
      const doc = await (await getIO()).read(dest);
      const big = Math.max(0, ...doc.getRoot().listTextures().map((t) => Math.max(...(t.getSize() ?? [0, 0]))));
      // (the world's copy says of itself that it is one: a file that does not is as the rest of the pipeline made it)
      const mark = doc.getRoot().getExtras().zonaTier;
      let parted = !!mark;
      const fresh = !mark && big > WORLD_CAP;
      if (fresh || (mark && mark !== MARK)) {
        // (a fresh one is kept as it came; a world's copy made by an older rule is made again from the one that was kept)
        if (fresh) {
          await fs.copyFile(dest, hi);
          if (HI_CAP[id]) {
            const capped = await (await getIO()).read(hi);
            await capped.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [HI_CAP[id], HI_CAP[id]], quality: 92 }));
            await (await getIO()).write(hi, capped);
          }
        }
        const full = fresh ? doc : await (await getIO()).read(hi);
        const was = Math.max(0, ...full.getRoot().listTextures().map((t) => Math.max(...(t.getSize() ?? [0, 0]))));
        await full.transform(
          textureCompress({ encoder: sharp, targetFormat: 'webp', slots: COLOUR, resize: [WORLD_CAP, WORLD_CAP], quality: 88 }),
          // (whatever is not a colour: named by what it is not, since a material may have pictures of kinds not thought of here)
          textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(?!.*(baseColor|emissive|diffuse)).*$/i, resize: [WORLD_CAP_OTHER, WORLD_CAP_OTHER], quality: 88 }),
        );
        full.getRoot().setExtras({ ...full.getRoot().getExtras(), zonaTier: MARK });
        await (await getIO()).write(dest, full);
        st = await fs.stat(dest);
        parted = true;
        made++;
        console.log(`tiers ${id.padEnd(28)} pictures of ${was} kept in hi/, the world's copy ${(st.size / 1024).toFixed(0)} KB`);
      } else if (!parted) {
        // (it came small: one copy is all there is. A copy as it came left from a time it was bigger is cleared away.)
        await fs.rm(hi, { force: true });
      }
      seen[id] = { size: st.size, mtime: st.mtimeMs, parted, mark: MARK };
    }
    entry.bytes = st.size;
    world += st.size;
    // (a world's copy whose copy as it came was never kept, as the factory kit's from the towns' lane: the world's is all there is)
    const hs = seen[id].parted ? await fs.stat(hi).catch(() => null) : null;
    if (seen[id].parted && hs) {
      entry.hi = `assets/models/hi/${id}.glb`;
      entry.hiBytes = hs.size;
      // (what it weighs on the card, for the game's budget of what is sharp at once: src/game/near.ts. Worked out
      // once for each copy as it stands, and again if the copy changes.)
      if (seen[id].card === undefined || seen[id].cardOf !== hs.size) {
        seen[id].card = onCard(await (await getIO()).read(hi));
        seen[id].cardOf = hs.size;
      }
      entry.hiCard = seen[id].card;
      full += hs.size;
    }
  }
  await fs.writeFile(notes, JSON.stringify(seen));
  return { made, world, full };
}
