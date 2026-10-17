import 'server-only';
import JSZip from 'jszip';
import { byPriority, capNote, CAP_REASON, convertNotebook, fileTier, filterFiles, MAX_FILE, MAX_FILES, MAX_NOTEBOOK, MAX_TOTAL, parseGitHubUrl, skipReason, type Entry, type Skipped } from './analyze';
import type { RepoFile } from './types';

// Fetches a public GitHub repo and keeps the best files within the caps. Shared by /api/ingest (the browser's copy)
// and /api/roast (the server's own copy, so a signed card's numbers come from the real repo).
// One cheap call first gets the commit SHA; owner/repo@sha is the cache key. Normal repos come as one zipball; big
// ones (or a zip over the cap) as the file list plus only the files we keep, straight from raw.githubusercontent.com.

const MAX_ZIP = 60 * 1024 * 1024;
const BIG_REPO_KB = 25_000; // GitHub's size field: above this, skip the zipball
const NOTEBOOK_BUDGET = 24 * 1024 * 1024; // raw notebook bytes downloaded per repo (big repo path)
export const MAX_RESPONSE = 4 * 1024 * 1024;

// In character: the Landlord at the door. Every failure gets one of these, never a blank screen.
export const MSG = {
  invalid: "That's not a GitHub link. I need github.com/owner/repo, or owner/repo.",
  notFound: 'No building at that address. The repo is private or does not exist.',
  emptyRepo: 'The building is empty. That repo has no commits yet.',
  tooBig: 'This place is too big to even open the door. Try a subfolder link (github.com/owner/repo/tree/branch/folder).',
  slow: 'GitHub took too long to hand over the keys. Try again, or a subfolder link.',
  rateLimit: "GitHub has stopped answering the door for a few minutes (rate limit). Try again shortly.",
  empty: 'Nothing in there I can read: only binaries, or files too big to open.',
  generic: 'The door jammed while fetching that repo. Try again.',
};


export class Oops extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const gh = (url: string, signal?: AbortSignal, accept = 'application/vnd.github+json') =>
  fetch(url, {
    signal,
    headers: {
      'User-Agent': 'codebase-tavern',
      Accept: accept,
      ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
    },
  });

function check(res: Response, what: string): Response {
  if (res.ok) return res;
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    console.error(`[fetchRepo] GitHub rate limit hit on ${what}. Set GITHUB_TOKEN (60 → 5000 req/h).`);
    throw new Oops(429, MSG.rateLimit);
  }
  if (res.status === 409) throw new Oops(422, MSG.emptyRepo); // "Git Repository is empty."
  if (res.status === 404 || res.status === 403 || res.status === 422) throw new Oops(404, MSG.notFound);
  if (res.status === 401) console.error('[fetchRepo] GitHub rejected GITHUB_TOKEN (401). Check or remove it.');
  throw new Error(`GitHub ${res.status} on ${what}`);
}

async function readCapped(res: Response, max: number, say: Say): Promise<Uint8Array> {
  if (Number(res.headers.get('content-length')) > max) throw new Oops(413, MSG.tooBig);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let told = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > max) throw new Oops(413, MSG.tooBig); // breaking the loop cancels the download
    chunks.push(chunk);
    if (total - told > 4 * 1024 * 1024) say(`Downloading… ${Math.round((told = total) / 1024 / 1024)} MB so far`);
  }
  return Buffer.concat(chunks);
}

export type FetchedRepo = { name: string; url: string; branch: string; sha: string; key: string; files: RepoFile[]; skipped: Skipped };
type Say = (step: string) => void;

// ponytail: in memory, per server instance, lost on a cold start. Bounded by total size, least recently used out first.
const CACHE_BYTES = 96 * 1024 * 1024;
const cache = new Map<string, { repo: FetchedRepo; bytes: number }>();
function remember(repo: FetchedRepo) {
  const bytes = repo.files.reduce((n, f) => n + f.content.length, 0);
  cache.delete(repo.key);
  cache.set(repo.key, { repo, bytes });
  let total = [...cache.values()].reduce((n, e) => n + e.bytes, 0);
  for (const [k, e] of cache) {
    if (total <= CACHE_BYTES) break;
    cache.delete(k);
    total -= e.bytes;
  }
}
function recall(key: string): FetchedRepo | undefined {
  const e = cache.get(key);
  if (!e) return;
  cache.delete(key);
  cache.set(key, e); // most recently used
  return e.repo;
}

