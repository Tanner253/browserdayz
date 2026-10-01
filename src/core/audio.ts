// Procedural audio. Every sound is synthesised from noise + oscillators at runtime:
// no licensed sample packs, tiny download, and endless variation per shot/step.
// Positional sounds use HRTF panners; gunshots get an outdoor slap-back echo.

import type { Surface } from './physics';

type V3 = { x: number; y: number; z: number };

export class AudioEngine {
  ctx!: AudioContext;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private echo!: DelayNode;
  private noiseBuf!: AudioBuffer;
  private ambience: { wind?: GainNode; birdsT: number; indoors?: boolean } = { birdsT: 3 };
  ready = false;

  /** Must be called from a user gesture. */
  start() {
    if (this.ready) {
      void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    // white noise source buffer (2 s)
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // outdoor reverb: diffuse decaying noise impulse
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        ch[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.1) * (t < 0.02 ? t / 0.02 : 1);
      }
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    const revLP = ctx.createBiquadFilter();
    revLP.type = 'lowpass';
    revLP.frequency.value = 2400;
    this.reverbSend.connect(this.reverb).connect(revLP).connect(this.master);

    // valley slap-back echo for gunshots
    this.echo = ctx.createDelay(2);
    this.echo.delayTime.value = 0.62;
    const echoGain = ctx.createGain();
    echoGain.gain.value = 0.28;
    const echoLP = ctx.createBiquadFilter();
    echoLP.type = 'lowpass';
    echoLP.frequency.value = 900;
    this.echo.connect(echoLP).connect(echoGain).connect(this.reverbSend);
    echoGain.connect(this.master);

    this.startAmbience();
    this.ready = true;
  }

