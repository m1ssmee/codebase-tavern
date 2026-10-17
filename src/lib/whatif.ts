// "What if I change this?", the deterministic half: which modules a change touches and why, from the diff and
// the graph alone. This list is the ground truth; the AI may only comment on modules in it. Pure, so
// `node scripts/check.mjs` runs it directly.
import type { Module, RepoFile } from './types';
import { affectedBy, type Graph, type ImportRef } from './graph.ts';
import { applyDiff, makeDiff, parseDiff } from './diff.ts';

export type Cite = { path: string; line: number; endLine: number; code: string };
export type Role = 'changed' | 'upstream' | 'downstream';
export type ImpactItem = {
  moduleId: string;
  role: Role;
  hops: number; // 0 changed, 1+ ripple distance
  via?: string; // the module it is reached through
  why: string; // "imports orders", "calls orders over the network", "receives orders' call"
  lines: Cite[]; // the changed region, or the importing / calling lines
  usages: (Cite & { symbol: string })[]; // uses of an exported symbol the change touches
};
export type FileChange = { path: string; moduleId: string; before: string; after: string; changedOld: number[]; added: number; removed: number };
export type Impact = { files: FileChange[]; items: ImpactItem[]; symbols: string[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMMENT = /^\s*(\/\/|#|\*|\/\*)/;
// Declarations whose name other files can import. [1] or [2] is the name.
const EXPORTED = [
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/,
  /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/, // Python, top level
  /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=\s*function/, // app.render = function render(…)
];
const ANY_DECL = [
  ...EXPORTED,
  /^\s*(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^\s*class\s+([A-Za-z_$][\w$]*)/,
];
const nameIn = (l: string, res: RegExp[]) => {
  for (const re of res) {
    const m = l.match(re);
    if (m) return m[2] ?? m[1];
  }
  return null;
};

/** Local names an import statement brings in: { a, b as c } → a, c; import X; * as ns; const X = require(); from x import a. */
export function importedNames(stmt: string): string[] {
  const s = stmt.replace(/\s+/g, ' ');
  const out: string[] = [];
  const braces = s.match(/\{([^}]*)\}/)?.[1];
  if (braces) out.push(...braces.split(',').map((p) => p.trim().replace(/^type\s+/, '').split(/\s+as\s+|\s*:\s*/).pop()!));
  out.push(s.match(/^\s*import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from)/)?.[1] ?? '');
  out.push(s.match(/\*\s+as\s+([\w$]+)/)?.[1] ?? '');
  out.push(s.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require/)?.[1] ?? '');
  const py = s.match(/^\s*from\s+\S+\s+import\s+(.+)$/)?.[1];
  if (py) out.push(...py.replace(/[()]/g, '').split(',').map((p) => p.trim().split(/\s+as\s+/).pop()!));
  const pyi = s.match(/^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?\s*$/);
  if (pyi) out.push(pyi[2] ?? pyi[1].split('.')[0]);
  return [...new Set(out.filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)))];
}

/** Exported symbol that encloses line n (1-based): the nearest top-level declaration above it. */
function enclosingExport(lines: string[], n: number): string | null {
  for (let i = Math.min(n, lines.length) - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.trim() || COMMENT.test(l) || /^\s/.test(l) || /^[}\])]/.test(l)) continue;
    return nameIn(l, EXPORTED);
  }
  return null;
}

