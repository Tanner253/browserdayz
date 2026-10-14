// npx tsx scripts/split/methods.ts <plan.json> [--write]: CUTS A GIANT CLASS'S METHODS OUT INTO FEATURE FILES, BODIES UNCHANGED (2026-10-14).
// For src/game/game.ts: one class, Game, of some 150 methods. Each method the plan names by line goes, whole, with the
// comments above it, into an object of methods in a file of its own (`this: Game` said as its first parameter, so
// the body reads exactly as it did); the class keeps its fields, its constructor, its getters and setters and every
// arrow-function field; and as the file loads, each object's methods are put back on Game.prototype as the class
// had them (not enumerable, writable, configurable), so nothing that runs can tell. TypeScript is told of them by
// an interface of the same name (declaration merging). `private` and `protected` are taken off the class's members:
// they are TypeScript's alone, and code outside the class body cannot otherwise reach them.
//
// plan.json: { "file": "src/game/game.ts", "class": "Game", "dir": "src/game/game", "tsconfig": "tsconfig.json",
//   "modules": [{ "name": "enter", "about": "...", "from": 989, "to": 1561 }, ...] }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)(process.env.TS_JS ?? 'C:/Users/perci/AppData/Roaming/npm/node_modules/vercel/node_modules/typescript') as typeof import('typescript');

interface Mod { name: string; about?: string; from: number; to: number }
interface Plan { file: string; class: string; dir: string; tsconfig?: string; modules: Mod[] }
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
const cls = sf.statements.find((s) => ts.isClassDeclaration(s) && s.name?.text === plan.class) as ts.ClassDeclaration;
if (!cls) throw new Error('no class ' + plan.class);
const uniqMods = plan.modules.filter((m, i) => plan.modules.findIndex((q) => q.name === m.name) === i);
const modOf = (line: number) => plan.modules.find((m) => line >= m.from && line <= m.to)?.name ?? '';

// ---- the file's imports and top-level declarations: what a moved method may use
interface Imp { decl: ts.ImportDeclaration; spec: string; kind: 'named' | 'default' | 'ns'; name: string; prop: string; type: boolean }
const imports = new Map<ts.Symbol, Imp>();
const importDecls: ts.ImportDeclaration[] = [];
const tops = new Map<ts.Symbol, { node: ts.Statement; name: string; typeOnly: boolean }>();
for (const s of sf.statements) {
  if (ts.isImportDeclaration(s)) {
    importDecls.push(s);
    const spec = (s.moduleSpecifier as ts.StringLiteral).text, c = s.importClause;
    if (!c) continue;
    if (c.name) imports.set(checker.getSymbolAtLocation(c.name)!, { decl: s, spec, kind: 'default', name: c.name.text, prop: 'default', type: !!c.isTypeOnly });
    const nb = c.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) imports.set(checker.getSymbolAtLocation(nb.name)!, { decl: s, spec, kind: 'ns', name: nb.name.text, prop: '*', type: !!c.isTypeOnly });
    if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) imports.set(checker.getSymbolAtLocation(e.name)!, { decl: s, spec, kind: 'named', name: e.name.text, prop: (e.propertyName ?? e.name).text, type: !!c.isTypeOnly || e.isTypeOnly });
    continue;
  }
  const add = (id: ts.Identifier, typeOnly: boolean) => tops.set(checker.getSymbolAtLocation(id)!, { node: s, name: id.text, typeOnly });
  if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) { if (ts.isIdentifier(d.name)) add(d.name, false); }
  else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) add(s.name, false);
  else if ((ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name) add(s.name, true);
}

