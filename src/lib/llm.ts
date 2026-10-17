import 'server-only';
import OpenAI from 'openai';
import { FALLBACK_MODEL, FAST, gemini, MODEL } from './gemini';
import { matchesSchema } from './guards';
import { costOf, openaiSpend, reserve, type Reservation } from './spend';
import { keyPool } from './openaiKeys';

// Provider chain for every route: OpenAI mini → gemini-3.8-flash → gemini-3.5-flash; the routes' templates after that.
// OpenAI has two keys (openaiKeys.ts): OPENAI_API_KEY until its account is out of credit, then OPENAI_API_KEY_BACKUP.
// OpenAI is skipped once this instance has spent OPENAI_DAILY_BUDGET_USD today across both keys (spend.ts).
//
// Prompts are cache-friendly (OpenAI caches a repeated prefix of 1024+ tokens): `system` holds what stays the same
// for a module or a case (voice guide, rules, the code in a fixed order); `dynamic` holds what changes per call (spice
// level, mode, grudges, the lines pointed at). OpenAI gets `dynamic` as a second system message right before the
// newest user message, so the stable prompt and the earlier conversation stay one cacheable prefix.
// LLM_PROVIDER=openai forces OpenAI (still within the budget); LLM_PROVIDER=gemini forces Gemini (temperature tuning).
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini'; // verified live: reasoning_effort none/low, json_schema, stream

// One creativity setting for every call (chat, characters, gossip, Tribunal, What-if, roast, the Landlord). The
// pure-joke lines get 3 candidates, a filter and an editor; facts get citation checks (see guards.ts, editor.ts).
// Provisional 1.4 for Gemini: one sample at 1.6 (gemini-3.5-flash, quickcart cast) stayed coherent; the 1.2/1.4/1.6
// tuning on gemini-3.8-flash is still to do. gpt-5.4-mini (reasoning low) only accepts its default of 1.
// LLM_TEMPERATURE (0-2) overrides it.
const DEFAULT_TEMPERATURE = 1.4;
const envTemp = Number(process.env.LLM_TEMPERATURE);
export const TEMPERATURE = process.env.LLM_TEMPERATURE && envTemp >= 0 && envTemp <= 2 ? envTemp : DEFAULT_TEMPERATURE;

// Models that only accept their default temperature (gpt-5.x with reasoning on, for one): learned at runtime,
// logged once, and the parameter is left out for them from then on.
const noTemperature = new Set<string>();
const rejectsTemperature = (err: unknown) => /temperature/i.test(String(err)) && /unsupported|not support|only the default|invalid/i.test(String(err));
async function withTemperature<T>(p: Provider, temperature: number | undefined, call: (t: number | undefined) => Promise<T>): Promise<T> {
  if (temperature === undefined || noTemperature.has(p.model)) return call(undefined);
  try {
    return await call(temperature);
  } catch (err) {
    if (!rejectsTemperature(err)) throw err;
    noTemperature.add(p.model);
    console.warn(`[llm] ${p.name} rejects temperature ${temperature}; using its default from now on`);
    return call(undefined);
  }
}

type Provider = { name: string; kind: 'gemini' | 'openai'; model: string };

/** One line per call with its token counts (and, for OpenAI, its cost and today's total on this instance). */
function logUsage(label: string, p: Provider, input?: number, cached?: number, output?: number, held?: Reservation) {
  if (input === undefined) return;
  const usd = p.kind === 'openai' ? costOf(input, cached ?? 0, output ?? 0) : 0;
  const today = p.kind === 'openai' ? ` usd=${usd.toFixed(5)} today=${(held ? held.settle(usd) : openaiSpend.add(usd)).toFixed(4)}` : '';
  const share = input ? Math.round((100 * (cached ?? 0)) / input) : 0;
  console.info(`[llm] usage ${label} ${p.name} in=${input} cached=${cached ?? 0} out=${output ?? 0}${today} cache=${share}%${p.kind === 'openai' ? ` key=${keys.current() ?? 'none'}` : ''}`);
}
export type Msg = { role: 'user' | 'assistant'; text: string };
/** One provider attempt: who, how long to the first chunk (streams) and in total. Failed attempts are recorded too. */
export type Timing = { label: string; provider: string; ok: boolean; ms: number; firstChunkMs?: number; totalMs?: number; error?: string };

