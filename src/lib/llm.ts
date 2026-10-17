import 'server-only';
import OpenAI from 'openai';
import { FALLBACK_MODEL, FAST, gemini, MODEL } from './gemini';

// Provider chain for every route: gemini-3.8-flash → gemini-3.5-flash → OpenAI mini.
// LLM_PROVIDER=openai forces OpenAI (use it for testing so we don't burn the Gemini free quota).
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini'; // verified live: reasoning_effort none/low, json_schema, stream

type Provider = { name: string; kind: 'gemini' | 'openai'; model: string };
export type Msg = { role: 'user' | 'assistant'; text: string };

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

// 429 / 503 / quota / missing key → try the next provider. Anything else is a real error.
const fallsThrough = (err: unknown) =>
  /\b(429|503|UNAVAILABLE|RESOURCE_EXHAUSTED|quota|insufficient_quota|rate.?limit|overloaded|is not set)\b/i.test(String(err));

async function run<T>(label: string, fn: (p: Provider) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const p of chain()) {
    try {
      const out = await fn(p);
      console.info(`[llm] ${label} served by ${p.name}`);
      return out;
    } catch (err) {
      last = err;
      if (!fallsThrough(err)) break;
      console.warn(`[llm] ${label}: ${p.name} unavailable, trying next:`, String(err).slice(0, 140));
    }
  }
  throw last;
}

/** Streams plain text. Awaits the first response so provider errors throw here, not mid-stream. */
export function llmStream(label: string, opts: { system: string; messages: Msg[]; maxTokens?: number }): Promise<ReadableStream<Uint8Array>> {
  const enc = new TextEncoder();
  return run(label, async (p) => {
    let chunks: AsyncIterable<string>;
    if (p.kind === 'gemini') {
      const res = await gemini().models.generateContentStream({
        model: p.model,
        contents: opts.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
        config: { ...FAST, systemInstruction: opts.system, temperature: 0.8, maxOutputTokens: opts.maxTokens ?? 2048 },
      });
      chunks = (async function* () {
        for await (const c of res) if (c.text) yield c.text;
      })();
    } else {
      const res = await openai().chat.completions.create({
        model: p.model,
        reasoning_effort: 'low',
        stream: true,
        max_completion_tokens: opts.maxTokens ?? 2048,
        messages: [{ role: 'system', content: opts.system }, ...opts.messages.map((m) => ({ role: m.role, content: m.text }))],
      });
      chunks = (async function* () {
        for await (const c of res) if (c.choices[0]?.delta?.content) yield c.choices[0].delta.content;
      })();
    }
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const t of chunks) controller.enqueue(enc.encode(t));
        } catch (err) {
          console.error(`[llm] ${label} stream failed:`, err);
        }
        controller.close();
      },
    });
  });
}

/**
 * Structured JSON. `schema` must be OpenAI-strict compatible: top-level object, every object has
 * additionalProperties:false and lists all properties in required. Gemini accepts the same schema.
 */
export function llmJSON<T>(label: string, opts: { system: string; prompt: string; schema: object; timeoutMs?: number }): Promise<T> {
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
      return JSON.parse(res.text ?? '') as T;
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
    return JSON.parse(res.choices[0].message.content ?? '') as T;
  });
}
