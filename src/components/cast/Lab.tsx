'use client';
// /lab: review page for the 3D cast. Not linked from the app. Zero API calls: quickcart comes from the
// saved demo data, express from a module snapshot in src/data.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Module, ModuleStats } from '@/lib/types';
import { ARCHETYPES, CAST, assignCast, type Archetype, type Variant } from '@/lib/cast';
import { assignColors, PALETTE } from '@/lib/characters';
import { detectModules } from '@/lib/analyze';
import demoRepo from '@/data/demoRepo.json';
import expressSnap from '@/data/expressModules.json';
import CharacterFace from '@/components/CharacterFace';
import { CastCanvas, CastFallbackNote, CastLights, Character3D, useCast3D } from './Character3D';
import { EXPRESSIONS, type Expression } from './rig';
import type { Built, Detail } from './archetypes';
import AnimBoard, { PerfMeter } from './AnimBoard';

type Scene = 'all' | 'quickcart' | 'express' | 'overlay' | 'map' | 'header';
type Slot = { key: string; label: string; sub: string; archetype: Archetype; variant: Variant; color: string; stats: ModuleStats; keys?: number };

/** Performance scenes, sized like where they'll live: canvas size, detail, and who's in it. */
const PERF: Record<'overlay' | 'map' | 'header', { label: string; w: number; h: number; detail: Detail }> = {
  overlay: { label: '3 lite (overlay)', w: 480, h: 240, detail: 'lite' },
  map: { label: '8 lite (map)', w: 1100, h: 520, detail: 'lite' },
  header: { label: '1 full (chat header)', w: 420, h: 380, detail: 'full' },
};
const isPerf = (s: Scene): s is keyof typeof PERF => s in PERF;

const REPOS: Record<'quickcart' | 'express', Module[]> = {
  quickcart: detectModules((demoRepo as { files: { path: string; content: string; lineCount: number }[] }).files),
  express: expressSnap.modules as Module[],
};
const castRows = (mods: Module[]) => assignCast(mods).map((c, i) => ({ module: mods[i], ...c }));
const SPACING = 2.15;
/** The app's real background (globals.css --color-ink), and the tavern's original dark theme. */
const APP_BG = '#ffffff';
const DARK = { bg: '#17110e', ground: '#211712', text: '#f6e7cf' };

function Spin({ on, children, x }: { on: boolean; children: React.ReactNode; x: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y = on ? ref.current.rotation.y + dt * 0.55 : 0;
  });
  return (
    <group ref={ref} position={[x, 0, 0]}>
      {children}
    </group>
  );
}

