// Safety nets for high-temperature output. Pure, so `node scripts/check.mjs` runs it directly.
// lineProblem: the deterministic filter every candidate joke line passes before the comedy editor (editor.ts) sees it.
// matchesSchema: the structured-output check behind llmJSON's one retry.

/** Any swearing (clean lines must have none). */
export const SWEARING = /\b(fuck\w*|shit\w*|damn\w*|hell|crap\w*|bullshit|ass|arse|bastard\w*|piss\w*|wtf)\b/i;

// Never on screen, at any level: slurs, hate, sexual content, self-harm. ponytail: a word list, not a classifier;
// the prompts forbid all of this already, this catches what slips through at high temperature.
const BLOCKLIST =
  /\b(nigg\w*|fag(s|got\w*)?|dykes?|trann(y|ies)|retard\w*|spics?|chinks?|kikes?|gooks?|wetbacks?|beaners?|coons?|pakis?|ragheads?|towelheads?|spaz\w*|midgets?|gyps?|shemales?|japs?|nazis?|hitler|kys|sex(y|ual\w*)?|porn\w*|orgasm\w*|horny|boobs?|tits|dick(s|head)?|cocks?|puss(y|ies)|cum|blow ?jobs?|hand ?jobs?|masturbat\w*|erotic\w*|fetish\w*|dildos?|anal|genital\w*|penis\w*|vagina\w*|nsfw|hentai|boners?|whores?|sluts?|bitch\w*|rap(e|ed|es|ing|ist)|molest\w*|(kill|hang|shoot) (my|your|him|her|them)sel(f|ves))\b/i;
// Roast the code, never people.
const AT_PEOPLE = /\b(whoever (wrote|built|made|designed|coded)|the (authors?|developers?|devs?|maintainers?|interns?|engineers?|programmers?) (who|that|is|are|was|were)|your (devs?|developers?|team|boss))\b/i;
// The voice guide's banned list: slang, "lol", announced jokes, filler, byte/bug/code puns.
const BANNED =
  /\b(bro|bruh|yo|fam|bhai|lowkey|highkey|no cap|deadass|ngl|tbh|bestie|lol|lmao|rofl|haha\w*|plot twist|fun fact|spoiler alert|pro tip|hot take|newsflash|great question|let me explain|in summary|to summari[sz]e|in conclusion|as an ai|byte[- ]sized|bite[- ]sized|bytes? the dust|code red|bug off|bugs? me)\b/i;
// Letters outside English text and its punctuation: emojis, other scripts, stray symbols.
const NOT_ENGLISH = /[^\t\n\r\x20-\x7E -ɏ‐-‧‰-⁞←-⇿−]/u;
// A sentence doesn't end on these.
const DANGLING = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'with', 'for', 'in', 'on', 'at', 'by', 'from', 'is', 'are', 'that', 'which', 'my', 'your', 'its', 'their', 'than', 'as']);
const COMMON = new Set(['then', 'when', 'than', 'that', 'this', 'thus', 'them', 'they', 'there', 'their', 'these', 'where', 'were', 'here', 'have', 'from', 'form', 'with', 'what', 'will', 'well', 'wall', 'more', 'most', 'must', 'just', 'your', 'very', 'into', 'onto', 'over', 'ever', 'even', 'also', 'only', 'once', 'some', 'same', 'came', 'come', 'like', 'line', 'lines', 'live', 'love', 'lose', 'lost', 'last', 'list', 'make', 'made', 'take', 'time', 'tile', 'file', 'fine', 'five', 'fire', 'hire', 'here', 'hard', 'card', 'cart', 'part', 'past', 'pass', 'mass', 'less', 'loss']);
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

