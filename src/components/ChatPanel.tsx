'use client';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SendHorizontal } from 'lucide-react';
import { useTavern } from '@/lib/store';
import { extractCitations, parseCitations } from '@/lib/citations';
import type { Module, RepoFile } from '@/lib/types';
import CharacterFace from './CharacterFace';
import CitationChip from './CitationChip';

// ponytail: Phase 4 replaces this with a streamed Gemini reply.
function mockReply(mod: Module, files: RepoFile[], name: string, turn: number): string {
  const own = files.filter((f) => mod.filePaths.includes(f.path));
  const f = own[turn % own.length];
  const lines = f.content.split('\n');
  const hit = lines.findIndex((l) => /\b(TODO|FIXME|HACK)\b/.test(l));
  const line = hit >= 0 ? hit + 1 : 1;
  const start = Math.max(1, line - 1);
  return `Arre sun na! Main ${name} hoon, ${mod.name} ka maalik. Yeh dekh, mera sabse sharam-naak raaz yahan pada hai: [${f.path}:${start}-${Math.min(lines.length, line + 1)}]. Kisi ko mat batana, warna Tribunal mein ghaseet lenge mujhe.`;
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
            {(['happy', 'accused', 'guilty'] as const).map((m, i) => (
              <CharacterFace key={m} mood={m} size={44} color={['#f5a524', '#ff5a3c', '#3dd6b5'][i]} />
            ))}
          </div>
          <p className="font-display text-2xl tracking-wide text-amber">Pick a module.</p>
          <p className="text-muted">They&apos;re all a little unhinged.</p>
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
      const reply = mockReply(mod, repo.files, name, turn);
      addMessage(mod.id, { id: crypto.randomUUID(), role: 'character', characterId: mod.id, text: reply, citations: extractCitations(reply) });
      setLoading(false);
      setMood(mod.id, 'idle');
    }, 600);
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-3 border-b-2 border-edge bg-wood/60 p-3">
        <CharacterFace size={64} color={char?.color} mood={moods[mod.id]} />
        <div className="min-w-0">
          <div className="truncate font-display text-xl tracking-wide" style={{ color: char?.color }}>
            {name}
          </div>
          {char && <div className="text-sm text-muted italic">&ldquo;{char.catchphrase}&rdquo;</div>}
          <div className="font-mono text-xs text-muted/70">{mod.path}/</div>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted">Ask {name} anything about their code. They will overshare.</p>
        )}
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}
          >
            {m.role === 'character' && <CharacterFace size={28} color={char?.color} />}
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
        {isLoading && <div className="text-sm text-muted italic">{name} is typing something rude…</div>}
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
