import { rateLimited } from '@/lib/gemini';
import { llmStream, type Msg } from '@/lib/llm';
import { levelBlock, levelReminder, modeBlock, modeReminder, VOICE_GUIDE } from '@/lib/voice';
import { CONTEXT_BUDGET } from '@/lib/context';
import { CiteChecker, CiteStream } from '@/lib/citations';

export const runtime = 'nodejs';
export const maxDuration = 60;


const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const arr = <T,>(v: unknown, n: number): T[] => (Array.isArray(v) ? v.slice(0, n) : []);
const numbered = (code: string) =>
  code
    .replace(/\n$/, '')
    .split('\n')
    .map((l, i) => `${i + 1}| ${l}`)
    .join('\n');

// Pre-warm: /tavern pings this on load so the function is warm before the first click. No model call.
export function GET(req: Request) {
  if (new URL(req.url).searchParams.get('warm') !== '1') return new Response('Method Not Allowed', { status: 405 });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

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

${levelBlock(b.spice)}

${modeBlock(b.mode, b.spice)}

${VOICE_GUIDE}

Rules:
- Speak in first person as this module. Answer first, joke second. Follow the MODE structure and word limit above.
- Simple markdown only: numbered lists, **bold**, \`inline code\`. No headings, no code blocks. Don't repeat your catchphrase.
- Every factual claim about code cites [path:line] or [path:start-end] in square brackets, using the exact paths and the line numbers shown before "|". Never put citations in backticks. Cite the narrowest range that supports the claim, usually under 15 lines; never a whole file.
- Never invent code, files or behaviour. Only use the code below.
- If the question is about code outside your files, reply "Not mine. Ask <title>." using the title of the module that owns it, from the list below.
- If the answer is in a file marked [left out] or [truncated], say that file was left out of what you can see.

Other modules:
${others || '- none'}

Your files (${allPaths.length}):
${allPaths.map((p) => `- ${p}${!shown.has(p) ? ' [left out]' : truncated.has(p) ? ' [truncated]' : ''}`).join('\n')}

Modules that import you, from the repo's import graph (cite these lines when asked who depends on you):
${arr<string>(b.dependents, 12).map((d) => '- ' + str(d, 1500)).join('\n') || '- none. No module imports you.'}

Modules you import:
${arr<string>(b.dependencies, 13).map((d) => '- ' + str(d, 1500)).join('\n') || '- none'}

Your code:
${files.map((f) => `=== ${f.path}${f.truncated ? ' [truncated]' : ''} ===\n${numbered(f.content)}`).join('\n\n')}

${levelReminder(b.spice)}
${modeReminder(b.mode)}`;

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
    // Every citation is checked against the code it points at on the way out (re-anchored or dropped if wrong).
    const checker = new CiteChecker(new Map(files.map((f) => [f.path, f.content.replace(/\n$/, '').split('\n')])));
    const cites = new CiteStream(checker);
    const [dec, enc] = [new TextDecoder(), new TextEncoder()];
    const checked = stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, out) {
          const text = cites.push(dec.decode(chunk, { stream: true }));
          if (text) out.enqueue(enc.encode(text));
        },
        flush(out) {
          const text = cites.push(dec.decode()) + cites.end();
          if (text) out.enqueue(enc.encode(text));
          console.info('[cites] chat', JSON.stringify(checker.counts), checker.changes.join('; '));
        },
      }),
    );
    return new Response(checked, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[chat] all providers failed:', err);
    // Missing/invalid key → 503 so the client can say "unavailable" instead of blaming rate limits.
    const noKey = /is not set|missing credentials|api.?key|\b401\b|PERMISSION_DENIED|unauthori[sz]ed/i.test(String(err));
    return Response.json({ error: noKey ? 'unavailable' : 'llm failed' }, { status: noKey ? 503 : 502 });
  }
}
