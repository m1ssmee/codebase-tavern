'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Upload } from 'lucide-react';
import CharacterFace from '@/components/CharacterFace';

// TODO: real demo repo URL
const DEMO_REPO_URL = 'https://github.com/your-org/demo-repo';

export default function Landing() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // ponytail: Phase 2 ingests the URL / file; for now everything opens the mock repo.
  const summon = () => router.push('/tavern?mock=1');

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <div className="flex gap-3">
        {(['#f5a524', '#ff5a3c', '#3dd6b5', '#c38bff'] as const).map((c, i) => (
          <motion.div
            key={c}
            animate={{ y: [0, -14, 0], rotate: [0, i % 2 ? 6 : -6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
          >
            <CharacterFace size={64} color={c} mood={(['happy', 'talking', 'accused', 'guilty'] as const)[i]} />
          </motion.div>
        ))}
      </div>

      <div>
        <h1 className="font-display text-6xl leading-none tracking-wide text-amber drop-shadow-[0_6px_0_#000] sm:text-8xl">
          Codebase Tavern
        </h1>
        <p className="mt-5 text-xl text-cream/90 sm:text-2xl">Your code, but it talks back. And it&apos;s rude.</p>
      </div>

      <form
        className="flex w-full max-w-2xl flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          summon();
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          placeholder="https://github.com/owner/repo"
          className="min-w-0 flex-1 rounded-full border-4 border-edge bg-panel px-6 py-4 font-mono text-lg text-cream placeholder:text-muted/60 focus:border-amber focus:outline-none"
        />
        <button
          type="submit"
          className="bounce-hover rounded-full bg-tomato px-8 py-4 font-display text-xl tracking-wide text-cream shadow-[0_6px_0_#7a2414]"
        >
          Summon the Codebase
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-center gap-4 text-muted">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="bounce-hover flex items-center gap-2 rounded-full border-2 border-edge bg-panel px-5 py-2 font-bold text-cream"
        >
          <Upload size={18} /> Upload a file
        </button>
        <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.length && summon()} />
        <span>or</span>
        <button
          type="button"
          onClick={() => {
            setUrl(DEMO_REPO_URL);
            summon();
          }}
          className="font-bold text-amber underline decoration-wavy underline-offset-4 hover:text-cream"
        >
          Try the demo repo
        </button>
      </div>
    </main>
  );
}
