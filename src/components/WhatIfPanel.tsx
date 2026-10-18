'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileDiff, Play, RotateCcw, Sparkles } from 'lucide-react';
import { RIPPLE_HOP_MS, useTavern, type RippleStep, type WhatIfChange } from '@/lib/store';
import { computeImpact, QUICKCART_SUGGESTIONS, sameChange, suggestionDiff, type Impact, type ImpactItem } from '@/lib/whatif';
import { applyDiff, makeDiff, parseDiff } from '@/lib/diff';
import { closingLine } from '@/lib/landlord';
import { isValidCitation } from '@/lib/citations';
import { blipText, unlockAudio } from '@/lib/blips';
import type { Mood } from '@/lib/types';
import demoWhatIf from '@/data/demoWhatIf.json';
import CitationChip from './CitationChip';
import { think, useStage } from './stage/store';
import { Cue } from './Thinking';
import { stageDo } from './stage/api';
import Rich from './Rich';
import { LandlordPortrait, ModuleFace } from './Portrait';

type Verdict = 'breaks' | 'at risk' | 'fine' | 'relieved';
type Result = { moduleId: string; verdict: Verdict; reason: string; reaction: string };
type FollowUp = { moduleId: string; path: string; description: string };
type Summary = { update: string; check: string; followUps?: FollowUp[] };
// A saved follow-up run also keeps its parent's title and the patch it applied on top of it.
type Run = { title: string; diff: string; items: Result[]; summary: Summary; parent?: string; followUp?: { moduleId: string; path: string }; patch?: string };
type Snapshot = { title: string; impact: Impact; results: Record<string, Result>; summary: Summary | null; note: string | null };
type Phase = 'writing' | 'assessing' | 'done' | 'error';

