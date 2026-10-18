'use client';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { rememberTour, useTavern } from '@/lib/store';
import { fileChart, moduleChart } from '@/lib/diagram';
import { aboutFallback, buildingFacts, captions, landlordIntro, landlordLine, landlordOutro, tourOrder, UNREACHABLE, type Facts } from '@/lib/landlord';
import { blipText, unlockAudio } from '@/lib/blips';
import Mermaid, { type MermaidHandle } from './Mermaid';
import { CharacterStage } from './cast/Character3D';
import { useCast3D } from './cast/settings';
import { getActor } from './cast/anim/actor';
import BlueprintCast, { MAX_3D, useBlueprint } from './BlueprintCast';
import { LandlordPortrait, ModuleFace } from './Portrait';

const NS = 'http://www.w3.org/2000/svg';
const CARD = 250; // px the tour card covers at the bottom; focus keeps the stop above it
type Slot = { id: string; face: HTMLElement; caption: HTMLElement | null; node: Element };

/** A div in a new foreignObject inside `parent` (SVG units), so React content pans and zooms with the diagram. */
function slot(parent: Element, x: number, y: number, w: number, h: number) {
  const fo = document.createElementNS(NS, 'foreignObject');
  for (const [k, v] of Object.entries({ x, y, width: w, height: h })) fo.setAttribute(k, String(v));
  const div = document.createElement('div');
  div.style.cssText = 'width:100%;height:100%';
  fo.appendChild(div);
  parent.appendChild(fo);
  return div;
}
const nodeEl = (svg: SVGSVGElement, rid: string, nid?: string) => (nid ? svg.querySelector<SVGGElement>(`[id^="${rid}-flowchart-${nid}-"]`) : null);

