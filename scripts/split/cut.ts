// npx tsx scripts/split/cut.ts <plan.json> [--write]: CUTS ONE GIANT FILE INTO MODULES WITHOUT CHANGING A LINE OF IT (2026-10-14).
// The owner asked for the giant files split so work goes fast again, with no change of behaviour. Moving code by hand
// across thousands of lines is where a slip hides, so this does it with the compiler: every top-level statement of
// the file (with the comments above it) goes, whole and in its own order, to the module the plan names by line; each
// module is given exactly the imports its code uses (found by the type checker, not by name); a declaration another
// module now needs is exported; and the file itself is left as the module the plan calls "" plus re-exports of
// everything it exported, so no other file has to change. Without --write it only reports: the modules, their
// sizes, which import which, and every place one module's top level reads another's at load time (an order hazard).
//
// plan.json: { "file": "src/world/castle-shape.ts", "dir": "src/world/castle-shape", "tsconfig": "tsconfig.json",
//   "modules": [{ "name": "base", "about": "one line said at the module's head", "from": 1, "to": 340 }, ...] }
// A statement belongs to the module whose [from, to] holds the line it starts on (its own first line, not its comment's).
// Lines no module holds stay in the file ("" module).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
// (the project's own TypeScript is 7, the native one, which has no compiler to call from a script: the 5.9 that came with the Vercel tool is used to read the code, and the project's own still checks it. TS_JS names another.)
const ts = createRequire(import.meta.url)(process.env.TS_JS ?? 'C:/Users/perci/AppData/Roaming/npm/node_modules/vercel/node_modules/typescript') as typeof import('typescript');

interface Mod { name: string; about?: string; from: number; to: number }
interface Plan {
  file: string; dir: string; tsconfig?: string; modules: Mod[];
  /** a statement that does something as the file loads (a call, a loop, a timer set) stays in the file, in its own order (the server) */
  keepActing?: boolean;
  /** false: the file is nobody's import (the server's entry), and says nothing again of what it gave out */
  reexport?: boolean;
  /** names that stay in the file whatever their line (a let that the file's own start-up assigns) */
  keep?: string[];
  /** names put in a module other than their line says: { name: module } (a let goes where it is assigned) */
  place?: Record<string, string>;
}
const plan = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Plan;
const write = process.argv.includes('--write');
const root = process.cwd();
const fileAbs = path.resolve(root, plan.file);
const cfg = ts.getParsedCommandLineOfConfigFile(path.resolve(root, plan.tsconfig ?? 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(String(d.messageText)); } })!;
const program = ts.createProgram([fileAbs], cfg.options);
const checker = program.getTypeChecker();
const sf = program.getSourceFile(fileAbs)!;
const text = sf.getFullText();
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

// ---- the file's own header (the comment before its first statement) and its imports
const stmts = [...sf.statements];
const firstStart = stmts[0].getStart(sf);
const ranges = ts.getLeadingCommentRanges(text, 0) ?? [];
// (the header is the leading comment block of the file, up to the last comment that ends before a blank line or the first statement)
const header = text.slice(0, firstStart).replace(/\s+$/, '');

interface Imp { decl: ts.ImportDeclaration; spec: string; kind: 'named' | 'default' | 'ns'; name: string; prop: string; type: boolean }
const imports = new Map<ts.Symbol, Imp>();
const importDecls: ts.ImportDeclaration[] = [];
for (const s of stmts) {
  if (!ts.isImportDeclaration(s)) continue;
  importDecls.push(s);
  const spec = (s.moduleSpecifier as ts.StringLiteral).text;
  const c = s.importClause;
  if (!c) continue;
  const allType = !!c.isTypeOnly;
  if (c.name) imports.set(checker.getSymbolAtLocation(c.name)!, { decl: s, spec, kind: 'default', name: c.name.text, prop: 'default', type: allType });
  const nb = c.namedBindings;
  if (nb && ts.isNamespaceImport(nb)) imports.set(checker.getSymbolAtLocation(nb.name)!, { decl: s, spec, kind: 'ns', name: nb.name.text, prop: '*', type: allType });
  if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) imports.set(checker.getSymbolAtLocation(e.name)!, { decl: s, spec, kind: 'named', name: e.name.text, prop: (e.propertyName ?? e.name).text, type: allType || e.isTypeOnly });
}