export function computeImpact(files: RepoFile[], modules: Module[], g: Graph, diff: string, fallbackPath = ''): Impact | { error: string } {
  const owner = new Map(modules.flatMap((m) => m.filePaths.map((p) => [p, m.id] as const)));
  const nameOf = (id: string) => modules.find((m) => m.id === id)?.name ?? id;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const lineOf = (path: string, n: number) => (byPath.get(path)?.content.split('\n')[n - 1] ?? '').trim().slice(0, 160);
  const cite = (r: ImportRef): Cite => ({ path: r.file, line: r.line, endLine: r.kind === 'calls' ? r.line : r.endLine, code: lineOf(r.file, r.line) });

  const fds = parseDiff(diff, fallbackPath);
  if (!fds.length) return { error: 'The change is empty.' };
  const changes: FileChange[] = [];
  const changedText = new Map<string, string>();
  for (const fd of fds) {
    // Models sometimes drop a leading folder: accept a unique suffix match.
    const f = byPath.get(fd.path) ?? (() => {
      const hits = files.filter((x) => fd.path && x.path.endsWith('/' + fd.path));
      return hits.length === 1 ? hits[0] : undefined;
    })();
    if (!f) return { error: `${fd.path || 'The changed file'} is not in the loaded files.` };
    const r = applyDiff(f.content, fd);
    if ('error' in r) return r;
    changes.push({ path: f.path, moduleId: owner.get(f.path) ?? '(misc)', before: f.content, after: r.text, changedOld: r.changedOld, added: r.added, removed: r.removed });
    changedText.set(f.path, fd.hunks.flatMap((h) => h.lines.filter((l) => l.op !== ' ').map((l) => l.text)).join('\n'));
  }

  const items = new Map<string, ImpactItem>();
  const changedIds = [...new Set(changes.map((c) => c.moduleId))];
  for (const id of changedIds) {
    const lines = changes
      .filter((c) => c.moduleId === id)
      .map((c) => {
        const [a, b] = [c.changedOld[0], c.changedOld[c.changedOld.length - 1]];
        return { path: c.path, line: a, endLine: b, code: lineOf(c.path, a) };
      });
    items.set(id, { moduleId: id, role: 'changed', hops: 0, why: 'changed', lines, usages: [] });
  }

  // Upstream: everything that imports or calls a changed module, hop by hop.
  for (const id of changedIds) {
    for (const a of affectedBy(g, id)) {
      const prev = items.get(a.id);
      if (prev && (prev.role !== 'upstream' || prev.hops <= a.hops)) continue;
      const refs = g.imports.filter((r) => r.from === a.id && r.to === a.via);
      const why = refs.some((r) => r.kind === 'imports') ? `imports ${nameOf(a.via)}` : `calls ${nameOf(a.via)} over the network`;
      items.set(a.id, { moduleId: a.id, role: 'upstream', hops: a.hops, via: a.via, why, lines: refs.slice(0, 6).map(cite), usages: [] });
    }
  }

  // Downstream: modules whose call sites sit in the changed lines (they now receive something different).
  const addDown = (to: string, via: string, r: ImportRef, why: string) => {
    if (changedIds.includes(to)) return;
    const it = items.get(to);
    if (it) {
      if (!it.lines.some((c) => c.path === r.file && c.line === r.line)) it.lines.push(cite(r));
      return;
    }
    items.set(to, { moduleId: to, role: 'downstream', hops: 1, via, why, lines: [cite(r)], usages: [] });
  };
  for (const c of changes) {
    const touched = (r: ImportRef) => c.changedOld.some((n) => n >= r.line && n <= r.endLine);
    const text = changedText.get(c.path) ?? '';
    for (const r of g.imports) {
      if (r.file !== c.path || !r.to || r.to === c.moduleId) continue;
      if (r.kind === 'calls' && touched(r)) addDown(r.to, c.moduleId, r, `receives a changed call from ${nameOf(c.moduleId)}`);
      if (r.kind === 'imports') {
        const stmt = byPath.get(c.path)!.content.split('\n').slice(r.line - 1, r.endLine).join(' ');
        const used = importedNames(stmt).filter((n) => new RegExp(`\\b${esc(n)}\\b`).test(text));
        if (used.length) addDown(r.to, c.moduleId, r, `${nameOf(c.moduleId)} changes how it uses ${used.join(', ')}`);
      }
    }
  }

  // Exported symbols the change declares or sits inside, and where other files use them.
  const symbols: { name: string; path: string }[] = [];
  for (const c of changes) {
    const lines = c.before.split('\n');
    const names = new Set<string>();
    for (const n of c.changedOld) {
      const declared = nameIn(lines[n - 1] ?? '', EXPORTED);
      const removedHere = (changedText.get(c.path) ?? '').split('\n').some((t) => t.trim() && t.trim() === (lines[n - 1] ?? '').trim());
      if (declared && removedHere) names.add(declared);
      else {
        const enc = enclosingExport(lines, n);
        if (enc) names.add(enc);
      }
    }
    for (const name of names) symbols.push({ name, path: c.path });
  }
  for (const s of symbols) {
    const re = new RegExp(`\\b${esc(s.name)}\\b`);
    const users = [...new Set(g.imports.filter((r) => r.kind === 'imports' && r.target === s.path && r.file !== s.path).map((r) => r.file))];
    const changedHere = changes.find((c) => c.path === s.path)!.changedOld;
    for (const file of [s.path, ...users]) {
      const mod = owner.get(file);
      const lines = byPath.get(file)?.content.split('\n') ?? [];
      const found = lines
        .map((l, i) => ({ l, n: i + 1 }))
        .filter(({ l, n }) => re.test(l) && !COMMENT.test(l) && !(file === s.path && changedHere.includes(n)))
        .slice(0, 8)
        .map(({ l, n }) => ({ path: file, line: n, endLine: n, code: l.trim().slice(0, 160), symbol: s.name }));
      if (!mod || !found.length) continue;
      const it = items.get(mod) ?? { moduleId: mod, role: 'upstream' as const, hops: 1, via: owner.get(s.path), why: `uses ${s.name}`, lines: [], usages: [] };
      it.usages.push(...found);
      items.set(mod, it);
    }
  }

  const rank = { changed: 0, upstream: 1, downstream: 2 };
  return {
    files: changes,
    items: [...items.values()].sort((a, b) => a.hops - b.hops || rank[a.role] - rank[b.role]),
    symbols: [...new Set(symbols.map((s) => s.name))],
  };
}

