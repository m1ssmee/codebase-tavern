import 'server-only';
import { GoogleGenAI, ThinkingLevel, type GenerateContentConfig } from '@google/genai';

// Latest GA Flash as of Sept 2026 (https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
export const MODEL = 'gemini-3.8-flash';
// Next in the llm.ts chain when 3.8 returns 503/429 "high demand". 3.5-flash is served by 3.6 (separate capacity); 3.7-flash and
// gemini-flash-latest both resolve to 3.8, so they'd be just as busy (checked via modelVersion).
export const FALLBACK_MODEL = 'gemini-3.5-flash';

// Lowest thinking setting the model accepts (verified live: MINIMAL → 400; LOW → 0 thought tokens, ~4s vs ~7s default).
export const FAST: GenerateContentConfig = { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  return (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

// ponytail: in-memory, per server instance (Vercel may run several); swap for KV/Upstash if abuse matters.
const hits = new Map<string, number[]>();
/** 60 requests/minute per IP (judges may share one venue Wi-Fi IP), shared by every route that calls it. */
export function rateLimited(req: Request, limit = 60, windowMs = 60_000): boolean {
  // x-real-ip is only trustworthy on Vercel (it overwrites it); elsewhere everyone shares one bucket.
  let ip = (process.env.VERCEL && req.headers.get('x-real-ip')) || 'local';
  const now = Date.now();
  // Map order = least recently seen first. Evict only idle IPs from the front (stops at the first active one).
  for (const [k, ts] of hits) {
    if (hits.size < 5000 || now - ts[ts.length - 1] < windowMs) break;
    hits.delete(k);
  }
  // ponytail: full of active IPs → newcomers share one rate-limited overflow bucket (no eviction of real users,
  // no global lockout). A shared store (Upstash/KV) is the real fix if this ever matters.
  if (!hits.has(ip) && hits.size >= 5000) ip = 'overflow';
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.delete(ip);
  hits.set(ip, recent);
  return recent.length > limit;
}
