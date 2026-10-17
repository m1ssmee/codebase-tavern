'use client';
// 3D cast members for any React Three Fiber scene. Load this module with next/dynamic (ssr: false):
// it pulls in three.js.
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type CanvasProps, type ThreeEvent } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import type { Module, ModuleStats } from '@/lib/types';
import { assignCast, type Archetype, type Variant } from '@/lib/cast';
import { faceTraits, hash, PALETTE } from '@/lib/characters';
import CharacterFace from '@/components/CharacterFace';
import { buildCharacter, type Built, type Detail } from './archetypes';
import { setCastLook } from './kit';
import { applyExpression, PRESETS, type CharacterRig, type Expression } from './rig';
import { useCast3D } from './settings';

export type { CharacterRig, Detail, Expression };
export { useCast3D };

const DEFAULT_STATS: ModuleStats = { fileCount: 3, totalLines: 150, biggestFile: { path: '', lines: 80 }, todoCount: 0, maxNesting: 2, hasTests: true };

export type Character3DProps = {
  module?: Module;
  stats?: ModuleStats;
  /** Auto-assigned from the module when omitted. */
  archetype?: Archetype;
  variant?: Variant;
  expression?: Expression;
  /** Module colour; defaults to the same name-hash colour as the 2D face. */
  color?: string;
  /** All modules of the repo, so auto-assignment sees repeats and the largest unmatched module. */
  cast?: Module[];
  /** Solid black, no light effects or shadow. */
  silhouette?: boolean;
  /** Landlord only: keys on its ring, one per module. */
  keys?: number;
  /** full for big stages (chat header, /lab), lite for small ones; picked from on-screen size when omitted. */
  detail?: Detail;
  position?: [number, number, number];
  scale?: number;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  /** Called with each new build (triangle and draw-call counts, rig). */
  onBuilt?: (b: Built) => void;
  /** Resolves to the rig, for animation. Same joints at both detail levels. */
  ref?: Ref<CharacterRig | null>;
};

/** Picks full or lite from the character's height on screen, twice a second, with some hysteresis. */
function DetailProbe({ target, level, onChange }: { target: RefObject<THREE.Group | null>; level: Detail; onChange: (d: Detail) => void }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), s = new THREE.Vector3();
    const id = setInterval(() => {
      const o = target.current;
      if (!o) return;
      const { camera, size } = get();
      o.getWorldPosition(a);
      o.getWorldScale(s);
      b.copy(a).setY(a.y + 1.7 * s.y);
      a.project(camera);
      if (Math.abs(a.x) > 1.2 || a.z > 1) return; // off screen: nothing to gain from more detail
      const px = (Math.abs(b.project(camera).y - a.y) * size.height) / 2;
      const next: Detail = px > 260 ? 'full' : px < 200 ? 'lite' : level;
      if (next !== level) onChange(next);
    }, 500);
    return () => clearInterval(id);
  }, [get, target, level, onChange]);
  return null;
}

export function Character3D({ module, stats, archetype, variant, expression = 'deadpan', color, cast, silhouette = false, keys, detail, position, scale, onClick, onBuilt, ref }: Character3DProps) {
  const s = stats ?? module?.stats ?? DEFAULT_STATS;
  const auto = useMemo(() => {
    if (archetype || !module) return null;
    const list = cast?.some((m) => m.id === module.id) ? cast : [module];
    return assignCast(list)[list.findIndex((m) => m.id === module.id)];
  }, [archetype, module, cast]);
  const a = archetype ?? auto?.archetype ?? 'clerk';
  const v = variant ?? auto?.variant ?? 0;
  const col = color ?? PALETTE[hash(module?.name ?? a) % PALETTE.length];
  const [autoDetail, setAutoDetail] = useState<Detail>('lite');
  const level = detail ?? autoDetail;
  const group = useRef<THREE.Group>(null);
  const built = useMemo(() => buildCharacter({ archetype: a, variant: v, color: col, stats: s, silhouette, keys, detail: level }), [a, v, col, s, silhouette, keys, level]);
  useEffect(() => () => built.dispose(), [built]);
  useLayoutEffect(() => {
    applyExpression(built.rig, expression === 'deadpan' ? built.neutral : PRESETS[expression], faceTraits(s));
  }, [built, expression, s]);
  useImperativeHandle(ref, () => built.rig, [built]);
  useEffect(() => onBuilt?.(built), [built, onBuilt]);
  return (
    <group ref={group} position={position} scale={scale} onClick={onClick}>
      <primitive object={built.root} />
      {detail === undefined && <DetailProbe target={group} level={autoDetail} onChange={setAutoDetail} />}
    </group>
  );
}

/** Shared lighting preset for every scene with cast members: soft hemisphere, key, fill and rim. */
export function CastLights() {
  return (
    <>
      <hemisphereLight args={['#fff3e0', '#3d3029', 0.65]} />
      <directionalLight position={[3.5, 6, 5]} intensity={2.3} color="#fff4e2" />
      <directionalLight position={[-5, 2.5, 3]} intensity={0.35} color="#dfe7ff" />
      <directionalLight position={[-2.5, 4, -6]} intensity={1.1} color="#ffffff" />
    </>
  );
}

