/// <reference types="vite/client" />
// The game's words in the player's language (2026-10-30, the owner: "we need to have language support people really
// complain about not being able to change the laguage for the game"). Everything the game shows ends up as text on the
// page, so the page is where it is put into their language: a catalog of English -> theirs (./lang/*.json) and a watch
// over the page, not a call at each of the game's thousands of strings. So a new string needs one line per catalog and
// no code; a language changes at once, in a fight too, with nothing reloaded; and an English player has no watch at all
// and not a byte of this runs for them. What the server says in English (a 'tell') is met here like the rest. A template
// in a catalog holds {0}, {1}: the parts that change. `node scripts/i18n.mjs check` says what is still missing.
// What a player typed is never touched: it stands under `data-raw`.
import { LANGS, langOf, type Lang } from '../sim/langs';

const KEPT = 'zona-lang';
const ATTRS = ['title', 'placeholder', 'aria-label'];
type Shape = { re: RegExp; to: string };

export let lang: Lang = 'en';
const exact = new Map<string, string>();
const capitals = new Map<string, string>();
const shapes = new Map<string, Shape[]>();
const loose: Shape[] = [];
const memo = new Map<string, string>();
/** what a text node or attribute held before it was put into another language, and what it was given */
const shown = new WeakMap<Node, [string, string]>();
const shownAttr = new WeakMap<Element, Record<string, [string, string]>>();
const told = new Set<(l: Lang) => void>();

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function shapeOf(from: string, to: string) {
  const parts = from.split(/\{\d+\}/);
  const shape = { re: new RegExp(`^${parts.map(escaped).join('(.+?)')}$`, 's'), to };
  if (parts[0].length >= 3) {
    const k = parts[0].slice(0, 3);
    if (shapes.has(k)) shapes.get(k)!.push(shape);
    else shapes.set(k, [shape]);
  } else loose.push(shape);
}
function shaped(core: string): string | undefined {
  for (const list of [shapes.get(core.slice(0, 3)), loose]) {
    for (const s of list ?? []) {
      const m = s.re.exec(core);
      // (a part of a line may be a string of its own, an item's name: with what stands round it kept)
      if (m) return s.to.replace(/\{(\d+)\}/g, (_, i) => render(m[Number(i) + 1] ?? ''));
    }
  }
  return undefined;
}
function render(text: string): string {
  const start = text.length - text.trimStart().length, core = text.trim();
  let hit = exact.get(core);
  if (hit === undefined && core === core.toUpperCase()) hit = capitals.get(core.toLowerCase())?.toLocaleUpperCase(lang);
  hit ??= shaped(core);
  return hit === undefined ? text : text.slice(0, start) + hit + text.slice(start + core.length);
}
/** Text in the player's language: what is not in the catalog stays as it is. */
export function tr(text: string): string {
  if (lang === 'en' || !/\p{L}/u.test(text)) return text;
  let out = memo.get(text);
  if (out === undefined) {
    if (memo.size > 40000) memo.clear();
    memo.set(text, (out = render(text)));
  }
  return out;
}
/** A string of the code's own, for what never reaches the page's text (a canvas): `t('{0} left', n)`. */
export const t = (text: string, ...parts: (string | number)[]) => tr(text).replace(/\{(\d+)\}/g, (_, i) => String(parts[Number(i)] ?? ''));

const held = (n: Node) => !n.parentElement || n.parentElement.closest('[data-raw],script,style,textarea') !== null;
function textNode(n: Text) {
  const v = n.nodeValue ?? '', was = shown.get(n);
  const source = was && was[1] === v ? was[0] : v, out = tr(source);
  if (out === v || held(n)) return;
  shown.set(n, [source, out]);
  n.nodeValue = out;
}
function attribute(e: Element, a: string) {
  const v = e.getAttribute(a);
  if (v === null) return;
  const all = shownAttr.get(e), was = all?.[a];
  const source = was && was[1] === v ? was[0] : v, out = tr(source);
  if (out === v) return;
  if (all) all[a] = [source, out];
  else shownAttr.set(e, { [a]: [source, out] });
  e.setAttribute(a, out);
}
function walk(root: Node) {
  if (root.nodeType === 3) return textNode(root as Text);
  if (root.nodeType !== 1) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n: Node | null = root; n; n = w.nextNode()) {
    if (n.nodeType === 3) textNode(n as Text);
    else for (const a of ATTRS) if ((n as Element).hasAttribute(a)) attribute(n as Element, a);
  }
}
const watch = typeof MutationObserver === 'undefined' ? null : new MutationObserver((list) => {
  for (const m of list) {
    if (m.type === 'characterData') textNode(m.target as Text);
    else if (m.type === 'attributes') attribute(m.target as Element, m.attributeName!);
    else for (const n of m.addedNodes) walk(n);
  }
});

function chosen(): Lang {
  try {
    const asked = new URLSearchParams(location.search).get('lang') ?? localStorage.getItem(KEPT);
    if (asked) return langOf(asked);
  } catch {
    /* no storage: the browser's language, for this visit */
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const two = l.slice(0, 2).toLowerCase();
    if (LANGS.some(([c]) => c === two)) return two as Lang;
  }
  return 'en';
}
async function use(l: Lang) {
  const dict: Record<string, string> = l === 'en' ? {} : (await import.meta.glob<{ default: Record<string, string> }>('./lang/*.json')[`./lang/${l}.json`]()).default;
  lang = l;
  for (const m of [exact, capitals, shapes, memo]) m.clear();
  loose.length = 0;
  for (const [from, to] of Object.entries(dict).sort(([a], [b]) => b.length - a.length)) {
    exact.set(from, to);
    capitals.set(from.toLowerCase(), to);
    if (from.includes('{')) shapeOf(from, to);
  }
  const page = document.documentElement;
  page.lang = l;
  // (what a stylesheet says itself, under the two things dragged in the inventory)
  for (const [name, text] of [['--say-in-hands', 'in hands'], ['--say-empty-hands', 'Empty: drag a thing here'], ['--say-drop-here', 'Drop here']]) page.style.setProperty(name, JSON.stringify(tr(text)));
  watch?.disconnect();
  walk(page);
  if (l !== 'en') watch?.observe(page, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
/** Before anything is built: the page's language, from what they chose or from their browser. A catalog that will not load is English. */
export async function startLang() {
  const l = chosen();
  if (l === 'en') return;
  await Promise.race([use(l), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
}
/** Their choice, kept in this browser and made at once. */
export async function setLang(l: Lang) {
  try {
    localStorage.setItem(KEPT, l);
  } catch {
    /* kept for this visit only */
  }
  await use(l);
  for (const f of told) f(l);
}
/** told when the language changes (the server, so that chat follows) */
export const onLang = (f: (l: Lang) => void) => void told.add(f);
