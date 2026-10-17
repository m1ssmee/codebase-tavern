// The Landlord (narrates the whole repo; not a module), the guided tour order, and the graph-fact captions.
// Deterministic templates: 2-3 variants per spice level, every line built on a real number or name. Pure, so
// `node scripts/check.mjs` runs it directly.
import type { Module, RepoFile, SpiceLevel } from './types';
import { dependenciesOf, dependentsOf, type Graph } from './graph.ts';
import { hash } from './characters.ts';

type Lines = Record<SpiceLevel, string[]>;
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const pick = (lines: Lines, spice: SpiceLevel, seed: string, v: Record<string, string | number>) => {
  const xs = lines[spice] ?? lines.unhinged;
  return fill(xs[hash(seed) % xs.length], v);
};
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const users = (g: Graph, id: string) => [...new Set(dependentsOf(g, id).map((e) => e.from))];
const needs = (g: Graph, id: string) => [...new Set(dependenciesOf(g, id).map((e) => e.to))];
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// --- Tour order

const PREFERRED = ['gateway', 'server', 'app', 'main', 'index', 'api'];
const SIDELINE = /^(tests?|specs?|__tests__|e2e|examples?|docs?|benchmarks?|fixtures?|scripts?|misc)$/i;

/**
 * Start where a request starts: a gateway/server/app/main/index module, else a module nothing imports or calls
 * that depends on others, else the repo-root code, else the most depended-on module. Then breadth-first along
 * calls (in the order the call sites appear, how a request fans out) and imports (heaviest first).
 * Modules the walk never reaches come last.
 */
export function tourOrder(g: Graph, modules: Module[]): { order: string[]; firstUnreachable: number; entry: string } {
  const out = (id: string) => needs(g, id).length;
  const by = (id: string) => users(g, id).length;
  const real = modules.filter((m) => !SIDELINE.test(m.name));
  const entry =
    modules.find((m) => PREFERRED.includes(m.name.toLowerCase()) && out(m.id) > 0) ??
    real.filter((m) => by(m.id) === 0 && out(m.id) > 0).sort((a, b) => out(b.id) - out(a.id))[0] ??
    modules.find((m) => m.id === '(root)' && out(m.id) > 0) ??
    [...real].sort((a, b) => by(b.id) - by(a.id) || b.stats.totalLines - a.stats.totalLines)[0] ??
    modules[0];
  if (!entry) return { order: [], firstUnreachable: 0, entry: '' };
  const known = new Set(modules.map((m) => m.id));
  const order = [entry.id];
  const seen = new Set(order);
  for (let i = 0; i < order.length; i++) {
    const cur = order[i];
    const calls = g.imports
      .filter((r) => r.kind === 'calls' && r.from === cur && r.to)
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
      .map((r) => r.to!);
    const imports = dependenciesOf(g, cur, { calls: false })
      .sort((a, b) => b.weight - a.weight || a.to.localeCompare(b.to))
      .map((e) => e.to);
    for (const id of [...calls, ...imports]) {
      if (seen.has(id) || !known.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
  }
  const rest = modules.filter((m) => !seen.has(m.id)).sort((a, b) => Number(a.id === '(misc)') - Number(b.id === '(misc)'));
  return { order: [...order, ...rest.map((m) => m.id)], firstUnreachable: order.length, entry: entry.id };
}

// --- Graph facts (imports and calls both count)

export type Facts = {
  cycles: string[][]; // groups of modules that depend on each other in a loop
  cycleEdges: Set<string>; // "from>to" for every edge inside a loop
  hub?: { id: string; n: number }; // most depended-on (n ≥ 2)
  orphans: string[]; // nothing imports or calls them and they need nothing
  needy?: { id: string; n: number; givesBack: number }; // depends on the most others (n ≥ 3)
};

export function buildingFacts(g: Graph, modules: Module[]): Facts {
  // Tarjan's strongly connected components; repos have ≤ 8 modules, so recursion is fine.
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const cycles: string[][] = [];
  let n = 0;
  const strong = (v: string) => {
    idx.set(v, n);
    low.set(v, n++);
    stack.push(v);
    on.add(v);
    for (const w of needs(g, v)) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) !== idx.get(v)) return;
    const c: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      on.delete(w);
      c.push(w);
    } while (w !== v);
    if (c.length > 1) cycles.push(modules.map((m) => m.id).filter((id) => c.includes(id)));
  };
  for (const m of modules) if (!idx.has(m.id)) strong(m.id);
  const inCycle = (a: string, b: string) => cycles.some((c) => c.includes(a) && c.includes(b));
  const cycleEdges = new Set(g.edges.filter((e) => inCycle(e.from, e.to)).map((e) => `${e.from}>${e.to}`));

  const weightIn = (id: string) => dependentsOf(g, id).reduce((s, e) => s + e.weight, 0);
  const hub = [...modules].sort((a, b) => users(g, b.id).length - users(g, a.id).length || weightIn(b.id) - weightIn(a.id))[0];
  const needy = [...modules].sort((a, b) => needs(g, b.id).length - needs(g, a.id).length)[0];
  return {
    cycles,
    cycleEdges,
    hub: hub && users(g, hub.id).length >= 2 ? { id: hub.id, n: users(g, hub.id).length } : undefined,
    orphans: modules.filter((m) => !users(g, m.id).length && !needs(g, m.id).length).map((m) => m.id),
    needy: needy && needs(g, needy.id).length >= 3 ? { id: needy.id, n: needs(g, needy.id).length, givesBack: users(g, needy.id).length } : undefined,
  };
}

