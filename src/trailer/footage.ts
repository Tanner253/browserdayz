// Footage one cut lays into another (2026-10-23, for the gameplay trailer, shots26.ts): the pictures another take kept
// frame by frame (film.mjs --frames <dir>: tools/trailer/out/<dir>/<frame>.jpg and sounds.json), shown full screen over
// this film's game, which goes on unseen under them, and that take's own sounds laid into this one's at their places.
// The battle royale is played on a server of its own (shots27.ts) and cannot be filmed in the same page as the open world.

export interface Ev { t: number; n: string; a: unknown[] }
export interface Reel { dir: string; fps: number; first: number; last: number; width: number; height: number; sounds: Ev[] }

export async function loadReel(dir: string): Promise<Reel> {
  const r = await fetch(`/tools/trailer/out/${dir}/sounds.json`);
  if (!r.ok) throw new Error(`no footage in tools/trailer/out/${dir} (film it with --frames ${dir})`);
  return { dir, ...(await r.json()) } as Reel;
}

/** the picture of the reel at `t` seconds of its take, as a file of the page */
export const frameUrl = (reel: Reel, t: number) => {
  const i = Math.min(reel.last - 1, Math.max(reel.first, Math.round(t * reel.fps)));
  return `/tools/trailer/out/${reel.dir}/${String(i).padStart(5, '0')}.jpg`;
};

/**
 * The reel's sounds from `from` to `to` seconds of its take, moved to begin at `at` seconds of this film: and, at `at`,
 * where its listener stood and what air it heard just before `from` (so its first sounds are heard from the right place).
 */
export function soundsOf(reel: Reel, from: number, to: number, at: number): Ev[] {
  const out: Ev[] = [];
  const last = new Map<string, Ev>();
  for (const e of reel.sounds) {
    if (e.t < from) {
      if (e.n === 'setListener' || e.n === 'updateAmbience') last.set(e.n, e);
      continue;
    }
    if (e.t >= to) break;
    out.push({ ...e, t: at + (e.t - from) });
  }
  for (const e of last.values()) out.unshift({ ...e, t: at });
  return out;
}

/**
 * A picture over the whole of the game (or a part of it, cropped to fill it as `object-fit: cover` does): a reel's
 * frames are drawn on it one at a time. A canvas, drawn the moment the frame is decoded: an <img> given a new picture
 * showed it a frame late, so every laid-in shot ran a frame behind and began with one frame shown twice.
 */
export class Screen {
  el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private want = '';
  private ready: Promise<void> = Promise.resolve();
  constructor(parent: HTMLElement, cls: string) {
    this.el = document.createElement('canvas');
    this.el.className = cls;
    this.el.style.display = 'none';
    this.ctx = this.el.getContext('2d')!;
    parent.prepend(this.el);
  }
  /** show this frame (the page waits for it in `settled` before the frame is photographed) */
  show(url: string) {
    this.el.style.display = '';
    if (url === this.want) return;
    this.want = url;
    this.ready = (async () => {
      try {
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        if (this.want !== url) return void bmp.close();
        const r = this.el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        if (this.el.width !== w || this.el.height !== h) {
          this.el.width = w;
          this.el.height = h;
        }
        // (cover: the frame scaled to fill the screen, its middle kept)
        const k = Math.max(w / bmp.width, h / bmp.height), sw = w / k, sh = h / k;
        this.ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, w, h);
        bmp.close();
      } catch {
        console.log(`[tr] a frame of footage did not load: ${url}`);
      }
    })();
  }
  hide() {
    this.el.style.display = 'none';
  }
  settled() {
    return this.ready;
  }
}