/** Shared canvas settings: anti-aliasing, DPR capped at 1.5, ACES tone mapping, sRGB output. */
export const castCanvasProps: Partial<CanvasProps> = {
  dpr: [1, 1.5],
  gl: { antialias: true },
  onCreated: ({ gl }) => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  },
};

/**
 * Sensor and actuator for resolution: PerformanceMonitor turns sustained fps into a factor, written to
 * R3F's performance.current; AdaptiveDpr then sets DPR = current x the starting DPR (down to half).
 */
function CastPerformance({ onSlow }: { onSlow?: () => void }) {
  const set = useThree((s) => s.set);
  const apply = useCallback(
    (factor: number) => set((st) => ({ performance: { ...st.performance, current: st.performance.min + (1 - st.performance.min) * factor } })),
    [set],
  );
  return (
    <>
      {/* Absolute bounds: drei's refresh-rate estimate is the best fps seen, which on a slow machine is the slow fps. */}
      <PerformanceMonitor factor={1} step={0.2} bounds={(hz) => (hz > 100 ? [60, 100] : [40, 55])} onChange={({ factor }) => apply(factor)} />
      <AdaptiveDpr />
      {onSlow && <SlowWatch onSlow={onSlow} />}
    </>
  );
}

/** Calls onSlow once fps has stayed under 30 for 5 seconds (after a 2 s warm-up; gaps from a hidden tab don't count). */
function SlowWatch({ onSlow }: { onSlow: () => void }) {
  useEffect(() => {
    const start = performance.now();
    let frames = 0, t0 = start, slowFor = 0, raf = 0;
    const tick = (now: number) => {
      frames++;
      const dt = now - t0;
      if (dt >= 1000) {
        if (dt < 2500 && now - start > 2000) slowFor = (frames * 1000) / dt < 30 ? slowFor + dt : 0;
        frames = 0;
        t0 = now;
        if (slowFor >= 5000) return onSlow();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onSlow]);
  return null;
}

const onVisibility = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
};

export type CastCanvasProps = Omit<CanvasProps, 'children'> & {
  children: ReactNode;
  /** Rendered instead when 3D characters are off (usually the 2D faces). */
  fallback?: ReactNode;
  /** Switch everyone to 2D faces if fps stays under 30 for 5 seconds (default on). */
  autoFallback?: boolean;
  /** Background the characters sit on: light (the app) keeps the rim subtle, dark raises it. */
  look?: 'light' | 'dark';
};

/**
 * The canvas for any scene with cast members: shared look and lights preset, adaptive resolution, no
 * rendering while the tab is hidden, and the 2D fallback when 3D is off or too slow.
 */
export function CastCanvas({ children, fallback = null, autoFallback = true, look = 'light', frameloop, ...props }: CastCanvasProps) {
  const on = useCast3D((s) => s.on);
  const tooSlow = useCast3D((s) => s.tooSlow);
  const hidden = useSyncExternalStore(onVisibility, () => document.hidden, () => false);
  useEffect(() => setCastLook(look), [look]);
  if (!on) return <>{fallback}</>;
  return (
    <Canvas {...castCanvasProps} {...props} frameloop={hidden ? 'never' : (frameloop ?? 'always')}>
      <CastPerformance onSlow={autoFallback ? tooSlow : undefined} />
      {children}
    </Canvas>
  );
}

/** "Switched to 2D faces" note with a way back; renders nothing unless the switch was automatic. */
export function CastFallbackNote({ className = '' }: { className?: string }) {
  const auto = useCast3D((s) => s.auto);
  const setOn = useCast3D((s) => s.setOn);
  if (!auto) return null;
  return (
    <div role="status" className={`flex items-center gap-2 rounded-md border border-edge bg-panel px-3 py-1.5 text-xs text-cream shadow-sm ${className}`}>
      Switched to 2D faces to keep things smooth.
      <button className="rounded border border-edge px-2 py-0.5 hover:bg-wood" onClick={() => setOn(true)}>
        Use 3D characters
      </button>
    </div>
  );
}

/** One character on its own canvas (full detail), with the 2D face as the fallback. */
export function CharacterStage({ className, ...props }: Character3DProps & { className?: string }) {
  const name = props.module?.name ?? props.archetype ?? 'character';
  return (
    <div className={className}>
      <CastCanvas
        camera={{ position: [0, 1.0, 5.2], fov: 30, rotation: [0, 0, 0] }}
        fallback={
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <CharacterFace name={name} stats={props.stats ?? props.module?.stats} color={props.color} size={120} />
            <CastFallbackNote />
          </div>
        }
      >
        <CastLights />
        <Character3D detail="full" {...props} />
      </CastCanvas>
    </div>
  );
}
