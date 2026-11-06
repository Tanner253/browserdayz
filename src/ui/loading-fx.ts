// The loading screen's weather and the part of its motion that answers the player. The mark first (the owner,
// 2026-10-20: "the icon background pulsing (yellow) and the white mask puffing green smoke ... interactive"): its breath
// and gas are CSS loops (src/ui/style.css, run by the compositor, so they keep moving while the start stalls the page);
// here it leans toward the pointer, and a click or tap sends a burst of gas. Then November (the owner, 2026-11-06: "its
// no longer halloween, we are in november! new loading page"), first snow in place of October's blood and pumpkins:
// snow falling at three depths that lean with the mark, mist along the bottom, frost on the letters (src/ui/loading-
// frost.ts) blooming where a click lands, and icicles dripping now and then. Nothing here runs once the screen has gone.

import { Frost, rng } from './loading-frost';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const f1 = (v: number) => v.toFixed(1);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** the snow's depths, far to near: flakes per million px of screen (and at most), their size (px), fall (s), how far
 * each leans with the pointer (px), and how soft */
const DEPTHS = [
  { per: 90, most: 70, size: [1.6, 3], fall: [16, 24], op: 0.55, lean: 3, blur: 0 },
  { per: 40, most: 36, size: [3, 5], fall: [10, 15], op: 0.75, lean: 8, blur: 0 },
  { per: 9, most: 10, size: [8, 13], fall: [6, 9], op: 0.45, lean: 16, blur: 2 },
];
/** icicles that drip, the longest */
const DRIPS = 3;

/** the snow and the mist, behind everything else on the screen; each flake its own small layer the compositor moves */
function weather(root: HTMLElement) {
  const snow = document.createElement('div'), fog = document.createElement('div');
  snow.className = 'load-snow';
  fog.className = 'load-fog';
  fog.innerHTML = '<i></i><i></i>';
  const R = rng(11), area = (innerWidth * innerHeight) / 1e6;
  const layers = DEPTHS.map((d) => {
    const layer = snow.appendChild(document.createElement('div'));
    layer.className = 'ls';
    for (let k = 0, n = Math.min(d.most, Math.round(d.per * area)); k < n; k++) {
      const f = layer.appendChild(document.createElement('i')), s = d.size[0] + R() * (d.size[1] - d.size[0]), t = d.fall[0] + R() * (d.fall[1] - d.fall[0]);
      // (started somewhere along its fall, so the screen opens already snowing)
      f.style.cssText = `left:${f1(R() * 104 - 2)}%;width:${f1(s)}px;height:${f1(s)}px;opacity:${(d.op * (0.6 + R() * 0.4)).toFixed(2)};--t:${f1(t)}s;--d:${f1(-R() * t)}s;--w:${f1(3 + R() * 3)}s;--s:${f1(6 + R() * 14)}px;--x:${f1((R() - 0.65) * 60)}px${d.blur ? `;filter:blur(${d.blur}px)` : ''}`;
    }
    return [layer, d.lean] as const;
  });
  root.prepend(snow, fog);
  return layers;
}

