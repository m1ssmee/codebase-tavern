// Import graph: which file imports which, aggregated to modules. Pure; type-only imports so
// `node scripts/check.mjs` can run it directly.
import type { Module, RepoFile } from './types';

export type EdgeKind = 'imports' | 'calls';
/**
 * One import statement, or one call site that reaches another module over the network ("calls": a service
 * registry lookup, a name→URL config entry, or an HTTP call whose URL names the module). `to` is the target
 * module (internal only); `target` the resolved file for imports. A call's endLine is where the call closes.
 */
export type ImportRef = { file: string; line: number; endLine: number; spec: string; from: string; to?: string; target?: string; kind: EdgeKind };
export type Edge = { from: string; to: string; weight: number; kind: EdgeKind }; // `weight` statements or call sites
export type Graph = { imports: ImportRef[]; edges: Edge[]; external: Record<string, string[]> };
export type EdgeOpts = { calls?: boolean }; // include "calls" edges (default true)

const JS = /\.(m|c)?[jt]sx?$/;
const PY = /\.pyi?$/;
const JAVA = /\.(java|kt|kts|scala)$/;
const GO = /\.go$/;
const RUST = /\.rs$/;
// Languages without a resolver get the folder-name heuristic (so does Go without a go.mod in the loaded files).
const OTHER = /\.(go|rs|java|kt|kts|scala|rb|php|c|h|cc|cpp|hpp|cs|swift|dart|lua|ex|exs|erl|clj|hs|ml|r|jl|sh)$/;
const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
// ponytail: regexes, not a parser; an import inside a comment or string still counts.
const JS_IMPORTS = [
  /^[ \t]*(?:import|export)\b[^;=()'"`]*?\bfrom\s*['"]([^'"\n]+)['"]/gm, // import x from 'y', export * from 'y'
  /^[ \t]*import\s*['"]([^'"\n]+)['"]/gm, // import 'y'
  /\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, // import('y'), require('y')
];

const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const join = (dir: string, spec: string) => {
  const out = dir ? dir.split('/') : [];
  for (const s of spec.split('/')) {
    if (s === '..') out.pop();
    else if (s && s !== '.') out.push(s);
  }
  return out.join('/');
};
const pkgName = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

/** Every regex match with its 1-based start and end line. */
function scan(content: string, re: RegExp) {
  const out: { spec: string; line: number; endLine: number }[] = [];
  let pos = 0;
  let line = 1;
  for (const m of content.matchAll(re)) {
    for (; pos < m.index; pos++) if (content.charCodeAt(pos) === 10) line++;
    out.push({ spec: m[1], line, endLine: line + (m[0].match(/\n/g)?.length ?? 0) });
  }
  return out;
}

