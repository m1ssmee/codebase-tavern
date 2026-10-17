import { rateLimited } from '@/lib/gemini';
import { llmJSON } from '@/lib/llm';
import { levelBlock, PLAIN_WORDS, VOICE_GUIDE } from '@/lib/voice';
import { fallbackHeadline, fallbackLine, gradeFor, statText, SWEARING, type Facts, type FaceSpec, type RoastCard, type RoastEntry } from '@/lib/roast';
import { signCard } from '@/lib/roastSign';
import type { SpiceLevel } from '@/lib/types';
import savedRoast from '@/data/demoRoast.json';

type Twice = { spicy: string; clean: string };
const demoRoast = savedRoast as { repo: string; headline: Twice; entries: (Twice & { moduleId: string })[] };

export const runtime = 'nodejs';
export const maxDuration = 60;

// "Roast My Repo": one structured AI call writes every line on the notice twice (at the active spice level and
// clean), with a template for any line that is missing or unusable; then both cards are signed for share links.
// The client sends numbers and names only; the server builds every line of text on the card itself.

const LEVELS: SpiceLevel[] = ['clean', 'unhinged', 'feral', 'nuclear'];
const num = (v: unknown, max = 1_000_000) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(0, Math.floor(Number(v)))) : 0);
const word = (v: unknown, re: RegExp, n: number) => (typeof v === 'string' && re.test(v.trim()) ? v.trim().slice(0, n) : '');
const NAME = /^[\w.\-()/ ]{1,80}$/;
const TITLE = /^[\p{L}\p{N} ,.'’\-()/_:&!?]{1,80}$/u;
const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const S = { type: 'string' };
const TWICE = obj({ spicy: S, clean: S });
const SCHEMA = obj({ headline: TWICE, entries: { type: 'array', items: obj({ moduleId: S, spicy: S, clean: S }) } });

function cleanFacts(f: Record<string, unknown> | undefined): Facts {
  const out: Facts = {};
  const big = f?.bigFile as { name?: unknown; lines?: unknown } | undefined;
  if (big && word(big.name, NAME, 80)) out.bigFile = { name: word(big.name, NAME, 80), lines: num(big.lines) };
  if (f?.noTests === true) out.noTests = true;
  if (num(f?.nesting, 99) >= 6) out.nesting = num(f?.nesting, 99);
  if (num(f?.todos) >= 5) out.todos = num(f?.todos);
  if (word(f?.codependentWith, NAME, 60)) out.codependentWith = word(f?.codependentWith, NAME, 60);
  if (f?.orphan === true) out.orphan = true;
  return out;
}
const line = (v: unknown) =>
  typeof v === 'string'
    ? v
        .replace(/\[[^\]]*\]/g, '') // no citations or brackets on the card
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // no emojis
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 150)
    : '';

