'use client';
// /lab animation board: every clip and gag per character, the director's events, and scripted skits played
// end to end (Tribunal, pester, roast, what-if, pointing at a mock code panel, float demo). Spice selector
// (clean included), reduced motion, mute, cooldown bypass. Deep links for recording:
// /lab?board=1&skit=tribunal&spice=feral&clean=1 runs a skit on load; window.__skit is 'running' then 'done'.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { ModuleStats, SpiceLevel } from '@/lib/types';
import { ARCHETYPES, CAST, type Archetype } from '@/lib/cast';
import { PALETTE } from '@/lib/characters';
import { useTavern } from '@/lib/store';
import demoRepo from '@/data/demoRepo.json';
import { CastCanvas, CastLights, Character3D } from './Character3D';
import type { Detail } from './archetypes';
import { useCastAnim } from './settings';
import { getActor } from './anim/actor';
import { GAG_NAMES, SHARED_NAMES } from './anim/clips';
import { wait } from './anim/core';
import * as director from './anim/director';

type Spot = { id: Archetype; x: number; z?: number };
type Stage = { key: string; cast: Spot[]; cam: [number, number, number]; target: [number, number, number]; panel?: boolean; caption?: string };
const row = (ids: Archetype[], gap: number, z = 0): Spot[] => ids.map((id, i) => ({ id, x: (i - (ids.length - 1) / 2) * gap, z }));
const STAGES: Record<string, Stage> = {
  all: { key: 'all', cast: row([...ARCHETYPES], 1.75), cam: [0, 2.3, 19.5], target: [0, 1.0, 0] },
  tribunal: {
    key: 'tribunal', caption: 'Tribunal: the Inspector accuses the Junk Drawer · culprits: Junk Drawer, Accountant',
    cast: [{ id: 'landlord', x: 0, z: -0.4 }, { id: 'inspector', x: -3.3, z: 0.5 }, { id: 'junkDrawer', x: -1.75, z: 0.6 }, { id: 'accountant', x: 1.75, z: 0.6 }, { id: 'star', x: 3.3, z: 0.5 }],
    cam: [0, 2.0, 10.5], target: [0, 1.0, 0],
  },
  pester: { key: 'pester', caption: 'Pester: three clicks in five seconds, then three more', cast: [{ id: 'bouncer', x: 0 }, { id: 'clerk', x: -1.9, z: -0.7 }, { id: 'doorman', x: 1.9, z: -0.7 }], cam: [0, 1.8, 6.8], target: [0, 0.95, 0] },
  roast: { key: 'roast', caption: 'Roast: the Accountant gets roasted', cast: [{ id: 'accountant', x: 0 }, { id: 'clerk', x: -1.9 }, { id: 'plumber', x: 1.9 }], cam: [0, 1.9, 7.6], target: [0, 0.95, 0] },
  whatif: { key: 'whatif', caption: 'What-if: breaks (Junk Drawer, Star) · at risk (Accountant) · fine (Doorman) · relieved (Plumber, Librarian)', cast: row(['junkDrawer', 'star', 'accountant', 'doorman', 'plumber', 'librarian'], 1.7), cam: [0, 2.0, 11.5], target: [0, 1.0, 0] },
  pointing: { key: 'pointing', caption: 'Pointing: line 46, then lines 44-52', cast: [{ id: 'bouncer', x: -1.55 }], cam: [0, 1.25, 6.4], target: [0, 1.0, 0], panel: true },
  float: { key: 'float', caption: 'Float demo: every float style', cast: row([...ARCHETYPES].slice(0, 6), 1.8), cam: [0, 2.3, 12], target: [0, 1.25, 0] },
  solo: { key: 'solo', cast: [{ id: 'bouncer', x: 0 }], cam: [0, 1.35, 6.2], target: [0, 1.0, 0] },
  perf: { key: 'perf', cast: [{ id: 'landlord', x: -1.6 }, { id: 'plumber', x: 0 }, { id: 'junkDrawer', x: 1.6 }], cam: [0, 1.4, 8.5], target: [0, 0.9, 0] },
};
const STATS: ModuleStats = { totalLines: 250, fileCount: 4, todoCount: 1, maxNesting: 3, biggestFile: { path: 'board.ts', lines: 120 }, hasTests: true };
const colorOf = (id: Archetype) => PALETTE[ARCHETYPES.indexOf(id) % PALETTE.length];
const LANDLORD_EXTRAS = ['annoyed', 'rent', 'judgeIn', 'gavel', 'drawGun', 'fire', 'fireSoot', 'cannon', 'judgeOut', 'twerkRefuse', 'twerkNuke'];
const SPICES: SpiceLevel[] = ['clean', 'unhinged', 'feral', 'nuclear'];

