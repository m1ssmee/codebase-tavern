'use client';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SendHorizontal } from 'lucide-react';
import { useTavern } from '@/lib/store';
import { extractCitations, isValidCitation } from '@/lib/citations';
import { PALETTE, statsLine } from '@/lib/characters';
import { pickContext } from '@/lib/context';
import { graphFacts } from '@/lib/graph';
import { blipText, unlockAudio } from '@/lib/blips';
import CharacterFace from './CharacterFace';
import Rich from './Rich';

const BUSY = 'Gemini is rate-limiting us. Try again in a minute.';
const UNAVAILABLE = 'The AI is unavailable right now. Try again in a minute.'; // server sends 503 when a key is missing

/**
 * Sends one chat turn to the selected character and streams the reply in. Reads everything from the
 * store, so the code panel's "Explain this" button can call it too.
 */
export async function sendChat(text: string) {
  text = text.trim();
  const s = useTavern.getState();
  const { repo, characters, openFilePath, spice, mode } = s;
  const mod = repo?.modules.find((m) => m.id === s.selectedModuleId);
  if (!text || s.isLoading || !repo || !mod) return;
  const char = characters[mod.id];
  const name = char?.name ?? mod.name;
  unlockAudio();
  const history = (s.chats[mod.id] ?? []).filter((m) => m.role !== 'system').slice(-7);
  const id = crypto.randomUUID();
  s.addMessage(mod.id, { id: crypto.randomUUID(), role: 'user', text, citations: [] });
  s.addMessage(mod.id, { id, role: 'character', characterId: mod.id, text: '', citations: [] });
  s.setLoading(true);
  s.setMood(mod.id, 'talking');

  const ctx = pickContext(mod, repo.files, openFilePath, text);
  const nameOf = (mid: string) => repo.modules.find((m) => m.id === mid)?.name ?? mid;
  const facts = s.graph ? graphFacts(s.graph, mod.id, repo.files, nameOf) : { dependents: [], dependencies: [] };
  let full = '';
  let highlighted = false;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoName: repo.name,
        moduleId: mod.id,
        character: { title: name, personality: char?.personality, catchphrase: char?.catchphrase },
        openFilePath,
        ...ctx,
        ...facts,
        others: repo.modules.filter((m) => m.id !== mod.id).map((m) => ({ title: characters[m.id]?.name ?? m.name, path: m.path })),
        spice,
        mode,
        messages: [...history, { role: 'user', text }].map((m) => ({ role: m.role, text: m.text })),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`chat ${res.status}`, { cause: res.status });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      full += value;
      useTavern.getState().appendToMessage(mod.id, id, value);
      blipText(value, char?.voicePitch ?? 1, useTavern.getState().muted);
      // Light up the code the moment the first valid citation completes, while it's still talking.
      if (!highlighted) {
        const first = extractCitations(full).find((c) => isValidCitation(c, repo.files));
        if (first) {
          useTavern.getState().highlightCitation(first);
          highlighted = true;
        }
      }
    }
    if (!full.trim()) throw new Error('empty reply');
    s.updateMessage(mod.id, id, { citations: extractCitations(full).filter((c) => isValidCitation(c, repo.files)) });
  } catch (err) {
    console.warn('[chat]', err);
    s.updateMessage(mod.id, id, { role: 'system', text: (err as Error).cause === 503 ? UNAVAILABLE : BUSY });
  } finally {
    s.setLoading(false);
    s.setMood(mod.id, 'idle');
  }
}

export default function ChatPanel() {
  const { repo, characters, moods, selectedModuleId, openFilePath, chats, isLoading } = useTavern();
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const mod = repo?.modules.find((m) => m.id === selectedModuleId);
  const char = mod ? characters[mod.id] : undefined;
  const messages = mod ? (chats[mod.id] ?? []) : [];
  const name = char?.name ?? mod?.name ?? '';
  const lastText = messages.at(-1)?.text.length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' }); // braces: Chrome's scrollIntoView now returns a Promise
  }, [messages.length, lastText, isLoading]);

  if (!mod || !repo) {
    return (
      <div className="grid h-full place-items-center bg-panel p-6 text-center">
        <div>
          <div className="mb-4 flex justify-center gap-2">
            {(['happy', 'accused', 'idle'] as const).map((m, i) => (
              <CharacterFace key={m} name={['orders', 'payments', 'utils'][i]} color={PALETTE[i * 2]} mood={m} size={44} />
            ))}
          </div>
          <p className="font-display text-xl italic">Pick a module.</p>
        </div>
      </div>
    );
  }

  const send = (text: string) => {
    if (!text.trim() || useTavern.getState().isLoading) return;
    setInput('');
    void sendChat(text);
  };

  const openName = openFilePath?.split('/').pop();
  const QUICK = [
    { label: 'Explain yourself', text: 'Explain yourself. What do you do, and which files matter most?' },
    { label: "What's your worst part?", text: "What's your worst part? Point at the exact lines." },
    { label: 'Who depends on you?', text: 'Who depends on you? Which other files import or use you?' },
    { label: 'Roast this file', text: `Roast ${openFilePath}. Be specific.`, disabled: !openFilePath, title: openName ? `Roast ${openName}` : 'Open a file first' },
  ];

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-3 border-b border-edge p-4">
        <CharacterFace size={96} name={mod.name} stats={mod.stats} color={char?.color} mood={moods[mod.id]} />
        <div className="min-w-0">
          <div className="font-display text-xl leading-tight">
            {name}
          </div>
          {char && <div className="mt-0.5 text-sm text-cream/80 italic">&ldquo;{char.catchphrase}&rdquo;</div>}
          <div className="mt-1 font-mono text-xs text-muted">{statsLine(mod.stats)}</div>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {messages.length === 0 && <p className="text-center text-sm text-muted">Ask {name} about their code.</p>}
        {messages.map((m) =>
          m.role === 'system' ? (
            <p key={m.id} className="text-center text-sm text-tomato">
              {m.text}
            </p>
          ) : (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}
            >
              {m.role === 'character' && <CharacterFace size={28} name={mod.name} stats={mod.stats} color={char?.color} still />}
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 leading-relaxed ${m.role === 'user' ? 'whitespace-pre-wrap' : ''} ${
                  m.role === 'user' ? 'rounded-br-sm bg-amber text-ink' : 'rounded-bl-sm border border-edge bg-wood text-cream'
                }`}
              >
                {m.role === 'user'
                  ? m.text
                  : m.text
                    ? <Rich text={m.text} files={repo.files} />
                    : '…'}
              </div>
            </motion.div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-edge px-3 pt-2">
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={isLoading || q.disabled}
            title={q.title}
            onClick={() => send(q.text)}
            className="rounded-full border border-edge px-2.5 py-1 text-xs text-cream/80 transition-colors hover:border-amber hover:text-cream disabled:opacity-40"
          >
            {q.label}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2 p-3 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask ${name}…`}
          className="min-w-0 flex-1 rounded-full border border-edge bg-ink px-4 py-2 text-cream placeholder:text-muted/60 focus:border-amber focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          aria-label="Send"
          className="bounce-hover rounded-full bg-amber p-3 text-ink disabled:opacity-50"
        >
          <SendHorizontal size={18} />
        </button>
      </form>
    </div>
  );
}
