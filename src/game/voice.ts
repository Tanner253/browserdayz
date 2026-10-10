// Talking to whoever is near (hold V). What the microphone hears is packed small (Opus, by the browser's own
// coder), sent to the server a fiftieth of a second at a time, and passed on by it to the players within
// VOICE.range of the speaker and to nobody else; each of them hears it from where the speaker stands, fainter
// the further off. It goes by the server and not from one player's machine to another's: nobody learns where
// on the internet anybody else is, and it is the server, not the listener's game, that says who is in earshot.
//
// A browser without the coder (WebCodecs) neither sends nor hears, and the game says so once.

import { VOICE, loud } from '../sim/voice';

/** a voice beside the player, against everything else that is heard (speech is quiet beside gunfire) */
const LOUDEST = 1.8;

interface Peer {
  dec: AudioDecoder;
  gain: GainNode;
  pan: PannerNode;
  /** when, on the game's clock of sound, the next piece of them is to be heard */
  next: number;
  heard: number;
  frames: number;
}

export class Voice {
  readonly supported = typeof AudioEncoder === 'function' && typeof AudioDecoder === 'function' && typeof AudioData === 'function';
  talking = false;
  /** what has gone out and what has been heard (for the test of it: see `loop`) */
  stats = { sent: 0, played: 0, peak: 0 };
  private cap: AudioContext | null = null;
  private enc: AudioEncoder | null = null;
  private src: AudioNode | null = null;
  private tap: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private seq = 0;
  private ts = 0;
  private idle = 0;
  /** the test of it is running (`loop`): the game, which sees no key held, is not to stop it */
  private testing = false;
  private peers = new Map<number, Peer>();

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
      this.cap ??= new AudioContext({ sampleRate: 48000 });
      await this.cap.resume();
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
        if (!this.tap) {
          this.tap = this.cap.createScriptProcessor(1024, 1, 1);
          // (it has to end somewhere to be run at all: it ends in silence)
          const mute = this.cap.createGain();
          mute.gain.value = 0;
          this.tap.connect(mute).connect(this.cap.destination);
          this.tap.onaudioprocess = (e) => this.capture(e.inputBuffer.getChannelData(0));
        }
        this.src.connect(this.tap);
      }
      if (!this.enc || this.enc.state === 'closed') {
        this.enc = new AudioEncoder({ output: (chunk) => this.packet(chunk), error: () => (this.enc = null) });
        this.enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 20000 });
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

  private capture(pcm: Float32Array) {
    // (behind with its coding, it drops what it cannot keep up with: late speech is worse than a gap)
    if (!this.talking || !this.enc || this.enc.state !== 'configured' || this.enc.encodeQueueSize > 8) return;
    const data = new AudioData({ format: 'f32', sampleRate: 48000, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: this.ts, data: pcm.slice() });
    this.ts += (pcm.length / 48000) * 1e6;
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
    const id = new DataView(buf).getUint16(0, true);
    let p = this.peers.get(id);
    if (!p) {
      const gain = ctx.createGain(), pan = ctx.createPanner();
      // From where they stand. How loud is not left to the panner: it is `loud` of how far off they are, set
      // every frame (see `update`), so it is the same curve the test checks; until it is known where they
      // are, they are not heard at all.
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'linear';
      pan.rolloffFactor = 0;
      gain.gain.value = 0;
      gain.connect(pan).connect(bus);
      const peer: Peer = { dec: null as unknown as AudioDecoder, gain, pan, next: 0, heard: 0, frames: 0 };
      peer.dec = new AudioDecoder({ output: (d) => this.play(peer, d), error: () => void this.peers.delete(id) });
      peer.dec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
      this.peers.set(id, (p = peer));
    }
    p.heard = performance.now();
    if (p.dec.state !== 'configured' || p.dec.decodeQueueSize > 12) return;
    p.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: p.frames++ * 20000, data: new Uint8Array(buf, 4) }));
  }

  private play(p: Peer, d: AudioData) {
    const ctx = this.ctx();
    if (!ctx) return void d.close();
    const n = d.numberOfFrames, buf = ctx.createBuffer(1, n, d.sampleRate), ch = buf.getChannelData(0);
    d.copyTo(ch, { planeIndex: 0, format: 'f32-planar' });
    d.close();
    for (let i = 0; i < n; i += 16) this.stats.peak = Math.max(this.stats.peak, Math.abs(ch[i]));
    this.stats.played++;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(p.gain);
    // (a little kept in hand: what arrives unevenly is heard evenly)
    const now = ctx.currentTime;
    if (p.next < now + 0.02 || p.next > now + 0.6) p.next = now + 0.09;
    src.start(p.next);
    p.next += n / d.sampleRate;
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
        if (p.dec.state !== 'closed') p.dec.close();
        p.gain.disconnect();
        this.peers.delete(id);
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
