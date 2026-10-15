// The fifteenth film: "Emotes" (2026-10-15). The owner: "make a trailer showing some of the emotes leading with balon
// the one i like, dance music, hype, dont have to render in the world can do it in a virtual space to speed up
// rendering". So: a stage of its own, high over the map and closed round so that none of the world is drawn into the
// picture, its lights going with the beat; the cast dancing the pack's movements (src/sim/emotes.ts) by the game's
// own way of showing another player's dance (the pose flags, EMOTE_SHIFT); a bar of the score to each shot.
//
// Its figures: 28 new movements (the pack's, counted in test/emotes.test.ts). Nothing else is counted.

import * as THREE from 'three';
import type { CamPose, Shot, Stage } from './director';
import { BAR15, BEAT15, scoreMusic15, type Part15 } from './music15';
import { EMOTE, EMOTE_SHIFT } from '../sim/emotes';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const BARS: Part15[] = [];
let total = 0;
export const seconds15 = () => total;
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic15(ctx, out, BARS);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** where the stage is: over the middle of the map, higher than anything on it */
const STAGE = V(0, 520, 0);
/** what each of the cast wears, so that no two look alike */
const GEAR: string[][] = [['boonie_hat', 'life_vest'], ['gasmask', 'sack_pack'], ['life_vest'], ['boonie_hat'], ['sack_pack'], ['gasmask'], []];

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  const scene: THREE.Scene = g.s.r.scene;
  const overlay = document.getElementById('tr-overlay')!;
  document.body.classList.add('tr-cut15');

  // ------------------------------------------------------------ the stage
  const set = new THREE.Group();
  set.position.copy(STAGE);
  scene.add(set);
  // round it, so that nothing of the world is seen: dark, a glow low down, bands of light that run with the beat
  const cyc = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: true,
    uniforms: { uTime: { value: 0 }, uPulse: { value: 0 }, uHue: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vP;
      uniform float uTime, uPulse, uHue;
      vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      void main() {
        vec3 d = normalize(vP);
        float low = smoothstep(0.35, -0.05, d.y);
        float a = atan(d.z, d.x);
        float bands = pow(0.5 + 0.5 * sin(a * 9.0 + uTime * 1.6), 18.0) * smoothstep(-0.05, 0.25, d.y) * smoothstep(0.75, 0.2, d.y);
        vec3 c = mix(vec3(0.010, 0.006, 0.020), hue(uHue) * 0.20, low);
        c += hue(uHue + 0.33) * bands * (0.25 + 0.9 * uPulse);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  set.add(new THREE.Mesh(new THREE.SphereGeometry(34, 48, 24), cyc));
  // the floor: black glass, a ring of light round its middle, and a grid of lights in it
  const floor = new THREE.Mesh(new THREE.CircleGeometry(34, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x07070b, roughness: 0.16, metalness: 0.55, fog: false }));
  floor.receiveShadow = true;
  set.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.4, 4.6, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2fa8, fog: false, toneMapped: false }));
  ring.position.y = 0.01;
  set.add(ring);
  const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.07, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }), 400);
  {
    const m = new THREE.Matrix4(), c = new THREE.Color();
    let n = 0;
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) {
      if (Math.hypot(x, z) > 10 || Math.hypot(x, z) < 5 || n >= 400) continue;
      m.makeTranslation(x * 1.2, 0.012, z * 1.2);
      dots.setMatrixAt(n, m);
      dots.setColorAt(n, c.setHSL(((x + z) * 0.03 + 0.85) % 1, 1, 0.55));
      n++;
    }
    dots.count = n;
  }
  set.add(dots);
  // the lights: four coloured from over the stage, sweeping, and one white on whoever is in the middle
  const lamps: { l: THREE.SpotLight; base: number; at: number }[] = [];
  [[0xff2fa8, 0], [0x2fd8ff, 1.57], [0xffd35a, 3.14], [0x8a4bff, 4.71]].forEach(([color, at]) => {
    const l = new THREE.SpotLight(color, 0, 30, 0.42, 0.6, 0);
    l.position.set(Math.cos(at) * 6, 9, Math.sin(at) * 6);
    set.add(l, l.target);
    lamps.push({ l, base: 14, at });
  });
  const key = new THREE.SpotLight(0xfff4e8, 13, 30, 0.38, 0.7, 0);
  key.position.set(0, 9, 6);
  set.add(key, key.target);
  // (and a wash from all round, purple over and dark under, so that the bodies are not black between the beams)
  set.add(new THREE.HemisphereLight(0x9a7cff, 0x120818, 0.75));

  // ------------------------------------------------------------ the words over it
  const gfx: HTMLElement[] = [];
  const Gx = (cls: string, html: string) => {
    const el = document.createElement('div');
    el.className = `tr-gfx ${cls}`;
    el.innerHTML = html;
    el.style.display = 'none';
    overlay.appendChild(el);
    gfx.push(el);
    return el;
  };
  const title = Gx('x15-title', '<div class="t15-kick">ZONA &nbsp;·&nbsp; NEW</div><div class="t15-big">EMOTES</div>');
  const moves = Gx('x15-title', '<div class="t15-big">28 NEW MOVES</div><div class="t15-kick">ON YOUR OWN SURVIVOR</div>');
  const wheel = Gx('x15-title x15-low', '<div class="t15-big">SET YOUR OWN WHEEL</div><div class="t15-kick">MENU &nbsp;→&nbsp; EMOTES &nbsp;·&nbsp; HOLD T IN GAME</div>');
  const name = Gx('x15-name', '<span></span>');
  const end = Gx('x15-end', '<img src="/brand/zona-mark-plain.svg" alt=""><div class="t15-logo">ZONA</div><div class="t15-url">ZONAPVP.FUN &nbsp;·&nbsp; PLAY FREE</div>');
  const flash = Gx('x15-flash', '');
  /** shown between two moments of a shot, faded in and out at its ends */
  const showFor = (el: HTMLElement, t: number, from: number, to: number) => {
    const on = t >= from && t <= to;
    el.style.display = on ? '' : 'none';
    if (!on) return;
    const k = Math.min(ease((t - from) / 0.25), 1 - ease((t - (to - 0.3)) / 0.3));
    el.style.opacity = k.toFixed(3);
    el.style.transform = `translate(-50%, -50%) scale(${(1.08 - 0.08 * ease((t - from) / 0.4)).toFixed(3)})`;
  };
  const label = (text: string, t: number, len: number) => {
    (name.firstElementChild as HTMLElement).textContent = text;
    name.style.display = '';
    name.style.opacity = Math.min(ease(t / 0.15), 1 - ease((t - (len - 0.15)) / 0.15)).toFixed(3);
  };

  // ------------------------------------------------------------ the cast
  const A = (i: number) => S.actors[i];
  /** one of the cast stood on the stage (x, z from its middle), dancing one of the pack's movements */
  const dancer = (i: number, x: number, z: number, yaw: number, emote: string) => {
    const a = A(i);
    a.place(STAGE.x + x, STAGE.z + z, yaw, null, GEAR[i % GEAR.length]);
    a.pos.y = STAGE.y;
    a.dance = true;
    a.more = (EMOTE[emote]?.n ?? 0) << EMOTE_SHIFT;
    // (put there at once: told of it as a move, the body came up from the ground under the stage over seconds)
    (a.rp as Any).snaps.length = 0;
    a.rp.pos.copy(a.pos);
    a.push(-200);
    a.push(0);
  };
  const offStage = () => {
    for (const a of S.actors) a.hide();
  };
  /** frames nobody sees or hears: for the pack to come and the bodies to take it up */
  const run = async (frames: number) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      for (const a of S.actors) if (a.pos.y > STAGE.y - 5) a.push();
      clock.advance(1000 / 60);
      if (i % 20 === 19) await wait(8);
    }
    S.mute = false;
  };

  // ------------------------------------------------------------ the beat
  let start = 0;
  /** the film's own time, in beats: where in the beat (0..1) and a pulse that jumps on each and dies away */
  const beat = (T: number) => {
    const b = T / BEAT15, k = b - Math.floor(b);
    return { b, k, pulse: Math.exp(-k * 5) };
  };
  const light = (T: number, part: Part15) => {
    const { b, pulse } = beat(T);
    const hot = part === 'drop' || part === 'final' ? 1 : part === 'intro' ? 0.35 : 0.65;
    cyc.uniforms.uTime.value = T;
    cyc.uniforms.uPulse.value = pulse * hot;
    cyc.uniforms.uHue.value = 0.85 + Math.floor(b / 4) * 0.13;
    for (const [k, m] of lamps.entries()) {
      const sweep = T * (part === 'intro' ? 0.4 : 1.1) + m.at;
      m.l.target.position.set(Math.cos(sweep) * 2.2, 0, Math.sin(sweep * 1.3) * 2.2);
      m.l.intensity = m.base * (0.25 + 0.75 * hot) * (0.55 + 0.9 * (Math.floor(b) % 4 === k ? pulse : pulse * 0.4));
    }
    (ring.material as THREE.MeshBasicMaterial).color.setHSL((0.9 + Math.floor(b / 4) * 0.13) % 1, 1, 0.45 + 0.4 * pulse * hot);
    dots.visible = part !== 'intro' || b > 8;
  };

  // ------------------------------------------------------------ the shots
  const shots: Shot[] = [];
  let cur = 0;
  const add = (bars: number, part: Part15, s: Omit<Shot, 'start' | 'end' | 'cam'> & { cam: (t: number) => CamPose; words?: (t: number) => void }) => {
    const len = bars * BAR15, from = cur;
    // (a bar of the score for each whole bar of film passed: two half-bar shots make one)
    for (let b = Math.floor(from / BAR15 + 1e-6); b < Math.floor((from + len) / BAR15 + 1e-6); b++) BARS.push(part);
    cur += len;
    const setup = s.setup, words = s.words;
    shots.push({
      bars: true,
      ...s,
      start: from,
      end: from + len,
      setup: async (st) => {
        for (const el of gfx) el.style.display = 'none';
        g.hourHeld = 0.02;
        start = from;
        await setup?.(st);
      },
      cam: (t) => s.cam(t),
      after: (t, st) => {
        light(start + t, part);
        for (const a of S.actors) if (a.pos.y > STAGE.y - 5) a.push();
        for (const el of gfx) if (el !== flash) el.style.display = 'none';
        words?.(t);
        // a white blow on the first beat of a drop
        const into = start + t - from;
        flash.style.display = '';
        flash.style.opacity = (part === 'drop' || part === 'final') && (BARS[Math.round(from / BAR15) - 1] !== part) ? Math.max(0, 1 - into / 0.18).toFixed(3) : '0';
        s.after?.(t, st);
      },
    });
  };
  const at = (x: number, y: number, z: number) => STAGE.clone().add(V(x, y, z));
  /** round a point on the stage, so far out and so high, at so many radians */
  const orbit = (mid: THREE.Vector3, r: number, h: number, a: number, fov = 40, look = 1.05): CamPose => ({ p: mid.clone().add(V(Math.sin(a) * r, h, Math.cos(a) * r)), l: mid.clone().add(V(0, look, 0)), fov });
  const C = at(0, 0, 0);

  // 1. Balloon, alone in the light: the owner's own favourite opens it
  add(4, 'intro', {
    name: 'balloon',
    setup: async () => {
      offStage();
      dancer(0, 0, 0, Math.PI, 'balloon');
      await run(150);
    },
    cam: (t) => orbit(C, 7.2 - 3.4 * ease(t / 7.5), 1.0 + 0.5 * ease(t / 7.5), -0.9 + 0.75 * ease(t / 7.5), 38),
    words: (t) => {
      showFor(title, t, 1.0, 4.6);
      if (t > 5.0) label('BALLOON', t - 5.0, 2.5);
    },
  });
  // 2. three of them, as the music climbs
  add(2, 'rise', {
    name: 'three',
    setup: async () => {
      offStage();
      dancer(0, 0, 0, Math.PI, 'balloon');
      dancer(1, -1.7, -0.6, Math.PI, 'balloon');
      dancer(2, 1.7, -0.6, Math.PI, 'balloon');
      await run(40);
    },
    cam: (t) => ({ ...orbit(C, 8 - 3.5 * ease(t / 3.75), 1.4 - 0.5 * ease(t / 3.75), 0, 34), roll: 0.03 * Math.sin(t * 3) }),
    words: (t) => showFor(moves, t, 0.4, 3.6),
  });
  // 3. the drop: a bar to each, a body and a lens of its own
  const DROP: [string, string, number, number][] = [
    ['bhangra', 'BHANGRA', 3, 0.5],
    ['mj', 'MJ DANCE', 4, -0.6],
    ['piratejig', 'PIRATE JIG', 5, 0.9],
    ['shuffle', 'SHUFFLE', 1, -0.3],
    ['jaguar', 'JAGUAR', 2, 0.2],
    ['legguitar', 'LEG GUITAR', 6, -0.9],
    ['egypt', 'EGYPT', 3, 0.7],
    ['boybandak', 'BOYBAND AK', 4, -0.4],
  ];
  DROP.forEach(([id, words, who, a], k) => {
    add(1, 'drop', {
      name: id,
      setup: async () => {
        offStage();
        dancer(who, 0, 0, Math.PI, id);
        await run(20);
      },
      // (each lens pushes in or slides across through its bar, low and wide, or close)
      cam: (t) => {
        const u = ease(t / BAR15);
        return k % 2 ? orbit(C, 3.6 - 0.6 * u, 0.5, a + 0.35 * u, 46, 1.0) : orbit(C, 4.4 - 1.2 * u, 1.3 - 0.4 * u, a - 0.2 * u, 36, 1.1);
      },
      words: (t) => label(words, t, BAR15),
    });
  });
  // 4. the break: four of the gestures, half a bar each
  const GEST: [string, string, number][] = [['dab', 'DAB', 5], ['clap', 'CLAP', 2], ['lol', 'LOL', 0], ['kickmoon', 'KICK THE MOON', 6]];
  for (const [id, words, who] of GEST) {
    add(0.5, 'break', {
      name: id,
      setup: async () => {
        offStage();
        dancer(who, 0, 0, Math.PI, id);
        await run(6);
      },
      cam: (t) => orbit(C, 3.0, 1.0, 0.25 * Math.sin(t * 2), 40, 1.1),
      words: (t) => label(words, t, BAR15 / 2),
    });
  }
  // 5. the last drop: all seven, each to their own, Balloon at the front
  const ALL: [number, string, number, number][] = [
    [0, 'balloon', 0, 0.6],
    [1, 'bhangra', -1.8, -0.4],
    [2, 'mj', 1.8, -0.4],
    [3, 'shuffle', -3.4, -1.5],
    [4, 'piratejig', 3.4, -1.5],
    [5, 'jaguar', -1.6, -2.6],
    [6, 'egypt', 1.6, -2.6],
  ];
  add(4, 'final', {
    name: 'all',
    setup: async () => {
      offStage();
      for (const [i, id, x, z] of ALL) dancer(i, x, z, Math.PI, id);
      await run(40);
    },
    cam: (t) => {
      const u = ease(t / (4 * BAR15));
      return orbit(at(0, 0, -1), 8.2 - 1.6 * u, 0.7 + 1.9 * u, -0.5 + 1.0 * u, 42, 0.95 - 0.15 * u);
    },
    words: (t) => showFor(wheel, t, 1.2, 6.6),
  });
  // 6. the end
  add(2, 'end', {
    name: 'end',
    setup: async () => {
      offStage();
      for (const [i, id, x, z] of ALL) dancer(i, x, z, Math.PI, id);
      await run(10);
    },
    cam: (t) => orbit(at(0, 0, -1), 6.6 + 0.2 * t, 2.6, 0.5 + 0.05 * t, 42, 0.8),
    words: (t) => {
      end.style.display = '';
      end.style.opacity = ease(t / 0.4).toFixed(3);
    },
  });
  total = cur;
  return shots;
}
