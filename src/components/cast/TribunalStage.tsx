'use client';
// The Tribunal's courtroom: the suspects in a row, the Judge behind its bench, the Landlord in the gallery.
// Load with next/dynamic (ssr: false): it pulls in three.js.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Module, Mood } from '@/lib/types';
import { CastCanvas, CastLights, Character3D } from './Character3D';
import { getActor } from './anim/actor';
import { judgeVerdict } from './anim/director';

// Suspect spots either side of the bench, inner pair first (2-4 suspects).
const SLOTS = [-1.85, 1.85, -3.4, 3.4];
const JUDGE = 'trib:judge';
const id = (m: string) => `trib:${m}`;

export type TribunalStageProps = {
  suspects: string[];
  modules: Module[];
  moods: Record<string, Mood>;
  colors: Record<string, string | undefined>;
  title: (id: string) => string;
  /** Set when the verdict lands: the Judge performs it, then culprits look guilty and the rest happy. */
  verdict: { culprits: string[] } | null;
  fallback: ReactNode;
};

export default function TribunalStage({ suspects, modules, moods, colors, title, verdict, fallback }: TribunalStageProps) {
  const xs = useMemo(() => SLOTS.slice(0, suspects.length).sort((a, b) => a - b), [suspects.length]);
  const landlordX = Math.max(...xs, 0) + 1.9;
  const left = Math.min(...xs, 0) - 0.9;
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  // The verdict being performed: everyone's store mood is held back until the Judge is done.
  const [performed, setPerformed] = useState<object | null>(null);
  const performing = !!verdict && performed !== verdict;
  useEffect(() => {
    if (!verdict) return;
    let live = true;
    for (const s of suspects) getActor(id(s))?.setMood('idle');
    const innocents = suspects.filter((s) => !verdict.culprits.includes(s));
    void judgeVerdict(JUDGE, verdict.culprits.map(id), innocents.map(id)).then(() => live && setPerformed(verdict));
    // Actors outlive this canvas (the registry keeps them by id): the next hearing starts without soot or bruises.
    return () => {
      live = false;
      for (const a of [JUDGE, 'trib:landlord', ...suspects.map(id)]) getActor(a)?.reset();
    };
  }, [verdict, suspects]);

  return (
    <div className="relative h-44 border-b border-edge bg-ink/40">
      <CastCanvas camera={{ fov: 30, position: [0, 1.6, 9] }} fallback={fallback}>
        <Fit cx={(left + landlordX + 0.9) / 2} half={(landlordX + 0.9 - left) / 2} />
        <CastLights />
        <Character3D actor={JUDGE} archetype="judge" detail="lite" position={[0, 0, -0.8]} ambient={false} clicks={false} />
        <Character3D actor="trib:landlord" archetype="landlord" keys={modules.length} detail="lite" position={[landlordX, 0, -0.6]} scale={0.9} ambient={false} clicks={false} />
        {suspects.map((s, i) => (
          <Character3D
            key={s}
            actor={id(s)}
            module={modules.find((m) => m.id === s)}
            cast={modules}
            color={colors[s]}
            detail="lite"
            position={[xs[i], 0, Math.abs(xs[i]) > 2 ? 0.55 : 0.7]}
            mood={performing ? 'idle' : (moods[s] ?? 'idle')}
            ambient={false}
            clicks={false}
          />
        ))}
        <Labels at={suspects.map((_, i) => [xs[i], 0, Math.abs(xs[i]) > 2 ? 0.55 : 0.7])} els={labels} />
      </CastCanvas>
      {suspects.map((s, i) => (
        <div
          key={s}
          ref={(el) => {
            labels.current[i] = el;
          }}
          className="pointer-events-none invisible absolute top-0 left-0 w-24 text-center text-xs leading-tight text-cream/80"
        >
          {title(s)}
        </div>
      ))}
    </div>
  );
}

/** Backs the camera off until the whole courtroom fits the panel, whatever its shape. */
function Fit({ cx, half }: { cx: number; half: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const { width, height } = useThree((s) => s.size);
  useLayoutEffect(() => {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(half / (t * (width / height)), 1.45 / t) + 0.7;
    camera.position.set(cx, 1.3, d);
    camera.lookAt(cx, 0.85, 0);
  }, [camera, width, height, cx, half]);
  return null;
}

/** Names under the suspects' feet, moved every frame (DOM, so they stay crisp). */
function Labels({ at, els }: { at: [number, number, number][]; els: RefObject<(HTMLDivElement | null)[]> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) =>
    at.forEach((p, i) => {
      const el = els.current[i];
      if (!el) return;
      v.set(...p).project(camera);
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px,${((1 - v.y) / 2) * size.height + 2}px) translate(-50%,0)`;
      el.style.visibility = 'visible';
    }),
  );
  return null;
}
