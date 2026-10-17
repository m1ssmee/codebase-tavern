import { rateLimited } from '@/lib/gemini';
import { llmJSON } from '@/lib/llm';
import { levelBlock, levelReminder, PLAIN_WORDS, VOICE_GUIDE } from '@/lib/voice';
import { fallbackCharacter, fallbackGossip, toRaw, type RawCharacter } from '@/lib/characters';
import { editLines, type Candidate } from '@/lib/editor';
import { codeFacts, knownNumbers } from '@/lib/guards';
import type { Module, ModuleStats } from '@/lib/types';
import { createHash } from 'node:crypto';

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
- gossip: 3 lines per character, max 18 words each, dry, about other modules or itself, each with a real fact.
- Every gossip line, every landlordLine and the landlordIntro and landlordOutro come as 3 variants: three different jokes on the same real fact, each a complete sentence. An editor picks the best one, so make them really different.
- Write characters only for the modules under "Modules"; "Other tenants" are context for gossip (their names, stats and links are real facts), never characters.
- Across the characters you write, at least one gossip line should hint at the most suspicious interaction between modules visible in the code shown (for example a timeout shorter than another module's processing time, or a retry with no safety check), without naming a bug.
- about: one plain sentence under 20 words for someone who has never seen this repo: what the module does, from the code shown. No jokes, no swearing.

The Landlord: owns the building (the repo) and narrates a guided tour of it. Not a module. Weary, dry, has watched every tenant miss rent; speaks of modules as tenants.
- landlordIntro: 1-2 sentences: the repo name, the real file and module counts from "building", and one dry jab.
- landlordLine (per character): 1-2 sentences, the Landlord on that tenant, grounded in its links (who uses it, what it uses, over the network or by import) and its stats. Mention a real number or name.
- landlordOutro: 1-2 sentences closing the tour, with one real fact from "building" (a loop, the most depended-on module, or one nobody uses).
- The Landlord swears at the active spice level like everyone else.
- links.usedBy = modules that depend on this one; links.uses = modules this one depends on. Never swap them: "5 modules lean on it" and "it leans on 5 modules" are different facts.
- Use only the counts given (lines, files, testFiles, TODOs, links). Never count or guess anything else, such as tests inside a file.`;

// OpenAI-strict compatible (top-level object, additionalProperties false, all required); Gemini takes it too.
const THREE = { type: 'array', items: { type: 'string' }, description: '3 variants of this line' };
const FULL = {
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
            items: { ...THREE, description: '3 variants of one gossip line' },
            description: '3 lines, each as 3 variants, max 18 words each, about other modules (using their real stats/code from the input) or itself.',
          },
          voicePitch: { type: 'number', description: 'Between 0.6 and 1.8. Lower for big, heavy modules; higher for small, nervous ones.' },
          about: { type: 'string', description: 'One plain sentence under 20 words: what this module does.' },
          landlordLine: { ...THREE, description: "3 variants of the Landlord's 1-2 sentences about this module on the tour, grounded in its links and stats." },
        },
      },
    },
    landlordIntro: THREE,
    landlordOutro: THREE,
  },
};
// A batch without the Landlord's intro and outro (another batch writes those).
const { landlordIntro: _i, landlordOutro: _o, ...CAST_ONLY } = FULL.properties; // eslint-disable-line @typescript-eslint/no-unused-vars
const BATCH = { ...FULL, required: ['characters'], properties: CAST_ONLY };

// ponytail: in memory per server instance, lost on a cold start. Keyed by a hash of the exact cleaned input, so a
// repeat of the same repo, commit, spice and mode is free, and a client can't fill another request's entry.
const done = new Map<string, unknown>();
const CACHE_MAX = 300;
const KEY_LINES = 24; // context cap per key file, so a new repo's cast stays around $0.02
const KEY_LINE_CHARS = 110;

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
    filePaths: (Array.isArray(m.filePaths) ? m.filePaths : []).slice(0, 20).map((p) => clip(p, 200)),
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
      head: clip(f?.head, 8000).split('\n').slice(0, KEY_LINES).map((l) => l.slice(0, KEY_LINE_CHARS)).join('\n'),
    })),
  };
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: 'rate limited' }, { status: 429 }); // client falls back to templates
  const started = Date.now();
  const body = await req.json().catch(() => null);
  const list: InModule[] = Array.isArray(body?.modules) ? body.modules : [];
  const all = list.filter((m) => m?.id).slice(0, 8).map(clean);
  // Batches: `write` names the 2-3 modules this call writes; the rest are context. One batch also writes the Landlord.
  const write = Array.isArray(body?.write) ? new Set(body.write.slice(0, 8).map(String)) : null;
  const modules = write ? all.filter((m) => write.has(m.id)) : all;
  const others = write ? all.filter((m) => !write.has(m.id)) : [];
  const wantLandlord = write ? body?.landlord === true : true;
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
  const neighbours = others.map(({ name, stats, links, testFiles }) => ({ name, stats: { ...stats, testFiles }, links }));
  const cacheKey = createHash('sha256')
    .update(JSON.stringify([clip(body?.repoName, 200), input, neighbours, building, String(body?.spice), mode, wantLandlord]))
    .digest('base64url');
  const hit = done.get(cacheKey);
  if (hit) {
    done.delete(cacheKey);
    done.set(cacheKey, hit);
    return Response.json({ ...(hit as object), cached: true });
  }

  let characters: RawCharacter[];
  let landlord: { intro: string; outro: string } | null = null;
  let source: 'llm' | 'fallback' = 'llm';
  try {
    const prompt = `Repo: ${clip(body?.repoName, 200)}\nWrite one character per module under "Modules", in the same order, with the same moduleId values${wantLandlord ? ", plus the Landlord's intro and outro" : ''}.\n\nBuilding: ${JSON.stringify(building)}\n\nModules:\n${JSON.stringify(input)}${neighbours.length ? `\n\nOther tenants (context only, no characters):\n${JSON.stringify(neighbours)}` : ''}\n\n${levelReminder(body?.spice)}`;
    type Three = unknown; // 3 variants, resolved by the editor below
    const out = await llmJSON<{ characters: { moduleId?: string; gossip?: Three[]; landlordLine?: Three }[]; landlordIntro?: Three; landlordOutro?: Three }>('characters', {
      system: `${levelBlock(body?.spice)}
- The title stays printable; the attitude goes in the personality, catchphrase, greeting, gossip and the Landlord's lines. "about" stays plain.

${SYSTEM}
- ${mode === 'expert' ? 'MODE: EXPERT: the about sentence and the Landlord may use standard technical terms.' : `MODE: BEGINNER: no jargon without a plain definition in parentheses. ${PLAIN_WORDS}`}`,
      prompt,
      schema: wantLandlord ? FULL : BATCH,
      timeoutMs: write ? 25_000 : 34_000, // the client gives up at 45s; the editor needs a few seconds after this
      // A two-module batch takes 6-12s; an OpenAI attempt sometimes stalls, so one past 15s is retried (not left to 25s).
      ...(write && { attemptMs: 15_000 }),
    });
    // Gossip and the Landlord's lines: 3 variants each → the filter → the comedy editor; no survivor → the template.
    const known = knownNumbers(prompt);
    const facts = codeFacts(prompt);
    const clean = body?.spice === 'clean';
    const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
    const statNums = (m: (typeof modules)[number]) => [m.stats.totalLines, m.stats.fileCount, m.stats.todoCount, m.stats.biggestFile.lines, m.stats.maxNesting, m.testFiles].filter((n) => n > 0).map(String);
    const anyFact = [...all.flatMap((m) => [m.name, ...m.filePaths.map(base), ...statNums(m)]), String(building.files), String(building.modules)];
    const raw = Array.isArray(out?.characters) ? out.characters : [];
    const lines: Candidate[] = [];
    modules.forEach((m, mi) => {
      const c = raw.find((x) => x?.moduleId === m.id);
      if (!c) return;
      (Array.isArray(c.gossip) ? c.gossip : []).slice(0, 3).forEach((g, gi) => lines.push({ id: `g${mi}-${gi}`, variants: g, rules: { needs: anyFact, facts, source: prompt, known, clean, maxWords: 18 }, about: `gossip by ${m.name}` }));
      const near = [m.name, ...m.links.usedBy, ...m.links.uses, ...statNums(m)];
      lines.push({ id: `l${mi}`, variants: c.landlordLine, rules: { needs: near, facts, source: prompt, known, clean, maxWords: 50 }, about: `the Landlord on ${m.name}` });
    });
    const repoShort = clip(body?.repoName, 200).split('/').pop() ?? '';
    if (wantLandlord)
      lines.push(
        { id: 'intro', variants: out?.landlordIntro, rules: { needs: [repoShort, String(building.files), String(building.modules)], known, clean, maxWords: 50 }, about: 'the Landlord opens the tour' },
        { id: 'outro', variants: out?.landlordOutro, rules: { needs: anyFact, facts, source: prompt, known, clean, maxWords: 50 }, about: 'the Landlord closes the tour' },
      );
    // A batch gives the editor 4s (it usually takes 1.5-3s): past that, the first line that passed the filter.
    const picked = await editLines('characters', lines, body?.spice, Math.min(write ? 4000 : 8000, 42_000 - (Date.now() - started)));
    const resolved = modules.map((m, mi) => {
      const c = raw.find((x) => x?.moduleId === m.id);
      if (!c) return c;
      const fb = fallbackGossip(m, all);
      const gossip = (Array.isArray(c.gossip) ? c.gossip : []).slice(0, 3).map((_, gi) => picked.get(`g${mi}-${gi}`) ?? fb[gi % fb.length]);
      return { ...c, gossip, landlordLine: picked.get(`l${mi}`) ?? '' };
    });
    // Templates for anything missing talk about the whole cast, not just this batch.
    characters = toRaw(all, resolved.filter(Boolean)).filter((c) => modules.some((m) => m.id === c.moduleId));
    const [intro, outro] = [clip(picked.get('intro'), 400).trim(), clip(picked.get('outro'), 400).trim()];
    if (intro && outro) landlord = { intro, outro };
  } catch (err) {
    console.error('[characters] all providers failed, using templates:', err);
    characters = modules.map((m) => fallbackCharacter(m, all));
    source = 'fallback';
    return Response.json({ characters, landlord, source });
  }
  const result = { characters, landlord, source };
  done.set(cacheKey, result);
  if (done.size > CACHE_MAX) done.delete(done.keys().next().value!);
  return Response.json({ ...result, cached: false });
}
