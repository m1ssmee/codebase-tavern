'use client';
// /lab?portraits=1: every archetype (the Landlord and the Judge too) in every palette colour, rendered one at a time
// as a neutral head-and-shoulders portrait, for `npm run portraits` to save in public/portraits/. Not linked anywhere.
import { useCallback, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ARCHETYPES, type Archetype } from '@/lib/cast';
import { PALETTE } from '@/lib/characters';
import { castCanvasProps, CastLights, Character3D } from './Character3D';
import type { Built } from './archetypes';

const OUT = 128; // saved size (px)
const RENDER = 256; // rendered at twice that, then scaled down
const JOBS = ARCHETYPES.flatMap((a) => PALETTE.map((color) => ({ a, color })));
const nameOf = (a: Archetype, color: string) => `${a}-${color.slice(1).toLowerCase()}`;
/** Per-build framing: below 1 is closer (wide heads and hats), above 1 further out. */
const ZOOM: Partial<Record<Archetype, number>> = { inspector: 0.55, junkDrawer: 0.8, landlord: 0.55, librarian: 0.7, judge: 0.9, star: 1.3, plumber: 1.1 };

type Out = { done: boolean; files: Record<string, string> };
const out = (): Out => ((window as unknown as { __portraits?: Out }).__portraits ??= { done: false, files: {} });

export default function Portraits() {
  const [i, setI] = useState(0);
  const job = JOBS[i];
  const next = useCallback(
    (url: string) => {
      out().files[nameOf(JOBS[i].a, JOBS[i].color)] = url;
      if (i + 1 >= JOBS.length) out().done = true;
      setI(i + 1);
    },
    [i],
  );
  return (
    <div className="p-6 text-sm text-muted">
      <p>
        Portraits: {Math.min(i, JOBS.length)} of {JOBS.length}
        {job ? ` (${nameOf(job.a, job.color)})` : ', done.'}
      </p>
      <Canvas {...castCanvasProps} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }} dpr={1} camera={{ fov: 24, position: [0, 1, 6] }} style={{ width: RENDER, height: RENDER, background: 'transparent' }}>
        <CastLights />
        {job && <Sitter key={i} a={job.a} color={job.color} onDone={next} />}
      </Canvas>
    </div>
  );
}

/** One portrait: build, frame the head and shoulders from the rig, let it settle a few frames, capture. */
function Sitter({ a, color, onDone }: { a: Archetype; color: string; onDone: (url: string) => void }) {
  const { gl, camera } = useThree();
  const [built, setBuilt] = useState<Built | null>(null);
  const [frames, setFrames] = useState(0);
  useFrame(() => {
    if (!built) return;
    if (frames === 0) {
      built.root.updateWorldMatrix(true, true);
      // Framed on the eyes and the head's width, so a tall hat is cropped rather than shrinking the face.
      const head = new THREE.Box3().setFromObject(built.rig.head);
      const L = built.rig.eyeL.getWorldPosition(new THREE.Vector3()), R = built.rig.eyeR.getWorldPosition(new THREE.Vector3());
      const eyes = L.clone().add(R).multiplyScalar(0.5);
      const span = Math.max((head.max.x - head.min.x) * 1.75, L.distanceTo(R) * 5) * (ZOOM[a] ?? 1);
      const cy = eyes.y - span * 0.12;
      const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(12));
      camera.position.set(eyes.x, cy + dist * 0.08, eyes.z + dist);
      camera.lookAt(eyes.x, cy, eyes.z);
      camera.updateProjectionMatrix();
    }
    // From the 4th frame: capture once something has been drawn (shaders compile in the background at first).
    if (frames >= 4 && frames % 4 === 0) {
      const small = document.createElement('canvas');
      small.width = small.height = OUT;
      const g = small.getContext('2d', { willReadFrequently: true })!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(gl.domElement, 0, 0, OUT, OUT);
      const px = g.getImageData(0, 0, OUT, OUT).data;
      let opaque = 0;
      for (let k = 3; k < px.length; k += 4) opaque += px[k] > 200 ? 1 : 0;
      if (opaque > OUT * OUT * 0.08 || frames > 240) return onDone(small.toDataURL('image/webp', 0.88));
    }
    setFrames((f) => f + 1);
  });
  return <Character3D archetype={a} variant={0} color={color} keys={7} detail="full" onBuilt={setBuilt} />;
}
