// Talking to whoever is near (hold V). What the microphone hears is packed small (Opus, by the browser's own
// coder), sent to the server a fiftieth of a second at a time, and passed on by it to the players within
// VOICE.range of the speaker and to nobody else; each of them hears it from where the speaker stands, fainter
// the further off. It goes by the server and not from one player's machine to another's: nobody learns where
// on the internet anybody else is, and it is the server, not the listener's game, that says who is in earshot.
//
// Sound is taken and given on the sound's own thread (two worklets, below), never on the game's. As it was first
// made the microphone was read from the game's thread, and what was heard was fifty separate scraps a second
// laid end to end by the clock: measured (scripts/voice-check.mjs), half of what came out of it was silence and
// there was a break every few hundredths of a second. It worked, and nobody could be understood. Now the
// microphone's worklet cuts speech into pieces of exactly a fiftieth of a second and hands them over whole, and
// each speaker is heard through a worklet that keeps a little in hand (more, when what comes is uneven) and plays
// it as one unbroken sound.
//
// A browser without the coder (WebCodecs) neither sends nor hears, and the game says so once.

import { VOICE, loud } from '../sim/voice';

/** a voice beside the player, against everything else that is heard (speech is quiet beside gunfire) */
const LOUDEST = 1.8;
/** speech is coded at this many samples a second, in pieces this long */
const RATE = 48000, PIECE = 960;

/**
 * The two worklets, as the text of a module (so that there is no second file to find at run time).
 *   zona-mic: what comes in, cut into pieces of PIECE samples and posted, each whole.
 *   zona-ear: pieces posted to it (at RATE) are played at the rate of the engine it is in, in one unbroken line.
 *     It waits until it has `want` in hand before it begins; run dry, it waits again and wants a little more
 *     (what comes that unevenly will again); with far too much in hand it lets the oldest go (speech a second
 *     late is worse than a word lost). It comes in and goes out over a few thousandths of a second, not at a step.
 */
const WORKLETS = `
class ZonaMic extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${PIECE}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === ${PIECE}) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(${PIECE}); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('zona-mic', ZonaMic);
class ZonaEar extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(${RATE * 2});
    this.w = 0; this.r = 0; this.step = ${RATE} / sampleRate;
    this.want = ${RATE} * 0.1; this.going = false; this.level = 0; this.dry = 0;
    this.port.onmessage = (e) => {
      const pcm = e.data, N = this.ring.length;
      for (let i = 0; i < pcm.length; i++) this.ring[(this.w + i) % N] = pcm[i];
      this.w += pcm.length;
      if (this.w - this.r > this.want + ${RATE} * 0.45) this.r = this.w - this.want;
    };
  }
  process(_in, outputs) {
    const out = outputs[0][0], N = this.ring.length;
    if (!this.going && this.w - this.r >= this.want) this.going = true;
    for (let i = 0; i < out.length; i++) {
      if (this.going && this.w - this.r < 2) {
        this.going = false;
        this.dry++;
        this.want = Math.min(${RATE} * 0.36, this.want + ${RATE} * 0.04);
      }
      this.level += ((this.going ? 1 : 0) - this.level) * 0.004;
      if (this.going) {
        const k = Math.floor(this.r), f = this.r - k, a = this.ring[k % N], b = this.ring[(k + 1) % N];
        out[i] = (a + (b - a) * f) * this.level;
        this.r += this.step;
      } else out[i] = 0;
    }
    return true;
  }
}
registerProcessor('zona-ear', ZonaEar);
`;
let moduleUrl = '';
const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();
/** The worklets, put into an engine once. @returns whether they are there */
function worklets(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx);
  if (!p) {
    moduleUrl ||= URL.createObjectURL(new Blob([WORKLETS], { type: 'text/javascript' }));
    p = ctx.audioWorklet ? ctx.audioWorklet.addModule(moduleUrl).then(() => true, () => false) : Promise.resolve(false);
    loaded.set(ctx, p);
  }
  return p;
}

interface Peer {
  dec: AudioDecoder;
  ear: AudioWorkletNode;
  gain: GainNode;
  pan: PannerNode;
  heard: number;
  frames: number;
}

