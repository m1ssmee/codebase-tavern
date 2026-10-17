'use client';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SendHorizontal } from 'lucide-react';
import { useTavern } from '@/lib/store';
import { extractCitations, parseCitations } from '@/lib/citations';
import type { Module, RepoFile } from '@/lib/types';
import CharacterFace from './CharacterFace';
import CitationChip from './CitationChip';
import { PALETTE, statsLine } from '@/lib/characters';

// ponytail: Phase 4 replaces this with a streamed Gemini reply.
function mockReply(mod: Module, files: RepoFile[], turn: number): string {
  const own = files.filter((f) => mod.filePaths.includes(f.path));
  const f = own[turn % own.length];
  const lines = f.content.split('\n');
  const hit = lines.findIndex((l) => /\b(TODO|FIXME|HACK)\b/.test(l));
  if (hit < 0) return `${f.path} is ${lines.length} lines with no TODOs. Start at [${f.path}:1-${Math.min(lines.length, 3)}].`;
  const tag = lines[hit].match(/\b(TODO|FIXME|HACK)\b/)![1];
  const cite = `[${f.path}:${Math.max(1, hit)}-${Math.min(lines.length, hit + 2)}]`;
  return `${f.path} is ${lines.length} lines. The part worth reading is ${cite}: a ${tag} nobody has come back for.`;
}

export default function ChatPanel() {
  const { repo, characters, moods, selectedModuleId, chats, isLoading, addMessage, setMood, setLoading } = useTavern();
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const mod = repo?.modules.find((m) => m.id === selectedModuleId);
  const char = mod ? characters[mod.id] : undefined;
  const messages = mod ? (chats[mod.id] ?? []) : [];
  const name = char?.name ?? mod?.name ?? '';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' }); // braces: Chrome's scrollIntoView now returns a Promise
  }, [messages.length, isLoading]);

  if (!mod || !repo) {
    return (
      <div className="grid h-full place-items-center bg-panel p-6 text-center">
        <div>
          <div className="mb-4 flex justify-center gap-2">
            {(['happy', 'accused', 'idle'] as const).map((m, i) => (
              <CharacterFace key={m} name={['orders', 'payments', 'utils'][i]} color={PALETTE[i * 2]} mood={m} size={44} />
            ))}
          </div>
          <p className="font-display text-2xl tracking-wide text-amber">Pick a module.</p>
        </div>
      </div>
    );
  }

  const send = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    addMessage(mod.id, { id: crypto.randomUUID(), role: 'user', text, citations: [] });
    setInput('');
    setLoading(true);
    setMood(mod.id, 'talking');
    const turn = messages.filter((m) => m.role === 'character').length;
    setTimeout(() => {
      const reply = mockReply(mod, repo.files, turn);
      addMessage(mod.id, { id: crypto.randomUUID(), role: 'character', characterId: mod.id, text: reply, citations: extractCitations(reply) });
      setLoading(false);
      setMood(mod.id, 'idle');
    }, 600);
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-3 border-b-2 border-edge bg-wood/60 p-3">
        <CharacterFace size={96} name={mod.name} stats={mod.stats} color={char?.color} mood={moods[mod.id]} />
        <div className="min-w-0">
          <div className="font-display text-xl leading-tight tracking-wide" style={{ color: char?.color }}>
            {name}
          </div>
          {char && <div className="mt-0.5 text-sm text-cream/80 italic">&ldquo;{char.catchphrase}&rdquo;</div>}
          <div className="mt-1 font-mono text-xs text-muted">{statsLine(mod.stats)}</div>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted">Ask {name} about their code.</p>
        )}
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}
          >
            {m.role === 'character' && <CharacterFace size={28} name={mod.name} stats={mod.stats} color={char?.color} still />}
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 leading-relaxed whitespace-pre-wrap ${
                m.role === 'user' ? 'rounded-br-sm bg-amber text-ink' : 'rounded-bl-sm border border-edge bg-wood text-cream'
              }`}
            >
              {m.role === 'user'
                ? m.text
                : parseCitations(m.text).map((seg, i) => (typeof seg === 'string' ? seg : <CitationChip key={i} citation={seg} />))}
            </div>
          </motion.div>
        ))}
        {isLoading && <div className="text-sm text-muted italic">{name} is typing…</div>}
        <div ref={endRef} />
      </div>

      <form
        className="flex gap-2 border-t-2 border-edge p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${name}…`}
          className="min-w-0 flex-1 rounded-full border-2 border-edge bg-ink px-4 py-2 text-cream placeholder:text-muted/60 focus:border-amber focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          aria-label="Send"
          className="bounce-hover rounded-full bg-amber p-3 text-ink shadow-[0_3px_0_#8a5a06] disabled:opacity-50"
        >
          <SendHorizontal size={18} />
        </button>
      </form>
    </div>
  );
}