// "calls" heuristics. ponytail: line-level regexes; dynamic lookups (SERVICES[prefix]) and URLs built elsewhere are missed.
const REGISTRY = /\b\w*(?:services?|urls?|endpoints?|hosts?|clients?|upstreams?)\b\s*(?:\??\.\s*(\w+)|\[\s*['"`]([\w-]+)['"`]\s*\])/gi; // SERVICES.payments, services['orders']
const CONFIG_ENTRY = /^\s*['"]?([\w-]+)['"]?\s*:.*(?:https?:\/\/|\b[A-Z0-9_]*_URL\b|\bbase_?url\b|\burl\b)/i; // payments: { baseUrl: … }
const HTTP_CALL = /\b(?:fetch|axios(?:\.\w+)?|got(?:\.\w+)?|https?\.(?:request|get)|requests\.\w+|httpx\.\w+|ky(?:\.\w+)?|superagent\.\w+|http\.(?:Get|Post|NewRequest))\s*\(/;
const COMMENT = /^\s*(\/\/|#|\*|\/\*)/;
const IMPORT_LINE = /^\s*(import|from\s+\S+\s+import|export\s.*\bfrom\b)|\brequire\s*\(/;

/** Line where the call starting on line i closes (parentheses balance), or i for a one-line entry. */
function callEnd(lines: string[], i: number): number {
  let depth = 0;
  let opened = false;
  for (let j = i; j < Math.min(lines.length, i + 60); j++) {
    for (const ch of lines[j]) {
      if (ch === '(') {
        depth++;
        opened = true;
      } else if (ch === ')') depth--;
    }
    if (!opened || depth <= 0) return j;
  }
  return i;
}

function serviceCalls(f: RepoFile, from: string, named: { id: string; name: string }[]): ImportRef[] {
  const out: ImportRef[] = [];
  const lines = f.content.split('\n');
  const byName = new Map(named.map((m) => [m.name.toLowerCase(), m.id]));
  lines.forEach((l, i) => {
    if (COMMENT.test(l) || IMPORT_LINE.test(l)) return;
    const hits = new Set<string>();
    for (const m of l.matchAll(REGISTRY)) {
      const id = byName.get((m[1] ?? m[2]).toLowerCase());
      if (id) hits.add(id);
    }
    const entry = l.match(CONFIG_ENTRY)?.[1];
    if (entry && byName.has(entry.toLowerCase())) hits.add(byName.get(entry.toLowerCase())!);
    if (HTTP_CALL.test(l))
      for (const m of named)
        if (new RegExp(`(\\/${m.name}\\b|\\/\\/${m.name}[:/]|\\b${m.name}[_-]?(?:url|base_?url|host|endpoint|api|service|client)\\b)`, 'i').test(l)) hits.add(m.id);
    for (const to of hits) if (to !== from) out.push({ file: f.path, line: i + 1, endLine: callEnd(lines, i) + 1, spec: l.trim().slice(0, 120), from, to, kind: 'calls' });
  });
  return out;
}

export function buildGraph(files: RepoFile[], modules: Module[]): Graph {
  const paths = new Set(files.map((f) => f.path));
  const owner = new Map(modules.flatMap((m) => m.filePaths.map((p) => [p, m.id] as const)));
  const firstFile = (cands: string[]) => cands.find((c) => paths.has(c));

  const resolveJs = (from: string, spec: string): string | null | undefined => {
    let base: string;
    if (spec.startsWith('.')) base = join(dirOf(from), spec);
    else if (/^[@~]\//.test(spec)) return firstFile([`src/${spec.slice(2)}`, spec.slice(2)].flatMap(jsCands)) ?? null; // tsconfig alias
    else return workspace(spec); // a package in this repo (monorepo), else external
    return firstFile(jsCands(base)) ?? null; // null: relative but not in the loaded files
  };
  // Monorepo packages: package.json names when loaded, else the folder convention (packages/react ← 'react',
  // packages/babel-parser ← '@babel/parser').
  const pkgDirs = new Map<string, string>();
  for (const f of files)
    if (base(f.path) === 'package.json' && dirOf(f.path))
      try {
        const n = JSON.parse(f.content)?.name;
        if (typeof n === 'string') pkgDirs.set(n, dirOf(f.path));
      } catch {
        // not JSON: skip
      }
  const containerDirs = [...new Set(files.map((f) => f.path.match(/^((?:packages|apps|libs)\/[^/]+)\//)?.[1]).filter((d): d is string => !!d))];
  const workspace = (spec: string): string | null | undefined => {
    const name = pkgName(spec);
    const dir = pkgDirs.get(name) ?? containerDirs.find((d) => [name, name.replace(/^@/, '').replace('/', '-'), name.split('/')[1]].includes(d.split('/')[1]));
    if (!dir) return undefined;
    const rest = spec.slice(name.length + 1);
    return (
      firstFile(rest ? [...jsCands(join(dir, rest)), ...jsCands(join(dir, 'src/' + rest))] : [...jsCands(join(dir, 'index')), ...jsCands(join(dir, 'src/index'))]) ??
      files.find((f) => f.path.startsWith(dir + '/') && JS.test(f.path))?.path ??
      null
    );
  };
  const jsCands = (b: string) => [
    b,
    ...JS_EXT.map((e) => b + e),
    ...JS_EXT.map((e) => `${b ? b + '/' : ''}index${e}`), // require('../') from test/ is the root index.js
    ...(/\.(m|c)?jsx?$/.test(b) ? ['.ts', '.tsx'].map((e) => b.replace(/\.(m|c)?jsx?$/, e)) : []), // TS ESM: './x.js' is x.ts
  ];

  // Absolute Python module "a.b": a/b.py or a/b/__init__.py under a source root (repo root, src/, …),
  // never inside another package, so `import json` doesn't land on flask/json/.
  const pyAbs = (dotted: string) => {
    const rel = dotted.replace(/\./g, '/');
    const hits: string[] = [];
    for (const tail of [`${rel}.py`, `${rel}/__init__.py`]) {
      for (const p of paths) {
        if (p !== tail && !p.endsWith('/' + tail)) continue;
        const root = p.slice(0, p.length - tail.length);
        if (!paths.has(root + '__init__.py')) hits.push(p);
      }
    }
    return hits.sort((a, b) => a.length - b.length)[0];
  };
  const pyRel = (from: string, dots: number, rest: string) => {
    let dir = dirOf(from);
    for (let i = 1; i < dots; i++) dir = dirOf(dir);
    const b = join(dir, rest.replace(/\./g, '/'));
    return firstFile([`${b}.py`, `${b}/__init__.py`]);
  };

  // Java/Kotlin: com.x.owner.Owner is a file ending in com/x/owner/Owner.java; com.x.owner.* is that folder.
  const javaFiles = files.filter((f) => JAVA.test(f.path)).map((f) => ({ path: f.path, stem: f.path.replace(JAVA, '') }));
  const resolveJava = (dotted: string, wildcard: boolean) => {
    const parts = dotted.split('.');
    // a static import names a member: drop segments until a class or package matches
    for (let n = parts.length; n >= 2; n--) {
      const rel = parts.slice(0, n).join('/');
      const hit = wildcard && n === parts.length ? javaFiles.find((f) => dirOf(f.path) === rel || dirOf(f.path).endsWith('/' + rel)) : javaFiles.find((f) => f.stem === rel || f.stem.endsWith('/' + rel));
      if (hit) return hit.path;
    }
  };

  // Go: the module path in go.mod maps import paths to folders (github.com/gin-gonic/gin/render → render/).
  const goMods = files
    .filter((f) => base(f.path) === 'go.mod')
    .flatMap((f) => {
      const m = f.content.match(/^module\s+(\S+)/m);
      return m ? [{ mod: m[1], dir: dirOf(f.path) }] : [];
    })
    .sort((a, b) => b.mod.length - a.mod.length);
  const goDirs = new Map<string, string>();
  for (const f of files) if (GO.test(f.path) && !goDirs.has(dirOf(f.path))) goDirs.set(dirOf(f.path), f.path);
  const resolveGo = (spec: string): string | null | undefined => {
    const m = goMods.find((g) => spec === g.mod || spec.startsWith(g.mod + '/'));
    if (!m) return undefined; // the standard library or another module
    return goDirs.get(join(m.dir, spec.slice(m.mod.length + 1))) ?? null;
  };

  // Rust: crate names from Cargo.toml (dashes become underscores), `use crate::a::b`, `mod a;`.
  const crates = files
    .filter((f) => base(f.path) === 'Cargo.toml')
    .flatMap((f) => {
      const name = f.content.match(/^\[package\][^[]*?^name\s*=\s*"([^"]+)"/m)?.[1];
      return [{ name: name?.replace(/-/g, '_'), dir: dirOf(f.path) }];
    })
    .sort((a, b) => b.dir.length - a.dir.length);
  // Crates whose Cargo.toml didn't make the cut: the folder holding src/lib.rs, named by convention (dashes → underscores).
  for (const f of files) {
    const dir = f.path.match(/^(.+)\/src\/(lib|main)\.rs$/)?.[1];
    if (dir && !crates.some((c) => c.dir === dir)) crates.push({ name: base(dir).replace(/-/g, '_'), dir });
  }
  crates.sort((a, b) => b.dir.length - a.dir.length);
  const crateOf = (file: string) => crates.find((c) => !c.dir || file.startsWith(c.dir + '/'))?.dir;
  const rustFile = (dir: string, segs: string[]) => {
    for (let n = segs.length; n >= 1; n--) {
      const b = join(dir, segs.slice(0, n).join('/'));
      const hit = firstFile([`${b}.rs`, `${b}/mod.rs`]);
      if (hit) return hit;
    }
  };
  const rustRoot = (file: string) => {
    const c = crateOf(file);
    if (c !== undefined) return join(c, 'src');
    const i = file.lastIndexOf('/src/');
    return i >= 0 ? file.slice(0, i + 4) : file.startsWith('src/') ? 'src' : dirOf(file);
  };
  const resolveRust = (file: string, path: string): string | null | undefined => {
    const [head, ...segs] = path.split('::').map((x) => x.trim());
    if (head === 'crate') return rustFile(rustRoot(file), segs) ?? null;
    if (head === 'self' || head === 'super') return null; // inside the same module, near enough
    const other = crates.find((c) => c.name === head);
    if (!other) return undefined; // std or an outside crate
    return rustFile(join(other.dir, 'src'), segs) ?? firstFile([join(other.dir, 'src/lib.rs'), join(other.dir, 'src/main.rs')]) ?? files.find((f) => f.path.startsWith(other.dir + '/'))?.path ?? null;
  };

  const imports: ImportRef[] = [];
  const external = new Map<string, Set<string>>();
  const ext = (mod: string, name: string) => external.set(mod, (external.get(mod) ?? new Set()).add(name));
  const add = (file: string, from: string, x: { spec: string; line: number; endLine: number }, target?: string, to = target && owner.get(target)) =>
    to && imports.push({ file, from, ...x, ...(target ? { target } : {}), to, kind: 'imports' });

  // Heuristic for other languages: an import-like line naming another module's folder.
  const named = modules
    .filter((m) => m.path && m.path !== '(misc)')
    .map((m) => ({ id: m.id, name: m.path.split('/').pop()!, re: new RegExp(`(^|[^\\w-])${m.path.split('/').pop()!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`) }))
    .filter((m) => m.name.length >= 3 && /^[\w-]+$/.test(m.name));

  for (const f of files) {
    const from = owner.get(f.path);
    if (!from) continue;
    if (JS.test(f.path) || PY.test(f.path) || OTHER.test(f.path)) imports.push(...serviceCalls(f, from, named));
    if (JS.test(f.path) || /\.(vue|svelte|astro)$/.test(f.path)) {
      for (const re of JS_IMPORTS) {
        for (const x of scan(f.content, re)) {
          const target = resolveJs(f.path, x.spec);
          if (target === undefined) ext(from, x.spec.startsWith('node:') ? x.spec : pkgName(x.spec));
          else if (target) add(f.path, from, x, target);
        }
      }
    } else if (PY.test(f.path)) {
      f.content.split('\n').forEach((l, i) => {
        const at = { line: i + 1, endLine: i + 1 };
        const fm = l.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+([^#]+)/);
        if (fm) {
          const [, dots, rest, names] = fm;
          if (!dots) {
            const t = pyAbs(rest);
            if (t) add(f.path, from, { spec: rest, ...at }, t);
            else ext(from, rest.split('.')[0]);
            return;
          }
          // `from . import a, b`: each name may be a submodule; else it's the package itself.
          const subs = rest ? [] : names.replace(/[()]/g, '').split(',').map((n) => n.trim().split(/\s+/)[0]).filter(Boolean);
          const hits = subs.map((n) => pyRel(f.path, dots.length, n)).filter((t): t is string => !!t);
          for (const t of hits.length ? hits : [pyRel(f.path, dots.length, rest)].filter((t): t is string => !!t)) add(f.path, from, { spec: dots + rest, ...at }, t);
          return;
        }
        const im = l.match(/^\s*import\s+([\w., \t]+)/);
        for (const part of im ? im[1].split(',') : []) {
          const name = part.trim().split(/\s+/)[0];
          if (!name) continue;
          const t = pyAbs(name);
          if (t) add(f.path, from, { spec: name, ...at }, t);
          else ext(from, name.split('.')[0]);
        }
      });
    } else if (JAVA.test(f.path)) {
      f.content.split('\n').forEach((l, i) => {
        const m = l.match(/^\s*import\s+(?:static\s+)?([\w.]+?)(\.\*)?\s*;?\s*$/);
        if (!m) return;
        const t = resolveJava(m[1], !!m[2]);
        if (t) add(f.path, from, { spec: m[1] + (m[2] ?? ''), line: i + 1, endLine: i + 1 }, t);
        else ext(from, m[1].split('.').slice(0, 2).join('.'));
      });
    } else if (GO.test(f.path) && goMods.length) {
      let block = false;
      f.content.split('\n').forEach((l, i) => {
        if (/^\s*import\s*\(\s*$/.test(l)) return void (block = true);
        if (block && /^\s*\)/.test(l)) return void (block = false);
        const m = block ? l.match(/^\s*(?:[\w.]+\s+)?"([^"]+)"/) : l.match(/^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/);
        if (!m) return;
        const t = resolveGo(m[1]);
        if (t === undefined) ext(from, m[1]);
        else if (t) add(f.path, from, { spec: m[1], line: i + 1, endLine: i + 1 }, t);
      });
    } else if (RUST.test(f.path)) {
      f.content.split('\n').forEach((l, i) => {
        const at = { line: i + 1, endLine: i + 1 };
        const md = l.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/);
        if (md) {
          const here = /(^|\/)(mod|lib|main)\.rs$/.test(f.path) ? dirOf(f.path) : f.path.replace(/\.rs$/, '');
          const t = firstFile([join(here, `${md[1]}.rs`), join(here, `${md[1]}/mod.rs`)]);
          if (t) add(f.path, from, { spec: `mod ${md[1]}`, ...at }, t);
          return;
        }
        const u = l.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:use|extern\s+crate)\s+(?:::)?([\w:]+)/);
        if (!u) return;
        const t = resolveRust(f.path, u[1].replace(/::$/, ''));
        if (t === undefined) ext(from, u[1].split('::')[0]);
        else if (t) add(f.path, from, { spec: u[1], ...at }, t);
      });
    } else if (OTHER.test(f.path)) {
      let block = false; // Go: import ( ... )
      f.content.split('\n').forEach((l, i) => {
        if (/^\s*import\s*\($/.test(l)) return void (block = true);
        if (block && /^\s*\)/.test(l)) return void (block = false);
        if (!block && !/^\s*(#\s*include|import|from|use|using|require(_once)?|include|load|extern\s+crate|mod)\b/.test(l)) return;
        for (const m of named) if (m.id !== from && m.re.test(l)) add(f.path, from, { spec: l.trim().slice(0, 120), line: i + 1, endLine: i + 1 }, undefined, m.id);
      });
    }
  }

  const weights = new Map<string, Edge>();
  for (const r of imports) {
    if (!r.to || r.to === r.from) continue;
    const k = `${r.from}\0${r.to}\0${r.kind}`;
    const e = weights.get(k) ?? { from: r.from, to: r.to, weight: 0, kind: r.kind };
    e.weight++;
    weights.set(k, e);
  }
  return {
    imports,
    edges: [...weights.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind)),
    external: Object.fromEntries([...external].map(([m, s]) => [m, [...s].sort()])),
  };
}

const keep = ({ calls = true }: EdgeOpts) => (e: Edge) => calls || e.kind === 'imports';
/** Modules `id` imports (and calls). */
export const dependenciesOf = (g: Graph, id: string, opts: EdgeOpts = {}) => g.edges.filter((e) => e.from === id && keep(opts)(e));
/** Modules that import (or call) `id`. */
export const dependentsOf = (g: Graph, id: string, opts: EdgeOpts = {}) => g.edges.filter((e) => e.to === id && keep(opts)(e));

/** Every module that directly or transitively imports (or calls) `id`, breadth-first: hop 1 first. `via` is the module it reaches on the way. */
export function affectedBy(g: Graph, id: string, opts: EdgeOpts = {}): { id: string; hops: number; via: string }[] {
  const out: { id: string; hops: number; via: string }[] = [];
  const seen = new Set([id]);
  const queue = [{ id, hops: 0 }];
  for (let cur = queue.shift(); cur; cur = queue.shift()) {
    for (const e of dependentsOf(g, cur.id, opts).sort((a, b) => b.weight - a.weight)) {
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      out.push({ id: e.from, hops: cur.hops + 1, via: cur.id });
      queue.push({ id: e.from, hops: cur.hops + 1 });
    }
  }
  return out;
}

/** Chat context: who imports or calls this module and what it imports or calls, with the exact lines to cite. */
export function graphFacts(g: Graph, id: string, files: RepoFile[], nameOf: (id: string) => string) {
  const lines = new Map<string, string[]>();
  const code = (r: ImportRef) => {
    if (!lines.has(r.file)) lines.set(r.file, files.find((f) => f.path === r.file)?.content.split('\n') ?? []);
    return lines.get(r.file)!.slice(r.line - 1, r.kind === 'calls' ? r.line : r.endLine).map((l) => l.trim()).join(' ').slice(0, 160);
  };
  const cite = (r: ImportRef) => `[${r.file}:${r.kind === 'calls' || r.line === r.endLine ? r.line : `${r.line}-${r.endLine}`}]`;
  const block = (e: Edge, other: string) =>
    (e.kind === 'calls'
      ? `${nameOf(other)}, over the network (heuristic: a service lookup or URL, not an import), ${e.weight} call ${e.weight === 1 ? 'site' : 'sites'}:\n`
      : `${nameOf(other)}, ${e.weight} ${e.weight === 1 ? 'import' : 'imports'}:\n`) +
    g.imports
      .filter((r) => r.from === e.from && r.to === e.to && r.kind === e.kind)
      .slice(0, 8)
      .map((r) => `    ${cite(r)} ${code(r)}`)
      .join('\n');
  const pkgs = g.external[id] ?? [];
  return {
    dependents: dependentsOf(g, id).map((e) => block(e, e.from)),
    dependencies: [
      ...dependenciesOf(g, id).map((e) => block(e, e.to)),
      ...(pkgs.length ? [`outside packages (not in this repo): ${pkgs.join(', ')}`] : []),
    ],
  };
}

/** One gossip line from the graph, about the module's heaviest importer. */
export function graphGossip(g: Graph, id: string, nameOf: (id: string) => string): string | null {
  const top = dependentsOf(g, id, { calls: false }).sort((a, b) => b.weight - a.weight)[0];
  if (!top) return null;
  return `${nameOf(top.from)} imports me ${top.weight === 1 ? 'once' : `${top.weight} times`} and has never once said thanks.`;
}
