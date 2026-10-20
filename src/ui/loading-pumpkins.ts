// Pumpkins round the title on the loading screen, for October. The owner, 2026-10-20: "its october halloween this
// month we should throw some pumpkins and jackolanterns ... around the zona title text make it look 3d almost", and
// of the models: "just use th epumpkins". Pictures of a real model (scripts/halloween-sprites.mjs): a jack-o'-lantern,
// drawn dark and with a candle in it (the one flickers over the other), and a pumpkin with nothing cut in it. They
// are thrown in, land on the letters' baseline either side of the word, clear of every letter and line, and hop when
// clicked. Shown only in October (`?halloween` shows them any day).

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** each pumpkin: a lantern or a plain one, its height (px), which side of the word, how far out from it (px, to its
 * nearer edge), and turned to face the word */
const PUMPKINS = [
  { lantern: true, h: 64, side: -1, out: 16, flip: false },
  { lantern: false, h: 36, side: -1, out: 70, flip: false },
  { lantern: true, h: 54, side: 1, out: 16, flip: true },
  { lantern: false, h: 32, side: 1, out: 62, flip: true },
];
/** a lantern's picture is 154 by 160, a pumpkin's 101 by 112 */
const ASPECT = { lantern: 154 / 160, plain: 101 / 112 };

export interface Pumpkins {
  /** set them by the word: its ink's left and right and its baseline, px in the title's frame */
  place(left: number, right: number, base: number): void;
  /** a click on one makes it hop: true if it was on one */
  hit(target: EventTarget | null): boolean;
  /** they shift a little against the mark's lean, being nearer */
  lean(dx: number, dy: number): void;
}

export function loadingPumpkins(name: HTMLElement): Pumpkins | null {
  if (new Date().getMonth() !== 9 && !new URLSearchParams(location.search).has('halloween')) return null;
  const box = name.appendChild(document.createElement('div'));
  box.className = 'load-pumpkins';
  box.setAttribute('aria-hidden', 'true');
  const all = PUMPKINS.map((p, k) => {
    const el = box.appendChild(document.createElement('div'));
    el.className = `lp${p.flip ? ' flip' : ''}${p.lantern ? ' lantern' : ''}`;
    el.style.setProperty('--k', String(k));
    const w = p.h * (p.lantern ? ASPECT.lantern : ASPECT.plain);
    el.innerHTML = `${p.lantern ? '<i class="lp-glow"></i>' : ''}<i class="lp-shadow"></i><div class="lp-body">${
      p.lantern ? '<img src="/brand/halloween-lantern.webp" alt=""><img class="lp-lit" src="/brand/halloween-lantern-lit.webp" alt="">' : '<img src="/brand/halloween-pumpkin.webp" alt="">'
    }</div>`;
    const body = el.querySelector('.lp-body') as HTMLElement;
    body.style.width = `${w.toFixed(1)}px`;
    body.style.height = `${p.h}px`;
    body.style.marginLeft = `${(-w / 2).toFixed(1)}px`;
    (el.querySelector('.lp-shadow') as HTMLElement).style.width = `${(w * 0.95).toFixed(1)}px`;
    // (its light no wider than itself and a little: it stops short of the letters)
    const glow = el.querySelector('.lp-glow') as HTMLElement | null;
    if (glow) glow.style.width = `${(w * 1.3).toFixed(1)}px`;
    return { p, el, body, w, landed: false };
  });
  const ready = Promise.all([...box.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));

  /** thrown in: falling, turning, a squash as it lands and a bounce */
  const land = (o: (typeof all)[number], k: number) => {
    o.landed = true;
    o.el.classList.add('in');
    if (REDUCED) return;
    const delay = 250 + k * 150, spin = o.p.side * (25 + k * 8);
    o.body.animate(
      [
        { transform: `translateY(-190px) rotate(${-spin}deg)`, opacity: 0, easing: 'cubic-bezier(.5,0,.9,.5)' },
        { opacity: 1, offset: 0.12 },
        { transform: `translateY(0) rotate(${(spin / 8).toFixed(1)}deg)`, offset: 0.55, easing: 'ease-out' },
        { transform: 'translateY(0) scale(1.12, .86)', offset: 0.63, easing: 'ease-out' },
        { transform: 'translateY(-14px) rotate(-2deg)', offset: 0.77, easing: 'ease-in' },
        { transform: 'translateY(0) scale(1.04, .95)', offset: 0.9, easing: 'ease-out' },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 1100, delay, fill: 'backwards' },
    );
    const sh = o.el.querySelector('.lp-shadow') as HTMLElement;
    sh.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.55 }, { transform: 'scale(1.1)', offset: 0.63 }, { transform: 'scale(.85)', offset: 0.77 }, { transform: 'none', opacity: 1 }], { duration: 1100, delay, fill: 'backwards' });
    // (its candle lights the ground once it is down)
    o.el.querySelector('.lp-glow')?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 0.85 }], { duration: 1100, delay, fill: 'backwards' });
  };

  let placed = false;
  return {
    place(left, right, base) {
      // smaller where the screen is narrow, so that none is cut off at its edge
      const r = name.getBoundingClientRect(), mid = r.left + (left + right) / 2, half = (right - left) / 2;
      const room = Math.min(mid, innerWidth - mid) - half - 8, need = Math.max(...PUMPKINS.map((p) => p.out + p.h)) + 6;
      const s = Math.max(0.55, Math.min(1, room / need));
      box.style.setProperty('--s', s.toFixed(3));
      for (const o of all) {
        const x = o.p.side < 0 ? left - (o.p.out + o.w / 2) * s : right + (o.p.out + o.w / 2) * s;
        o.el.style.left = `${x.toFixed(1)}px`;
        o.el.style.top = `${base.toFixed(1)}px`;
      }
      if (placed) return;
      placed = true;
      void ready.then(() => all.forEach(land));
    },
    hit(target) {
      const el = target instanceof Element ? target.closest('.lp') : null;
      const o = all.find((a) => a.el === el);
      if (!o) return false;
      if (!REDUCED && o.landed)
        o.body.animate(
          [
            { transform: 'none' },
            { transform: 'scale(1.1, .88)', offset: 0.15 },
            { transform: `translateY(-30px) rotate(${o.p.side * -8}deg) scale(.96, 1.06)`, offset: 0.5, easing: 'ease-in' },
            { transform: 'scale(1.1, .9)', offset: 0.82 },
            { transform: 'none' },
          ],
          { duration: 620, easing: 'ease-out' },
        );
      return true;
    },
    lean(dx, dy) {
      box.style.transform = `translate(${(-dx * 6).toFixed(1)}px, ${(-dy * 3).toFixed(1)}px)`;
    },
  };
}
