// The trust boundary for /api/characters and /api/gossip: modules rebuilt from known fields only, truncated, so the
// prompt stays small and a malformed body can't crash the template fallback. Pure.
import type { Module, ModuleStats } from './types';

export type KeyFile = { path: string; head: string };
export type InModule = Module & { keyFiles?: KeyFile[]; testFiles?: unknown; links?: { usedBy?: unknown; uses?: unknown } };
export type CleanModule = Module & { keyFiles: KeyFile[]; testFiles: number; links: { usedBy: string[]; uses: string[] } };

const KEY_LINES = 24; // context cap per key file, so a new repo's cast stays around $0.02
const KEY_LINE_CHARS = 110;

export const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');
export const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
export const strings = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, 12).map((x) => clip(x, 120)).filter(Boolean) : []).slice(0, n);

export function cleanModule(m: InModule): CleanModule {
  const s = (m.stats ?? {}) as Partial<ModuleStats>;
  return {
    id: clip(m.id, 200),
    name: clip(m.name, 100) || clip(m.id, 100),
    path: clip(m.path, 200),
    filePaths: (Array.isArray(m.filePaths) ? m.filePaths : []).slice(0, 20).map((p) => clip(p, 200)),
    stats: {
      fileCount: num(s.fileCount),
      totalLines: num(s.totalLines),
      biggestFile: { path: clip(s.biggestFile?.path, 200), lines: num(s.biggestFile?.lines) },
      todoCount: num(s.todoCount),
      maxNesting: num(s.maxNesting),
      hasTests: s.hasTests === true,
    },
    testFiles: num(m.testFiles),
    links: { usedBy: strings(m.links?.usedBy, 12), uses: strings(m.links?.uses, 12) },
    keyFiles: (Array.isArray(m.keyFiles) ? m.keyFiles : []).slice(0, 2).map((f) => ({
      path: clip(f?.path, 200),
      head: clip(f?.head, 8000).split('\n').slice(0, KEY_LINES).map((l) => l.slice(0, KEY_LINE_CHARS)).join('\n'),
    })),
  };
}

/** What the model sees of a module it writes for: stats, links, files and the first lines of its key files. */
export const promptModule = ({ id, name, path, stats, filePaths, keyFiles, links, testFiles }: CleanModule) => ({
  moduleId: id,
  name,
  path,
  stats: { ...stats, testFiles },
  links,
  files: filePaths,
  keyFiles: keyFiles.map((f) => ({ path: f.path, first24Lines: f.head })),
});

/** What the model sees of the other tenants: names, stats and links (real facts to gossip with), no code. */
export const neighbour = ({ name, stats, links, testFiles }: CleanModule) => ({ name, stats: { ...stats, testFiles }, links });
