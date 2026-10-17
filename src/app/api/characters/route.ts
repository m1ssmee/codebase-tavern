import { rateLimited } from '@/lib/gemini';
import { llmJSON } from '@/lib/llm';
import { levelBlock, levelReminder, PLAIN_WORDS, VOICE_GUIDE } from '@/lib/voice';
import { fallbackCharacter, toRaw, type RawCharacter } from '@/lib/characters';
import type { Module, ModuleStats } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

type KeyFile = { path: string; head: string };
type InModule = Module & { keyFiles?: KeyFile[]; testFiles?: unknown; links?: { usedBy?: unknown; uses?: unknown } };

const SYSTEM = `You turn code modules into characters for "Codebase Tavern", where each folder of a repo speaks for itself.

${VOICE_GUIDE}

Hard rules:
- Characters may only state facts present in the input (stats, file names, the code shown). Never invent numbers, functions or files.
- Every line must contain at least one real fact from the input.
- Never name or insult real people, including the repo's authors; aim everything at the code.
- gossip: 4 lines per character, max 18 words each, dry, about other modules or itself, each with a real fact.
- Across the whole cast, at least two gossip lines should hint at the most suspicious interaction between modules visible in the code shown (for example a timeout shorter than another module's processing time, or a retry with no safety check), without naming a bug.
- about: one plain sentence under 20 words for someone who has never seen this repo: what the module does, from the code shown. No jokes, no swearing.

The Landlord: owns the building (the repo) and narrates a guided tour of it. Not a module. Weary, dry, has watched every tenant miss rent; speaks of modules as tenants.
- landlordIntro: 1-2 sentences: the repo name, the real file and module counts from "building", and one dry jab.
- landlordLine (per character): 1-2 sentences, the Landlord on that tenant, grounded in its links (who uses it, what it uses, over the network or by import) and its stats. Mention a real number or name.
- landlordOutro: 1-2 sentences closing the tour, with one real fact from "building" (a loop, the most depended-on module, or one nobody uses).
- The Landlord swears at the active spice level like everyone else.
- links.usedBy = modules that depend on this one; links.uses = modules this one depends on. Never swap them: "5 modules lean on it" and "it leans on 5 modules" are different facts.
- Use only the counts given (lines, files, testFiles, TODOs, links). Never count or guess anything else, such as tests inside a file.`;

// OpenAI-strict compatible (top-level object, additionalProperties false, all required); Gemini takes it too.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['characters', 'landlordIntro', 'landlordOutro'],
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['moduleId', 'title', 'personality', 'catchphrase', 'greeting', 'gossip', 'voicePitch', 'about', 'landlordLine'],
        properties: {
          moduleId: { type: 'string', description: 'Copy exactly from the input.' },
          title: { type: 'string', description: 'Module name plus a short dry descriptor grounded in its stats, e.g. "payments, the accountant" or "utils, the junk drawer".' },
          personality: { type: 'string', description: 'One sentence, grounded in real stats or code.' },
          catchphrase: { type: 'string', description: 'Max 12 words, dry, references a real fact.' },
          greeting: { type: 'string', description: 'Exactly 2 sentences, first person, introduces itself with real numbers (lines, files, TODOs, tests).' },
          gossip: {
            type: 'array',
            items: { type: 'string' },
            description: '4 lines, max 18 words each, about other modules (using their real stats/code from the input) or itself.',
          },
          voicePitch: { type: 'number', description: 'Between 0.6 and 1.8. Lower for big, heavy modules; higher for small, nervous ones.' },
          about: { type: 'string', description: 'One plain sentence under 20 words: what this module does.' },
          landlordLine: { type: 'string', description: "The Landlord's 1-2 sentences about this module on the tour, grounded in its links and stats." },
        },
      },
    },
    landlordIntro: { type: 'string' },
    landlordOutro: { type: 'string' },
  },
};

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

// Trust boundary: rebuild modules from known fields only, truncated, so the prompt stays small
// and a malformed body can't crash the template fallback.
const strings = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, 12).map((x) => clip(x, 120)).filter(Boolean) : []).slice(0, n);

