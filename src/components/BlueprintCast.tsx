'use client';
// The Blueprint's cast: one transparent canvas over the diagram, a small lite character standing on each module's
// badge (the slot in the SVG, so it follows pan and zoom). On a tour stop, the module being introduced steps forward
// onto the top of its node, twice the size, talks and does its signature gesture while the Landlord narrates.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { create } from 'zustand';
import { useTavern } from '@/lib/store';
import type { Built } from './cast/archetypes';
import { CastCanvas, CastLights, Character3D } from './cast/Character3D';
import { getActor } from './cast/anim/actor';
import { reducedMotion } from './cast/settings';

const Z = 60; // pixels per world unit
/** More than this many modules: the rest keep their 2D faces (lite is cheap, not free). */
export const MAX_3D = 24;
/** The module the tour is introducing right now. */
export const useBlueprint = create<{ star: string | null }>(() => ({ star: null }));

export type BlueprintSlot = { id: string; face: HTMLElement; node: Element | null };

export default function BlueprintCast({ slots }: { slots: BlueprintSlot[] }) {
  return (
    <CastCanvas orthographic camera={{ zoom: Z, position: [0, 0, 50], near: 0.1, far: 200 }} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      <CastLights />
      {slots.slice(0, MAX_3D).map((s) => (
        <Tenant key={s.id} slot={s} />
      ))}
    </CastCanvas>
  );
}

function Tenant({ slot }: { slot: BlueprintSlot }) {
  const group = useRef<THREE.Group>(null);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const mod = useTavern((s) => s.repo?.modules.find((m) => m.id === slot.id));
  const cast = useTavern((s) => s.repo?.modules);
  const color = useTavern((s) => s.characters[slot.id]?.color);
  const mood = useTavern((s) => s.moods[slot.id]);
  const star = useBlueprint((s) => s.star === slot.id);
  const [height, setHeight] = useState(0); // model height at scale 1, world units
  const k = useRef(0); // 0 on its badge .. 1 stepped forward

  // Stepping forward: its own gesture, once it gets there.
  useEffect(() => {
    if (!star) return;
    const t = setTimeout(() => void getActor(`bp:${slot.id}`)?.play('idle', { priority: 2 }), reducedMotion() ? 0 : 450);
    return () => clearTimeout(t);
  }, [star, slot.id]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g || !height) return;
    k.current = reducedMotion() ? (star ? 1 : 0) : k.current + ((star ? 1 : 0) - k.current) * (1 - Math.exp(-dt * 7));
    const c = gl.domElement.getBoundingClientRect();
    const f = slot.face.getBoundingClientRect();
    const n = slot.node?.getBoundingClientRect() ?? f;
    // On its badge: as tall as 1.3 badges, feet at the badge's bottom. Forward: standing on top of its node, bigger.
    const x = THREE.MathUtils.lerp(f.left + f.width / 2, n.left + n.width / 2, k.current) - c.left;
    const feet = THREE.MathUtils.lerp(f.bottom, n.top + 4, k.current) - c.top;
    const px = f.height * THREE.MathUtils.lerp(1.3, 2.4, k.current);
    g.visible = f.width > 3 && x > -px && x < size.width + px && feet > -px && feet < size.height + px * 2;
    g.position.set((x - size.width / 2) / Z, (size.height / 2 - feet) / Z, k.current * 5);
    g.scale.setScalar(px / (height * Z));
  });
  const onBuilt = useCallback((b: Built) => {
    const box = new THREE.Box3().setFromObject(b.root);
    const s = b.root.parent?.getWorldScale(new THREE.Vector3()).y || 1;
    setHeight((box.max.y - box.min.y) / s);
  }, []);
  if (!mod) return null;
  return (
    <group ref={group} visible={false}>
      <Character3D actor={`bp:${slot.id}`} module={mod} cast={cast} color={color} detail="lite" mood={mood ?? 'idle'} ambient={false} clicks={false} onBuilt={onBuilt} />
    </group>
  );
}
