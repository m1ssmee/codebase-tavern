// Line references in what the user types: "line 29", "lines 40-52", "L29", "29-35", "line 29 of auth/session.ts",
// "auth/session.ts:29" and [path:12-30] (the "Explain this" button). Pure; runs in scripts/check.mjs too.
import type { Citation } from './types';

export type LineRef = { path?: string; startLine: number; endLine: number };

const FILE = String.raw`([\w./-]+\.[A-Za-z0-9]{1,8})`;
const PATTERNS: RegExp[] = [
  new RegExp(String.raw`\[${FILE}:(\d+)(?:\s*-\s*(\d+))?\]`), // [path:12-30]
  new RegExp(String.raw`\blines?\s+(\d+)(?:\s*(?:-|–|to|through)\s*(?:line\s+)?(\d+))?(?:\s+(?:of|in)\s+\`?${FILE}\`?)?`, 'i'),
  new RegExp(String.raw`\bL(\d+)(?:\s*-\s*L?(\d+))?\b`),
  new RegExp(String.raw`(?<![\w/.])${FILE}:(\d+)(?:-(\d+))?\b`), // auth/session.ts:29
  /(?<![\w.:/-])(\d{1,5})\s*[-–]\s*(\d{1,5})(?![\w.%])/, // 29-35, last: easy to confuse with other numbers
];

/** The first line reference in a message, or null. Paths are as typed; resolveLineRef finds the real file. */
export function parseLineRef(text: string): LineRef | null {
  for (const [i, re] of PATTERNS.entries()) {
    const m = text.match(re);
    if (!m) continue;
    const [path, a, b] = i === 0 || i === 3 ? [m[1], m[2], m[3]] : i === 1 ? [m[3], m[1], m[2]] : [undefined, m[1], m[2]];
    const s = Number(a), e = b ? Number(b) : s;
    if (!s || e < s || e - s > 400) continue;
    return { ...(path ? { path } : {}), startLine: s, endLine: e };
  }
  return null;
}

/**
 * The citation a reference points at: a named file (exact path, then a path ending in it), else the open file if it
 * belongs to the module asking, else that module's main file. Null when the file or the lines don't exist.
 */
export function resolveLineRef(
  ref: LineRef | null,
  ctx: { files: { path: string; lineCount: number }[]; openFilePath: string | null; ownPaths: string[]; mainFile?: string },
): Citation | null {
  if (!ref) return null;
  const named = ref.path && (ctx.files.find((f) => f.path === ref.path) ?? ctx.files.find((f) => f.path.endsWith('/' + ref.path)));
  if (ref.path && !named) return null;
  const path = named ? named.path : ctx.openFilePath && ctx.ownPaths.includes(ctx.openFilePath) ? ctx.openFilePath : ctx.mainFile;
  const f = ctx.files.find((x) => x.path === path);
  if (!f || ref.startLine > f.lineCount) return null;
  return { path: f.path, startLine: ref.startLine, endLine: Math.min(ref.endLine, f.lineCount) };
}
