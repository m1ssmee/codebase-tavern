import { rateLimited } from '@/lib/gemini';
import { llmJSON } from '@/lib/llm';
import { levelBlock, PLAIN_WORDS, VOICE_GUIDE } from '@/lib/voice';
import { fallbackHeadline, fallbackLine, gradeFor, inspect, statText, SWEARING, type Facts, type FaceSpec, type RoastCard, type RoastEntry } from '@/lib/roast';
import { signCard } from '@/lib/roastSign';
import { editLines, type Candidate } from '@/lib/editor';
import { knownNumbers } from '@/lib/guards';
import { fetchRepo, MSG, Oops } from '@/lib/fetchRepo';
import { buildRepo, parseGitHubUrl } from '@/lib/analyze';
import { buildGraph } from '@/lib/graph';
import { assignColors, fallbackCharacter } from '@/lib/characters';
import type { SpiceLevel } from '@/lib/types';
import savedRoast from '@/data/demoRoast.json';
import demoRepo from '@/data/demoRepo.json';
import demoCast from '@/data/demoCharacters.json';
import { ARCHETYPES } from '@/lib/cast';

type Twice = { spicy: string; clean: string };
const demoRoast = savedRoast as { repo: string; headline: Twice; entries: (Twice & { moduleId: string })[] };

export const runtime = 'nodejs';
export const maxDuration = 60;

// "Roast My Repo". Signed cards: the browser sends only a GitHub link; the server reads the repo itself (or the
// bundled snapshot of the demo repo) and works out the violations, grade, facts and titles, so a share link can't
// carry made-up numbers. One structured AI call writes every line twice (at the active spice level and clean),
// with a template behind each. Uploaded zips can't be verified: their cards use the browser's numbers and are
// never signed (PNG only).
const DEMO = 'm1ssmee/quickcart';

const LEVELS: SpiceLevel[] = ['clean', 'unhinged', 'feral', 'nuclear'];
const num = (v: unknown, max = 1_000_000) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(0, Math.floor(Number(v)))) : 0);
const word = (v: unknown, re: RegExp, n: number) => (typeof v === 'string' && re.test(v.trim()) ? v.trim().slice(0, n) : '');
const NAME = /^[\w.\-()/ ]{1,80}$/;
const TITLE = /^[\p{L}\p{N} ,.'’\-()/_:&!?]{1,80}$/u;
const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const S = { type: 'string' };
const THREE = { type: 'array', items: S, description: '3 variants of this line: the same facts, three different jokes.' };
const TWICE = obj({ spicy: THREE, clean: THREE });
const SCHEMA = obj({ headline: TWICE, entries: { type: 'array', items: obj({ moduleId: S, title: S, spicy: THREE, clean: THREE }) } });

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
// No citations or brackets on the card. Emojis, overlong or broken lines are dropped by the filter, not patched.
const line = (v: string) => v.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150);
// The real names and numbers an entry's line may stand on (at least one must appear).
const factWords = (e: RoastEntry) => {
  const f = e.facts;
  return [e.name, f.bigFile?.name ?? '', f.bigFile?.name.replace(/\.\w+$/, '') ?? '', String(f.bigFile?.lines ?? ''), String(f.nesting ?? ''), String(f.todos ?? ''), f.todos ? 'TODO' : '', f.todos ? 'TODOs' : '', f.codependentWith ?? '', ...(f.noTests ? ['tests', 'test', 'untested'] : []), ...(f.orphan ? ['0', 'imports', 'nobody'] : [])].filter(Boolean);
};

