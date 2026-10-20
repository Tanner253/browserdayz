// The mark and the season's pieces in the site's top bars (the door, /changelog, /payouts). The owner, 2026-10-20:
// "can we update the icon in the navbar on the home page of our site and payouts etc... to be the animated one? with
// the pumpkins beside it. i think itll look nice. when seasons change we will replace the pumpkins with other things".
// Two pictures every page shows with a plain <img>, so the static changelog and the payouts page the API writes need
// no script of their own:
//
//   public/brand/zona-mark-live.svg   the loading screen's mark (its parts read out of index.html): its horns unfurl
//                                     once, then it breathes its glow, puffs gas and lashes now and then
//   public/brand/season.svg           the season's pieces side by side, standing on one line: SEASON below
//
//   node scripts/live-mark.mjs
//
// Each animates inside itself (CSS in the SVG): small, a few soft shapes, and still for anyone who asks for less motion.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const BRAND = path.join(ROOT, 'public', 'brand');

// ------------------------------------------------------------------ the season: THE one switch
/** each set: its pieces left to right, a picture each (public/brand), how tall it stands (of the tallest's 64), and
 * a lit picture to flicker over it if it has a light in it */
const SETS = {
  // (scripts/halloween-sprites.mjs: a jack-o'-lantern and a pumpkin, from a real model)
  halloween: [
    { src: 'halloween-lantern.webp', lit: 'halloween-lantern-lit.webp', h: 64 },
    { src: 'halloween-pumpkin.webp', h: 40 },
  ],
};
/** the set the bars show now; null for none */
const SEASON = 'halloween';

// ------------------------------------------------------------------ the mark
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const defs = /<defs>[\s\S]*?<\/defs>/.exec(html)?.[0];
const horns = [0, 1, 2].map((k) => new RegExp(`<g id="lm-g${k}"[^>]*>(?:(?!</g>)[\\s\\S])*</g>`).exec(html)?.[0]);
const mask = /<g transform="translate\(256 252\) scale\(0\.95\)"[\s\S]*?\n\s*<\/g>/.exec(html)?.[0];
if (!defs || horns.some((h) => !h) || !mask) throw new Error('the mark is not where it was in index.html');
const squeeze = (s) => s.replace(/\n\s*/g, '');

