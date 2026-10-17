'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Gavel } from 'lucide-react';
import { useTavern } from '@/lib/store';
import { extractCitations, isValidCitation, parseCitations } from '@/lib/citations';
import { pickContext, CONTEXT_BUDGET } from '@/lib/context';
import { airhorn, blipText, unlockAudio } from '@/lib/blips';
import type { Citation } from '@/lib/types';
import demoTribunal from '@/data/demoTribunal.json';
import CharacterFace from './CharacterFace';
import CitationChip from './CitationChip';

type Turn = { moduleId: string; text: string; accuses?: string };
type Verdict = { culprits: string[]; rootCause: string; evidence: Citation[]; fix: { path: string; diff: string }; judgeLine: string };
type Result = { suspects: string[]; turns: Turn[]; verdict: Verdict };
type Phase = 'input' | 'picking' | 'hearing' | 'playing' | 'verdict' | 'error';

const SUGGESTION = 'Customers are being charged twice';
const DEMO = demoTribunal as unknown as Result;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(body: object): Promise<T> {
  const res = await fetch('/api/tribunal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`tribunal ${res.status}`);
  return res.json();
}

export default function TribunalPanel() {
  const { repo, characters, moods, spice, setTribunal } = useTavern();
  const [bug, setBug] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [suspects, setSuspects] = useState<string[]>([]);
  const [done, setDone] = useState<Turn[]>([]);
  const [current, setCurrent] = useState<Turn | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const stop = useRef(false);
  const skip = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [done.length, current?.text.length, verdict]);
  // Leaving the court: stop playback and calm everyone down.
  useEffect(
    () => () => {
      stop.current = true;
      const s = useTavern.getState();
      for (const id of Object.keys(s.moods)) s.setMood(id, 'idle');
    },
    [],
  );

  if (!repo) return null;
  const title = (id: string) => characters[id]?.name ?? repo.modules.find((m) => m.id === id)?.name ?? id;
  const mood = (ids: string[], m: Parameters<ReturnType<typeof useTavern.getState>['setMood']>[1]) => ids.forEach((id) => useTavern.getState().setMood(id, m));
  const isDemoRepo = !!repo.url?.includes('/quickcart');

  const play = async (r: Result) => {
    setSuspects(r.suspects);
    setPhase('playing');
    for (const turn of r.turns) {
      if (stop.current) return;
      mood(r.suspects, 'idle');
      useTavern.getState().setMood(turn.moduleId, 'talking');
      if (turn.accuses) useTavern.getState().setMood(turn.accuses, 'accused');
      const pitch = characters[turn.moduleId]?.voicePitch ?? 1;
      let seen = 0;
      for (let c = 1; c <= turn.text.length; c++) {
        if (stop.current) return;
        if (skip.current) c = turn.text.length;
        const typed = turn.text.slice(0, c);
        setCurrent({ ...turn, text: typed });
        if (!skip.current) blipText(turn.text[c - 1], pitch, useTavern.getState().muted);
        // A chip just completed: light up its code.
        const cites = extractCitations(typed).filter((x) => isValidCitation(x, repo.files));
        if (cites.length > seen) {
          seen = cites.length;
          if (!skip.current) useTavern.getState().highlightCitation(cites[cites.length - 1]);
        }
        if (!skip.current) await sleep(25); // ~40 chars/sec
      }
      setDone((d) => [...d, turn]);
      setCurrent(null);
      if (!skip.current) await sleep(700);
    }
    if (stop.current) return;
    airhorn(useTavern.getState().muted);
    // nuclear: the whole screen shakes for the verdict (CSS; disabled for reduced motion).
    if (useTavern.getState().spice === 'nuclear') {
      document.body.classList.add('nuclear-shake');
      setTimeout(() => document.body.classList.remove('nuclear-shake'), 650);
    }
    mood(r.suspects, 'happy');
    mood(r.verdict.culprits, 'guilty');
    setVerdict(r.verdict);
    setPhase('verdict');
    const first = r.verdict.evidence.find((c) => isValidCitation(c, repo.files));
    if (first) useTavern.getState().highlightCitation(first);
  };

  const start = async (text: string) => {
    text = text.trim();
    if (!text) return;
    unlockAudio();
    stop.current = false;
    skip.current = false;
    setDone([]);
    setVerdict(null);
    setPhase('picking');
    try {
      const { suspects: ids } = await post<{ suspects: string[] }>({
        stage: 'suspects',
        bug: text,
        modules: repo.modules.map((m) => ({ id: m.id, title: title(m.id), path: m.path, stats: m.stats, filePaths: m.filePaths.slice(0, 60) })),
      });
      setSuspects(ids);
      setPhase('hearing');
      mood(ids, 'accused'); // nervous while the court reads the code
      const budget = Math.floor(CONTEXT_BUDGET / ids.length);
      const result = await post<Result>({
        stage: 'trial',
        bug: text,
        spice,
        suspects: ids.map((id) => {
          const m = repo.modules.find((x) => x.id === id)!;
          const ctx = pickContext(m, repo.files, null, text, budget);
          return { id, title: title(id), personality: characters[id]?.personality ?? '', files: ctx.files, allPaths: m.filePaths };
        }),
      });
      await play(result);
    } catch (err) {
      console.warn('[tribunal]', err);
      // Demo safety: on the demo repo, replay the saved hearing instead of failing on stage.
      if (isDemoRepo && DEMO.turns?.length) await play(DEMO);
      else setPhase('error');
    }
  };

  const line = (turn: Turn, key: string | number) => (
    <div key={key} className="flex gap-2">
      <CharacterFace size={28} name={repo.modules.find((m) => m.id === turn.moduleId)?.name ?? turn.moduleId} color={characters[turn.moduleId]?.color} still />
      <div className="min-w-0 flex-1 rounded-2xl rounded-bl-sm border border-edge bg-wood px-3 py-2 text-cream">
        <div className="mb-0.5 text-xs font-bold" style={{ color: characters[turn.moduleId]?.color }}>
          {title(turn.moduleId)}
          {turn.accuses && <span className="font-normal text-tomato"> accuses {title(turn.accuses)}</span>}
        </div>
        <div className="leading-relaxed whitespace-pre-wrap">
          {parseCitations(turn.text).map((seg, i) =>
            typeof seg === 'string' ? seg : isValidCitation(seg, repo.files) ? <CitationChip key={i} citation={seg} /> : null,
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b-2 border-edge bg-wood/60 p-3">
        <Gavel className="text-amber" size={22} />
        <span className="font-display text-xl tracking-wide text-amber">Incident Tribunal</span>
        <button
          type="button"
          onClick={() => setTribunal(false)}
          className="bounce-hover ml-auto flex items-center gap-1 rounded-full border border-edge bg-panel px-3 py-1 text-sm font-bold text-cream"
        >
          <ArrowLeft size={14} /> Back
        </button>
      </div>

      {suspects.length > 0 && (
        <div className="flex justify-center gap-4 border-b-2 border-edge bg-ink/40 px-3 py-3">
          {suspects.map((id) => {
            const m = repo.modules.find((x) => x.id === id);
            return (
              <div key={id} className="flex w-24 flex-col items-center text-center">
                <CharacterFace size={64} name={m?.name ?? id} stats={m?.stats} color={characters[id]?.color} mood={moods[id]} />
                <span className="mt-1 text-xs leading-tight text-cream/80">{title(id)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {phase === 'input' && <p className="text-sm text-muted">Describe the bug. The modules will argue about whose fault it is.</p>}
        {phase === 'picking' && <p className="text-center text-muted italic">Calling the suspects.</p>}
        {phase === 'hearing' && <p className="text-center text-muted italic">The court is reviewing the evidence.</p>}
        {phase === 'error' && <p className="text-center text-sm text-tomato">Gemini is rate-limiting us. Try again in a minute.</p>}
        {done.map((t, i) => line(t, i))}
        {current && line(current, 'current')}
        {verdict && (
          <div className="space-y-2 rounded-2xl border-2 border-amber bg-ink/60 p-3 text-cream">
            <div className="font-display text-xl tracking-wide text-amber">Verdict: guilty</div>
            <div className="text-sm text-tomato">{verdict.culprits.map(title).join(' and ')}</div>
            <p className="leading-relaxed">{parseCitations(verdict.rootCause).filter((s) => typeof s === 'string').join('')}</p>
            {verdict.evidence.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {verdict.evidence
                  .filter((c) => isValidCitation(c, repo.files))
                  .map((c, i) => (
                    <CitationChip key={i} citation={c} />
                  ))}
              </div>
            )}
            {verdict.fix.diff && (
              <div>
                <div className="mb-1 font-mono text-xs text-muted">Fix: {verdict.fix.path}</div>
                <pre className="overflow-x-auto rounded-lg bg-[#1b130f] p-2 font-mono text-xs leading-relaxed">
                  {verdict.fix.diff.split('\n').map((l, i) => (
                    <div
                      key={i}
                      className={
                        l.startsWith('+') && !l.startsWith('+++')
                          ? 'bg-[#9be15d]/15 text-[#9be15d]'
                          : l.startsWith('-') && !l.startsWith('---')
                            ? 'bg-tomato/15 text-tomato'
                            : l.startsWith('@@')
                              ? 'text-[#5ab0ff]'
                              : 'text-cream/70'
                      }
                    >
                      {l || ' '}
                    </div>
                  ))}
                </pre>
              </div>
            )}
            <p className="text-amber italic">&ldquo;{verdict.judgeLine}&rdquo;</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t-2 border-edge p-3">
        {phase === 'playing' ? (
          <button type="button" onClick={() => (skip.current = true)} className="w-full rounded-full border border-edge bg-wood py-2 text-sm font-bold text-cream">
            Skip to the verdict
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setBug(SUGGESTION)}
              disabled={phase === 'picking' || phase === 'hearing'}
              className="bounce-hover mb-2 rounded-full border border-edge bg-wood px-2.5 py-1 text-xs font-bold text-cream/90 hover:border-amber disabled:opacity-40"
            >
              {SUGGESTION}
            </button>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(bug);
              }}
            >
              <input
                value={bug}
                onChange={(e) => setBug(e.target.value)}
                placeholder="Describe the bug"
                className="min-w-0 flex-1 rounded-full border-2 border-edge bg-ink px-4 py-2 text-cream placeholder:text-muted/60 focus:border-amber focus:outline-none"
              />
              <button
                type="submit"
                disabled={!bug.trim() || phase === 'picking' || phase === 'hearing'}
                className="bounce-hover rounded-full bg-tomato px-4 font-display tracking-wide text-cream shadow-[0_3px_0_#7a2414] disabled:opacity-50"
              >
                Begin
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
