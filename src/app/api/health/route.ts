import { gemini, MODEL } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: 'Say hello to a hackathon judge in one short, funny Hinglish sentence.',
    });
    return Response.json({ ok: true, model: MODEL, reply: res.text });
  } catch (err) {
    return Response.json({ ok: false, model: MODEL, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
