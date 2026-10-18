// A ten-second film of the changelog alone, as a call to check it and follow the game being made (the owner,
// 2026-10-15: "make a 10 second trailer of JUST the changelog screen, a call to action to check the changelog and
// follow development"). The real page, in a frame, scrolled on the film's own clock: a title over its head, the newest
// entries going by, and the address and the X account to end on. Filmed by scripts/film.mjs, which asks of a page what
// it asks of the trailer's (window.tr): ready, info, begin, step, encodeFrame, finish, piece, soundLog.
//
//   node scripts/film.mjs --url http://localhost:5173/tools/reel.html --out zona-changelog-reel
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { scoreMusic15 } from './music15';

const SECONDS = 10;
/** where each part begins and ends (seconds): the title, the entries going by, the end */
const T = { title: [0, 1.9], scroll: [1.6, 7.7], end: [7.4, 10] };
/** the entries gone by, newest first (their ids on the page); the scroll goes from the first's head to the last's */
const FROM = '#controller', TO = '#faster-start';
const X = 'zonaSOL_';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const tr: Any = { ready: false, failed: '' };
(window as unknown as Any).tr = tr;

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0 }
  html, body { width: 1280px; height: 720px; overflow: hidden; background: #0c0e0d }
  #reel { position: relative; width: 1280px; height: 720px; overflow: hidden; font-family: 'Barlow Condensed', 'Bahnschrift', 'Arial Narrow', sans-serif; color: #e9e4d8 }
  #page { position: absolute; left: 0; top: 0; width: 1280px; height: 720px; border: 0; transform-origin: 50% 40% }
  .veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, rgba(8, 10, 9, 0.78), rgba(8, 10, 9, 0.94)); }
  .card { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; text-align: center }
  .mark { width: 74px; height: 74px; margin-bottom: 12px }
  .kick { font: 600 15px 'JetBrains Mono', monospace; letter-spacing: 0.32em; color: #c9b27c; text-transform: uppercase }
  .big { margin-top: 4px; font-size: 112px; font-weight: 800; line-height: 0.95; letter-spacing: 0.04em; text-transform: uppercase }
  .big em { font-style: normal; color: #ffd35a }
  .sub { margin-top: 12px; font-size: 26px; color: rgba(233, 228, 216, 0.75) }
  .url { margin-top: 20px; padding: 10px 26px; font: 600 34px 'JetBrains Mono', monospace; color: #141109; background: #ffd35a; border-radius: 4px }
  .x { margin-top: 18px; font-size: 30px }
  .x b { color: #ffd35a }
  .tag { position: absolute; left: 22px; bottom: 18px; padding: 6px 12px; font: 600 14px 'JetBrains Mono', monospace; letter-spacing: 0.08em; color: #e9e4d8; background: rgba(10, 12, 11, 0.8); border: 1px solid rgba(255, 211, 90, 0.5); border-radius: 3px }
`;

const reel = document.getElementById('reel')!;
reel.innerHTML = `<style>${css}</style>
  <iframe id="page" src="/changelog/index.html"></iframe>
  <div class="tag">zonapvp.fun/changelog</div>
  <div class="veil" id="veil"></div>
  <div class="card" id="title"><img class="mark" src="/brand/zona-mark.svg" alt=""><div class="kick">ZONA · the changelog</div><div class="big">Every update,<br><em>shown</em></div><div class="sub">What changed, with pictures of it</div></div>
  <div class="card" id="end"><img class="mark" src="/brand/zona-mark.svg" alt=""><div class="kick">See what's new</div><div class="big">Follow the <em>build</em></div><div class="url">zonapvp.fun/changelog</div><div class="x">and on X: <b>@${X}</b></div></div>`;
const frame = document.getElementById('page') as HTMLIFrameElement;
const veil = document.getElementById('veil')!, title = document.getElementById('title')!, end = document.getElementById('end')!;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const ease = (v: number) => (v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2);
/** 0 before `a`, 1 after `b`, eased between */
const along = (t: number, a: number, b: number) => ease(clamp((t - a) / (b - a)));
let from = 0, to = 0;

async function stage() {
  // (the frame's first document is a blank one, already complete: the changelog's own is waited for)
  for (let k = 0; ; k++) {
    const d = frame.contentDocument;
    if (d && d.readyState === 'complete' && d.location.pathname.includes('changelog') && d.querySelector(TO)) break;
    if (k > 600) throw new Error('the changelog did not load');
    await sleep(100);
  }
  console.log('[tr] the changelog is in');
  const doc = frame.contentDocument!;
  // (no scroll bar, and every picture there before the first frame: the page lazily fetches them as they come near)
  const st = doc.createElement('style');
  st.textContent = 'html{scrollbar-width:none;scroll-behavior:auto!important}::-webkit-scrollbar{display:none}';
  doc.head.append(st);
  const imgs = [...doc.images];
  for (const i of imgs) i.loading = 'eager';
  // (a picture that will not come is not waited for past a few seconds)
  await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), sleep(8000)]);
  await Promise.race([doc.fonts?.ready, sleep(4000)]);
  console.log(`[tr] ${imgs.length} pictures in`);
  const top = (sel: string) => (doc.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect().top ?? 0;
  from = Math.max(0, top(FROM) - 70);
  to = Math.max(from, top(TO) + 120);
  tr.ready = true;
}

/** the film at frame i */
async function step(i: number) {
  const t = i / fps;
  const win = frame.contentWindow!;
  const s = along(t, T.scroll[0], T.scroll[1]);
  win.scrollTo({ top: Math.round(from + (to - from) * s), behavior: 'instant' });
  // (a slow push in all through)
  frame.style.transform = `scale(${(1 + 0.05 * (t / SECONDS)).toFixed(4)})`;
  const titleOn = 1 - along(t, T.title[1] - 0.45, T.title[1]);
  const endOn = along(t, T.end[0], T.end[0] + 0.6);
  veil.style.opacity = String(Math.max(titleOn, endOn).toFixed(3));
  title.style.opacity = titleOn.toFixed(3);
  title.style.transform = `translateY(${(-20 * (1 - titleOn)).toFixed(1)}px) scale(${(0.96 + 0.04 * along(t, 0, 0.8)).toFixed(4)})`;
  end.style.opacity = endOn.toFixed(3);
  end.style.transform = `translateY(${(24 * (1 - endOn)).toFixed(1)}px)`;
  // (what was laid out this frame is what is photographed)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// ------------------------------------------------------------------------------------------ the film script's side
let fps = 60;
let muxer: Muxer<ArrayBufferTarget> | null = null;
let venc: VideoEncoder | null = null;
let take = { first: 0, last: 0, width: 1920, height: 1080, audio: 192_000 };
const pieces: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

tr.info = () => ({ gpu: 'page', seconds: SECONDS, shots: [['reel', 0, SECONDS]] });
tr.begin = async (o: { fps: number; first: number; last: number; width: number; height: number; video: boolean; bitrate?: number; audio?: number }) => {
  fps = o.fps;
  take = { ...take, ...o };
  pieces.length = 0;
  if (!o.video) return;
  muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: o.width, height: o.height, frameRate: fps }, audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 }, fastStart: 'in-memory' });
  venc = new VideoEncoder({ output: (chunk, meta) => muxer!.addVideoChunk(chunk, meta), error: (e) => console.error('[tr] video encoder', e.message) });
  venc.configure({ codec: 'avc1.64002A', width: o.width, height: o.height, bitrate: o.bitrate ?? (o.width >= 1900 ? 14_000_000 : 5_000_000), framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } });
};
tr.step = step;
tr.encodeFrame = async (b64: string, k: number) => {
  const bmp = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
  const f = new VideoFrame(bmp, { timestamp: Math.round((k * 1e6) / fps), duration: Math.round(1e6 / fps) });
  venc!.encode(f, { keyFrame: k % (fps * 2) === 0 });
  f.close();
  bmp.close();
  while (venc!.encodeQueueSize > 4) await sleep(4);
};
tr.finish = async () => {
  await venc!.flush();
  // the score: the emote film's, its first bars, let down over the last second
  const SR = 48000, off = new OfflineAudioContext(2, SECONDS * SR, SR);
  const out = off.createGain();
  out.gain.setValueAtTime(0.9, 0);
  out.gain.setValueAtTime(0.9, SECONDS - 1.2);
  out.gain.linearRampToValueAtTime(0, SECONDS - 0.05);
  out.connect(off.destination);
  scoreMusic15(off, out, ['rise', 'drop', 'drop', 'final', 'end', 'end']);
  const buf = await off.startRendering();
  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer!.addAudioChunk(chunk, meta), error: (e) => console.error('[tr] audio encoder', e.message) });
  aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: take.audio });
  const a = Math.round((take.first / fps) * SR), b = Math.min(buf.length, Math.round((take.last / fps) * SR));
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = a; i < b; i += 4800) {
    const n = Math.min(4800, b - i), data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0);
    data.set(R.subarray(i, i + n), n);
    aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(((i - a) * 1e6) / SR), data }));
    while (aenc.encodeQueueSize > 8) await sleep(2);
  }
  await aenc.flush();
  muxer!.finalize();
  const bytes = new Uint8Array(muxer!.target.buffer), CH = 3 * 1024 * 1024;
  for (let i = 0; i < bytes.length; i += CH) {
    let s = '';
    const part = bytes.subarray(i, i + CH);
    for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode(...part.subarray(j, j + 0x8000));
    pieces.push(btoa(s));
  }
  return pieces.length;
};
tr.piece = (k: number) => pieces[k];
tr.soundLog = () => [];

stage().catch((e) => {
  console.error('[tr] staging failed', e);
  tr.failed = String(e?.message ?? e);
});