const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><title>ZONA</title>
<style>
.glow,.h,.hot{transform-origin:256px 264px}
.glow{animation:glow 4s ease-in-out infinite}
.h{animation:lash 12s 2s infinite,grow 1.4s backwards}
.h1{animation-delay:2.06s,.1s}.h2{animation-delay:2.12s,.2s}
.hot{opacity:0;animation:hot 4s ease-in-out 4s infinite}
.puff{opacity:0;transform-box:fill-box;transform-origin:center;animation:puffl 8s ease-out infinite}
.p2{animation-delay:.2s}.p3{animation-name:puffr;animation-delay:4s}.p4{animation-name:puffr;animation-delay:4.2s}
@keyframes glow{0%,100%{opacity:.35;transform:scale(.9)}50%{opacity:1;transform:scale(1.06)}}
@keyframes hot{0%,100%{opacity:0}50%{opacity:.6}}
@keyframes grow{0%{transform:rotate(-160deg) scale(0);opacity:0;animation-timing-function:cubic-bezier(.2,.75,.35,1)}15%{opacity:1}55%{transform:rotate(14deg) scale(1.13);animation-timing-function:ease-in-out}78%{transform:rotate(-4deg) scale(.96)}100%{transform:none;opacity:1}}
@keyframes lash{0%,90%{transform:none}93%{transform:rotate(-14deg) scale(.88)}96%{transform:rotate(7deg) scale(1.07)}98.5%{transform:rotate(-2deg) scale(.99)}100%{transform:none}}
@keyframes puffl{0%{opacity:0;transform:translate(0,0) scale(.4)}4%{opacity:.85}30%{opacity:.4;transform:translate(-70px,-60px) scale(1.4)}50%,100%{opacity:0;transform:translate(-110px,-150px) scale(2)}}
@keyframes puffr{0%{opacity:0;transform:translate(0,0) scale(.4)}4%{opacity:.85}30%{opacity:.4;transform:translate(70px,-60px) scale(1.4)}50%,100%{opacity:0;transform:translate(110px,-150px) scale(2)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.hot,.puff{opacity:0}}
</style>
${squeeze(defs).replace('<defs>', '<defs><radialGradient id="lm-glow"><stop offset="0" stop-color="#ffd35a" stop-opacity=".38"/><stop offset=".36" stop-color="#ffbe3c" stop-opacity=".14"/><stop offset=".66" stop-color="#ffbe3c" stop-opacity="0"/></radialGradient><radialGradient id="lm-gas"><stop offset="0" stop-color="#b2ec62" stop-opacity=".8"/><stop offset=".45" stop-color="#80ce48" stop-opacity=".35"/><stop offset="1" stop-color="#60aa36" stop-opacity="0"/></radialGradient>')}
<circle class="glow" cx="256" cy="264" r="256" fill="url(#lm-glow)"/>
<g color="#ffd35a">${horns.map((h, k) => `<g class="h h${k}">${squeeze(h)}</g>`).join('')}</g>
<g class="hot" color="#ffe9a6"><use href="#lm-g0"/><use href="#lm-g1"/><use href="#lm-g2"/></g>
${squeeze(mask)}
${[1, 2, 3, 4].map((k) => `<circle class="puff p${k}" cx="256" cy="364" r="${k % 2 ? 46 : 36}" fill="url(#lm-gas)"/>`).join('')}
</svg>
`;
fs.writeFileSync(path.join(BRAND, 'zona-mark-live.svg'), mark);
console.log(`public/brand/zona-mark-live.svg ${(mark.length / 1024).toFixed(1)} KB`);

// ------------------------------------------------------------------ the season's pieces
const set = SEASON ? SETS[SEASON] : null;
let season = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"/>\n';
if (set) {
  const H = 64, LAP = 6, pics = [];
  let x = 0;
  for (const [k, p] of set.entries()) {
    const pic = async (file) => {
      const b = await sharp(path.join(BRAND, file)).resize({ height: p.h }).webp({ quality: 88, alphaQuality: 90 }).toBuffer();
      const m = await sharp(b).metadata();
      return { uri: `data:image/webp;base64,${b.toString('base64')}`, w: (m.width / m.height) * p.h };
    };
    const a = await pic(p.src), lit = p.lit ? await pic(p.lit) : null;
    const at = `x="${x.toFixed(1)}" y="${H - p.h}" width="${a.w.toFixed(1)}" height="${p.h}"`;
    // (a light in it flickers; each piece sways a little on its foot, out of step with the others)
    pics.push(`<g class="sway s${k}" style="transform-origin:${(x + a.w / 2).toFixed(1)}px ${H}px"><image href="${a.uri}" ${at}/>${lit ? `<image class="lit" href="${lit.uri}" ${at}/>` : ''}</g>`);
    x += a.w - LAP;
  }
  const W = x + LAP;
  season = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H}" width="${W.toFixed(1)}" height="${H}"><title>${SEASON}</title>
<style>
.lit{animation:flicker 2.3s linear infinite}
.sway{animation:sway 3.4s ease-in-out infinite}.s1{animation-duration:4.1s;animation-delay:-1.3s}.s2{animation-duration:3.7s;animation-delay:-2.2s}
@keyframes flicker{0%{opacity:.85}8%{opacity:.55}14%{opacity:.95}22%{opacity:.7}30%{opacity:1}39%{opacity:.72}47%{opacity:.92}56%{opacity:.6}64%{opacity:.97}73%{opacity:.78}82%{opacity:1}91%{opacity:.66}100%{opacity:.85}}
@keyframes sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.lit{opacity:.85}}
</style>
${pics.join('\n')}
</svg>
`;
}
fs.writeFileSync(path.join(BRAND, 'season.svg'), season);
console.log(`public/brand/season.svg (${SEASON ?? 'none'}) ${(season.length / 1024).toFixed(1)} KB`);