// ---- the members that move: methods only (not the constructor, accessors, fields, statics, overloads)
interface Moved { m: ts.MethodDeclaration; mod: string; start: number; name: string }
const moved: Moved[] = [];
let prevEnd = cls.members.pos;
const skipped: string[] = [];
for (const m of cls.members) {
  const start = prevEnd;
  prevEnd = m.getEnd();
  const mod = modOf(lineOf(m.getStart(sf)));
  if (!mod) continue;
  const mods = ts.getModifiers(m as ts.MethodDeclaration) ?? [];
  if (!ts.isMethodDeclaration(m) || !m.body || mods.some((x) => x.kind === ts.SyntaxKind.StaticKeyword || x.kind === ts.SyntaxKind.AbstractKeyword) || !ts.isIdentifier(m.name) || m.asteriskToken && mods.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword)) {
    skipped.push(`${lineOf(m.getStart(sf))} ${ts.SyntaxKind[m.kind]} ${m.name?.getText(sf) ?? ''}`);
    continue;
  }
  // (a comment on the last member's own line is that member's)
  let s0 = start;
  const nl = text.indexOf('\n', start);
  if (nl >= 0 && nl < m.getStart(sf) && text.slice(start, nl).trim().startsWith('//')) s0 = nl + 1;
  const lead = text.slice(s0, m.getStart(sf));
  s0 += lead.length - lead.replace(/^\s*\n/, '').length;
  moved.push({ m, mod, start: s0, name: m.name.text });
}
// (an overloaded name: every declaration of it must go together; refused rather than guessed)
const names = moved.map((x) => x.name);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
if (dup.length) throw new Error('overloaded methods in the plan: ' + dup.join(', '));

// ---- what each moved method uses of the file's imports and top level
const extNeeds = new Map<string, Map<ts.Symbol, boolean>>();
const topNeeds = new Map<string, Map<string, boolean>>();
for (const x of uniqMods) { extNeeds.set(x.name, new Map()); topNeeds.set(x.name, new Map()); }
const exportTop = new Set<ts.Statement>();
const clsValue = new Set<string>();
for (const x of moved) {
  const visit = (n: ts.Node, inType: boolean) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      if (p && ts.isPropertyAccessExpression(p) && p.name === n) return;
      if (p && (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p)) && p.name === n) return;
      let sym = checker.getSymbolAtLocation(n);
      if (p && ts.isShorthandPropertyAssignment(p)) sym = checker.getShorthandAssignmentValueSymbol(p);
      if (!sym) return;
      if (imports.has(sym)) { const e = extNeeds.get(x.mod)!; e.set(sym, (e.get(sym) ?? false) || !inType); }
      else if (tops.has(sym)) {
        const t = tops.get(sym)!;
        // (the class itself: imported below, as a value where a part uses it as one: its statics)
        if (t.node === cls) { if (!inType) clsValue.add(x.mod); return; }
        exportTop.add(t.node);
        const e = topNeeds.get(x.mod)!;
        e.set(t.name, (e.get(t.name) ?? false) || (!inType && !t.typeOnly));
      }
      return;
    }
    n.forEachChild((c) => visit(c, inType || ts.isTypeNode(c)));
  };
  x.m.forEachChild((c) => visit(c, ts.isTypeNode(c)));
}

