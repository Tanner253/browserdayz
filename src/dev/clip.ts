// Cutting pictures and short films out of a film that is already made, in a browser: there is
// no other cutter on the machine. For the changelog's pictures (public/changelog/media), out
// of the trailers in tools/trailer/out. Not part of the built site: loaded by hand on a dev page,
//   const C = await import('/src/dev/clip.ts')
//   await C.send('sheet-5', await C.sheet('/tools/trailer/out/zona-trailer-5.mp4', 24))
//   await C.send('infected-chase', await C.clip('/tools/trailer/out/zona-trailer-5.mp4', 21, 27))
// (`send` posts to the little receiver that writes what it is given to a folder.)

const open = async (src: string) => {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = src;
  await new Promise<void>((ok, no) => {
    v.onloadeddata = () => ok();
    v.onerror = () => no(new Error(`cannot read ${src}`));
  });
  return v;
};
const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((ok) => {
    v.onseeked = () => ok();
    v.currentTime = Math.min(Math.max(0, t), v.duration - 0.05);
  });
const jpeg = (c: HTMLCanvasElement, q = 0.86) => new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', q));

/** `n` frames of it, evenly through it, each with its second written on it: to choose from */
export async function sheet(src: string, n = 24, cols = 6, w = 320): Promise<Blob> {
  const v = await open(src), h = Math.round((w * v.videoHeight) / v.videoWidth);
  const c = document.createElement('canvas');
  c.width = cols * w;
  c.height = Math.ceil(n / cols) * h;
  const g = c.getContext('2d')!;
  g.font = '700 15px monospace';
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * v.duration, x = (i % cols) * w, y = Math.floor(i / cols) * h;
    await seek(v, t);
    g.drawImage(v, x, y, w, h);
    g.fillStyle = 'rgba(0, 0, 0, 0.7)';
    g.fillRect(x, y, 58, 20);
    g.fillStyle = '#ffd35a';
    g.fillText(t.toFixed(1), x + 4, y + 15);
  }
  return jpeg(c, 0.8);
}

/** one frame of it */
export async function still(src: string, t: number, w = 1280): Promise<Blob> {
  const v = await open(src);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round((w * v.videoHeight) / v.videoWidth);
  await seek(v, t);
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
  return jpeg(c);
}

/** a stretch of it as a film of its own, small enough for a page: no sound */
export async function clip(src: string, from: number, to: number, o: { w?: number; fps?: number; rate?: number } = {}): Promise<Blob> {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const v = await open(src), W = o.w ?? 960, H = Math.round((W * v.videoHeight) / v.videoWidth / 2) * 2, FPS = o.fps ?? 30;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => console.error('[clip]', e.message) });
  enc.configure({ codec: 'avc1.4D401F', width: W, height: H, bitrate: o.rate ?? 1_500_000, framerate: FPS, latencyMode: 'quality', avc: { format: 'avc' } });
  const n = Math.round((to - from) * FPS);
  for (let i = 0; i < n; i++) {
    await seek(v, from + i / FPS);
    g.drawImage(v, 0, 0, W, H);
    const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 10));
  }
  await enc.flush();
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

/** hand it to the receiver, which writes it down under this name */
export async function send(name: string, what: Blob): Promise<string> {
  const r = await fetch(`http://127.0.0.1:5199/?name=${encodeURIComponent(name)}`, { method: 'POST', body: what });
  return `${name}: ${Math.round(what.size / 1024)} KB, ${await r.text()}`;
}

/**
 * A film of frames filmed as the page drew them (play.mjs `rec`: each frame's file and the moment it was drawn), at an
 * even `fps`: each moment shows the last frame drawn by then. The guide's films (the owner, 2026-10-26: "why are all of
 * the guide's footage super low quality?": they were 640 wide at four frames a second).
 */
export async function film(frames: { url: string; t: number }[], o: { fps?: number; rate?: number } = {}): Promise<Blob> {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const FPS = o.fps ?? 30;
  const load = async (url: string) => createImageBitmap(await (await fetch(url)).blob());
  let bmp = await load(frames[0].url);
  const W = bmp.width & ~1, H = bmp.height & ~1;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => console.error('[film]', e.message) });
  enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: o.rate ?? 4_000_000, framerate: FPS, latencyMode: 'quality', avc: { format: 'avc' } });
  const t0 = frames[0].t, n = Math.max(1, Math.round((frames[frames.length - 1].t - t0) * FPS));
  let j = 0, shown = 0;
  g.drawImage(bmp, 0, 0, W, H);
  for (let i = 0; i <= n; i++) {
    while (j + 1 < frames.length && frames[j + 1].t <= t0 + i / FPS + 1e-4) j++;
    if (j !== shown) {
      bmp.close();
      bmp = await load(frames[j].url);
      g.drawImage(bmp, 0, 0, W, H);
      shown = j;
    }
    const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 10));
  }
  bmp.close();
  await enc.flush();
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

/** a blob as base64, for the headless tool's `__save` (which writes it out as bytes) */
export async function b64(b: Blob): Promise<string> {
  const a = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}