// Pre-warm: /tavern pings this on load. No model call.
export function GET(req: Request) {
  if (new URL(req.url).searchParams.get('warm') !== '1') return new Response('Method Not Allowed', { status: 405 });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: 'busy' }, { status: 429 });
  const started = Date.now();
  const b = await req.json().catch(() => null);
  const spice: SpiceLevel = LEVELS.includes(b?.spice) ? b.spice : 'unhinged';
  let repo = '';
  let entries: RoastEntry[] = [];
  let violations = 0;
  let modules = 1;
  let keys = 1;
  let verified = false; // numbers worked out here from the real repo: only then is the card signed
  let isDemo = false;

  if (typeof b?.url === 'string') {
    const parsed = parseGitHubUrl(b.url);
    if (!parsed) return Response.json({ error: MSG.invalid }, { status: 400 });
    isDemo = parsed.slug === DEMO;
    const snapshot = { name: demoRepo.name, url: demoRepo.url, files: demoRepo.files };
    let fetched: { name: string; url: string; files: typeof demoRepo.files };
    try {
      // The demo route makes no outside calls; the demo repo also falls back to its snapshot if GitHub fails.
      fetched = isDemo && b.noAI ? snapshot : await fetchRepo(b.url, AbortSignal.timeout(30_000));
    } catch (err) {
      if (!isDemo) {
        if (err instanceof Oops) return Response.json({ error: err.message }, { status: err.status });
        console.error('[roast] fetching the repo failed:', err);
        return Response.json({ error: MSG.generic }, { status: 502 });
      }
      fetched = snapshot;
    }
    const r = buildRepo(fetched.name, fetched.files, fetched.url);
    const colors = assignColors(r.modules);
    const saved = new Map(isDemo ? demoCast.characters.map((c) => [c.moduleId, c.title] as const) : []);
    const title = (id: string) => saved.get(id) ?? fallbackCharacter(r.modules.find((m) => m.id === id)!, r.modules).title;
    const found = inspect(r.files, r.modules, buildGraph(r.files, r.modules), title, (id) => colors[id]);
    [repo, violations, modules, keys, verified] = [r.name, found.violations, found.modules, r.modules.length, true];
    entries = found.entries.map((e) => ({ ...e, line: '' }));
  } else if (b?.upload) {
    // An upload: the browser's numbers and names, validated but unverifiable, so this card is never signed.
    repo = word(b?.repo, /^[\w.-]{1,60}(\/[\w.-]{1,100})?$/, 160);
    violations = num(b?.violations, 999);
    modules = Math.max(1, num(b?.modules, 99));
    keys = Math.max(1, num(b?.keys, 20));
    entries = (Array.isArray(b?.entries) ? b.entries : []).slice(0, 4).flatMap((e: Record<string, unknown>) => {
    const name = word(e?.name, NAME, 60);
    const id = word(e?.id, NAME, 80) || name;
    const f = Array.isArray(e?.face) ? e.face : [];
    if (!name) return [];
    const facts = cleanFacts(e?.facts as Record<string, unknown>);
    const face: FaceSpec = [/^#[0-9a-f]{6}$/i.test(String(f[0])) ? String(f[0]) : '#f5a524', num(f[1]), num(f[2]), num(f[3]), num(f[4], 99), f[5] ? 1 : 0];
    const arch = ARCHETYPES.find((a) => a === e?.arch); // its portrait; anything else, the SVG face
    return [{ id, name, title: word(e?.title, TITLE, 80) || name, stat: statText(name, facts), line: '', face, facts, ...(arch ? { arch } : {}) } satisfies RoastEntry];
  }) as RoastEntry[];
  }
  if (!repo || !entries.length) return Response.json({ error: 'bad request' }, { status: 400 });
  // The viewer's local date, if it is within a day of the server's (time zones); else the server's.
  const today = Date.now();
  const local = typeof b?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && Math.abs(Date.parse(b.date) - today) < 2 * 86_400_000 ? b.date : '';
  const base = { repo, date: local || new Date(today).toISOString().slice(0, 10), grade: gradeFor(violations, modules), violations, modules, keys };
  const writeTitles = verified && !isDemo; // the demo repo keeps its saved cast's titles

  // Lines: saved (demo route, quickcart), else one AI call, else templates. Every line has a template behind it.
  const wrote = new Map<string, { spicy: string; clean: string }>();
  let headline = { spicy: '', clean: '' };
  let source: 'llm' | 'saved' | 'templates' = 'templates';
  if (b?.noAI) {
    if (isDemo && repo === demoRoast.repo) {
      headline = demoRoast.headline;
      for (const e of demoRoast.entries) wrote.set(e.moduleId, e);
      source = 'saved';
    }
  } else {
    try {
      const prompt = JSON.stringify({ repo, grade: base.grade, violations, modulesInspected: modules, entries: entries.map((e) => ({ moduleId: e.id, title: e.title, stat: e.stat, facts: e.facts })) });
      type Three = { spicy?: unknown; clean?: unknown };
      const out = await llmJSON<{ headline?: Three; entries?: (Three & { moduleId?: string; title?: string })[] }>('roast', {
        system: `You write the lines on a "Roast My Repo" health-inspection notice in Codebase Tavern: an inspector's notice pinned to the repo's door.

${levelBlock(spice)}

${VOICE_GUIDE}

Rules:
- headline: the Landlord speaking: he owns the building, has seen it all and is not surprised. One deadpan line under 14 words, in his voice (rent, deposits, the building, tenants), with the grade or a real number. Shape, not words to copy: "Six violations in six modules. I have seen worse. I raised the rent anyway."
- One line per entry, under 14 words: an inspector's deadpan note on that module, built only on its facts (file names, line counts, "no tests", nesting depth, TODO count, the module it is codependent with, "0 imports, 0 calls"), with one image or comparison that fits the fact (a huge file as a landfill or filing cabinet, two modules that depend on each other as a couple who can't move out, untested code as a fire exit nobody has tried). Never invent numbers, files or functions. Roast the code, never people. Swearing is emphasis on top of a joke, never the joke itself.
- Every line comes 3 times: 3 variants with three different jokes on the same facts, each a complete sentence. An editor picks the best one, so make them really different.
- Write every line twice: "spicy" at the active spice level, and "clean" with no swearing at all. Same facts, the same jokes where possible.
- title per entry: "<module name>, the <2-4 word dry descriptor>" from its facts, e.g. "utils, the 417-line landfill". No swearing: it appears on the clean card too.
- ${b?.mode === 'expert' ? 'Standard technical terms are fine.' : `Plain words: say "nested 6 levels deep" or "two modules that depend on each other", not jargon. ${PLAIN_WORDS}`}`,
        prompt,
        schema: SCHEMA,
        timeoutMs: 25_000,
      });
      // Three variants per line → the filter → the comedy editor; a line with no survivor keeps its template.
      const known = knownNumbers(prompt);
      const headNeeds = [base.grade, String(violations), String(modules)];
      const about = `grade ${base.grade}, ${violations} violations in ${modules} modules`;
      const lines: Candidate[] = [
        { id: 'headline-spicy', variants: out?.headline?.spicy, rules: { needs: headNeeds, known, clean: spice === 'clean', maxWords: 20 }, about },
        { id: 'headline-clean', variants: out?.headline?.clean, rules: { needs: headNeeds, known, clean: true, maxWords: 20 }, about },
      ];
      for (const e of out?.entries ?? []) {
        const n = entries.findIndex((x) => x.id === e?.moduleId);
        const it = entries[n];
        if (!it) continue;
        const rules = { needs: factWords(it), known, maxWords: 20 };
        lines.push({ id: `entry${n}-spicy`, variants: e.spicy, rules: { ...rules, clean: spice === 'clean' }, about: it.stat }, { id: `entry${n}-clean`, variants: e.clean, rules: { ...rules, clean: true }, about: it.stat });
        // A title is "<module name>, <descriptor>", printable on the clean card too; anything else keeps the template.
        const t = typeof e.title === 'string' ? line(e.title) : '';
        if (writeTitles && t.startsWith(`${it.name}, `) && t.length <= 70 && TITLE.test(t) && !SWEARING.test(t)) it.title = t;
      }
      const picked = await editLines('roast', lines, spice, Math.min(8000, 52_000 - (Date.now() - started)), line);
      headline = { spicy: picked.get('headline-spicy') ?? '', clean: picked.get('headline-clean') ?? '' };
      entries.forEach((e, n) => wrote.set(e.id, { spicy: picked.get(`entry${n}-spicy`) ?? '', clean: picked.get(`entry${n}-clean`) ?? '' }));
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
  const links = verified ? { spicy: signCard(cards.spicy), clean: signCard(cards.clean) } : null;
  return Response.json({ cards, links: links?.spicy && links.clean ? links : null, source, verified });
}
