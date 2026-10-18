import { createHash } from 'node:crypto';
import { rateLimited } from '@/lib/gemini';
import { llmJSON } from '@/lib/llm';
import { levelBlock, levelReminder, PLAIN_WORDS, VOICE_GUIDE } from '@/lib/voice';
import { fallbackGossip } from '@/lib/characters';
import { editLines, type Candidate } from '@/lib/editor';
import { codeFacts, knownNumbers } from '@/lib/guards';
import { cleanModule, clip, neighbour, promptModule, type InModule } from '@/lib/personaInput';
import { BUBBLE_RULE, bubbleOk, cleanBubble, recentBlock } from '@/lib/quip';
import type { SpiceLevel } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Gossip for ONE character, only when someone asks for it (the click menu's Gossip). Four lines, each written 3 ways
// in one call, then the deterministic filter and the comedy editor, with stat templates behind every line. The store
// caches it per repo@commit, spice and mode (memory and IndexedDB); this route caches by a hash of the exact input.

// Stays the same for every call, so OpenAI's prompt cache keeps it; the spice level and mode go in `dynamic`.
const SYSTEM = `You write gossip for one character in "Codebase Tavern", where each module (folder) of a repo is a character that speaks for itself.

${VOICE_GUIDE}

Rules:
- 4 gossip lines from the character under "Speaker", in the first person, max 18 words each: dry asides about the other tenants (their real stats, files and links) or about itself.
- Every line stands on at least one real fact from the input: a module name, a file name, a line count, a TODO count, "no tests", an import or call link. Never invent numbers, files or functions.
- At least one line is about a module it uses or that uses it (links), when it has any. links.usedBy = modules that depend on it; links.uses = modules it depends on; never swap them.
- If the code shown has a suspicious detail (a timeout shorter than another module's processing time, a retry with no safety check), one line may hint at it without naming a bug.
- Every line comes as 3 variants: three different jokes on the same fact, each a complete sentence. An editor picks the best one, so make them really different.
- Every line also gets a bubble: the speech bubble shown over the speaker when it says that line, ${BUBBLE_RULE}. Not one of the variants word for word; the four bubbles open differently.
- Gossip is about code, never about people. Never reuse the voice guide's example jokes (no "landfill with exports").`;

const S = { type: 'string' };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['gossip'],
  properties: {
    gossip: {
      type: 'array',
      description: '4 lines, each as 3 variants with its bubble',
      items: { type: 'object', additionalProperties: false, required: ['variants', 'bubble'], properties: { variants: { type: 'array', items: S, description: '3 variants of one gossip line' }, bubble: S } },
    },
  },
};

// ponytail: in memory per server instance, lost on a cold start; keyed by the exact cleaned input, so a client can't fill another request's entry.
const done = new Map<string, { lines: string[]; bubbles: string[]; source: 'llm' }>();
const CACHE_MAX = 500;
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: 'rate limited' }, { status: 429 }); // the client keeps its template lines
  const started = Date.now();
  const body = await req.json().catch(() => null);
  if (!body?.module?.id) return Response.json({ error: 'bad request' }, { status: 400 });
  const speaker = cleanModule(body.module as InModule);
  const others = (Array.isArray(body.others) ? (body.others as InModule[]) : []).filter((m) => m?.id && m.id !== speaker.id).slice(0, 7).map(cleanModule);
  const all = [speaker, ...others];
  const mode = body.mode === 'expert' ? 'expert' : 'beginner';
  const spice = typeof body.spice === 'string' ? body.spice : 'unhinged';
  const fallback = () => fallbackGossip(speaker, all);

  const prompt = `Repo: ${clip(body.repoName, 200)}\n\nSpeaker:\n${JSON.stringify(promptModule(speaker))}\n\nOther tenants:\n${JSON.stringify(others.map((o) => ({ ...neighbour(o), files: o.filePaths.slice(0, 8) })))}`;
  // The recent bubbles are client-sent text in the prompt, so they're part of the key: no request can fill an entry
  // another request (with other or no recent bubbles) would be served.
  const recent = recentBlock(body.recentBubbles);
  const key = createHash('sha256').update(JSON.stringify([prompt, spice, mode, recent])).digest('base64url');
  const hit = done.get(key);
  if (hit) {
    done.delete(key);
    done.set(key, hit);
    return Response.json({ ...hit, cached: true });
  }

  try {
    const out = await llmJSON<{ gossip?: unknown[] }>('gossip', {
      system: SYSTEM,
      dynamic: `${levelBlock(spice)}\n- ${mode === 'expert' ? 'MODE: EXPERT: standard technical terms are fine.' : `MODE: BEGINNER: no jargon without a plain definition in parentheses. ${PLAIN_WORDS}`}\n${recent}\n${levelReminder(spice)}`,
      prompt,
      schema: SCHEMA,
      timeoutMs: 20_000,
      attemptMs: 12_000,
    });
    // Three variants per line → the filter → the comedy editor; a line with no survivor gets its template.
    const known = knownNumbers(prompt);
    const statNums = (m: (typeof all)[number]) => [m.stats.totalLines, m.stats.fileCount, m.stats.todoCount, m.stats.biggestFile.lines, m.stats.maxNesting, m.testFiles].filter((n) => n > 0).map(String);
    const needs = all.flatMap((m) => [m.name, ...m.filePaths.map(base), ...statNums(m)]);
    const raw = (Array.isArray(out?.gossip) ? out.gossip : []).slice(0, 4) as { variants?: unknown; bubble?: unknown }[];
    const lines: Candidate[] = raw.map((g, i) => ({
      id: `g${i}`,
      variants: g?.variants,
      rules: { needs, facts: codeFacts(prompt), source: prompt, known, clean: spice === 'clean', maxWords: 18 },
      about: `gossip by ${speaker.name}`,
    }));
    const picked = await editLines('gossip', lines, spice, Math.min(4000, 30_000 - (Date.now() - started)));
    const fb = fallback();
    const chosen = lines.map((l, i) => picked.get(l.id) ?? fb[i % fb.length]).filter(Boolean);
    if (!picked.size) throw new Error('no gossip line survived the filter');
    // A line that fell back to its template has no bubble (the client makes one from the line).
    // Checked here too (short, no code or citations, past the filter at this spice) before it's cached or sent.
    const ok = (b: string) => (bubbleOk(b, spice as SpiceLevel) ? b : '');
    const bubbles = lines.map((l, i) => (picked.get(l.id) ? ok(cleanBubble(raw[i]?.bubble)) : '')).filter((_, i) => !!(picked.get(lines[i].id) ?? fb[i % fb.length]));
    const result = { lines: chosen, bubbles, source: 'llm' as const };
    done.set(key, result);
    if (done.size > CACHE_MAX) done.delete(done.keys().next().value!);
    return Response.json({ ...result, cached: false });
  } catch (err) {
    console.error('[gossip] using templates:', String(err).slice(0, 200));
    return Response.json({ lines: fallback(), source: 'fallback', cached: false });
  }
}
