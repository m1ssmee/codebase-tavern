'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Upload } from 'lucide-react';
import CharacterFace from '@/components/CharacterFace';
import SummonLoader from '@/components/SummonLoader';
import { loadWithCharacters, summonRepo } from '@/lib/store';
import { buildRepo, filterFiles, parseGitHubUrl, skipReason, type Entry } from '@/lib/analyze';
import type { ModuleStats } from '@/lib/types';
import { assignColors } from '@/lib/characters';

const stats = (totalLines: number, todoCount: number, biggest: number, maxNesting: number, hasTests: boolean): ModuleStats => ({
  fileCount: 1, totalLines, biggestFile: { path: '', lines: biggest }, todoCount, maxNesting, hasTests,
});
// Sample stats so the hero shows off the traits: smug, shifty + sweaty, dizzy + chubby, talking.
const HERO = [
  { name: 'utils', stats: stats(180, 0, 90, 2, true) },
  { name: 'payments', stats: stats(2400, 7, 450, 4, false) },
  { name: 'legacy', stats: stats(9000, 2, 1200, 9, false) },
  { name: 'orders', stats: stats(800, 1, 200, 3, true), mood: 'talking' as const },
];
const HERO_COLORS = assignColors(HERO.map((f) => ({ id: f.name, name: f.name })));

const DEMO_REPO_URL = 'https://github.com/m1ssmee/quickcart';

export default function Landing() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const summon = async (input: string) => {
    setError(null);
    const parsed = parseGitHubUrl(input);
    if (!parsed) return setError("That's not a GitHub link.");
    setLoading(parsed.slug);
    try {
      await summonRepo(input);
      router.push(`/tavern?repo=${parsed.slug}`);
    } catch (e) {
      setError((e as Error).message);
      setLoading(null);
    }
  };

  const upload = async (list: FileList) => {
    setError(null);
    const pre: Record<string, number> = {};
    const entries: Entry[] = [];
    for (const f of Array.from(list)) {
      const why = skipReason(f.name, f.size); // skip before reading, so a 2GB video doesn't freeze the tab
      if (why) pre[why] = (pre[why] ?? 0) + 1;
      else entries.push({ path: f.name, content: await f.text() });
    }
    const { files, skipped } = filterFiles(entries, pre);
    if (!files.length) return setError('None of those files are source code.');
    const name = files.length === 1 ? files[0].path : 'uploaded-files';
    setLoading(name);
    await loadWithCharacters({ ...buildRepo(name, files), skipped });
    router.push('/tavern?upload=1');
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      {loading && <SummonLoader what={loading} />}
      <div className="flex items-end gap-4">
        {HERO.map((f) => (
          <CharacterFace key={f.name} name={f.name} stats={f.stats} color={HERO_COLORS[f.name]} mood={f.mood} size={72} />
        ))}
      </div>

      <div>
        <h1 className="font-display text-6xl leading-none tracking-wide text-amber drop-shadow-[0_6px_0_#000] sm:text-8xl">
          Codebase Tavern
        </h1>
        <p className="mt-5 text-xl text-cream/90 sm:text-2xl">Every module gets a voice. Most of them have complaints.</p>
      </div>

      <div className="w-full max-w-2xl">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            summon(url);
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            aria-invalid={!!error}
            className="min-w-0 flex-1 rounded-full border-4 border-edge bg-panel px-6 py-4 font-mono text-lg text-cream placeholder:text-muted/60 focus:border-amber focus:outline-none"
          />
          <button
            type="submit"
            disabled={!url.trim()}
            className="bounce-hover rounded-full bg-tomato px-8 py-4 font-display text-xl tracking-wide text-cream shadow-[0_6px_0_#7a2414] disabled:opacity-60"
          >
            Summon the Codebase
          </button>
        </form>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
            className="mt-4 flex items-center justify-center gap-2 text-lg font-bold text-tomato"
          >
            <CharacterFace size={28} name="payments" mood="accused" still /> {error}
          </motion.p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 text-muted">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="bounce-hover flex items-center gap-2 rounded-full border-2 border-edge bg-panel px-5 py-2 font-bold text-cream"
        >
          <Upload size={18} /> Upload files
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
            e.target.value = ''; // allow re-picking the same file
          }}
        />
        <span>or</span>
        <button
          type="button"
          onClick={() => {
            setUrl(DEMO_REPO_URL);
            summon(DEMO_REPO_URL);
          }}
          className="font-bold text-amber underline decoration-wavy underline-offset-4 hover:text-cream"
        >
          Try the demo repo
        </button>
      </div>
    </main>
  );
}
