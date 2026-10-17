import { rateLimited } from '@/lib/gemini';
import { llmJSON } from '@/lib/llm';
import { VOICE_GUIDE } from '@/lib/voice';
import { fallbackCharacter, toRaw, type RawCharacter } from '@/lib/characters';
import type { Module, ModuleStats } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

type KeyFile = { path: string; head: string };
type InModule = Module & { keyFiles?: KeyFile[] };

const SYSTEM = `You turn code modules into characters for "Codebase Tavern", where each folder of a repo speaks for itself.

${VOICE_GUIDE}

Hard rules:
- Characters may only state facts present in the input (stats, file names, the code shown). Never invent numbers, functions or files.
- Every line must contain at least one real fact from the input.
- Write clean spice level (no swearing).
- gossip: 4 lines per character, max 18 words each, dry, about other modules or itself, each with a real fact.
- Across the whole cast, at least two gossip lines should hint at the most suspicious interaction between modules visible in the code shown (for example a timeout shorter than another module's processing time, or a retry with no safety check), without naming a bug.`;

// OpenAI-strict compatible (top-level object, additionalProperties false, all required); Gemini takes it too.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['characters'],
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['moduleId', 'title', 'personality', 'catchphrase', 'greeting', 'gossip', 'voicePitch'],
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
        },
      },
    },
  },
};

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

// Trust boundary: rebuild modules from known fields only, truncated, so the prompt stays small
// and a malformed body can't crash the template fallback.
function clean(m: InModule): Module & { keyFiles: KeyFile[] } {
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

  const input = modules.map(({ id, name, path, stats, filePaths, keyFiles }) => ({
    moduleId: id,
    name,
    path,
    stats,
    files: filePaths,
    keyFiles: keyFiles.map((f) => ({ path: f.path, first40Lines: f.head })),
  }));

  let characters: RawCharacter[];
  let source: 'llm' | 'fallback' = 'llm';
  try {
    const out = await llmJSON<{ characters: unknown }>('characters', {
      system: SYSTEM,
      prompt: `Repo: ${clip(body?.repoName, 200)}\nWrite one character per module, in the same order, with the same moduleId values.\n\nModules:\n${JSON.stringify(input)}`,
      schema: SCHEMA,
      timeoutMs: 25_000,
    });
    characters = toRaw(modules, out.characters);
  } catch (err) {
    console.error('[characters] all providers failed, using templates:', err);
    characters = modules.map((m) => fallbackCharacter(m, modules));
    source = 'fallback';
  }
  return Response.json({ characters, source });
}
