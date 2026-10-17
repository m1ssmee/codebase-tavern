// Pure character helpers, shared by /api/characters (server) and the client. Type-only imports so
// `node scripts/check.mjs` can run it directly.
import type { Character, Module, ModuleStats } from './types';

/** What /api/characters returns per module (colour is assigned client-side). */
export type RawCharacter = Pick<Character, 'moduleId' | 'personality' | 'catchphrase' | 'greeting' | 'voicePitch'> & { title: string };

// 8 colours that read on the dark tavern background.
export const PALETTE = ['#f5a524', '#ff5a3c', '#3dd6b5', '#c38bff', '#5ab0ff', '#ff7eb6', '#9be15d', '#ffd166'];

/** FNV-1a; stable across server and client. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Colour from the name hash, probing to the next free colour so modules in one repo never share one. */
export function assignColors(modules: Pick<Module, 'id' | 'name'>[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const m of modules) {
    const h = hash(m.name);
    let k = 0;
    while (used.has(PALETTE[(h + k) % PALETTE.length]) && k < PALETTE.length) k++;
    out[m.id] = PALETTE[(h + k) % PALETTE.length];
    used.add(out[m.id]);
  }
  return out;
}

/** 0 (≈10 lines) … 1 (≈20k lines), log scale. */
export const sizeOf = (lines = 100) => Math.min(1, Math.max(0, (Math.log10(Math.max(lines, 1)) - 1) / 3.3));

export function faceTraits(s?: ModuleStats) {
  return {
    width: sizeOf(s?.totalLines),
    shifty: (s?.todoCount ?? 0) >= 5,
    sweaty: (s?.biggestFile.lines ?? 0) > 300,
    dizzy: (s?.maxNesting ?? 0) >= 6,
    shivers: s ? !s.hasTests : false,
    smug: !!s && s.totalLines < 300 && s.todoCount === 0 && s.hasTests,
  };
}

const plural = (n: number, word: string) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** "412 lines · 3 files · 7 TODOs · no tests" */
export const statsLine = (s: ModuleStats) =>
  [plural(s.totalLines, 'line'), plural(s.fileCount, 'file'), plural(s.todoCount, 'TODO'), s.hasTests ? 'has tests' : 'no tests'].join(' · ');

/** Template character from stats alone. Used when Gemini fails, times out or skips a module. */
export function fallbackCharacter(m: Module): RawCharacter {
  const s = m.stats;
  const big = `${baseName(s.biggestFile.path)} (${plural(s.biggestFile.lines, 'line')})`;
  const [title, catchphrase] =
    s.todoCount >= 5
      ? ['the procrastinator', `${s.todoCount} TODOs. None of them are getting done today.`]
      : /^(tests?|spec|__tests__)$/i.test(m.name)
        ? ['the inspector', `${plural(s.fileCount, 'test file')}. Somebody has to check the others.`]
        : /^docs?$/i.test(m.name)
          ? ['the archivist', `${plural(s.totalLines, 'line')} of documentation. Some of it is current.`]
          : s.maxNesting >= 6
            ? ['the labyrinth', `${s.maxNesting} levels of nesting. Bring a map.`]
            : s.biggestFile.lines > 300
              ? ['the hoarder', `${baseName(s.biggestFile.path)} is ${plural(s.biggestFile.lines, 'line')}. I keep everything.`]
              : !s.hasTests
                ? ['the optimist', `${plural(s.totalLines, 'line')}, no tests. It works on my machine.`]
                : ['the regular', `${plural(s.totalLines, 'line')}, has tests. Nothing to report.`];
  return {
    moduleId: m.id,
    title: `${m.name}, ${title}`,
    personality: `Keeps ${plural(s.totalLines, 'line')} across ${plural(s.fileCount, 'file')}; the biggest is ${big}.`,
    catchphrase,
    greeting: `I'm ${m.name}. ${plural(s.totalLines, 'line')}, ${plural(s.fileCount, 'file')}, ${plural(s.todoCount, 'TODO')}, ${s.hasTests ? 'some tests' : 'no tests'}.`,
    voicePitch: Math.round((1.8 - 1.2 * sizeOf(s.totalLines)) * 100) / 100, // bigger module, deeper voice
  };
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Validate model output per module; anything missing or malformed falls back to the template. */
export function toRaw(modules: Module[], items: unknown): RawCharacter[] {
  const byId = new Map((Array.isArray(items) ? items : []).map((c) => [c?.moduleId, c]));
  return modules.map((m) => {
    const c = byId.get(m.id);
    const fb = fallbackCharacter(m);
    const title = str(c?.title, 60);
    const personality = str(c?.personality, 240);
    const catchphrase = str(c?.catchphrase, 120);
    const greeting = str(c?.greeting, 400);
    if (!title || !personality || !catchphrase || !greeting) return fb;
    const pitch = Number(c.voicePitch);
    return {
      moduleId: m.id,
      title,
      personality,
      catchphrase: catchphrase.split(/\s+/).slice(0, 12).join(' '),
      greeting,
      voicePitch: Number.isFinite(pitch) ? Math.min(1.8, Math.max(0.6, pitch)) : fb.voicePitch,
    };
  });
}

export function toCharacters(modules: Module[], raw: RawCharacter[]): Character[] {
  const colors = assignColors(modules);
  return raw.map(({ title, ...r }) => ({ ...r, name: title, color: colors[r.moduleId] ?? PALETTE[0] }));
}
