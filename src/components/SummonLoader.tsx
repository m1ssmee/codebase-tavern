'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import CharacterFace from './CharacterFace';

const LINES = [
  'Bribing the modules to move in',
  "Waking up the utils folder (it's hungover)",
  'Counting your TODOs… this might take a while',
  'Untangling your spaghetti',
  'Throwing node_modules out of the tavern',
  'Asking the README if it is still accurate (it is not)',
  'Pouring chai for the senior devs',
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
          {['#f5a524', '#ff5a3c', '#3dd6b5'].map((c, k) => (
            <motion.div key={c} animate={{ y: [0, -24, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: k * 0.15 }}>
              <CharacterFace size={72} color={c} mood={k === 1 ? 'talking' : 'happy'} />
            </motion.div>
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
