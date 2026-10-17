import { getRepo, MSG, Oops } from '@/lib/fetchRepo';

export const runtime = 'nodejs';
export const maxDuration = 60;

// NDJSON, one object per line: {type:'step', step} as each real step happens (the loading screen reads them out),
// then {type:'repo', repo}, or {type:'same', key} when the browser's cached copy (`known`) is still the latest commit,
// or {type:'error', error, status} with an in-character message. The HTTP status is 200 once streaming starts.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (typeof body?.url !== 'string') return Response.json({ error: MSG.invalid }, { status: 400 });
  const known = typeof body.known === 'string' && body.known.length < 400 ? body.known : undefined;
  const enc = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (o: object) => c.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      try {
        const out = await getRepo(body.url, AbortSignal.timeout(50_000), (step) => send({ type: 'step', step, ms: Date.now() - started }), known); // answer before Vercel kills us at 60s
        if ('same' in out) send({ type: 'same', key: out.key });
        else send({ type: 'repo', repo: out });
        console.info(`[ingest] ${body.url.slice(0, 120)}: ${'same' in out ? 'unchanged' : `${out.files.length} files`} in ${Date.now() - started}ms`);
      } catch (err) {
        const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
        if (!(err instanceof Oops)) console.error('[ingest] failed:', err);
        send({ type: 'error', error: err instanceof Oops ? err.message : timedOut ? MSG.slow : MSG.generic, status: err instanceof Oops ? err.status : timedOut ? 504 : 500 });
      }
      c.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
