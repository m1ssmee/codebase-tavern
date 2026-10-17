import 'server-only';
import { llmJSON } from './llm';
import { SPICE, VOICE_GUIDE } from './voice';
import { survivors, type LineRules } from './guards';
import type { SpiceLevel } from './types';

// The comedy editor, for the pure-joke lines (roast lines, gossip, What-if reactions, the Landlord's lines, the
// judge's closing remark). Each line comes in 3 variants from the same call; the deterministic filter (guards.ts)
// drops the broken ones, then one small call picks the funniest survivor per line. No survivor: the caller's template.

export type Candidate = { id: string; variants: unknown; rules?: LineRules; about?: string };
const S = { type: 'string' };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks'],
  properties: { picks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'best'], properties: { id: S, best: { type: 'integer' } } } } },
};

/** Up to 3 strings from a model's variants field (an array, or a lone string from an older-shaped reply). */
export const variantsOf = (v: unknown, clip: (s: string) => string = (s) => s.trim()): string[] =>
  (Array.isArray(v) ? v : [v]).slice(0, 3).flatMap((x) => (typeof x === 'string' && clip(x) ? [clip(x)] : []));

/**
 * id → the chosen line. Lines with no survivor are absent (use the template). The editor call is skipped when
 * at most one survivor per line is left or there isn't time (`timeoutMs` under 2.5s): then the first survivor wins.
 */
export async function editLines(label: string, lines: Candidate[], spice: unknown, timeoutMs: number, clip?: (s: string) => string): Promise<Map<string, string>> {
  const level: SpiceLevel = typeof spice === 'string' && spice in SPICE ? (spice as SpiceLevel) : 'unhinged';
  const kept = new Map<string, { options: string[]; about?: string }>();
  const why = new Map<string, number>();
  const examples: string[] = [];
  let total = 0;
  for (const l of lines) {
    const v = variantsOf(l.variants, clip);
    total += v.length;
    const s = survivors(v, l.rules);
    s.dropped.forEach((d) => why.set(d.replace(/ \d+$/, ''), (why.get(d.replace(/ \d+$/, '')) ?? 0) + 1));
    for (const x of v) if (examples.length < 3 && !s.kept.includes(x.trim())) examples.push(`"${x.slice(0, 90)}"`);
    if (s.kept.length) kept.set(l.id, { options: s.kept, about: l.about });
  }
  const out = new Map([...kept].map(([id, k]) => [id, k.options[0]]));
  const contested = [...kept].filter(([, k]) => k.options.length > 1);
  let edited = 'skipped';
  if (contested.length && timeoutMs >= 2500) {
    try {
      const res = await llmJSON<{ picks?: { id?: string; best?: number }[] }>(`editor-${label}`, {
        system: `You are the comedy editor of Codebase Tavern, where code modules are characters. For every line you get 2-3 options; pick the funniest one by this voice guide: dry and deadpan, specific, built on the real fact it names (a file, a number, a function), with one clear image. Prefer the option where the joke needs the fact; reject generic jokes, puns, announced jokes and anything that reads like a meme page.
Active spice level: ${SPICE[level]} At a swearing level, swearing that adds emphasis to a real joke beats both no swearing and swearing instead of a joke.

${VOICE_GUIDE}

Return one pick per line id: best = the 0-based index of the option you chose.`,
        prompt: JSON.stringify(contested.map(([id, k]) => ({ id, ...(k.about && { about: k.about }), options: k.options }))),
        schema: SCHEMA,
        timeoutMs,
        temperature: 0.3, // a judge, not a writer: the creativity is already in the options
      });
      for (const p of res?.picks ?? []) {
        const k = p?.id ? kept.get(p.id) : undefined;
        if (k && Number.isInteger(p.best) && k.options[p.best!]) out.set(p.id!, k.options[p.best!]);
      }
      edited = 'picked';
    } catch (err) {
      edited = 'failed, first survivor used';
      console.warn(`[editor] ${label} failed:`, String(err).slice(0, 160));
    }
  }
  const reasons = [...why].map(([w, n]) => `${n} ${w}`).join(', ');
  console.info(`[editor] ${label}: ${lines.length} lines, ${total} variants, ${total - [...why.values()].reduce((a, b) => a + b, 0)} passed${reasons ? ` (dropped: ${reasons})` : ''}; ${lines.length - kept.size} to templates; editor ${edited}${examples.length ? `; e.g. dropped ${examples.join(' ')}` : ''}`);
  return out;
}
