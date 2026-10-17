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
  'or stop retrying a charge that is not safe to repeat). Return the complete JSON again.';

export const IDEMPOTENCY_SUGGESTION =
  ' The real fix is an idempotency key (a unique ID that makes a repeated request safe to repeat), so a retried charge is recognised as the same charge instead of a new one.';
