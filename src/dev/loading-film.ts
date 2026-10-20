// The page's half of scripts/loading-film.mjs: the loading screen's short film for socials (the owner, 2026-10-20:
// "can we make a 10 second trailer out of it? spooky music?", then "doesnt need th eloading bar or text its just a small
// piece of marketing media"). The frames come in from the script as pictures; the score is the seventeenth film's band
// (music17.ts): its music box alone, the dread, a heartbeat, and the end's blow, a bar of 2 s each. Not in the build.

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { BAR17, scoreMusic17, type Row17 } from '../trailer/music17';

/** the music box as the sign unfurls and the pumpkins land; dread under the first click (4 s), a heartbeat under the
 * pumpkin's hop (6 s) rising to the end's blow with the last burst of gas (8 s) */
export const ROWS: Row17[] = [{ kind: 'box', hit: 0.5 }, { kind: 'box', build: 0.5 }, { kind: 'dread', hit: 0.5 }, { kind: 'sting', lift: 0.7 }, { kind: 'end' }];
export const SECONDS = ROWS.length * BAR17;
const SR = 48000;

/** a frame later: the page's own timers are the film's clock here, so the wait is on the screen's */
const later = () => new Promise((r) => requestAnimationFrame(r));

export function film(width: number, height: number, fps: number) {
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: fps }, audio: { codec: 'aac', sampleRate: SR, numberOfChannels: 2 }, fastStart: 'in-memory' });
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => console.error('[film] video', e.message) });
  venc.configure({ codec: 'avc1.64002A', width, height, bitrate: 12_000_000, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } });
  let k = 0;
  return {
    /** one frame, a JPEG as base64 */
    async frame(b64: string) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const vf = new VideoFrame(bmp, { timestamp: Math.round((k * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: k % (fps * 2) === 0 });
      vf.close();
      bmp.close();
      k++;
      while (venc.encodeQueueSize > 4) await later();
    },
    /** the score under it, and the file, in pieces of base64 */
    async finish() {
      await venc.flush();
      const off = new OfflineAudioContext(2, Math.ceil(SECONDS * SR), SR);
      scoreMusic17(off, off.destination, ROWS);
      const buf = await off.startRendering();
      let peak = 0, sum = 0;
      const d0 = buf.getChannelData(0);
      for (let i = 0; i < d0.length; i++) {
        peak = Math.max(peak, Math.abs(d0[i]));
        sum += d0[i] * d0[i];
      }
      const level = `peak ${(20 * Math.log10(peak + 1e-9)).toFixed(1)} dB, rms ${(20 * Math.log10(Math.sqrt(sum / d0.length) + 1e-9)).toFixed(1)} dB`;
      // (the films' soft ceiling: the loudest moments lean into it instead of clipping)
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * 1.15) * 0.97;
      }
      const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => console.error('[film] audio', e.message) });
      aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 192_000 });
      const end = Math.min(buf.length, Math.round((k / fps) * SR)), L = buf.getChannelData(0), R = buf.getChannelData(1);
      for (let i = 0; i < end; i += 4800) {
        const n = Math.min(4800, end - i), data = new Float32Array(n * 2);
        data.set(L.subarray(i, i + n), 0);
        data.set(R.subarray(i, i + n), n);
        aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i * 1e6) / SR), data }));
        while (aenc.encodeQueueSize > 8) await later();
      }
      await aenc.flush();
      muxer.finalize();
      const bytes = new Uint8Array(muxer.target.buffer), pieces: string[] = [], CH = 3 * 1024 * 1024;
      for (let i = 0; i < bytes.length; i += CH) {
        let s = '';
        const part = bytes.subarray(i, i + CH);
        for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode(...part.subarray(j, j + 0x8000));
        pieces.push(btoa(s));
      }
      return { pieces, level };
    },
  };
}
