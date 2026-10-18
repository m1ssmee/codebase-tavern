'use client';
// The thinking cue's words (no AI): the waiting character's line for this point in the wait, and three pulsing dots.
// Shown in its speech bubble on the stage, the Neighbourhood and the Blueprint, on its portrait in the panels, and in
// the transcript until the answer starts. The wait itself is useStage's `thinking` (think / thinkWhile in stage/store).
import { useEffect, useState } from 'react';
import { useTavern } from '@/lib/store';
import { hash } from '@/lib/characters';
import { thinkingLine } from '@/lib/thinkingLines';
import Rich from './Rich';
import { archetypeOf, ModuleFace } from './Portrait';
import { useStage, type Bubble } from './stage/store';

export const useThinking = (id: string) => useStage((s) => !!s.thinking[id]);

export function ThinkingText({ id, className = '' }: { id: string; className?: string }) {
  const since = useStage((s) => s.thinking[id]?.since);
  const spice = useTavern((s) => s.spice);
  const mods = useTavern((s) => s.repo?.modules);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const arch = id === 'judge' || id === 'landlord' ? id : mods ? archetypeOf(mods, id) : 'clerk';
  return (
    <span className={className} role="status">
      {thinkingLine(arch, spice, now - since, hash(id + since))}
      <span className="think-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/** A character's speech bubble off the stage (the Neighbourhood, the Blueprint): its live answer, a line, or its cue. */
export function SpeechBubble({ id, b }: { id: string; b?: Bubble }) {
  const live = useTavern((s) => (b?.msg ? s.chats[b.msg.mod]?.find((x) => x.id === b.msg!.id) : undefined));
  const files = useTavern((s) => s.repo?.files ?? []);
  const name = useTavern((s) => (id === 'judge' ? 'The Judge' : id === 'landlord' ? 'The Landlord' : (s.characters[id]?.name ?? id)));
  const thinking = useThinking(id);
  if (live?.role === 'system') return null;
  const body = (live ? live.text : (b?.text ?? '')).replace(/\[[^\]\n]*$/, '');
  const short = body.length > 280 ? body.slice(0, 280).replace(/\s+\S*$/, '') + '…' : body;
  return (
    <div className="pointer-events-auto w-72 -translate-y-1/2 rounded-2xl rounded-bl-sm border-2 border-cream bg-white px-3 py-2 text-xs leading-snug text-cream shadow-[3px_3px_0_rgba(0,0,0,0.85)]">
      <div className="text-[11px] font-semibold text-muted">{name}</div>
      {short && <Rich text={short} files={files} />}
      {thinking ? <ThinkingText id={id} className="block text-muted italic" /> : !short && <span className="text-muted">…</span>}
    </div>
  );
}

/** A panel's cue: the waiting character's portrait with its line in a bubble (the Tribunal's Judge, the roast's Landlord). */
export function Cue({ id, size = 40 }: { id: string; size?: number }) {
  if (!useThinking(id)) return null;
  return (
    <div className="flex items-center gap-2">
      <ModuleFace id={id} size={size} mood="talking" />
      <div className="rounded-2xl rounded-bl-sm border border-edge bg-wood px-3 py-1.5 text-sm text-cream">
        <ThinkingText id={id} className="italic" />
      </div>
    </div>
  );
}
