'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { SendHorizontal } from 'lucide-react';
import { useTavern } from '@/lib/store';
import { extractCitations, isValidCitation } from '@/lib/citations';
import { PALETTE, statsLine } from '@/lib/characters';
import { CHAT_BUDGET, FOCUS_BUDGET, pickContext } from '@/lib/context';
import { graphFacts, type Graph } from '@/lib/graph';
import { blipText, unlockAudio } from '@/lib/blips';
import { entryFile } from '@/lib/analyze';
import { parseLineRef, resolveLineRef } from '@/lib/lines';
import { deflection, sulkyOpener } from '@/lib/stageLines';
import { BUBBLE_SEP } from '@/lib/bubbleMarker';
import type { Citation } from '@/lib/types';
import demoLines from '@/data/demoLines.json';
import CharacterFace from './CharacterFace';
import Rich from './Rich';
import { useCast3D } from './cast/settings';
import { grudgeOf, recentBubbles, think, useStage } from './stage/store';
import { ThinkingText } from './Thinking';
import { stageDo } from './stage/api';
import { archetypeOf, ModuleFace } from './Portrait';

// three.js loads only when the 3D cast is on.
const CharacterStage = dynamic(() => import('./cast/Character3D').then((m) => m.CharacterStage), { ssr: false, loading: () => <div className="h-24 w-24 shrink-0" /> });

const BUSY = 'Gemini is rate-limiting us. Try again in a minute.';
const UNAVAILABLE = 'The AI is unavailable right now. Try again in a minute.'; // server sends 503 when a key is missing

type Saved = { moduleId: string; path: string; startLine: number; endLine: number; text: string; bubble?: string; bubbleClean?: string };
const SAVED_LINES = (demoLines as { items: Saved[] }).items;

/** How the speaker relates to another module's code, from the import graph ("You import it 2 times"). */
function relation(g: Graph | null, me: string, owner: string): string {
  const out = (g?.edges ?? []).filter((e) => (e.from === me && e.to === owner) || (e.from === owner && e.to === me));
  return out
    .map((e) => (e.from === me ? `you ${e.kind === 'calls' ? 'call it over the network' : 'import it'} ${e.weight === 1 ? 'once' : `${e.weight} times`}` : `it ${e.kind === 'calls' ? 'calls you over the network' : 'imports you'} ${e.weight === 1 ? 'once' : `${e.weight} times`}`))
    .join('; ');
}

/** The demo route makes no AI calls: a saved answer for a saved line, else one in-character "live AI is off" line. */
async function demoReply(modId: string, id: string, focus: Citation | null, pitch: number) {
  const s = useTavern.getState();
  // A short pause with the thinking cue, as a live answer would have.
  const end = think([modId]);
  await new Promise((r) => setTimeout(r, 900));
  const hit = focus && SAVED_LINES.find((x) => x.moduleId === modId && x.path === focus.path && focus.startLine <= x.endLine && focus.endLine >= x.startLine);
  // No saved answer: the character deflects, in turn, and says which line it will talk about.
  const no = hit ? null : deflection(archetypeOf(s.repo?.modules ?? [], modId));
  const text = hit?.text ?? `${no!.text} ${modId === 'orders' ? 'Ask me' : 'Ask orders'} about line 50 of orders/checkout.ts.`;
  const bubble = hit ? (s.spice === 'clean' ? hit.bubbleClean : hit.bubble) : no!.bubble;
  for (let i = 0; i < text.length; i += 4) {
    s.appendToMessage(modId, id, text.slice(i, i + 4));
    blipText(text.slice(i, i + 4), pitch, useTavern.getState().muted);
    await new Promise((r) => setTimeout(r, 30));
  }
  s.updateMessage(modId, id, { citations: extractCitations(text).filter((c) => isValidCitation(c, s.repo?.files ?? [])), bubble });
  end(); // the cue holds until the answer is in
}

/**
 * Sends one chat turn to a character (the selected one, or `moduleId`) and streams the reply in. A line the message
 * names ("line 29", "lines 40-52") opens, lights up and gets pointed at before the reply, and the answer is about
 * exactly those lines. Reads everything from the store, so the code panel and the stage can call it too.
 */