/** whether a statement does something as the module loads: calls anything but a builder of plain values, or is not a declaration at all */
function acts(n: ts.Node): boolean {
  if (!ts.isVariableStatement(n) && !ts.isClassDeclaration(n) && !ts.isInterfaceDeclaration(n) && !ts.isTypeAliasDeclaration(n) && !ts.isEnumDeclaration(n) && !ts.isFunctionDeclaration(n)) return true;
  let found = false;
  const walk = (c: ts.Node) => {
    if (found || ts.isFunctionLike(c) || ts.isClassLike(c)) return;
    if (ts.isCallExpression(c) || ts.isNewExpression(c) || ts.isTaggedTemplateExpression(c)) {
      const t = (c as ts.CallExpression).expression?.getText(sf) ?? '';
      if (!/^(Map|Set|WeakMap|WeakSet|Array|Object\.(freeze|fromEntries|entries|keys|values|assign)|Math\.\w+|Number|String|Boolean|RegExp|Symbol)$/.test(t) && !/\.(map|filter|flatMap|reduce|join|split|slice|concat|includes|some|every|find|findIndex|fill|sort|toFixed|trim|replace|toLowerCase|toUpperCase|padStart|padEnd|indexOf)$/.test(t)) found = true;
    }
    c.forEachChild(walk);
  };
  n.forEachChild(walk);
  return found;
}

// ---- every other top-level statement: where it goes, what it declares, whether it is exported
interface Piece { s: ts.Statement; mod: string; names: string[]; syms: ts.Symbol[]; exported: boolean; typeOnly: boolean; start: number; end: number }
const modOf = (line: number) => plan.modules.find((m) => line >= m.from && line <= m.to)?.name ?? '';
const pieces: Piece[] = [];
const declSym = new Map<ts.Symbol, Piece>();
let prevEnd = firstStart;
for (const s of stmts) {
  if (ts.isImportDeclaration(s)) { prevEnd = s.getEnd(); continue; }
  const names: ts.Identifier[] = [];
  if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) { if (ts.isIdentifier(d.name)) names.push(d.name); else d.name.forEachChild(function walk(n) { if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) names.push(n.name); n.forEachChild(walk); }); }
  else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) names.push(s.name);
  const mods = ts.canHaveModifiers(s) ? ts.getModifiers(s) ?? [] : [];
  const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const typeOnly = ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s);
  // (a comment on the last statement's own line is that statement's)
  const nl = text.indexOf('\n', prevEnd);
  if (pieces.length && nl >= 0 && nl < s.getStart(sf) && text.slice(prevEnd, nl).trim().startsWith('//')) pieces[pieces.length - 1].end = prevEnd = nl;
  // (from the end of the last statement: the comments above this one go with it; the blank lines before them do not)
  const own = text.slice(prevEnd, s.getStart(sf));
  const lead = own.length - own.replace(/^\s*\n/, '').length;
  // (a list of names said again, `export { x }`, stays in the file: it is the file that says it; and anything that is not a declaration is reported)
  const stays = ts.isExportDeclaration(s) || ts.isExportAssignment(s) || (plan.keepActing && !ts.isFunctionDeclaration(s) && acts(s)) || names.some((n) => plan.keep?.includes(n.text));
  if (!names.length && !stays) console.log(`  NOTE: a statement that declares nothing, line ${lineOf(s.getStart(sf))}: ${s.getText(sf).slice(0, 80)}`);
  const p: Piece = { s, mod: stays ? '' : names.map((n) => plan.place?.[n.text]).find((m) => m !== undefined) ?? modOf(lineOf(s.getStart(sf))), names: names.map((n) => n.text), syms: names.map((n) => checker.getSymbolAtLocation(n)!).filter(Boolean), exported, typeOnly, start: prevEnd + lead, end: s.getEnd() };
  for (const sym of p.syms) declSym.set(sym, p);
  pieces.push(p);
  prevEnd = s.getEnd();
}
// (a function declared twice, overloads: every statement of the name goes where its first went)
for (const p of pieces) for (const sym of p.syms) { const first = declSym.get(sym)!; if (first !== p) p.mod = first.mod; }