// ---- the files
const relSpec = (spec: string) => {
  if (!spec.startsWith('.')) return spec;
  let r = path.relative(path.resolve(root, plan.dir), path.resolve(path.dirname(fileAbs), spec)).split(path.sep).join('/');
  return r.startsWith('.') ? r : './' + r;
};
const toFile = (() => { let r = path.relative(path.resolve(root, plan.dir), fileAbs).replace(/\.ts$/, '').split(path.sep).join('/'); return r.startsWith('.') ? r : './' + r; })();
const objName = (mod: string) => mod.replace(/-(\w)/g, (_, c) => c.toUpperCase()) + 'Methods';
const outputs = new Map<string, string>();
const original = path.basename(plan.file);
for (const x of uniqMods) {
  const lines = [`// ${x.about ?? x.name}`, `// (Methods of ${plan.class} cut out of ${original} whole on 2026-10-14, so that they can be read and worked on alone: put back on`, `// ${plan.class}.prototype as the file loads. Nothing in them was changed but \`this: ${plan.class}\` said as the first parameter.)`, ''];
  for (const d of importDecls) {
    const spec = (d.moduleSpecifier as ts.StringLiteral).text;
    const mine = [...extNeeds.get(x.name)!].map(([sym, value]) => ({ i: imports.get(sym)!, value })).filter((q) => q.i.decl === d);
    if (!mine.length) continue;
    const s = relSpec(spec), ns = mine.find((q) => q.i.kind === 'ns'), def = mine.find((q) => q.i.kind === 'default'), named = mine.filter((q) => q.i.kind === 'named');
    if (ns) lines.push(`import ${ns.i.type || !ns.value ? 'type ' : ''}* as ${ns.i.name} from '${s}';`);
    if (def || named.length) {
      const all = named.every((q) => q.i.type || !q.value) && (!def || def.i.type || !def.value);
      const list = named.map((q) => `${!all && (q.i.type || !q.value) ? 'type ' : ''}${q.i.prop !== q.i.name ? `${q.i.prop} as ` : ''}${q.i.name}`);
      lines.push(`import ${all ? 'type ' : ''}${def ? def.i.name + (list.length ? ', ' : '') : ''}${list.length ? `{ ${list.join(', ')} }` : ''} from '${s}';`);
    }
  }
  const tn = [...topNeeds.get(x.name)!];
  const values = tn.filter(([, v]) => v).map(([n]) => n).sort(), types = tn.filter(([, v]) => !v).map(([n]) => n).sort();
  const cv = clsValue.has(x.name), anyValue = values.length > 0 || cv;
  lines.push(`import ${anyValue ? '' : 'type '}{ ${[...values, ...(cv ? [plan.class] : []), ...types.map((n) => (anyValue ? 'type ' : '') + n), ...(cv ? [] : [(anyValue ? 'type ' : '') + plan.class])].join(', ')} } from '${toFile}';`);
  lines.push('');
  lines.push(`export const ${objName(x.name)} = {`);
  const bodies: string[] = [];
  for (const mv of moved.filter((q) => q.mod === x.name)) {
    let t = text.slice(mv.start, mv.m.getEnd());
    // (access words off: an object's method has none; `this` said as the first parameter)
    const mstart = mv.m.getStart(sf) - mv.start;
    const head = t.slice(mstart);
    const mods = ts.getModifiers(mv.m) ?? [];
    let h = head;
    for (const k of mods) if (k.kind === ts.SyntaxKind.PrivateKeyword || k.kind === ts.SyntaxKind.ProtectedKeyword || k.kind === ts.SyntaxKind.PublicKeyword || k.kind === ts.SyntaxKind.OverrideKeyword) h = h.replace(new RegExp('^((?:async\\s+|readonly\\s+)*)' + ts.tokenToString(k.kind) + '\\s+'), '$1');
    const open = mv.m.parameters.pos - mv.m.getStart(sf) - (head.length - h.length);
    const hasParams = mv.m.parameters.length > 0;
    h = h.slice(0, open) + `this: ${plan.class}${hasParams ? ', ' : ''}` + h.slice(open);
    t = t.slice(0, mstart) + h;
    bodies.push(t.replace(/^\s*\n/, '') + ',');
  }
  lines.push(bodies.join(eol + eol));
  lines.push('};');
  outputs.set(path.join(plan.dir, `${x.name}.ts`), lines.join(eol) + eol);
}
// the file: the moved methods taken out, access words off the class's members, top-level things others need exported, and the methods put back
{
  const cuts: [number, number, string][] = [];
  // (each taken out leaves a mark, and the blank lines about a run of marks are made one: nowhere else is a blank line touched)
  for (const mv of moved) cuts.push([mv.start, mv.m.getEnd(), '\u0000']);
  for (const m of cls.members) {
    if (moved.some((q) => q.m === m)) continue;
    for (const k of ts.getModifiers(m as ts.PropertyDeclaration) ?? []) if (k.kind === ts.SyntaxKind.PrivateKeyword || k.kind === ts.SyntaxKind.ProtectedKeyword) {
      // (the word and the space after it)
      let e = k.getEnd();
      while (text[e] === ' ') e++;
      cuts.push([k.getStart(sf), e, '']);
    }
  }
  for (const s of exportTop) {
    const mods = ts.canHaveModifiers(s) ? ts.getModifiers(s) ?? [] : [];
    if (!mods.some((k) => k.kind === ts.SyntaxKind.ExportKeyword)) cuts.push([s.getStart(sf), s.getStart(sf), 'export ']);
  }
  {
    const movedSet = new Set<ts.Node>(moved.map((q) => q.m));
    const fileUsed = new Set<ts.Symbol>();
    const walkFile = (n: ts.Node) => {
      if (movedSet.has(n)) return;
      if (ts.isIdentifier(n)) {
        let sym = checker.getSymbolAtLocation(n);
        if (n.parent && ts.isShorthandPropertyAssignment(n.parent)) sym = checker.getShorthandAssignmentValueSymbol(n.parent);
        if (sym && imports.has(sym)) fileUsed.add(sym);
      }
      n.forEachChild(walkFile);
    };
    for (const st of sf.statements) if (!ts.isImportDeclaration(st)) walkFile(st);
    for (const d of importDecls) {
      const c = d.importClause;
      if (!c) continue;
      const syms = [...imports].filter(([, i]) => i.decl === d);
      if (syms.every(([sym]) => fileUsed.has(sym))) continue;
      const keep = syms.filter(([sym]) => fileUsed.has(sym)).map(([, i]) => i);
      const spec = d.moduleSpecifier.getText(sf);
      const elems = c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : ts.factory.createNodeArray<ts.ImportSpecifier>([]);
      // (a module this file loaded for a value is still loaded here, where it was, if nothing of it is left to name: the order modules load in is kept)
      const hadValue = !c.isTypeOnly && syms.some(([, i]) => !i.type), keepsValue = !c.isTypeOnly && keep.some((i) => !i.type);
      const ns = keep.find((i) => i.kind === 'ns'), def = keep.find((i) => i.kind === 'default'), named = keep.filter((i) => i.kind === 'named');
      const list = named.map((i) => elems.find((e) => e.name.text === i.name)!.getText(sf));
      let t = hadValue && !keepsValue ? `import ${spec};` : '';
      if (keep.length) {
        const typeOnly = c.isTypeOnly || (hadValue && !keepsValue);
        const lst = typeOnly && !c.isTypeOnly ? list.map((x) => x.replace(/^type\s+/, '')) : list;
        t += `${t ? eol : ''}import ${typeOnly ? 'type ' : ''}${def ? def.name : ''}${def && (ns || lst.length) ? ', ' : ''}${ns ? `* as ${ns.name}` : ''}${lst.length ? `{ ${lst.join(', ')} }` : ''} from ${spec};`;
      }
      cuts.push([d.getStart(sf), d.getEnd(), t]);
    }
  }
  // (the imports of the methods, after the file's own; and the interface and the putting back, after the class)
  const lastImport = importDecls[importDecls.length - 1].getEnd();
  const imps = uniqMods.map((x) => `import { ${objName(x.name)} } from './${path.basename(plan.dir)}/${x.name}';`).join(eol);
  cuts.push([lastImport, lastImport, eol + imps]);
  const after = [
    '',
    `// The methods that live in ${path.basename(plan.dir)}/ (see each file there): TypeScript is told of them here, and they are put back on`,
    `// the class as it had them, not enumerable. (Cut out on 2026-10-14 so that ${original} can be read in pieces.)`,
    `type Methods<T> = { [K in keyof T]: T[K] extends (this: ${plan.class}, ...a: infer A) => infer R ? (...a: A) => R : never };`,
    // (each by name: an interface may not extend a type made of methods that themselves name the class)
    `export interface ${plan.class} {`,
    ...moved.map((q) => `  ${q.name}: Methods<typeof ${objName(q.mod)}>['${q.name}'];`),
    `}`,
    `for (const part of [${uniqMods.map((x) => objName(x.name)).join(', ')}]) {`,
    `  for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(part))) Object.defineProperty(${plan.class}.prototype, name, { ...d, enumerable: false });`,
    `}`,
  ].join(eol);
  cuts.push([cls.getEnd(), cls.getEnd(), eol + after]);
  cuts.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let out = text;
  for (const [a, b, r] of cuts) out = out.slice(0, a) + r + out.slice(b);
  out = out.replace(/(\s*\u0000)+\s*/g, (m: string, _g: string, at: number, all: string) => (all.slice(at + m.length).startsWith('}') ? eol : eol + eol + '  '));
  outputs.set(plan.file, out);
}
const lines = (s: string) => s.split('\n').length;
console.log(`${plan.file}: ${lines(text)} lines; ${moved.length} methods move${skipped.length ? `; left in the class (not plain methods): ${skipped.join('; ')}` : ''}`);
for (const [f, s] of outputs) console.log(`  ${String(lines(s)).padStart(5)}  ${f}`);
console.log(`  top-level things of ${original} the parts use (exported): ${[...exportTop].length}`);
if (write) {
  mkdirSync(path.resolve(root, plan.dir), { recursive: true });
  for (const [f, s] of outputs) writeFileSync(path.resolve(root, f), s);
  console.log('written');
}