function clean(m: InModule): Module & { keyFiles: KeyFile[]; testFiles: number; links: { usedBy: string[]; uses: string[] } } {
  const s = (m.stats ?? {}) as Partial<ModuleStats>;
  return {
    id: clip(m.id, 200),
    name: clip(m.name, 100) || clip(m.id, 100),
    path: clip(m.path, 200),
    filePaths: (Array.isArray(m.filePaths) ? m.filePaths : []).slice(0, 40).map((p) => clip(p, 200)),
    stats: {
      fileCount: num(s.fileCount),
      totalLines: num(s.totalLines),
      biggestFile: { path: clip(s.biggestFile?.path, 200), lines: num(s.biggestFile?.lines) },
      todoCount: num(s.todoCount),
      maxNesting: num(s.maxNesting),
      hasTests: s.hasTests === true,
    },
    testFiles: num(m.testFiles),
    links: { usedBy: strings(m.links?.usedBy, 12), uses: strings(m.links?.uses, 12) },
    keyFiles: (Array.isArray(m.keyFiles) ? m.keyFiles : []).slice(0, 2).map((f) => ({
      path: clip(f?.path, 200),
      head: clip(f?.head, 8000).split('\n').slice(0, 40).map((l) => l.slice(0, 160)).join('\n'),
    })),
  };
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: 'rate limited' }, { status: 429 }); // client falls back to templates
  const body = await req.json().catch(() => null);
  const list: InModule[] = Array.isArray(body?.modules) ? body.modules : [];
  const modules = list.filter((m) => m?.id).slice(0, 8).map(clean);
  if (!modules.length) return Response.json({ error: 'No modules given.' }, { status: 400 });

  const input = modules.map(({ id, name, path, stats, filePaths, keyFiles, links, testFiles }) => ({
    moduleId: id,
    name,
    path,
    stats: { ...stats, testFiles },
    links,
    files: filePaths,
    keyFiles: keyFiles.map((f) => ({ path: f.path, first40Lines: f.head })),
  }));

  // Repo-wide facts for the Landlord (counts, tour order, loops, the most and least used modules). Known keys only.
  const b = body?.building ?? {};
  const building = {
    files: num(b.files),
    modules: num(b.modules),
    todos: num(b.todos),
    tourOrder: strings(b.tourOrder, 8),
    mostDependedOn: clip(b.mostDependedOn, 120),
    nobodyUses: strings(b.nobodyUses, 8),
    dependencyLoops: strings(b.dependencyLoops, 4),
    needsTheMost: clip(b.needsTheMost, 120),
  };
  const mode = body?.mode === 'expert' ? 'expert' : 'beginner';

  let characters: RawCharacter[];
  let landlord: { intro: string; outro: string } | null = null;
  let source: 'llm' | 'fallback' = 'llm';
  try {
    const out = await llmJSON<{ characters: unknown; landlordIntro?: unknown; landlordOutro?: unknown }>('characters', {
      system: `${levelBlock(body?.spice)}
- The title stays printable; the attitude goes in the personality, catchphrase, greeting, gossip and the Landlord's lines. "about" stays plain.

${SYSTEM}
- ${mode === 'expert' ? 'MODE: EXPERT: the about sentence and the Landlord may use standard technical terms.' : `MODE: BEGINNER: no jargon without a plain definition in parentheses. ${PLAIN_WORDS}`}`,
      prompt: `Repo: ${clip(body?.repoName, 200)}\nWrite one character per module, in the same order, with the same moduleId values, plus the Landlord's intro and outro.\n\nBuilding: ${JSON.stringify(building)}\n\nModules:\n${JSON.stringify(input)}\n\n${levelReminder(body?.spice)}`,
      schema: SCHEMA,
      timeoutMs: 30_000,
    });
    characters = toRaw(modules, out.characters);
    const [intro, outro] = [clip(out.landlordIntro, 400).trim(), clip(out.landlordOutro, 400).trim()];
    if (intro && outro) landlord = { intro, outro };
  } catch (err) {
    console.error('[characters] all providers failed, using templates:', err);
    characters = modules.map((m) => fallbackCharacter(m, modules));
    source = 'fallback';
  }
  return Response.json({ characters, landlord, source });
}