// ---- what each piece uses: symbols of the file's other pieces, and of its imports; and whether at load time
interface Use { sym: ts.Symbol; eager: boolean; asType: boolean }
const assignsAcross: string[] = [];
const usesOf = (p: Piece): Use[] => {
  const out: Use[] = [];
  const visit = (n: ts.Node, lazy: boolean, inType: boolean) => {
    if (ts.isIdentifier(n)) {
      const parent = n.parent;
      // (a name after a dot, or a key in an object written out, is not a use of a top-level thing)
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === n) return;
      if (parent && (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)) && parent.name === n) return;
      let sym = checker.getSymbolAtLocation(n);
      if (parent && ts.isShorthandPropertyAssignment(parent)) sym = checker.getShorthandAssignmentValueSymbol(parent);
      if (sym && (declSym.has(sym) || imports.has(sym))) out.push({ sym, eager: !lazy, asType: inType });
      // (a top-level let assigned here: an import cannot be, so it is reported when it is another module's)
      const isAssign = parent && ((ts.isBinaryExpression(parent) && parent.left === n && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) || ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)));
      if (sym && isAssign && declSym.has(sym) && declSym.get(sym)!.mod !== p.mod) assignsAcross.push(sym.name + ' (of ' + (declSym.get(sym)!.mod || '(file)') + ') in ' + (p.mod || '(file)') + ' line ' + lineOf(n.getStart(sf)));
      return;
    }
    const fn = ts.isFunctionLike(n) && !ts.isTypeNode(n);
    const ty = inType || ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isHeritageClause(n) && n.token === ts.SyntaxKind.ImplementsKeyword;
    n.forEachChild((c) => visit(c, lazy || fn, ty));
  };
  // (a function's own body runs when it is called, not when the module loads; its name and its parameters' defaults alike)
  p.s.forEachChild((c) => visit(c, ts.isFunctionDeclaration(p.s) || ts.isClassDeclaration(p.s) && !ts.isPropertyDeclaration(c) ? true : false, p.typeOnly));
  return out;
};