/** Keeps the DOM name labels under each character (plain DOM, not one React root per label). */
function LabelTracker({ xs, refs }: { xs: number[]; refs: React.RefObject<(HTMLDivElement | null)[]> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    xs.forEach((x, i) => {
      const el = refs.current[i];
      if (!el) return;
      v.set(x, -0.02, 0.9).project(camera);
      el.style.transform = `translate(-50%, 0) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    });
  });
  return null;
}

/** Frames the whole lineup, or one character when focused. */
function Framing({ focusX, width }: { focusX: number | null; width: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const { width: w, height: h } = useThree((s) => s.size);
  useEffect(() => {
    if (!controls) return;
    if (focusX !== null) {
      controls.target.set(focusX, 0.95, 0);
      camera.position.set(focusX + 0.9, 1.35, 5.2);
    } else {
      const tanH = Math.tan((15 * Math.PI) / 180) * (w / h);
      controls.target.set(0, 0.95, 0);
      camera.position.set(0, 1.45, Math.max(7, (width / 2 + 0.4) / tanH));
    }
    controls.update();
  }, [focusX, width, controls, camera, w, h]);
  return null;
}

const btn = (on: boolean) =>
  `rounded-md border px-2 py-1 text-xs transition-colors ${on ? 'border-amber bg-amber text-ink' : 'border-edge bg-panel text-cream hover:bg-wood'}`;

function Slider({ label, value, min, max, step = 1, onChange, fmt = String }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="flex justify-between text-muted">
        {label}
        <span className="font-mono text-cream">{fmt(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="accent-black" />
    </label>
  );
}

/** /lab shows the cast lab; /lab?board=1 the animation board. */
export default function LabRoot() {
  const [board] = useState(() => new URLSearchParams(window.location.search).has('board'));
  return board ? <AnimBoard /> : <Lab />;
}

function Lab() {
  // Deep links for review and measurement: /lab?scene=map (all, quickcart, express, overlay, map, header).
  const [scene, setScene] = useState<Scene>(() => {
    const q = new URLSearchParams(window.location.search).get('scene');
    return q && ['all', 'quickcart', 'express', 'overlay', 'map', 'header'].includes(q) ? (q as Scene) : 'all';
  });
  const [expression, setExpression] = useState<Expression>('deadpan');
  const [turntable, setTurntable] = useState(false);
  const [silhouette, setSilhouette] = useState(false);
  const [dark, setDark] = useState(false);
  const [variant, setVariant] = useState<Variant>(0);
  const [shift, setShift] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const [logLines, setLogLines] = useState(2.4);
  const [fileCount, setFileCount] = useState(4);
  const [todos, setTodos] = useState(1);
  const [nesting, setNesting] = useState(3);
  const [biggest, setBiggest] = useState(120);
  const [keys, setKeys] = useState(7);
  const [detailPick, setDetailPick] = useState<Detail | 'auto'>('full');
  const [autoFallback, setAutoFallback] = useState(true);
  const threeD = useCast3D((s) => s.on);
  const setThreeD = useCast3D((s) => s.setOn);
  const perf = useRef<HTMLSpanElement>(null);
  const [tris, setTris] = useState<Record<string, Built['tris']>>({});
  const labels = useRef<(HTMLDivElement | null)[]>([]);

  const stats = useMemo<ModuleStats>(
    () => ({ totalLines: Math.round(10 ** logLines), fileCount, todoCount: todos, maxNesting: nesting, biggestFile: { path: 'lab.ts', lines: biggest }, hasTests: true }),
    [logLines, fileCount, todos, nesting, biggest],
  );
  const cycle = useCallback((c: string) => PALETTE[(PALETTE.indexOf(c) + shift) % PALETTE.length], [shift]);
  const slots = useMemo<Slot[]>(() => {
    if (scene === 'all')
      return ARCHETYPES.map((a, i) => ({ key: a, label: CAST[a].name, sub: variant && a !== 'landlord' ? 'alternate props' : '', archetype: a, variant, color: PALETTE[(i + shift) % PALETTE.length], stats, keys }));
    if (scene === 'header') return [{ key: 'plumber', label: 'The Plumber', sub: 'heaviest character, full detail', archetype: 'plumber', variant: 0, color: PALETTE[(7 + shift) % PALETTE.length], stats }];
    const mods = REPOS[scene === 'express' ? 'express' : 'quickcart'], colors = assignColors(mods);
    // The Landlord narrates every repo: first in line, one key per module, a colour no tenant uses.
    const free = PALETTE.find((p) => !Object.values(colors).includes(p)) ?? '#c38bff';
    const cast: Slot[] = [
      { key: 'landlord', label: 'The Landlord', sub: `narrator · ${mods.length} keys`, archetype: 'landlord' as const, variant: 0 as Variant, color: cycle(free), stats, keys: mods.length },
      ...castRows(mods).map((r) => ({
        key: r.module.id, label: r.module.name, sub: `${CAST[r.archetype].name}${r.variant ? ' (alt)' : ''}`,
        archetype: r.archetype, variant: r.variant, color: cycle(colors[r.module.id]), stats: r.module.stats,
      })),
    ];
    return scene === 'overlay' ? [cast[0], cast[1], cast[5]] : cast;
  }, [scene, variant, shift, stats, cycle, keys]);
  const detail: Detail | undefined = isPerf(scene) ? PERF[scene].detail : detailPick === 'auto' ? undefined : detailPick;
  const xs = slots.map((_, i) => (i - (slots.length - 1) / 2) * SPACING);
  const onBuilt = useCallback((key: string, b: Built) => {
    setTris((t) => (t[key]?.base === b.tris.base && t[key]?.outline === b.tris.outline && t[key]?.calls === b.tris.calls ? t : { ...t, [key]: b.tris }));
  }, []);
  const focused = focus === null ? null : slots[focus];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-ink text-cream">
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-edge p-4 text-sm">
        <div>
          <h1 className="font-display text-2xl">Cast lab</h1>
          <a href="/lab?board=1" className="text-xs text-muted underline">Animation board →</a>
          <p className="text-xs text-muted">Review page for the 3D characters. Click a character to focus, drag to orbit.</p>
        </div>
        <section className="flex flex-wrap gap-1.5" aria-label="Scene">
          {(['all', 'quickcart', 'express'] as Scene[]).map((s) => (
            <button key={s} className={btn(scene === s)} onClick={() => { setScene(s); setFocus(null); }}>
              {s === 'all' ? 'All archetypes' : `Cast: ${s}`}
            </button>
          ))}
        </section>
        <section className="flex flex-col gap-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Detail {isPerf(scene) && '(set by the perf scene)'}</h2>
          <div className="flex flex-wrap gap-1.5">
            {(['full', 'lite', 'auto'] as const).map((d) => (
              <button key={d} className={btn(!isPerf(scene) && detailPick === d)} disabled={isPerf(scene)} onClick={() => setDetailPick(d)}>
                {d === 'auto' ? 'Auto (on-screen size)' : d}
              </button>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Perf scenes</h2>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PERF) as (keyof typeof PERF)[]).map((k) => (
              <button key={k} className={btn(scene === k)} onClick={() => { setScene(k); setFocus(null); }}>
                {PERF[k].label}
              </button>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Expression</h2>
          <div className="flex flex-wrap gap-1.5">
            {EXPRESSIONS.map((e) => (
              <button key={e} className={btn(expression === e)} onClick={() => setExpression(e)}>
                {e}
              </button>
            ))}
          </div>
        </section>
        <section className="flex flex-wrap gap-1.5">
          <button className={btn(turntable)} onClick={() => setTurntable((v) => !v)}>Turntable</button>
          <button className={btn(silhouette)} onClick={() => setSilhouette((v) => !v)}>Silhouette</button>
          <button className={btn(dark)} onClick={() => setDark((v) => !v)}>Dark background</button>
          <button className={btn(variant === 1)} disabled={scene !== 'all'} onClick={() => setVariant((v) => (v ? 0 : 1))}>Alternate props</button>
          <button className={btn(false)} onClick={() => setShift((v) => (v + 1) % PALETTE.length)}>Cycle colours</button>
          <button className={btn(threeD)} onClick={() => setThreeD(!threeD)}>3D characters: {threeD ? 'on' : 'off'}</button>
          <button className={btn(autoFallback)} onClick={() => setAutoFallback((v) => !v)}>Auto 2D when slow</button>
          {focus !== null && <button className={btn(false)} onClick={() => setFocus(null)}>Show all</button>}
        </section>
        <section className={`flex flex-col gap-2 ${scene !== 'all' ? 'opacity-40' : ''}`}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Stats {scene !== 'all' && '(real stats in cast view)'}</h2>
          <Slider label="Total lines" value={logLines} min={1} max={4.3} step={0.05} onChange={setLogLines} fmt={(v) => Math.round(10 ** v).toLocaleString('en')} />
          <Slider label="File count" value={fileCount} min={1} max={30} onChange={setFileCount} />
          <Slider label="TODOs (5+ shifty eyes)" value={todos} min={0} max={12} onChange={setTodos} />
          <Slider label="Max nesting (6+ spiral eyes)" value={nesting} min={0} max={12} onChange={setNesting} />
          <Slider label="Biggest file lines (300+ sweat)" value={biggest} min={10} max={1500} step={10} onChange={setBiggest} />
          <Slider label="Landlord keys (one per module)" value={keys} min={1} max={16} onChange={setKeys} />
        </section>
        {focused && (
          <section className="rounded-md border border-edge p-2 text-xs">
            <p className="font-semibold">{CAST[focused.archetype].name}</p>
            <p className="text-muted">{CAST[focused.archetype].joke}</p>
          </section>
        )}
        {(['quickcart', 'express'] as const).map((repo) => (
          <section key={repo} className="flex flex-col gap-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Cast for {repo}</h2>
            <table className="text-xs">
              <tbody>
                {castRows(REPOS[repo]).map((r) => (
                  <tr key={r.module.id}>
                    <td className="pr-2 font-mono">{r.module.name}</td>
                    <td>{CAST[r.archetype].name}{r.variant ? ' (alt)' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <section className="flex flex-col gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Performance</h2>
          <span ref={perf} className="font-mono text-xs" data-testid="perf">measuring…</span>
        </section>
        <section className="flex flex-col gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Per character: triangles (body + outline) · draw calls</h2>
          <table className="text-xs" data-testid="tris">
            <tbody>
              {slots.map((s) => (
                <tr key={s.key}>
                  <td className="pr-2">{s.label}</td>
                  <td className="font-mono">{((t) => (t ? `${t.base} + ${t.outline} = ${t.base + t.outline} · ${t.calls}` : '…'))(tris[`${scene}:${detail ?? 'auto'}:${s.key}`])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </aside>
      <main className="relative flex min-w-0 flex-1 items-center justify-center" style={{ background: silhouette || !dark ? APP_BG : DARK.bg }}>
        <div
          className="relative"
          data-testid="stage"
          style={isPerf(scene) ? { width: PERF[scene].w, height: PERF[scene].h, outline: '1px dashed #d4d4d4' } : { width: '100%', height: '100%' }}
        >
          <CastCanvas
            camera={{ fov: 30, position: [0, 1.45, 22] }}
            look={dark && !silhouette ? 'dark' : 'light'}
            autoFallback={autoFallback}
            fallback={
              <div className="flex h-full w-full flex-col items-center justify-center gap-6">
                <div className="flex flex-wrap items-end justify-center gap-6">
                  {slots.map((s) => (
                    <div key={s.key} className="flex flex-col items-center gap-1">
                      <CharacterFace name={s.label} stats={s.stats} color={s.color} size={isPerf(scene) && scene !== 'header' ? 56 : 96} />
                      <span className="text-[11px] font-semibold" style={{ color: dark ? DARK.text : undefined }}>{s.label}</span>
                    </div>
                  ))}
                </div>
                <CastFallbackNote />
              </div>
            }
          >
            <color attach="background" args={[silhouette || !dark ? APP_BG : DARK.bg]} />
            <CastLights />
            {!silhouette && dark && (
              <mesh rotation-x={-Math.PI / 2} position={[0, -0.001, 0]}>
                <circleGeometry args={[30, 64]} />
                <meshBasicMaterial color={DARK.ground} />
              </mesh>
            )}
            {slots.map((s, i) => (
              <Spin key={s.key} on={turntable} x={xs[i]}>
                <Character3D
                  archetype={s.archetype}
                  variant={s.variant}
                  color={s.color}
                  stats={s.stats}
                  expression={expression}
                  silhouette={silhouette}
                  keys={s.keys}
                  detail={detail}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocus(i);
                  }}
                  onBuilt={(b) => onBuilt(`${scene}:${detail ?? 'auto'}:${s.key}`, b)}
                />
              </Spin>
            ))}
            <OrbitControls makeDefault target={[0, 0.95, 0]} maxPolarAngle={Math.PI / 2 - 0.02} />
            <Framing focusX={focus === null ? null : xs[focus]} width={slots.length * SPACING} />
            <LabelTracker xs={xs} refs={labels} />
            <PerfMeter out={perf} />
          </CastCanvas>
          {threeD &&
            !silhouette &&
            slots.map((s, i) => (
              <div
                key={s.key}
                ref={(el) => {
                  labels.current[i] = el;
                }}
                data-testid="label"
                className="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-center leading-tight"
              >
                <div className="text-[11px] font-semibold" style={{ color: dark ? DARK.text : undefined }}>{s.label}</div>
                {s.sub && <div className="text-[10px] text-muted">{s.sub}</div>}
              </div>
            ))}
        </div>
      </main>
    </div>
  );
}
