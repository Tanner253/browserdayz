// The twenty-third film, 15 seconds: the 9A-91 and the Barrett's bipod (the owner, 2026-10-20: "i want a short 15
// second trailer of the new weapon and bipod mechanic"). In first person, as it is played: the 9A-91 in the hands, B and
// its stock folds up over the receiver, aimed folded and fired through its can; then lying down with the Barrett, B and
// the bipod comes down, and on it the scope holds still for a shot. Cut 16's band, as 18 and 19.
//   node scripts/film.mjs --cut 23
import type { Shot, Stage } from './director';
import { BAR16, scoreMusic16, type Part16 } from './music16';
import { makeItem, type ItemInstance } from '../sim/items';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const BARS: Part16[] = [];
let total = 0;
export const seconds23 = () => total;
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic16(ctx, out, BARS);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

/** where it is filmed: Kamenka's edge by the well and the barn, morning, facing the barn; the Barrett lies looking out past it */
const HERE = { x: 30, z: 10, yaw: 0.5, out: 0.5 + 0.4 };

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  document.body.classList.add('tr-cut16', 'tr-hud-off', 'tr-cut23');
  const overlay = document.getElementById('tr-overlay')!;
  const piece = (cls: string, html = '') => {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    overlay.appendChild(el);
    return el;
  };
  const grain = piece('tr-grain4'), black = piece('tr-black4'), white = piece('tr-flash4');
  piece('tr-vig4');
  const gfx: HTMLElement[] = [];
  const Gx = (cls: string, html: string) => {
    const el = piece(`tr-gfx ${cls}`, html);
    el.style.display = 'none';
    gfx.push(el);
    return el;
  };
  const show = (el: HTMLElement, t: number, o = 1) => {
    el.style.display = '';
    el.style.setProperty('--t', t.toFixed(3));
    el.style.setProperty('--o', o.toFixed(3));
  };
  const title = Gx('x16-card x18-title', `<img src="/brand/zona-mark.svg" alt=""><i>NEW IN THE ZONE</i><b>9A-91 <em>&amp; BIPOD</em></b>`);
  const cap = Gx('x16-cap', '<i></i><b></b><span></span>');
  const caption = (t: number, from: number, to: number, kick: string, big: string, small: string) => {
    if (t < from || t >= to) return;
    cap.querySelector('i')!.textContent = kick;
    cap.querySelector('b')!.textContent = big;
    cap.querySelector('span')!.textContent = small;
    show(cap, t - from, Math.min(ease((t - from) / 0.3), ease((to - t) / 0.25)));
  };
  const end = Gx('x16-end', `<img src="/brand/zona-mark.svg" alt=""><b>9A-91 · FOLDING STOCK · <em>BIPOD</em></b><div>zonapvp.fun</div><p>play free in your browser · follow on X <strong>@zonaSOL_</strong></p>`);
  let frame = 0;
  const look = (t: number, len: number, fadeIn = 0, fadeOut = 0, flash = 0) => {
    frame++;
    grain.style.transform = `translate(${((frame * 73) % 97) - 48}px, ${((frame * 41) % 89) - 44}px)`;
    const a = fadeIn ? 1 - ease(t / fadeIn) : 0, z = fadeOut ? ease((t - (len - fadeOut)) / fadeOut) : 0;
    black.style.opacity = String(Math.max(a, z));
    white.style.opacity = String(flash ? Math.max(0, 1 - t / 0.12) * flash : 0);
  };
  const run = async (frames: number) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      for (const a of S.actors) a.push();
      clock.advance(1000 / 60);
      if (i % 20 === 19) await wait(8);
    }
    S.mute = false;
  };
  const W = () => g.weapons as Any;
  /** the player stood here, lying down or not, with this gun and nothing else in the hands, the gun up and at its own pictures */
  const armed = async (id: string, set: Partial<ItemInstance>, yaw: number, pitch: number, prone: boolean) => {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Mouse0', 'Mouse2', 'KeyB']) S.key(k, false);
    S.me(HERE.x, HERE.z, yaw, pitch);
    if (g.use) g.breakOff();
    g.emptyHands();
    const neck = g.inv.neck;
    g.inv.clear();
    g.inv.neck = neck;
    g.inv.hot = [];
    const it = Object.assign(makeItem(id) as ItemInstance, set);
    g.inv.add(it);
    g.inventoryChanged();
    g.takeUp(it);
    if (prone !== !!g.player.prone) g.player.setProne(prone);
    // (up in the hands and lying still; the pictures a gun is drawn with up close come in as the clock moves)
    for (let k = 0; k < 12 && (W().current !== W().models.get(id) || W().action); k++) await run(15);
    for (let k = 0; k < 4; k++) {
      await run(10);
      await wait(400);
    }
    g.player.yaw = yaw;
    g.player.pitch = pitch;
    await run(30);
    return it;
  };
  /** keys put down and let go at times in a shot, each once (said to the game before it moves, in `tick`) */
  let keys: [number, string, boolean][] = [];
  const press = (t: number, code: string, ms = 60): [number, string, boolean][] => [[t, code, true], [t + ms / 1000, code, false]];
  const keysAt = (t: number) => {
    while (keys.length && keys[0][0] <= t) {
      const [, code, down] = keys.shift()!;
      S.key(code, down);
    }
  };

  const shots: Shot[] = [];
  let cur = 0;
  const add = (bars: number, part: Part16, s: Omit<Shot, 'start' | 'end'> & { fadeIn?: number; fadeOut?: number; flash?: number; words?: (t: number) => void; at?: [number, string, boolean][] }) => {
    const len = bars * BAR16, start = cur;
    for (let b = 0; b < bars; b++) BARS.push(part);
    cur += len;
    total = cur;
    const setup = s.setup, tick = s.tick;
    shots.push({
      bars: !s.cam ? false : true,
      ...s,
      start,
      end: start + len,
      setup: async (st) => {
        for (const el of gfx) el.style.display = 'none';
        for (const a of S.actors) a.hide();
        keys = [];
        await setup?.(st);
        keys = [...(s.at ?? [])].sort((a, b) => a[0] - b[0]);
      },
      tick: (t, st, dt) => {
        keysAt(t);
        tick?.(t, st, dt);
      },
      after: (t) => {
        for (const el of gfx) el.style.display = 'none';
        s.words?.(t);
        look(t, len, s.fadeIn ?? 0, s.fadeOut ?? 0, s.flash ?? 0);
      },
    } as Shot);
  };

  // 1 · the title, the 9A-91 in the hands
  add(1, 'open', {
    name: 'title',
    setup: async () => {
      g.hourHeld = 0.42;
      await armed('a91', { mag: 'mag_a91', loaded: 21, mods: ['a91_suppressor'] }, HERE.yaw, -0.04, false);
    },
    words: (t) => show(title, t, Math.min(1, ease((BAR16 - t) / 0.35))),
  });
  // 2 · B: the stock folds up over the receiver, and the gun comes up to the eye folded
  add(2, 'pulse', {
    name: 'fold',
    at: press(0.25, 'KeyB'),
    words: (t) => caption(t, 0.2, 2 * BAR16 - 0.05, '9A-91 · PRESS B', 'THE STOCK FOLDS', 'quicker to the eye · it kicks harder'),
  });
  // 3 · folded, a burst through its can from the hip (aimed, the spent cases fly across the sight)
  add(1, 'drop', {
    name: 'burst',
    at: [[0.3, 'Mouse0', true], [0.7, 'Mouse0', false], [1.1, 'Mouse0', true], [1.45, 'Mouse0', false]],
    words: (t) => caption(t, 0.1, BAR16 - 0.05, '9x39 SUBSONIC', 'PBS-9 SUPPRESSOR', 'twenty rounds · hardly heard'),
  });
  // 4 · the Barrett looked over (I turns it side-on), and B: the bipod's legs swing down
  add(2, 'tense', {
    name: 'bipod',
    setup: async () => {
      S.key('Mouse2', false);
      S.key('Mouse0', false);
      await armed('barrett', { mag: 'mag_barrett', loaded: 11, mods: ['scope_barrett'] }, HERE.yaw, -0.05, false);
    },
    at: [...press(0.1, 'KeyI'), ...press(1.0, 'KeyB')],
    words: (t) => caption(t, 0.2, 2 * BAR16 - 0.05, 'BARRETT · PRESS B', 'BIPOD DOWN', 'it holds only lying down'),
  });
  // 5 · down on it and scoped: the scope holds still, W does nothing, and the shot
  add(2, 'lift', {
    name: 'braced',
    setup: async () => {
      for (let k = 0; k < 10 && W().action; k++) await run(15);
      g.player.setProne(true);
      await run(70);
      // (the cross on the barn's wall, over the grass)
      g.player.yaw = HERE.yaw - 0.05;
      g.player.pitch = 0.05;
      S.key('Mouse2', true);
      await run(60);
    },
    at: [[0.4, 'KeyW', true], [1.4, 'KeyW', false], ...press(2.2, 'Mouse0')],
    words: (t) => caption(t, 0.1, 2 * BAR16 - 0.05, 'PRONE ON THE BIPOD', 'STEADY', 'the scope holds still · you stay where you lie'),
  });
  // 6 · the end card
  add(1, 'end', {
    name: 'end',
    setup: async () => {
      S.key('Mouse2', false);
      await run(10);
    },
    fadeOut: 0.3,
    words: (t) => show(end, t, Math.min(ease(t / 0.3), 1)),
  });
  return shots;
}
