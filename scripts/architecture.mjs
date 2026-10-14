// node scripts/architecture.mjs: writes ARCHITECTURE.md, the map of the code (2026-10-14). Every TypeScript file of
// the game, the server and the site's functions, folder by folder: its size and the first sentence of its own header
// comment. Made from the files themselves so that it is never out of date: run it again after adding or moving a file.
// Why: a new chat or agent finds where a thing lives here instead of searching the tree for it (the owner, watching
// the weekly token limit: "maintainability for faster development").
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DIRS = ['src', 'server', 'api'];
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(p.split(path.sep).join('/'));
  }
};
for (const d of DIRS) walk(d);
files.sort();

/** the first sentence of the file's header comment (the comment lines before its first line of code), or '' */
function about(text) {
  const lines = text.split(/\r?\n/), said = [];
  for (const l of lines) {
    const m = /^\s*(?:\/\/|\/\*\*?|\*)\s?(.*?)\s*(?:\*\/)?$/.exec(l);
    if (!m || /^\s*(import|export|const|let|function|class|interface|type)\b/.test(l)) break;
    if (m[1] === '' && said.length) break;
    if (m[1]) said.push(m[1]);
  }
  const all = said.join(' ').replace(/\s+/g, ' ').trim();
  // (up to the end of its first sentence, or a colon that opens a list; never more than 220 characters)
  const end = all.search(/[.!?](\s|$)|: [A-Z(`"]/);
  let s = end > 20 ? all.slice(0, end + 1) : all;
  if (s.length > 220) s = s.slice(0, 217).replace(/\s+\S*$/, '') + '...';
  return s.replace(/\|/g, '/');
}

const out = [
  '# ZONA: where the code is',
  '',
  'Made by `node scripts/architecture.mjs` from the files themselves (size, and the first sentence of each file\'s header',
  'comment): run it again after adding, moving or splitting a file. Read `CLAUDE.md` first. Five giant files were cut into',
  'folders on 2026-10-14 (`src/game/game/`, `src/world/worldgen/`, `src/sim/castle/`, `src/world/castle-shape/`, and',
  '`server/` beside `index.ts`): the old file is still there and still exports everything it did, so import from it.',
  '',
];
let dir = '';
for (const f of files) {
  const d = path.dirname(f);
  if (d !== dir) {
    out.push('', `## ${d}/`, '', '| file | lines | what it is |', '|---|---:|---|');
    dir = d;
  }
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  out.push(`| \`${path.basename(f)}\` | ${text.split('\n').length} | ${about(text)} |`);
}
fs.writeFileSync(path.join(ROOT, 'ARCHITECTURE.md'), out.join('\n') + '\n');
console.log(`ARCHITECTURE.md: ${files.length} files in ${new Set(files.map((f) => path.dirname(f))).size} folders`);