const SAVED = (demoWhatIf as { runs: Run[] }).runs;
const LIVE_LIMIT_MS = 20_000;
const SLOW_NOTE = 'Replaying a saved preview (live AI is slow right now).';
const DOWN_NOTE = 'Replaying a saved preview (live AI is unavailable right now).';
const MOOD: Record<Verdict, Mood> = { breaks: 'horrified', 'at risk': 'nervous', fine: 'shrug', relieved: 'happy' };
const BADGE: Record<Verdict, string> = {
  breaks: 'bg-tomato text-white',
  'at risk': 'bg-amber-100 text-amber-900',
  fine: 'bg-wood text-muted',
  relieved: 'bg-green-100 text-green-800',
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const POTATO_MS = 1000; // one pass of the hot potato on stage

export default function WhatIfPanel() {
  const { repo, graph, characters, moods, whatIf, closeWhatIf, setView, landlordSays } = useTavern();
  const [phase, setPhase] = useState<Phase>('writing');
  const [title, setTitle] = useState(whatIf?.change.title ?? '');
  const [impact, setImpact] = useState<Impact | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(true); // false after Undo
  const [history, setHistory] = useState<Snapshot[]>([]); // earlier changes in the stack, oldest first
  const [input, setInput] = useState('');
  const gen = useRef(0); // bumped on unmount: an older run's callbacks see a different value and stop
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reached = useRef(new Set<string>());
  const landed = useRef(new Map<string, Result>());
  const spoken = useRef(new Set<string>()); // modules whose reaction bubble has played this step
  const ctrl = useRef<AbortController | null>(null);
  // The thinking cue: whoever is waiting on the AI (the changed module while the diff is written; then each module
  // in the list until its verdict lands). Every way out of a step ends them.
  const waits = useRef(new Map<string, () => void>());
  const wait = (ids: string[]) => ids.forEach((id) => !waits.current.has(id) && waits.current.set(id, think([id])));
  const unwait = (id?: string) => {
    for (const [k, end] of waits.current)
      if (!id || k === id) {
        end();
        waits.current.delete(k);
      }
  };
  const ownerOf = (path?: string) => repo?.modules.find((m) => path && m.filePaths.includes(path))?.id;

  // Closing What-if ends the hot potato scene on stage.
  useEffect(() => () => void stageDo('potatoEnd'), []);

  const later = (ms: number, f: () => void) => {
    const g = gen.current;
    timers.current.push(setTimeout(() => gen.current === g && f(), ms));
  };

  /** A module reacts once the ripple has reached it and its verdict is in, whichever comes last. */
  const react = (id: string) => {
    const r = landed.current.get(id);
    if (!r || !reached.current.has(id)) return;
    const s = useTavern.getState();
    s.setMood(id, MOOD[r.verdict]);
    if (r.verdict === 'breaks') later(900, () => useTavern.getState().setMood(id, 'fainted')); // horrified, then faints
    speak(id);
  };
  const speak = (id: string) => {
    const r = landed.current.get(id);
    if (!r?.reaction || !reached.current.has(id) || spoken.current.has(id)) return;
    spoken.current.add(id);
    const s = useTavern.getState();
    s.setBubble(id, r.reaction);
    blipText(r.reaction, s.characters[id]?.voicePitch ?? 1, s.muted);
    later(5000, () => useTavern.getState().bubbles[id] === r.reaction && useTavern.getState().setBubble(id, null)); // its quip, ~5 s
  };
  /** Live runs: the reactions come after the verdicts, once the comedy editor has picked them; they play in turn. */
  const voice = (reactions: Record<string, string>) =>
    Object.entries(reactions).forEach(([id, reaction], k) => {
      const r = landed.current.get(id);
      if (!r || !reaction) return;
      const next = { ...r, reaction };
      landed.current.set(id, next);
      setResults((x) => ({ ...x, [id]: next }));
      later(k * 900, () => speak(id));
    });
  const land = (r: Result) => {
    unwait(r.moduleId);
    landed.current.set(r.moduleId, r);
    setResults((x) => ({ ...x, [r.moduleId]: r }));
    react(r.moduleId);
  };

  /**
   * The show: ripple from the changed modules; each one reacts as the pulse reaches it. A stacked change ripples
   * from its own module only (`from`); modules the ripple doesn't pass are reached at once.
   */
  const play = (imp: Impact, label: string, from: Impact = imp) => {
    const s = useTavern.getState();
    reached.current = new Set();
    const changed = from.items.filter((i) => i.role === 'changed').map((i) => i.moduleId);
    const steps: RippleStep[] = from.items
      .filter((i) => i.role !== 'changed' && i.via)
      .map((i) => ({ id: i.moduleId, hops: i.hops, via: i.via!, dir: i.role === 'downstream' ? 'down' : 'up' }));
    // On stage (unless the tenants are off): the change is a glowing hot potato passed along the ripple order over
    // the code, and each module reacts when it lands. Otherwise the ripple plays on the Neighbourhood, as before.
    const staged = useStage.getState().tenants !== 'off' && s.view !== 'map' && s.view !== 'diagram';
    const order = [...new Set([...changed, ...[...steps].sort((a, b) => a.hops - b.hops).map((x) => x.id)])];
    if (staged) void stageDo('potato', order, POTATO_MS);
    else s.ripple(changed, { steps, label: `What if: ${label}` });
    for (const i of imp.items) {
      const arrive = () => (reached.current.add(i.moduleId), react(i.moduleId));
      const hops = from.items.find((x) => x.moduleId === i.moduleId)?.hops ?? 0;
      const k = order.indexOf(i.moduleId);
      if (staged) later(k < 0 ? 0 : 700 + (k ? (k + 0.7) * POTATO_MS : 0), arrive);
      else if (hops === 0) arrive();
      else later(hops * RIPPLE_HOP_MS, arrive);
    }
    setShown(true);
  };

  /** A step's results are all in: after stacked changes, if nobody is worse off, the Landlord shows up. */
  /** The Landlord closes a complete fix: everyone fine or relieved, and nothing left to follow up (or a stack that finished one). */
  const finish = (imp: Impact, depth: number, sum: Summary | null) => {
    unwait();
    setPhase('done');
    const ok = imp.items.every((i) => ['fine', 'relieved'].includes(landed.current.get(i.moduleId)?.verdict ?? ''));
    if (!ok || (depth < 2 && (!sum || sum.followUps?.length))) return;
    const s = useTavern.getState();
    const line = closingLine(s.spice, depth, imp.items.length, imp.files.map((f) => f.path).join());
    s.setLandlordSays(line);
    void stageDo('completeFix');
    blipText(line, 0.7, s.muted);
  };

  /** Back to an earlier step of the stack: its diff, its verdicts, its moods. */
  const restore = (snap: Snapshot) => {
    const s = useTavern.getState();
    setTitle(snap.title);
    setImpact(snap.impact);
    setResults(snap.results);
    landed.current = new Map(Object.entries(snap.results));
    setSummary(snap.summary);
    setNote(snap.note);
    setError(null);
    setPhase('done');
    s.setWhatIfDiff(snap.impact.files.map((f) => ({ path: f.path, before: f.before, after: f.after })));
    s.setLandlordSays(null);
    for (const id of Object.keys(s.moods)) s.setMood(id, 'idle');
    for (const r of Object.values(snap.results)) s.setMood(r.moduleId, r.verdict === 'breaks' ? 'fainted' : MOOD[r.verdict]);
    useTavern.setState({ bubbles: {}, rippleFrom: null });
  };

  const undo = () => {
    unwait();
    void stageDo('undo'); // everyone on stage groans
    timers.current.forEach(clearTimeout);
    timers.current = [];
    reached.current = new Set();
    gen.current++; // stop whatever the last step was still doing
    ctrl.current?.abort();
    if (history.length) {
      restore(history[history.length - 1]);
      setHistory((h) => h.slice(0, -1));
      return;
    }
    const s = useTavern.getState();
    s.setLandlordSays(null);
    for (const id of Object.keys(s.moods)) s.setMood(id, 'idle');
    useTavern.setState({ bubbles: {}, rippleFrom: null });
    setShown(false);
  };

  const replay = async (run: Run, why: string | null, dead: () => boolean, imp: Impact, depth: number) => {
    setNote(why);
    for (const r of run.items) {
      await sleep(650);
      if (dead()) return;
      land(r);
    }
    setSummary(run.summary);
    finish(imp, depth, run.summary);
  };
  const savedFor = (imp: Impact) =>
    SAVED.find((r) => {
      const x = repo && graph && computeImpact(repo.files, repo.modules, graph, r.diff);
      return !!x && !('error' in x) && sameChange(x.files, imp.files);
    });

  /**
   * "Apply the X side too": a small diff for that module (call 1, written against the stacked files), then the
   * impact of the combined change. Nothing touches the repo; the stack lives in this panel. Saved patch on the
   * demo route, or when call 1 is slow or fails on quickcart.
   */
  const followUp = async (f: FollowUp) => {
    if (!repo || !graph || !impact) return;
    const s = useTavern.getState();
    const mod = repo.modules.find((m) => m.id === f.moduleId);
    const path = mod && (mod.filePaths.includes(f.path) ? f.path : mod.stats.biggestFile.path);
    if (!mod || !path) return;
    const my = ++gen.current;
    const dead = () => gen.current !== my;
    timers.current.forEach(clearTimeout);
    const original = (p: string) => repo.files.find((x) => x.path === p)?.content ?? '';
    const current = new Map(impact.files.map((x) => [x.path, x.after]));
    const content = current.get(path) ?? original(path);
    const label = `Apply the ${mod.name} side too`;
    const parent = savedFor(impact);
    const savedRun = SAVED.find((r) => r.patch && r.followUp?.moduleId === f.moduleId && r.parent === parent?.title);
    const depth = history.length + 2;
    setHistory((h) => [...h, { title, impact, results, summary, note }]);
    setTitle(label);
    setNote(null);
    setError(null);
    setResults({}); // the old verdicts don't apply to the stacked change
    setSummary(null);
    setPhase('writing');
    let patch = '';
    if (!s.demo) {
      wait([mod.id]);
      const ac = (ctrl.current = new AbortController());
      const limit = repo.url?.includes('/quickcart') && savedRun ? setTimeout(() => ac.abort(), LIVE_LIMIT_MS) : undefined;
      const res = await fetch('/api/whatif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'diff', description: f.description, path, startLine: 1, endLine: content.split('\n').length, content }),
        signal: ac.signal,
      }).catch(() => null);
      clearTimeout(limit);
      const data = await res?.json().catch(() => null);
      unwait(mod.id);
      if (dead()) return;
      patch = data?.diff ?? '';
    }
    const fd = parseDiff(patch || savedRun?.patch || '', path)[0];
    const applied = fd && applyDiff(content, { ...fd, path });
    if (!applied || 'error' in applied) {
      restore({ title, impact, results, summary, note });
      setHistory((h) => h.slice(0, -1));
      setError(s.demo ? 'The demo route makes no AI calls, and there is no saved version of that follow-up.' : "Couldn't write that follow-up against the file. Try again in a minute.");
      return;
    }
    if (!patch && savedRun) setNote(s.demo ? null : SLOW_NOTE);
    current.set(path, applied.text);
    const combined = [...current].map(([p, after]) => makeDiff(p, original(p), after)).filter(Boolean).join('\n');
    const imp = computeImpact(repo.files, repo.modules, graph, combined);
    const own = computeImpact(repo.files, repo.modules, graph, makeDiff(path, original(path), applied.text));
    if ('error' in imp || 'error' in own) return;
    await runStep(imp, label, depth, dead, own);
  };

  const start = async (change: WhatIfChange) => {
    const s = useTavern.getState();
    if (!repo || !graph) return;
    const my = gen.current;
    const dead = () => gen.current !== my;
    const ac = (ctrl.current = new AbortController());
    unlockAudio();
    let diff = change.kind === 'diff' ? change.diff : '';
    let label = change.title;
    if (change.kind === 'describe') {
      if (s.demo) {
        setPhase('error');
        setError('The demo route makes no AI calls, so it cannot write a new change. Try one of the suggested changes below.');
        return;
      }
      setPhase('writing');
      const file = repo.files.find((f) => f.path === change.path);
      const owner = ownerOf(change.path);
      if (owner) wait([owner]);
      const res = await fetch('/api/whatif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'diff', description: change.description, path: change.path, startLine: change.startLine, endLine: change.endLine, content: file?.content }),
        signal: ac.signal,
      }).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (owner) unwait(owner);
      if (dead()) return;
      if (!res?.ok || !data?.diff) {
        setPhase('error');
        setError(res?.status === 422 ? "That change didn't fit the file. Try describing it differently." : 'The AI is busy. Try again in a minute.');
        return;
      }
      diff = data.diff;
      label = data.title;
      setTitle(label);
    }

    const imp = computeImpact(repo.files, repo.modules, graph, diff, change.path);
    if ('error' in imp) {
      setPhase('error');
      setError(imp.error);
      return;
    }
    await runStep(imp, label, 1, dead);
  };

  /** One step of the stack: show the impact, ripple, then the verdicts (saved on the demo route, else live). */
  const runStep = async (imp: Impact, label: string, depth: number, dead: () => boolean, from: Impact = imp) => {
    const s = useTavern.getState();
    if (!repo || !graph) return;
    const ac = (ctrl.current = new AbortController());
    setImpact(imp);
    setResults({});
    landed.current = new Map();
    spoken.current = new Set();
    setSummary(null);
    s.setLandlordSays(null);
    s.setWhatIfDiff(imp.files.map((f) => ({ path: f.path, before: f.before, after: f.after })));
    setPhase('assessing');
    play(imp, label, from);
    wait(imp.items.map((i) => i.moduleId)); // they read the diff

    const saved = savedFor(imp);
    const graphOnly = (why: string) => {
      unwait();
      setNote(why);
      setPhase('done');
    };
    if (s.demo) return saved ? replay(saved, null, dead, imp, depth) : graphOnly('The demo route makes no AI calls, so this preview shows the import graph only.');

    // Live. On quickcart, nothing within 20s (or a failure) replays the saved run of the same change.
    const isDemoRepo = !!repo.url?.includes('/quickcart');
    let gotItem = false;
    const limit = isDemoRepo ? setTimeout(() => !gotItem && ac.abort(), LIVE_LIMIT_MS) : undefined;
    const name = (id: string) => s.characters[id]?.name ?? repo.modules.find((m) => m.id === id)?.name ?? id;
    // Whole files, within ~110KB: the changed ones, every file a cited line lives in, then as evidence the biggest
    // file of each module in the list and of each module they call over the network (e.g. the service's timings).
    const listed = imp.items.map((i) => i.moduleId);
    const nearby = [...new Set([...listed, ...graph.edges.filter((e) => e.kind === 'calls' && listed.includes(e.from)).map((e) => e.to)])];
    const paths = [
      ...new Set([
        ...imp.files.map((f) => f.path),
        ...imp.items.flatMap((i) => [...i.lines, ...i.usages].map((c) => c.path)),
        ...nearby.map((id) => repo.modules.find((m) => m.id === id)?.stats.biggestFile.path ?? ''),
      ]),
    ].filter(Boolean);
    let left = 110_000;
    const files = paths.flatMap((p) => {
      const content = repo.files.find((f) => f.path === p)?.content.slice(0, Math.max(0, left)) ?? '';
      left -= content.length;
      return content ? [{ path: p, content }] : [];
    });
    try {
      const res = await fetch('/api/whatif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          stage: 'assess',
          spice: s.spice,
          mode: s.mode,
          repoName: repo.name,
          title: label,
          diff: imp.files.map((f) => makeDiff(f.path, f.before, f.after)).join('\n'),
          items: imp.items.map((i) => ({ ...i, name: name(i.moduleId) })),
          files,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`whatif ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      let failed = false;
      let sum: Summary | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done || dead()) break;
        buf += value;
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === 'item') {
            gotItem = true;
            clearTimeout(limit);
            land(e.item);
          } else if (e.type === 'summary') setSummary((sum = e.summary));
          else if (e.type === 'reactions') voice(e.reactions);
          else if (e.type === 'error') failed = true;
        }
      }
      if (failed && !gotItem) throw new Error('assess failed');
      if (!dead()) finish(imp, depth, sum);
    } catch (err) {
      clearTimeout(limit);
      if (dead()) return unwait();
      console.warn('[whatif]', err);
      if (isDemoRepo && saved) return replay(saved, ac.signal.aborted ? SLOW_NOTE : DOWN_NOTE, dead, imp, depth);
      graphOnly(ac.signal.aborted ? 'Live AI is slow right now. The impact list comes from the import graph and is still accurate.' : 'The AI is busy right now. The impact list comes from the import graph and is still accurate.');
    }
  };

  useEffect(() => {
    // A tick later, so StrictMode's instant remount cancels the first run before it calls anything.
    const t = setTimeout(() => whatIf && void start(whatIf.change), 0);
    return () => {
      clearTimeout(t);
      gen.current++; // eslint-disable-line react-hooks/exhaustive-deps -- a run counter, not a DOM ref
      ctrl.current?.abort();
      timers.current.forEach(clearTimeout);
      unwait();
      const s = useTavern.getState();
      for (const id of Object.keys(s.moods)) s.setMood(id, 'idle');
      useTavern.setState({ bubbles: {} });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one run per mount; the panel is keyed by whatIf.id

  if (!repo || !whatIf) return null;
  const modName = (id: string) => characters[id]?.name ?? repo.modules.find((m) => m.id === id)?.name ?? id;
  const roleText = (i: ImpactItem) =>
    i.role === 'changed' ? 'changed by this diff' : i.role === 'upstream' ? `${i.why} · ${i.hops} ${i.hops === 1 ? 'hop' : 'hops'} away` : i.why;
  const suggestions = repo.url?.includes('/quickcart') ? QUICKCART_SUGGESTIONS.filter((x) => suggestionDiff(repo.files, x)) : [];
  const target = whatIf.change.kind === 'describe' ? whatIf.change : null;
  const describePath = target?.path ?? impact?.files[0]?.path ?? useTavern.getState().openFilePath ?? '';
  const describe = (text: string) => {
    const f = repo.files.find((x) => x.path === describePath);
    if (!text.trim() || !f) return;
    useTavern.getState().openWhatIf({
      kind: 'describe',
      description: text.trim(),
      title: text.trim(),
      path: f.path,
      startLine: target?.startLine ?? 1,
      endLine: target?.endLine ?? f.lineCount,
    });
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-edge p-3">
        <Sparkles className="text-amber" size={20} />
        <span className="font-display text-xl italic">What if</span>
        <button
          type="button"
          onClick={closeWhatIf}
          className="bounce-hover ml-auto flex items-center gap-1 rounded-full border border-edge bg-panel px-3 py-1 text-sm font-medium text-cream"
        >
          <ArrowLeft size={14} /> Back
        </button>
      </div>
      <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-900">Preview only. Nothing was changed.</div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        <div className="rounded-xl border border-edge bg-wood/60 p-3">
          <div className="text-xs text-muted">{history.length ? `The changes (${history.length + 1}, stacked)` : 'The change'}</div>
          {history.map((h, k) => (
            <div key={k} className="text-sm text-muted">
              {k + 1}. {h.title}
            </div>
          ))}
          <div className="font-medium">
            {history.length ? `${history.length + 1}. ` : ''}
            {title}
          </div>
          {impact && (
            <div className="mt-0.5 font-mono text-xs text-muted">
              {impact.files.map((f) => `${f.path} +${f.added} −${f.removed}`).join(' · ')}
            </div>
          )}
          {impact && (
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setView('diff')} className="flex items-center gap-1 rounded-full border border-edge bg-panel px-3 py-1 text-xs text-cream hover:border-amber">
                <FileDiff size={13} /> View diff
              </button>
              {shown ? (
                <button type="button" onClick={undo} className="flex items-center gap-1 rounded-full border border-edge bg-panel px-3 py-1 text-xs text-cream hover:border-amber">
                  <RotateCcw size={13} /> {history.length ? 'Undo the last change' : 'Undo'}
                </button>
              ) : (
                <button type="button" onClick={() => play(impact, title)} className="flex items-center gap-1 rounded-full border border-edge bg-panel px-3 py-1 text-xs text-cream hover:border-amber">
                  <Play size={13} /> Replay
                </button>
              )}
            </div>
          )}
        </div>

        {landlordSays && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5">
            <LandlordPortrait size={48} talking />
            <div className="text-sm leading-snug">
              <div className="text-xs font-medium">The Landlord</div>
              {landlordSays}
            </div>
          </div>
        )}
        {phase === 'writing' && (
          <div className="flex flex-col items-center gap-2">
            {[...waits.current.keys()].slice(0, 1).map((id) => (
              <Cue key={id} id={id} size={36} />
            ))}
            <p className="text-center text-sm text-muted italic">Writing the change against the real file.</p>
          </div>
        )}
        {error && <p className="text-center text-sm text-tomato">{error}</p>}
        {note && <p className="text-center text-xs text-neutral-400">{note}</p>}

        {impact && (
          <div className="space-y-2">
            <div className="text-xs text-muted">
              Who feels it ({impact.items.length}), from the import graph{phase === 'assessing' ? '. The modules are reading the diff.' : '.'}
            </div>
            {impact.items.map((i) => {
              const r = results[i.moduleId];
              const cites = [...i.usages, ...i.lines]
                .map((c) => ({ path: c.path, startLine: c.line, endLine: c.endLine }))
                .filter((c, k, all) => isValidCitation(c, repo.files) && all.findIndex((x) => x.path === c.path && x.startLine === c.startLine) === k)
                .slice(0, 6);
              return (
                <div key={i.moduleId} id={`whatif-${i.moduleId}`} className="rounded-xl border border-edge p-2.5">
                  <div className="flex items-center gap-2">
                    <ModuleFace id={i.moduleId} size={36} mood={moods[i.moduleId]} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{modName(i.moduleId)}</div>
                      <div className="text-xs text-muted">{roleText(i)}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${r ? BADGE[r.verdict] : 'text-muted'}`}>
                      {r ? r.verdict : phase === 'done' ? 'no verdict' : '…'}
                    </span>
                  </div>
                  {r?.reason && (
                    <div className="mt-1.5 text-sm leading-relaxed">
                      <Rich text={r.reason} files={repo.files} />
                    </div>
                  )}
                  {r?.reaction && <p className="mt-1 text-sm text-cream/80 italic">&ldquo;{r.reaction}&rdquo;</p>}
                  {i.usages.length > 0 && <div className="mt-1 text-xs text-muted">Uses {[...new Set(i.usages.map((u) => u.symbol))].join(', ')}:</div>}
                  {cites.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {cites.map((c, k) => (
                        <CitationChip key={k} citation={c} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {summary && (summary.update || summary.check) && (
          <div className="space-y-2 rounded-xl border border-amber bg-ink/60 p-3 text-sm leading-relaxed">
            {summary.update && (
              <div>
                <div className="text-xs font-medium text-muted">What to update</div>
                <Rich text={summary.update} files={repo.files} />
              </div>
            )}
            {summary.check && (
              <div>
                <div className="text-xs font-medium text-muted">What to check</div>
                <Rich text={summary.check} files={repo.files} />
              </div>
            )}
            {phase === 'done' &&
              summary.followUps
                ?.filter((f) => repo.modules.some((m) => m.id === f.moduleId))
                .map((f) => (
                  <div key={f.moduleId} className="rounded-lg border border-edge bg-panel p-2">
                    <div className="text-xs text-muted">Incomplete without {repo.modules.find((m) => m.id === f.moduleId)?.name}: {f.description}</div>
                    <button
                      type="button"
                      onClick={() => void followUp(f)}
                      className="bounce-hover mt-1.5 flex items-center gap-1 rounded-full bg-amber px-3 py-1 text-xs font-medium text-ink"
                    >
                      <Sparkles size={12} /> Apply the {repo.modules.find((m) => m.id === f.moduleId)?.name} side too
                    </button>
                  </div>
                ))}
          </div>
        )}
      </div>

      <div className="border-t border-edge p-3">
        {suggestions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map((x) => (
              <button
                key={x.label}
                type="button"
                onClick={() => useTavern.getState().openWhatIf({ kind: 'diff', diff: suggestionDiff(repo.files, x)!, title: x.label, path: x.path })}
                className="rounded-full border border-edge px-2.5 py-1 text-xs text-cream/80 transition-colors hover:border-amber hover:text-cream"
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
        {describePath && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              describe(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Describe a change to ${describePath.split('/').pop()}`}
              className="min-w-0 flex-1 rounded-full border border-edge bg-ink px-4 py-2 text-cream placeholder:text-muted/60 focus:border-amber focus:outline-none"
            />
            <button type="submit" disabled={!input.trim()} className="bounce-hover rounded-full bg-amber px-4 text-sm font-medium text-ink disabled:opacity-50">
              Preview
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
