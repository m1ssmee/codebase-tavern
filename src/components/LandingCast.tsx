'use client';
// The landing page's orbit in 3D: one transparent canvas, a lite character over each orbiting portrait (it reads the
// portrait's spot every frame, so the circle and the speed are exactly the 2D ones), floating in its own style, eyes
// on the cursor. Loaded after first paint, on capable devices only; until then (and on phones) the portraits orbit.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Archetype, Variant } from '@/lib/cast';
import type { Built } from './cast/archetypes';
import { CastCanvas, CastLights, Character3D } from './cast/Character3D';
import { getActor } from './cast/anim/actor';

const Z = 60; // pixels per world unit
export type Hero = { name: string; arch: Archetype; variant: Variant; color: string; size: number };

export default function LandingCast({ heroes, spots, onReady }: { heroes: Hero[]; spots: RefObject<(HTMLElement | null)[]>; onReady: () => void }) {
  const built = useRef(0);
  const ready = useCallback(() => ++built.current === heroes.length && onReady(), [heroes.length, onReady]);
  return (
    <CastCanvas orthographic camera={{ zoom: Z, position: [0, 0, 50], near: 0.1, far: 200 }} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <CastLights />
      {heroes.map((h, i) => (
        <Orbiter key={h.name} hero={h} spot={() => spots.current[i]} onBuilt={ready} />
      ))}
    </CastCanvas>
  );
}

// The cursor, in client pixels; every character's eyes follow this one point.
const eyes = { client: [0, 0] as [number, number] };

function Orbiter({ hero, spot, onBuilt }: { hero: Hero; spot: () => HTMLElement | null; onBuilt: () => void }) {
  const group = useRef<THREE.Group>(null);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const [height, setHeight] = useState(0);
  const id = `hero:${hero.name}`;

  useEffect(() => {
    if (!height) return;
    eyes.client = [innerWidth / 2, innerHeight / 2];
    const move = (e: PointerEvent) => void (eyes.client = [e.clientX, e.clientY]);
    window.addEventListener('pointermove', move, { passive: true });
    const a = getActor(id);
    void a?.play('floats', { priority: 0 });
    a?.lookAt(eyes, 1e9);
    return () => {
      window.removeEventListener('pointermove', move);
      a?.stopLoop('floats');
    };
  }, [height, id]);

  useFrame(() => {
    const g = group.current;
    const el = spot();
    if (!g || !el || !height) return;
    const c = gl.domElement.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // As tall as 1.6 portraits, centred on the portrait's spot.
    const px = hero.size * 1.6;
    const x = r.left + r.width / 2 - c.left, feet = r.top + r.height / 2 + px / 2 - c.top;
    g.position.set((x - size.width / 2) / Z, (size.height / 2 - feet) / Z, 0);
    g.scale.setScalar(px / (height * Z));
    g.visible = true;
  });

  const built = useCallback(
    (b: Built) => {
      const box = new THREE.Box3().setFromObject(b.root);
      setHeight((box.max.y - box.min.y) / (b.root.parent?.getWorldScale(new THREE.Vector3()).y || 1));
      onBuilt();
    },
    [onBuilt],
  );
  return (
    <group ref={group} visible={false}>
      <Character3D actor={id} archetype={hero.arch} variant={hero.variant} color={hero.color} detail="lite" ambient={false} clicks={false} onBuilt={built} />
    </group>
  );
}