export async function sendChat(text: string, o: { moduleId?: string } = {}) {
  text = text.trim();
  if (o.moduleId && o.moduleId !== useTavern.getState().selectedModuleId) useTavern.getState().selectModule(o.moduleId);
  const s = useTavern.getState();
  const { repo, characters, openFilePath, spice, mode } = s;
  const mod = repo?.modules.find((m) => m.id === s.selectedModuleId);
  if (!text || s.isLoading || !repo || !mod) return;
  const char = characters[mod.id];
  const name = char?.name ?? mod.name;
  unlockAudio();
  const focus = resolveLineRef(parseLineRef(text), { files: repo.files, openFilePath, ownPaths: mod.filePaths, mainFile: entryFile(mod) });
  if (focus) s.highlightCitation(focus);
  const history = (s.chats[mod.id] ?? []).filter((m) => m.role !== 'system').slice(-7);
  const id = crypto.randomUUID();
  s.addMessage(mod.id, { id: crypto.randomUUID(), role: 'user', text, citations: [] });
  s.addMessage(mod.id, { id, role: 'character', characterId: mod.id, text: '', citations: [] });
  s.setLoading(true);
  s.setMood(mod.id, 'talking');
  // Holding a grudge: it opens with a sulky line straight away (the model is told it's said), then answers in full.
  const grudge = grudgeOf(mod.id);
  const opener = grudge.roasted || grudge.pestered ? sulkyOpener(grudge, spice) : '';
  if (opener) s.appendToMessage(mod.id, id, opener + '\n\n');
  void stageDo('answer', mod.id, id, focus);
  if (s.demo) {
    await demoReply(mod.id, id, focus, char?.voicePitch ?? 1);
    s.setLoading(false);
    s.setMood(mod.id, 'idle');
    return;
  }

  // A question about named lines needs less of the module around them (cheaper, and it stays on those lines).
  const ctx = pickContext(mod, repo.files, focus?.path ?? openFilePath, text, focus ? FOCUS_BUDGET : CHAT_BUDGET);
  const nameOf = (mid: string) => repo.modules.find((m) => m.id === mid)?.name ?? mid;
  const facts = s.graph ? graphFacts(s.graph, mod.id, repo.files, nameOf) : { dependents: [], dependencies: [] };
  // Someone else's line: the code goes along, and the speaker explains it as an outsider.
  const owner = focus && repo.modules.find((m) => m.filePaths.includes(focus.path));
  const outsider = !!owner && owner.id !== mod.id;
  const focusBody = focus && {
    ...focus,
    owner: outsider ? (characters[owner.id]?.name ?? owner.name) : null,
    content: outsider ? repo.files.find((f) => f.path === focus.path)?.content.slice(0, 20_000) : undefined,
    relation: outsider ? relation(s.graph, mod.id, owner.id) : '',
  };
  let full = '';
  let highlighted = false;
  // The thinking cue, from the request until the first words arrive (or it fails, or is cancelled).
  const thought = think([mod.id]);
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
        focus: focusBody,
        grudge: { ...grudge, opener },
        recentBubbles: recentBubbles(5),
        messages: [...history, { role: 'user', text }].map((m) => ({ role: m.role, text: m.text })),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`chat ${res.status}`, { cause: res.status });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    // After BUBBLE_SEP comes the bubble (the route has already cut the "@@bubble:" line out of the answer).
    let bubble: string | null = null;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      if (bubble !== null) {
        bubble += chunk;
        continue;
      }
      const sep = chunk.indexOf(BUBBLE_SEP);
      const value = sep < 0 ? chunk : chunk.slice(0, sep);
      if (sep >= 0) bubble = chunk.slice(sep + 1);
      if (!value) continue;
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
    s.updateMessage(mod.id, id, { citations: extractCitations(full).filter((c) => isValidCitation(c, repo.files)), bubble: bubble?.trim() || undefined });
  } catch (err) {
    console.warn('[chat]', err);
    s.updateMessage(mod.id, id, { role: 'system', text: (err as Error).cause === 503 ? UNAVAILABLE : BUSY });
  } finally {
    thought();
    s.setLoading(false);
    s.setMood(mod.id, 'idle');
  }
}

