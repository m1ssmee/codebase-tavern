// "Roast My Repo": a health-inspection notice. Violations and the grade are deterministic (stats + graph); the lines
// come from one AI call, with these templates as the fallback for every line. Pure, so check.mjs runs it directly.
import type { Module, RepoFile, SpiceLevel } from './types';
import { isCode, nesting } from './analyze.ts';
import { dependentsOf, type Graph } from './graph.ts';
import { buildingFacts } from './landlord.ts';
import { hash } from './characters.ts';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
/** What the inspector found in one module. Only the numbers and names the card shows. */
export type Facts = {
  bigFile?: { name: string; lines: number }; // biggest non-test code file over 300 lines
  noTests?: true; // no tests, and no test module imports it
  nesting?: number; // ≥ 6
  todos?: number; // ≥ 5
  codependentWith?: string; // in a dependency loop with this module
  orphan?: true; // nothing imports or calls it, and it needs nothing
};
/** Face parameters (CharacterFace traits): colour, total lines, TODOs, biggest file, nesting, has tests. */
export type FaceSpec = [string, number, number, number, number, 0 | 1];
export type RoastEntry = { id: string; name: string; title: string; stat: string; line: string; face: FaceSpec; facts: Facts };
export type RoastCard = {
  repo: string; // owner/repo
  date: string; // YYYY-MM-DD
  grade: Grade;
  violations: number;
  modules: number; // modules inspected
  headline: string; // the Landlord
  entries: RoastEntry[];
  keys: number; // the Landlord's key ring: one per module
  clean: boolean;
};
export type Inspection = { grade: Grade; violations: number; modules: number; entries: Omit<RoastEntry, 'line'>[] };

const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|[._-](test|spec)\.[a-z]+$/i;
const TEST_MODULE = /^(tests?|specs?|__tests__|e2e)$/i;
const DOCS = /^(docs?|documentation)$/i;
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export const STAMP: Record<Grade, string> = { A: 'PASSED', B: 'PASSED', C: 'PASSED WITH CONCERNS', D: 'FAILED', F: 'FAILED' };
export const SMALL_PRINT = 'Grade = number of violations found. Nothing more scientific than that.';

/** Violations per inspected module: under 0.25 is an A, 0.6 a B, 1.05 a C, 1.6 a D, worse is an F. */
export function gradeFor(violations: number, modules: number): Grade {
  const per = violations / Math.max(1, modules);
  return per < 0.25 ? 'A' : per < 0.6 ? 'B' : per < 1.05 ? 'C' : per < 1.6 ? 'D' : 'F';
}

/** "validation.ts: 417 lines, no tests" — the real stat line for an entry. */
export function statText(name: string, f: Facts): string {
  const bits = [
    f.bigFile && `${f.bigFile.name}: ${f.bigFile.lines} lines`,
    f.noTests && 'no tests',
    f.nesting && `nested ${f.nesting} levels deep`,
    f.todos && `${f.todos} TODOs`,
    f.codependentWith && `codependent with ${f.codependentWith}`,
    f.orphan && '0 imports, 0 calls',
  ].filter(Boolean);
  return bits.length ? (f.bigFile ? bits.join(', ') : `${name}: ${bits.join(', ')}`) : `${name}: no violations found`;
}
const count = (f: Facts) => Object.keys(f).length;

/**
 * Inspects code modules only (docs, tooling dot-folders and config-only folders aren't held to code rules). Per module: no tests
 * (unless a test module imports it), a code file over 300 lines, nesting ≥ 6, 5+ TODOs. Repo-wide: each
 * dependency loop, and each module nothing imports or calls (that needs nothing either), from graph.ts.
 */
