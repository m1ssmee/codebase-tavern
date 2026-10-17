import 'server-only';
import JSZip from 'jszip';
import { byPriority, CAP_REASON, filterFiles, MAX_FILES, MAX_TOTAL, parseGitHubUrl, skipReason, type Entry, type Skipped } from './analyze';
import type { RepoFile } from './types';

// Fetches a public GitHub repo (zipball) and keeps the best files within the caps. Shared by /api/ingest (the
// browser's copy) and /api/roast (the server's own copy, so a signed card's numbers come from the real repo).

const MAX_ZIP = 60 * 1024 * 1024;
export const MAX_RESPONSE = 4 * 1024 * 1024;

export const MSG = {
  invalid: "That's not a GitHub link.",
  notFound: "That repo is private or doesn't exist.",
  tooBig: 'Repo too large. Try a smaller one or a subfolder link.',
  slow: 'GitHub took too long to send the repo. Try a smaller one or a subfolder link.',
  rateLimit: "GitHub's rate limit is used up. Try again in a few minutes.",
  empty: 'No source files in that repo. Only docs, config or binaries.',
  generic: 'Something went wrong fetching that repo. Try again.',
};

export class Oops extends Error {
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
    console.error(`[fetchRepo] GitHub rate limit hit on ${what}. Set GITHUB_TOKEN (60 → 5000 req/h).`);
    throw new Oops(429, MSG.rateLimit);
  }
  if (res.status === 404 || res.status === 403) throw new Oops(404, MSG.notFound);
  if (res.status === 401) console.error('[fetchRepo] GitHub rejected GITHUB_TOKEN (401). Check or remove it.');
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

export type FetchedRepo = { name: string; url: string; branch: string; files: RepoFile[]; skipped: Skipped };

/** A public repo by GitHub link or owner/repo, trimmed exactly as the browser receives it. Throws Oops for users. */
export async function fetchRepo(input: string, signal: AbortSignal): Promise<FetchedRepo> {
  const parsed = parseGitHubUrl(input);
  if (!parsed) throw new Oops(400, MSG.invalid);
  const { owner, repo, subpath } = parsed;
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
  // Files are priority-sorted, so drop from the end until we fit Vercel's response limit.
  while (Buffer.byteLength(JSON.stringify(payload)) > MAX_RESPONSE && files.length) {
    files.pop();
    skipped.count++;
    skipped.reasons[CAP_REASON] = (skipped.reasons[CAP_REASON] ?? 0) + 1;
  }
  return payload;
}
