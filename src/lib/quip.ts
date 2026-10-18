// The bubble over a character's head when the full text is already in the chat or a panel: one short line with the
// most personality (the joke, the insult, the curse), never the technical explanation, code or a citation. No AI:
// the shortest sentence with a spice word (else a clause of one), else the shortest without code, else the first
// sentence cut at a clause end; text that is all code points at the transcript instead. At most about 90 characters
// (two bubble lines), cut at a sentence or clause end, never mid-word, no "...". File names are fine (the voice
// guide's jokes use them); calls, identifiers and snippets are not. Pure, so scripts/check.mjs runs it directly.
import { lineProblem, SWEARING } from './guards.ts';
import type { SpiceLevel } from './types.ts';

export const QUIP_MAX = 90;
const CITE = /\[[^\]\n]*:[^\]\n]*\]/g;
const HAS_CITE = /\[[^\]\n]*:[^\]\n]*\]/;
const OUTBURST = /\b[A-Z]{3,}(?:[\s,]+[A-Z]{2,})+\b/;

/** Code in a sentence: backticks, calls, operators and braces, identifiers (snake_case, camelCase, CONSTANTS). */
export const hasCode = (s: string) => /`|\b\w+\(|[{}<>=]|&&|\|\||\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b/.test(s);
const DANGLING = /\s+(?:a|an|the|to|of|and|or|but|so|for|from|with|in|on|at|by|as|into|than|that|which|when|because|after|before|if|is|are|was)$/i;
const sentence = (c: string) => {
  const t = c.trim().replace(/[\s,;:—-]+$/, '');
  // Capitalise a plain first word only (never a file name like validation.ts).
  return t && (/^[a-z]+(?![\w./])/.test(t) ? t[0].toUpperCase() + t.slice(1) : t) + '.';
};

const tidy = (s: string) =>
  s
    .replace(CITE, '')
    .replace(/\*\*|__/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** Sentences of a reply, list markers and bold dropped; `partial`: the last one only once it has ended. */
function sentences(text: string, partial: boolean): { raw: string; s: string }[] {
  const body = partial ? text.replace(/[^.!?]*$/, '') : text;
  return body
    .replace(/^\s*(?:\d+\.|[-*])\s+/gm, '')
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((raw) => ({ raw, s: tidy(raw) }))
    .filter((x) => x.s);
}

/** Longer than QUIP_MAX: cut at the last clause end that fits (else the last word), and end it with a full stop. */
function cut(s: string): string {
  if (s.length <= QUIP_MAX) return s;
  const head = s.slice(0, QUIP_MAX);
  const at = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '), head.lastIndexOf(' — '));
  let keep = at > 30 ? head.slice(0, at) : head.slice(0, head.lastIndexOf(' '));
  while (DANGLING.test(keep)) keep = keep.replace(DANGLING, '');
  return keep.replace(/[\s,;:—-]+$/, '') + '.';
}

/** The clauses of a sentence as sentences of their own ("..., which is damn bad engineering." → "That is damn bad engineering."). */
function clauses(s: string): string[] {
  const parts = s.replace(/[.!?]+$/, '').split(/,\s+|;\s+|\s+—\s+/);
  const out = parts.length < 2 ? [] : parts.map((p) => sentence(p.trim().replace(/^which\b/i, 'that').replace(/^(?:and|but|so|because|although|though|while|yet)\s+/i, '')));
  // Also the head of each before a "when/because/..." clause: "That is damn reckless when I already marked..." → "That is damn reckless."
  for (const p of [s, ...out]) {
    const head = p.replace(/[.!?]+$/, '').split(/\s+(?:when|because|after|before|since|until|if|while)\s+/i)[0];
    if (head.length < p.length - 2) out.push(sentence(head));
  }
  return out.filter((c) => c.split(/\s+/).length >= 4); // not list items ("400 filters.")
}

export function quip(text: string, spice: SpiceLevel = 'unhinged', o: { partial?: boolean } = {}): string {
  const clean = spice === 'clean';
  const all = sentences(text, !!o.partial);
  const usable = (s: string) => s.length >= 12 && s.length <= QUIP_MAX && !hasCode(s) && !(clean && SWEARING.test(s)) && !lineProblem(s, { clean });
  const whole = all.filter(({ raw, s }) => !HAS_CITE.test(raw) && usable(s)).map((x) => x.s);
  const parts = all.flatMap(({ s }) => clauses(s)).filter(usable);
  const spicy = (xs: string[]) => (clean ? [] : xs.filter((s) => SWEARING.test(s) || OUTBURST.test(s)));
  const shortest = (xs: string[]) => [...xs].sort((a, b) => a.length - b.length)[0];
  // The curse or the joke (a whole sentence, else a clause of one), else the shortest plain line without code.
  const pick = shortest(spicy(whole)) ?? shortest(spicy(parts)) ?? shortest(whole) ?? shortest(parts);
  if (pick) return pick;
  // Nothing short: the first sentence without code, cut at a clause end. All code: point at the full text.
  const first = all.find(({ s }) => !hasCode(s) && !(clean && SWEARING.test(s)))?.s;
  if (first) return cut(first);
  if (!all.length) return '';
  const pointers = POINT[clean ? 'clean' : 'spicy'];
  return pointers[[...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % pointers.length];
}
const POINT = {
  clean: ['The details are in the transcript.', "It's all written down in the transcript.", "Read the transcript. I'm not repeating it."],
  spicy: ['The damn details are in the transcript.', "It's all in the transcript, damn it.", "Read the transcript. I'm not repeating that shit."],
};