const CAPTION: Record<'cycle' | 'hub' | 'orphan' | 'needy' | 'needyGives', Lines> = {
  cycle: {
    clean: ["{a} and {b} need each other. Codependent. It's not healthy.", "Codependent: {a} leans on {b}, {b} leans on {a}. It's not healthy."],
    unhinged: ["{a} and {b}: codependent. It's not healthy, and it's a damn mess.", "{a} needs {b}, {b} needs {a}. Codependent as hell. Not healthy."],
    feral: ["{a} and {b} are codependent and it stinks. Not fucking healthy.", "{a} needs {b}, {b} needs {a}. Codependent, sweaty, not healthy."],
    nuclear: ["{a} AND {b}. CODEPENDENT. It's not healthy and I'm done.", "{a} and {b} cling to each other like a fucking life raft. Codependent. Not healthy."],
  },
  hub: {
    clean: ['{n} modules lean on it. Holding this entire place up.', 'Holding this entire place up: {n} modules depend on it.'],
    unhinged: ['{n} modules lean on it. Holding this entire damn place up.', 'Holding this entire place up for {n} modules, and nobody says thanks.'],
    feral: ['{n} modules hang off it. Holding this entire stinking place up.', 'Holding this whole fucking place up: {n} modules lean on it.'],
    nuclear: ['{n} MODULES ON ONE BEAM. Holding this entire place up.', 'Holding this entire fucking place up for {n} modules. One sneeze and it all goes.'],
  },
  orphan: {
    clean: ['0 imports, 0 calls. Nobody calls. Nobody writes.', 'Nobody calls. Nobody writes. 0 imports either way.'],
    unhinged: ['0 imports, 0 calls. Nobody calls. Nobody writes. Damn.', 'Nobody calls. Nobody writes. Not one import, not one call.'],
    feral: ['0 imports, 0 calls. Nobody calls, nobody writes, and it smells abandoned.', 'Nobody calls. Nobody writes. 0 imports. It just sits there, festering.'],
    nuclear: ['0 IMPORTS. 0 CALLS. Nobody calls. Nobody writes.', 'Nobody calls. Nobody writes. 0 imports, 0 calls, 0 fucking visitors.'],
  },
  needy: {
    clean: ['Depends on {n} modules. Needs everyone. Gives nothing back.', 'Needs everyone: {n} modules. Gives nothing back.'],
    unhinged: ['Depends on {n} modules. Needs everyone. Gives nothing back, damn it.', 'Needs everyone, {n} modules of them. Gives nothing back.'],
    feral: ['Leeches off {n} modules. Needs everyone. Gives fucking nothing back.', 'Needs everyone: {n} modules. Gives nothing back. Stinks of entitlement.'],
    nuclear: ['{n} MODULES AND IT STILL WANTS MORE. Needs everyone. Gives nothing back.', 'Needs everyone, all {n} of them. Gives fucking nothing back.'],
  },
  needyGives: {
    clean: ['Depends on {n} modules. Needs everyone. Returns the favour to {k}.', 'Needs everyone: {n} modules. Gives back to {k}.'],
    unhinged: ['Depends on {n} modules. Needs everyone. Gives back to {k}, barely.', 'Needs everyone, {n} modules of them. Gives back to {k}. Damn.'],
    feral: ['Leeches off {n} modules. Needs everyone. Throws {k} a scrap back.', 'Needs everyone: {n} modules. Gives back to {k}, and it stinks of guilt.'],
    nuclear: ['{n} MODULES. Needs everyone. Gives back to {k} and calls it generosity.', 'Needs all {n} of them. Gives back to {k}. Fucking unbelievable.'],
  },
};

