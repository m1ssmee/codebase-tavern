// Unified diffs: parse, apply to the real file, and make one from before/after text. Pure, no imports.
// Hunks are found by their context lines, so a bare "@@" (the Tribunal writes those) or wrong line numbers are fine.

export type DiffLine = { op: ' ' | '+' | '-'; text: string };
export type Hunk = { at?: number; lines: DiffLine[] };
export type FileDiff = { path: string; hunks: Hunk[] };

export function parseDiff(diff: string, fallbackPath = ''): FileDiff[] {
  const out: FileDiff[] = [];
  const raw = diff.replace(/\r/g, '').split('\n');
  const bare = new WeakSet<DiffLine>(); // "" lines: a blank context line that lost its space, or the trailing newline
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i];
    if (l.startsWith('--- ') && raw[i + 1]?.startsWith('+++ ')) continue;
    if (l.startsWith('+++ ') && raw[i - 1]?.startsWith('--- ')) {
      const path = l.slice(4).split('\t')[0].trim().replace(/^b\//, '');
      file = out.find((f) => f.path === path) ?? out[out.push({ path, hunks: [] }) - 1];
      hunk = null;
      continue;
    }
    if (l.startsWith('@@')) {
      file ??= out[out.push({ path: fallbackPath, hunks: [] }) - 1];
      const at = Number(l.match(/^@@ -(\d+)/)?.[1]);
      file.hunks.push((hunk = { ...(at ? { at } : {}), lines: [] }));
      continue;
    }
    if (!hunk || l.startsWith('\\')) continue; // preamble, "\ No newline at end of file"
    const line: DiffLine = l[0] === '+' || l[0] === '-' || l[0] === ' ' ? { op: l[0], text: l.slice(1) } : { op: ' ', text: l }; // models drop the context space
    if (l === '') bare.add(line);
    hunk.lines.push(line);
  }
  for (const f of out) for (const h of f.hunks) while (h.lines.length && bare.has(h.lines[h.lines.length - 1])) h.lines.pop();
  return out.filter((f) => f.hunks.some((h) => h.lines.some((l) => l.op !== ' ')));
}

/** First index ≥ from where `block` matches `lines` (exactly, then ignoring indentation); tries the hint first. */
function find(lines: string[], block: string[], from: number, hint?: number): number {
  if (!block.length) return hint ? Math.max(from, hint - 1) : from;
  for (const norm of [(s: string) => s, (s: string) => s.trim()]) {
    const ok = (at: number) => at + block.length <= lines.length && block.every((b, k) => norm(lines[at + k]) === norm(b));
    if (hint && hint - 1 >= from && ok(hint - 1)) return hint - 1;
    for (let at = from; at + block.length <= lines.length; at++) if (ok(at)) return at;
  }
  return -1;
}

/**
 * Applies one file's hunks. `changedOld`: 1-based lines of the original that were removed, or that an insertion
 * follows, so callers can tell which statements and declarations the change touches.
 */
export function applyDiff(original: string, fd: FileDiff): { text: string; changedOld: number[]; added: number; removed: number } | { error: string } {
  const lines = original.split('\n');
  const out: string[] = [];
  const changed = new Set<number>();
  let pos = 0;
  let added = 0;
  let removed = 0;
  for (const [n, h] of fd.hunks.entries()) {
    const old = h.lines.filter((l) => l.op !== '+').map((l) => l.text);
    const at = find(lines, old, pos, h.at);
    if (at < 0) return { error: `Hunk ${n + 1} of the change to ${fd.path} doesn't match the file.` };
    out.push(...lines.slice(pos, at));
    let o = at;
    for (const l of h.lines) {
      if (l.op === ' ') out.push(lines[o++]); // keep the file's own line, exact whitespace
      else if (l.op === '-') {
        changed.add(++o);
        removed++;
      } else {
        out.push(l.text);
        changed.add(Math.max(1, o)); // an insertion counts against the line before it
        added++;
      }
    }
    pos = o;
  }
  out.push(...lines.slice(pos));
  return { text: out.join('\n'), changedOld: [...changed].sort((a, b) => a - b), added, removed };
}

/** One-hunk unified diff between two versions of a file, 3 lines of context. Empty when nothing changed. */
export function makeDiff(path: string, before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  if (s === a.length && s === b.length) return '';
  const [aEnd, bEnd] = [a.length - e, b.length - e];
  const c0 = Math.max(0, s - 3);
  const tail = a.slice(aEnd, Math.min(a.length, aEnd + 3));
  const head = a.slice(c0, s);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${c0 + 1},${head.length + aEnd - s + tail.length} +${c0 + 1},${head.length + bEnd - s + tail.length} @@`,
    ...head.map((l) => ' ' + l),
    ...a.slice(s, aEnd).map((l) => '-' + l),
    ...b.slice(s, bEnd).map((l) => '+' + l),
    ...tail.map((l) => ' ' + l),
  ].join('\n');
}
