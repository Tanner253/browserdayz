// Frame profiler + F3 overlay. Separates where time goes so a hitch can be blamed on
// the right thing: game logic (CPU), render submission (CPU), the GPU (timer queries),
// garbage collection (heap drops), shader compilation (new programs), or the browser /
// OS not giving us a frame at all (long interval with little work on our side).

import type * as THREE from 'three';

const N = 240;

interface Hitch {
  at: number;
  ms: number;
  cause: string;
}

export class Perf {
  interval = new Float32Array(N);
  logic = new Float32Array(N);
  submit = new Float32Array(N);
  gpu = new Float32Array(N);
  private i = 0;
  private last = 0;
  private t0 = 0;
  private t1 = 0;
  private gl: WebGL2RenderingContext;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: { q: WebGLQuery; slot: number }[] = [];
  private active: WebGLQuery | null = null;
  private heap = 0;
  private programs = 0;
  lastGpuMs = 0;
  hitches: Hitch[] = [];
  /** estimated display refresh interval (ms) */
  vsync = 16.7;
  visible = false;
  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private text: HTMLPreElement;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as never;
    this.el = document.createElement('div');
    this.el.className = 'perf';
    this.canvas = document.createElement('canvas');
    this.canvas.width = N * 2;
    this.canvas.height = 110;
    this.text = document.createElement('pre');
    this.el.append(this.canvas, this.text);
    document.getElementById('ui')!.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.visible = !this.visible;
        this.el.classList.toggle('show', this.visible);
      }
    });
  }

  get hasGpuTimer() {
    return !!this.ext;
  }

  /** call at the very start of the frame */
  begin(now: number) {
    if (this.last) this.interval[this.i] = now - this.last;
    this.last = now;
    this.t0 = performance.now();
  }

  /** call right before render() */
  beforeRender() {
    this.t1 = performance.now();
    this.logic[this.i] = this.t1 - this.t0;
    if (this.ext && !this.active) {
      const q = this.gl.createQuery();
      if (q) {
        this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
        this.active = q;
      }
    }
  }

  /** call right after render() */
  afterRender() {
    this.submit[this.i] = performance.now() - this.t1;
    if (this.ext && this.active) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.queries.push({ q: this.active, slot: this.i });
      this.active = null;
    }
    this.pollQueries();
    this.detectHitch();
    this.i = (this.i + 1) % N;
    if (this.visible && this.i % 4 === 0) this.draw();
  }

  private pollQueries() {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.queries.length) {
      const { q, slot } = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) {
        this.gpu[slot] = ns / 1e6;
        this.lastGpuMs = ns / 1e6;
      }
      gl.deleteQuery(q);
      this.queries.shift();
    }
    // never let a backlog build up if the driver stops answering
    while (this.queries.length > 8) gl.deleteQuery(this.queries.shift()!.q);
  }

  private median(a: Float32Array) {
    return [...a].filter((v) => v > 0).sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
  }

  private detectHitch() {
    const iv = this.interval[this.i];
    // refresh interval = the fastest frames we see consistently
    if (this.i % 60 === 0) {
      const sorted = [...this.interval].filter((v) => v > 2).sort((a, b) => a - b);
      if (sorted.length > 30) this.vsync = Math.max(4, Math.min(34, sorted[Math.floor(sorted.length * 0.1)]));
    }
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const heap = mem ? mem.usedJSHeapSize : 0;
    const progs = (this.renderer.info.programs?.length ?? 0) as number;
    if (iv > Math.max(this.vsync * 2.2, 25)) {
      const causes: string[] = [];
      if (progs > this.programs) causes.push(`shader compile (+${progs - this.programs})`);
      if (heap && heap < this.heap - 4e6) causes.push(`GC (−${((this.heap - heap) / 1e6).toFixed(0)} MB)`);
      const prev = (this.i + N - 1) % N;
      const work = this.logic[prev] + this.submit[prev];
      const g = this.gpu[prev];
      if (g > this.vsync * 1.5) causes.push(`GPU ${g.toFixed(1)} ms`);
      if (work > this.vsync * 1.2) causes.push(`CPU ${work.toFixed(1)} ms`);
      if (!causes.length) causes.push('browser/OS stall (our work was ' + work.toFixed(1) + ' ms)');
      this.hitches.unshift({ at: performance.now(), ms: iv, cause: causes.join(', ') });
      this.hitches.length = Math.min(this.hitches.length, 8);
    }
    this.heap = heap;
    this.programs = progs;
  }

  summary() {
    return {
      interval: this.median(this.interval),
      logic: this.median(this.logic),
      submit: this.median(this.submit),
      gpu: this.median(this.gpu),
      vsync: this.vsync,
    };
  }

  private draw() {
    const c = this.canvas.getContext('2d')!;
    const H = this.canvas.height;
    c.clearRect(0, 0, this.canvas.width, H);
    const scale = H / 50; // 50 ms full height
    // budget lines
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    for (const ms of [this.vsync, 33.3]) {
      c.beginPath();
      c.moveTo(0, H - ms * scale);
      c.lineTo(this.canvas.width, H - ms * scale);
      c.stroke();
    }
    for (let k = 0; k < N; k++) {
      const j = (this.i + k) % N;
      const x = k * 2;
      const iv = this.interval[j];
      c.fillStyle = iv > this.vsync * 2.2 ? '#e0654f' : iv > this.vsync * 1.3 ? '#d8b25c' : '#7fa36a';
      c.fillRect(x, H - Math.min(H, iv * scale), 2, Math.min(H, iv * scale));
      // CPU share overlaid in light, GPU as a dot
      const cpu = this.logic[j] + this.submit[j];
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(x, H - Math.min(H, cpu * scale), 2, Math.min(H, cpu * scale));
      if (this.gpu[j] > 0) {
        c.fillStyle = '#7ab8ff';
        c.fillRect(x, H - Math.min(H, this.gpu[j] * scale) - 1, 2, 2);
      }
    }
    const s = this.summary();
    const info = this.renderer.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const lines = [
      `frame ${s.interval.toFixed(1)} ms  (${(1000 / Math.max(s.interval, 1)).toFixed(0)} fps, display ~${(1000 / s.vsync).toFixed(0)} Hz)`,
      `cpu   logic ${s.logic.toFixed(2)} ms  render-submit ${s.submit.toFixed(2)} ms`,
      `gpu   ${this.ext ? s.gpu.toFixed(2) + ' ms' : 'n/a (timer queries not exposed by this browser)'}`,
      `draws ${info.render.calls}  tris ${(info.render.triangles / 1e6).toFixed(2)}M  programs ${info.programs?.length ?? 0}  heap ${mem ? (mem.usedJSHeapSize / 1e6).toFixed(0) + ' MB' : 'n/a'}`,
      `hitches (frames > ${(this.vsync * 2.2).toFixed(0)} ms):`,
      ...this.hitches.map((h) => `  ${((performance.now() - h.at) / 1000).toFixed(0).padStart(3)}s ago  ${h.ms.toFixed(0).padStart(4)} ms  ${h.cause}`),
    ];
    this.text.textContent = lines.join('\n');
  }
}