// Pre-warm: /tavern pings this on load. No model call.
export function GET(req: Request) {
  if (new URL(req.url).searchParams.get('warm') !== '1') return new Response('Method Not Allowed', { status: 405 });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: 'busy' }, { status: 429 });
  const b = await req.json().catch(() => null);
  const repo = word(b?.repo, /^[\w.-]{1,60}(\/[\w.-]{1,100})?$/, 160);
  const spice: SpiceLevel = LEVELS.includes(b?.spice) ? b.spice : 'unhinged';
  const entries = (Array.isArray(b?.entries) ? b.entries : []).slice(0, 4).flatMap((e: Record<string, unknown>) => {
    const name = word(e?.name, NAME, 60);
    const id = word(e?.id, NAME, 80) || name;
    const f = Array.isArray(e?.face) ? e.face : [];
    if (!name) return [];
    const facts = cleanFacts(e?.facts as Record<string, unknown>);
    const face: FaceSpec = [/^#[0-9a-f]{6}$/i.test(String(f[0])) ? String(f[0]) : '#f5a524', num(f[1]), num(f[2]), num(f[3]), num(f[4], 99), f[5] ? 1 : 0];
    return [{ id, name, title: word(e?.title, TITLE, 80) || name, stat: statText(name, facts), line: '', face, facts } satisfies RoastEntry];
  }) as RoastEntry[];
  if (!repo || !entries.length) return Response.json({ error: 'bad request' }, { status: 400 });
  const violations = num(b?.violations, 999);
  const modules = Math.max(1, num(b?.modules, 99));
  // The viewer's local date, if it is within a day of the server's (time zones); else the server's.
  const today = Date.now();
  const local = typeof b?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && Math.abs(Date.parse(b.date) - today) < 2 * 86_400_000 ? b.date : '';
  const base = { repo, date: local || new Date(today).toISOString().slice(0, 10), grade: gradeFor(violations, modules), violations, modules, keys: Math.max(1, num(b?.keys, 20)) };

  // Lines: saved (demo route, quickcart), else one AI call, else templates. Every line has a template behind it.
  const wrote = new Map<string, { spicy: string; clean: string }>();
  let headline = { spicy: '', clean: '' };
  let source: 'llm' | 'saved' | 'templates' = 'templates';
  if (b?.noAI) {
    if (repo === demoRoast.repo) {
      headline = demoRoast.headline;
      for (const e of demoRoast.entries) wrote.set(e.moduleId, e);
      source = 'saved';
    }
  } else {
    try {
      const out = await llmJSON<{ headline?: { spicy?: string; clean?: string }; entries?: { moduleId?: string; spicy?: string; clean?: string }[] }>('roast', {
        system: `You write the lines on a "Roast My Repo" health-inspection notice in Codebase Tavern: an inspector's notice pinned to the repo's door.

${levelBlock(spice)}

${VOICE_GUIDE}

Rules:
- headline: the Landlord speaking: he owns the building, has seen it all and is not surprised. One deadpan line under 14 words, in his voice (rent, deposits, the building, tenants), with the grade or a real number. Shape, not words to copy: "Six violations in six modules. I have seen worse. I raised the rent anyway."
- One line per entry, under 14 words: an inspector's deadpan note on that module, built only on its facts (file names, line counts, "no tests", nesting depth, TODO count, the module it is codependent with, "0 imports, 0 calls"), with one image or comparison that fits the fact (a huge file as a landfill or filing cabinet, two modules that depend on each other as a couple who can't move out, untested code as a fire exit nobody has tried). Never invent numbers, files or functions. Roast the code, never people. Swearing is emphasis on top of a joke, never the joke itself.
- Write every line twice: "spicy" at the active spice level, and "clean" with no swearing at all. Same facts, the same joke where possible.
- ${b?.mode === 'expert' ? 'Standard technical terms are fine.' : `Plain words: say "nested 6 levels deep" or "two modules that depend on each other", not jargon. ${PLAIN_WORDS}`}`,
        prompt: JSON.stringify({ repo, grade: base.grade, violations, modulesInspected: modules, entries: entries.map((e) => ({ moduleId: e.id, title: e.title, stat: e.stat, facts: e.facts })) }),
        schema: SCHEMA,
        timeoutMs: 25_000,
      });
      headline = { spicy: line(out?.headline?.spicy), clean: line(out?.headline?.clean) };
      for (const e of out?.entries ?? []) if (e?.moduleId) wrote.set(e.moduleId, { spicy: line(e.spicy), clean: line(e.clean) });
      source = 'llm';
    } catch (err) {
      console.error('[roast] all providers failed, using templates:', err);
    }
  }
  // A clean line must be clean; a missing line gets its template.
  const pickLine = (text: string | undefined, level: SpiceLevel, fallback: () => string) => (text && !(level === 'clean' && SWEARING.test(text)) ? text : fallback());
  const card = (level: SpiceLevel, clean: boolean): RoastCard => ({
    ...base,
    clean,
    headline: pickLine(clean || spice === 'clean' ? headline.clean : headline.spicy, clean ? 'clean' : spice, () => fallbackHeadline(base, level, repo)),
    entries: entries.map((e) => ({ ...e, line: pickLine(clean || spice === 'clean' ? wrote.get(e.id)?.clean : wrote.get(e.id)?.spicy, clean ? 'clean' : spice, () => fallbackLine(e, level)) })),
  });
  const cards = { spicy: card(spice, spice === 'clean'), clean: card('clean', true) };
  const links = { spicy: signCard(cards.spicy), clean: signCard(cards.clean) };
  return Response.json({ cards, links: links.spicy && links.clean ? links : null, source });
}
