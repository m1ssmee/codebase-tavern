// Pure repo analysis, shared by /api/ingest (server) and uploads (client). Type-only imports so
// `node scripts/check.mjs` can run it directly.
import type { Module, ModuleStats, Repo, RepoFile } from './types';

export const MAX_FILES = 300;
export const MAX_TOTAL = 3 * 1024 * 1024;
export const MAX_FILE = 150 * 1024;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', 'vendor', '__pycache__', 'venv', '.venv']);
const LOCK_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'cargo.lock', 'bun.lockb', 'composer.lock', 'gemfile.lock']);
const BINARY_EXT = new Set(
  ('png jpg jpeg gif webp bmp ico svg tif tiff psd avif heic woff woff2 ttf otf eot mp3 wav ogg flac m4a aac mp4 mov avi mkv webm ' +
    'zip tar gz tgz bz2 xz 7z rar jar war exe dll so dylib bin o a class pyc wasm pdf doc docx xls xlsx ppt pptx db sqlite ds_store').split(' '),
);
const CODE_EXT = new Set(
  ('ts tsx mts cts js jsx mjs cjs py pyi go rs java kt kts scala rb php c h cc cpp hpp cs swift m dart lua ex exs erl clj ' +
    'hs ml r jl sh bash zsh ps1 sql vue svelte astro html css scss sass less graphql proto sol zig nim').split(' '),
);
const DOC_EXT = new Set(['md', 'mdx', 'txt', 'rst', 'adoc']);
const DOMINANT = ['src', 'app', 'lib', 'packages'];

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const ext = (p: string) => {
  const b = base(p).toLowerCase();
  return b.includes('.') ? b.slice(b.lastIndexOf('.') + 1) : b;
};
export const isCode = (p: string) => CODE_EXT.has(ext(p)) || /^(dockerfile|makefile)$/i.test(base(p));

export type Skipped = { count: number; reasons: Record<string, number> };
export type Entry = { path: string; content: string };

/** Path/size-only check, so callers can skip without reading the file. */
export function skipReason(path: string, size?: number): string | null {
  const parts = path.split('/');
  if (parts.slice(0, -1).some((d) => SKIP_DIRS.has(d))) return 'junk folders';
  const b = base(path).toLowerCase();
  if (LOCK_FILES.has(b)) return 'lock files';
  if (BINARY_EXT.has(ext(path))) return 'binary/media';
  if (/\.min\.(js|css)$/.test(b)) return 'minified';
  if (size !== undefined && size > MAX_FILE) return 'too big';
  return null;
}

const tier = (p: string) => (isCode(p) ? 0 : DOC_EXT.has(ext(p)) ? 2 : 1);
/** Code > config > docs, then shallow > deep. */
export const byPriority = (a: string, b: string) =>
  tier(a) - tier(b) || a.split('/').length - b.split('/').length || a.localeCompare(b);
const lineCount = (s: string) => s.split('\n').length;

/** Filters junk, then keeps the best files (code > config > docs, shallow > deep) within the caps. */
export function filterFiles(entries: Entry[], preSkipped: Record<string, number> = {}): { files: RepoFile[]; skipped: Skipped } {
  const reasons = { ...preSkipped };
  const skip = (why: string) => (reasons[why] = (reasons[why] ?? 0) + 1);
  const ok: RepoFile[] = [];
  for (const e of entries) {
    const lines = lineCount(e.content);
    const why =
      skipReason(e.path, e.content.length) ??
      (e.content.includes('\0') ? 'binary/media' : e.content.length / lines > 300 ? 'minified' : null);
    if (why) skip(why);
    else ok.push({ path: e.path, content: e.content, lineCount: lines });
  }
  ok.sort((a, b) => byPriority(a.path, b.path));
  const files: RepoFile[] = [];
  let total = 0;
  for (const f of ok) {
    if (files.length >= MAX_FILES || total + f.content.length > MAX_TOTAL) {
      skip('over the cap');
    } else {
      files.push(f);
      total += f.content.length;
    }
  }
  return { files, skipped: { count: Object.values(reasons).reduce((a, b) => a + b, 0), reasons } };
}

