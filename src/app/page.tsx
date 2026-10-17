'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Inter_Tight, Newsreader } from 'next/font/google';
import { motion, useReducedMotion } from 'framer-motion';
import CharacterFace from '@/components/CharacterFace';
import SummonLoader from '@/components/SummonLoader';
import { loadWithCharacters, summonRepo } from '@/lib/store';
import { buildRepo, filterFiles, parseGitHubUrl, skipReason, type Entry } from '@/lib/analyze';
import type { ModuleStats } from '@/lib/types';
import { assignColors } from '@/lib/characters';

const sans = Inter_Tight({ subsets: ['latin'] });
const serif = Newsreader({ subsets: ['latin'] });

const stats = (totalLines: number, todoCount: number, biggest: number, maxNesting: number, hasTests: boolean): ModuleStats => ({
  fileCount: 1, totalLines, biggestFile: { path: '', lines: biggest }, todoCount, maxNesting, hasTests,
});
// Sample stats so the orbit shows off every trait: smug, shifty, sweaty, dizzy, chubby, shivering, talking, happy.
const HERO = [
  { name: 'utils', stats: stats(180, 0, 90, 2, true) },
  { name: 'payments', stats: stats(2400, 7, 450, 4, false) },
  { name: 'auth', stats: stats(600, 0, 250, 3, true), mood: 'happy' as const },
  { name: 'legacy', stats: stats(9000, 2, 1200, 9, false) },
  { name: 'config', stats: stats(60, 0, 40, 1, false) },
  { name: 'orders', stats: stats(800, 1, 200, 3, true), mood: 'talking' as const },
  { name: 'api', stats: stats(1500, 3, 380, 5, false) },
  { name: 'tests', stats: stats(1100, 5, 280, 3, true) },
];
const HERO_COLORS = assignColors(HERO.map((f) => ({ id: f.name, name: f.name })));
// Uneven tiles, like prints pinned to a wall: [width, height, face size].
const TILES = [[60, 76, 44], [68, 86, 52], [56, 70, 42]];
const ORBIT_SECONDS = 60;

const DEMO_REPO_URL = 'https://github.com/m1ssmee/quickcart';

export default function Landing() {
  const router = useRouter();
  const reduce = useReducedMotion();
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

  const spin = (turn: number) =>
    reduce ? {} : { animate: { rotate: turn }, transition: { duration: ORBIT_SECONDS, repeat: Infinity, ease: 'linear' as const } };

  return (
    <main
      className={`${sans.className} relative grid min-h-dvh flex-1 place-items-center overflow-hidden bg-white px-4 text-neutral-900 [--r:min(30vh,38vw)]`}
    >
      {loading && <SummonLoader what={loading} />}

      <p className="absolute left-[8%] top-1/2 hidden -translate-y-1/2 text-[15px] tracking-tight xl:block">Every module gets a voice.</p>
      <p className={`${serif.className} absolute right-[8%] top-1/2 hidden -translate-y-1/2 text-[17px] xl:block`}>
        Most of them have complaints.
      </p>

      {/* The regulars orbit the title; each tile counter-rotates so faces stay upright. */}
      <motion.div aria-hidden className="absolute left-1/2 top-1/2" {...spin(360)}>
        {HERO.map((f, i) => {
          const a = (i / HERO.length) * 360;
          const [w, h, face] = TILES[i % TILES.length];
          return (
            <div
              key={f.name}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ transform: `rotate(${a}deg) translateY(calc(-1 * var(--r))) rotate(${-a}deg)` }}
            >
              <motion.div className="grid place-items-center bg-neutral-100" style={{ width: w, height: h }} {...spin(-360)}>
                <CharacterFace name={f.name} stats={f.stats} color={HERO_COLORS[f.name]} mood={f.mood} size={face} />
              </motion.div>
            </div>
          );
        })}
      </motion.div>

      <div className="relative z-10 flex w-60 max-w-[52vw] flex-col items-center gap-4 text-center">
        <h1 className="text-[15px] font-medium tracking-tight">Codebase Tavern</h1>

        <form
          className="flex w-full items-center border-b border-neutral-300 transition-colors focus-within:border-neutral-900"
          onSubmit={(e) => {
            e.preventDefault();
            summon(url);
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste GitHub link"
            aria-label="GitHub repository link"
            aria-invalid={!!error}
            className="min-w-0 flex-1 bg-transparent py-1.5 pl-5 text-center text-sm outline-none placeholder:text-neutral-400"
          />
          <button type="submit" disabled={!url.trim()} aria-label="Summon the codebase" className="w-5 text-sm disabled:opacity-30">
            →
          </button>
        </form>

        <button type="button" onClick={() => fileRef.current?.click()} className="text-sm underline-offset-4 hover:underline">
          Upload from computer
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

        <button
          type="button"
          onClick={() => {
            setUrl(DEMO_REPO_URL);
            summon(DEMO_REPO_URL);
          }}
          className="text-xs text-neutral-400 transition-colors hover:text-neutral-900"
        >
          or try the demo repo
        </button>

        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
            className="flex items-center gap-2 text-left text-[13px] text-red-600"
          >
            <CharacterFace size={22} name="payments" mood="accused" still /> {error}
          </motion.p>
        )}
      </div>

      <Stickman />
    </main>
  );
}

/** Backflips along the bottom edge, left to right, forever. Hidden for reduced motion. */
function Stickman() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute bottom-6 left-0 motion-reduce:hidden"
      animate={{ x: ['-10vw', '105vw'] }}
      transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
    >
      <motion.svg
        width={30}
        height={45}
        viewBox="0 0 40 60"
        fill="none"
        stroke="#171717"
        strokeWidth={3}
        strokeLinecap="round"
        // crouch, jump, rotate backwards (counter-clockwise when facing right), land, absorb
        animate={{ y: [0, 0, -56, 0, 0], rotate: [0, 0, -180, -360, -360], scaleY: [1, 0.8, 1, 0.85, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, times: [0, 0.15, 0.5, 0.85, 1] }}
      >
        <circle cx={20} cy={8} r={6} />
        <path d="M20 14v22 M20 20l-11-9 M20 20l11-9 M20 36l-8 18 M20 36l8 18" />
      </motion.svg>
    </motion.div>
  );
}