export class Voice {
  readonly supported = typeof AudioEncoder === 'function' && typeof AudioDecoder === 'function' && typeof AudioData === 'function' && typeof AudioWorkletNode === 'function';
  talking = false;
  /** what has gone out and what has been heard (for the test of it: see `loop`) */
  stats = { sent: 0, played: 0, peak: 0 };
  private cap: AudioContext | null = null;
  private enc: AudioEncoder | null = null;
  private src: AudioNode | null = null;
  private mic: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private seq = 0;
  private ts = 0;
  private idle = 0;
  /** the test of it is running (`loop`): the game, which sees no key held, is not to stop it */
  private testing = false;
  private peers = new Map<number, Peer>();
  /** the engine that is heard through has the worklets in it */
  private hearing = false;

  /**
   * @param ctx the game's own sound, once it has begun @param bus where in it a voice goes
   * @param send a packet to the server: [which piece u16][the piece]
   */
  constructor(private ctx: () => AudioContext | null, private bus: () => AudioNode | null, private send: (packet: Uint8Array) => void) {}

  /**
   * The key is down. The first time, the microphone is asked for; from then until `hush`, what it hears is sent.
   * @param tone no microphone: a steady note of this pitch instead (the test)
   * @returns what went wrong, in words for the player, or null
   */
  async talk(tone = 0): Promise<string | null> {
    if (!this.supported) return 'This browser cannot send or hear voice (it has no audio coder): an up-to-date Chrome or Edge can';
    if (this.talking) return null;
    this.talking = true;
    try {
      this.cap ??= new AudioContext({ sampleRate: RATE });
      await this.cap.resume();
      if (!(await worklets(this.cap))) throw new Error('no worklet');
      if (!this.src) {
        if (tone) {
          const osc = this.cap.createOscillator();
          osc.frequency.value = tone;
          osc.start();
          this.src = osc;
        } else {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
          this.src = this.cap.createMediaStreamSource(this.stream);
        }
        if (!this.mic) {
          this.mic = new AudioWorkletNode(this.cap, 'zona-mic', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
          // (it has to end somewhere to be run at all: it ends in silence)
          const mute = this.cap.createGain();
          mute.gain.value = 0;
          this.mic.connect(mute).connect(this.cap.destination);
          this.mic.port.onmessage = (e) => this.capture(e.data as Float32Array);
        }
        this.src.connect(this.mic);
      }
      if (!this.enc || this.enc.state === 'closed') {
        this.enc = new AudioEncoder({ output: (chunk) => this.packet(chunk), error: () => (this.enc = null) });
        // (speech, a fiftieth of a second to a piece; and each piece carries a thin copy of the one before it, so
        // that one lost on the way is not a hole)
        this.enc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: 32000, opus: { frameDuration: 20000, application: 'voip', signal: 'voice', useinbandfec: true, packetlossperc: 5 } } as AudioEncoderConfig);
      }
    } catch (e) {
      this.talking = false;
      return /NotAllowed|denied/i.test(String(e)) ? 'The microphone was refused: allow it for this site, and hold V to talk' : 'No microphone could be opened';
    }
    return null;
  }

  /** the key is up */
  hush() {
    if (!this.testing) this.talking = false;
  }

  /** A piece from the microphone's worklet: exactly PIECE samples. */
  private capture(pcm: Float32Array) {
    // (behind with its coding, it drops what it cannot keep up with: late speech is worse than a gap)
    if (!this.talking || !this.enc || this.enc.state !== 'configured' || this.enc.encodeQueueSize > 12) return;
    const data = new AudioData({ format: 'f32', sampleRate: RATE, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: this.ts, data: pcm as Float32Array<ArrayBuffer> });
    this.ts += Math.round((pcm.length / RATE) * 1e6);
    this.enc.encode(data);
    data.close();
  }

  private packet(chunk: EncodedAudioChunk) {
    if (chunk.byteLength > VOICE.bytes - 4) return;
    const out = new Uint8Array(chunk.byteLength + 2);
    out[0] = this.seq & 255;
    out[1] = (this.seq >> 8) & 255;
    this.seq++;
    chunk.copyTo(out.subarray(2));
    this.stats.sent++;
    this.send(out);
  }

  /** A packet from the server: [who u16][which piece u16][the piece]. */
  hear(buf: ArrayBuffer) {
    const ctx = this.ctx(), bus = this.bus();
    if (!this.supported || !ctx || !bus || buf.byteLength < 5) return;
    if (!this.hearing) {
      // (the first that is heard brings the worklets in: what comes before they are there is not heard)
      void worklets(ctx).then((ok) => (this.hearing = ok));
      return;
    }
    const id = new DataView(buf).getUint16(0, true);
    let p = this.peers.get(id);
    if (!p) {
      const ear = new AudioWorkletNode(ctx, 'zona-ear', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      const gain = ctx.createGain(), pan = ctx.createPanner();
      // From where they stand. How loud is not left to the panner: it is `loud` of how far off they are, set
      // every frame (see `update`), so it is the same curve the test checks; until it is known where they
      // are, they are not heard at all.
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'linear';
      pan.rolloffFactor = 0;
      gain.gain.value = 0;
      ear.connect(gain).connect(pan).connect(bus);
      const peer: Peer = { dec: null as unknown as AudioDecoder, ear, gain, pan, heard: 0, frames: 0 };
      peer.dec = new AudioDecoder({ output: (d) => this.play(peer, d), error: () => void this.drop(id) });
      peer.dec.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 });
      this.peers.set(id, (p = peer));
    }
    p.heard = performance.now();
    if (p.dec.state !== 'configured' || p.dec.decodeQueueSize > 16) return;
    p.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: p.frames++ * 20000, data: new Uint8Array(buf, 4) }));
  }

  /** What the coder gives back is handed to that speaker's worklet, which plays it. */
  private play(p: Peer, d: AudioData) {
    const pcm = new Float32Array(d.numberOfFrames);
    d.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
    d.close();
    for (let i = 0; i < pcm.length; i += 16) this.stats.peak = Math.max(this.stats.peak, Math.abs(pcm[i]));
    this.stats.played++;
    p.ear.port.postMessage(pcm, [pcm.buffer]);
  }

  private drop(id: number) {
    const p = this.peers.get(id);
    if (!p) return;
    if (p.dec.state !== 'closed') p.dec.close();
    p.ear.disconnect();
    p.gain.disconnect();
    p.pan.disconnect();
    this.peers.delete(id);
  }

  /**
   * Every frame: each speaker is put where they stand and made as loud as they are near, and whoever has not
   * been heard for a while is let go of.
   * @param ear where the player is @returns who is talking now
   */
  update(where: (id: number) => { x: number; y: number; z: number } | null, ear: { x: number; y: number; z: number }): number[] {
    const now = performance.now(), out: number[] = [], clock = this.ctx()?.currentTime ?? 0;
    for (const [id, p] of this.peers) {
      if (now - p.heard > 30000) {
        this.drop(id);
        continue;
      }
      const at = where(id);
      if (at) {
        p.pan.positionX.value = at.x;
        p.pan.positionY.value = at.y + 1.6;
        p.pan.positionZ.value = at.z;
        // (eased over a tenth of a second: walking away, a voice sinks and does not step down)
        p.gain.gain.setTargetAtTime(LOUDEST * loud(Math.hypot(at.x - ear.x, at.y - ear.y, at.z - ear.z)), clock, 0.1);
      }
      if (now - p.heard < 350) out.push(id);
    }
    // the microphone is let go of when it has not been talked into for a while (the browser's mark that it is open goes out)
    if (this.talking) this.idle = now;
    else if (this.stream && now - this.idle > 20000) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
      this.src?.disconnect();
      this.src = null;
    }
    return out;
  }

  /**
   * The whole of it but the wire and the microphone, for a test: a note is coded as speech is, and what is
   * coded is heard as somebody else's would be. @returns how many pieces went out, how many were played, how loud
   */
  async loop(ms: number): Promise<{ sent: number; played: number; peak: number; error: string | null }> {
    const wire = this.send;
    this.stats = { sent: 0, played: 0, peak: 0 };
    this.send = (b) => {
      const o = new Uint8Array(b.length + 2);
      o[0] = 0xfe;
      o[1] = 0x7f;
      o.set(b, 2);
      this.hear(o.buffer);
    };
    this.testing = true;
    const error = await this.talk(440);
    await new Promise((r) => setTimeout(r, ms));
    this.testing = false;
    this.hush();
    // (what is still on its way through the coder is let out)
    await new Promise((r) => setTimeout(r, 300));
    this.send = wire;
    // (the note is not left where a microphone goes)
    this.src?.disconnect();
    this.src = null;
    return { ...this.stats, error };
  }
}
