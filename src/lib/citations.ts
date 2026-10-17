import type { Citation } from './types';

// [path:line], [path:start-end], groups like [a.ts:3, 9-12, b.ts:4], and `path:line` in backticks
// (models do all of these). Path = no spaces/brackets/colons/commas; later parts inherit the last path.
const GROUP = /\[([^\[\]\n]+)\]|`([^`\n]+)`/g;
const ONE = /^\s*(?:([^\s:,[\]`]+):)?(\d+)(?:-(\d+))?\s*$/;

export type Segment = string | Citation;

function parseGroup(inner: string): Citation[] | null {
  const out: Citation[] = [];
  let path = '';
  for (const part of inner.split(',')) {
    const m = part.match(ONE);
    if (!m || !(m[1] || path)) return null;
    path = m[1] || path;
    const start = Number(m[2]);
    const end = m[3] ? Number(m[3]) : start;
    out.push({ path, startLine: Math.min(start, end), endLine: Math.max(start, end) });
  }
  return out;
}

// Splits text into plain strings and citations, in order. Shared by client (chips) and server (citations[]).
export function parseCitations(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(GROUP)) {
    const cites = parseGroup(m[1] ?? m[2]);
    if (!cites) continue; // not a citation: leave it in the surrounding text
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(...cites);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const extractCitations = (text: string) => parseCitations(text).filter((s): s is Citation => typeof s !== 'string');

/** A citation counts only if the file is in the repo and the lines exist. */
export const isValidCitation = (c: Citation, files: { path: string; lineCount: number }[]) => {
  const f = files.find((x) => x.path === c.path);
  return !!f && c.startLine >= 1 && c.endLine <= f.lineCount;
};