export type LineRules = {
  /** At least one of these real names or numbers must appear (case-insensitive; a lone capital letter, like a grade, must match exactly). */
  needs?: string[];
  /** Every number of 11 or more in the line must be one of these (numbers from the input), so none is invented. */
  known?: Set<string>;
  /** Code names and numbers from the input (codeFacts) that also count as a real fact, besides `needs`. */
  facts?: Set<string>;
  /** The input text: a name the line puts in backticks counts as a real fact if it appears here. */
  source?: string;
  clean?: boolean; // no swearing
  maxWords?: number;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Numbers as written in text: 1,051 → 1051, 2_000 → 2000; not the digits inside names like p50 or v2. */
export const numbersIn = (text: string) =>
  [...text.replace(/(\d)[,_](?=\d{3}\b)/g, '$1').matchAll(/(?<![\w.])\d+(?:\.\d+)?/g)].map((m) => m[0]);

function mentions(text: string, need: string): boolean {
  const n = need.trim().replace(/^[^\w]+|[^\w]+$/g, '');
  if (!n) return false;
  if (/^[A-Z]$/.test(n)) return new RegExp(`(?<![\\w])${n}(?![\\w])`).test(text);
  if (/^\d+$/.test(n)) return numbersIn(text).includes(n) || (Number(n) <= 20 && new RegExp(`\\b${NUM_WORDS[Number(n)]}\\b`, 'i').test(text));
  return new RegExp(`(?<![\\w])${esc(n)}(?![\\w])`, 'i').test(text);
}

// One edit apart ("shit and shirt"): a garbled word next to the one it was meant to be.
function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

const unbalanced = (t: string) =>
  (t.match(/`/g)?.length ?? 0) % 2 === 1 ||
  (t.match(/\(/g)?.length ?? 0) !== (t.match(/\)/g)?.length ?? 0) ||
  (t.match(/“/g)?.length ?? 0) !== (t.match(/”/g)?.length ?? 0) ||
  (t.match(/"/g)?.length ?? 0) % 2 === 1;

/** Why a candidate line is unusable, or null if it passes. */
export function lineProblem(text: string, r: LineRules = {}): string | null {
  const t = text.trim();
  if (!t) return 'empty';
  if (BLOCKLIST.test(t)) return 'blocklist';
  if (AT_PEOPLE.test(t)) return 'aimed at people';
  if (BANNED.test(t)) return 'banned by the voice guide';
  if (NOT_ENGLISH.test(t)) return 'emoji or non-English characters';
  if ((t.match(/!/g)?.length ?? 0) > 1) return 'exclamation marks';
  if (r.clean && SWEARING.test(t)) return 'swearing in a clean line';
  if (/[{}]|\\n|(?<!\.)\.\.(?!\.)|[,;]{2}/.test(t) || unbalanced(t)) return 'garbled';
  const words = t.toLowerCase().match(/[a-z0-9_'’-]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] === words[i + 1] && !/^\d+$/.test(words[i])) return 'garbled: repeated word';
    // "shit and shirt": the same word twice with a slip, at most one word apart. Common words (then/when) don't count.
    for (let j = i + 1; j <= i + 2 && j < words.length; j++) {
      const [a, b] = [words[i], words[j]];
      if (a.length >= 4 && b.length >= 4 && !/\d/.test(a + b) && !COMMON.has(a) && !COMMON.has(b) && !a.startsWith(b) && !b.startsWith(a) && oneEdit(a, b)) return 'garbled: near-duplicate words';
    }
  }
  const tri = words.slice(2).map((_, i) => words.slice(i, i + 3).join(' '));
  if (new Set(tri).size < tri.length) return 'garbled: repeated phrase';
  if (!/[.!?…]["”'’)`]*$/.test(t) || DANGLING.has(words.at(-1) ?? '')) return 'unfinished sentence';
  if (r.maxWords && t.split(/\s+/).length > r.maxWords) return 'too long';
  const ticked = [...t.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\(.*\)$/, '').trim()).filter((w) => w.length > 2);
  if ((r.needs?.length || r.facts) && !r.needs?.some((n) => mentions(t, n)) && ![...codeFacts(t)].some((f) => r.facts?.has(f)) && !ticked.some((w) => r.source?.includes(w)))
    return 'no real stat or name';
  // A file name must be real: "gateway.config.ts" is not gateway/config.ts.
  const fake = r.source && t.match(/[\w/-]+(?:\.[\w-]+)*\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|json|md|log|ya?ml|css|html)\b/g)?.find((f) => !r.source!.includes(f));
  if (fake) return `invented file name ${fake}`;
  if (r.known) {
    const made = numbersIn(t).find((n) => Number(n) > 10 && !r.known!.has(n));
    if (made) return `invented number ${made}`;
  }
  if ((t.match(/\b[A-Z]{2,}(?:[\s,]+[A-Z]{2,}){2,}\b/g)?.length ?? 0) > 1) return 'more than one outburst';
  return null;
}

