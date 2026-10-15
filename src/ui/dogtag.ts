// The dog tag on the menu: two steel tags on a ball chain, the player's name stamped into the front one as it is typed.
// The owner, 2026-10-14: "our dog tag model with a shitty dotted circle lazily overlayed looks like shit. I think we
// can do better with our front end." It is drawn, not a model: the game's own tag (src/game/procedural.ts) is two
// plain plates. Drawn as the tags are made: brushed steel, a rolled rim, a black rubber silencer round the edge, the
// letters struck in, and the chain's beads each a bead.

const NS = 'http://www.w3.org/2000/svg';
/** the tag, in the drawing's own units: where it is, how big, where its hole is */
const TAG = { x: 46, y: 86, w: 196, h: 110, r: 22, hole: [66, 141] as [number, number] };
/** the chain's beads: how far apart along it, and how big */
const BEAD = { every: 10.4, r: 4.1 };

function el<K extends keyof SVGElementTagNameMap>(tag: K, at: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(at)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

/** a tag's outline: a rounded oblong with the hole through it */
function plate(parent: Element, fill: string, cls: string) {
  const { x, y, w, h, r, hole } = TAG;
  const d = `M${x + r},${y}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - 2 * r)}a${r},${r} 0 0 1 ${-r},${-r}v${-(h - 2 * r)}a${r},${r} 0 0 1 ${r},${-r}z` + `M${hole[0] + 7},${hole[1]}a7,7 0 1 0 -14,0a7,7 0 1 0 14,0z`;
  return el('path', { d, fill, 'fill-rule': 'evenodd', class: cls }, parent);
}

/** a strand of ball chain along a curve: the thin links under, a shaded bead every so far */
function strand(parent: Element, d: string) {
  const g = el('g', { class: 'dt-strand' }, parent);
  const path = el('path', { d, fill: 'none', stroke: '#5d5f5a', 'stroke-width': 1.3 }, g);
  // (measured where it is drawn: a path not in a document has no length)
  queueMicrotask(() => {
    const len = path.getTotalLength();
    for (let s = 0; s <= len; s += BEAD.every) {
      const p = path.getPointAtLength(s);
      el('circle', { cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: BEAD.r, fill: 'url(#dt-bead)' }, g);
    }
  });
}

export interface DogTag {
  /** the name as it is to be stamped (empty: what is stamped on a tag nobody has named) */
  stamp(name: string): void;
}

/**
 * The tag drawn into `host`, stamped with what is typed into `input` (each new letter struck, the tag jolted by it);
 * a click on it puts the cursor in the field; the light on it follows the pointer.
 */
export function dogTag(host: HTMLElement, input: HTMLInputElement, blank = 'Survivor'): DogTag {
  const svg = el('svg', { viewBox: '0 0 260 220', class: 'dt-svg', 'aria-hidden': 'true' });
  const defs = el('defs', {}, svg);
  defs.innerHTML = `
    <linearGradient id="dt-steel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#eceee9"/><stop offset="0.32" stop-color="#bcbeb8"/><stop offset="0.58" stop-color="#8c8e88"/><stop offset="0.82" stop-color="#cbcdc7"/><stop offset="1" stop-color="#9fa19b"/>
    </linearGradient>
    <linearGradient id="dt-steel-back" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a3a59f"/><stop offset="0.5" stop-color="#6a6c67"/><stop offset="1" stop-color="#868882"/>
    </linearGradient>
    <linearGradient id="dt-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.75"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.45"/>
    </linearGradient>
    <linearGradient id="dt-sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="dt-bead" cx="0.36" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#c3c5bf"/><stop offset="0.8" stop-color="#6b6d68"/><stop offset="1" stop-color="#3a3c38"/>
    </radialGradient>
    <linearGradient id="dt-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.42" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="dt-chain-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="260" height="220"><rect width="260" height="220" fill="url(#dt-fade)"/></mask>
    <filter id="dt-brush" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.005 0.7" numOctaves="2" seed="7"/>
      <feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1"/>
    </filter>
    <filter id="dt-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="9" stdDeviation="8" flood-color="#000" flood-opacity="0.6"/></filter>
    <clipPath id="dt-clip"><rect x="${TAG.x}" y="${TAG.y}" width="${TAG.w}" height="${TAG.h}" rx="${TAG.r}"/></clipPath>`;
  const swing = el('g', { class: 'dt-swing' }, svg);
  // the chain, from out of sight above down through the hole and back up: the front tag's, and a little of the back's
  const [hx, hy] = TAG.hole;
  // (one strand comes down over the face of the tag into the hole, the other goes up behind it: the chain is seen
  // to go through the tag, and not to end at its edge)
  const behind = el('g', { mask: 'url(#dt-chain-fade)' }, swing);
  strand(behind, `M${hx},${hy} C${hx + 22},${hy - 56} ${hx + 58},48 ${hx + 78},-8`);
  // the back tag: the second of the pair, behind and turned on the chain, in shadow
  const back = el('g', { class: 'dt-back', transform: `rotate(-13 ${hx} ${hy}) translate(10 -8)`, filter: 'url(#dt-shadow)' }, swing);
  plate(back, '#141513', 'dt-silencer');
  plate(back, 'url(#dt-steel-back)', 'dt-body');
  // the front tag
  const front = el('g', { class: 'dt-front', filter: 'url(#dt-shadow)' }, swing);
  const sil = plate(front, '#121311', 'dt-silencer');
  sil.setAttribute('transform', `translate(${TAG.x + TAG.w / 2} ${TAG.y + TAG.h / 2}) scale(1.045 1.08) translate(${-(TAG.x + TAG.w / 2)} ${-(TAG.y + TAG.h / 2)})`);
  plate(front, 'url(#dt-steel)', 'dt-body');
  // (the hole's edge: dark above where it goes into the steel, lit below)
  el('circle', { cx: hx, cy: hy, r: 7.6, fill: 'none', stroke: 'url(#dt-rim)', 'stroke-width': 1.6, transform: `rotate(180 ${hx} ${hy})` }, front);
  const face = el('g', { 'clip-path': 'url(#dt-clip)' }, front);
  el('rect', { x: TAG.x, y: TAG.y, width: TAG.w, height: TAG.h, filter: 'url(#dt-brush)', opacity: 0.28, style: 'mix-blend-mode: overlay' }, face);
  // the rolled rim: a raised edge just inside the outline, lit from above
  el('rect', { x: TAG.x + 7, y: TAG.y + 7, width: TAG.w - 14, height: TAG.h - 14, rx: TAG.r - 6, fill: 'none', stroke: 'url(#dt-rim)', 'stroke-width': 2.4 }, face);
  // the stamped lines: the name, then the game's and what the bearer is
  const tx = hx + 20;
  const lines = el('g', { class: 'dt-lines' }, face);
  const struck = (y: number, size: number, cls: string) => {
    const g = el('g', { class: cls }, lines);
    // (letters struck in from the front: dark in the hollow, the edge below it catching the light)
    const lit = el('text', { x: tx, y: y + 1, 'font-size': size, class: 'dt-lit' }, g);
    const ink = el('text', { x: tx, y, 'font-size': size, class: 'dt-ink' }, g);
    return { g, lit, ink };
  };
  const nameLine = struck(TAG.y + 42, 21, 'dt-name');
  for (const [i, t] of ['ZONA', 'SURVIVOR'].entries()) {
    const l = struck(TAG.y + 66 + i * 19, 12, 'dt-meta');
    l.lit.textContent = l.ink.textContent = t;
  }
  const over = el('g', { mask: 'url(#dt-chain-fade)' }, swing);
  strand(over, `M${hx - 62},-8 C${hx - 52},46 ${hx - 18},${hy - 46} ${hx},${hy}`);
  const sheen = el('rect', { x: TAG.x - 80, y: TAG.y - 20, width: 70, height: TAG.h + 40, fill: 'url(#dt-sheen)', class: 'dt-sheen', transform: 'skewX(-18)' }, face);
  host.replaceChildren(svg);

  let was = '';
  const stamp = (raw: string) => {
    const name = raw.trim().toUpperCase().slice(0, 16);
    const shown = name || blank.toUpperCase();
    // (a long name is struck smaller, to fit between the hole and the rim)
    const size = Math.min(21, 138 / Math.max(1, shown.length * 0.69));
    nameLine.g.classList.toggle('blank', !name);
    for (const t of [nameLine.lit, nameLine.ink]) {
      t.setAttribute('font-size', size.toFixed(1));
      t.replaceChildren(
        ...[...shown].map((c) => {
          const span = el('tspan');
          span.textContent = c;
          return span;
        }),
      );
    }
    // a letter added is struck: it, and the tag with it
    if (name.length > was.length && name.startsWith(was)) {
      const k = name.length - 1;
      for (const t of [nameLine.lit, nameLine.ink]) (t.childNodes[k] as SVGTSpanElement | undefined)?.classList.add('dt-strike');
      host.classList.remove('struck');
      void host.offsetWidth;
      host.classList.add('struck');
    }
    was = name;
  };
  stamp(input.value);
  input.addEventListener('input', () => stamp(input.value));
  host.addEventListener('click', () => input.focus());
  // the light on the steel follows the pointer across it, and the tag leans to it a little
  host.addEventListener('pointermove', (e) => {
    const b = host.getBoundingClientRect();
    const u = (e.clientX - b.left) / Math.max(1, b.width), v = (e.clientY - b.top) / Math.max(1, b.height);
    sheen.style.transform = `translateX(${(u * 300).toFixed(0)}px) skewX(-18deg)`;
    host.style.setProperty('--tilt-x', `${((0.5 - v) * 10).toFixed(1)}deg`);
    host.style.setProperty('--tilt-y', `${((u - 0.5) * 14).toFixed(1)}deg`);
  });
  host.addEventListener('pointerleave', () => {
    sheen.style.transform = '';
    host.style.removeProperty('--tilt-x');
    host.style.removeProperty('--tilt-y');
  });
  return { stamp };
}
