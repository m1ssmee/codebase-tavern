import JSZip from 'jszip';
import { byPriority, CAP_REASON, filterFiles, MAX_FILES, MAX_TOTAL, parseGitHubUrl, skipReason, type Entry } from '@/lib/analyze';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_ZIP = 60 * 1024 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;

const MSG = {
  invalid: "That's not a GitHub link.",
  notFound: "That repo is private or doesn't exist.",
  tooBig: 'Repo too large. Try a smaller one or a subfolder link.',
  slow: 'GitHub took too long to send the repo. Try a smaller one or a subfolder link.',
  rateLimit: "GitHub's rate limit is used up. Try again in a few minutes.",
  empty: 'No source files in that repo. Only docs, config or binaries.',
  generic: 'Something went wrong fetching that repo. Try again.',
};

class Oops extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const gh = (url: string, signal?: AbortSignal) =>
  fetch(url, {
    signal,
    headers: {
      'User-Agent': 'codebase-tavern',
      Accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
    },
  });

function check(res: Response, what: string): Response {
  if (res.ok) return res;
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    console.error(`[ingest] GitHub rate limit hit on ${what}. Set GITHUB_TOKEN (60 → 5000 req/h).`);
    throw new Oops(429, MSG.rateLimit);
  }
  if (res.status === 404 || res.status === 403) throw new Oops(404, MSG.notFound);
  if (res.status === 401) console.error('[ingest] GitHub rejected GITHUB_TOKEN (401). Check or remove it.');
  throw new Error(`GitHub ${res.status} on ${what}`);
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (Number(res.headers.get('content-length')) > max) throw new Oops(413, MSG.tooBig);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > max) throw new Oops(413, MSG.tooBig); // breaking the loop cancels the download
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = typeof body?.url === 'string' ? parseGitHubUrl(body.url) : null;
    if (!parsed) throw new Oops(400, MSG.invalid);
    const { owner, repo, subpath } = parsed;
    const signal = AbortSignal.timeout(50_000); // answer before Vercel kills us at 60s

    const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const info = await check(await gh(api, signal), 'repo info').json();
    // GITHUB_TOKEN may be able to read private repos; never hand those to anonymous visitors.
    if (info.private !== false || info.visibility !== 'public') throw new Oops(404, MSG.notFound);
    const branch: string = parsed.ref ?? info.default_branch;
    const zipRes = check(await gh(`${api}/zipball/${encodeURIComponent(branch)}`, signal), 'zipball');
    const zip = await JSZip.loadAsync(await readCapped(zipRes, MAX_ZIP));

    const pre: Record<string, number> = {};
    const tally = (why: string) => (pre[why] = (pre[why] ?? 0) + 1);
    const candidates: { rel: string; f: JSZip.JSZipObject }[] = [];
    const prefix = subpath ? subpath + '/' : '';
    for (const f of Object.values(zip.files)) {
      if (f.dir) continue;
      const path = f.name.slice(f.name.indexOf('/') + 1); // strip "owner-repo-sha/"
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length);
      // ponytail: _data is jszip-internal; lets us skip huge files without decoding them
      const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      const why = skipReason(rel, size);
      if (why) tally(why);
      else candidates.push({ rel, f });
    }

    // Decompress best-first and stop at ~2x the caps (margin for files filterFiles still rejects),
    // so a zip bomb of many tiny files can't blow up memory.
    candidates.sort((a, b) => byPriority(a.rel, b.rel));
    const entries: Entry[] = [];
    let decoded = 0;
    for (const { rel, f } of candidates) {
      if (decoded > MAX_TOTAL * 2 || entries.length >= MAX_FILES * 2) {
        tally(CAP_REASON);
        continue;
      }
      const content = await f.async('string');
      decoded += content.length;
      entries.push({ path: rel, content });
    }

    const { files, skipped } = filterFiles(entries, pre);
    if (!files.length) throw new Oops(422, subpath && !entries.length && !skipped.count ? MSG.notFound : MSG.empty);

    const payload = { name: `${owner}/${repo}${subpath ? '/' + subpath : ''}`, url: parsed.url, branch, files, skipped };
    let json = JSON.stringify(payload);
    // Files are priority-sorted, so drop from the end until we fit Vercel's response limit.
    while (Buffer.byteLength(json) > MAX_RESPONSE && files.length) {
      files.pop();
      skipped.count++;
      skipped.reasons[CAP_REASON] = (skipped.reasons[CAP_REASON] ?? 0) + 1;
      json = JSON.stringify(payload);
    }
    return new Response(json, { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    if (err instanceof Oops) return Response.json({ error: err.message }, { status: err.status });
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    console.error('[ingest] failed:', err);
    return Response.json({ error: timedOut ? MSG.slow : MSG.generic }, { status: timedOut ? 504 : 500 });
  }
}
