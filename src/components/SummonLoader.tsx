'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import CharacterFace from './CharacterFace';
import { PALETTE } from '@/lib/characters';

const LINES = [
  'Skipping node_modules',
  'Counting your TODOs',
  'Reading files nobody documented',
  'Measuring nesting depth',
  'Finding the biggest file',
  'Assigning personalities',
];

export default function SummonLoader({ what }: { what?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % LINES.length), 1200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/95 px-6 text-center backdrop-blur">
      <div>
        <div className="mb-8 flex justify-center gap-4">
          {['orders', 'payments', 'utils'].map((n, k) => (
            <CharacterFace key={n} name={n} color={PALETTE[k * 2]} size={72} mood={k === 1 ? 'talking' : 'happy'} />
          ))}
        </div>
        <p className="font-display text-4xl tracking-wide text-amber drop-shadow-[0_4px_0_#000]">Summoning the codebase…</p>
        {what && <p className="mt-2 font-mono text-muted">{what}</p>}
        <div className="mt-6 h-8">
          <AnimatePresence mode="wait">
            <motion.p
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-xl text-cream"
            >
              {LINES[i]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
