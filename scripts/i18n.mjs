// The game's words in other languages (2026-10-30): what the code says that a catalog in src/i18n/lang/ does not yet.
//   node scripts/i18n.mjs check                 how much of each feature each language has
//   node scripts/i18n.mjs list <feature> <file> writes the feature's English, one line each, for what is missing in any language
//   node scripts/i18n.mjs merge <lang> <english file> <translated file>   line N of the one is line N of the other
//   node scripts/i18n.mjs rows <file> [es,pt,...]  a table by hand: English|es|pt|ru|de|fr|tr|zh
//   node scripts/i18n.mjs fill [lang]           asks the same model as the chat for what is missing (TRANSLATE_API_KEY)
// A catalog is English -> theirs, nothing else. A template's ${...} is {0}, {1}, ... in the order they stand: what src/i18n/index.ts
// matches a line the game wrote against. To add a string by hand: add its line to each lang/*.json; no code changes.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LANG_DIR = 'src/i18n/lang';
/** where a feature's words are, by the start of the path */
const FEATURES = {
  items: ['src/sim/items', 'src/sim/items.ts'],
  hud: ['src/ui/hud.ts', 'src/ui/status', 'src/ui/keys-view', 'src/ui/radial', 'src/ui/touch', 'src/ui/emotes-menu', 'src/ui/wheel-slots', 'src/ui/pad-binds', 'src/ui/rotate', 'src/ui/elite-crown', 'src/game/key-hints', 'src/game/building/wheel', 'src/core/keys', 'src/core/gamepad', 'src/core/settings', 'src/sim/survivor', 'src/sim/emotes', 'src/sim/calls'],
  inventory: ['src/ui/inv', 'src/ui/act-icons', 'src/ui/kind-icons', 'src/ui/craft-card', 'src/ui/crafting-ui', 'src/ui/shop', 'src/ui/keypad', 'src/sim/craft', 'src/sim/build', 'src/sim/inv', 'src/sim/camp'],
  menus: ['src/ui/door', 'src/ui/arena', 'src/ui/br', 'src/ui/report', 'src/ui/person', 'src/ui/spawn-map', 'src/ui/loading-screen', 'src/ui/platform', 'src/ui/who', 'src/ui/updates', 'src/ui/discord', 'src/ui/howto-more', 'src/ui/store', 'src/ui/bigmap', 'src/ui/minimap', 'src/ui/bookmark'],
  game: ['src/game'],
  server: ['server'],
};
/** never: read by those with a role, or no one's interface */
const NEVER = ['src/ui/admin', 'src/ui/guide', 'src/ui/rewards', 'src/net/orders', 'server/admin', 'server/keep', 'server/index', 'server/walls', 'server/stash-guard', 'server/solid', 'server/store-admin', 'src/game/menu-scenes', 'src/game/br/cut'];

const walk = (p, out = []) => {
  if (!existsSync(p)) return out;
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(`${p}/${f}`, out);
  else if (/\.ts$/.test(p)) out.push(p);
  return out;
};
const allTs = [...walk('src/ui'), ...walk('src/game'), ...walk('src/sim'), ...walk('src/core'), ...walk('server')];

/** Every string and whole template in a file, with `${...}` as {n} and what stands just before it. */
export function literals(src) {
  const out = [];
  let i = 0;
  const before = (at) => src.slice(Math.max(0, at - 30), at);
  const quoted = (q) => {
    const at = i;
    let s = '';
    i++;
    while (i < src.length && src[i] !== q && src[i] !== '\n') {
      if (src[i] === '\\') { s += src[i + 1] === 'n' ? ' ' : src[i + 1]; i += 2; } else s += src[i++];
    }
    i++;
    out.push({ text: s, ctx: before(at) });
  };
  /** at the character after a backtick */
  const template = () => {
    const at = i - 1;
    let s = '', n = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { s += src[i + 1]; i += 2; } else if (c === '`') { i++; break; } else if (c === '$' && src[i + 1] === '{') {
        i += 2;
        s += `{${n++}}`;
        code(true);
      } else { s += c; i++; }
    }
    out.push({ text: s, ctx: before(at) });
  };
  /** code, up to the `}` that ends a template's `${` */
  const code = (inner) => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { i = src.indexOf('*/', i) + 2; continue; }
      if (c === "'" || c === '"') { quoted(c); continue; }
      if (c === '`') { i++; template(); continue; }
      if (inner) {
        if (c === '{') depth++;
        else if (c === '}') { if (!depth) { i++; return; } depth--; }
      }
      i++;
    }
  };
  code(false);
  return out;
}

