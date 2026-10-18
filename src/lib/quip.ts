// The bubble over a character's head: a short, in-character version of THAT answer, never a repeat of the chat. The
// AI writes it in the same call (chat: a final "@@bubble:" line the server cuts out; arguments, Tribunal turns,
// What-if verdicts, gossip: a `bubble` field). The client checks it (one sentence, at most 90 characters, no
// citation, no code, past the filter, at most one swear word) and guards against repeats; otherwise it falls back
// to the answer's first plain-language sentence, cut at a clause end. Pure, so scripts/check.mjs runs it directly.
import { lineProblem, SWEARING } from './guards.ts';
import type { SpiceLevel } from './types.ts';

export const BUBBLE_MAX = 90;
const CITE = /\[[^\]\n]*:[^\]\n]*\]/g;
const HAS_CITE = /\[[^\]\n]*:[^\]\n]*\]/;
const SWEARS = new RegExp(SWEARING.source, 'gi');

/** Code in a sentence: backticks, calls, operators and braces, identifiers (snake_case, camelCase, CONSTANTS). */
export const hasCode = (s: string) => /`|\b\w+\(|[{}<>=]|&&|\|\||\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b/.test(s);
const DANGLING = /\s+(?:a|an|the|to|of|and|or|but|so|for|from|with|in|on|at|by|as|into|than|that|which|when|because|after|before|if|is|are|was)$/i;

/** What the model wrote as the bubble, tidied: one line, no markdown, quotes or citations. */
export function cleanBubble(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/^\s*@@bubble:\s*/i, '')
    .split('\n')[0]
    .replace(CITE, '')
    .replace(/\*\*|__|^[\s*_"“'‘]+|[\s*_"”'’]+$/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/([^.!?…])$/, '$1.'); // models often drop the full stop
}

/** A bubble the stage can show at this spice level: short, plain, clean at clean, at most one swear word. */
export function bubbleOk(t: string, spice: SpiceLevel = 'unhinged'): boolean {
  const clean = spice === 'clean';
  const swears = t.match(SWEARS)?.length ?? 0;
  return !!t && t.length <= BUBBLE_MAX && !HAS_CITE.test(t) && !hasCode(t) && swears <= (clean ? 0 : 1) && !lineProblem(t, { clean });
}

const STOP = new Set(['the', 'and', 'but', 'for', 'with', 'that', 'this', 'its', "it's", 'was', 'are', 'not', 'you', 'your', 'from', 'into', 'than', 'then', 'just', 'still', 'only', 'have', 'has', 'all']);
const words = (t: string) => t.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const content = (t: string) => new Set(words(t).filter((w) => w.length >= 3 && !STOP.has(w)));
const swearOf = (t: string) => t.match(SWEARING)?.[0].toLowerCase() ?? null;

/**
 * Too close to a bubble shown this session (`recent`, oldest first, up to 10): the same first 3 words as one of the
 * last 5, the same swear word as the previous one, or over 60% of its words shared with one of the last 10.
 */
export function repeats(t: string, recent: string[]): boolean {
  const head = words(t).slice(0, 3).join(' ');
  if (recent.slice(-5).some((r) => words(r).slice(0, 3).join(' ') === head)) return true;
  const swear = swearOf(t);
  if (swear && recent.length && swearOf(recent[recent.length - 1]) === swear) return true;
  const mine = content(t);
  return (
    mine.size > 0 &&
    recent.slice(-10).some((r) => {
      const theirs = content(r);
      return [...mine].filter((w) => theirs.has(w)).length / mine.size > 0.6;
    })
  );
}

/** Longer than BUBBLE_MAX: cut at the last clause end that fits (else the last whole word), ending in a full stop. */
function cut(s: string): string {
  if (s.length <= BUBBLE_MAX) return s;
  const head = s.slice(0, BUBBLE_MAX);
  const at = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '), head.lastIndexOf(' — '));
  let keep = at > 30 ? head.slice(0, at) : head.slice(0, head.lastIndexOf(' '));
  while (DANGLING.test(keep)) keep = keep.replace(DANGLING, '');
  return keep.replace(/[\s,;:—-]+$/, '') + '.';
}

const POINT = {
  clean: ['The details are in the transcript.', "It's all written down in the transcript.", "Read the transcript. I'm not repeating it."],
  spicy: ['The damn details are in the transcript.', "It's all in the transcript, damn it.", "Read the transcript. I'm not repeating that shit."],
};

/**
 * The fallback bubble: the answer's first plain-language sentence (no code, citations dropped, clean at clean), cut at
 * a clause end. An answer that is all code points at the transcript instead.
 */
export function quip(text: string, spice: SpiceLevel = 'unhinged'): string {
  const clean = spice === 'clean';
  const sentences = text
    .replace(/^\s*(?:\d+\.|[-*])\s+/gm, '')
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(CITE, '').replace(/\*\*|__/g, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim())
    .filter((s) => s.length >= 12);
  const first = sentences.find((s) => !hasCode(s) && !(clean && SWEARING.test(s)) && !/^why it matters\b/i.test(s));
  if (first) return cut(first);
  if (!sentences.length) return '';
  const pointers = POINT[clean ? 'clean' : 'spicy'];
  return pointers[[...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % pointers.length];
}

/** The bubble to show: the AI's, if it passes and doesn't repeat a recent one; else the fallback from the full text. */
export function chooseBubble(ai: unknown, full: string, spice: SpiceLevel, recent: string[]): string {
  const t = cleanBubble(ai);
  return t && bubbleOk(t, spice) && !repeats(t, recent) ? t : quip(full, spice);
}

/** The rule every route gives the model for a bubble field (or chat's "@@bubble:" line). */
export const BUBBLE_RULE =
  "the short form of its main point in the speaker's own voice: one sentence, at most 90 characters, no citations, no code, no backticks, no file paths, no identifiers with brackets or underscores. Name the specific thing it is about (the behaviour, the bug, the line) in plain words, so it could not fit anything else. Swearing follows the spice level: at most one swear word, never required. Don't repeat a sentence of the text word for word";

/** For the dynamic part of a prompt: the last bubbles shown this session, not to be echoed. */
export function recentBlock(v: unknown): string {
  const recent = (Array.isArray(v) ? v : [])
    .slice(-5)
    .filter((r): r is string => typeof r === 'string' && !!r.trim())
    .map((r) => r.replace(/\s+/g, ' ').slice(0, 120));
  return recent.length ? `\nBubbles already shown in this session (don't reuse these openings or swear words):\n${recent.map((r) => `- ${r}`).join('\n')}\n` : '';
}