// (a module may be given as several ranges: the same name more than once)
const modNames = ['', ...new Set(plan.modules.map((m) => m.name))];
const uniqMods = plan.modules.filter((m, i) => plan.modules.findIndex((q) => q.name === m.name) === i);
const needs = new Map<string, Map<string, Set<string>>>(); // mod -> from-mod -> names
const typeNeeds = new Map<string, Map<string, Set<string>>>();
const extNeeds = new Map<string, Map<ts.Symbol, boolean>>(); // mod -> import symbol -> used as value
const exportNeeded = new Set<Piece>();
const hazards: string[] = [];
for (const m of modNames) { needs.set(m, new Map()); typeNeeds.set(m, new Map()); extNeeds.set(m, new Map()); }
for (const p of pieces) {
  if (ts.isExportDeclaration(p.s) && !p.s.moduleSpecifier && p.s.exportClause && ts.isNamedExports(p.s.exportClause)) {
    for (const e of p.s.exportClause.elements) {
      const sym = [...imports.keys()].find((k) => imports.get(k)!.name === (e.propertyName ?? e.name).text);
      if (sym) extNeeds.get('')!.set(sym, (extNeeds.get('')!.get(sym) ?? false) || !(p.s.isTypeOnly || e.isTypeOnly));
    }
    continue;
  }
  for (const u of usesOf(p)) {
    const imp = imports.get(u.sym);
    if (imp) { const e = extNeeds.get(p.mod)!; e.set(u.sym, (e.get(u.sym) ?? false) || !u.asType); continue; }
    const d = declSym.get(u.sym)!;
    if (d.mod === p.mod) continue;
    exportNeeded.add(d);
    const tgt = d.typeOnly || u.asType && !(needs.get(p.mod)!.get(d.mod)?.has(u.sym.name)) ? typeNeeds : needs;
    const map = (d.typeOnly ? typeNeeds : u.asType ? typeNeeds : needs).get(p.mod)!;
    if (!map.has(d.mod)) map.set(d.mod, new Set());
    map.get(d.mod)!.add(u.sym.name);
    void tgt;
    if (u.eager && !d.typeOnly && !u.asType) hazards.push(`${p.mod || '(file)'} reads ${u.sym.name} of ${d.mod || '(file)'} at load (line ${lineOf(p.s.getStart(sf))})`);
  }
}
// (a name needed as a value anywhere in a module is imported as a value, not twice)
for (const m of modNames) for (const [from, set] of needs.get(m)!) { const t = typeNeeds.get(m)!.get(from); if (t) for (const n of set) t.delete(n); }

// ---- what each module imports of the others: and the cycles among them
const graph = new Map<string, Set<string>>();
for (const m of modNames) graph.set(m, new Set([...needs.get(m)!.keys()]));
const cycles: string[] = [];
for (const a of modNames) for (const b of graph.get(a)!) if (graph.get(b)!.has(a) && a < b) cycles.push(`${a || '(file)'} <-> ${b || '(file)'}`);

// ---- the text of each module
const rel = (fromMod: string, toMod: string) => {
  const fromDir = fromMod ? path.resolve(root, plan.dir) : path.dirname(fileAbs);
  const to = toMod ? path.resolve(root, plan.dir, toMod) : fileAbs.replace(/\.ts$/, '');
  let r = path.relative(fromDir, to).split(path.sep).join('/');
  if (!r.startsWith('.')) r = './' + r;
  return r;
};
const extSpec = (mod: string, spec: string) => {
  if (!spec.startsWith('.')) return spec;
  // (a relative import is said again from the module's own folder)
  const abs = path.resolve(path.dirname(fileAbs), spec);
  const fromDir = mod ? path.resolve(root, plan.dir) : path.dirname(fileAbs);
  let r = path.relative(fromDir, abs).split(path.sep).join('/');
  if (!r.startsWith('.')) r = './' + r;
  return r;
};
const importLines = (mod: string) => {
  const lines: string[] = [];
  // the file's own imports, in their own order, as many of them as this module uses
  for (const d of importDecls) {
    const spec = (d.moduleSpecifier as ts.StringLiteral).text;
    const mine = [...extNeeds.get(mod)!].map(([sym, value]) => ({ i: imports.get(sym)!, value })).filter((x) => x.i.decl === d);
    if (!mine.length) continue;
    const s = extSpec(mod, spec);
    const ns = mine.find((x) => x.i.kind === 'ns'), def = mine.find((x) => x.i.kind === 'default');
    const named = mine.filter((x) => x.i.kind === 'named');
    if (ns) lines.push(`import ${ns.i.type ? 'type ' : ''}* as ${ns.i.name} from '${s}';`);
    if (def || named.length) {
      const all = named.length && named.every((x) => x.i.type || !x.value) && (!def || def.i.type);
      const list = named.map((x) => `${!all && (x.i.type || !x.value) ? 'type ' : ''}${x.i.prop !== x.i.name ? `${x.i.prop} as ` : ''}${x.i.name}`);
      lines.push(`import ${all ? 'type ' : ''}${def ? def.i.name + (list.length ? ', ' : '') : ''}${list.length ? `{ ${list.join(', ')} }` : ''} from '${s}';`);
    }
  }
  for (const from of modNames) {
    if (from === mod) continue;
    const v = [...(needs.get(mod)!.get(from) ?? [])], t = [...(typeNeeds.get(mod)!.get(from) ?? [])];
    if (!v.length && !t.length) continue;
    const list = [...v.sort(), ...t.sort().map((n) => (v.length ? 'type ' + n : n))];
    lines.push(`import ${!v.length ? 'type ' : ''}{ ${list.join(', ')} } from '${rel(mod, from)}';`);
  }
  return lines;
};
const body = (mod: string) => pieces.filter((p) => p.mod === mod).map((p) => {
  let t = text.slice(p.start, p.end);
  if (!p.exported && exportNeeded.has(p)) {
    // (`export` put before the declaration itself, after its comments)
    const at = p.s.getStart(sf) - p.start;
    t = t.slice(0, at) + 'export ' + t.slice(at);
  }
  return t.replace(/^\s*\n/, '');
});

