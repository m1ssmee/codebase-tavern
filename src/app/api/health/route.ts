import { llmStream } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    const stream = await llmStream('health', {
      system: 'You are a dry, deadpan English speaker. No emojis, no exclamation marks.',
      messages: [{ role: 'user', text: 'Introduce yourself to a hackathon judge in one sentence.' }],
      maxTokens: 400,
    });
    return Response.json({ ok: true, reply: await new Response(stream).text() });
  } catch (err) {
    console.error('[health] all providers failed:', err); // details stay in server logs
    return Response.json({ ok: false, error: 'LLM call failed, check server logs' }, { status: 500 });
  }
}
