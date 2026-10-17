import 'server-only';
import OpenAI from 'openai';
import { FALLBACK_MODEL, FAST, gemini, MODEL } from './gemini';

// Provider chain for every route: gemini-3.8-flash → gemini-3.5-flash → OpenAI mini.
// LLM_PROVIDER=openai forces OpenAI (use it for testing so we don't burn the Gemini free quota).
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini'; // verified live: reasoning_effort none/low, json_schema, stream

type Provider = { name: string; kind: 'gemini' | 'openai'; model: string };
export type Msg = { role: 'user' | 'assistant'; text: string };
/** One provider attempt: who, how long to the first chunk (streams) and in total. Failed attempts are recorded too. */
export type Timing = { label: string; provider: string; ok: boolean; ms: number; firstChunkMs?: number; totalMs?: number; error?: string };

function chain(): Provider[] {
  const openai: Provider = { name: `openai:${OPENAI_MODEL}`, kind: 'openai', model: OPENAI_MODEL };
  if (process.env.LLM_PROVIDER === 'openai') return [openai];
  const list: Provider[] = [
    { name: MODEL, kind: 'gemini', model: MODEL },
    { name: FALLBACK_MODEL, kind: 'gemini', model: FALLBACK_MODEL },
  ];
  return process.env.OPENAI_API_KEY ? [...list, openai] : list;
}

let oai: OpenAI | null = null;
const openai = () => (oai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

// 429 / 503 / quota / missing key / blocked or empty output → try the next provider. Anything else is a real error.
const fallsThrough = (err: unknown) =>
  /\b(429|503|UNAVAILABLE|RESOURCE_EXHAUSTED|quota|insufficient_quota|rate.?limit|overloaded|is not set|blocked|empty)\b/i.test(String(err));

// Gemini finish reasons that mean "the model refused / was filtered", not "the model finished".
const BLOCKED = /SAFETY|BLOCKLIST|PROHIBITED|SPII|RECITATION/;
class Blocked extends Error {
  constructor(provider: string, why: string) {
    super(`blocked or empty response from ${provider}: ${why}`);
  }
}

async function run<T>(label: string, fn: (p: Provider, t: Timing) => Promise<T>, timings?: Timing[]): Promise<T> {
  let last: unknown;
  for (const p of chain()) {
    const t0 = Date.now();
    const t: Timing = { label, provider: p.name, ok: false, ms: 0 };
    timings?.push(t);
    try {
      const out = await fn(p, t);
      t.ok = true;
      t.ms = Date.now() - t0;
      console.info(`[llm] ${label} served by ${p.name} in ${t.ms}ms`);
      return out;
    } catch (err) {
      last = err;
      t.ms = Date.now() - t0;
      t.error = String(err).slice(0, 120);
      if (!fallsThrough(err)) break;
      console.warn(`[llm] ${label}: ${p.name} unavailable after ${t.ms}ms, trying next:`, t.error);
    }
  }
  throw last;
}

/**
 * Streams text (or, with `schema`, schema-enforced JSON text). Awaits the first chunk so provider errors
 * throw here, not mid-stream.
 */
export function llmStream(
  label: string,
  opts: { system: string; messages: Msg[]; maxTokens?: number; schema?: object; timeoutMs?: number; timings?: Timing[] },
): Promise<ReadableStream<Uint8Array>> {
  const enc = new TextEncoder();
  return run(
    label,
    async (p, timing) => {
    const t0 = Date.now();
    let chunks: AsyncIterable<string>;
    if (p.kind === 'gemini') {
      const res = await gemini().models.generateContentStream({
        model: p.model,
        contents: opts.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
        config: {
          ...FAST,
          systemInstruction: opts.system,
          temperature: 0.8,
          maxOutputTokens: opts.maxTokens ?? 2048,
          ...(opts.schema && { responseMimeType: 'application/json', responseJsonSchema: opts.schema }),
          ...(opts.timeoutMs && { abortSignal: AbortSignal.timeout(opts.timeoutMs) }),
        },
      });
      chunks = (async function* () {
        for await (const c of res) {
          const why = c.promptFeedback?.blockReason ?? c.candidates?.[0]?.finishReason;
          if (c.text) yield c.text;
          else if (why && BLOCKED.test(String(why))) throw new Blocked(p.name, String(why));
        }
      })();
    } else {
      const res = await openai().chat.completions.create(
        {
          model: p.model,
          reasoning_effort: 'low',
          stream: true,
          max_completion_tokens: opts.maxTokens ?? 2048,
          messages: [{ role: 'system', content: opts.system }, ...opts.messages.map((m) => ({ role: m.role, content: m.text }))],
          ...(opts.schema && {
            response_format: { type: 'json_schema', json_schema: { name: label.replace(/\W/g, '_'), strict: true, schema: opts.schema as Record<string, unknown> } },
          }),
        },
        opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
      );
      chunks = (async function* () {
        for await (const c of res) {
          const ch = c.choices[0];
          if (ch?.delta?.content) yield ch.delta.content;
          else if (ch?.delta?.refusal || ch?.finish_reason === 'content_filter') throw new Blocked(p.name, ch.finish_reason ?? 'refusal');
        }
      })();
    }
    // Peek at the first text chunk before committing to this provider: a blocked or empty reply
    // falls through to the next one instead of reaching the user as an empty message.
    const it = chunks[Symbol.asyncIterator]();
    const first = await it.next();
    if (first.done) throw new Blocked(p.name, 'no text');
    timing.firstChunkMs = Date.now() - t0;
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(enc.encode(first.value));
          for (let r = await it.next(); !r.done; r = await it.next()) controller.enqueue(enc.encode(r.value));
        } catch (err) {
          console.error(`[llm] ${label} stream failed:`, err);
        }
        timing.totalMs = Date.now() - t0;
        console.info(`[llm] ${label} stream from ${p.name}: first chunk ${timing.firstChunkMs}ms, total ${timing.totalMs}ms`);
        controller.close();
      },
    });
    },
    opts.timings,
  );
}

