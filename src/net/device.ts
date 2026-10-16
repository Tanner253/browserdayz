// The device this game runs on, boiled down to one hash and sent with `hello` (PROTOCOL 44). Nothing is asked of the
// player and nothing is shown: how the graphics card draws a fixed test picture, how the browser draws a line of
// text, the screen, the time zone, the languages, the cores, the memory and the system. A swarm of programs run on
// one machine with made-up names and a rented address each (2026-10-16: Merric635, Brambl116 and the rest, every one
// "Chrome 155 on Windows, RTX 3060", through fifteen addresses in as many countries) is one device to the server,
// whatever it calls itself and wherever it comes from: server/device.ts keeps what each device has done. The owner:
// "can i ban this computr or browser at the source?"
//
// Nothing here changes while somebody plays: not the window's size, not the page's zoom (the pixel ratio is left
// out for that), and the screen's two sides are taken the same way up on a phone turned round. Two of the same
// machine set up the same way ARE one device here, so the server's rules never keep anybody off for the device
// alone: see server/device.ts.

let made: Promise<string> | null = null;

/** this device's hash: made once, the first time it is asked for (a few tens of ms), and the same after */
export function deviceId(): Promise<string> {
  return (made ??= make());
}

async function make(): Promise<string> {
  const parts: string[] = [];
  for (const part of [drawsWith, writes, says]) {
    try {
      parts.push(part());
    } catch {
      parts.push('none');
    }
  }
  return hash(parts.join('|'));
}

/** The card: what it says it is, its limits, and a small picture drawn with arithmetic that cards and drivers round differently. */
function drawsWith(): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const gl = (canvas.getContext('webgl2', { preserveDrawingBuffer: true }) ?? canvas.getContext('webgl', { preserveDrawingBuffer: true })) as WebGLRenderingContext | null;
  if (!gl) return 'gl:none';
  const out: string[] = [];
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  out.push(String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || ''), String((dbg && gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || ''));
  out.push(String(gl.getParameter(gl.VERSION)), String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)));
  for (const p of [gl.MAX_TEXTURE_SIZE, gl.MAX_RENDERBUFFER_SIZE, gl.MAX_VERTEX_UNIFORM_VECTORS, gl.MAX_FRAGMENT_UNIFORM_VECTORS, gl.MAX_VARYING_VECTORS, gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS, gl.MAX_VERTEX_ATTRIBS, gl.ALIASED_LINE_WIDTH_RANGE, gl.ALIASED_POINT_SIZE_RANGE, gl.MAX_VIEWPORT_DIMS]) out.push(String(gl.getParameter(p)));
  out.push((gl.getSupportedExtensions() ?? []).join(','));
  const shader = (kind: number, src: string) => {
    const s = gl.createShader(kind)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.0,1.0);}'));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;void main(){float a=sin(v.x*37.1)*cos(v.y*19.7);float b=fract(exp(v.x*3.0)*7.3+a);float c=pow(abs(v.y)+0.01,0.37);gl_FragColor=vec4(a*0.5+0.5,b,c,1.0);}'));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.9, -0.8, 0.95, -0.6, -0.1, 0.9]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, 48, 48);
  gl.clearColor(0.1, 0.2, 0.3, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(48 * 48 * 4);
  gl.readPixels(0, 0, 48, 48, gl.RGBA, gl.UNSIGNED_BYTE, px);
  out.push(fnv(px));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return out.join(';');
}

/** The browser's own drawing: text in two faces (which fonts there are, and how they are smoothed), a shadow, a blend and a gradient. */
function writes(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 260;
  canvas.height = 70;
  const c = canvas.getContext('2d');
  if (!c) return '2d:none';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#f2c';
  c.fillRect(120, 8, 60, 24);
  c.fillStyle = '#069';
  c.font = '15px "Times New Roman", serif';
  c.fillText('Zona, 0.01 SOL a tag \u{1F43A}\u{2620}', 4, 22);
  c.fillStyle = 'rgba(102, 204, 0, 0.7)';
  c.font = 'bold 18px Arial, sans-serif';
  c.shadowColor = '#000';
  c.shadowBlur = 4;
  c.fillText('Orlinoye \u{1F3F0} 1536 m', 6, 48);
  c.shadowBlur = 0;
  c.globalCompositeOperation = 'multiply';
  const g = c.createLinearGradient(0, 0, 260, 70);
  g.addColorStop(0, '#ffd35a');
  g.addColorStop(1, '#0d100c');
  c.fillStyle = g;
  c.beginPath();
  c.arc(200, 45, 22, 0.2, 5.6);
  c.closePath();
  c.fill();
  return canvas.toDataURL().slice(-400);
}

/** What the browser says of the machine: the screen (its sides the same way up), the time zone, the languages, cores, memory, system, touch. */
function says(): string {
  const n = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
  const w = screen.width || 0, h = screen.height || 0;
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    /* no zone said */
  }
  return [Math.min(w, h), Math.max(w, h), screen.colorDepth, zone, (n.languages ?? [n.language]).join(','), n.hardwareConcurrency ?? 0, n.deviceMemory ?? 0, n.userAgentData?.platform ?? n.platform, n.maxTouchPoints ?? 0, n.userAgent].join(';');
}

/** 32-bit FNV-1a over bytes, as hex */
function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** SHA-256 of the text, 20 hex characters; where the browser has no digest (an old one, an insecure page), two FNV hashes of it. */
async function hash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  try {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...d.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return fnv(bytes) + fnv(bytes.slice().reverse()) + fnv(bytes.subarray(bytes.length >> 1));
  }
}
