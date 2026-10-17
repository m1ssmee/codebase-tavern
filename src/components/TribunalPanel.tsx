'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Gavel, Sparkles } from 'lucide-react';
import { useTavern } from '@/lib/store';
import { extractCitations, isValidCitation, parseCitations } from '@/lib/citations';
import { pickContext, CONTEXT_BUDGET } from '@/lib/context';
import { airhorn, blipText, unlockAudio } from '@/lib/blips';
import type { Citation, SpiceLevel } from '@/lib/types';
import { isCode } from '@/lib/analyze';
import demoTribunal from '@/data/demoTribunal.json';
import CharacterFace from './CharacterFace';
import CitationChip from './CitationChip';
import VerdictDiagram from './VerdictDiagram';
import Rich from './Rich';

type Turn = { moduleId: string; text: string; accuses?: string };
type Verdict = { culprits: string[]; rootCause: string; evidence: Citation[]; fix: { path: string; diff: string }; judgeLine: string; diagram?: string };
type Result = { suspects: string[]; turns: Turn[]; verdict: Verdict };
type Phase = 'input' | 'picking' | 'hearing' | 'playing' | 'verdict' | 'error';

const SUGGESTION = 'Customers are being charged twice';
const DEMO = demoTribunal as unknown as Result;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEMO_FIRST_TURN_LIMIT_MS = 20_000;
const SLOW_NOTE = 'Replaying a saved hearing (live AI is slow right now).';
const DOWN_NOTE = 'Replaying a saved hearing (live AI is unavailable right now).';

