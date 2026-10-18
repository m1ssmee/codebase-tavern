// Tribunal fix-quality check. Pure, so `node scripts/check.mjs` can run it directly.
import type { SpiceLevel } from './types';

// Comment lines (JS/TS/C-style, Python/shell #, HTML). Preprocessor lines like #include are code.
const isComment = (l: string) => /^(\/\/|\/\*|\*|<!--|#(?!include|define|if|endif|pragma|!))/.test(l);
const isTestFile = (p: string) => /(^|\/)(__tests__|tests?|spec)\/|[._-](test|spec)\.[a-z]+$|(^|\/)(tests?|spec)\.[a-z]+$/i.test(p);
const RETRY_OR_DUPLICATE = /\b(retr(y|ies|ied|ying)|duplicate|twice|double)/i;

/**
 * Why a verdict's fix is unacceptable, or null if it's fine. A fix must change executable code in at least
 * one culprit module: not only comments/whitespace, not only tests (tests alongside real code are fine), and
 * not only a timeout bump when the hearing is about a retry or duplicate (that hides the symptom).
 * `culpritFiles` empty = skip the culprit-module check.
 */
export function fixProblem(fix: { path: string; diff: string }, culpritFiles: string[], hearing: string): string | null {
  let file = fix.path;
  const changed: { file: string; code: string }[] = [];
  for (const raw of fix.diff.split('\n')) {
    const header = raw.match(/^\+\+\+ (?:b\/)?(\S+)/);
    if (header) {
      file = header[1];
      continue;
    }
    if (/^(---|@@)/.test(raw) || !/^[+-]/.test(raw)) continue;
    const code = raw.slice(1).trim();
    if (code && !isComment(code)) changed.push({ file, code });
  }
  if (!changed.length) return 'it only edits comments or whitespace';
  const real = changed.filter((c) => !isTestFile(c.file));
  if (!real.length) return 'it only changes test files';
  if (culpritFiles.length && !real.some((c) => culpritFiles.includes(c.file))) return 'it does not change code in any culprit module';
  if (real.every((c) => /timeout/i.test(c.code)) && RETRY_OR_DUPLICATE.test(hearing))
    return 'it only raises a timeout while the evidence shows a retry without an idempotency key';
  return null;
}

/** Back-compat helper (and the narrow case the earlier checks cover). */
export const isTimeoutOnlyFix = (diff: string, hearing: string) => fixProblem({ path: '', diff }, [], hearing)?.includes('timeout') ?? false;

export const rejectNote = (reason: string) =>
  `NOTE FROM THE COURT: your previous fix was rejected because ${reason}. The fix must change executable code in at least one ` +
  'culprit module and remove the root cause; tests may be added alongside the code change, but never on their own. ' +
  'When the evidence shows a retry without an idempotency key, fix the duplicate first (send and honour an idempotency key, ' +
  'or stop retrying a request that is not safe to repeat).';

/** Said in the root cause when even the regenerated fix is unacceptable. */
export const realFixNeeded = (hearing: string, culprits: string[]) =>
  RETRY_OR_DUPLICATE.test(hearing)
    ? ' The real fix is a code change: an idempotency key (a unique ID that makes a repeated request safe to repeat), so a retried charge is recognised as the same charge instead of a new one.'
    : ` The real fix has to change the executable code in ${culprits.join(' and ') || 'the culprit module'}, not only comments or tests.`;

/**
 * Pulls complete objects out of one array (default "turns") of a JSON document that is still streaming in, as
 * soon as each object's closing brace arrives. String-aware, so braces and quotes inside text are fine.
 */
export class TurnScanner {
  private readonly key: string;
  constructor(key = 'turns') {
    this.key = key;
  }
  private buf = '';
  private pos = 0;
  private inArray = false;
  private done = false;
  private depth = 0;
  private inStr = false;
  private esc = false;
  private start = -1;

  push(chunk: string): unknown[] {
    this.buf += chunk;
    const out: unknown[] = [];
    if (this.done) return out;
    if (!this.inArray) {
      const m = new RegExp(`"${this.key}"\\s*:\\s*\\[`).exec(this.buf);
      if (!m) return out;
      this.inArray = true;
      this.pos = m.index + m[0].length;
    }
    for (; this.pos < this.buf.length; this.pos++) {
      const ch = this.buf[this.pos];
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (ch === '\\') this.esc = true;
        else if (ch === '"') this.inStr = false;
      } else if (ch === '"') this.inStr = true;
      else if (ch === '{') {
        if (this.depth++ === 0) this.start = this.pos;
      } else if (ch === '}') {
        if (--this.depth === 0 && this.start >= 0) {
          try {
            out.push(JSON.parse(this.buf.slice(this.start, this.pos + 1)));
          } catch {
            // malformed turn: skip it; the full document parse at the end still decides the verdict
          }
          this.start = -1;
        }
      } else if (ch === ']' && this.depth === 0) {
        this.done = true;
        this.pos++;
        break;
      }
    }
    return out;
  }
}

// The judge's closing remark when none of the 3 written variants survive the filter. {who} = the culprits.
const JUDGE: Record<SpiceLevel, string[]> = {
  clean: ['Guilty: {who}. The court has seen this exact retry before and expects to see it again.', '{who}, guilty as charged. Court is adjourned until the next incident report.'],
  unhinged: ['Guilty: {who}. Fix the damn thing before it comes back to my courtroom.', '{who}, guilty as hell. Court is adjourned until the next shitty incident.'],
  feral: ['Guilty: {who}. This whole damn case stinks and the court is done smelling it.', '{who}, guilty. Get this shit out of my courtroom and open a window.'],
  nuclear: ['Guilty: {who}. GET THIS OUT OF MY COURTROOM. I am holding a damn grudge.', '{who}, guilty as hell. Court is adjourned and I am never forgiving this shit.'],
};
export function judgeFallback(spice: unknown, culprits: string[], seed: string): string {
  const l = (typeof spice === 'string' && spice in JUDGE ? spice : 'unhinged') as SpiceLevel;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return JUDGE[l][h % JUDGE[l].length].replace('{who}', culprits.join(' and ') || 'everyone in this repo');
}
