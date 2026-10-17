import { rateLimited } from '@/lib/gemini';
import { llmStream, type Msg } from '@/lib/llm';
import { VOICE_GUIDE } from '@/lib/voice';
import { CONTEXT_BUDGET } from '@/lib/context';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SPICE: Record<string, string> = {
  clean: 'Spice: clean = dry wit, no swearing.',
  spicy: 'Spice: spicy = occasional swearing, sharper roasts.',
  unhinged: 'Spice: unhinged = frequent swearing, brutal roasts of the code, still factual.',
};
const MODE: Record<string, string> = {
  beginner: 'Mode: beginner. Plain language, define any technical term you use, at most one analogy.',
  expert: 'Mode: expert. Terse and technical; name the pattern or risk directly.',
};

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const arr = <T,>(v: unknown, n: number): T[] => (Array.isArray(v) ? v.slice(0, n) : []);
const numbered = (code: string) =>
  code
    .replace(/\n$/, '')
    .split('\n')
    .map((l, i) => `${i + 1}| ${l}`)
    .join('\n');

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: 'rate limited' }, { status: 429 });
  const b = await req.json().catch(() => null);
  if (!b?.moduleId) return Response.json({ error: 'bad request' }, { status: 400 });

  // Trust boundary: clip everything; total code capped at the budget plus a little slack.
  let left = CONTEXT_BUDGET + 10_000;
  const files = arr<{ path: string; content: string; truncated: boolean }>(b.files, 200).flatMap((f) => {
    const content = str(f?.content, left);
    left -= content.length;
    return content ? [{ path: str(f.path, 300), content, truncated: !!f.truncated || content.length < (f.content?.length ?? 0) }] : [];
  });
  const shown = new Set(files.map((f) => f.path));
  const truncated = new Set(files.filter((f) => f.truncated).map((f) => f.path));
  const allPaths = arr<string>(b.allPaths, 500).map((p) => str(p, 300));
  const title = str(b.character?.title, 100) || str(b.moduleId, 100);
  const others = arr<{ title: string; path: string }>(b.others, 12)
    .map((o) => `- ${str(o?.title, 100)} (owns ${str(o?.path, 200) || 'the repo root files'})`)
    .join('\n');

  const system = `You are "${title}", a module of the repo ${str(b.repoName, 200)}, in Codebase Tavern.
Personality: ${str(b.character?.personality, 300)}
Catchphrase: ${str(b.character?.catchphrase, 150)}

${VOICE_GUIDE}

Rules:
- Speak in first person as this module. Answer first, joke second. Under 100 words.
- Plain text only: no markdown, no code blocks. Don't repeat your catchphrase.
- Every factual claim about code cites [path:line] or [path:start-end] in square brackets, using the exact paths and the line numbers shown before "|". Never put citations in backticks. Cite the narrowest range that supports the claim, usually under 15 lines; never a whole file.
- Never invent code, files or behaviour. Only use the code below.
- If the question is about code outside your files, reply "Not mine. Ask <title>." using the title of the module that owns it, from the list below.
- If the answer is in a file marked [left out] or [truncated], say that file was left out of what you can see.
- ${SPICE[b.spice] ?? SPICE.clean} Never slurs, hate speech or sexual content.
- ${MODE[b.mode] ?? MODE.beginner}

Other modules:
${others || '- none'}

Your files (${allPaths.length}):
${allPaths.map((p) => `- ${p}${!shown.has(p) ? ' [left out]' : truncated.has(p) ? ' [truncated]' : ''}`).join('\n')}

Lines elsewhere in the repo that import or mention you:
${arr<string>(b.dependents, 30).map((d) => '- ' + str(d, 300)).join('\n') || '- none found'}

Your code:
${files.map((f) => `=== ${f.path}${f.truncated ? ' [truncated]' : ''} ===\n${numbered(f.content)}`).join('\n\n')}`;

  // Providers want alternating turns starting with the user: map roles, drop leading assistant turns, merge repeats.
  const messages: Msg[] = [];
  for (const m of arr<{ role: string; text: string }>(b.messages, 8)) {
    const role = m?.role === 'user' ? 'user' : m?.role === 'character' ? 'assistant' : null;
    const text = str(m?.text, 4000);
    if (!role || !text || (!messages.length && role === 'assistant')) continue;
    const prev = messages.at(-1);
    if (prev?.role === role) prev.text += '\n\n' + text;
    else messages.push({ role, text });
  }
  if (messages.at(-1)?.role !== 'user') return Response.json({ error: 'bad request' }, { status: 400 });

  try {
    // maxTokens includes thinking tokens, so keep it roomy; the prompt holds answers under 100 words.
    const stream = await llmStream('chat', { system, messages, maxTokens: 2048 });
    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[chat] all providers failed:', err);
    // Missing/invalid key → 503 so the client can say "unavailable" instead of blaming rate limits.
    const noKey = /is not set|missing credentials|api.?key|\b401\b|PERMISSION_DENIED|unauthori[sz]ed/i.test(String(err));
    return Response.json({ error: noKey ? 'unavailable' : 'llm failed' }, { status: noKey ? 503 : 502 });
  }
}
