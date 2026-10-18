// Pure repo analysis, shared by /api/ingest (server) and uploads (client). Type-only imports so
// `node scripts/check.mjs` can run it directly.
import type { Module, ModuleStats, Repo, RepoFile } from './types';
import { buildGraph } from './graph.ts';

export const MAX_FILES = 300;
export const MAX_TOTAL = 3 * 1024 * 1024;
export const MAX_FILE = 150 * 1024;

const DEP_DIRS = new Set(['node_modules', 'vendor', 'venv', '.venv']);
const BUILD_DIRS = new Set(['.git', 'dist', 'build', 'out', '.next', 'coverage', '__pycache__']);
const LOCK_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'cargo.lock', 'bun.lockb', 'composer.lock', 'gemfile.lock']);
const BINARY_EXT = new Set(
  ('png jpg jpeg gif webp bmp ico svg tif tiff psd avif heic woff woff2 ttf otf eot mp3 wav ogg flac m4a aac mp4 mov avi mkv webm ' +
    'zip tar gz tgz bz2 xz 7z rar jar war exe dll so dylib bin o a class pyc wasm pdf doc docx xls xlsx ppt pptx db sqlite ds_store').split(' '),
);
const CODE_EXT = new Set(
  ('ts tsx mts cts js jsx mjs cjs py pyi go rs java kt kts scala rb php c h cc cpp hpp cs swift m dart lua ex exs erl clj ' +
    'hs ml r jl sh bash zsh ps1 sql vue svelte astro html css scss sass less graphql proto sol zig nim ipynb').split(' '),
);
const DOC_EXT = new Set(['md', 'mdx', 'txt', 'rst', 'adoc']);
const DOMINANT = ['src', 'app', 'lib', 'packages'];
// Monorepo and Go layouts: each child is its own tenant (packages/react, crates/core, cmd/cobra, internal/render).
const CONTAINERS = ['packages', 'apps', 'crates', 'libs', 'services', 'plugins', 'cmd', 'internal', 'pkg'];
export const MAX_NOTEBOOK = 2 * 1024 * 1024;
const TEST_PATH = /(^|\/)(__tests__|tests?|spec|testdata)\/|[._-](test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/i; // pytest: test_*.py
// Code, but not what a newcomer needs first: examples, fixtures, benchmarks, vendored code and type stubs.
const SIDE_DIRS = /(^|\/)(examples?|samples?|fixtures?|__fixtures__|demos?|benchmarks?|benches|bench|third_party|e2e|flow-typed|typings|__mocks__|docs?_src|docs?_examples)\//i;
// Small files the import graph needs (workspace package names, crate names, Go module paths).
const MANIFEST = /^(package\.json|cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|pyproject\.toml)$/i;
// Inside packages/x/ (or crates/x/, …) depth counts from the package, so its src/ competes with top-level folders.
const IN_CONTAINER = /^(packages|apps|crates|libs|services|plugins|cmd|internal|pkg)\/[^/]+\//;
const depth = (p: string) => p.split('/').length - (IN_CONTAINER.test(p) ? 2 : 0);

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const ext = (p: string) => {
  const b = base(p).toLowerCase();
  return b.includes('.') ? b.slice(b.lastIndexOf('.') + 1) : b;
};
export const isCode = (p: string) => CODE_EXT.has(ext(p)) || /^(dockerfile|makefile)$/i.test(base(p));

export const CAP_REASON = `over the ${MAX_FILES}-file / 3MB cap`;
/** The Landlord's note when the cap cut files (loading screen and tavern). */
export const CAP_NOTE_START = 'This place is huge.';
export const capNote = (n: number) => `${CAP_NOTE_START} I only let ${n.toLocaleString('en')} files in.`;

export type Skipped = { count: number; reasons: Record<string, number> };
export type Entry = { path: string; content: string };

/** Path/size-only check, so callers can skip without reading the file. */
export function skipReason(path: string, size?: number): string | null {
  const parts = path.split('/');
  const dirs = parts.slice(0, -1);
  if (dirs.some((d) => DEP_DIRS.has(d))) return 'dependencies';
  if (dirs.some((d) => BUILD_DIRS.has(d))) return 'build output';
  const b = base(path).toLowerCase();
  if (LOCK_FILES.has(b)) return 'lock files';
  if (BINARY_EXT.has(ext(path))) return 'images and binaries';
  if (/\.min\.(js|css)$/.test(b)) return 'minified files';
  // A notebook's size is mostly its outputs, which convertNotebook drops; the code left is checked again after.
  if (size !== undefined && size > (ext(path) === 'ipynb' ? MAX_NOTEBOOK : MAX_FILE)) return 'files over 150KB';
  return null;
}

/** A Jupyter notebook as plain text: code cells as code, markdown cells as # comments, outputs dropped. Null if unreadable. */
export function convertNotebook(json: string): string | null {
  try {
    const nb = JSON.parse(json) as { cells?: { cell_type?: string; source?: string | string[] }[] };
    if (!Array.isArray(nb.cells)) return null;
    return nb.cells
      .map((c, i) => {
        const src = (Array.isArray(c.source) ? c.source.join('') : (c.source ?? '')).replace(/\s+$/, '');
        if (c.cell_type === 'code') return `# In[${i + 1}]:\n${src}`;
        return src
          .split('\n')
          .map((l) => `# ${l}`.trimEnd())
          .join('\n');
      })
      .filter((t) => t.trim())
      .join('\n\n');
  } catch {
    return null;
  }
}

// Source code, then manifests, then tests, then side code (examples, fixtures, benchmarks), then config, then docs.
export const fileTier = (p: string) =>
  isCode(p) ? (TEST_PATH.test(p) ? 1 : SIDE_DIRS.test(p) ? 2 : 0) : MANIFEST.test(base(p)) ? 0.5 : DOC_EXT.has(ext(p)) ? 4 : 3;
const tier = fileTier;
/** Source > manifests > tests > examples > config > docs, then shallow > deep (inside a monorepo package, from the package). */
export const byPriority = (a: string, b: string) => tier(a) - tier(b) || depth(a) - depth(b) || a.localeCompare(b);
const lineCount = (s: string) => s.split('\n').length;

/** Filters junk, then keeps the best files (code > config > docs, shallow > deep) within the caps. */
export function filterFiles(entries: Entry[], preSkipped: Record<string, number> = {}): { files: RepoFile[]; skipped: Skipped } {
  const reasons = { ...preSkipped };
  const skip = (why: string) => (reasons[why] = (reasons[why] ?? 0) + 1);
  const ok: RepoFile[] = [];
  for (const e of entries) {
    // Raw notebook JSON is converted here; one the big-repo path already converted is plain text by now.
    const content = ext(e.path) === 'ipynb' && e.content.trimStart().startsWith('{') ? convertNotebook(e.content) : e.content;
    if (content === null) {
      skip('unreadable notebooks');
      continue;
    }
    const lines = lineCount(content);
    const why =
      skipReason(e.path, content.length) ??
      (content.includes('\0') ? 'images and binaries' : content.length / lines > 300 ? 'minified files' : null);
    if (why) skip(why);
    else ok.push({ path: e.path, content, lineCount: lines });
  }
  ok.sort((a, b) => byPriority(a.path, b.path));
  // Over the cap, a tenth of the places is kept for tests, so a big repo's modules don't all look untested.
  const reserve = Math.min(Math.floor(MAX_FILES / 10), ok.filter((f) => tier(f.path) === 1).length);
  const files: RepoFile[] = [];
  let total = 0;
  let source = 0;
  for (const f of ok) {
    const isSource = tier(f.path) === 0;
    if (files.length >= MAX_FILES || total + f.content.length > MAX_TOTAL || (isSource && source >= MAX_FILES - reserve)) {
      skip(CAP_REASON);
    } else {
      files.push(f);
      total += f.content.length;
      if (isSource) source++;
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
    hasTests: fs.some((f) => /(^|\/)(__tests__|tests?|spec)\/|[._-](test|spec)\.[a-z]+$|(^|\/)(tests?|spec)\.[a-z]+$/i.test(f.path)),
  };
}

// ponytail: ignores braces inside strings/comments; good enough for a "how nested is this" stat.
export function nesting(f: RepoFile): number {
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

// Code a tenant is made of: not CI scripts and editor config in dot-folders (.github/workflows/lint.sh).
const isTenantCode = (p: string) => isCode(p) && !p.split('/').slice(0, -1).some((d) => d.startsWith('.'));
const codeLines = (fs: RepoFile[]) => fs.reduce((n, f) => n + (isTenantCode(f.path) ? f.lineCount : 0), 0);

function makeModule(id: string, path: string, name: string, fs: RepoFile[], all: RepoFile[], named: string[] = []): Module {
  const filePaths = fs.map((f) => f.path);
  const main = mainFile(fs, named);
  return { id, name, path, filePaths, stats: computeStats({ filePaths }, all), ...(main && { main }) };
}

const ENTRY = /^(index|main|app|lib|mod|server|cli|__main__)\.[a-z0-9]+$/i;
const MARKUP = /\.(html?|css|scss|sass|less)$/i;
/**
 * A module's main file: a source file whenever it has code, never a README next to code. First an index/main/app/
 * lib/mod file, then (for the root) one named after the repo (cobra.go), shallowest first, else the biggest
 * (orders/checkout.ts, which the demo's saved line explanation relies on). Script code before markup and styles;
 * tests and examples only if that's all the code there is. No code: the README, else the biggest file.
 */
export function mainFile(fs: RepoFile[], named: string[] = []): string | undefined {
  const depth = (p: string) => p.split('/').length;
  const shallow = (xs: RepoFile[]) => [...xs].sort((a, b) => depth(a.path) - depth(b.path) || a.path.length - b.path.length);
  const stem = (p: string) => base(p).replace(/\.[^.]+$/, '').toLowerCase();
  const code = fs.filter((f) => isCode(f.path));
  const src = code.filter((f) => !TEST_PATH.test(f.path) && !SIDE_DIRS.test(f.path));
  const tiers = [src.filter((f) => !MARKUP.test(f.path)), src, code];
  const pool = tiers.find((t) => t.length) ?? [];
  const wanted = new Set(named.map((n) => n.toLowerCase().replace(/\.[^.]+$/, '')));
  if (pool.length)
    return (shallow(pool).find((f) => ENTRY.test(base(f.path))) ?? shallow(pool).find((f) => wanted.has(stem(f.path))) ?? [...pool].sort((a, b) => b.lineCount - a.lineCount)[0]).path;
  return (shallow(fs).find((f) => /^readme(\.|$)/i.test(base(f.path))) ?? [...fs].sort((a, b) => b.lineCount - a.lineCount)[0])?.path;
}

/** The repo's short name on GitHub, and what its root manifests call it (package.json, go.mod, Cargo.toml, pyproject). */
function repoNames(repoName: string | undefined, files: RepoFile[]): { short: string; manifest: string[] } {
  const out = new Set<string>();
  const at = (p: string) => files.find((f) => f.path === p)?.content ?? '';
  try {
    const n = JSON.parse(at('package.json') || '{}')?.name;
    if (typeof n === 'string') out.add(n.replace(/^@[^/]+\//, '').toLowerCase());
  } catch {
    // not JSON
  }
  const go = at('go.mod').match(/^module\s+(\S+)/m)?.[1];
  if (go) out.add(go.split('/').pop()!.toLowerCase());
  for (const [file, section] of [['Cargo.toml', 'package'], ['pyproject.toml', 'project']] as const) {
    const n = at(file).match(new RegExp(`^\\[${section}\\][^[]*?^name\\s*=\\s*"([^"]+)"`, 'm'))?.[1];
    if (n) out.add(n.toLowerCase());
  }
  out.delete('');
  return { short: (repoName?.split('/')[1] ?? '').toLowerCase(), manifest: [...out] };
}

/**
 * How much a module matters to a newcomer: each module that imports or calls it (2 points), its size (log scale)
 * and a name matching the repo's: 6 for an exact match (react in facebook/react, or the root when the repo's own
 * manifest names it, like cobra's go.mod), 3 for a prefix (react-dom). Pure.
 */
export function importance(mods: Module[], files: RepoFile[], repoName?: string): Map<string, number> {
  const { short, manifest } = repoNames(repoName, files);
  const names = [short, ...manifest].filter(Boolean);
  const g = buildGraph(files, mods);
  const dependents = new Map<string, Set<string>>();
  for (const e of g.edges) if (e.from !== e.to) dependents.set(e.to, (dependents.get(e.to) ?? new Set()).add(e.from));
  const match = (m: Module) => {
    if (m.id === '(root)') return short && manifest.includes(short) && m.filePaths.some(isTenantCode) ? 6 : 0;
    const n = m.name.replace(/\.[^.]+$/, '').toLowerCase();
    return names.includes(n) ? 6 : names.some((x) => n.startsWith(x + '-') || n.startsWith(x + '_')) ? 3 : 0;
  };
  return new Map(mods.map((m) => [m.id, 2 * (dependents.get(m.id)?.size ?? 0) + 2 * Math.log10(m.stats.totalLines + 10) + match(m)]));
}

const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));

/** Java/Kotlin: the root package under src/main/java (org/springframework/samples/petclinic), if most code lives there. */
function javaRoot(files: RepoFile[], total: number): string | null {
  for (const r of ['src/main/java', 'src/main/kotlin']) {
    const src = files.filter((f) => f.path.startsWith(r + '/') && /\.(java|kt)$/.test(f.path));
    if (!src.length || codeLines(src) < total * 0.3) continue;
    let common = dirOf(src[0].path).split('/');
    for (const f of src) {
      const p = dirOf(f.path).split('/');
      let i = 0;
      while (i < common.length && common[i] === p[i]) i++;
      common = common.slice(0, i);
    }
    return common.join('/');
  }
  return null;
}

/**
 * Modules: top-level folders, or the children of a dominant src/app/lib/packages folder, of monorepo and Go
 * containers (packages/*, apps/*, crates/*, cmd/*, internal/*, pkg/*), or of a Java root package. Root files are
 * one module; a repo that is all root files gets one module per big file. Max 8 incl. "misc", chosen by importance
 * (who depends on it, its size, a name matching the repo's) and returned most important first.
 */
// Name words that say nothing about what a file does: tests, platforms, versions (bash_completionsV2, command_win).
const NOISE = new Set(['test', 'tests', 'spec', 'specs', 'win', 'windows', 'notwin', 'unix', 'linux', 'darwin', 'posix']);
/** The words in a file's name: bash_completionsV2.go → bash, completions; index.d.ts → index. */
export function stemTokens(p: string): string[] {
  return base(p)
    .replace(/\.[^.]+$/, '')
    .replace(/\.d$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^v?\d+$/.test(t) && !NOISE.has(t));
}

type RootUnit = { name: string; files: RepoFile[] };
/**
 * The root's code files as would-be tenants: files sharing a name word are one, named after it (bash_completions.go,
 * zsh_completions.go and completions.go are "completions"; args.go and args_test.go are "args"), each file joining
 * the word most files share (on a tie the later one, the head noun); everything else one file each. The file named
 * after the repo (cobra.go) stays with the root, and so does a group without a source file. Deterministic.
 */
export function rootUnits(fs: RepoFile[], repoShort: string): RootUnit[] {
  const repo = repoShort.toLowerCase();
  const own = fs.filter((f) => !repo || stemTokens(f.path).join('') !== repo);
  const words = new Map(own.map((f) => [f, stemTokens(f.path).filter((t) => t !== repo)]));
  const count = new Map<string, number>();
  for (const ts of words.values()) for (const t of new Set(ts)) count.set(t, (count.get(t) ?? 0) + 1);
  const byWord = new Map<string, RepoFile[]>();
  const units: RootUnit[] = [];
  for (const f of own) {
    const word = words.get(f)!.filter((t) => count.get(t)! >= 2).reduce<string | null>((a, t) => (!a || count.get(t)! >= count.get(a)! ? t : a), null);
    if (word) byWord.set(word, [...(byWord.get(word) ?? []), f]);
    else units.push({ name: base(f.path), files: [f] });
  }
  // Named after the stem they all share when they do (flag_groups.go + flag_groups_test.go → flag_groups), else the word.
  const core = (f: RepoFile) => stemTokens(f.path).join('_');
  for (const [word, group] of byWord)
    if (group.length >= 2 && group.some((f) => !TEST_PATH.test(f.path))) units.push({ name: new Set(group.map(core)).size === 1 ? core(group[0]) : word, files: group });
    else units.push(...group.map((f) => ({ name: base(f.path), files: [f] })));
  return units;
}

export function detectModules(files: RepoFile[], repoName?: string): Module[] {
  const total = codeLines(files);
  const share = (prefix: string) => codeLines(files.filter((f) => f.path.startsWith(prefix + '/')));
  const dominant = DOMINANT.find((d) => total > 0 && share(d) > total / 2);
  const java = javaRoot(files, total);
  const containers = new Set(CONTAINERS.filter((c) => total > 0 && share(c) > total * 0.15));
  const groupOf = (p: string) => {
    const parts = p.split('/');
    if (java) {
      if (p.startsWith(java + '/')) {
        const rest = p.slice(java.length + 1).split('/');
        return rest.length > 1 ? `${java}/${rest[0]}` : java;
      }
      if (/^src\/test\//.test(p)) return 'src/test';
      if (/^src\/main\//.test(p)) return parts.slice(0, 3).join('/'); // src/main/resources, src/main/webapp
    }
    if (containers.has(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
    if (dominant && parts[0] === dominant) return parts.length > 2 ? `${dominant}/${parts[1]}` : dominant;
    return parts.length > 1 ? parts[0] : '';
  };
  const groups = new Map<string, RepoFile[]>();
  for (const f of files) groups.set(groupOf(f.path), [...(groups.get(groupOf(f.path)) ?? []), f]);

  // The root is the main package (all the code, or most of it: a Go library like cobra): its biggest files become
  // tenants of their own; the rest of the root stays one module.
  const root = groups.get('') ?? [];
  const rootCode = root.filter((f) => isTenantCode(f.path));
  const allAtRoot = rootCode.length >= 3 && [...groups].every(([k, fs]) => k === '' || !fs.some((f) => isTenantCode(f.path)));
  let units: RootUnit[] = [];
  if (allAtRoot || (rootCode.length >= 5 && codeLines(root) >= total * 0.6)) {
    // Files sharing a name word are one tenant (completions); source before tests (a lone context_test.go stays
    // with the root), then the biggest.
    const lines = (u: RootUnit) => u.files.reduce((n, f) => n + f.lineCount, 0);
    const onlyTests = (u: RootUnit) => u.files.every((f) => TEST_PATH.test(f.path));
    units = rootUnits(rootCode, repoName?.split('/')[1] ?? '')
      .sort((a, b) => +onlyTests(a) - +onlyTests(b) || lines(b) - lines(a) || a.name.localeCompare(b.name))
      .slice(0, allAtRoot ? 6 : 5);
    const taken = new Set(units.flatMap((u) => u.files));
    groups.set('', root.filter((f) => !taken.has(f)));
    if (!groups.get('')!.length) groups.delete('');
  }

  const mods = [
    // one file: its path is the id; a group: "(root):completions", never a folder's path
    ...units.map((u) => (u.files.length === 1 ? makeModule(u.files[0].path, u.files[0].path, base(u.files[0].path), u.files, files) : makeModule(`(root):${u.name}`, `(root):${u.name}`, u.name, u.files, files))),
    // the root's main file may be named after the repo (cobra.go, gin.go)
    ...[...groups].map(([path, fs]) => makeModule(path || '(root)', path, path ? base(path) : files.length === 1 ? base(files[0].path) : 'root', fs, files, path ? [] : [repoName?.split('/')[1] ?? ''])),
  ];
  const bySize = (a: Module, b: Module) => b.stats.totalLines - a.stats.totalLines;
  let code = mods.filter((m) => m.filePaths.some(isCode)).sort(bySize);
  let nonCode = mods.filter((m) => !m.filePaths.some(isCode));
  // A docs-only repo (a CI script in .github doesn't count): every folder is a tenant.
  if (!mods.some((m) => m.filePaths.some(isTenantCode))) [code, nonCode] = [mods.sort(bySize), []];
  // Cast by importance, not size alone: who depends on it, how big it is, whether it carries the repo's name.
  else if (code.length > 1) {
    const score = importance(code, files, repoName);
    code.sort((a, b) => score.get(b.id)! - score.get(a.id)! || bySize(a, b));
  }
  if (!nonCode.length && code.length <= 8) return code;
  const rest = [...code.slice(7), ...nonCode];
  const miscFiles = files.filter((f) => rest.some((m) => m.filePaths.includes(f.path)));
  return [...code.slice(0, 7), makeModule('(misc)', '(misc)', 'misc', miscFiles, files)];
}

export function buildRepo(name: string, files: RepoFile[], url?: string): Repo {
  return { name, url, files, modules: detectModules(files, name) };
}

/** The module's main file (mainFile: source code over docs). Modules saved before `main` existed get the same rule from paths alone. */
export function entryFile(m: Module): string | undefined {
  if (m.main) return m.main;
  const byDepth = [...m.filePaths].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  const src = byDepth.filter((p) => isCode(p) && !TEST_PATH.test(p));
  return (
    src.find((p) => ENTRY.test(base(p))) ??
    (src.includes(m.stats.biggestFile.path) ? m.stats.biggestFile.path : src[0]) ??
    byDepth.find((p) => /^readme(\.|$)/i.test(base(p))) ??
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
