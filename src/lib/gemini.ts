import 'server-only';
import { GoogleGenAI } from '@google/genai';

// Latest GA Flash as of Sept 2026 (https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
export const MODEL = 'gemini-3.8-flash';

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  return (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

// Streams plain text chunks; return it as `new Response(streamText(...))` from a route.
export function streamText(opts: { prompt: string; system?: string; temperature?: number }): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        const res = await gemini().models.generateContentStream({
          model: MODEL,
          contents: opts.prompt,
          config: { systemInstruction: opts.system, temperature: opts.temperature },
        });
        for await (const chunk of res) if (chunk.text) controller.enqueue(enc.encode(chunk.text));
      } catch (err) {
        controller.enqueue(enc.encode('\n[Gemini error: ' + (err instanceof Error ? err.message : String(err)) + ']'));
      }
      controller.close();
    },
  });
}