export default function ChatPanel() {
  const { repo, characters, moods, selectedModuleId, openFilePath, chats, isLoading } = useTavern();
  const thinking = useStage((s) => s.thinking);
  // Its AI persona still on the way: the selected character shows the thinking cue (here at once, and on the stage
  // once that loads) until it arrives.
  const personaDue = useTavern((s) => s.personas === 'pending' && !!s.selectedModuleId && !s.arrivals[s.selectedModuleId]);
  useEffect(() => {
    if (personaDue && selectedModuleId) return think([selectedModuleId]);
  }, [personaDue, selectedModuleId]);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const mod = repo?.modules.find((m) => m.id === selectedModuleId);
  const char = mod ? characters[mod.id] : undefined;
  const messages = mod ? (chats[mod.id] ?? []) : [];
  const name = char?.name ?? mod?.name ?? '';
  const lastText = messages.at(-1)?.text.length;
  const cast3D = useCast3D((s) => s.on);
  const tenants = useStage((s) => s.tenants);

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
  // "Who depends on you?": the dependents line up on stage and point at their imports first.
  const who = () => void stageDo('whoNeedsYou', mod.id, (t: string, m: string) => sendChat(t, { moduleId: m }));

  const openName = openFilePath?.split('/').pop();
  const QUICK = [
    { label: 'Explain yourself', text: 'Explain yourself. What do you do, and which files matter most?' },
    { label: "What's your worst part?", text: "What's your worst part? Point at the exact lines." },
    { label: 'Who depends on you?', text: 'Who depends on you? Which other files import or use you?', run: who },
    { label: 'Roast this file', text: `Roast ${openFilePath}. Be specific.`, disabled: !openFilePath, title: openName ? `Roast ${openName}` : 'Open a file first' },
  ];

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-3 border-b border-edge p-4">
        {/* The character itself stands on the stage; the header keeps a 3D one only when the tenants are off. */}
        {cast3D && repo && tenants === 'off' ? (
          <CharacterStage
            className="h-24 w-24 shrink-0"
            actor={`chat:${mod.id}`}
            module={mod}
            cast={repo.modules}
            color={char?.color}
            mood={moods[mod.id] ?? 'idle'}
            ambient={false}
            clicks={false}
            fallback={<ModuleFace id={mod.id} size={96} mood={moods[mod.id]} />}
          />
        ) : (
          <ModuleFace id={mod.id} size={96} mood={moods[mod.id]} />
        )}
        <div className="min-w-0">
          <div className="font-display text-xl leading-tight">
            {name}
          </div>
          {char && <div className="mt-0.5 text-sm text-cream/80 italic">&ldquo;{char.catchphrase}&rdquo;</div>}
          <div className="mt-1 font-mono text-xs text-muted">{statsLine(mod.stats)}</div>
          {personaDue && <ThinkingText id={mod.id} className="mt-1 block text-sm text-muted italic" />}
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
              id={`msg-${m.id}`}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}
            >
              {m.role === 'character' && <Speaker id={m.characterId ?? mod.id} />}
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 leading-relaxed ${m.role === 'user' ? 'whitespace-pre-wrap' : ''} ${
                  m.role === 'user' ? 'rounded-br-sm bg-amber text-ink' : 'rounded-bl-sm border border-edge bg-wood text-cream'
                }`}
              >
                {m.role === 'character' && m.characterId && m.characterId !== mod.id && (
                  <div className="text-xs font-medium text-muted">{characters[m.characterId]?.name ?? m.characterId}</div>
                )}
                {m.role === 'user' ? m.text : m.text ? <Rich text={m.text} files={repo.files} /> : !thinking[m.characterId ?? mod.id] && '…'}
                {/* Waiting on the AI: the character's thinking cue under whatever it has said so far. */}
                {m.role === 'character' && m === messages.at(-1) && isLoading && <ThinkingText id={m.characterId ?? mod.id} className={`block text-muted italic ${m.text ? 'mt-1' : ''}`} />}
              </div>
            </motion.div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <div data-perch="chat-chips" className="flex flex-wrap gap-1.5 border-t border-edge px-3 pt-2">
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={isLoading || q.disabled}
            title={q.title}
            onClick={() => ('run' in q && q.run ? q.run() : send(q.text))}
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

/** The face next to a transcript line: whoever said it (arguments and line-ups have several speakers). */
function Speaker({ id }: { id: string }) {
  const mod = useTavern((s) => s.repo?.modules.some((m) => m.id === id));
  return mod || id === 'judge' || id === 'landlord' ? <ModuleFace id={id} size={28} still /> : <div className="w-7" />;
}
