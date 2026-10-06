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
  private echoGain!: GainNode;
  /** small-room reverb: what a shot sounds like under a roof */
  private roomSend!: GainNode;
  /** everything that is "the outdoors": dulled and turned down when you step inside */
  private amb!: GainNode;
  private ambLP!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private ambience: { wind?: GainNode; leaves?: GainNode; insects?: GainNode; birdsT: number; crowT: number; indoors?: boolean; forest?: boolean } = { birdsT: 3, crowT: 20 };
  private volume = 1;
  private indoors = false;
  // the body: breathing when out of breath, heartbeat when badly hurt
  private breathT = 0;
  private breathIn = true;
  private heartT = 0;
  private stepSide = 1;
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
    this.master.gain.value = 0.8 * this.volume;
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
    const echoGain = (this.echoGain = ctx.createGain());
    echoGain.gain.value = 0.28;
    const echoLP = ctx.createBiquadFilter();
    echoLP.type = 'lowpass';
    echoLP.frequency.value = 900;
    this.echo.connect(echoLP).connect(echoGain).connect(this.reverbSend);
    echoGain.connect(this.master);

    // a room: short, bright, close reflections. Silent until you are under a roof.
    const room = ctx.createConvolver();
    const rl = Math.floor(ctx.sampleRate * 0.5);
    const rir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = rir.getChannelData(c);
      for (let i = 0; i < rl; i++) {
        const t = i / ctx.sampleRate;
        // a few hard early reflections off the walls, then a quick diffuse tail
        const early = i % Math.floor(ctx.sampleRate * (0.011 + c * 0.003)) === 0 && t < 0.09 ? 0.9 : 0;
        ch[i] = ((Math.random() * 2 - 1) * Math.exp(-t * 11) + early * Math.exp(-t * 20)) * (t < 0.004 ? t / 0.004 : 1);
      }
    }
    room.buffer = rir;
    this.roomSend = ctx.createGain();
    this.roomSend.gain.value = 0;
    this.roomSend.connect(room).connect(this.master);

    this.amb = ctx.createGain();
    this.ambLP = this.filter('lowpass', 18000, 0.5);
    this.amb.connect(this.ambLP).connect(this.master);

    this.startAmbience();
    this.ready = true;
  }

  /** player setting, 0..1 */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ready) this.master.gain.setTargetAtTime(0.8 * this.volume, this.ctx.currentTime, 0.05);
  }

  /**
   * Under a roof or out in the open. Indoors a shot is a hard, close slap with no valley
   * echo, and the wind and the birds are on the other side of a wall.
   */
  setEnvironment(indoors: boolean) {
    if (!this.ready || indoors === this.indoors) return;
    this.indoors = indoors;
    const t = this.ctx.currentTime;
    this.roomSend.gain.setTargetAtTime(indoors ? 0.55 : 0, t, 0.25);
    this.reverbSend.gain.setTargetAtTime(indoors ? 0.1 : 0.35, t, 0.25);
    this.echoGain.gain.setTargetAtTime(indoors ? 0.04 : 0.28, t, 0.25);
    this.ambLP.frequency.setTargetAtTime(indoors ? 900 : 18000, t, 0.4);
    this.amb.gain.setTargetAtTime(indoors ? 0.45 : 1, t, 0.4);
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
    const out = this.out(pos, big ? 12 : 8, 1, distance);
    const send = ctx.createGain();
    // the echo off the hills is taken before the sound is placed in space: it has to fall off
    // with distance by itself, or a shot across the valley rings as loud as your own
    const ref = big ? 12 : 8;
    const fall = pos ? Math.pow(ref / (ref + Math.max(0, distance - ref)), 0.75) : 1;
    send.gain.value = (big ? 0.9 : 0.6) * fall;
    out.connect(send);
    send.connect(this.reverbSend);
    send.connect(this.echo);
    send.connect(this.roomSend);

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

  /** the hammer falling on nothing: it has to be heard over a fight */
  dryFire() {
    this.click(3800, 1.3, 0.022);
    this.click(1900, 0.7, 0.03, 0.012);
  }

  /** short metallic click (bolt, mag, hammer) */
  click(freq = 3000, vol = 0.4, dur = 0.02, delay = 0, pos?: V3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    // somebody else's weapon: the same sound, from where they are
    const to = pos ? this.out(pos, 3, 1.2) : this.sfx;
    if (pos) vol *= 1.6;
    const n = this.noise(t, dur + 0.03);
    const f = this.filter('bandpass', freq * (0.9 + Math.random() * 0.2), 6);
    const g = this.ctx.createGain();
    this.env(g, t, vol, 0.0008, dur);
    n.connect(f).connect(g).connect(to);
    const ring = this.ctx.createOscillator();
    ring.type = 'triangle';
    ring.frequency.value = freq * 0.71;
    const rg = this.ctx.createGain();
    this.env(rg, t, vol * 0.15, 0.001, dur * 2.5);
    ring.connect(rg).connect(to);
    ring.start(t);
    ring.stop(t + dur * 3 + 0.05);
  }

  boltCycle(start = 0, pos?: V3) {
    this.click(2400, 0.45, 0.025, start, pos); // handle up
    this.click(1700, 0.5, 0.06, start + 0.18, pos); // pull back
    if (!pos) this.slide(start + 0.18, 0.14, 900);
    this.click(2000, 0.5, 0.05, start + 0.42, pos); // push forward
    if (!pos) this.slide(start + 0.36, 0.1, 1100);
    this.click(2800, 0.45, 0.025, start + 0.6, pos); // handle down
  }

  /** another player near you reloading: what of it carries */
  reloadNear(pos: V3, dur: number, pistol: boolean) {
    if (pistol) {
      this.click(1500, 0.4, 0.05, 0.1, pos);
      this.click(1900, 0.55, 0.04, Math.max(0.4, dur - 0.5), pos);
    } else {
      this.click(2400, 0.45, 0.025, 0, pos);
      this.click(1700, 0.5, 0.06, 0.15, pos);
      for (let t = 0.55; t < dur - 0.5; t += 0.48) this.click(3400, 0.3, 0.02, t, pos);
      this.click(2000, 0.5, 0.05, Math.max(0.3, dur - 0.45), pos);
      this.click(2800, 0.45, 0.025, Math.max(0.4, dur - 0.27), pos);
    }
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

  /**
   * A bullet going past your head: the crack of a supersonic round and the zip of air
   * behind it. `pos` is the nearest point of its path, `miss` how close it came (metres).
   */
  whiz(pos: V3, miss: number, delay = 0, supersonic = true) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const near = Math.max(0, 1 - miss / 5);
    const out = this.out(pos, 2, 1);
    if (supersonic) {
      const c = this.noise(t, 0.03);
      const hp = this.filter('highpass', 3200);
      const cg = this.ctx.createGain();
      this.env(cg, t, 0.5 + near * 0.9, 0.0006, 0.02);
      c.connect(hp).connect(cg).connect(out);
    }
    const n = this.noise(t, 0.2);
    const f = this.filter('bandpass', 4200, 5);
    f.frequency.setValueAtTime(4600, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    const g = this.ctx.createGain();
    this.env(g, t, 0.18 + near * 0.35, 0.004, 0.15);
    n.connect(f).connect(g).connect(out);
  }

  /** your shot landed on somebody (a dry tick), or killed them (a heavier double) */
  hitTick(kill: boolean, head = false) {
    if (!this.ready) return;
    if (!kill) {
      // a dry tick you can pick out under your own gunfire
      const t0 = this.ctx.currentTime;
      const tick = this.ctx.createOscillator();
      tick.type = 'triangle';
      tick.frequency.setValueAtTime(1750, t0);
      tick.frequency.exponentialRampToValueAtTime(1250, t0 + 0.035);
      const tg = this.ctx.createGain();
      tg.gain.setValueAtTime(0.85, t0);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      tick.connect(tg).connect(this.sfx);
      tick.start(t0);
      tick.stop(t0 + 0.09);
      this.click(2600, 0.5, 0.012);
      // a head shot rings: you know it before you see them drop
      if (head) {
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 2350;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g).connect(this.sfx);
        o.start(t);
        o.stop(t + 0.24);
      }
      return;
    }
    const t = this.ctx.currentTime;
    this.click(1300, 0.3, 0.02);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t + 0.03);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.2);
    const g = this.ctx.createGain();
    this.env(g, t + 0.03, 0.4, 0.004, 0.2);
    o.connect(g).connect(this.sfx);
    o.start(t + 0.03);
    o.stop(t + 0.3);
  }

  /** a weapon coming up into the hands: sling and cloth, then metal settling */
  equip(kind: 'gun' | 'melee' | 'hands') {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = this.noise(t, 0.22);
    const f = this.filter('bandpass', 1700, 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(f).connect(g).connect(this.sfx);
    if (kind === 'gun') {
      this.click(2300, 0.16, 0.02, 0.1);
      this.click(1500, 0.14, 0.03, 0.17);
    } else if (kind === 'melee') this.click(3800, 0.1, 0.03, 0.12);
  }

  /** kit shifting on the body with every step: louder the more you carry */
  private gear(t: number, vol: number) {
    const n = this.noise(t, 0.09);
    const f = this.filter('bandpass', 2600 + Math.random() * 1400, 1.2);
    const g = this.ctx.createGain();
    this.env(g, t, vol, 0.012, 0.06);
    n.connect(f).connect(g).connect(this.sfx);
  }

  /** pushing off the ground */
  jump() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.gear(t, 0.09);
    const n = this.noise(t, 0.16);
    const f = this.filter('bandpass', 1100, 1.5);
    const g = this.ctx.createGain();
    this.env(g, t, 0.07, 0.03, 0.1);
    n.connect(f).connect(g).connect(this.sfx);
  }

  /** coming down: the feet, the weight behind them, and the kit catching up */
  land(surface: Surface | 'grass' | 'dirt' | 'gravel', speed: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, speed / 11);
    this.footstep(surface, 3 + k * 5);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = this.ctx.createGain();
    this.env(g, t, 0.15 + k * 0.55, 0.003, 0.14);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.25);
    this.gear(t + 0.03, 0.06 + k * 0.12);
  }

  /** the last breath going out, and the body hitting the ground */
  death() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = this.noise(t, 1.1);
    const f = this.filter('bandpass', 620, 1.6);
    f.frequency.setValueAtTime(760, t);
    f.frequency.exponentialRampToValueAtTime(330, t + 1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    n.connect(f).connect(g).connect(this.sfx);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(95, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.62);
    const og = this.ctx.createGain();
    this.env(og, t + 0.45, 0.6, 0.004, 0.2);
    o.connect(og).connect(this.sfx);
    o.start(t + 0.45);
    o.stop(t + 0.8);
  }

  /**
   * Call every frame. Out of breath: you hear yourself breathing, faster and louder the
   * emptier the lungs. Badly hurt: your own pulse.
   */
  body(dt: number, stamina: number, health: number, alive: boolean, bleeding = false) {
    if (!this.ready || !alive) return;
    const ctx = this.ctx;
    const tired = Math.max(0, Math.min(1, (48 - stamina) / 48));
    if (tired > 0.04) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        const inhale = this.breathIn;
        this.breathIn = !inhale;
        const cycle = 1.7 - tired * 0.95;
        this.breathT = cycle * (inhale ? 0.45 : 0.55);
        const t = ctx.currentTime;
        const dur = this.breathT * 0.82;
        const n = this.noise(t, dur);
        const f = this.filter('bandpass', inhale ? 2100 : 1050, inhale ? 1.1 : 0.8);
        const g = ctx.createGain();
        const peak = (0.035 + tired * 0.11) * (inhale ? 0.8 : 1);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + dur * (inhale ? 0.55 : 0.2));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        n.connect(f).connect(g).connect(this.sfx);
      }
    } else {
      this.breathT = 0;
      this.breathIn = true;
    }
    // an open wound: the pulse is there from the start, quiet, and grows as the health goes
    const hurt = Math.max(bleeding ? 0.22 : 0, Math.min(1, (36 - health) / 36));
    if (hurt > 0) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1.0 - hurt * 0.38;
        const t = ctx.currentTime;
        for (const [at, f0, v] of [[0, 62, 1], [0.17, 50, 0.7]] as const) {
          const o = ctx.createOscillator();
          o.frequency.setValueAtTime(f0, t + at);
          o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + at + 0.1);
          const g = ctx.createGain();
          this.env(g, t + at, (0.2 + hurt * 0.4) * v, 0.006, 0.11);
          o.connect(g).connect(this.sfx);
          o.start(t + at);
          o.stop(t + at + 0.2);
        }
      }
    }
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
      g.gain.linearRampToValueAtTime(0.22, t + 0.18);
      g.gain.linearRampToValueAtTime(0.12, t + 0.5);
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
    this.env(g, t, peak * 2.4, 0.001, dec);
    n.connect(f).connect(g).connect(out);
  }

  /** @param carried weight on the player's back (own steps only): the kit shifts with each one */
  footstep(surface: Surface | 'grass' | 'dirt' | 'gravel', speed: number, pos?: V3, carried = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const vol = Math.min(1, 0.15 + speed * 0.07) * (pos ? 5.5 : 3.2);
    let out = this.out(pos, 4, 1.1);
    if (!pos) {
      // your own feet: one a little to the left, the next a little to the right
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = 0.14 * (this.stepSide = -this.stepSide);
      pan.connect(this.sfx);
      out = pan;
      if (speed > 2.4) this.gear(t + 0.02, Math.min(0.1, 0.012 + carried * 0.004 + speed * 0.004));
    }
    const layer = (type: BiquadFilterType, freq: number, q: number, v: number, a: number, d: number, at = 0) => {
      const n = this.noise(t + at, a + d + 0.02);
      const f = this.filter(type, freq * (0.85 + Math.random() * 0.3), q);
      const g = this.ctx.createGain();
      this.env(g, t + at, v * vol, a, d);
      n.connect(f).connect(g).connect(out);
    };
    switch (surface) {
      case 'wood':
        layer('bandpass', 320, 1.2, 1.7, 0.003, 0.07);
        layer('bandpass', 1400, 3, 0.4, 0.002, 0.05, 0.01);
        break;
      case 'gravel':
      case 'rock':
        for (let i = 0; i < 5; i++) layer('bandpass', 2500 + i * 700, 3, 0.18, 0.001, 0.03, i * 0.014);
        layer('lowpass', 500, 1, 0.3, 0.004, 0.06);
        break;
      case 'concrete':
      case 'asphalt':
        layer('bandpass', 900, 1.2, 0.8, 0.002, 0.05);
        layer('highpass', 4000, 1, 0.16, 0.001, 0.03, 0.01);
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

  /**
   * Arm cutting through the air (punches, swings).
   * @param weight 0 = a fist, 1 = a bat or a crowbar: lower, longer and louder
   * @param pos somebody else's swing, heard from where they stand
   */
  whoosh(weight = 0, pos?: V3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const len = 0.18 + weight * 0.1;
    const n = this.noise(t, len + 0.04);
    const f = this.filter('bandpass', 500, 1.4);
    const top = 1500 - weight * 550;
    f.frequency.setValueAtTime(350 - weight * 110, t);
    f.frequency.exponentialRampToValueAtTime(top, t + len * 0.5);
    f.frequency.exponentialRampToValueAtTime(top / 3, t + len);
    const g = this.ctx.createGain();
    this.env(g, t, 0.36 + weight * 0.22, len * 0.3, len * 0.7);
    n.connect(f).connect(g).connect(pos ? this.out(pos, 2, 1.5) : this.sfx);
  }

  /**
   * A grenade going off. Close, it is a crack and a blow to the chest; far off, a dull thump
   * and the hills answering.
   */
  explosion(pos: V3, distance: number) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + distance / 343;
    const out = this.out(pos, 14, 1, distance);
    const fall = Math.pow(14 / (14 + Math.max(0, distance - 14)), 0.75);
    const send = ctx.createGain();
    send.gain.value = 1.1 * fall;
    out.connect(send);
    send.connect(this.reverbSend);
    send.connect(this.echo);
    send.connect(this.roomSend);
    const crack = this.noise(t, 0.08);
    const ch = this.filter('highpass', 1800);
    const cg = ctx.createGain();
    this.env(cg, t, 2.2, 0.001, 0.06);
    crack.connect(ch).connect(cg).connect(out);
    const body = this.noise(t, 1.4);
    const bl = this.filter('lowpass', 2600, 0.8);
    bl.frequency.setValueAtTime(2600, t);
    bl.frequency.exponentialRampToValueAtTime(120, t + 0.9);
    const bg = ctx.createGain();
    this.env(bg, t, 3, 0.004, 1.2);
    body.connect(bl).connect(bg).connect(out);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(78, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.7);
    const og = ctx.createGain();
    this.env(og, t, 2.6, 0.003, 0.9);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 1.2);
  }

  ui(kind: 'pickup' | 'drop' | 'open' | 'close' | 'eat' | 'drink' | 'bandage' | 'move' | 'smoke') {
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
      case 'smoke':
        // the lighter, a long draw in, a longer breath out
        this.click(3600, 0.3, 0.02);
        rustle(0.5, 2400, 0.07, 0.2);
        rustle(0.75, 900, 0.1, 0.85);
        break;
    }
  }

  /**
   * Being hit: the blow landing, and the grunt it knocks out of you.
   * @param pos somebody else being hit: their grunt, from where they are, when the sound gets here
   */
  hurt(pos?: V3, distance = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    if (pos) {
      const t = ctx.currentTime + distance / 343;
      const out = this.out(pos, 3, 1.3, distance);
      const pitch = 100 + Math.random() * 40;
      const v = ctx.createOscillator();
      v.type = 'sawtooth';
      v.frequency.setValueAtTime(pitch * 1.25, t);
      v.frequency.exponentialRampToValueAtTime(pitch * 0.8, t + 0.24);
      const f1 = this.filter('bandpass', 620, 5);
      const f2 = this.filter('bandpass', 1150, 6);
      const vg = ctx.createGain();
      this.env(vg, t, 1.0, 0.015, 0.22);
      v.connect(f1).connect(vg);
      v.connect(f2).connect(vg);
      vg.connect(out);
      v.start(t);
      v.stop(t + 0.32);
      return;
    }
    const t = ctx.currentTime;
    // the blow
    const th = ctx.createOscillator();
    th.frequency.setValueAtTime(120, t);
    th.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    const tg = ctx.createGain();
    this.env(tg, t, 0.5, 0.002, 0.1);
    th.connect(tg).connect(this.sfx);
    th.start(t);
    th.stop(t + 0.2);
    // the grunt: a voiced buzz shaped by two formants, falling in pitch, with breath on top
    const pitch = 105 + Math.random() * 30;
    const v = ctx.createOscillator();
    v.type = 'sawtooth';
    v.frequency.setValueAtTime(pitch * 1.25, t + 0.02);
    v.frequency.exponentialRampToValueAtTime(pitch * 0.8, t + 0.26);
    const f1 = this.filter('bandpass', 620, 5);
    const f2 = this.filter('bandpass', 1150, 6);
    const vg = ctx.createGain();
    this.env(vg, t + 0.02, 0.5, 0.015, 0.22);
    v.connect(f1).connect(vg);
    v.connect(f2).connect(vg);
    vg.connect(this.sfx);
    v.start(t + 0.02);
    v.stop(t + 0.32);
    const n = this.noise(t + 0.02, 0.24);
    const nf = this.filter('bandpass', 1500, 1);
    const ng = ctx.createGain();
    this.env(ng, t + 0.02, 0.09, 0.02, 0.2);
    n.connect(nf).connect(ng).connect(this.sfx);
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
    src.connect(f).connect(g).connect(this.amb);
    src.start();
    lfo.start();
    glfo.start();
    this.ambience.wind = g;

    // leaves: a brighter hiss that comes and goes with the gusts, loud only among trees
    const lsrc = ctx.createBufferSource();
    lsrc.buffer = this.noiseBuf;
    lsrc.loop = true;
    lsrc.playbackRate.value = 0.7;
    const lf = this.filter('bandpass', 3400, 0.6);
    const gust = ctx.createGain();
    gust.gain.value = 0.55;
    const gl = ctx.createOscillator();
    gl.frequency.value = 0.083;
    const glg2 = ctx.createGain();
    glg2.gain.value = 0.45;
    gl.connect(glg2).connect(gust.gain);
    const leaves = ctx.createGain();
    leaves.gain.value = 0.006;
    lsrc.connect(lf).connect(gust).connect(leaves).connect(this.amb);
    lsrc.start();
    gl.start();
    this.ambience.leaves = leaves;

    // insects: a thin, pulsing trill that sits under everything out in the grass
    const ins = ctx.createOscillator();
    ins.type = 'sine';
    ins.frequency.value = 5400;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const tl = ctx.createOscillator();
    tl.type = 'square';
    tl.frequency.value = 31;
    const tlg = ctx.createGain();
    tlg.gain.value = 0.5;
    tl.connect(tlg).connect(trem.gain);
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    const sl = ctx.createOscillator();
    sl.frequency.value = 0.19;
    const slg = ctx.createGain();
    slg.gain.value = 0.5;
    sl.connect(slg).connect(swell.gain);
    const insects = ctx.createGain();
    insects.gain.value = 0.0045;
    ins.connect(trem).connect(swell).connect(insects).connect(this.amb);
    ins.start();
    tl.start();
    sl.start();
    this.ambience.insects = insects;
  }

  /** a crow somewhere off in the trees */
  private crow(listener: V3) {
    const a = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 90;
    const pos = { x: listener.x + Math.cos(a) * r, y: listener.y + 14 + Math.random() * 12, z: listener.z + Math.sin(a) * r };
    const out = this.out(pos, 14, 1, r);
    const tail = this.ctx.createGain();
    tail.gain.value = 0.5;
    out.connect(tail).connect(this.reverbSend);
    const t0 = this.ctx.currentTime;
    const caws = 2 + Math.floor(Math.random() * 3);
    const pitch = 400 + Math.random() * 90;
    for (let i = 0; i < caws; i++) {
      const t = t0 + i * (0.33 + Math.random() * 0.08);
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(pitch * 1.12, t);
      o.frequency.linearRampToValueAtTime(pitch * 0.86, t + 0.2);
      const rasp = this.ctx.createOscillator();
      rasp.frequency.value = 58;
      const rg = this.ctx.createGain();
      rg.gain.value = pitch * 0.22;
      rasp.connect(rg).connect(o.frequency);
      const f = this.filter('bandpass', 1500, 2.2);
      const g = this.ctx.createGain();
      this.env(g, t, 0.34, 0.02, 0.2);
      o.connect(f).connect(g).connect(out);
      o.start(t);
      rasp.start(t);
      o.stop(t + 0.3);
      rasp.stop(t + 0.3);
    }
  }

  /**
   * Call each frame: occasional birdsong and crows from random directions.
   * @param forest among trees (leaves in the wind) rather than out in the open (insects in the grass)
   */
  updateAmbience(dt: number, listener: V3, indoors: boolean, forest = false) {
    if (!this.ready) return;
    this.setEnvironment(indoors);
    // only schedule a fade when the surroundings change, not every frame
    if (forest !== this.ambience.forest) {
      this.ambience.forest = forest;
      const t = this.ctx.currentTime;
      this.ambience.leaves?.gain.setTargetAtTime(forest ? 0.03 : 0.006, t, 2.5);
      this.ambience.insects?.gain.setTargetAtTime(forest ? 0.0015 : 0.0045, t, 2.5);
    }
    this.ambience.crowT -= dt;
    if (this.ambience.crowT <= 0) {
      this.ambience.crowT = 28 + Math.random() * 55;
      if (!indoors) this.crow(listener);
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