// --- Presets. Deterministic ones build their diff here; the rest go to the model as a description.

/** First declaration in lines [start, end] (1-based): what "Rename it" renames. */
export function declaredIn(content: string, start: number, end: number): { name: string; line: number } | null {
  const lines = content.split('\n');
  for (let n = start; n <= Math.min(end, lines.length); n++) {
    const name = nameIn(lines[n - 1], ANY_DECL);
    if (name) return { name, line: n };
  }
  return null;
}

/** Renames the declaration only (callers keep the old name), so the impact shows who breaks. */
export function renameDiff(path: string, content: string, start: number, end: number): string | null {
  const d = declaredIn(content, start, end);
  if (!d) return null;
  const lines = content.split('\n');
  lines[d.line - 1] = lines[d.line - 1].replace(new RegExp(`\\b${esc(d.name)}\\b`), `${d.name}V2`);
  return makeDiff(path, content, lines.join('\n'));
}

export function deleteDiff(path: string, content: string, start: number, end: number): string {
  const lines = content.split('\n');
  lines.splice(start - 1, end - start + 1);
  return makeDiff(path, content, lines.join('\n'));
}

/** Which "Remove this …" preset fits the selection, if any. */
export const retryOrCheck = (code: string): 'retry' | 'check' | null =>
  /retr(y|ies|ied)|attempt/i.test(code) ? 'retry' : /\bif\s*\(|\bif\s+\w|\bassert\b|\bthrow\b|\braise\b|valid|guard/i.test(code) ? 'check' : null;

/** quickcart's three suggested changes, as exact edits to the real files. */
export const QUICKCART_SUGGESTIONS = [
  {
    label: 'Add an idempotency key',
    path: 'orders/checkout.ts',
    find: '      order_id: order.id,\n',
    replace: '      idempotency_key: order.id,\n      order_id: order.id,\n',
  },
  {
    label: 'Remove the retry',
    path: 'orders/checkout.ts',
    find: 'const MAX_PAYMENT_ATTEMPTS = 2;',
    replace: 'const MAX_PAYMENT_ATTEMPTS = 1;',
  },
  {
    label: 'Raise the gateway timeout to 5000ms',
    path: 'gateway/config.ts',
    find: 'export const UPSTREAM_TIMEOUT_MS = 2000;',
    replace: 'export const UPSTREAM_TIMEOUT_MS = 5000;',
  },
];

export function suggestionDiff(files: RepoFile[], s: (typeof QUICKCART_SUGGESTIONS)[number]): string | null {
  const f = files.find((x) => x.path === s.path);
  return f?.content.includes(s.find) ? makeDiff(s.path, f.content, f.content.replace(s.find, s.replace)) : null;
}

/** Same resulting files = same change, whatever the diff looked like (for matching the saved demo run). */
export const sameChange = (a: FileChange[], b: FileChange[]) =>
  a.length === b.length && a.every((x) => b.some((y) => y.path === x.path && y.after === x.after));