async function post<T>(body: object, signal?: AbortSignal): Promise<T> {
  const res = await fetch('/api/tribunal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`tribunal ${res.status}`);
  return res.json();
}

/** Waiting-room lines while the court reads the code: real file names, tone set by the spice level. */
function courtLines(suspects: { name: string; files: string[] }[], spice: SpiceLevel): string[] {
  const T: Record<SpiceLevel, ((m: string, f: string, o: string) => string)[]> = {
    clean: [
      (m, f) => `The court is reading ${f}.`,
      (m, f) => `${m} is pretending ${f} was always like this.`,
      (m, f) => `The judge is counting the lines in ${f}.`,
      (m, f, o) => `${m} and ${o} are not making eye contact.`,
    ],
    unhinged: [
      (m, f) => `The court is reading ${f}. Nobody looks happy.`,
      (m, f) => `${m} is sweating through ${f}.`,
      (m, f) => `${m} swears ${f} worked fine yesterday. Nobody believes it.`,
      (m, f) => `The judge just opened ${f} and said "oh, for fuck's sake".`,
    ],
    feral: [
      (m, f) => `${m} is muttering "shit, shit, shit" at ${f}.`,
      (m, f) => `Something in ${f} stinks and everyone is looking at ${m}.`,
      (m, f) => `The judge opened ${f} and gagged.`,
      (m, f, o) => `${m} is leaking excuses all over ${f} and blaming ${o}.`,
    ],
    nuclear: [
      (m, f) => `${m} is threatening to git rm itself over ${f}.`,
      (m, f, o) => `${m} and ${o} are screaming about ${f}.`,
      (m, f) => `The judge read ${f} and said "fucking hell".`,
      (m, f) => `${m} has barricaded itself inside ${f}.`,
    ],
  };
  // Template by template, cycling through suspects, so consecutive lines are about different modules.
  const out: string[] = [];
  T[spice].forEach((t, k) =>
    suspects.forEach((s, i) => out.push(t(s.name, s.files[k % s.files.length], suspects[(i + 1) % suspects.length]?.name ?? 'the gateway'))),
  );
  return out;
}

export default function TribunalPanel() {
  const { repo, characters, moods, spice, setTribunal } = useTavern();
  const [bug, setBug] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [suspects, setSuspects] = useState<string[]>([]);
  const [done, setDone] = useState<Turn[]>([]);
  const [current, setCurrent] = useState<Turn | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lineIdx, setLineIdx] = useState(0);
  const stop = useRef(false);
  const skip = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [done.length, current?.text.length, verdict]);
  // Rotate a courtroom line every 3s while waiting for the first turn.
  useEffect(() => {
    if (phase !== 'hearing') return;
    const t = setInterval(() => setLineIdx((i) => i + 1), 3000);
    return () => clearInterval(t);
  }, [phase]);
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
  const waiting = courtLines(
    suspects.map((id) => {
      const m = repo.modules.find((x) => x.id === id);
      const code = (m?.filePaths ?? []).filter((p) => isCode(p) && !/[._-](test|spec)\.|__tests__\//.test(p)); // real source files, not tests
      return { name: m?.name ?? id, files: code.length ? code : (m?.filePaths ?? [id]) };
    }),
    spice,
  );
  if (!waiting.length) waiting.push('The court is reviewing the evidence.');

  /** Types one turn out with blips; speaker talks, accused rolls its eyes, chips highlight as they complete. */
  const playTurn = async (turn: Turn, ids: string[]) => {
    mood(ids, 'idle');
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
  };

  const showVerdict = (v: Verdict, ids: string[]) => {
    airhorn(useTavern.getState().muted);
    // nuclear: the whole screen shakes for the verdict (CSS; disabled for reduced motion).
    if (useTavern.getState().spice === 'nuclear') {
      document.body.classList.add('nuclear-shake');
      setTimeout(() => document.body.classList.remove('nuclear-shake'), 650);
    }
    mood(ids, 'happy');
    mood(v.culprits, 'guilty');
    setVerdict(v);
    setPhase('verdict');
    const first = v.evidence.find((c) => isValidCitation(c, repo.files));
    if (first) useTavern.getState().highlightCitation(first);
  };

  /** The saved quickcart hearing, played exactly like a live one. */
  const replay = async (r: Result, why: string | null) => {
    setNote(why);
    setDone([]);
    setCurrent(null);
    setSuspects(r.suspects);
    setPhase('playing');
    for (const turn of r.turns) {
      if (stop.current) return;
      await playTurn(turn, r.suspects);
    }
    if (!stop.current) showVerdict(r.verdict, r.suspects);
  };

  const start = async (text: string) => {
    text = text.trim();
    if (!text) return;
    unlockAudio();
    stop.current = false;
    skip.current = false;
    setDone([]);
    setCurrent(null);
    setVerdict(null);
    setNote(null);
    setLineIdx(0);
    setPhase('picking');
    // Demo route: replay the saved hearing with the same pacing, no API calls.
    if (useTavern.getState().demo && DEMO.turns?.length) {
      await sleep(900);
      setSuspects(DEMO.suspects);
      setPhase('hearing');
      mood(DEMO.suspects, 'accused');
      await sleep(1800);
      return replay(DEMO, null);
    }

    // Demo repo only: no first turn within 20s → cancel the live request and replay the saved hearing.
    const ctrl = new AbortController();
    let gotTurn = false;
    const limit = isDemoRepo ? setTimeout(() => !gotTurn && ctrl.abort(), DEMO_FIRST_TURN_LIMIT_MS) : undefined;
    const queue: Turn[] = [];
    let live: Verdict | null = null;
    let ended = false;
    let wake = () => {};
    let ids: string[] = [];
    try {
      ({ suspects: ids } = await post<{ suspects: string[] }>(
        {
          stage: 'suspects',
          bug: text,
          modules: repo.modules.map((m) => ({ id: m.id, title: title(m.id), path: m.path, stats: m.stats, filePaths: m.filePaths.slice(0, 60) })),
        },
        ctrl.signal,
      ));
      setSuspects(ids);
      setPhase('hearing');
      mood(ids, 'accused'); // nervous while the court reads the code
      const budget = Math.floor(CONTEXT_BUDGET / ids.length);
      const res = await fetch('/api/tribunal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          stage: 'trial',
          bug: text,
          spice,
          mode: useTavern.getState().mode,
          suspects: ids.map((id) => {
            const m = repo.modules.find((x) => x.id === id)!;
            const ctx = pickContext(m, repo.files, null, text, budget);
            return { id, title: title(id), personality: characters[id]?.personality ?? '', files: ctx.files, allPaths: m.filePaths };
          }),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`tribunal ${res.status}`);
      // Read NDJSON in the background: turns go into the queue as they arrive; playback drains it below.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      void (async () => {
        let buf = '';
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += value;
            for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
              const line = buf.slice(0, i);
              buf = buf.slice(i + 1);
              if (!line.trim()) continue;
              const e = JSON.parse(line);
              if (e.type === 'turn') {
                gotTurn = true;
                clearTimeout(limit);
                queue.push(e.turn);
              } else if (e.type === 'verdict') live = e.verdict;
              wake();
            }
          }
        } catch (err) {
          console.warn('[tribunal] stream', err);
        } finally {
          ended = true;
          wake();
        }
      })();

      const nextEvent = () => new Promise<void>((r) => (wake = r));
      let played = 0;
      while (!stop.current) {
        if (played < queue.length) {
          if (played === 0) setPhase('playing');
          await playTurn(queue[played++], ids);
        } else if (ended) break;
        else await nextEvent();
      }
      if (stop.current) return;
      if (!live || played < 2) throw new Error(ctrl.signal.aborted ? 'slow' : 'no verdict');
      showVerdict(live, ids);
    } catch (err) {
      clearTimeout(limit);
      if (stop.current) return;
      console.warn('[tribunal]', err);
      // Demo safety: on the demo repo, replay the saved hearing instead of stalling or failing on stage.
      if (isDemoRepo && DEMO.turns?.length) await replay(DEMO, ctrl.signal.aborted ? SLOW_NOTE : DOWN_NOTE);
      else setPhase('error');
    }
  };

  const line = (turn: Turn, key: string | number) => (
    <div key={key} className="flex gap-2">
      <CharacterFace size={28} name={repo.modules.find((m) => m.id === turn.moduleId)?.name ?? turn.moduleId} color={characters[turn.moduleId]?.color} still />
      <div className="min-w-0 flex-1 rounded-2xl rounded-bl-sm border border-edge bg-wood px-3 py-2 text-cream">
        <div className="mb-0.5 text-xs font-medium">
          {title(turn.moduleId)}
          {turn.accuses && <span className="font-normal text-tomato"> accuses {title(turn.accuses)}</span>}
        </div>
        <div className="leading-relaxed">
          <Rich text={turn.text} files={repo.files} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-edge p-3">
        <Gavel className="text-amber" size={22} />
        <span className="font-display text-xl italic">Incident Tribunal</span>
        <button
          type="button"
          onClick={() => setTribunal(false)}
          className="bounce-hover ml-auto flex items-center gap-1 rounded-full border border-edge bg-panel px-3 py-1 text-sm font-medium text-cream"
        >
          <ArrowLeft size={14} /> Back
        </button>
      </div>

      {suspects.length > 0 && (
        <div className="flex justify-center gap-4 border-b border-edge bg-ink/40 px-3 py-3">
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
      {phase === 'hearing' && suspects.length > 0 && (
        <p className="border-b border-edge px-3 py-2 text-center text-sm text-muted italic">{waiting[lineIdx % waiting.length]}</p>
      )}

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {phase === 'input' && <p className="text-sm text-muted">Describe the bug. The modules will argue about whose fault it is.</p>}
        {phase === 'picking' && <p className="text-center text-muted italic">Calling the suspects.</p>}
        {note && <p className="text-center text-xs text-neutral-400">{note}</p>}
        {phase === 'error' && <p className="text-center text-sm text-tomato">Gemini is rate-limiting us. Try again in a minute.</p>}
        {done.map((t, i) => line(t, i))}
        {current && line(current, 'current')}
        {verdict && (
          <div className="space-y-2 rounded-2xl border border-amber bg-ink/60 p-3 text-cream">
            <div className="font-display text-xl text-amber">Verdict: guilty</div>
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
            {verdict.diagram && <VerdictDiagram diagram={verdict.diagram} culprits={verdict.culprits} />}
            {verdict.fix.diff && (
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-mono text-xs text-muted">Fix: {verdict.fix.path}</span>
                  <button
                    type="button"
                    onClick={() => useTavern.getState().openWhatIf({ kind: 'diff', diff: verdict.fix.diff, title: `Apply the Tribunal fix to ${verdict.fix.path}`, path: verdict.fix.path })}
                    className="bounce-hover ml-auto flex items-center gap-1 rounded-full bg-amber px-3 py-1 text-xs font-medium text-ink"
                  >
                    <Sparkles size={12} /> Apply this fix
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg bg-wood p-2 font-mono text-xs leading-relaxed">
                  {verdict.fix.diff.split('\n').map((l, i) => (
                    <div
                      key={i}
                      className={
                        l.startsWith('+') && !l.startsWith('+++')
                          ? 'bg-green-600/10 text-green-700'
                          : l.startsWith('-') && !l.startsWith('---')
                            ? 'bg-tomato/15 text-tomato'
                            : l.startsWith('@@')
                              ? 'text-sky-700'
                              : 'text-cream/70'
                      }
                    >
                      {l || ' '}
                    </div>
                  ))}
                </pre>
              </div>
            )}
            <p className="font-display text-lg italic">&ldquo;{verdict.judgeLine}&rdquo;</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-edge p-3">
        {phase === 'playing' ? (
          <button type="button" onClick={() => (skip.current = true)} className="w-full rounded-full border border-edge bg-wood py-2 text-sm font-medium text-cream">
            Skip to the verdict
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setBug(SUGGESTION)}
              disabled={phase === 'picking' || phase === 'hearing'}
              className="mb-2 rounded-full border border-edge px-2.5 py-1 text-xs text-cream/80 transition-colors hover:border-amber hover:text-cream disabled:opacity-40"
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
                className="min-w-0 flex-1 rounded-full border border-edge bg-ink px-4 py-2 text-cream placeholder:text-muted/60 focus:border-amber focus:outline-none"
              />
              <button
                type="submit"
                disabled={!bug.trim() || phase === 'picking' || phase === 'hearing'}
                className="bounce-hover rounded-full bg-tomato px-4 text-sm font-medium text-white disabled:opacity-50"
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