/** One caption per module the facts say something about. `nameOf` gives display names. */
export function captions(f: Facts, spice: SpiceLevel, nameOf: (id: string) => string): Map<string, string> {
  const out = new Map<string, string>();
  const add = (id: string, text: string) => out.set(id, out.has(id) ? `${out.get(id)} ${text}` : text);
  for (const c of f.cycles) add(c[0], pick(CAPTION.cycle, spice, c.join(), { a: nameOf(c[0]), b: list(c.slice(1).map(nameOf)) }));
  if (f.hub) add(f.hub.id, pick(CAPTION.hub, spice, f.hub.id, { n: f.hub.n }));
  for (const id of f.orphans) add(id, pick(CAPTION.orphan, spice, id, {}));
  if (f.needy) add(f.needy.id, pick(f.needy.givesBack ? CAPTION.needyGives : CAPTION.needy, spice, f.needy.id, { n: f.needy.n, k: f.needy.givesBack }));
  return out;
}

// --- The Landlord's fallback lines (used when the model's lines are missing)

const INTRO: Lines = {
  clean: ['{repo}: {files} files, {modules} tenants, {todos} TODOs. I own the building. Rent is mostly theoretical.', 'Welcome to {repo}. {files} files across {modules} modules and {todos} TODOs nobody has paid off.'],
  unhinged: ['{repo}: {files} files, {modules} tenants, {todos} TODOs. I own this damn building and nobody pays on time.', 'Welcome to {repo}. {files} files, {modules} modules, {todos} TODOs, and not one tenant who cleans up.'],
  feral: ['{repo}: {files} files, {modules} tenants, {todos} TODOs rotting in the walls. I own this shithole.', 'Welcome to {repo}. {files} files, {modules} modules, and it stinks of {todos} unpaid TODOs.'],
  nuclear: ['{repo}. {files} files, {modules} tenants, {todos} TODOs. I OWN THIS PLACE AND I REGRET IT.', 'Welcome to {repo}: {files} files, {modules} modules, {todos} TODOs. Every one of them is a fucking eviction notice.'],
};
const OUTRO: Lines = {
  clean: ["That's the building: {modules} tenants, {edges} connections{cycles}. Rent is due Friday.", "{modules} tenants, {edges} connections{cycles}. That's the tour. Don't touch the thermostat."],
  unhinged: ["That's the building: {modules} tenants, {edges} connections{cycles}. Rent is due Friday, damn it.", "{modules} tenants, {edges} connections{cycles}. That's the tour. Try not to break shit."],
  feral: ["That's the building: {modules} tenants, {edges} connections{cycles}. It stinks, it leaks, rent is due Friday.", "{modules} tenants, {edges} connections{cycles}. Tour's over. Wipe your fucking feet."],
  nuclear: ["{modules} tenants, {edges} connections{cycles}. TOUR'S OVER. Rent is due Friday.", "That's the building: {modules} tenants, {edges} connections{cycles}. I need a fucking drink."],
};
const LINE: Record<'hub' | 'orphan' | 'cycle' | 'plain', Lines> = {
  hub: {
    clean: ['{name}: {lines} lines, and {n} tenants lean on it. If it moves out, the ceiling comes down.', '{name} holds up {n} other modules with {lines} lines. I check its foundations twice a year.'],
    unhinged: ['{name}: {lines} lines, and {n} tenants lean on it. If it moves out, the damn ceiling comes down.', '{name} holds up {n} modules with {lines} lines and gets zero thanks.'],
    feral: ['{name}: {lines} lines, {n} tenants hanging off it. If it moves out, the whole shithouse collapses.', '{name} holds up {n} modules with {lines} lines. Load-bearing and it smells like it.'],
    nuclear: ['{name}: {lines} lines, {n} tenants. IF IT LEAVES, WE ALL DIE.', '{name} holds up {n} fucking modules with {lines} lines. Nobody touch it.'],
  },
  orphan: {
    clean: ['{name}: {files} files, {lines} lines, no visitors. Nobody imports it and nobody calls it.', '{name} keeps {files} files and gets no mail. Not one import, not one call.'],
    unhinged: ['{name}: {files} files, {lines} lines, no visitors. Nobody imports it, nobody calls it. Damn.', '{name} keeps {files} files and gets no mail. Not one import. Not one damn call.'],
    feral: ['{name}: {files} files, {lines} lines, no visitors. It just sits in the basement and festers.', '{name}: {files} files nobody imports. The basement smells like it.'],
    nuclear: ['{name}: {files} files, {lines} lines, ZERO VISITORS. Not one import.', '{name} keeps {files} files and nobody imports a single fucking one.'],
  },
  cycle: {
    clean: ['{name}: {lines} lines. It and {other} depend on each other. I stopped asking who pays.', '{name} shares a dependency loop with {other}. {lines} lines of mutual reliance.'],
    unhinged: ['{name}: {lines} lines, stuck in a loop with {other}. I stopped asking who pays the damn bills.', '{name} and {other} lean on each other. {lines} lines of codependent mess.'],
    feral: ['{name}: {lines} lines, tangled up with {other} like wet laundry. It stinks.', '{name} and {other} need each other. {lines} lines of sweaty codependence.'],
    nuclear: ['{name} AND {other}. A LOOP. {lines} lines of it.', '{name} and {other} are stuck in a fucking loop. {lines} lines. I give up.'],
  },
  plain: {
    clean: ['{name}: {lines} lines in {files} files. {inbound} {outbound}', '{name} rents {files} files, {lines} lines. {inbound} {outbound}'],
    unhinged: ['{name}: {lines} lines in {files} files. {inbound} {outbound} Pays rent, mostly.', '{name} rents {files} files, {lines} lines. {inbound} {outbound} Could be worse. Damn.'],
    feral: ['{name}: {lines} lines in {files} files. {inbound} {outbound} Smells about average.', '{name} rents {files} files, {lines} lines. {inbound} {outbound} Leaves crumbs everywhere.'],
    nuclear: ['{name}: {lines} lines in {files} files. {inbound} {outbound} FINE. WHATEVER.', '{name} rents {files} files, {lines} lines. {inbound} {outbound} I swear to god.'],
  },
};
const CLOSING: Lines = {
  clean: ["Fixed. I'll be raising the rent.", "{steps} changes, {n} tenants, no complaints. Fixed. I'll be raising the rent.", "All {n} tenants are fine or relieved. Rent goes up on the first."],
  unhinged: ["Fixed. I'll be raising the damn rent.", "{steps} changes, {n} tenants, zero complaints. Fixed. Rent's going up, obviously.", "All {n} tenants are fine or relieved. Suspicious as hell. Rent goes up anyway."],
  feral: ["Fixed. Nothing stinks for once. Rent's going the fuck up.", "{steps} changes and all {n} tenants stopped whining. Rent's going up, you filthy animals.", "Fixed. {n} tenants, no leaks today. I'll be raising the damn rent."],
  nuclear: ["FIXED. I'll be raising the rent.", "{steps} changes, {n} tenants, nobody screaming. RENT GOES UP TOMORROW.", "All {n} fine or relieved. I don't trust it. Raising the fucking rent."],
};