let budgetLogged = '';
/** OpenAI unless its key is missing or today's budget is spent (logged once a day per instance). */
function openaiOk() {
  if (!keys.available()) return false; // no key set, or both accounts out of credit
  if (!openaiSpend.over()) return true;
  const day = new Date().toISOString().slice(0, 10);
  if (budgetLogged !== day) {
    budgetLogged = day;
    console.warn(`[llm] OpenAI daily budget reached ($${openaiSpend.spent().toFixed(2)} of $${openaiSpend.budget.toFixed(2)} on this instance); Gemini, then templates, until 00:00 UTC`);
  }
  return false;
}

function chain(): Provider[] {
  const openai: Provider = { name: `openai:${OPENAI_MODEL}`, kind: 'openai', model: OPENAI_MODEL };
  const gem: Provider[] = [
    { name: MODEL, kind: 'gemini', model: MODEL },
    { name: FALLBACK_MODEL, kind: 'gemini', model: FALLBACK_MODEL },
  ];
  const useOpenAI = openaiOk();
  if (process.env.LLM_PROVIDER === 'openai' && useOpenAI) return [openai];
  if (process.env.LLM_PROVIDER === 'gemini') return gem;
  return useOpenAI ? [openai, ...gem] : gem;
}

// The SDK's own retries are off: the pool retries rate limits on the same key and switches keys on credit errors.
const keys = keyPool(
  [
    { name: 'primary', key: process.env.OPENAI_API_KEY },
    { name: 'backup', key: process.env.OPENAI_API_KEY_BACKUP },
  ],
  (apiKey) => new OpenAI({ apiKey, maxRetries: 0 }),
);

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
  opts: { system: string; dynamic?: string; messages: Msg[]; maxTokens?: number; schema?: object; timeoutMs?: number; timings?: Timing[]; temperature?: number },
): Promise<ReadableStream<Uint8Array>> {
  const enc = new TextEncoder();
  return run(
    label,
    async (p, timing) => {
    const t0 = Date.now();
    let chunks: AsyncIterable<string>;
    const temp = opts.temperature ?? TEMPERATURE;
    if (p.kind === 'gemini') {
      const res = await withTemperature(p, temp, (temperature) =>
        gemini().models.generateContentStream({
          model: p.model,
          contents: opts.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
          config: {
            ...FAST,
            systemInstruction: opts.dynamic ? `${opts.system}\n\n${opts.dynamic}` : opts.system,
            ...(temperature !== undefined && { temperature }),
            maxOutputTokens: opts.maxTokens ?? 2048,
            ...(opts.schema && { responseMimeType: 'application/json', responseJsonSchema: opts.schema }),
            ...(opts.timeoutMs && { abortSignal: AbortSignal.timeout(opts.timeoutMs) }),
          },
        }),
      );
      chunks = (async function* () {
        let usage: (typeof res extends AsyncIterable<infer C> ? C : never)['usageMetadata'];
        for await (const c of res) {
          usage = c.usageMetadata ?? usage;
          const why = c.promptFeedback?.blockReason ?? c.candidates?.[0]?.finishReason;
          if (c.text) yield c.text;
          else if (why && BLOCKED.test(String(why))) throw new Blocked(p.name, String(why));
        }
        logUsage(label, p, usage?.promptTokenCount, usage?.cachedContentTokenCount, (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0));
      })();
    } else {
      const held = reserve(opts.system.length + (opts.dynamic?.length ?? 0) + opts.messages.reduce((n, m) => n + m.text.length, 0), opts.maxTokens ?? 2048);
      const turns = opts.messages.map((m) => ({ role: m.role, content: m.text }));
      const messages = [{ role: 'system' as const, content: opts.system }, ...turns.slice(0, -1), ...(opts.dynamic ? [{ role: 'system' as const, content: opts.dynamic }] : []), ...turns.slice(-1)];
      const res = await withTemperature(p, temp, (temperature) =>
        keys.call((c) => c.chat.completions.create(
          {
            model: p.model,
            reasoning_effort: 'low',
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: opts.maxTokens ?? 2048,
            ...(temperature !== undefined && { temperature }),
            messages,
            ...(opts.schema && {
              response_format: { type: 'json_schema', json_schema: { name: label.replace(/\W/g, '_'), strict: true, schema: opts.schema as Record<string, unknown> } },
            }),
          },
          opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
        )),
      ).catch((err) => {
        held.refund(); // never started: nothing billed
        throw err;
      });
      chunks = (async function* () {
        for await (const c of res) {
          if (c.usage) logUsage(label, p, c.usage.prompt_tokens, c.usage.prompt_tokens_details?.cached_tokens, c.usage.completion_tokens, held);
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
 * Unparseable or off-schema output is retried once on the same provider, then falls through to the next one.
 * `temperature` overrides the shared setting (the comedy editor judges, it doesn't invent).
 */
export function llmJSON<T>(label: string, opts: { system: string; dynamic?: string; prompt: string; schema: object; timeoutMs?: number; timings?: Timing[]; temperature?: number }): Promise<T> {
  const timeout = opts.timeoutMs ?? 40_000;
  const temp = opts.temperature ?? TEMPERATURE;
  return run(label, async (p) => {
    const deadline = Date.now() + timeout; // shared by the first try and the retry
    const once = async (): Promise<string> => {
      if (p.kind === 'gemini') {
        const res = await withTemperature(p, temp, (temperature) =>
          gemini().models.generateContent({
            model: p.model,
            contents: opts.prompt,
            config: {
              ...FAST,
              systemInstruction: opts.dynamic ? `${opts.system}\n\n${opts.dynamic}` : opts.system,
              responseMimeType: 'application/json',
              responseJsonSchema: opts.schema,
              ...(temperature !== undefined && { temperature }),
              abortSignal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
            },
          }),
        );
        const u = res.usageMetadata;
        logUsage(label, p, u?.promptTokenCount, u?.cachedContentTokenCount, (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0));
        const why = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason;
        if (!res.text || (why && BLOCKED.test(String(why)))) throw new Blocked(p.name, String(why ?? 'no text'));
        return res.text;
      }
      const held = reserve(opts.system.length + (opts.dynamic?.length ?? 0) + opts.prompt.length, 4000); // no output cap on JSON calls: a generous guess
      const res = await withTemperature(p, temp, (temperature) =>
        keys.call((c) => c.chat.completions.create(
          {
            model: p.model,
            reasoning_effort: 'low',
            ...(temperature !== undefined && { temperature }),
            messages: [
              { role: 'system', content: opts.system },
              ...(opts.dynamic ? [{ role: 'system' as const, content: opts.dynamic }] : []),
              { role: 'user', content: opts.prompt },
            ],
            response_format: { type: 'json_schema', json_schema: { name: label.replace(/\W/g, '_'), strict: true, schema: opts.schema as Record<string, unknown> } },
          },
          { timeout: Math.max(1000, deadline - Date.now()) },
        )),
      ).catch((err) => {
        held.refund();
        throw err;
      });
      logUsage(label, p, res.usage?.prompt_tokens, res.usage?.prompt_tokens_details?.cached_tokens, res.usage?.completion_tokens, held);
      const ch = res.choices[0];
      if (!ch?.message.content || ch.message.refusal || ch.finish_reason === 'content_filter') throw new Blocked(p.name, ch?.finish_reason ?? 'no content');
      return ch.message.content;
    };
    for (let attempt = 1; ; attempt++) {
      const text = await once();
      const why = parseJSON(text, opts.schema);
      if (typeof why !== 'string') return why.value as T;
      if (attempt === 2 || deadline - Date.now() < 3000) throw new Blocked(p.name, why); // next provider, as before
      console.warn(`[llm] ${label}: ${p.name} returned ${why}; retrying once`);
    }
  }, opts.timings);
}

/** The parsed value, or why it is unusable. */
export function parseJSON(text: string, schema?: object): { value: unknown } | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'unparseable JSON';
  }
  return !schema || matchesSchema(value, schema) ? { value } : 'JSON that does not match the schema';
}
