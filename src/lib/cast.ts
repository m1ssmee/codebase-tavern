// Pure cast assignment for the 3D characters (module -> archetype + variant). Type-only imports so
// `node scripts/check.mjs` can run it directly.
import type { Module } from './types';

export const ARCHETYPES = ['bouncer', 'accountant', 'clerk', 'doorman', 'hoarder', 'inspector', 'junkDrawer', 'plumber', 'star', 'librarian'] as const;
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
  librarian: { name: 'The Librarian', joke: 'Knows everything; nobody has asked it anything in years.', keywords: ['docs', 'readme', 'root', 'config', 'settings', '.github'] },
};

// ponytail: plural folding is "drop a trailing s", enough for this keyword list (tests, utils, orders...).
const fold = (t: string) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
/** "userModels.test.ts" -> ["user", "models", "test", "ts"] */
export const tokens = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const BY_KEYWORD = new Map(ARCHETYPES.flatMap((a) => CAST[a].keywords.flatMap((k) => tokens(k).map((t) => [fold(t), a] as const))));

/** Last matching token wins: the head noun of "auth-api" is api, of "test-utils" is utils. */
export function keywordArchetype(name: string): Archetype | null {
  const hits = tokens(name).map((t) => BY_KEYWORD.get(fold(t))).filter((a): a is Archetype => !!a);
  return hits.at(-1) ?? null;
}

const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
/** Files directly inside the module folder, minus docs and tests: a README or a spec doesn't make a module its character. */
export const mainFiles = (m: Pick<Module, 'path' | 'filePaths'>) =>
  m.filePaths.filter(
    (p) => dir(p) === (m.path === '(root)' ? '' : m.path) && !/\.(md|mdx|txt|rst|adoc)$/i.test(p) && !/[._-](test|spec)\.[a-z]+$/i.test(p),
  );

/**
 * Folder name first, then main file names. No match: the largest unmatched module is the Hoarder,
 * else 5+ TODOs and no tests is the Junk Drawer, else the Clerk. Repeats alternate the variant.
 */
export function assignCast(modules: Module[]): { archetype: Archetype; variant: Variant }[] {
  const matched = modules.map(
    (m) => (m.id === '(root)' ? 'librarian' : null) ?? keywordArchetype(m.name) ?? mainFiles(m).map((p) => keywordArchetype(base(p).replace(/\.[^.]+$/, ''))).find(Boolean) ?? null,
  );
  const unmatched = modules.filter((_, i) => !matched[i]);
  const hoard = unmatched.reduce<Module | null>((a, m) => (!a || m.stats.totalLines > a.stats.totalLines ? m : a), null);
  const seen: Partial<Record<Archetype, number>> = {};
  return modules.map((m, i) => {
    const archetype =
      matched[i] ?? (m === hoard ? 'hoarder' : m.stats.todoCount >= 5 && !m.stats.hasTests ? 'junkDrawer' : 'clerk');
    const n = (seen[archetype] = (seen[archetype] ?? 0) + 1);
    return { archetype, variant: ((n - 1) % 2) as Variant };
  });
}