/**
 * Structured JSON. `schema` must be OpenAI-strict compatible: top-level object, every object has
 * additionalProperties:false and lists all properties in required. Gemini accepts the same schema.
 */
export function llmJSON<T>(label: string, opts: { system: string; prompt: string; schema: object; timeoutMs?: number; timings?: Timing[] }): Promise<T> {
  const timeout = opts.timeoutMs ?? 40_000;
  return run(label, async (p) => {
    if (p.kind === 'gemini') {
      const res = await gemini().models.generateContent({
        model: p.model,
        contents: opts.prompt,
        config: {
          ...FAST,
          systemInstruction: opts.system,
          responseMimeType: 'application/json',
          responseJsonSchema: opts.schema,
          temperature: 0.8,
          abortSignal: AbortSignal.timeout(timeout),
        },
      });
      const why = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason;
      if (!res.text || (why && BLOCKED.test(String(why)))) throw new Blocked(p.name, String(why ?? 'no text'));
      return parseJSON<T>(res.text, p.name);
    }
    const res = await openai().chat.completions.create(
      {
        model: p.model,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.prompt },
        ],
        response_format: { type: 'json_schema', json_schema: { name: label.replace(/\W/g, '_'), strict: true, schema: opts.schema as Record<string, unknown> } },
      },
      { timeout },
    );
    const ch = res.choices[0];
    if (!ch?.message.content || ch.message.refusal || ch.finish_reason === 'content_filter') throw new Blocked(p.name, ch?.finish_reason ?? 'no content');
    return parseJSON<T>(ch.message.content, p.name);
  }, opts.timings);
}

function parseJSON<T>(text: string, provider: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Blocked(provider, 'unparseable JSON'); // treat like an empty reply: next provider
  }
}