export function inspect(files: RepoFile[], modules: Module[], g: Graph, title: (id: string) => string, color: (id: string) => string): Inspection {
  const facts = buildingFacts(g, modules);
  const code = (m: Module) => files.filter((f) => m.filePaths.includes(f.path) && isCode(f.path));
  const inspected = modules.filter((m) => code(m).length && !DOCS.test(m.name) && !m.name.startsWith('.')); // .github, .devcontainer: tooling
  const testModules = new Set(modules.filter((m) => TEST_MODULE.test(m.name) || (code(m).length && code(m).every((f) => TEST_FILE.test(f.path)))).map((m) => m.id));
  const found = new Map<string, Facts>();
  let violations = 0;
  for (const m of inspected) {
    const own = code(m).filter((f) => !TEST_FILE.test(f.path));
    const f: Facts = {};
    const big = [...own].sort((a, b) => b.lineCount - a.lineCount)[0];
    if (big && big.lineCount > 300) f.bigFile = { name: base(big.path), lines: big.lineCount };
    const tested = m.stats.hasTests || testModules.has(m.id) || dependentsOf(g, m.id).some((e) => testModules.has(e.from));
    if (!tested) f.noTests = true;
    const deepest = Math.max(0, ...own.map((x) => nesting(x)));
    if (deepest >= 6) f.nesting = deepest;
    if (m.stats.todoCount >= 5) f.todos = m.stats.todoCount;
    violations += count(f);
    found.set(m.id, f);
  }
  const nameOf = (id: string) => modules.find((m) => m.id === id)?.name ?? id;
  for (const loop of facts.cycles) {
    violations++;
    loop.forEach((id, k) => {
      const f = found.get(id);
      if (f) f.codependentWith = nameOf(loop[(k + 1) % loop.length]);
    });
  }
  for (const id of facts.orphans) {
    const f = found.get(id);
    if (!f) continue; // docs, config-only folders: not dead code
    f.orphan = true;
    violations++;
  }
  const ranked = [...inspected].sort((a, b) => count(found.get(b.id)!) - count(found.get(a.id)!) || b.stats.totalLines - a.stats.totalLines);
  // The 3-4 worst; a tidy repo is topped up to three with its biggest violation-free modules ("no violations found").
  const worst = ranked.filter((m) => count(found.get(m.id)!)).slice(0, 4);
  const shown = [...worst, ...ranked.filter((m) => !worst.includes(m)).slice(0, Math.max(0, 3 - worst.length))];
  const entries = shown.map((m) => {
    const f = found.get(m.id)!;
    const s = m.stats;
    return {
      id: m.id,
      name: m.name,
      title: title(m.id),
      stat: statText(m.name, f),
      face: [color(m.id), s.totalLines, s.todoCount, s.biggestFile.lines, s.maxNesting, s.hasTests ? 1 : 0] as FaceSpec,
      facts: f,
    };
  });
  return { grade: gradeFor(violations, inspected.length), violations, modules: inspected.length, entries };
}

// --- Template lines: the fallback for every line, at every level, plus a clean version of each.

type Lines = Record<SpiceLevel, string[]>;
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const pick = (lines: Lines, spice: SpiceLevel, seed: string, v: Record<string, string | number>) => {
  const xs = lines[spice] ?? lines.unhinged;
  return fill(xs[hash(seed) % xs.length], v);
};