const CHECKOUT = ((demoRepo as { files: { path: string; content: string }[] }).files.find((f) => f.path === 'orders/checkout.ts')?.content ?? '').split('\n');
const PANEL_FROM = 33, PANEL_TO = 57;

type Win = Window & { __skit?: string };
const setSkitFlag = (v: string) => ((window as Win).__skit = v);

/** Frame rate, draw calls and drawn triangles, written straight to the DOM once a second. */
export function PerfMeter({ out }: { out: React.RefObject<HTMLSpanElement | null> }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    let frames = 0, t0 = performance.now(), raf = 0;
    const tick = (now: number) => {
      frames++;
      if (now - t0 >= 1000 && out.current) {
        const { calls, triangles } = gl.info.render;
        out.current.textContent = `${Math.round((frames * 1000) / (now - t0))} fps · ${calls} draw calls · ${triangles.toLocaleString('en')} triangles · DPR ${gl.getPixelRatio().toFixed(2)} · frame ${gl.info.render.frame}`;
        frames = 0;
        t0 = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gl, out]);
  return null;
}

/** Puts the camera and the orbit target where the stage wants them, backing off until the whole row fits. */
function StageCamera({ stage }: { stage: Stage }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const { width, height } = useThree((s) => s.size);
  useEffect(() => {
    const xs = stage.cast.map((c) => c.x), half = (Math.max(...xs) - Math.min(...xs)) / 2 + 0.9;
    const fit = half / (Math.tan((15 * Math.PI) / 180) * (width / height));
    const [x, y, z] = stage.cam, k = Math.max(1, fit / z);
    camera.position.set(x, stage.target[1] + (y - stage.target[1]) * k, z * k);
    if (controls) {
      controls.target.set(...stage.target);
      controls.update();
    } else camera.lookAt(...stage.target);
  }, [stage, camera, controls, width, height]);
  return null;
}

const btn = (on: boolean, warn = false) =>
  `rounded-md border px-2 py-1 text-xs transition-colors ${on ? 'border-amber bg-amber text-ink' : warn ? 'border-red-300 bg-red-50 text-red-900 hover:bg-red-100' : 'border-edge bg-panel text-cream hover:bg-wood'}`;
const H = ({ children }: { children: React.ReactNode }) => <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{children}</h2>;

/** Waits until every actor of a stage is bound to its built character. */
async function bound(ids: string[]) {
  for (let i = 0; i < 300 && !ids.every((id) => getActor(id)?.bound); i++) await new Promise((r) => requestAnimationFrame(r));
  await wait(0.35);
}

