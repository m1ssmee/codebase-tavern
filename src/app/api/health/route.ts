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
    console.error('[health] Gemini call failed:', err); // details stay in server logs
    return Response.json({ ok: false, model: MODEL, error: 'Gemini call failed, check server logs' }, { status: 500 });
  }
}