const LINE: Record<'bigFile' | 'noTests' | 'nesting' | 'todos' | 'codependentWith' | 'orphan' | 'none', Lines> = {
  bigFile: {
    clean: ['{file} is {lines} lines. That is not a file, it is a filing cabinet.', '{file} runs {lines} lines. Nobody opens it on purpose.'],
    unhinged: ['{file} is {lines} lines. That is not a helper, it is a damn landfill with exports.', '{file} runs {lines} lines. Nobody opens that shit on purpose.'],
    feral: ['{file} is {lines} lines and it stinks like a week-old lunch.', '{file}: {lines} lines of bloated, sweaty, fucking helpers.'],
    nuclear: ['{file}. {lines} LINES. Somebody condemn this file.', '{file} is {lines} lines. I am filing a fucking complaint with myself.'],
  },
  noTests: {
    clean: ['{lines} lines in {name}, no tests. It works on someone else’s machine.', '{name}: {lines} lines and not one test. Bold.'],
    unhinged: ['{lines} lines in {name} and zero tests. It runs on hope and damn optimism.', '{name}: {lines} lines, no tests. Ship it and pray, apparently.'],
    feral: ['{lines} lines in {name} and no tests. It reeks of untested shit.', '{name}: {lines} lines, zero tests, and a fucking smell of confidence.'],
    nuclear: ['{lines} LINES. ZERO TESTS. In {name}.', '{name} ships {lines} lines with no tests. Fucking incredible.'],
  },
  nesting: {
    clean: ['{name} nests code {n} levels deep. Bring a map.', '{n} levels of nesting in {name}. Some of it is a maze on purpose.'],
    unhinged: ['{name} nests code {n} levels deep. Bring a map and a damn flashlight.', '{n} levels deep in {name}. That is not logic, that is a fucking cave.'],
    feral: ['{name} buries code {n} levels deep and it smells like a basement.', '{n} levels of nesting in {name}. Something died down there.'],
    nuclear: ['{n} LEVELS DEEP. In {name}.', '{name} nests code {n} levels down. I am not going in there, fuck that.'],
  },
  todos: {
    clean: ['{n} TODOs in {name}. None of them are getting done today.', '{name} keeps {n} TODOs like souvenirs.'],
    unhinged: ['{n} TODOs in {name}. None of them are getting done, damn it.', '{name} hoards {n} TODOs like unpaid bills.'],
    feral: ['{n} TODOs rotting in {name}. The place stinks of promises.', '{name}: {n} TODOs and every one of them is a fucking lie.'],
    nuclear: ['{n} TODOS. In {name}.', '{name} has {n} TODOs and not one shred of follow-through.'],
  },
  codependentWith: {
    clean: ['{name} and {other} depend on each other. Codependent. Not healthy.', '{name} needs {other}, {other} needs {name}. Nobody leaves.'],
    unhinged: ['{name} and {other} depend on each other. Codependent as hell.', '{name} needs {other} and {other} needs {name}. A damn loop.'],
    feral: ['{name} and {other} cling to each other like wet laundry. It stinks.', '{name} and {other}: a sweaty, codependent fucking loop.'],
    nuclear: ['{name} AND {other}. A LOOP.', '{name} and {other} are codependent and I want them both evicted.'],
  },
  orphan: {
    clean: ['Nothing imports {name}. Nobody calls. Nobody writes.', '{name}: 0 imports, 0 calls. Possibly abandoned.'],
    unhinged: ['Nothing imports {name}. Nobody calls, nobody writes. Damn.', '{name}: 0 imports, 0 calls. Dead weight with a folder.'],
    feral: ['Nothing imports {name}. It rots in the corner, unloved.', '{name}: 0 imports, 0 calls, and a smell of abandonment.'],
    nuclear: ['NOTHING IMPORTS {name}.', '{name} has 0 imports and 0 calls. Fucking ghost town.'],
  },
  none: {
    clean: ['{name}: {lines} lines and nothing to report. Suspicious.', '{name} passed. Nobody is more surprised than {name}.'],
    unhinged: ['{name}: {lines} lines and nothing to report. Suspicious as hell.', '{name} passed. Nobody is more damn surprised than {name}.'],
    feral: ['{name}: {lines} lines and no stink. Check again.', '{name} passed and I don’t fucking trust it.'],
    nuclear: ['{name} PASSED. I need to sit down.', '{name}: {lines} lines and nothing wrong. Fucking unheard of.'],
  },
};
const HEADLINE: Record<'good' | 'meh' | 'bad', Lines> = {
  good: {
    clean: ['{v} violations across {m} modules. Grade {g}. I checked twice. Something must be hiding.', 'Grade {g}: {v} violations in {m} modules. I have seen worse buildings. Not many.'],
    unhinged: ['{v} violations across {m} modules. Grade {g}. I checked twice. Something is damn well hiding.', 'Grade {g}: {v} violations in {m} modules. I have seen worse buildings. Not many, damn it.'],
    feral: ['{v} violations across {m} modules. Grade {g}. It barely stinks. Suspicious as fuck.', 'Grade {g}: {v} violations in {m} modules. Wipe your feet anyway.'],
    nuclear: ['GRADE {g}. {v} violations across {m} modules. I don’t believe it.', 'Grade {g}, {v} violations in {m} modules. I will be back with a fucking flashlight.'],
  },
  meh: {
    clean: ['{v} violations across {m} modules. Grade {g}. I have seen worse, but not this week.', 'Grade {g}: {v} violations in {m} modules. The rent is not going down.'],
    unhinged: ['{v} violations across {m} modules. Grade {g}. I have seen worse, but not this damn week.', 'Grade {g}: {v} violations in {m} modules. The rent is going up, obviously.'],
    feral: ['{v} violations across {m} modules. Grade {g}. The hallway smells of untested code.', 'Grade {g}: {v} violations in {m} modules. Somebody open a fucking window.'],
    nuclear: ['{v} VIOLATIONS. {m} MODULES. GRADE {g}.', 'Grade {g}, {v} violations in {m} modules. I need a fucking drink.'],
  },
  bad: {
    clean: ['{v} violations across {m} modules. Grade {g}. I am not even surprised.', 'Grade {g}: {v} violations in {m} modules. I have stopped being surprised.'],
    unhinged: ['{v} violations across {m} modules. Grade {g}. I am not even damn surprised.', 'Grade {g}: {v} violations in {m} modules. This is why the deposit is huge.'],
    feral: ['{v} violations across {m} modules. Grade {g}. The whole building stinks.', 'Grade {g}: {v} violations in {m} modules. Condemn the fucking thing.'],
    nuclear: ['GRADE {g}. {v} VIOLATIONS. Nobody is getting their deposit back.', 'Grade {g}, {v} violations in {m} modules. Burn it down and bill the tenants.'],
  },
};
const FIRST: (keyof Facts)[] = ['bigFile', 'nesting', 'todos', 'noTests', 'codependentWith', 'orphan'];

