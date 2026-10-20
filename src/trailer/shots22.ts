// The twenty-second film, 22 s: "Lights" (2026-10-19, boarded in marketing/plan-x-media.html, the owner: "Yes, build it
// as planned"), for the feed. One take, no cuts: a fresh start on the far west beach at night, a look round in the
// dark, the lamps of Peski's lane and the road off the beach as points of light inland, and a run for them with the
// lens carried after him the whole way (the owner, of the lamps: "at night you cant really tell where to go especially
// as a fresh spawn"). Moved as the twenty-first is (src/trailer/human.ts): his own keys and a hand on the mouse, a lens
// somebody carries. music17's band under it.   node scripts/film.mjs --cut 22
import * as THREE from 'three';
import type { Shot, Stage } from './director';
import { scoreMusic17, type Kind17, type Row17 } from './music17';
import { Hand, ON_FOOT, Operator, Speeds } from './human';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const ROWS: Row17[] = [];
let total = 0;
export const seconds22 = () => total;
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic17(ctx, out, ROWS);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const fwdOf = (yaw: number) => V(-Math.sin(yaw), 0, -Math.cos(yaw));
const rightOf = (yaw: number) => V(Math.cos(yaw), 0, -Math.sin(yaw));

/** an hour just past dusk: the lamps lit, a little light still in the sky to see a man by */
const NIGHT = 0.775;

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  const say = (s: string) => console.log(`[tr] ${s}`);
  document.body.classList.add('tr-cut21');
  const overlay = document.getElementById('tr-overlay')!;
  const piece = (cls: string, html = '') => {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    overlay.appendChild(el);
    return el;
  };
  piece('tr-grain4');
  piece('tr-vig4');
  const title = piece('x21-title', '<img src="/brand/zona-mark.svg" alt=""><b>NIGHT ON <em>THE COAST</em></b><i>a new life starts here</i>');
  const end = piece('x21-end', '<img src="/brand/zona-mark.svg" alt=""><b>FOLLOW THE <em>LIGHTS</em></b><p><span>START ON THE COAST</span><span>WALK EAST</span></p><u>zonapvp.fun</u>');
  end.style.display = 'none';
  const run = async (frames: number) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      clock.advance(1000 / 60);
      if (i % 20 === 19) await wait(8);
    }
    S.mute = false;
  };

  // ------------------------------------------------------------ him: his legs and his hand
  const P = () => g.player as Any;
  const eye = () => {
    const p = P().pos as THREE.Vector3;
    return V(p.x, p.y + 1.62, p.z);
  };
  const hand = new Hand(22, eye);
  const pl = (x: number, z: number) => V(x, S.ground(x, z), z);
  const way = new THREE.CatmullRomCurve3([pl(-3609, 166), pl(-3596, 150), pl(-3576, 126), pl(-3556, 102), pl(-3536, 82)], false, 'centripetal');
  way.arcLengthDivisions = 400;
  const LEN = way.getLength();
  const along = (p: THREE.Vector3) => {
    let best = 1e9, bu = 0;
    for (let i = 0; i <= 200; i++) {
      const q = way.getPointAt(i / 200), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < best) { best = d; bu = i / 200; }
    }
    return bu * LEN;
  };
  const ahead = (m: number) => () => {
    const s = Math.min(LEN, along(P().pos) + m), q = way.getPointAt(s / LEN);
    return V(q.x, S.ground(q.x, q.z) + 1.35, q.z);
  };
  const heading = () => {
    const s = along(P().pos), q = way.getTangentAt(Math.min(0.999, s / LEN));
    return Math.atan2(-q.x, -q.z);
  };
  /** the first lamps he sees: Peski's on its west side, and the road's off the beach */
  const LAMP = V(-3529, S.ground(-3529, 74) + 4, 74), ROADLAMP = V(-3569, S.ground(-3569, 11) + 4, 11);

  // ------------------------------------------------------------ the one take
  const op = new Operator(ON_FOOT, 22, 42);
  const speeds = new Speeds();
  let going = -1;
  const fired = new Set<string>();
  const shot: Shot = {
    name: 'lights',
    start: 0,
    end: 22,
    bars: false,
    setup: async () => {
      try { localStorage.setItem('zona-howto-seen', '1'); } catch { /* */ }
      (document.querySelector('.howto-ok') as HTMLElement | null)?.click();
      g.hourHeld = NIGHT;
      S.kit(['beans', 'thermos', 'bandage']);
      S.hold(null);
      const p0 = way.getPointAt(0);
      // (as the game sets a new life down on the beach: facing inland)
      S.me(p0.x, p0.z, -1.57, -0.02);
      hand.set(-1.57 + 0.35, -0.02);
      // the lamps and the dark looked at before the take, so nothing is drawn for the first time in it
      for (const l of [LAMP, ROADLAMP, V(-3700, -15, 170)]) {
        S.cam = { p: eye(), l, fov: 50 };
        await run(80);
      }
      S.cam = null;
      await run(150);
      going = -1;
      const f = fwdOf(-1.57);
      op.reset(eye().addScaledVector(f, 3.6).addScaledVector(rightOf(-1.57), -1.4).setY(eye().y - 0.1), eye());
    },
    tick: (t, _S, dt) => {
      // a look out to sea, back inland, and the lamps; then off for them
      if (t >= 0.4 && !fired.has('sea')) { fired.add('sea'); hand.look(t, V(-3700, -14, 210)); }
      if (t >= 1.9 && !fired.has('lamp')) { fired.add('lamp'); hand.look(t, ROADLAMP); }
      if (t >= 3.0 && !fired.has('peski')) { fired.add('peski'); hand.look(t, LAMP); }
      if (t >= 3.9 && going < 0) {
        going = t;
        hand.look(t, ahead(8), true);
      }
      if (going > 0) {
        const left = LEN - along(P().pos);
        S.key('KeyW', left > 0.6);
        // (a jog: at a sprint he outruns anybody carrying a camera, and is a speck by the lamps)
      }
      const a = hand.update(t, dt);
      P().yaw = a.yaw;
      P().pitch = a.pitch;
    },
    cam: (t) => {
      const e = eye(), p = P().pos as THREE.Vector3;
      let want: THREE.Vector3, at: THREE.Vector3;
      if (going < 0 || t < going + 0.9) {
        // in front of him and to his side while he looks round: his face, the dark behind
        want = e.clone().addScaledVector(fwdOf(-1.57), 3.6).addScaledVector(rightOf(-1.57), -1.4).setY(e.y - 0.1);
        at = e.clone().setY(e.y - 0.15);
      } else {
        // then round behind him as he goes past, and after him: the lamps ahead over his shoulder
        const yaw = heading(), f = fwdOf(yaw), r = rightOf(yaw);
        want = p.clone().addScaledVector(f, -3.8).addScaledVector(r, 1.1);
        want.y = Math.max(S.ground(want.x, want.z), p.y) + 1.65;
        at = p.clone().addScaledVector(f, 9).setY(p.y + 1.25);
      }
      return op.update(t, want, at);
    },
    after: (t) => {
      speeds.note('player', t, P().pos);
      if (S.cam) speeds.note('lens', t, S.cam.p);
      document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
      const k = t < 2.2 ? 1 : 1 - ease((t - 2.2) / 0.9);
      title.style.display = k > 0.002 ? '' : 'none';
      title.style.opacity = k.toFixed(3);
      const o = ease((t - 17.6) / 1.0);
      end.style.display = o > 0.002 ? '' : 'none';
      end.style.opacity = o.toFixed(3);
      if (t > 22 - 0.05) say(`lights: ${speeds.report()}`);
    },
  };
  total = 22;
  const parts: [Kind17, number][] = [['sneak', 4], ['tight', 5], ['end', 2]];
  for (const [kind, bars] of parts) for (let b = 0; b < bars; b++) ROWS.push({ kind, hit: b === 0 ? 0.8 : undefined, build: bars > 1 ? b / (bars - 1) : undefined, lift: b === bars - 1 ? 1 : undefined });
  say(`1 shot, ${total} s, the way ${LEN.toFixed(0)} m`);
  return [shot];
}