const SKIP_CTX = /(querySelector(All)?|closest|classList\.\w+|addEventListener|removeEventListener|createElement(NS)?|getElementById|setAttribute|getAttribute|import|require|matches|localStorage\.\w+|console\.\w+|log|assert\.\w+|Error|setProperty|style\.\w+|dataset\.\w+|className|\bt|\bkind|\bid|\bmodel|\bicon|\bsound|\bcase|[!=]==?)\s*[(:=]?\s*\(?$/;
const entities = (s) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, '—').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** a line's text between its tags; each is a text node of its own on the page */
function pieces(text) {
  return text.split(/<[^>]*>/).map((p) => {
    let n = 0;
    const map = new Map();
    return entities(p).replace(/\{(\d+)\}/g, (_, k) => { if (!map.has(k)) map.set(k, n++); return `{${map.get(k)}}`; }).replace(/\s+/g, ' ').trim();
  });
}
function english(p) {
  if (p.length < 2 || p.length > 400) return false;
  if (!/[a-z]{2}/.test(p) && !/^[A-Z]{3,}( [A-Z]+)*$/.test(p)) return false;
  if (/[{;]\s|[a-z-]+:\s*[^ ]+;|px\b|rgba?\(|var\(--|^[.#/]|^https?:|\.(png|jpe?g|ktx2|glb|json|webp|ogg|mp3|css|html)\b|=>|\bfunction\b|\$\{/.test(p.replace(/\{\d+\}/g, ''))) return false;
  const bare = p.replace(/\{\d+\}/g, '').trim();
  if (!/[A-Za-z]{2}/.test(bare)) return false;
  if (/^[A-Z][a-z]+[A-Z]/.test(bare) || /^[a-z]+[A-Z_]/.test(bare) || /^[a-z0-9_-]+$/.test(bare)) return false;
  if (/^[a-z0-9_-]+( [a-z0-9_-]+)*$/.test(bare) && !/\b(the|to|of|a|an|is|in|on|you|your|it|no|not|and|with|at|for|this|that|from)\b/.test(bare)) return false;
  return true;
}
function featureOf(f) {
  if (NEVER.some((n) => f.startsWith(n))) return null;
  for (const [k, ps] of Object.entries(FEATURES)) if (ps.some((p) => f.startsWith(p))) return k;
  return null;
}
function words() {
  const by = {};
  for (const k of Object.keys(FEATURES)) by[k] = new Set();
  for (const f of allTs) {
    const k = featureOf(f);
    if (!k) continue;
    for (const { text, ctx } of literals(readFileSync(f, 'utf8'))) {
      if (SKIP_CTX.test(ctx)) continue;
      for (const p of pieces(text)) if (english(p)) by[k].add(p);
    }
  }
  return by;
}
const catalogs = () => (existsSync(LANG_DIR) ? readdirSync(LANG_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []);
const load = (l) => (existsSync(`${LANG_DIR}/${l}.json`) ? JSON.parse(readFileSync(`${LANG_DIR}/${l}.json`, 'utf8')) : {});
const save = (l, d) => writeFileSync(`${LANG_DIR}/${l}.json`, `${JSON.stringify(Object.fromEntries(Object.entries(d).sort(([a], [b]) => a.localeCompare(b))), null, 0).replace(/","/g, '",\n"')}\n`);

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'check') {
  const by = words(), langs = catalogs();
  console.log(['feature', 'strings', ...langs].join('\t'));
  for (const [k, set] of Object.entries(by)) console.log([k, set.size, ...langs.map((l) => { const d = load(l); return [...set].filter((s) => d[s] !== undefined).length; })].join('\t'));
  console.log(['catalog', '', ...langs.map((l) => Object.keys(load(l)).length)].join('\t'));
} else if (cmd === 'list') {
  const set = words()[a];
  if (!set) throw new Error(`no feature ${a}: ${Object.keys(FEATURES).join(', ')}`);
  const have = catalogs().map(load);
  const want = [...set].filter((s) => !have.length || have.some((d) => d[s] === undefined)).sort((x, y) => x.length - y.length || x.localeCompare(y));
  writeFileSync(b, `${want.join('\n')}\n`);
  console.log(`${want.length} lines, ${want.join('').length} characters, in ${b}`);
} else if (cmd === 'merge') {
  const en = readFileSync(b, 'utf8').replace(/\r/g, '').split('\n'), to = readFileSync(c, 'utf8').replace(/\r/g, '').split('\n');
  while (en.at(-1) === '') en.pop();
  while (to.at(-1) === '') to.pop();
  if (en.length !== to.length) throw new Error(`${en.length} lines of English, ${to.length} of ${a}`);
  const d = load(a);
  let bad = 0;
  en.forEach((s, i) => {
    const holes = (x) => (x.match(/\{\d+\}/g) ?? []).sort().join();
    if (holes(s) !== holes(to[i])) { console.log(`line ${i + 1}: holes differ: ${s} -> ${to[i]}`); bad++; return; }
    if (to[i].trim() && to[i] !== s) d[s] = to[i].trim();
  });
  save(a, d);
  console.log(`${a}: ${Object.keys(d).length} entries, ${bad} lines left out`);
} else if (cmd === 'rows') {
  // a table written by hand: English|es|pt|ru|de|fr|tr|zh, one string a line
  const order = (b ?? 'es,pt,ru,de,fr,tr,zh').split(','), dicts = Object.fromEntries(order.map((l) => [l, load(l)]));
  const holes = (x) => (x.match(/\{\d+\}/g) ?? []).sort().join();
  let n = 0, bad = 0;
  for (const line of readFileSync(a, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean)) {
    const [en, ...to] = line.split('|');
    if (to.length !== order.length) { console.log(`${to.length} columns: ${en}`); bad++; continue; }
    to.forEach((x, i) => {
      if (holes(x) !== holes(en)) { console.log(`holes differ (${order[i]}): ${en} -> ${x}`); bad++; } else if (x.trim()) dicts[order[i]][en] = x.trim();
    });
    n++;
  }
  for (const l of order) save(l, dicts[l]);
  console.log(`${a}: ${n} rows, ${bad} left out`);
} else if (cmd === 'fill') {
  const key = process.env.TRANSLATE_API_KEY;
  if (!key) throw new Error('no TRANSLATE_API_KEY');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const ai = new Anthropic({ apiKey: key, maxRetries: 2 });
  const all = Object.values(words()).flatMap((s) => [...s]);
  for (const l of a ? [a] : catalogs()) {
    const d = load(l), todo = [...new Set(all)].filter((s) => d[s] === undefined);
    for (let i = 0; i < todo.length; i += 60) {
      const part = todo.slice(i, i + 60);
      const r = await ai.messages.create({
        model: process.env.TRANSLATE_MODEL ?? 'claude-haiku-5-5',
        max_tokens: 8000,
        thinking: { type: 'disabled' },
        system: `Translate the interface text of ZONA, a DayZ-style survival shooter, from English into the language with code ${l}. Reply with a JSON array of strings, one for each input string, in order, and nothing else. Keep {0}, {1} and so on exactly as they are. Keep place names, gun names and key names. Short and plain, as a game's interface is.`,
        messages: [{ role: 'user', content: JSON.stringify(part) }],
      });
      const said = r.content.find((p) => p.type === 'text')?.text ?? '[]';
      const list = JSON.parse(said.slice(said.indexOf('['), said.lastIndexOf(']') + 1));
      part.forEach((s, k) => { if (typeof list[k] === 'string' && list[k]) d[s] = list[k]; });
      save(l, d);
      console.log(`${l}: ${Math.min(i + 60, todo.length)} of ${todo.length}`);
    }
  }
} else console.log('check | list <feature> <file> | merge <lang> <english> <translated> | fill [lang]');
