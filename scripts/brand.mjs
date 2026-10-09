// The mark: a gas mask over the biohazard sign. Drawn here, as a vector, and written out as
// the files the site and the socials use.
//
//   node scripts/brand.mjs
//
//   public/brand/zona-mark.svg        the badge (dark round, the sign in yellow, the mask over it): the site's icon
//   public/brand/zona-mark-plain.svg  the same without the round behind it, for laying over the game's own dark panels
//   public/brand/icon-{32,180,512}.png
//   marketing/zona-logo.png (1024), zona-logo-400x400.jpg, zona-logo-500x500.jpg (profile pictures)
//
// The sign is the real one, built the way its makers laid it down (units of A: three rounds
// of 30 across, their middles 11 out; a round of 21 across cut from each, its middle 15 out;
// a hole of 6 in the middle; slits of 1; the horns parted by 4 at their tips; and a ring 3.5
// wide, seen only in the three mouths).

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const YELLOW = '#ffd35a', DARK = '#0d100c', BONE = '#ece6d6', SHADE = '#b9b2a0', GLASS = '#141a15';

/** the sign, its middle at (0, 0), one horn up; `k` is how many units of the picture one of its own is */
function sign(k, id) {
  const at = (deg, d) => [Math.cos((deg * Math.PI) / 180) * d * k, Math.sin((deg * Math.PI) / 180) * d * k];
  const horns = [-90, 30, 150];
  const round = (deg, d, r, extra = '') => { const [x, y] = at(deg, d); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(r * k).toFixed(2)}" ${extra}/>`; };
  return `
  <defs>
    <mask id="${id}-cut" maskUnits="userSpaceOnUse" x="${-40 * k}" y="${-40 * k}" width="${80 * k}" height="${80 * k}">
      <rect x="${-40 * k}" y="${-40 * k}" width="${80 * k}" height="${80 * k}" fill="#fff"/>
      ${horns.map((a) => round(a, 15, 10.5, 'fill="#000"')).join('')}
      <circle r="${3 * k}" fill="#000"/>
      ${horns.map((a) => `<rect x="0" y="${-0.5 * k}" width="${5.2 * k}" height="${k}" fill="#000" transform="rotate(${a})"/>`).join('')}
      ${horns.map((a) => `<rect x="${20 * k}" y="${-2 * k}" width="${8 * k}" height="${4 * k}" fill="#000" transform="rotate(${a})"/>`).join('')}
    </mask>
    <clipPath id="${id}-mouths">${horns.map((a) => round(a, 15, 9.5)).join('')}</clipPath>
  </defs>
  <g fill="${YELLOW}">
    <g mask="url(#${id}-cut)">${horns.map((a) => round(a, 11, 15)).join('')}</g>
    <circle r="${11.75 * k}" fill="none" stroke="${YELLOW}" stroke-width="${3.5 * k}" clip-path="url(#${id}-mouths)"/>
  </g>`;
}

/** the mask, seen from in front, its eyepieces a little above (0, 0) */
function mask() {
  const hood = 'M0-134C64-134 106-93 106-37C106 6 93 41 71 67C57 84 46 97 42 112L-42 112C-46 97-57 84-71 67C-93 41-106 6-106-37C-106-93-64-134 0-134Z';
  const eye = (x) => `
    <circle cx="${x}" cy="-38" r="39" fill="${DARK}"/>
    <circle cx="${x}" cy="-38" r="31" fill="${SHADE}"/>
    <circle cx="${x}" cy="-38" r="25" fill="${GLASS}"/>
    <path d="M${x - 15}-49A19 19 0 0 1 ${x + 4}-57" fill="none" stroke="${BONE}" stroke-width="5" stroke-linecap="round" opacity="0.55"/>`;
  return `
  <g stroke-linejoin="round">
    <path d="${hood}" fill="${BONE}" stroke="${DARK}" stroke-width="9"/>
    <!-- the side of it away from the light -->
    <path d="M0-134C64-134 106-93 106-37C106 6 93 41 71 67C57 84 46 97 42 112L10 112C22 60 40 20 40-37C40-90 24-124 0-134Z" fill="${SHADE}" opacity="0.5"/>
    <!-- the seam over the brow, and the folds from the eyes down to the can -->
    <path d="M-70-104C-36-88 36-88 70-104" fill="none" stroke="${DARK}" stroke-width="5" stroke-linecap="round" opacity="0.55"/>
    <path d="M-62 4C-52 40-36 66-30 92M62 4C52 40 36 66 30 92" fill="none" stroke="${DARK}" stroke-width="5" stroke-linecap="round" opacity="0.5"/>
    ${eye(-49)}${eye(49)}
    <!-- the filter can, and what it screws into -->
    <path d="M-40 66C-22 78 22 78 40 66L46 104H-46Z" fill="${SHADE}" stroke="${DARK}" stroke-width="6"/>
    <circle cy="118" r="52" fill="${DARK}"/>
    <circle cy="118" r="44" fill="${BONE}"/>
    <circle cy="118" r="33" fill="${GLASS}"/>
    <circle cy="118" r="20" fill="none" stroke="${SHADE}" stroke-width="6"/>
    <path d="M-33 118H33M0 85V151" stroke="${SHADE}" stroke-width="6" stroke-linecap="round"/>
    <circle cy="118" r="6" fill="${BONE}"/>
  </g>`;
}

/** the whole mark, 512 across */
const mark = (badge) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>ZONA</title>
  ${badge ? `<circle cx="256" cy="256" r="252" fill="${DARK}"/><circle cx="256" cy="256" r="240" fill="none" stroke="${YELLOW}" stroke-width="5" opacity="0.9"/>` : ''}
  <g transform="translate(256 264)">${sign(8.4, badge ? 'b' : 'p')}</g>
  <g transform="translate(256 252) scale(0.95)">${mask()}</g>
</svg>
`;

const brand = path.join(ROOT, 'public', 'brand'), marketing = path.join(ROOT, 'marketing');
fs.mkdirSync(brand, { recursive: true });
fs.mkdirSync(marketing, { recursive: true });
fs.writeFileSync(path.join(brand, 'zona-mark.svg'), mark(true));
fs.writeFileSync(path.join(brand, 'zona-mark-plain.svg'), mark(false));
const svg = Buffer.from(mark(true));
for (const size of [32, 180, 512]) await sharp(svg, { density: (72 * size * 2) / 512 }).resize(size, size).png().toFile(path.join(brand, `icon-${size}.png`));
// a profile picture is shown in a round: the badge on a square of its own dark, with room round it
const square = async (size) => sharp({ create: { width: size, height: size, channels: 3, background: DARK } }).composite([{ input: await sharp(svg, { density: (72 * size * 2) / 512 }).resize(Math.round(size * 0.92), Math.round(size * 0.92)).png().toBuffer() }]);
await (await square(1024)).png().toFile(path.join(marketing, 'zona-logo.png'));
for (const size of [400, 500]) await (await square(size)).jpeg({ quality: 94 }).toFile(path.join(marketing, `zona-logo-${size}x${size}.jpg`));
console.log('written: public/brand/zona-mark.svg, zona-mark-plain.svg, icon-32/180/512.png; marketing/zona-logo.png, -400x400.jpg, -500x500.jpg');
