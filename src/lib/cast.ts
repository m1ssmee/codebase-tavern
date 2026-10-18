// Pure cast assignment for the 3D characters (module -> archetype + variant). Type-only imports so
// `node scripts/check.mjs` can run it directly.
import type { Module } from './types';

/**
 * The ten module archetypes, then the Landlord (the narrator, present for every repo) and the Judge (Tribunal
 * only). Neither of the last two is ever assigned to a module: they have no keywords and no fallback picks them.
 */
export const ARCHETYPES = ['bouncer', 'accountant', 'clerk', 'doorman', 'hoarder', 'inspector', 'junkDrawer', 'plumber', 'star', 'librarian', 'landlord', 'judge'] as const;
export type Archetype = (typeof ARCHETYPES)[number];
export type Variant = 0 | 1;

export const CAST: Record<Archetype, { name: string; joke: string; keywords: string[] }> = {
  bouncer: { name: 'The Bouncer', joke: 'Guards everything, held up by almost nothing.', keywords: ['auth', 'middleware', 'security', 'guard', 'permissions'] },
  accountant: { name: 'The Accountant', joke: "Counts everything twice and still isn't sure.", keywords: ['payments', 'billing', 'checkout', 'invoices', 'wallet', 'money'] },
  clerk: { name: 'The Clerk', joke: 'Processes requests all day; one hand is now a rubber stamp.', keywords: ['orders', 'api', 'routes', 'handlers', 'controllers', 'endpoints'] },
  doorman: { name: 'The Doorman', joke: 'Extremely important about timing, extremely small.', keywords: ['gateway', 'server', 'app', 'main', 'index', 'proxy'] },
  hoarder: { name: 'The Hoarder', joke: 'Kept everything, just in case.', keywords: [] },
  inspector: { name: 'The Inspector', joke: 'Gets far too close to everything.', keywords: ['test', 'tests', 'spec', '__tests__', 'e2e'] },
  junkDrawer: { name: 'The Junk Drawer', joke: 'Everything nobody knew where to put ends up here.', keywords: ['utils', 'helpers', 'lib', 'common', 'shared', 'misc'] },
  plumber: { name: 'The Plumber', joke: "Everything flows through it, and it's held together with tape.", keywords: ['db', 'database', 'models', 'data', 'repository', 'migrations', 'store', 'schema'] },
  star: { name: 'The Star', joke: 'Flawless from the front, held together with clamps from behind.', keywords: ['ui', 'components', 'views', 'pages', 'styles', 'frontend', 'client'] },
  librarian: { name: 'The Librarian', joke: 'Knows everything; nobody has asked it anything in years.', keywords: ['docs', 'readme', 'config', 'settings', '.github'] },
  landlord: { name: 'The Landlord', joke: 'Owns the building, fixes nothing, and is tired of every tenant.', keywords: [] },
  judge: { name: 'The Judge', joke: 'Its head is a gavel: the final word, applied with blunt force.', keywords: [] },
};

// ponytail: plural folding is "drop a trailing s", enough for this keyword list (tests, utils, orders...).
const fold = (t: string) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
/** "userModels.test.ts" -> ["user", "models", "test", "ts"] */
export const tokens = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const BY_KEYWORD = new Map(ARCHETYPES.flatMap((a) => CAST[a].keywords.flatMap((k) => tokens(k).map((t) => [fold(t), a] as const))));

/** Every archetype a name matches, best first: the head noun ("api" in "auth-api") before earlier words. */
export function keywordArchetypes(name: string): Archetype[] {
  const hits = tokens(name).map((t) => BY_KEYWORD.get(fold(t))).filter((a): a is Archetype => !!a);
  return [...new Set(hits.reverse())];
}
export const keywordArchetype = (name: string): Archetype | null => keywordArchetypes(name)[0] ?? null;

const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
/** Files directly inside the module folder, minus docs and tests: a README or a spec doesn't make a module its character. */
export const mainFiles = (m: Pick<Module, 'path' | 'filePaths'>) =>
  m.filePaths.filter(
    (p) => dir(p) === (m.path === '(root)' ? '' : m.path) && !/\.(md|mdx|txt|rst|adoc)$/i.test(p) && !/[._-](test|spec)\.[a-z]+$/i.test(p),
  );

const CONFIG_JSON = /^(\.|package|tsconfig|jsconfig|composer|vercel|netlify|turbo|lerna|nx|renovate|app\.json$)|(config|settings|rc)\.json$/i;
// Dotfiles (.gitignore, .editorconfig, .npmrc, .eslintrc) are config too.
const isDocOrConfig = (p: string) =>
  /(^|\/)\.github\//.test(p) || /^\.[^/]+$/.test(base(p)) || /\.(md|mdx|txt|rst|adoc|ya?ml)$/i.test(p) || /^licen[cs]e(\.[a-z]+)?$/i.test(base(p)) || (/\.json$/i.test(p) && CONFIG_JSON.test(base(p)));
/** At least 60% of its files are docs or config: the Librarian's territory (a root that is mostly README and config, too). */
export const isDocsModule = (m: Pick<Module, 'filePaths'>) => m.filePaths.length > 0 && m.filePaths.filter(isDocOrConfig).length / m.filePaths.length >= 0.6;

/**
 * Every archetype a module could be, best first: docs/config, then its folder name, then its main file names. The root
 * is the Librarian only when it is mostly docs or config; otherwise its files decide, like any module ("root" says nothing).
 */
export function candidates(m: Module): Archetype[] {
  const fileHits = mainFiles(m).flatMap((p) => keywordArchetypes(base(p).replace(/\.[^.]+$/, '')));
  return [...new Set<Archetype>([...(isDocsModule(m) ? ['librarian' as const] : []), ...(m.id === '(root)' ? [] : keywordArchetypes(m.name)), ...fileHits])];
}

/**
 * Each module takes its best archetype nobody has yet; if all its matches are taken, it reuses its
 * best one as the alternate variant. No match at all: the largest unmatched module is the Hoarder,
 * else 5+ TODOs and no tests is the Junk Drawer, else the Clerk. Modules are taken in the given order
 * (largest first from detectModules), so bigger modules get first pick.
 */
export function assignCast(modules: Module[]): { archetype: Archetype; variant: Variant }[] {
  const options = modules.map(candidates);
  const unmatched = modules.filter((_, i) => !options[i].length);
  const hoard = unmatched.reduce<Module | null>((a, m) => (!a || m.stats.totalLines > a.stats.totalLines ? m : a), null);
  const seen: Partial<Record<Archetype, number>> = {};
  return modules.map((m, i) => {
    const fallback: Archetype = m === hoard ? 'hoarder' : m.stats.todoCount >= 5 && !m.stats.hasTests ? 'junkDrawer' : 'clerk';
    const list = options[i].length ? options[i] : [fallback];
    const archetype = list.find((a) => !seen[a]) ?? list[0];
    const n = (seen[archetype] = (seen[archetype] ?? 0) + 1);
    return { archetype, variant: ((n - 1) % 2) as Variant };
  });
}