  setListener(pos: V3, fwd: V3, up: V3) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    // plain value writes: scheduling an automation event on 9 params every frame
    // piles up timeline events in the audio engine the longer the game runs
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    }
  }

  // ------------------------------------------------------------ primitives

  private noise(t0: number, dur: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    src.start(t0, Math.random() * 1.5, dur + 0.05);
    return src;
  }

  private env(g: GainNode, t0: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Output node: positional (HRTF) or direct. Distance also dulls the high end. */
  private out(pos?: V3, refDist = 4, rolloff = 1.2, distance = 0) {
    if (!pos) return this.sfx as AudioNode;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.rolloffFactor = rolloff;
    p.maxDistance = 2000;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    const lp = this.filter('lowpass', Math.max(700, 18000 - distance * 40));
    lp.connect(p).connect(this.sfx);
    return lp as AudioNode;
  }

  // ------------------------------------------------------------ weapons

  gunshot(kind: 'rifle' | 'pistol', pos?: V3, distance = 0, intermediate = false, suppressed = false) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (distance > 0 ? distance / 343 : 0);
    if (suppressed) {
      // suppressed: a flat, dull snap and the action cycling; carries a fraction of the distance
      const o2 = this.out(pos, 5, 1.6, distance * 3);
      const n = this.noise(t, 0.12);
      const f = this.filter('bandpass', 1300, 0.8);
      const g = ctx.createGain();
      this.env(g, t, 0.55, 0.002, 0.07);
      n.connect(f).connect(g).connect(o2);
      const th = ctx.createOscillator();
      th.frequency.setValueAtTime(180, t);
      th.frequency.exponentialRampToValueAtTime(70, t + 0.08);
      const tg = ctx.createGain();
      this.env(tg, t, 0.35, 0.002, 0.08);
      th.connect(tg).connect(o2);
      th.start(t);
      th.stop(t + 0.2);
      return;
    }
    const big = kind === 'rifle';
    // 7.62x39: sharper and shorter than the full-power Mosin round
    const mid = intermediate ? 0.72 : 1;
    const out = this.out(pos, big ? 30 : 15, 0.8, distance);
    const send = ctx.createGain();
    send.gain.value = big ? 0.9 : 0.6;
    out.connect(send);
    send.connect(this.reverbSend);
    send.connect(this.echo);

    // 1. supersonic crack / mechanical transient
    const crack = this.noise(t, 0.05);
    const ch = this.filter('highpass', big ? 2200 : 3000);
    const cg = ctx.createGain();
    this.env(cg, t, big ? 1.6 : 1.1, 0.0008, 0.035);
    crack.connect(ch).connect(cg).connect(out);

    // 2. muzzle blast: broadband noise burst, low-passed with a falling cutoff
    const blast = this.noise(t, 0.6);
    const bl = this.filter('lowpass', big ? 3800 : 5200, 0.9);
    bl.frequency.setValueAtTime(big ? 3800 : 5200, t);
    bl.frequency.exponentialRampToValueAtTime(big ? 260 : 520, t + (big ? 0.35 : 0.22));
    const bg = ctx.createGain();
    this.env(bg, t, (big ? 2.2 : 1.4) * mid, 0.002, (big ? 0.55 : 0.3) * mid);
    blast.connect(bl).connect(bg).connect(out);

    // 3. sub-bass thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 95 : 140, t);
    o.frequency.exponentialRampToValueAtTime(big ? 38 : 60, t + 0.18);
    const og = ctx.createGain();
    this.env(og, t, (big ? 1.8 : 0.9) * mid, 0.002, (big ? 0.32 : 0.16) * mid);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.6);
  }

  dryFire() {
    this.click(4200, 0.35, 0.015);
  }

  /** short metallic click (bolt, mag, hammer) */
  click(freq = 3000, vol = 0.4, dur = 0.02, delay = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const n = this.noise(t, dur + 0.03);
    const f = this.filter('bandpass', freq * (0.9 + Math.random() * 0.2), 6);
    const g = this.ctx.createGain();
    this.env(g, t, vol, 0.0008, dur);
    n.connect(f).connect(g).connect(this.sfx);
    const ring = this.ctx.createOscillator();
    ring.type = 'triangle';
    ring.frequency.value = freq * 0.71;
    const rg = this.ctx.createGain();
    this.env(rg, t, vol * 0.15, 0.001, dur * 2.5);
    ring.connect(rg).connect(this.sfx);
    ring.start(t);
    ring.stop(t + dur * 3 + 0.05);
  }

  boltCycle(start = 0) {
    this.click(2400, 0.45, 0.025, start); // handle up
    this.click(1700, 0.5, 0.06, start + 0.18); // pull back
    this.slide(start + 0.18, 0.14, 900);
    this.click(2000, 0.5, 0.05, start + 0.42); // push forward
    this.slide(start + 0.36, 0.1, 1100);
    this.click(2800, 0.45, 0.025, start + 0.6); // handle down
  }

  private slide(start: number, dur: number, freq: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + start;
    const n = this.noise(t, dur);
    const f = this.filter('bandpass', freq, 2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.sfx);
  }

  roundInsert(delay = 0) {
    this.click(3400, 0.3, 0.02, delay);
    this.click(2100, 0.35, 0.03, delay + 0.06);
  }

  magOut(delay = 0) {
    this.click(1500, 0.4, 0.05, delay);
    this.slide(delay, 0.08, 800);
  }

  magIn(delay = 0) {
    this.slide(delay, 0.06, 700);
    this.click(1900, 0.55, 0.04, delay + 0.06);
  }

  slideRack(delay = 0) {
    this.click(2600, 0.45, 0.03, delay);
    this.slide(delay, 0.09, 1300);
    this.click(3300, 0.5, 0.03, delay + 0.12);
  }

  shellDrop(delay = 0.35) {
    if (!this.ready) return;
    for (let i = 0; i < 3; i++) this.click(5200 + Math.random() * 1500, 0.08 / (i + 1), 0.04, delay + i * 0.09 + Math.random() * 0.03);
  }

  // ------------------------------------------------------------ world

  /** latch click + hinge creak (opening) or a soft thud (closing) */
  door(opening: boolean, pos: V3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, 3, 1.2);
    this.click(opening ? 1400 : 900, 0.4, 0.04);
    if (opening) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 160 + Math.random() * 120;
      o.frequency.setValueAtTime(f0, t + 0.05);
      o.frequency.linearRampToValueAtTime(f0 * 1.35, t + 0.35);
      o.frequency.linearRampToValueAtTime(f0 * 0.9, t + 0.7);
      const wob = this.ctx.createOscillator();
      wob.frequency.value = 11 + Math.random() * 6;
      const wg = this.ctx.createGain();
      wg.gain.value = f0 * 0.08;
      wob.connect(wg).connect(o.frequency);
      const f = this.filter('bandpass', 1100, 4);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + 0.05);
      g.gain.linearRampToValueAtTime(0.09, t + 0.18);
      g.gain.linearRampToValueAtTime(0.05, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      o.connect(f).connect(g).connect(out);
      o.start(t + 0.05);
      wob.start(t + 0.05);
      o.stop(t + 0.85);
      wob.stop(t + 0.85);
    } else {
      const n = this.noise(t + 0.35, 0.15);
      const f = this.filter('lowpass', 380, 1);
      const g = this.ctx.createGain();
      this.env(g, t + 0.35, 0.7, 0.003, 0.12);
      n.connect(f).connect(g).connect(out);
      this.click(700, 0.35, 0.05, 0.38);
    }
  }

  impact(surface: Surface, pos: V3, distance: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, 3, 1.3, distance);
    const n = this.noise(t, 0.2);
    let f: BiquadFilterNode;
    let peak = 0.7;
    let dec = 0.08;
    switch (surface) {
      case 'metal': {
        f = this.filter('bandpass', 2600 + Math.random() * 1600, 12);
        peak = 0.9;
        dec = 0.4;
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 1800 + Math.random() * 1400;
        const og = this.ctx.createGain();
        this.env(og, t, 0.25, 0.001, 0.5);
        o.connect(og).connect(out);
        o.start(t);
        o.stop(t + 0.6);
        break;
      }
      case 'wood':
        f = this.filter('bandpass', 700, 3);
        dec = 0.09;
        break;
      case 'concrete':
      case 'rock':
      case 'plaster':
      case 'asphalt':
        f = this.filter('bandpass', 1800, 1.5);
        dec = 0.06;
        break;
      case 'flesh':
        f = this.filter('lowpass', 600, 1);
        peak = 1.0;
        dec = 0.12;
        break;
      case 'glass':
        f = this.filter('highpass', 3500, 1);
        dec = 0.3;
        break;
      default:
        f = this.filter('lowpass', 900, 0.8);
        peak = 0.6;
        dec = 0.1;
    }
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.001, dec);
    n.connect(f).connect(g).connect(out);
  }

  footstep(surface: Surface | 'grass' | 'dirt' | 'gravel', speed: number, pos?: V3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const vol = Math.min(1, 0.15 + speed * 0.07);
    const out = this.out(pos, 2, 1.5);
    const layer = (type: BiquadFilterType, freq: number, q: number, v: number, a: number, d: number, at = 0) => {
      const n = this.noise(t + at, a + d + 0.02);
      const f = this.filter(type, freq * (0.85 + Math.random() * 0.3), q);
      const g = this.ctx.createGain();
      this.env(g, t + at, v * vol, a, d);
      n.connect(f).connect(g).connect(out);
    };
    switch (surface) {
      case 'wood':
        layer('bandpass', 320, 2, 0.6, 0.003, 0.07);
        layer('bandpass', 1400, 4, 0.12, 0.002, 0.05, 0.01);
        break;
      case 'gravel':
      case 'rock':
        for (let i = 0; i < 5; i++) layer('bandpass', 2500 + i * 700, 3, 0.18, 0.001, 0.03, i * 0.014);
        layer('lowpass', 500, 1, 0.3, 0.004, 0.06);
        break;
      case 'concrete':
      case 'asphalt':
        layer('bandpass', 900, 1.2, 0.35, 0.002, 0.05);
        layer('highpass', 4000, 1, 0.08, 0.001, 0.03, 0.01);
        break;
      case 'metal':
        layer('bandpass', 1800, 8, 0.4, 0.002, 0.12);
        break;
      case 'dirt':
        layer('lowpass', 700, 1, 0.45, 0.006, 0.08);
        break;
      default: // grass: soft swish + muffled thud
        layer('highpass', 2500, 0.6, 0.16, 0.02, 0.12);
        layer('lowpass', 380, 1, 0.3, 0.006, 0.07);
    }
  }

  /** arm cutting through the air (punches, swings) */
  whoosh() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = this.noise(t, 0.2);
    const f = this.filter('bandpass', 500, 1.4);
    f.frequency.setValueAtTime(350, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.09);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.18);
    const g = this.ctx.createGain();
    this.env(g, t, 0.22, 0.05, 0.12);
    n.connect(f).connect(g).connect(this.sfx);
  }

  ui(kind: 'pickup' | 'drop' | 'open' | 'close' | 'eat' | 'drink' | 'bandage' | 'move') {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const rustle = (dur: number, freq: number, vol: number, at = 0) => {
      const n = this.noise(t + at, dur);
      const f = this.filter('bandpass', freq, 0.8);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.linearRampToValueAtTime(vol, t + at + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      n.connect(f).connect(g).connect(this.sfx);
    };
    switch (kind) {
      case 'pickup':
        rustle(0.18, 2200, 0.25);
        rustle(0.1, 900, 0.2, 0.08);
        break;
      case 'drop':
        rustle(0.12, 600, 0.3);
        break;
      case 'open':
        for (let i = 0; i < 6; i++) rustle(0.05, 3500 + i * 150, 0.07, i * 0.035);
        break;
      case 'close':
        rustle(0.15, 1500, 0.15);
        break;
      case 'eat':
        for (let i = 0; i < 4; i++) rustle(0.08, 900, 0.25, i * 0.22);
        break;
      case 'drink':
        for (let i = 0; i < 4; i++) {
          const o = this.ctx.createOscillator();
          o.frequency.setValueAtTime(320, t + i * 0.25);
          o.frequency.exponentialRampToValueAtTime(180, t + i * 0.25 + 0.12);
          const g = this.ctx.createGain();
          this.env(g, t + i * 0.25, 0.12, 0.01, 0.12);
          o.connect(g).connect(this.sfx);
          o.start(t + i * 0.25);
          o.stop(t + i * 0.25 + 0.2);
        }
        break;
      case 'bandage':
        for (let i = 0; i < 5; i++) rustle(0.14, 1800, 0.15, i * 0.3);
        break;
      case 'move':
        rustle(0.07, 1200, 0.12);
        break;
    }
  }

  hurt() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.25);
    const f = this.filter('lowpass', 900, 1);
    const g = this.ctx.createGain();
    this.env(g, t, 0.18, 0.01, 0.25);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.35);
  }

  zombie(pos: V3, distance: number, aggressive: boolean) {
    if (!this.ready || distance > 60) return;
    const t = this.ctx.currentTime;
    const out = this.out(pos, 3, 1.2, distance);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const base = aggressive ? 140 : 95;
    o.frequency.setValueAtTime(base * (0.8 + Math.random() * 0.4), t);
    o.frequency.linearRampToValueAtTime(base * 0.6, t + 0.7);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 18 + Math.random() * 10;
    const lg = this.ctx.createGain();
    lg.gain.value = 25;
    lfo.connect(lg).connect(o.frequency);
    const f = this.filter('bandpass', aggressive ? 900 : 600, 2.5);
    const n = this.noise(t, 0.9);
    const nf = this.filter('bandpass', 1300, 1);
    const g = this.ctx.createGain();
    this.env(g, t, aggressive ? 0.5 : 0.25, 0.05, 0.8);
    o.connect(f).connect(g);
    n.connect(nf).connect(g);
    g.connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1);
    lfo.stop(t + 1);
  }

  // ------------------------------------------------------------ ambience

  private startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.filter('bandpass', 500, 0.5);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 260;
    lfo.connect(lg).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.045;
    const glfo = ctx.createOscillator();
    glfo.frequency.value = 0.11;
    const glg = ctx.createGain();
    glg.gain.value = 0.025;
    glfo.connect(glg).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    lfo.start();
    glfo.start();
    this.ambience.wind = g;
  }

  /** call each frame: occasional birdsong from random directions */
  updateAmbience(dt: number, listener: V3, indoors: boolean) {
    if (!this.ready) return;
    // only schedule a fade when going in or out, not every frame
    if (this.ambience.wind && indoors !== this.ambience.indoors) {
      this.ambience.indoors = indoors;
      this.ambience.wind.gain.cancelScheduledValues(this.ctx.currentTime);
      this.ambience.wind.gain.setTargetAtTime(indoors ? 0.018 : 0.045, this.ctx.currentTime, 0.6);
    }
    this.ambience.birdsT -= dt;
    if (this.ambience.birdsT > 0) return;
    this.ambience.birdsT = 2 + Math.random() * 6;
    const a = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 50;
    const pos = { x: listener.x + Math.cos(a) * r, y: listener.y + 8 + Math.random() * 10, z: listener.z + Math.sin(a) * r };
    const out = this.out(pos, 6, 1, r);
    const t0 = this.ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 5);
    const base = 2400 + Math.random() * 2400;
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.08);
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const f0 = base * (0.85 + Math.random() * 0.3);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.35 : 0.72), t + 0.07);
      const g = this.ctx.createGain();
      this.env(g, t, indoors ? 0.02 : 0.06, 0.008, 0.07);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.12);
    }
  }
}

export const audio = new AudioEngine();
