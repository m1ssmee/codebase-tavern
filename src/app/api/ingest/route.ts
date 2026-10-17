import { fetchRepo, MSG, Oops } from '@/lib/fetchRepo';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (typeof body?.url !== 'string') throw new Oops(400, MSG.invalid);
    const repo = await fetchRepo(body.url, AbortSignal.timeout(50_000)); // answer before Vercel kills us at 60s
    return new Response(JSON.stringify(repo), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    if (err instanceof Oops) return Response.json({ error: err.message }, { status: err.status });
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    console.error('[ingest] failed:', err);
    return Response.json({ error: timedOut ? MSG.slow : MSG.generic }, { status: timedOut ? 504 : 500 });
  }
}
