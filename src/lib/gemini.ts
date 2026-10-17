import 'server-only';
import { GoogleGenAI, ThinkingLevel, type ContentListUnion, type GenerateContentConfig } from '@google/genai';

// Latest GA Flash as of Sept 2026 (https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
export const MODEL = 'gemini-3.8-flash';
// When 3.8 returns 503 "high demand". 3.5-flash is served by 3.6 (separate capacity); 3.7-flash and
// gemini-flash-latest both resolve to 3.8, so they'd be just as busy (checked via modelVersion).
export const FALLBACK_MODEL = 'gemini-3.5-flash';

// Lowest thinking setting the model accepts (verified live: MINIMAL → 400; LOW → 0 thought tokens, ~4s vs ~7s default).
export const FAST: GenerateContentConfig = { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  return (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

/** Gemini has 503 "high demand" spikes and occasional 429s: on those, retry once on the fallback model. */
export async function withFallback<T>(fn: (model: string) => Promise<T>): Promise<T> {
  try {
    return await fn(MODEL);
  } catch (err) {
    if (!/\b(503|429|UNAVAILABLE|RESOURCE_EXHAUSTED)\b/.test(String(err))) throw err;
    console.warn(`[gemini] ${MODEL} busy, falling back to ${FALLBACK_MODEL}:`, String(err).slice(0, 120));
    return fn(FALLBACK_MODEL);
  }
}

/**
 * Streams plain text. Awaits the first response so auth/quota/config errors throw here (route can
 * return a real status) instead of mid-stream. Mid-stream errors are logged and the stream just ends.
 */
export async function streamText(opts: { contents: ContentListUnion; system?: string; config?: GenerateContentConfig }): Promise<ReadableStream<Uint8Array>> {
  const res = await withFallback((model) =>
    gemini().models.generateContentStream({
      model,
      contents: opts.contents,
      config: { ...FAST, systemInstruction: opts.system, ...opts.config },
    }),
  );
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of res) if (chunk.text) controller.enqueue(enc.encode(chunk.text));
      } catch (err) {
        console.error('[gemini] stream failed:', err);
      }
      controller.close();
    },
  });
}

// ponytail: in-memory, per server instance (Vercel may run several); swap for KV/Upstash if abuse matters.
const hits = new Map<string, number[]>();
/** 20 requests/minute per IP, shared by every route that calls it. */
export function rateLimited(req: Request, limit = 20, windowMs = 60_000): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude memory cap
  return recent.length > limit;
}