/** Modules (deterministic, no AI): who imports and calls whom, with faces and graph-fact captions; the tour runs here. */
export default function DiagramView() {
  const repo = useTavern((s) => s.repo)!;
  const graph = useTavern((s) => s.graph)!;
  const characters = useTavern((s) => s.characters);
  const moods = useTavern((s) => s.moods);
  const spice = useTavern((s) => s.spice);
  const tourOn = useTavern((s) => s.tourOn);
  const threeD = useCast3D((s) => s.on);
  const [drill, setDrill] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [svg, setSvg] = useState<{ el: SVGSVGElement; rid: string } | null>(null);
  const mer = useRef<MermaidHandle>(null);

  const names = useMemo(() => Object.fromEntries(repo.modules.map((m) => [m.id, m.name])), [repo]);
  const titles = useMemo(() => Object.fromEntries(repo.modules.map((m) => [m.id, characters[m.id]?.name ?? m.name])), [repo, characters]);
  const facts = useMemo(() => buildingFacts(graph, repo.modules), [graph, repo]);
  const caps = useMemo(() => captions(facts, spice, (id) => names[id] ?? id), [facts, spice, names]);
  const mod = tourOn ? undefined : repo.modules.find((m) => m.id === drill);
  const chart = useMemo(
    () => (mod ? fileChart(mod, repo.files, graph, (id) => names[id] ?? id) : moduleChart(repo.modules, graph, (id) => titles[id] ?? id, facts.cycleEdges)),
    [mod, repo, graph, names, titles, facts],
  );

  const onReady = (el: SVGSVGElement | null, rid: string) => {
    setSlots([]);
    setSvg(el ? { el, rid } : null);
    if (!el) return;
    if ('ext' in chart) {
      for (const [path, nid] of chart.ids) nodeEl(el, rid, nid)?.addEventListener('click', () => useTavern.getState().openFile(path));
      for (const [id, nid] of chart.ext) nodeEl(el, rid, nid)?.addEventListener('click', () => setDrill(id));
      el.querySelectorAll('g.node').forEach((g) => g.classList.add('cite-target'));
      return;
    }
    const found: Slot[] = [];
    for (const m of repo.modules) {
      const nid = chart.ids.get(m.id)!;
      const g = nodeEl(el, rid, nid);
      if (!g) continue;
      const b = g.getBBox();
      // A sibling group at the node's position (Mermaid's .node styles would repaint a face inside the node).
      const extra = document.createElementNS(NS, 'g');
      extra.setAttribute('transform', g.getAttribute('transform') ?? '');
      extra.setAttribute('class', 'node-extra cite-target');
      extra.setAttribute('data-node', nid);
      g.parentNode?.appendChild(extra);
      // Face as a badge on the node's top-left corner (clear of edges and labels); caption under the node, as wide as it.
      found.push({ id: m.id, node: g, face: slot(extra, b.x - 30, b.y - 34, 60, 60), caption: caps.has(m.id) ? slot(extra, b.x - 14, b.y + b.height + 4, b.width + 28, 96) : null });
      const open = () => !useTavern.getState().tourOn && setDrill(m.id);
      g.classList.add('cite-target');
      g.addEventListener('click', open);
      extra.addEventListener('click', open);
    }
    setSlots(found);
  };

  return (
    <div className="relative flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5 text-sm">
        {mod ? (
          <>
            <button type="button" onClick={() => setDrill(null)} className="flex items-center gap-1 rounded-full border border-edge px-2.5 py-0.5 text-xs text-cream hover:border-amber">
              <ArrowLeft size={12} /> Back to modules
            </button>
            <span className="text-muted">
              {titles[mod.id]}: {mod.stats.fileCount} files. Click a file to open it.
            </span>
          </>
        ) : (
          <span className="text-muted">
            {repo.modules.length} modules, {graph.edges.length} connections. Click a module for its files.
          </span>
        )}
        {!tourOn && (
          <button
            type="button"
            onClick={() => (setDrill(null), useTavern.getState().startTour())}
            className="ml-auto flex items-center gap-1 rounded-full border border-edge px-2.5 py-0.5 text-xs text-cream hover:border-amber"
          >
            <RotateCcw size={12} /> Replay tour
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <Mermaid ref={mer} code={chart.code} fill onReady={onReady} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
        {/* Live characters on the modules' badges (the first MAX_3D); 3D off: the 2D faces in the badges. */}
        {threeD && !mod && slots.length > 0 && <BlueprintCast slots={slots} />}
        {!tourOn && (
          <div className="pointer-events-none absolute bottom-2 left-3 rounded-lg bg-panel/85 px-2 py-1 text-xs text-muted">
            Arrows point from the needy to the needed. Solid: imports. Dashed: talks over the network. Red: codependent.
          </div>
        )}
        {tourOn && svg && !('ext' in chart) && <Tour svg={svg.el} rid={svg.rid} ids={chart.ids} mer={mer} facts={facts} />}
      </div>
      {slots.map((s, i) => {
        const m = repo.modules.find((x) => x.id === s.id)!;
        if (threeD && i < MAX_3D) return null;
        return createPortal(
          <div className="flex h-full items-center justify-center">
            <ModuleFace id={m.id} size={54} mood={moods[m.id]} />
          </div>,
          s.face,
          `${s.id}-face`,
        );
      })}
      {slots.map(
        (s) =>
          s.caption &&
          createPortal(
            <p className="mx-auto w-fit rounded-md bg-white/90 px-1.5 py-0.5 text-center text-[15px] leading-snug text-[#8a4a1c] italic">{caps.get(s.id)}</p>,
            s.caption,
            `${s.id}-caption`,
          ),
      )}
    </div>
  );
}

type TourProps = { svg: SVGSVGElement; rid: string; ids: Map<string, string>; mer: RefObject<MermaidHandle | null>; facts: Facts };

/** The Landlord's guided tour: intro, then each module in the order a request travels, then the outro. */
function Tour({ svg, rid, ids, mer, facts }: TourProps) {
  const repo = useTavern((s) => s.repo)!;
  const graph = useTavern((s) => s.graph)!;
  const characters = useTavern((s) => s.characters);
  const moods = useTavern((s) => s.moods);
  const spice = useTavern((s) => s.spice);
  const mode = useTavern((s) => s.mode);
  const landlord = useTavern((s) => s.landlord);
  const reduced = !!useReducedMotion();
  const order = useMemo(() => tourOrder(graph, repo.modules), [graph, repo]);
  const stops = useMemo(() => ['@intro', ...order.order, '@outro'], [order]);
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(!reduced);
  const [speaking, setSpeaking] = useState(false);
  const stop = stops[i];
  const m = repo.modules.find((x) => x.id === stop);
  const char = m && characters[m.id];
  const nameOf = (id: string) => repo.modules.find((x) => x.id === id)?.name ?? id;
  const line = m
    ? char?.landlordLine || landlordLine(m, graph, facts, spice, nameOf)
    : stop === '@intro'
      ? landlord?.intro || landlordIntro(repo.name, repo.files, repo.modules, spice)
      : landlord?.outro || landlordOutro(repo.name, graph, repo.modules, facts, spice);
  const about = m && mode === 'beginner' ? char?.about || aboutFallback(m) : null;
  const last = i === stops.length - 1;
  const go = (k: number) => setI(Math.max(0, Math.min(stops.length - 1, k)));
  const end = (then?: () => void) => {
    useTavern.getState().endTour();
    then?.();
  };
  /** Skipped: the Landlord writes it up on the clipboard first. */
  const skip = () => {
    if (reduced) return end();
    void getActor('tour:landlord')?.play('annoyed', { priority: 2 });
    setAuto(false);
    setTimeout(() => end(), 1300);
  };

  // Each stop: dim the rest, glow this module and its edges, pan to it, and let it talk, then the Landlord.
  useEffect(() => {
    const nid = m && ids.get(m.id);
    const node = nodeEl(svg, rid, nid);
    const extra = nid ? svg.querySelector(`.node-extra[data-node="${nid}"]`) : null;
    const lit: Element[] = node ? [node, ...(extra ? [extra] : [])] : [];
    if (nid)
      svg.querySelectorAll('path.flowchart-link').forEach((p) => {
        const x = p.id.match(/L_(m\d+)_(m\d+)_\d+$/);
        if (x && (x[1] === nid || x[2] === nid)) lit.push(p);
      });
    svg.classList.toggle('tour-dim', !!node);
    lit.forEach((e) => e.classList.add('tour-focus'));
    if (node) mer.current?.focus(lit.slice(0, 2), { pad: 170, inset: CARD }); // the node at reading size, neighbours around it
    else mer.current?.reset();
    const s = useTavern.getState();
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (m && char) {
      s.setMood(m.id, 'talking');
      blipText(char.greeting, char.voicePitch, s.muted);
      timers.push(setTimeout(() => useTavern.getState().moods[m.id] === 'talking' && useTavern.getState().setMood(m.id, 'idle'), 2400));
    }
    const wait = m ? 1500 : 150;
    timers.push(setTimeout(() => (setSpeaking(true), blipText(line, 0.7, useTavern.getState().muted)), wait));
    timers.push(setTimeout(() => setSpeaking(false), wait + 2300));
    if (stop === '@outro') rememberTour(repo);
    useBlueprint.setState({ star: m?.id ?? null }); // it steps forward on its node
    return () => {
      useBlueprint.setState({ star: null });
      timers.forEach(clearTimeout);
      lit.forEach((e) => e.classList.remove('tour-focus'));
      svg.classList.remove('tour-dim');
      if (m && useTavern.getState().moods[m.id] === 'talking') useTavern.getState().setMood(m.id, 'idle');
    };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps -- one run per stop

  // Autoplay (~6s a stop; Expert moves faster). Off for reduced motion.
  useEffect(() => {
    if (!auto || reduced || last) return;
    const t = setTimeout(() => setI((x) => x + 1), mode === 'expert' ? 4200 : 6500);
    return () => clearTimeout(t);
  }, [i, auto, reduced, last, mode]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') setI((x) => Math.min(stops.length - 1, x + 1));
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      else if (e.key === 'Escape') useTavern.getState().endTour();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [stops.length]);

  const btn = 'flex items-center gap-1 rounded-full border border-edge bg-panel px-3 py-1 text-xs text-cream hover:border-amber';
  return (
    <div className="absolute inset-x-3 bottom-3 z-20 rounded-2xl border border-edge bg-panel/95 p-3 shadow-lg backdrop-blur-sm" onPointerDown={unlockAudio}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-medium text-cream">{stop === '@intro' ? 'The tour' : last ? 'End of the tour' : `Stop ${i} of ${order.order.length}`}</span>
        {m && i - 1 === order.firstUnreachable && <span className="italic">{UNREACHABLE}</span>}
        <div className="ml-auto flex gap-1">
          {stops.map((s, k) => (
            <button key={s} type="button" aria-label={`Go to stop ${k + 1}`} onClick={() => go(k)} className={`h-2 w-2 rounded-full ${k === i ? 'bg-amber' : 'bg-edge hover:bg-muted'}`} />
          ))}
        </div>
      </div>
      {m && char && (
        <div className="mt-2 flex items-start gap-2">
          <ModuleFace id={m.id} size={52} mood={moods[m.id]} />
          <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-edge bg-wood px-3 py-1.5 text-sm leading-snug text-cream">
            <div className="text-xs font-medium">{char.name}</div>
            {char.greeting}
            {about && <div className="mt-1 text-muted">{about}</div>}
          </div>
        </div>
      )}
      <div className="mt-2 flex items-start gap-2">
        <CharacterStage
          className="h-16 w-16 shrink-0"
          archetype="landlord"
          keys={repo.modules.length}
          detail="lite"
          actor="tour:landlord"
          mood={speaking ? 'talking' : 'idle'}
          ambient={false}
          clicks={false}
          camera={{ position: [0, 1.15, 4.0], fov: 30, rotation: [0, 0, 0] }}
          fallback={<LandlordPortrait size={52} talking={speaking} />}
        />
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm leading-snug text-cream">
          <div className="text-xs font-medium">The Landlord</div>
          {line}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {last ? (
          <>
            <button type="button" className={btn} onClick={() => end(() => (useTavern.getState().selectModule(order.entry), useTavern.getState().setView('code')))}>
              Ask a character
            </button>
            <button type="button" className={btn} onClick={() => end(() => useTavern.getState().setTribunal(true))}>
              Summon the Tribunal
            </button>
            <button type="button" className={btn} onClick={() => end(() => useTavern.getState().setView('map'))}>
              Explore the Neighbourhood
            </button>
            <button type="button" className={btn} onClick={() => end(() => useTavern.getState().setRoastOpen(true))}>
              Roast this repo
            </button>
          </>
        ) : (
          <>
            <button type="button" className={btn} disabled={i === 0} onClick={() => go(i - 1)}>
              <ChevronLeft size={13} /> Back
            </button>
            <button type="button" className={`${btn} bg-amber! text-ink!`} onClick={() => go(i + 1)}>
              Next <ChevronRight size={13} />
            </button>
            {!reduced && (
              <button type="button" className={btn} onClick={() => setAuto((a) => !a)} aria-pressed={auto}>
                {auto ? <Pause size={13} /> : <Play size={13} />} {auto ? 'Autoplay on' : 'Autoplay off'}
              </button>
            )}
            <button type="button" className={`${btn} ml-auto`} onClick={skip}>
              Skip tour
            </button>
          </>
        )}
      </div>
    </div>
  );
}