export function computeStats(module: Pick<Module, 'filePaths'>, files: RepoFile[]): ModuleStats {
  const own = new Set(module.filePaths);
  const fs = files.filter((f) => own.has(f.path));
  let todoCount = 0;
  let maxNesting = 0;
  let biggestFile = { path: '', lines: 0 };
  for (const f of fs) {
    todoCount += (f.content.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length;
    if (f.lineCount > biggestFile.lines) biggestFile = { path: f.path, lines: f.lineCount };
    maxNesting = Math.max(maxNesting, nesting(f));
  }
  return {
    fileCount: fs.length,
    totalLines: fs.reduce((n, f) => n + f.lineCount, 0),
    biggestFile,
    todoCount,
    maxNesting,
    hasTests: fs.some((f) => /(^|\/)(__tests__|tests?|spec)\/|[._-](test|spec)\.[a-z]+$/i.test(f.path)),
  };
}

// ponytail: ignores braces inside strings/comments; good enough for a "how nested is this" stat.
function nesting(f: RepoFile): number {
  if (/^(py|pyi|ya?ml)$/.test(ext(f.path))) {
    const indents = f.content
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.match(/^[ \t]*/)![0].replace(/\t/g, '    ').length);
    const unit = Math.min(...indents.filter((n) => n > 0), Infinity);
    return unit === Infinity ? 0 : Math.floor(Math.max(...indents) / unit);
  }
  if (!isCode(f.path)) return 0;
  let depth = 0;
  let max = 0;
  for (const ch of f.content) {
    if (ch === '{') max = Math.max(max, ++depth);
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return max;
}

const codeLines = (fs: RepoFile[]) => fs.reduce((n, f) => n + (isCode(f.path) ? f.lineCount : 0), 0);

function makeModule(id: string, path: string, name: string, fs: RepoFile[], all: RepoFile[]): Module {
  const filePaths = fs.map((f) => f.path);
  return { id, name, path, filePaths, stats: computeStats({ filePaths }, all) };
}

/** Top-level folders (or children of a dominant src/app/lib/packages), root files, max 8 incl. "misc". */
export function detectModules(files: RepoFile[]): Module[] {
  const total = codeLines(files);
  const dominant = DOMINANT.find((d) => total > 0 && codeLines(files.filter((f) => f.path.startsWith(d + '/'))) > total / 2);
  const groupOf = (p: string) => {
    const parts = p.split('/');
    if (dominant && parts[0] === dominant) return parts.length > 2 ? `${dominant}/${parts[1]}` : dominant;
    return parts.length > 1 ? parts[0] : '';
  };
  const groups = new Map<string, RepoFile[]>();
  for (const f of files) groups.set(groupOf(f.path), [...(groups.get(groupOf(f.path)) ?? []), f]);

  const mods = [...groups].map(([path, fs]) =>
    makeModule(path || '(root)', path, path ? base(path) : files.length === 1 ? base(files[0].path) : 'root', fs, files),
  );
  const code = mods.filter((m) => m.filePaths.some(isCode)).sort((a, b) => b.stats.totalLines - a.stats.totalLines);
  const nonCode = mods.filter((m) => !m.filePaths.some(isCode));
  if (!nonCode.length && code.length <= 8) return code;
  const rest = [...code.slice(7), ...nonCode];
  const miscFiles = files.filter((f) => rest.some((m) => m.filePaths.includes(f.path)));
  return [...code.slice(0, 7), makeModule('(misc)', '(misc)', 'misc', miscFiles, files)];
}

export function buildRepo(name: string, files: RepoFile[], url?: string): Repo {
  return { name, url, files, modules: detectModules(files) };
}

/** README in the module, else index/main/app, else the biggest file. Shortest path wins ties. */
export function entryFile(m: Module): string | undefined {
  const byDepth = [...m.filePaths].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  return (
    byDepth.find((p) => /^readme(\.|$)/i.test(base(p))) ??
    byDepth.find((p) => /^(index|main|app)\.[a-z]+$/i.test(base(p))) ??
    (m.stats.biggestFile.path || byDepth[0])
  );
}

/** github.com/owner/repo[.git][/tree/branch[/subpath]] or plain owner/repo. */
export function parseGitHubUrl(input: string) {
  const s = input.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/[?#].*$/, '');
  // ponytail: branch = first segment after /tree/, so branches with "/" in the name aren't supported
  const m = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/);
  if (!m) return null;
  const [, owner, repo, ref, subpath] = m;
  // These go into api.github.com paths with our token attached: no "." / ".." traversal.
  if ([owner, repo, ref].some((s) => s === '.' || s === '..')) return null;
  const slug = `${owner}/${repo}${ref ? `/tree/${ref}${subpath ? `/${subpath}` : ''}` : ''}`;
  return { owner, repo, ref, subpath, slug, url: `https://github.com/${slug}` };
}
