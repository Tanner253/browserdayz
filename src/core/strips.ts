import * as THREE from 'three';
import { steady } from './breathe';

/**
 * A big picture put on the graphics card a strip at a time (2026-10-12).
 *
 * A picture is handed to the card whole, in the frame it is first drawn with: for one four thousand pixels a side
 * that is 64 MB through the browser in one call, 30 to 80 ms of it with the card at rest and half a second with it
 * busy, and nothing is drawn the while. Walking up to a thing brings its pictures as they came (src/core/assets.ts
 * `sharpen`), two to ten of them: every one was a frame lost, and that was the stutter of walking through the
 * hospital.
 *
 * Here the card is asked for an empty picture of the same size and kind, and the rows are sent to it a few at a
 * time, as many as fit in a couple of milliseconds of each frame; the smaller copies of it are made by the card
 * when the last row is in, and only then is anything painted with it. What is on the card at the end is what the
 * one call would have put there, pixel for pixel: the same call, the same picture, in parts.
 */

/**
 * A picture bigger than this a side is more than a frame's worth however it is spaced, and goes a strip at a time
 * (assets.ts `sharpen`, Renderer.send). It was 1024, and the 1024s, most pictures of all, went whole: 20 to 27 ms each
 * on the owner's laptop, one every SHARPEN_EVERY while walking through a town (2026-10-16: "drops from 100 fps to 30
 * fps"); a 512 was 19.
 */
export const STRIP_OVER = 256;
/** what a frame gives to this: so many milliseconds, or this share of the frame where frames are long (a slow computer is not kept waiting a minute for its pictures) */
const BUDGET_MS = 2, BUDGET_OF_FRAME = 0.12, BUDGET_MOST = 40;
/** and what one strip is sized to take: what is over when a strip runs long is no more than this */
const STRIP_MS = 0.6;

type Job = {
  src: THREE.Texture;
  dst: THREE.Texture | null;
  y: number;
  anisotropy: number;
  wanted: () => boolean;
  done: (t: THREE.Texture | null) => void;
};

export class Strips {
  private jobs: Job[] = [];
  private ticking = false;
  /** the milliseconds a pixel has been taking of late: how many rows make a strip */
  private cost = 3e-6;
  private box = new THREE.Box2();
  private at = new THREE.Vector2();
  /** for whoever measures: pictures and strips sent, the time in them, the longest strip and the longest frame's worth */
  readonly stats = { pictures: 0, strips: 0, ms: 0, worstStrip: 0, worstFrame: 0 };

  constructor(private gl: THREE.WebGLRenderer) {}

  /** a small picture put on whole, now: one that would otherwise go on in the frame it is first drawn in */
  whole(t: THREE.Texture) {
    this.gl.initTexture(t);
  }

  /** how many are waiting or on their way */
  get waiting() {
    return this.jobs.length;
  }

  /**
   * @param src a picture that has never been drawn with (it is read from the page, not from the card)
   * @param anisotropy how it is to be seen at a slant (it cannot be told the card afterwards without the whole of it being looked at again)
   * @param wanted asked before each strip: a picture nobody is waiting for any more is dropped where it has got to
   * @returns the picture on the card, to paint with in place of `src`; nothing, if it was dropped
   */
  put(src: THREE.Texture, anisotropy: number, wanted: () => boolean): Promise<THREE.Texture | null> {
    return new Promise((done) => {
      this.jobs.push({ src, dst: null, y: 0, anisotropy, wanted, done });
      if (!this.ticking) {
        this.ticking = true;
        requestAnimationFrame(this.tick);
      }
    });
  }

  private blank(src: THREE.Texture, anisotropy: number) {
    const img = src.image as { width: number; height: number };
    const t = new THREE.FramebufferTexture(img.width, img.height);
    t.name = src.name;
    t.format = src.format;
    t.type = src.type;
    t.internalFormat = src.internalFormat;
    t.colorSpace = src.colorSpace;
    t.mapping = src.mapping;
    t.channel = src.channel;
    t.wrapS = src.wrapS;
    t.wrapT = src.wrapT;
    t.magFilter = src.magFilter;
    t.minFilter = src.minFilter;
    t.anisotropy = anisotropy;
    t.flipY = src.flipY;
    t.premultiplyAlpha = src.premultiplyAlpha;
    t.unpackAlignment = src.unpackAlignment;
    t.offset.copy(src.offset);
    t.repeat.copy(src.repeat);
    t.center.copy(src.center);
    t.rotation = src.rotation;
    t.matrixAutoUpdate = src.matrixAutoUpdate;
    t.matrix.copy(src.matrix);
    // (its smaller copies are made once, when the whole of it is there: see `tick`)
    t.generateMipmaps = false;
    t.userData = { ...src.userData, was: [img.width, img.height] };
    this.gl.initTexture(t);
    return t;
  }

  private last = 0;
  /** how long frames are, as far as this has seen (see `steady`: one long frame is not taken for the computer's pace) */
  private frame = 16;

  private tick = () => {
    const t0 = performance.now();
    if (this.last && t0 - this.last < 400) this.frame = steady(this.frame, t0 - this.last);
    const budget = Math.min(BUDGET_MOST, Math.max(BUDGET_MS, this.frame * BUDGET_OF_FRAME));
    this.last = t0;
    let spent = 0;
    while (this.jobs.length && spent < budget) {
      const j = this.jobs[0];
      const img = j.src.image as ImageBitmap | undefined;
      if (!img || !img.width || !j.wanted()) {
        j.dst?.dispose();
        this.jobs.shift();
        j.done(null);
        continue;
      }
      if (!j.dst) {
        j.dst = this.blank(j.src, j.anisotropy);
        spent = performance.now() - t0;
        continue;
      }
      const rows = Math.max(4, Math.min(img.height - j.y, Math.floor(Math.min(STRIP_MS, budget - spent) / (this.cost * img.width))));
      const last = j.y + rows >= img.height;
      if (last) j.dst.generateMipmaps = j.src.generateMipmaps;
      this.box.min.set(0, j.y);
      this.box.max.set(img.width, j.y + rows);
      const s0 = performance.now();
      this.gl.copyTextureToTexture(j.src, j.dst, this.box, this.at.set(0, j.y));
      const now = performance.now(), ms = now - s0;
      // (a strip that ran long is believed at once, one that ran short a little at a time)
      const per = ms / (rows * img.width);
      this.cost = per > this.cost ? per : this.cost + (per - this.cost) * 0.2;
      this.stats.strips++;
      this.stats.ms += ms;
      if (ms > this.stats.worstStrip) this.stats.worstStrip = ms;
      spent = now - t0;
      j.y += rows;
      if (last) {
        this.stats.pictures++;
        this.jobs.shift();
        j.done(j.dst);
      }
    }
    if (spent > this.stats.worstFrame) this.stats.worstFrame = spent;
    if (this.jobs.length) requestAnimationFrame(this.tick);
    else this.ticking = false;
  };
}
