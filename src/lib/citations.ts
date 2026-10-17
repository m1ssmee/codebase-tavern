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

// --- Citation verification. A citation must point at code that contains what its sentence names: the cited lines
// (±2) must hold at least one of the sentence's code names or values (function names, variables, numbers like
// 2000). If not, the same file is searched and the citation re-anchored on the best matching line; if nothing
// matches, it is dropped. A sentence with no code names or values can't be checked and keeps its citation.

export type CiteCounts = { verified: number; repaired: number; dropped: number; unchecked: number };

/** Numbers as written: 1,051 → 1051, 2_000 → 2000; not the digits inside names like p50. */
const numbersIn = (text: string) => [...text.replace(/(\d)[,_](?=\d{3}\b)/g, '$1').matchAll(/(?<![\w.])\d+(?:\.\d+)?/g)].map((m) => m[0]);

/** The code names and values a sentence mentions: anything in backticks, snake_case, camelCase, name(), numbers ≥ 10. */
export function claimTerms(sentence: string): string[] {
  const out = new Set<string>();
  for (const m of sentence.matchAll(/`([^`\n]+)`/g)) {
    const code = m[1].trim();
    if (/\/|^[\w.-]+\.[a-z]{1,4}$/i.test(code)) continue; // a file path, not a code name
    // `amount`, `checkout()`, `res.send()` (the member called), else only code-shaped names inside (`MAX_TRIES = 2`).
    const one = code.match(/^(?:[\w$]+\.)*([A-Za-z_$][\w$]*)(?:\(.*\))?$/);
    if (one) {
      if (one[1].length >= 3) out.add(one[1]);
    } else for (const w of code.match(/[A-Za-z_$][\w$]*/g) ?? []) if (/_|[a-z][A-Z]/.test(w)) out.add(w);
  }
  const plain = sentence.replace(/`[^`\n]*`/g, ' ');
  for (const m of plain.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(\(\))?/g)) if (m[2] || /_/.test(m[1].slice(1, -1)) || /[a-z][A-Z]/.test(m[1])) out.add(m[1]);
  for (const m of sentence.matchAll(/`([^`\n]+)`/g)) if (!/\//.test(m[1])) numbersIn(m[1]).forEach((n) => Number(n) >= 10 && out.add(n));
  numbersIn(plain).forEach((n) => (Number(n) >= 10 || n.includes('.')) && out.add(n));
  return [...out];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasTerm = (line: string, t: string) => (/^\d/.test(t) ? numbersIn(line).includes(t) : new RegExp(`(?<![\\w$])${esc(t)}(?![\\w$])`).test(line));
/** The clause right before a citation: after the last comma, semicolon, colon, dash or "which/while/but/because". */
const lastClause = (text: string) => text.split(/[;:,]\s+|\s+[—–]\s+|\s+(?:which|while|but|because|whereas|so)\s+/).filter((p) => /[\w`]/.test(p)).at(-1) ?? '';
const IMPORT = /^\s*(import\b|export\s*\{[^}]*\}\s*from\b|.*\brequire\()/;
// A function, method or class definition line, and its name.
// Identifier groups are bounded ({0,63}) so a long run of letters can't make the match backtrack quadratically.
const DEF =
  /\bfunction\s*\*?\s+([A-Za-z_$][\w$]{0,63})|\b([A-Za-z_$][\w$]{0,63})\s*[:=]\s*(?:async\s+)?(?:function\b|\([^)]{0,200}\)\s*=>|[A-Za-z_$][\w$]{0,63}\s*=>)|\bdef\s+([A-Za-z_]\w{0,63})|\bclass\s+([A-Za-z_$][\w$]{0,63})|^\s*(?:(?:public|private|protected|static|async)\s+)*([A-Za-z_$][\w$]{0,63})\s*\([^)]{0,200}\)\s*(?::\s*[^{=]{1,200})?\{\s*$/;
/** The functions a line sits in: definitions above it, innermost first, up to the first top-level one (within 150 lines). */
function enclosing(lines: string[], line: number): string[] {
  const out: string[] = [];
  for (let i = Math.min(line, lines.length) - 1; i >= Math.max(0, line - 150); i--) {
    const name = lines[i].match(DEF)?.slice(1).find(Boolean);
    if (!name || /^(if|for|while|switch|catch|with|return|else|do|try|function|constructor)$/.test(name)) continue;
    out.push(name);
    if (!/^\s/.test(lines[i])) break;
  }
  return out;
}
/** The last sentence of some prose (the one a citation right after it supports). */
const lastSentence = (prose: string) => {
  const parts = prose.split(/\n+|(?<=[.!?])\s+/).filter((p) => /[\w`]/.test(p));
  return parts.at(-1) ?? '';
};

export class CiteChecker {
  readonly counts: CiteCounts = { verified: 0, repaired: 0, dropped: 0, unchecked: 0 };
  readonly changes: string[] = []; // what was repaired or dropped, for the server log
  private readonly files: Map<string, string[]>;
  private readonly found = new Map<string, boolean>();
  private prose = '';
  private since = '';
  private sentenceAt = -1;
  private cited: string[] = []; // files already cited in the current sentence
  private readonly aliasCache = new Map<string, string[]>();
  private checked = 0;
  /**
   * `files`: path → its lines, exactly as numbered for the model. The code comes from the client: lines are cut to
   * 400 characters before any matching (a minified line has nothing to cite), and one request checks at most 80 citations.
   */
  constructor(files: Map<string, string[]>) {
    this.files = new Map([...files].map(([p, ls]) => [p, ls.map((l) => (l.length > 400 ? l.slice(0, 400) : l))]));
  }

  private has(path: string, t: string): boolean {
    const k = `${path}\n${t}`;
    if (!this.found.has(k)) this.found.set(k, (this.files.get(path) ?? []).some((l) => hasTerm(l, t)));
    return this.found.get(k)!;
  }

  /** A value often reaches the code through a constant (UPSTREAM_TIMEOUT_MS = 2000): its name counts as the value. */
  private aliases(n: string): string[] {
    if (!/^\d{3,12}$/.test(n)) return [];
    if (!this.aliasCache.has(n)) {
      const re = new RegExp(`\\b([A-Z][A-Z0-9]{0,40}_[A-Z0-9_]{1,40}|[a-z]{1,40}[A-Z]\\w{0,40})\\s*[:=]\\s*${n.replace(/\B(?=(\d{3})+$)/g, '_?')}(?![\\d.])`);
      const out = new Set<string>();
      for (const lines of this.files.values()) for (const l of lines) out.add(l.match(re)?.[1] ?? '');
      out.delete('');
      this.aliasCache.set(n, [...out].slice(0, 3));
    }
    return this.aliasCache.get(n)!;
  }

  /**
   * One citation, checked against the code names and values in `segment` (the words since the previous citation
   * in this sentence, or the sentence): kept, re-anchored, or null (dropped). Only names and values that exist in
   * the code shown count (a proposed new value or a made-up name can't be checked), and one found in a file this
   * sentence already cited belongs to that citation. It is dropped only when the clause right before it names
   * real code that isn't in the cited file; a number alone never drops it. Unknown files pass through.
   */
  one(segment: string, c: Citation, earlier: string[] = []): Citation | null {
    const lines = this.files.get(c.path);
    if (!lines) return c; // not a file we were shown: the caller's own checks decide
    if (++this.checked > 80) return this.counts.unchecked++, c;
    const paths = [...this.files.keys()];
    const fact = (t: string) => this.has(c.path, t) || (paths.some((p) => this.has(p, t)) && !earlier.some((p) => p !== c.path && this.has(p, t)));
    const raw = claimTerms(segment);
    const terms = raw.flatMap((t) => [t, ...this.aliases(t)]).filter(fact);
    const n = lines.length;
    // A number that is the file's length, the range's length or a line inside it is about the citation itself.
    const about = raw.some((t) => /^\d+$/.test(t) && (Number(t) === n || Number(t) === c.endLine - c.startLine + 1 || (Number(t) >= c.startLine && Number(t) <= c.endLine)));
    if (about) return this.counts.verified++, c;
    if (!terms.length) return this.counts.unchecked++, c;
    const lo = Math.max(0, c.startLine - 3);
    const hi = Math.min(n - 1, c.endLine + 1);
    for (let i = lo; i <= hi; i++) if (terms.some((t) => hasTerm(lines[i], t))) return this.counts.verified++, c;
    // Lines inside the function the sentence names (the body of `redirect()`) support it too.
    if (enclosing(lines, c.startLine).some((f) => terms.includes(f))) return this.counts.verified++, c;
    const was = `${c.path}:${c.startLine}-${c.endLine}`;
    let best = -1;
    let score = 0;
    const dist = (i: number) => (i + 1 < c.startLine ? c.startLine - i - 1 : i + 1 > c.endLine ? i + 1 - c.endLine : 0);
    // Re-anchor on code names and on big or precise numbers (2000, 19.99); a small number like 200 is too common.
    const movers = terms.filter((t) => !/^\d+$/.test(t) || Number(t) >= 1000);
    lines.forEach((l, i) => {
      const hits = movers.filter((t) => hasTerm(l, t)).length;
      const s = hits && IMPORT.test(l) ? hits - 0.5 : hits; // an import line only if nothing else matches
      if (s > score || (s === score && s > 0 && dist(i) < dist(best))) [best, score] = [i, s];
    });
    if (best >= 0) {
      this.counts.repaired++;
      const len = Math.max(0, Math.min(c.endLine, n) - c.startLine);
      const at = best + 1;
      const start = at < c.startLine ? at : Math.max(1, at - len);
      if (this.changes.length < 6) this.changes.push(`moved ${was} to ${start}-${Math.min(n, start + len)} (${terms.slice(0, 3).join(', ')})`);
      return { path: c.path, startLine: start, endLine: Math.min(n, start + len) };
    }
    // Dropped only if the clause right before it names real code from elsewhere and the sentence never mentions this
    // file or its folder ("when the gateway aborts and `checkout()` retries [gateway/proxy.ts:31]" keeps its citation).
    const named = claimTerms(lastClause(segment)).filter((t) => !/^\d/.test(t) && fact(t));
    const own = c.path.replace(/\.[^./]+$/, '').split('/').filter((x) => x.length > 2);
    if (!named.length || own.some((x) => new RegExp(`\\b${esc(x)}\\b`, 'i').test(segment))) return this.counts.unchecked++, c;
    this.counts.dropped++;
    if (this.changes.length < 6) this.changes.push(`dropped ${was}: "${lastClause(segment).slice(-60)}" names ${named.slice(0, 3).join(', ')}`);
    return null;
  }

  /** One whole text: every citation checked against the sentence before it. */
  text(t: string): string {
    this.prose = this.since = '';
    this.sentenceAt = -1;
    return this.piece(t);
  }

  /** The next piece of a longer text (a stream), with no half-open citation in it. */
  piece(t: string): string {
    let out = '';
    for (const seg of parseCitations(t)) {
      if (typeof seg === 'string') {
        out += seg;
        this.prose += seg;
        this.since += seg;
        continue;
      }
      const sentence = lastSentence(this.prose);
      const at = this.prose.lastIndexOf(sentence);
      if (at !== this.sentenceAt) [this.sentenceAt, this.cited] = [at, []];
      // The words since the previous citation in this sentence, else the whole sentence.
      const near = lastSentence(this.since);
      const c = this.one(claimTerms(near).length ? near : sentence, seg, this.cited);
      this.since = '';
      if (c) {
        this.cited.push(c.path);
        out += `[${c.path}:${c.startLine}${c.endLine !== c.startLine ? `-${c.endLine}` : ''}]`;
      }
    }
    return out.replace(/ +([.,;])/g, '$1');
  }
}

/** Streams text through a CiteChecker: holds back only a citation or code span that is still open. */
export class CiteStream {
  private all = '';
  private done = 0;
  private readonly checker: CiteChecker;
  constructor(checker: CiteChecker) {
    this.checker = checker;
  }
  push(chunk: string): string {
    this.all += chunk;
    let safe = this.all.length;
    const open = this.all.lastIndexOf('[');
    if (open >= this.done && !this.all.includes(']', open) && safe - open < 300) safe = open;
    const tick = this.all.lastIndexOf('`');
    if ((this.all.slice(this.done).match(/`/g)?.length ?? 0) % 2 === 1 && this.all.length - tick < 300) safe = Math.min(safe, tick);
    const piece = this.all.slice(this.done, safe);
    this.done = safe;
    return piece ? this.checker.piece(piece) : '';
  }
  end(): string {
    const piece = this.all.slice(this.done);
    this.done = this.all.length;
    return piece ? this.checker.piece(piece) : '';
  }
}