/**
 * Swearing out of a plain sentence (a Tribunal root cause, a What-if reason or summary): explanations stay clear at
 * every level, the attitude lives in the turns and reactions. Models don't always comply, so this removes it.
 */
export function unswear(t: string): string {
  const UP: Record<string, string> = { fuck: 'mess', fucks: 'messes', fucked: 'messed', fucking: 'messing' };
  return t
    .replace(/,?\s*\b(?:god ?damn it|damn it|for fuck'?s sake)\b/gi, '')
    .replace(/\b(fuck|fucks|fucked|fucking) up\b/gi, (_, w: string) => `${UP[w.toLowerCase()]} up`)
    .replace(/\b(?:fucking|damn|damned|goddamn|bloody|shitty|crappy)\s+(?=[\w`])/gi, '')
    .replace(/\b(is|was|are|were) (?:shit|crap|bullshit)\b/gi, '$1 bad')
    .replace(/\b(?:shit|crap|bullshit)\b/gi, 'mess')
    .replace(/\bthe hell\s+/gi, '')
    .replace(/ {2,}/g, ' ')
    .replace(/ +([.,;:])/g, '$1');
}

/** The variants that pass, deduplicated, and why the rest didn't. */
export function survivors(variants: string[], r: LineRules = {}): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const v of variants) {
    const why = lineProblem(v, r);
    if (why) dropped.push(why);
    else if (!kept.some((k) => k.toLowerCase() === v.trim().toLowerCase())) kept.push(v.trim());
  }
  return { kept, dropped };
}

/** Code-shaped names (snake_case, camelCase, CONSTANTS, file.ts, name()) and numbers ≥ 10 in some text, for LineRules.facts. */
export function codeFacts(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*(?:\.[a-z]{1,4}\b)?/g)) if (/_|[a-z][A-Z]|^[A-Z][A-Z0-9]{3,}$|\.[a-z]{1,4}$/.test(m[0]) && m[0].length > 3) out.add(m[0]);
  for (const m of text.matchAll(/`([A-Za-z_$][\w$]*)`/g)) if (m[1].length > 2) out.add(m[1]);
  for (const n of numbersIn(text)) if (Number(n) >= 10) out.add(n);
  return out;
}

/** Every number written in some input text, for LineRules.known. */
export const knownNumbers = (...texts: string[]) => new Set(texts.flatMap(numbersIn));

/**
 * Does `v` fit `schema`? The subset our schemas use: object (required, properties), array (items), string,
 * integer, number, boolean, enum. Extra properties are allowed (strict providers never send them).
 */
export function matchesSchema(v: unknown, schema: object): boolean {
  const s = schema as { type?: string; required?: string[]; properties?: Record<string, object>; items?: object; enum?: unknown[] };
  if (s.enum && !s.enum.includes(v)) return false;
  switch (s.type) {
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
      const o = v as Record<string, unknown>;
      return (s.required ?? []).every((k) => k in o) && Object.entries(s.properties ?? {}).every(([k, sub]) => !(k in o) || matchesSchema(o[k], sub));
    }
    case 'array':
      return Array.isArray(v) && (!s.items || v.every((x) => matchesSchema(x, s.items!)));
    case 'string':
      return typeof v === 'string';
    case 'integer':
      return Number.isInteger(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    default:
      return true;
  }
}
