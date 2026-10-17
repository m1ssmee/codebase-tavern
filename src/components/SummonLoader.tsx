'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import CharacterFace from './CharacterFace';
import Stickman from './Stickman';
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
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-ink px-6 text-center">
      <div>
        <div className="mb-8 flex justify-center gap-5">
          {['orders', 'payments', 'utils'].map((n, k) => (
            <CharacterFace key={n} name={n} color={PALETTE[k * 2]} size={56} mood={k === 1 ? 'talking' : 'happy'} />
          ))}
        </div>
        <p className="text-[15px] font-medium tracking-tight">Summoning the codebase…</p>
        {what && <p className="mt-1 font-mono text-xs text-muted">{what}</p>}
        <div className="mt-6 h-7">
          <AnimatePresence mode="wait">
            <motion.p
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="font-display text-lg text-cream/70 italic"
            >
              {LINES[i]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
      <Stickman />
    </div>
  );
}