export function fallbackLine(e: Pick<RoastEntry, 'id' | 'name' | 'facts' | 'face'>, spice: SpiceLevel): string {
  const k = FIRST.find((x) => e.facts[x] !== undefined) ?? 'none';
  const f = e.facts;
  return pick(LINE[k], spice, e.id + k, {
    name: e.name,
    file: f.bigFile?.name ?? '',
    lines: k === 'bigFile' ? (f.bigFile?.lines ?? 0) : e.face[1].toLocaleString('en'),
    n: f.nesting ?? f.todos ?? 0,
    other: f.codependentWith ?? '',
  });
}
export function fallbackHeadline(i: Pick<Inspection, 'grade' | 'violations' | 'modules'>, spice: SpiceLevel, seed: string): string {
  const band = i.grade === 'A' || i.grade === 'B' ? 'good' : i.grade === 'C' ? 'meh' : 'bad';
  return pick(HEADLINE[band], spice, seed, { v: i.violations, m: i.modules, g: i.grade });
}

export { SWEARING } from './guards.ts'; // clean lines must have none

// --- Compact share payload (signed and compressed by the server; this is just the shape). Kept lean so the QR code
// stays scannable: titles without the repeated module name, violation facts instead of the stat sentence.

type FactsC = [[string, number] | 0, 0 | 1, number, number, string, 0 | 1];
type EntryC = [string, string, FactsC, string, FaceSpec];
type Compact = [2, string, string, Grade, number, number, string, number, 0 | 1, EntryC[]];
const packFacts = (f: Facts): FactsC => [f.bigFile ? [f.bigFile.name, f.bigFile.lines] : 0, f.noTests ? 1 : 0, f.nesting ?? 0, f.todos ?? 0, f.codependentWith ?? '', f.orphan ? 1 : 0];
function unpackFacts(x: unknown): Facts {
  const [big, noTests, nest, todos, other, orphan] = (Array.isArray(x) ? x : []) as FactsC;
  const f: Facts = {};
  if (Array.isArray(big)) f.bigFile = { name: String(big[0]), lines: Number(big[1]) || 0 };
  if (noTests) f.noTests = true;
  if (Number(nest) >= 6) f.nesting = Number(nest);
  if (Number(todos) >= 5) f.todos = Number(todos);
  if (other) f.codependentWith = String(other);
  if (orphan) f.orphan = true;
  return f;
}
export const toCompact = (c: RoastCard): Compact => [
  2, c.repo, c.date, c.grade, c.violations, c.modules, c.headline, c.keys, c.clean ? 1 : 0,
  c.entries.map((e) => [e.name, e.title.startsWith(`${e.name}, `) ? e.title.slice(e.name.length + 2) : `=${e.title}`, packFacts(e.facts), e.line, e.face]),
];
export function fromCompact(x: unknown): RoastCard | null {
  if (!Array.isArray(x) || x[0] !== 2 || x.length !== 10 || !Array.isArray(x[9])) return null;
  const [, repo, date, grade, violations, modules, headline, keys, clean, entries] = x as Compact;
  if (!['A', 'B', 'C', 'D', 'F'].includes(grade)) return null;
  return {
    repo: String(repo),
    date: String(date),
    grade,
    violations: Number(violations) || 0,
    modules: Number(modules) || 0,
    headline: String(headline),
    keys: Number(keys) || 1,
    clean: clean === 1,
    entries: entries.slice(0, 4).map(([name, t, f, line, face]) => {
      const facts = unpackFacts(f);
      const title = String(t).startsWith('=') ? String(t).slice(1) : t ? `${name}, ${t}` : String(name);
      return { id: String(name), name: String(name), title, stat: statText(String(name), facts), line: String(line), face, facts };
    }),
  };
}