const outputs = new Map<string, string>();
const original = path.basename(plan.file);
for (const m of uniqMods) {
  const parts = [`// ${m.about ?? m.name}`, `// (One part of ${original}, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)`, ''];
  const imps = importLines(m.name);
  if (imps.length) parts.push(...imps, '');
  parts.push(body(m.name).join(eol + eol));
  outputs.set(path.join(plan.dir, `${m.name}.ts`), parts.join(eol).replace(/\n/g, eol === '\r\n' ? '\r\n' : '\n').replace(/\r\r\n/g, '\r\n') + eol);
}
// the file itself: its header, what stays in it, and every name it exported, said again from where it now is
{
  const parts = [header, ''];
  const imps = importLines('');
  if (imps.length) parts.push(...imps, '');
  for (const m of uniqMods) {
    const v = pieces.filter((p) => p.mod === m.name && p.exported && !p.typeOnly).flatMap((p) => p.names);
    const t = pieces.filter((p) => p.mod === m.name && p.exported && p.typeOnly).flatMap((p) => p.names);
    const uniq = (a: string[]) => [...new Set(a)];
    if (plan.reexport === false) continue;
    if (v.length) parts.push(`export { ${uniq(v).join(', ')} } from '${rel('', m.name)}';`);
    if (t.length) parts.push(`export type { ${uniq(t).join(', ')} } from '${rel('', m.name)}';`);
  }
  const kept = body('');
  if (kept.length) parts.push('', kept.join(eol + eol));
  outputs.set(plan.file, parts.join(eol) + eol);
}

// ---- the report
const lines = (s: string) => s.split('\n').length;
console.log(`${plan.file}: ${lines(text)} lines, ${pieces.length} statements`);
for (const [f, s] of outputs) console.log(`  ${String(lines(s)).padStart(5)}  ${f}`);
for (const m of modNames) { const g = [...graph.get(m)!]; if (g.length) console.log(`  ${m || '(file)'} imports ${g.map((x) => x || '(file)').join(', ')}`); }
console.log(cycles.length ? `  CYCLES: ${cycles.join('; ')}` : '  no cycles');
console.log(hazards.length ? `  READ AT LOAD across modules (${hazards.length}):\n    ` + [...new Set(hazards)].slice(0, 40).join('\n    ') : '  nothing read across modules at load');
console.log(assignsAcross.length ? '  LETS ASSIGNED FROM ANOTHER MODULE (' + assignsAcross.length + '):\n    ' + [...new Set(assignsAcross)].slice(0, 60).join('\n    ') : '  no let is assigned from another module');
const total = [...outputs.values()].reduce((a, s) => a + lines(s), 0);
console.log(`  ${total} lines in all (was ${lines(text)})`);
void ranges;
if (write) {
  mkdirSync(path.resolve(root, plan.dir), { recursive: true });
  for (const [f, s] of outputs) writeFileSync(path.resolve(root, f), s);
  console.log('written');
}
