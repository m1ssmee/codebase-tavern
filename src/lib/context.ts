// Picks what code a character sees for one chat turn. Pure; runs on the client so we upload ~120KB,
// not the whole module. Type-only imports so `node scripts/check.mjs` can run it directly.
import type { Module, RepoFile } from './types';

export const CONTEXT_BUDGET = 120_000;

export type ContextFile = { path: string; content: string; truncated: boolean };
export type ChatContext = { files: ContextFile[]; omitted: string[]; allPaths: string[] };

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1).toLowerCase();
const stem = (p: string) => base(p).replace(/\.[^.]+$/, '');

/** Open file → files named in the question → README/index/main → the rest, smallest first. */
export function pickContext(mod: Module, all: RepoFile[], openFilePath: string | null, question: string, budget = CONTEXT_BUDGET): ChatContext {
  const own = all.filter((f) => mod.filePaths.includes(f.path));
  const q = question.toLowerCase();
  const rank = (f: RepoFile) =>
    f.path === openFilePath ? 0 : q.includes(base(f.path)) || (stem(f.path).length > 3 && q.includes(stem(f.path))) ? 1 : /^(readme|index|main)(\.|$)/.test(base(f.path)) ? 2 : 3;
  const ordered = [...own].sort((a, b) => rank(a) - rank(b) || a.content.length - b.content.length);

  const files: ContextFile[] = [];
  const omitted: string[] = [];
  let left = budget;
  for (const f of ordered) {
    if (f.content.length <= left) {
      files.push({ path: f.path, content: f.content, truncated: false });
      left -= f.content.length;
    } else if (left > 4000) {
      // Cut on a line boundary so line numbers stay true.
      const cut = f.content.slice(0, left);
      files.push({ path: f.path, content: cut.slice(0, cut.lastIndexOf('\n') + 1), truncated: true });
      left = 0;
    } else {
      omitted.push(f.path);
    }
  }
  return { files, omitted, allPaths: mod.filePaths };
}