export function loadingFx(root: HTMLElement) {
  const mark = root.querySelector('.load-mark') as HTMLElement | null;
  const title = root.querySelector('.load-title') as HTMLElement | null;
  const host = root.querySelector('.load-frost') as HTMLElement | null;
  if (!mark || !title || !host) return;
  const gas = mark.querySelector('.lm-gas') as HTMLElement;
  const flash = mark.querySelector('.lm-flash') as HTMLElement;
  const horns = [...mark.querySelectorAll<HTMLElement>('.lm-h0, .lm-h1, .lm-h2')];
  const depth: [HTMLElement, number][] = [['.lm-front', 7], ['.lm-sign', 2.5], ['.lm-glow', -4]].map(([q, d]) => [mark.querySelector(q as string) as HTMLElement, d as number]);
  const shock = mark.querySelector('.lm-shock') as HTMLElement;
  const anchor = gas.appendChild(document.createElement('s'));
  const snow = weather(root);
  const frost = new Frost(title, host);
  let mid = { x: 0, y: 0 };

  /** drops at the longest icicles' tips, each on a clock of its own */
  const drips = () => {
    for (const d of host.querySelectorAll('.lf-drop')) d.remove();
    if (REDUCED) return;
    const R = rng(5), em = parseFloat(getComputedStyle(title).fontSize);
    for (const p of frost.tips().slice(0, DRIPS)) {
      const d = host.appendChild(document.createElement('i')), w = em * 0.045;
      d.className = 'lf-drop';
      d.style.cssText = `left:${f1(p.x - w / 2)}px;top:${f1(p.y - w * 0.4)}px;width:${f1(w)}px;height:${f1(w * 1.2)}px;--t:${f1(3.5 + R() * 3)}s;--d:${f1(R() * 4)}s`;
    }
  };

  const relayout = () => {
    const mr = mark.getBoundingClientRect();
    mid = { x: mr.left + mr.width / 2, y: mr.top + mr.height / 2 };
    const ok = frost.layout();
    title.classList.toggle('frosted', ok && host.classList.contains('in'));
    drips();
    return ok;
  };

  /** a burst of gas from the filter, and the sign flares */
  const burst = () => {
    if (REDUCED || anchor.childElementCount > 30) return;
    const R = Math.random;
    for (let k = 0; k < 10; k++) {
      // as the breath's puffs go (src/ui/style.css): out to a side on one layer, up on the other, rolling; up only
      const u = anchor.appendChild(document.createElement('u'));
      const p = u.appendChild(document.createElement('i'));
      p.className = 'lm-burst';
      p.style.backgroundPosition = `${Math.floor(R() * 4) * 33.333}% 0`;
      const side = k % 2 ? 1 : -1, t = { duration: 2300 + R() * 900, delay: k * 45, fill: 'backwards' as const };
      u.animate([{ translate: '0 0' }, { translate: `${f1(side * (34 + R() * 46))}px 0` }], { ...t, easing: 'cubic-bezier(.15,.6,.3,1)' });
      p.animate([{ translate: '0 0' }, { translate: `0 ${f1(-(50 + R() * 70))}px` }], { ...t, easing: 'cubic-bezier(.4,.05,.55,.95)' });
      p.animate([{ rotate: '0deg', scale: '0.5' }, { rotate: `${Math.round(side * (60 + R() * 80))}deg`, scale: (1.5 + R() * 0.5).toFixed(2) }], { ...t, easing: 'cubic-bezier(.2,.6,.4,1)' });
      p.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.06 }, { opacity: 0.55, offset: 0.35 }, { opacity: 0 }], t).onfinish = () => u.remove();
    }
    // and the sign's horns lash, with a flash and a ring
    flash.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0 }], { duration: 1100, easing: 'ease-out' });
    horns.forEach((h, k) =>
      h.animate([{ rotate: '0deg', scale: '1' }, { rotate: '-16deg', scale: '0.86', offset: 0.3 }, { rotate: '8deg', scale: '1.1', offset: 0.65 }, { rotate: '0deg', scale: '1' }], { duration: 900, delay: k * 50, easing: 'ease-in-out' }),
    );
    shock.animate([{ opacity: 0.9, transform: 'scale(.35)' }, { opacity: 0, transform: 'scale(1.45)' }], { duration: 800, delay: 260, easing: 'ease-out' });
  };

  // the lean: turned toward the pointer by at most 6°, the mask shifted 7 px its way, the glow behind 4 px the other,
  // and the snow its way by its depth
  let raf = 0, px = 0, py = 0, back = 0;
  const lean = (x: number, y: number) => {
    px = x;
    py = y;
    if (raf || REDUCED) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const dx = clamp((px - mid.x) / (innerWidth / 2), -1, 1), dy = clamp((py - mid.y) / (innerHeight / 2), -1, 1);
      mark.style.rotate = `${(dx * 6).toFixed(2)}deg`;
      for (const [el, d] of depth) el.style.translate = `${(dx * d).toFixed(1)}px ${(dy * d * 0.7).toFixed(1)}px`;
      for (const [el, d] of snow) el.style.translate = `${(dx * d).toFixed(1)}px ${(dy * d * 0.5).toFixed(1)}px`;
    });
  };
  const home = () => lean(mid.x, mid.y);

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') lean(e.clientX, e.clientY);
  };
  const onOut = (e: MouseEvent) => {
    if (!e.relatedTarget) home();
  };
  const onDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('button, a')) return;
    if (e.pointerType !== 'mouse') {
      // a touch leans it that way for a moment
      lean(e.clientX, e.clientY);
      clearTimeout(back);
      back = window.setTimeout(home, 900);
    }
    burst();
    frost.bloomAt(e.clientX, e.clientY);
  };
  let pending = 0;
  const onResize = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(relayout);
  };
  const fontsDone = () => onResize();
  const titled = new MutationObserver(onResize);

  let on = false;
  const attach = () => {
    if (on) return;
    on = true;
    addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseout', onOut);
    root.addEventListener('pointerdown', onDown);
    addEventListener('resize', onResize);
    document.fonts?.addEventListener('loadingdone', fontsDone);
    titled.observe(title, { childList: true, characterData: true, subtree: true });
  };
  const detach = () => {
    if (!on) return;
    on = false;
    removeEventListener('pointermove', onMove);
    document.removeEventListener('mouseout', onOut);
    root.removeEventListener('pointerdown', onDown);
    removeEventListener('resize', onResize);
    document.fonts?.removeEventListener('loadingdone', fontsDone);
    titled.disconnect();
    cancelAnimationFrame(raf);
    raf = 0;
    frost.stop();
  };
  attach();

  // the screen gone (faded out: Game's start adds `done`), it is taken out of the page, and every loop with it;
  // back if it is shown again (a lost picture says so on it)
  let offT = 0;
  new MutationObserver(() => {
    const done = root.classList.contains('done'), off = root.classList.contains('off');
    if (done && !off && !offT)
      offT = window.setTimeout(() => {
        offT = 0;
        if (!root.classList.contains('done')) return;
        root.classList.add('off');
        detach();
      }, 1000);
    if (!done) {
      clearTimeout(offT);
      offT = 0;
      if (off) {
        root.classList.remove('off');
        attach();
      }
    }
  }).observe(root, { attributes: true, attributeFilter: ['class'] });

  // the frost comes once the letters are in their own face (measured in a stand-in it would sit wrong): it fades in
  // over them, the title's own letters giving way beneath it once it has, and a first bloom lands on the second letter
  let begun = false;
  const begin = () => {
    if (begun) return;
    begun = true;
    if (!relayout()) return;
    host.classList.add('in');
    window.setTimeout(() => title.classList.add('frosted'), REDUCED ? 0 : 1300);
    window.setTimeout(() => frost.bloomOn(1, 0.62, 0.35, 23), REDUCED ? 0 : 900);
  };
  // (asked for by name: fonts.ready alone can come before the face is even asked for, and the frost was drawn in a stand-in)
  const cs = getComputedStyle(title);
  void (document.fonts ? document.fonts.load(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`).then(() => document.fonts.ready) : Promise.resolve()).then(begin, begin);
  setTimeout(begin, 3000);
}
