'use client';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTavern } from '@/lib/store';
import { blipText } from '@/lib/blips';
import CharacterFace from './CharacterFace';

/** Every 15-25s one character floats up from the bottom-left of the code panel and says a gossip line for 5s. */
export default function Gossip() {
  const repo = useTavern((s) => s.repo);
  const characters = useTavern((s) => s.characters);
  const [shown, setShown] = useState<{ id: string; line: string; key: number } | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reduced = useReducedMotion();

  useEffect(() => {
    let next: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = useTavern.getState();
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      const cast = Object.values(s.characters).filter((c) => c.gossip?.length);
      // Paused during the Tribunal, while typing, while a reply streams, and in background tabs.
      if (!s.tribunal && !typing && !s.isLoading && cast.length && document.visibilityState === 'visible') {
        const c = cast[Math.floor(Math.random() * cast.length)];
        const line = c.gossip[Math.floor(Math.random() * c.gossip.length)];
        setShown({ id: c.moduleId, line, key: Date.now() });
        blipText(line, c.voicePitch, s.muted);
        hide.current = setTimeout(() => setShown(null), 5000);
      }
      next = setTimeout(tick, 15_000 + Math.random() * 10_000);
    };
    next = setTimeout(tick, 15_000 + Math.random() * 10_000);
    return () => {
      clearTimeout(next);
      clearTimeout(hide.current);
    };
  }, []);

  const mod = shown && repo?.modules.find((m) => m.id === shown.id);
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20">
      <AnimatePresence>
        {shown && mod && (
          <motion.div
            key={shown.key}
            initial={{ opacity: 0, y: reduced ? 0 : 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -40 }}
            transition={{ type: 'spring', stiffness: 140, damping: 16 }}
            className="flex items-end gap-2"
          >
            <CharacterFace size={48} name={mod.name} stats={mod.stats} color={characters[mod.id]?.color} mood="talking" />
            <div className="mb-6 max-w-xs rounded-2xl rounded-bl-sm border border-edge bg-wood/95 px-3 py-2 text-sm text-cream shadow-lg">
              <div className="text-xs font-bold" style={{ color: characters[mod.id]?.color }}>
                {characters[mod.id]?.name ?? mod.name}
              </div>
              {shown.line}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
