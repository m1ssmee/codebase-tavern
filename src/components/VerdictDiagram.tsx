'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Play, SkipForward, Square } from 'lucide-react';
import { useTavern } from '@/lib/store';
import { participantId, parseSequence, sanitizeDiagram } from '@/lib/diagram';
import { isValidCitation } from '@/lib/citations';
import { blipText, sadTrombone, unlockAudio } from '@/lib/blips';
import Mermaid, { messageGroups } from './Mermaid';

/**
 * The verdict's sequence diagram: how the bug happens, arrow by arrow. Culprits in the guilty colour. Play steps
 * through the messages (~1.2s each), lighting each arrow and its code lines, with the speaker's voice and a sad
 * trombone on the fatal step. Reduced motion: manual steps, no sound. An invalid diagram is dropped silently.
 */
export default function VerdictDiagram({ diagram, culprits }: { diagram: string; culprits: string[] }) {
  const repo = useTavern((s) => s.repo)!;
  const reduced = !!useReducedMotion();
  const code = useMemo(() => sanitizeDiagram(diagram), [diagram]); // saved data too, not only fresh model output
  const messages = useMemo(() => parseSequence(code), [code]);
  const moduleOf = useMemo(() => new Map(repo.modules.map((m) => [participantId(m.id), m.id])), [repo]);
  const [ok, setOk] = useState(true);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const groups = useRef<Element[][]>([]); // per message: its text element(s) and its arrow

  const onReady = (svg: SVGSVGElement | null) => {
    if (!svg) return setOk(false);
    groups.current = messageGroups(svg);
    svg.querySelectorAll<SVGRectElement>('rect.actor').forEach((r) => {
      const id = moduleOf.get(r.getAttribute('name') ?? '');
      if (id && culprits.includes(id)) r.setAttribute('style', 'fill:#ffe1da;stroke:#d9381e;stroke-width:2.5px');
    });
  };

  // Light the current message (and dim the rest), show its code, speak it.
  useEffect(() => {
    groups.current.forEach((els, k) =>
      els.forEach((e) => {
        e.classList.toggle('msg-active', step >= 0 && k === step);
        e.classList.toggle('msg-dim', step >= 0 && k !== step);
      }),
    );
    const msg = messages[step];
    if (!msg) return;
    groups.current[step]?.[0]?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    const s = useTavern.getState();
    if (msg.cite && isValidCitation(msg.cite, repo.files)) {
      s.highlightCitation(msg.cite);
      s.setView('code');
    }
    if (reduced) return;
    const id = moduleOf.get(msg.from);
    blipText(msg.text, (id && s.characters[id]?.voicePitch) || 1, s.muted);
    if (msg.fatal && !messages[step - 1]?.fatal) sadTrombone(s.muted);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps -- one run per step

  useEffect(() => {
    if (!playing) return;
    const done = step >= messages.length - 1;
    const t = setTimeout(() => (done ? setPlaying(false) : setStep((x) => x + 1)), 1200);
    return () => clearTimeout(t);
  }, [playing, step, messages.length]);

  if (!ok || !code || !messages.length) return null;
  const btn = 'flex items-center gap-1 rounded-full border border-edge bg-panel px-2.5 py-0.5 text-xs text-cream hover:border-amber';
  return (
    <div className="rounded-xl border border-edge bg-white p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-muted">How it happened</span>
        {step >= 0 && (
          <span className="truncate text-xs text-muted">
            {step + 1}/{messages.length}
            {messages[step]?.fatal ? ' · where it all went wrong' : ''}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {reduced ? (
            <button type="button" className={btn} onClick={() => setStep((x) => (x + 1 >= messages.length ? -1 : x + 1))}>
              <SkipForward size={12} /> {step < 0 ? 'Step through' : step + 1 >= messages.length ? 'Reset' : 'Next step'}
            </button>
          ) : playing ? (
            <button type="button" className={btn} onClick={() => setPlaying(false)}>
              <Square size={12} /> Stop
            </button>
          ) : (
            <button
              type="button"
              className={btn}
              onClick={() => {
                unlockAudio();
                setStep(0);
                setPlaying(true);
              }}
            >
              <Play size={12} /> Play
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <Mermaid
          code={code}
          onReady={onReady}
          validCite={(c) => isValidCitation(c, repo.files)}
          onCite={(c) => {
            useTavern.getState().highlightCitation(c);
            useTavern.getState().setView('code');
          }}
          className="min-w-[420px] [&_svg]:mx-auto"
        />
      </div>
    </div>
  );
}
