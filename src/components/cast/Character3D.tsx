'use client';
// 3D cast members for any React Three Fiber scene. Load this module with next/dynamic (ssr: false):
// it pulls in three.js.
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, type Ref } from 'react';
import * as THREE from 'three';
import { Canvas, type CanvasProps, type ThreeEvent } from '@react-three/fiber';
import type { Module, ModuleStats } from '@/lib/types';
import { assignCast, type Archetype, type Variant } from '@/lib/cast';
import { faceTraits, hash, PALETTE } from '@/lib/characters';
import { buildCharacter, type Built } from './archetypes';
import { applyExpression, PRESETS, type CharacterRig, type Expression } from './rig';

export type { CharacterRig, Expression };

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
  position?: [number, number, number];
  scale?: number;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  /** Called with each new build (triangle counts, rig). */
  onBuilt?: (b: Built) => void;
  /** Resolves to the rig, for animation. */
  ref?: Ref<CharacterRig | null>;
};

export function Character3D({ module, stats, archetype, variant, expression = 'deadpan', color, cast, silhouette = false, keys, position, scale, onClick, onBuilt, ref }: Character3DProps) {
  const s = stats ?? module?.stats ?? DEFAULT_STATS;
  const auto = useMemo(() => {
    if (archetype || !module) return null;
    const list = cast?.some((m) => m.id === module.id) ? cast : [module];
    return assignCast(list)[list.findIndex((m) => m.id === module.id)];
  }, [archetype, module, cast]);
  const a = archetype ?? auto?.archetype ?? 'clerk';
  const v = variant ?? auto?.variant ?? 0;
  const col = color ?? PALETTE[hash(module?.name ?? a) % PALETTE.length];
  const built = useMemo(() => buildCharacter({ archetype: a, variant: v, color: col, stats: s, silhouette, keys }), [a, v, col, s, silhouette, keys]);
  useEffect(() => () => built.dispose(), [built]);
  useLayoutEffect(() => {
    applyExpression(built.rig, expression === 'deadpan' ? built.neutral : PRESETS[expression], faceTraits(s));
  }, [built, expression, s]);
  useImperativeHandle(ref, () => built.rig, [built]);
  useEffect(() => onBuilt?.(built), [built, onBuilt]);
  return (
    <group position={position} scale={scale} onClick={onClick}>
      <primitive object={built.root} />
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

/** One character on its own canvas, with lighting and a ground disc. */
export function CharacterStage({ className, ...props }: Character3DProps & { className?: string }) {
  return (
    <div className={className}>
      <Canvas {...castCanvasProps} camera={{ position: [0, 1.0, 5.2], fov: 30, rotation: [0, 0, 0] }}>
        <CastLights />
        <mesh rotation-x={-Math.PI / 2}>
          <circleGeometry args={[1.4, 48]} />
          <meshBasicMaterial color="#f1f0ec" />
        </mesh>
        <Character3D {...props} />
      </Canvas>
    </div>
  );
}