export default function AnimBoard() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const [stage, setStage] = useState<Stage>(() => {
    const solo = q.get('solo') as Archetype | null;
    if (solo && ARCHETYPES.includes(solo)) return { ...STAGES.solo, cast: [{ id: solo, x: 0 }] };
    return STAGES[q.get('skit') === 'tribunals' ? 'tribunal' : (q.get('skit') ?? '')] ?? (q.get('perf') ? STAGES.perf : STAGES.all);
  });
  const [sel, setSel] = useState<Archetype>(() => (q.get('solo') as Archetype | null) ?? 'bouncer');
  const [detail, setDetail] = useState<Detail>(() => (q.get('detail') === 'lite' || q.get('perf') ? 'lite' : 'full'));
  const [status, setStatus] = useState('Pick a character, then a clip.');
  const [running, setRunning] = useState<string | null>(null);
  const [hl, setHl] = useState<[number, number] | null>(null);
  const [caption, setCaption] = useState('');
  const clean = q.get('clean') === '1';
  const perfOut = useRef<HTMLSpanElement>(null);
  const req = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const spice = useTavern((s) => s.spice);
  const setSpice = useTavern((s) => s.setSpice);
  const muted = useTavern((s) => s.muted);
  const toggleMute = useTavern((s) => s.toggleMute);
  const anim = useCastAnim();

  // Review handle for scripted screenshots and recordings (lab only).
  useEffect(() => {
    const solo = (id: Archetype, x = 0) => {
      setStage({ ...STAGES.solo, cast: [{ id, x }] });
      setSel(id);
    };
    (window as Win & { __cast?: unknown }).__cast = { getActor, director, wait, setSel, solo, setStage, stages: STAGES, anim: useCastAnim, tavern: useTavern };
  }, []);
  // URL settings apply once, before anything plays.
  useEffect(() => {
    const sp = q.get('spice') as SpiceLevel | null;
    if (sp && SPICES.includes(sp)) useTavern.getState().setSpice(sp);
    if (q.get('reduced')) useCastAnim.getState().set({ reduced: q.get('reduced') === '1' });
    if (q.get('mute') === '1' && !useTavern.getState().muted) useTavern.getState().toggleMute();
  }, [q]);

  const ids = stage.cast.map((c) => c.id);
  const play = useCallback(async (name: string) => {
    const a = getActor(sel);
    if (!a?.bound) return;
    const why = a.blocked(name);
    const fb = why && why !== 'missing' ? ` (${why === 'spice' ? `needs more spice than ${useTavern.getState().spice}` : why === 'cooldown' ? `cooling down, ${a.cooldown(name).toFixed(0)} s` : 'someone else is mid-gag'}: plays its clean fallback)` : '';
    setStatus(`${CAST[sel].name}: ${name}${fb}`);
    if (name === 'points') return void a.pointAt(a.world('root', [0.9, 1.25, 0.5]), { hold: 1.2 });
    if (name === 'floats') {
      await a.floatTo(a.world('root', [1.4, 0.4, 0.8]));
      await wait(0.3);
      return void a.home();
    }
    if (name === 'bonks') {
      // Bonk the nearest neighbour on the stage (never the Landlord).
      const me = stage.cast.find((c) => c.id === sel)!;
      const near = stage.cast.filter((c) => c.id !== sel && c.id !== 'landlord').sort((x, y) => Math.abs(x.x - me.x) - Math.abs(y.x - me.x))[0];
      return void (near && director.bonk(sel, near.id));
    }
    const id = ++req.current, ok = await a.play(name, { priority: 2 });
    if (!ok && id === req.current) setStatus((s) => `${s} · interrupted`);
  }, [sel, stage]);

  // ---------- skits ----------
  const point = (line: number): { client: [number, number] } => {
    const el = panel.current?.querySelector(`[data-line="${line}"]`) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return { client: r ? [r.left + 46, r.top + r.height / 2] : [0, 0] };
  };
  const enter = useCallback(async (st: Stage) => {
    setStage(st);
    setCaption(st.caption ?? '');
    await wait(0.05);
    await bound(st.cast.map((c) => c.id));
    for (const c of st.cast) getActor(c.id)?.reset();
    await wait(0.3);
  }, []);
  const SKITS: Record<string, () => Promise<void>> = useMemo(() => ({
    tribunal: async () => {
      await enter(STAGES.tribunal);
      await director.accuse('inspector', 'junkDrawer');
      await wait(0.4);
      await director.verdict(['junkDrawer', 'accountant'], ['inspector', 'star']);
      await wait(0.8);
    },
    tribunals: async () => {
      for (const s of SPICES) {
        useTavern.getState().setSpice(s);
        await SKITS.tribunal();
      }
    },
    pester: async () => {
      await enter(STAGES.pester);
      for (const round of [0, 1]) {
        setCaption(`Pester: three clicks (${round ? 'again' : 'first time'})`);
        for (let i = 0; i < 3; i++) {
          director.click('bouncer');
          await wait(0.3);
        }
        await wait(round ? 3.4 : 2.2);
      }
    },
    roast: async () => {
      await enter(STAGES.roast);
      await director.roast('accountant', ['clerk', 'plumber']);
      await wait(1.2);
    },
    whatif: async () => {
      await enter(STAGES.whatif);
      await director.whatIf({ breaks: ['junkDrawer', 'star'], atRisk: ['accountant'], fine: ['doorman'], relieved: ['plumber', 'librarian'] });
      await wait(0.8);
    },
    pointing: async () => {
      for (const id of ARCHETYPES) {
        await enter({ ...STAGES.pointing, cast: [{ id, x: -1.55 }] });
        const a = getActor(id)!;
        setCaption(`${CAST[id].name} points at line 46`);
        setHl([46, 46]);
        await a.pointAt(point(46), { hold: 1.1 });
        setCaption(`${CAST[id].name} sweeps lines 44-52`);
        setHl([44, 52]);
        await a.pointAt(point(44), { range: point(52), sweep: 1.2, hold: 0.5 });
        setHl(null);
        await wait(0.2);
      }
    },
    float: async () => {
      // Two groups, so every float style is big enough to see.
      for (const ids of [ARCHETYPES.slice(0, 6), ARCHETYPES.slice(6)]) {
        const st = { ...STAGES.float, cast: row([...ids], 1.8) };
        await enter(st);
        await Promise.all(st.cast.map((c, i) => wait(i * 0.3).then(async () => {
          const a = getActor(c.id)!;
          await a.floatTo(a.world('root', [0.6, 0.8, 1.3]));
          await wait(0.6);
          await a.home();
        })));
        await wait(0.6);
      }
    },
  }), [enter]);
  const runSkit = useCallback(async (name: string) => {
    if (!SKITS[name]) return;
    setRunning(name);
    setSkitFlag('running');
    const prevAmbient = useCastAnim.getState().ambient;
    useCastAnim.getState().set({ ambient: false });
    setStatus(`Skit: ${name} at ${useTavern.getState().spice}`);
    try {
      await SKITS[name]();
    } finally {
      useCastAnim.getState().set({ ambient: prevAmbient });
      setRunning(null);
      setSkitFlag('done');
    }
  }, [SKITS]);
  useEffect(() => {
    const skit = q.get('skit');
    if (!skit) return;
    const id = requestAnimationFrame(() => void wait(0.4).then(() => runSkit(skit)));
    return () => cancelAnimationFrame(id);
  }, [q, runSkit]);

  // Perf scene: three lite characters in an overlay-sized canvas, gags back to back.
  useEffect(() => {
    if (stage.key !== 'perf') return;
    let on = true;
    const GAGS = ['idle', 'happy', 'accused', 'middle', 'twerk', 'bonked', 'shrug', 'steam', 'fart', 'laugh', 'nervous', 'scream', 'slowClap'];
    void (async () => {
      await bound(ids);
      for (let i = 0; on; i++) {
        const id = ids[i % ids.length], a = getActor(id);
        void a?.play(GAGS[Math.floor(Math.random() * GAGS.length)], { priority: 1 });
        if (i % 5 === 4) void director.bonk(ids[(i + 1) % ids.length], ids[(i + 2) % ids.length]);
        await wait(0.9);
      }
    })();
    return () => {
      on = false;
    };
  }, [stage, ids]);

  const actor = getActor(sel);
  const clipList = [...GAG_NAMES, ...SHARED_NAMES, ...(sel === 'landlord' ? LANDLORD_EXTRAS : [])];
  const isPerf = stage.key === 'perf';

  return (
    <div className="flex h-screen w-full overflow-hidden bg-ink text-cream">
      {!clean && (
        <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-edge p-4 text-sm">
          <div>
            <a href="/lab" className="text-xs text-muted underline">← Cast lab</a>
            <h1 className="font-display text-2xl">Animation board</h1>
            <p className="text-xs text-muted">Every clip and gag per character, the director&apos;s events and the skits. Click a character to pick it (clicks also boing; three in five seconds is pestering).</p>
          </div>
          <section className="flex flex-col gap-1.5">
            <H>Spice</H>
            <div className="flex flex-wrap gap-1.5">
              {SPICES.map((s) => (
                <button key={s} className={btn(spice === s)} onClick={() => setSpice(s)}>{s}</button>
              ))}
            </div>
          </section>
          <section className="flex flex-wrap gap-1.5">
            <button className={btn(anim.reduced === true)} onClick={() => anim.set({ reduced: anim.reduced === true ? false : true })}>Reduced motion: {anim.reduced === true ? 'on' : 'off'}</button>
            <button className={btn(muted)} onClick={toggleMute}>Mute: {muted ? 'on' : 'off'}</button>
            <button className={btn(anim.ignoreCooldowns)} onClick={() => anim.set({ ignoreCooldowns: !anim.ignoreCooldowns })}>Ignore cooldowns</button>
            <button className={btn(anim.ambient)} onClick={() => anim.set({ ambient: !anim.ambient })}>Ambient idles</button>
            <button className={btn(anim.speed < 1)} onClick={() => anim.set({ speed: anim.speed < 1 ? 1 : 0.25 })}>Slow motion</button>
            {(['full', 'lite'] as const).map((d) => (
              <button key={d} className={btn(detail === d)} onClick={() => setDetail(d)}>{d}</button>
            ))}
          </section>
          <section className="flex flex-col gap-1.5">
            <H>Skits {running && `(running: ${running})`}</H>
            <div className="flex flex-wrap gap-1.5">
              {(['tribunal', 'tribunals', 'pester', 'roast', 'whatif', 'pointing', 'float'] as const).map((k) => (
                <button key={k} className={btn(running === k)} disabled={!!running} onClick={() => void runSkit(k)}>
                  {{ tribunal: 'Tribunal', tribunals: 'Tribunal at every spice', pester: 'Pester', roast: 'Roast', whatif: 'What-if', pointing: 'Pointing at code', float: 'Float demo' }[k]}
                </button>
              ))}
              <button className={btn(stage.key === 'all')} disabled={!!running} onClick={() => { setStage(STAGES.all); setCaption(''); }}>Free play (all 11)</button>
              <button className={btn(isPerf)} disabled={!!running} onClick={() => setStage(STAGES.perf)}>Overlay perf (3 lite, gags looping)</button>
              <button className={btn(stage.key === 'solo')} disabled={!!running} onClick={() => setStage({ ...STAGES.solo, cast: [{ id: sel, x: 0 }] })}>Solo: {CAST[sel].name.replace('The ', '')}</button>
            </div>
          </section>
          <section className="flex flex-col gap-1.5">
            <H>Character</H>
            <div className="flex flex-wrap gap-1">
              {ids.map((id) => (
                <button key={id} className={btn(sel === id)} onClick={() => setSel(id)}>{CAST[id].name.replace('The ', '')}</button>
              ))}
            </div>
            <p className="text-xs text-muted">{CAST[sel].joke}</p>
          </section>
          <section className="flex flex-col gap-1.5">
            <H>Clips and gags</H>
            <div className="flex flex-wrap gap-1">
              {clipList.map((n) => {
                const gated = !!actor?.bound && actor.has(n) && actor.blocked(n) === 'spice';
                return (
                  <button key={n} className={btn(false, gated)} title={gated ? 'Gated at this spice: plays the clean fallback' : ''} onClick={() => void play(n)}>{n}</button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1">
              {(['idle', 'talking', 'accused', 'guilty', 'happy'] as const).map((m) => (
                <button key={m} className={btn(false)} onClick={() => getActor(sel)?.setMood(m)}>mood: {m}</button>
              ))}
              <button className={btn(false)} onClick={() => getActor(sel)?.release()}>get up</button>
              <button className={btn(false)} onClick={() => ids.forEach((id) => getActor(id)?.reset())}>reset all</button>
            </div>
          </section>
          <section className="flex flex-col gap-1.5">
            <H>Events (on this stage)</H>
            <div className="flex flex-wrap gap-1">
              {(() => {
                const i = ids.indexOf(sel), next = ids[(i + 1) % ids.length], prev = ids[(i - 1 + ids.length) % ids.length];
                const others = ids.filter((x) => x !== sel && x !== 'landlord');
                const list: [string, () => unknown][] = [
                  ['pester (3 clicks)', async () => { for (let k = 0; k < 3; k++) { director.click(sel); await wait(0.25); } }],
                  ['out of scope', () => director.outOfScope(sel, next)],
                  ['roast', () => director.roast(sel, [prev, next])],
                  ['accuse next', () => director.accuse(sel, next)],
                  ['verdict', () => director.verdict([sel, next].filter((x) => x !== 'landlord'), others.filter((x) => x !== next))],
                  ['what-if', () => director.whatIf({ breaks: [sel], atRisk: [next], fine: [prev], relieved: others.slice(0, 2) })],
                  ['complete fix', () => director.completeFix(ids)],
                  ['bored', () => director.bored(ids)],
                  ['undo', () => director.undo(ids)],
                  ['twerk-off', () => director.twerkOff(sel, next)],
                ];
                return list.map(([label, fn]) => (
                  <button key={label} className={btn(false)} onClick={() => { setStatus(`Event: ${label}`); void fn(); }}>{label}</button>
                ));
              })()}
            </div>
          </section>
          <section className="flex flex-col gap-1">
            <H>Status</H>
            <p className="text-xs" data-testid="status">{status}</p>
            <span ref={perfOut} className="font-mono text-xs" data-testid="perf">measuring…</span>
          </section>
        </aside>
      )}
      <main className="relative flex min-w-0 flex-1 items-center justify-center bg-ink">
        <div className="relative" data-testid="stage" style={isPerf ? { width: 480, height: 240, outline: '1px dashed #d4d4d4' } : { width: '100%', height: '100%' }}>
          {stage.panel && (
            <div ref={panel} className="absolute right-[4%] top-[14%] w-[50%] rounded-lg border border-edge bg-[#fbfbfa] py-2 font-mono text-[12.5px] leading-[19px] shadow-sm">
              <div className="px-3 pb-1 text-[11px] text-muted">orders/checkout.ts</div>
              {CHECKOUT.slice(PANEL_FROM - 1, PANEL_TO).map((l, i) => {
                const n = PANEL_FROM + i, on = hl && n >= hl[0] && n <= hl[1];
                return (
                  <div key={n} data-line={n} className="flex whitespace-pre" style={{ background: on ? '#fff3b0' : undefined }}>
                    <span className="w-9 shrink-0 pr-2 text-right text-muted">{n}</span>
                    <span className="truncate">{l}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="absolute inset-0">
            <CastCanvas camera={{ fov: 30, position: stage.cam }} autoFallback={false}>
              <CastLights />
              {stage.cast.map((c) => (
                <Character3D
                  key={c.id}
                  actor={c.id}
                  archetype={c.id}
                  variant={0}
                  color={colorOf(c.id)}
                  stats={STATS}
                  keys={7}
                  detail={detail}
                  position={[c.x, 0, c.z ?? 0]}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSel(c.id);
                  }}
                />
              ))}
              <OrbitControls makeDefault target={stage.target} maxPolarAngle={Math.PI / 2 - 0.02} />
              <StageCamera stage={stage} />
              <PerfMeter out={perfOut} />
            </CastCanvas>
          </div>
          {(caption || clean) && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-white/85 px-2 py-1 text-xs text-cream shadow-sm">
              {caption}
              <span className="ml-2 font-semibold">spice: {spice}</span>
              {anim.reduced && <span className="ml-2">reduced motion</span>}
            </div>
          )}
          {clean && <span ref={perfOut} className="pointer-events-none absolute bottom-2 right-3 font-mono text-[10px] text-muted" data-testid="perf" />}
        </div>
      </main>
    </div>
  );
}