export const UNREACHABLE = 'The ones nobody visits.';

export function landlordIntro(repoName: string, files: RepoFile[], modules: Module[], spice: SpiceLevel): string {
  const todos = modules.reduce((s, m) => s + m.stats.todoCount, 0);
  return pick(INTRO, spice, repoName, { repo: repoName, files: files.length, modules: modules.length, todos });
}

export function landlordOutro(repoName: string, g: Graph, modules: Module[], f: Facts, spice: SpiceLevel): string {
  const pairs = f.cycles.length;
  return pick(OUTRO, spice, repoName + 'outro', {
    modules: modules.length,
    edges: g.edges.length,
    cycles: pairs ? `, ${pairs} codependent ${pairs === 1 ? 'pair' : 'groups'}` : '',
  });
}

export function landlordLine(m: Module, g: Graph, f: Facts, spice: SpiceLevel, nameOf: (id: string) => string): string {
  const v = { name: m.name, lines: m.stats.totalLines.toLocaleString('en'), files: m.stats.fileCount };
  if (f.hub?.id === m.id) return pick(LINE.hub, spice, m.id, { ...v, n: f.hub.n });
  if (f.orphans.includes(m.id)) return pick(LINE.orphan, spice, m.id, v);
  const loop = f.cycles.find((c) => c.includes(m.id));
  if (loop) return pick(LINE.cycle, spice, m.id, { ...v, other: list(loop.filter((x) => x !== m.id).map(nameOf)) });
  const u = users(g, m.id).map(nameOf);
  const n = needs(g, m.id).map(nameOf);
  return pick(LINE.plain, spice, m.id, {
    ...v,
    inbound: u.length ? `Used by ${list(u)}.` : 'Nothing depends on it.',
    outbound: n.length ? `Needs ${list(n)}.` : 'Needs nobody.',
  }).replace(/\s+/g, ' ');
}

/** What the module does, when the model didn't say: the plain facts we have. */
export const aboutFallback = (m: Module) =>
  m.stats.biggestFile.path
    ? `${m.name} keeps ${m.stats.fileCount} ${m.stats.fileCount === 1 ? 'file' : 'files'}; the biggest is ${base(m.stats.biggestFile.path)} at ${m.stats.biggestFile.lines} lines.`
    : `${m.name} keeps ${m.stats.fileCount} files.`;

/** The What-if closing beat, once a stack of changes leaves every module fine or relieved. */
// One change: only the lines that don't count changes ("1 changes").
const CLOSING_ONE = Object.fromEntries(Object.entries(CLOSING).map(([k, v]) => [k, v.filter((l) => !l.includes('{steps}'))])) as Lines;
export const closingLine = (spice: SpiceLevel, steps: number, n: number, seed: string) => pick(steps === 1 ? CLOSING_ONE : CLOSING, spice, seed, { steps, n });
