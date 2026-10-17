'use client';
import Link from 'next/link';
import { Volume2, VolumeX } from 'lucide-react';
import { useTavern } from '@/lib/store';
import type { ExplainMode, SpiceLevel } from '@/lib/types';

const SPICES: { value: SpiceLevel; label: string }[] = [
  { value: 'clean', label: '😇 Clean' },
  { value: 'spicy', label: '🌶️ Spicy' },
  { value: 'unhinged', label: '💀 Unhinged' },
];
const MODES: ExplainMode[] = ['beginner', 'expert'];

function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full border-2 border-edge bg-panel p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`bounce-hover rounded-full px-3 py-1 text-sm font-bold ${
            value === o.value ? 'bg-amber text-ink shadow-[0_2px_0_#000]' : 'text-muted hover:text-cream'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function TopBar() {
  const { repo, spice, mode, muted, setSpice, setMode, toggleMute } = useTavern();
  return (
    <header className="flex flex-wrap items-center gap-3 border-b-2 border-edge bg-wood/80 px-4 py-2">
      <Link href="/" className="font-display text-2xl tracking-wide text-amber drop-shadow-[0_3px_0_#000]">
        🍺 Codebase Tavern
      </Link>
      {repo && (
        <span className="truncate rounded-full bg-panel px-3 py-1 font-mono text-sm text-muted">{repo.name}</span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <Segmented options={SPICES} value={spice} onChange={setSpice} />
        <Segmented options={MODES.map((m) => ({ value: m, label: m === 'beginner' ? '🐣 Beginner' : '🧠 Expert' }))} value={mode} onChange={setMode} />
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="bounce-hover rounded-full border-2 border-edge bg-panel p-2 text-cream"
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button
          type="button"
          disabled
          title="Coming in Phase 5"
          className="bounce-hover rounded-full bg-tomato px-4 py-2 font-display text-lg tracking-wide text-cream shadow-[0_4px_0_#7a2414] disabled:cursor-not-allowed disabled:opacity-60"
        >
          ⚖️ Summon the Tribunal
        </button>
      </div>
    </header>
  );
}
