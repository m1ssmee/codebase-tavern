import { rateLimited } from '@/lib/gemini';
import { llmStream } from '@/lib/llm';
import { levelBlock, levelReminder, PLAIN_WORDS, VOICE_GUIDE } from '@/lib/voice';
import { CiteChecker, parseCitations } from '@/lib/citations';
import { TurnScanner } from '@/lib/verdict';
import type { Citation } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Two modules argue about their real dependency: one call, 4 short turns streamed as NDJSON the moment each closes.
// Grounded in the import and call lines between them; every citation is checked against the code shown.

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const arr = <T,>(v: unknown, n: number): T[] => (Array.isArray(v) ? v.slice(0, n) : []);
const int = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : 0);
const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const SCHEMA = obj({ turns: { type: 'array', items: obj({ moduleId: { type: 'string' }, text: { type: 'string' } }) } });
const numbered = (code: string) =>
  code
    .replace(/\n$/, '')
    .split('\n')
    .map((l, i) => `${i + 1}| ${l}`)
    .join('\n');

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: 'busy' }, { status: 429 });
  const b = await req.json().catch(() => null);
  const who = (x: unknown) => ({ id: str((x as { id?: unknown })?.id, 200), title: str((x as { title?: unknown })?.title, 100), personality: str((x as { personality?: unknown })?.personality, 300) });
  const A = who(b?.a), B = who(b?.b);
  // Trust boundary: at most 4 files of 16KB, and only edges whose lines exist in them.
  const files = arr<{ path: string; content: string }>(b?.files, 4).map((f) => ({ path: str(f?.path, 300), content: str(f?.content, 16_000) })).filter((f) => f.path && f.content);
  const lines = new Map(files.map((f) => [f.path, f.content.replace(/\n$/, '').split('\n')]));
  const refs = arr<Record<string, unknown>>(b?.refs, 12)
    .map((r) => ({ from: str(r?.from, 200), to: str(r?.to, 200), kind: r?.kind === 'calls' ? 'calls' : 'imports', file: str(r?.file, 300), line: int(r?.line), endLine: int(r?.endLine) }))
    .filter((r) => r.line && (lines.get(r.file)?.length ?? 0) >= r.line && [A.id, B.id].includes(r.from) && [A.id, B.id].includes(r.to));
  if (!A.id || !B.id || A.id === B.id || !refs.length) return Response.json({ error: 'bad request' }, { status: 400 });

  const fact = (r: (typeof refs)[number]) => {
    const end = r.kind === 'calls' ? r.line : Math.max(r.line, r.endLine);
    const code = lines.get(r.file)!.slice(r.line - 1, end).map((l) => l.trim()).join(' ').slice(0, 160);
    return `- ${r.from} ${r.kind === 'calls' ? `calls ${r.to} over the network` : `imports ${r.to}`} at [${r.file}:${r.line}${end > r.line ? `-${end}` : ''}]: ${code}`;
  };
  const beginner = b?.mode !== 'expert';
  // Cache-friendly order (llm.ts): voice guide, rules, the two modules and their code (sorted by path) first; the
  // spice level and mode last.
  const shown = [...files].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const system = `${VOICE_GUIDE}

You write a short argument between two modules of the repo ${str(b?.repoName, 200)} in Codebase Tavern. Modules are characters; they argue about how they depend on each other.

Characters:
- ${A.id} ("${A.title}"): ${A.personality}
- ${B.id} ("${B.title}"): ${B.personality}

What actually connects them (the import graph):
${refs.map(fact).join('\n')}

Rules:
- turns: exactly 4, alternating ${A.id}, ${B.id}, ${A.id}, ${B.id}. moduleId is the speaker's id.
- Each turn is 1-2 short sentences, under 35 words, first person, in that module's voice, about this real dependency: who imports or calls whom, how often, with what (function names, fields, values from the code), and what that costs the other.
- Each turn cites the line it is talking about as [path:line] or [path:start-end], using the line numbers shown before "|". Never invent code.
- Roast the code, never people.
- The last turn is the last word: short and final.

Code:
${shown.map((f) => `=== ${f.path} ===\n${numbered(f.content)}`).join('\n\n')}`;
  const dynamic = `${levelBlock(b?.spice)}

${beginner ? `MODE: BEGINNER. No undefined jargon: plain words, or define a term in parentheses. ${PLAIN_WORDS}` : 'MODE: EXPERT. Standard technical terms are fine.'}

${levelReminder(b?.spice)}`;

  try {
    const llm = await llmStream('argue', { system, dynamic, messages: [{ role: 'user', text: `Write the 4 turns: ${A.id} starts.` }], schema: SCHEMA, maxTokens: 1500, timeoutMs: 30_000 });
    const checker = new CiteChecker(lines);
    const fmt = (c: Citation) => `[${c.path}:${c.startLine}${c.endLine !== c.startLine ? `-${c.endLine}` : ''}]`;
    // Citations only to the files shown, re-anchored or dropped when the cited lines don't hold what the sentence names.
    const clean = (text: string) =>
      parseCitations(checker.text(text))
        .map((seg) => (typeof seg === 'string' ? seg : (lines.get(seg.path)?.length ?? 0) >= seg.endLine && seg.startLine >= 1 ? fmt(seg) : ''))
        .join('')
        .replace(/ +([.,;])/g, '$1')
        .trim();
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: object) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
        const scanner = new TurnScanner();
        let sent = 0;
        try {
          const reader = llm.getReader();
          const dec = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const raw of scanner.push(dec.decode(value, { stream: true }))) {
              const t = raw as { moduleId?: unknown; text?: unknown };
              const text = clean(str(t?.text, 400));
              if (!text || sent >= 4) continue;
              // Alternation is enforced here, whatever the model wrote.
              send({ type: 'turn', turn: { moduleId: sent % 2 ? B.id : A.id, text } });
              sent++;
            }
          }
        } catch (err) {
          console.error('[argue] stream failed:', err);
        }
        console.info('[cites] argue', JSON.stringify(checker.counts), checker.changes.join('; '));
        send({ type: sent ? 'done' : 'error' });
        controller.close();
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[argue] failed:', err);
    return Response.json({ error: 'argue failed' }, { status: 502 });
  }
}
