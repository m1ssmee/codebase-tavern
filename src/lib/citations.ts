import type { Citation } from './types';

// [path:line] or [path:start-end]. Path = no spaces/brackets/colons.
const CITE = /\[([^\[\]\s:]+):(\d+)(?:-(\d+))?\]/g;

export type Segment = string | Citation;

// Splits text into plain strings and citations, in order. Shared by client (chips) and server (citations[]).
export function parseCitations(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const start = Number(m[2]);
    const end = m[3] ? Number(m[3]) : start;
    out.push({ path: m[1], startLine: Math.min(start, end), endLine: Math.max(start, end) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const extractCitations = (text: string) => parseCitations(text).filter((s): s is Citation => typeof s !== 'string');
