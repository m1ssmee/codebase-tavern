// Mermaid text: sanitising AI-written diagrams, `%% cite` comments, sequence messages, and the deterministic module
// and file charts for the Diagram tab. Pure (no Mermaid import), so `node scripts/check.mjs` runs it directly.
import type { Module, RepoFile } from './types';
import type { Graph } from './graph.ts';

export type DiagramCite = { target: string | number; path: string; startLine: number; endLine: number };
export type SeqMessage = { from: string; to: string; text: string; fatal: boolean; cite?: { path: string; startLine: number; endLine: number } };

/** For AI-written diagrams: no click/href/call lines, no init directives (they can loosen security), no HTML, no URLs. */
export function sanitizeDiagram(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => !/^\s*(click|href|call|style|classDef|linkStyle)\b/i.test(l) && !/^\s*%%\{/.test(l))
    .map((l) =>
      l
        .replace(/<\/?[a-z][^>]*>/gi, ' ')
        .replace(/\b(?:https?|ftp|javascript|data|vbscript):[^\s"')\]]*/gi, '')
        .replace(/\bwww\.[^\s"')\]]+/gi, '')
        .replace(/^(\s*Note\s+over\s+)(\w+)(?:\s*,\s*\w+)*\s*,\s*(\w+)\s*:/i, '$1$2,$3:') // a note spans at most two
        .replace(/\s+$/, ''),
    )
    .join('\n')
    .trim();
}

const CITE = /^\s*%%\s*cite\s+(?:([\w-]+)\s+)?([^\s:]+):(\d+)(?:-(\d+))?\s*$/;
const MESSAGE = /^\s*(\w+)\s*(-->>|->>|-->|->|--x|-x|--\)|-\))[+-]?\s*(\w+)\s*:\s*(.*)$/;

/** `%% cite NODE path:a-b` targets a flowchart node; a bare `%% cite path:a-b` targets the message just above it. */
export function parseCites(text: string): DiagramCite[] {
  const out: DiagramCite[] = [];
  let messages = 0;
  let afterMessage = false; // a bare cite belongs to the message directly above it, not to a note
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    const m = l.match(CITE);
    if (m) {
      const [start, end] = [Number(m[3]), Number(m[4] ?? m[3])];
      if (m[1] || afterMessage) out.push({ target: m[1] ?? messages - 1, path: m[2], startLine: Math.min(start, end), endLine: Math.max(start, end) });
      afterMessage = false;
      continue;
    }
    afterMessage = MESSAGE.test(l);
    if (afterMessage) messages++;
  }
  return out;
}

/** Messages of a sequenceDiagram in order; `fatal` = inside a `rect` block ("Where it all went wrong"). */
export function parseSequence(text: string): SeqMessage[] {
  const out: SeqMessage[] = [];
  const blocks: string[] = [];
  let afterMessage = false;
  for (const l of text.split('\n')) {
    const t = l.trim();
    if (/^rect\b/.test(t)) blocks.push('rect');
    else if (/^(loop|alt|opt|par|critical|break|box)\b/.test(t)) blocks.push('block');
    else if (t === 'end') blocks.pop();
    const m = l.match(MESSAGE);
    if (m) out.push({ from: m[1], to: m[3], text: m[4].trim(), fatal: blocks.includes('rect') });
    const c = l.match(CITE);
    if (c && !c[1] && afterMessage) out[out.length - 1].cite = { path: c[2], startLine: Number(c[3]), endLine: Number(c[4] ?? c[3]) };
    if (t) afterMessage = !!m;
  }
  return out;
}

/** Participant id for a module: letters, digits and _ only. */
export const participantId = (moduleId: string) => moduleId.replace(/[^A-Za-z0-9_]/g, '_');

/** Safe inside a quoted flowchart label. */
export const escLabel = (s: string) => s.replace(/[#"<>`]/g, (c) => ({ '#': '#35;', '"': '#quot;', '<': '#lt;', '>': '#gt;', '`': '#96;' })[c]!);

const IMPORT_STROKE = 'stroke:#8a8580,stroke-width:1.6px';
const CALL_STROKE = 'stroke:#6f93bd,stroke-width:1.6px';
const CYCLE_STROKE = 'stroke:#d9381e,stroke-width:2.4px,stroke-dasharray:6 4';
const plural = (n: number, w: string) => `${n.toLocaleString('en')} ${w}${n === 1 ? '' : 's'}`;

/** Modules as nodes (title + one stat line), imports solid with counts, calls dashed, cycle edges red. */
export function moduleChart(modules: Module[], g: Graph, title: (id: string) => string, cycle: Set<string>) {
  const ids = new Map(modules.map((m, i) => [m.id, `m${i}`]));
  const lines = ['flowchart TD'];
  for (const m of modules) {
    lines.push(`  ${ids.get(m.id)}["${escLabel(title(m.id))}<br/>${plural(m.stats.totalLines, 'line')} · ${m.stats.hasTests ? 'has tests' : 'no tests'}"]`);
  }
  const styles: string[] = [];
  const edges = g.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  edges.forEach((e, k) => {
    const [a, b] = [ids.get(e.from), ids.get(e.to)];
    lines.push(e.kind === 'calls' ? `  ${a} -.->|"talks over the network"| ${b}` : `  ${a} -->|"imports ${e.weight}×"| ${b}`);
    styles.push(`  linkStyle ${k} ${cycle.has(`${e.from}>${e.to}`) ? CYCLE_STROKE : e.kind === 'calls' ? CALL_STROKE : IMPORT_STROKE}`);
  });
  lines.push(...styles, '  classDef mod fill:#ffffff,stroke:#171717,stroke-width:1.5px,color:#171717');
  if (modules.length) lines.push(`  class ${modules.map((m) => ids.get(m.id)).join(',')} mod`);
  return { code: lines.join('\n'), ids, edges };
}

/** One module's files (largest first, capped), the imports between them, and where they reach other modules. */
export function fileChart(mod: Module, files: RepoFile[], g: Graph, nameOf: (id: string) => string, max = 24) {
  const own = files.filter((f) => mod.filePaths.includes(f.path)).sort((a, b) => b.lineCount - a.lineCount);
  const shown = own.slice(0, max);
  const ids = new Map(shown.map((f, i) => [f.path, `f${i}`]));
  const biggest = shown[0]?.path;
  const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
  const lines = ['flowchart LR'];
  for (const f of shown) {
    lines.push(`  ${ids.get(f.path)}["${escLabel(base(f.path))}<br/>${plural(f.lineCount, 'line')}${f.path === biggest && shown.length > 1 ? ' · the load-bearing file' : ''}"]`);
  }
  if (own.length > shown.length) lines.push(`  more["+${own.length - shown.length} more files"]`);
  const ext = new Map<string, string>();
  const seen = new Set<string>();
  const styles: string[] = [];
  let k = 0;
  for (const r of g.imports) {
    const a = ids.get(r.file);
    if (!a || !r.to) continue;
    let b = r.target && ids.get(r.target);
    if (!b && r.to !== mod.id) {
      if (!ext.has(r.to)) {
        ext.set(r.to, `x${ext.size}`);
        lines.push(`  x${ext.size - 1}(["${escLabel(nameOf(r.to))}"])`);
      }
      b = ext.get(r.to)!;
    }
    const key = `${a}>${b}>${r.kind}`;
    if (!b || a === b || seen.has(key)) continue;
    seen.add(key);
    lines.push(r.kind === 'calls' ? `  ${a} -.->|"talks over the network"| ${b}` : `  ${a} --> ${b}`);
    styles.push(`  linkStyle ${k++} ${r.kind === 'calls' ? CALL_STROKE : IMPORT_STROKE}`);
  }
  lines.push(...styles, '  classDef file fill:#ffffff,stroke:#171717,stroke-width:1.4px,color:#171717', '  classDef ext fill:#f5f5f5,stroke:#b8b2a8,color:#555555');
  if (shown.length) lines.push(`  class ${[...ids.values()].join(',')} file`);
  if (ext.size) lines.push(`  class ${[...ext.values()].join(',')} ext`);
  return { code: lines.join('\n'), ids, ext };
}