const plural = (n: number, w: string) => `${n.toLocaleString('en')} ${w}${n === 1 ? '' : 's'}`;
// What the Landlord reads out about what stayed outside: "Skipping node_modules", "Skipping 12 images and binaries".
function skipSteps(reasons: Record<string, number>, say: Say) {
  for (const [why, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3))
    say(
      why === 'dependencies' ? 'Skipping node_modules'
      : why === 'build output' ? 'Skipping build output'
      : why === CAP_REASON ? `Leaving ${plural(n, 'file')} outside (over the cap)`
      : `Skipping ${n.toLocaleString('en')} ${n === 1 ? why.replace('images and binaries', 'image or binary').replace(/files\b/, 'file').replace('notebooks', 'notebook') : why}`,
    );
}

/** A public repo by GitHub link or owner/repo, trimmed exactly as the browser receives it. Throws Oops for users. */
export const fetchRepo = async (input: string, signal: AbortSignal, say?: Say) => (await getRepo(input, signal, say)) as FetchedRepo;

/**
 * fetchRepo, plus progress and a revalidation shortcut.
 * `say` hears each real step (for the loading screen). `known`: a key the caller already holds; if the repo still
 * has that SHA, returns { same: true } without downloading anything.
 */
export async function getRepo(input: string, signal: AbortSignal, say: Say = () => {}, known?: string): Promise<FetchedRepo | { same: true; key: string }> {
  const parsed = parseGitHubUrl(input);
  if (!parsed) throw new Oops(400, MSG.invalid);
  const { owner, repo, subpath } = parsed;
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  say(`Knocking on ${owner}/${repo}`);
  const sha = (await check(await gh(`${api}/commits/${encodeURIComponent(parsed.ref ?? 'HEAD')}`, signal, 'application/vnd.github.sha'), 'commit').text()).trim();
  const key = `${owner}/${repo}${subpath ? '/' + subpath : ''}@${sha}`;
  if (known === key) return { same: true, key };
  const hit = recall(key);
  if (hit) {
    say('Already have the keys to this one');
    return hit;
  }

  const info = await check(await gh(api, signal), 'repo info').json();
  // GITHUB_TOKEN may be able to read private repos; never hand those to anonymous visitors.
  if (info.private !== false || info.visibility !== 'public') throw new Oops(404, MSG.notFound);
  const branch: string = parsed.ref ?? info.default_branch;
  const prefix = subpath ? subpath + '/' : '';
  const pre: Record<string, number> = {};
  const tally = (why: string) => (pre[why] = (pre[why] ?? 0) + 1);

  let entries: Entry[];
  const big = Number(info.size) > BIG_REPO_KB;
  try {
    if (big) throw new Oops(413, MSG.tooBig);
    entries = await fromZip(api, sha, prefix, tally, signal, say);
  } catch (err) {
    if (!(err instanceof Oops && err.status === 413)) throw err;
    for (const k of Object.keys(pre)) delete pre[k];
    entries = await fromTree(owner, repo, api, sha, prefix, tally, signal, say);
  }

  skipSteps(pre, say);
  const { files, skipped } = filterFiles(entries, pre);
  if (!files.length) throw new Oops(422, subpath && !entries.length && !skipped.count ? MSG.notFound : MSG.empty);

  const payload: FetchedRepo = { name: `${owner}/${repo}${subpath ? '/' + subpath : ''}`, url: parsed.url, branch, sha, key, files, skipped };
  // Files are priority-sorted, so drop from the end until we fit Vercel's response limit.
  while (Buffer.byteLength(JSON.stringify(payload)) > MAX_RESPONSE && files.length) {
    files.pop();
    skipped.count++;
    skipped.reasons[CAP_REASON] = (skipped.reasons[CAP_REASON] ?? 0) + 1;
  }
  say(`Letting in ${plural(files.length, 'file')}`);
  if (skipped.reasons[CAP_REASON]) say(capNote(files.length));
  remember(payload);
  return payload;
}

