'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Gavel, Volume2, VolumeX } from 'lucide-react';
import { useTavern } from '@/lib/store';
import type { ExplainMode, SpiceLevel } from '@/lib/types';

// clean is deliberately missing: it's a hidden mode toggled with Ctrl+Shift+C.
const SPICES: { value: SpiceLevel; label: string }[] = [
  { value: 'unhinged', label: 'Unhinged' },
  { value: 'feral', label: 'Feral' },
  { value: 'nuclear', label: 'Nuclear' },
];
const MODES: ExplainMode[] = ['beginner', 'expert'];

function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full border border-edge bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1 text-sm transition-colors ${
            value === o.value ? 'bg-amber text-ink' : 'text-muted hover:text-cream'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function TopBar() {
  const { repo, spice, mode, muted, tribunal, setSpice, setMode, toggleMute, setTribunal } = useTavern();
  const before = useRef<SpiceLevel>('unhinged');

  // Hidden clean mode: Ctrl+Shift+C toggles it, restoring whatever level was active before.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c')) return;
      e.preventDefault();
      const s = useTavern.getState();
      if (s.spice === 'clean') s.setSpice(before.current);
      else {
        before.current = s.spice;
        s.setSpice('clean');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-edge bg-panel px-4 py-2">
      <Link href="/" className="text-[15px] font-medium tracking-tight">
        Codebase Tavern
      </Link>
      {repo && (
        <span className="truncate rounded-full bg-wood px-2.5 py-0.5 font-mono text-xs text-muted">{repo.name}</span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {spice === 'clean' && (
          <span title="Hidden clean mode (Ctrl+Shift+C)" className="rounded-full border border-green-600/40 bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700">
            clean
          </span>
        )}
        <Segmented options={SPICES} value={spice} onChange={setSpice} />
        <Segmented options={MODES.map((m) => ({ value: m, label: m === 'beginner' ? 'Beginner' : 'Expert' }))} value={mode} onChange={setMode} />
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="rounded-full border border-edge bg-panel p-2 text-cream transition-colors hover:bg-wood"
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button
          type="button"
          disabled={!repo || tribunal}
          onClick={() => setTribunal(true)}
          className="bounce-hover flex items-center gap-1.5 rounded-full bg-tomato px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Gavel size={15} /> Summon the Tribunal
        </button>
      </div>
    </header>
  );
}
