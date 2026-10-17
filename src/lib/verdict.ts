// Tribunal fix-quality check. Pure, so `node scripts/check.mjs` can run it directly.

const isComment = (l: string) => /^(\/\/|#|\*|\/\*)/.test(l);

/**
 * True when the fix only bumps a timeout (every changed code line mentions a timeout) while the
 * hearing is about a retry or a duplicate charge: a symptom fix, not a root-cause fix.
 */
export function isTimeoutOnlyFix(diff: string, hearing: string): boolean {
  const changed = diff
    .split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l.slice(1).trim())
    .filter((l) => l && !isComment(l));
  if (!changed.length) return false;
  const timeoutOnly = changed.every((l) => /timeout/i.test(l));
  return timeoutOnly && /\b(retr(y|ies|ied|ying)|duplicate|twice|double)/i.test(hearing);
}

export const SYMPTOM_FIX_NOTE =
  'NOTE FROM THE COURT: your previous fix only changed a timeout value. That hides the symptom and was rejected. ' +
  'The evidence shows a retry without an idempotency key: fix the duplicate first (send and honour an idempotency key, ' +
  'or stop retrying a charge that is not safe to repeat).';

export const IDEMPOTENCY_SUGGESTION =
  ' The real fix is an idempotency key (a unique ID that makes a repeated request safe to repeat), so a retried charge is recognised as the same charge instead of a new one.';

/**
 * Pulls complete objects out of the "turns" array of a JSON document that is still streaming in, as soon
 * as each object's closing brace arrives. String-aware, so braces and quotes inside turn text are fine.
 */
export class TurnScanner {
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
      const m = /"turns"\s*:\s*\[/.exec(this.buf);
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