/** The zipball: decompress best-first and stop at ~2x the caps, so a zip bomb of tiny files can't blow up memory. */
async function fromZip(api: string, sha: string, prefix: string, tally: (w: string) => void, signal: AbortSignal, say: Say): Promise<Entry[]> {
  say('Downloading the building');
  const zip = await JSZip.loadAsync(await readCapped(check(await gh(`${api}/zipball/${sha}`, signal), 'zipball'), MAX_ZIP, say));
  const candidates: { rel: string; f: JSZip.JSZipObject }[] = [];
  let seen = 0;
  for (const f of Object.values(zip.files)) {
    if (f.dir) continue;
    const path = f.name.slice(f.name.indexOf('/') + 1); // strip "owner-repo-sha/"
    if (!path.startsWith(prefix)) continue;
    seen++;
    const rel = path.slice(prefix.length);
    // ponytail: _data is jszip-internal; lets us skip huge files without decoding them
    const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    const why = skipReason(rel, size);
    if (why) tally(why);
    else candidates.push({ rel, f });
  }
  say(`Found ${plural(seen, 'file')} inside`);
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
  return entries;
}

/** Big repos: the file list (one call), then only the best files, from raw.githubusercontent.com in parallel. */
async function fromTree(owner: string, repo: string, api: string, sha: string, prefix: string, tally: (w: string) => void, signal: AbortSignal, say: Say): Promise<Entry[]> {
  say('This one is big. Reading the floor plan instead');
  const tree = await check(await gh(`${api}/git/trees/${sha}?recursive=1`, signal), 'tree').json();
  const blobs = (tree.tree as { path: string; type: string; size?: number }[]).filter((t) => t.type === 'blob' && t.path.startsWith(prefix));
  say(`Found ${plural(blobs.length, 'file')}${tree.truncated ? ' (the list was cut short)' : ''}`);
  const keep: { path: string; rel: string; size: number }[] = [];
  for (const b of blobs) {
    const rel = b.path.slice(prefix.length);
    const why = skipReason(rel, b.size);
    if (why) tally(why);
    else keep.push({ path: b.path, rel, size: b.size ?? 0 });
  }
  keep.sort((a, b) => byPriority(a.rel, b.rel));
  // A small margin over the caps for files filterFiles still rejects (minified, binary), and the same tenth kept for
  // tests as filterFiles keeps. A notebook counts by its code, not its outputs (those are dropped).
  const limit = Math.round(MAX_FILES * 1.15);
  const reserve = Math.min(Math.round(limit / 10), keep.filter((k) => fileTier(k.rel) === 1).length);
  const pick: typeof keep = [];
  let bytes = 0;
  let notebookBytes = 0; // raw notebook downloads have their own budget: they shrink a lot once converted
  let source = 0;
  for (const k of keep) {
    const nb = /\.ipynb$/i.test(k.rel);
    const raw = Math.min(k.size, nb ? MAX_NOTEBOOK : MAX_FILE);
    const size = nb ? Math.min(raw, 40_000) : raw; // what it will weigh once kept
    const isSource = fileTier(k.rel) === 0;
    if (pick.length >= limit || bytes + size > MAX_TOTAL * 1.15 || (nb && notebookBytes + raw > NOTEBOOK_BUDGET) || (isSource && source >= limit - reserve)) tally(CAP_REASON);
    else {
      pick.push(k);
      bytes += size;
      if (nb) notebookBytes += raw;
      if (isSource) source++;
    }
  }
  say(`Downloading ${plural(pick.length, 'file')}`);
  const out: Entry[] = new Array(pick.length);
  let next = 0;
  const dec = new TextDecoder();
  const worker = async () => {
    for (let i = next++; i < pick.length; i = next++) {
      const nb = /\.ipynb$/i.test(pick[i].rel);
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${pick[i].path.split('/').map(encodeURIComponent).join('/')}`, { signal });
      if (!res.ok) {
        tally('unreadable files');
        continue;
      }
      // Never more than the per-file cap in memory, whatever the file list claimed; a notebook is converted at once.
      const text = await readCapped(res, nb ? MAX_NOTEBOOK : MAX_FILE, () => {}).then((b) => dec.decode(b), () => null);
      const content = text !== null && nb ? convertNotebook(text) : text;
      if (content === null) tally(nb ? 'unreadable notebooks' : 'files over 150KB');
      else out[i] = { path: pick[i].rel, content };
    }
  };
  await Promise.all(Array.from({ length: 48 }, worker));
  return out.filter(Boolean);
}
