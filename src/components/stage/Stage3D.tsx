'use client';
// The stage's one canvas: transparent, the whole window, under the DOM layer (which takes the pointer). Orthographic,
// so a screen pixel maps straight to the world: a member standing at (x, y) on screen is drawn exactly there.
import { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTavern } from '@/lib/store';
import type { Built } from '../cast/archetypes';
import { CastCanvas, CastLights, Character3D } from '../cast/Character3D';
import { actorOf, useStage, type Member } from './store';
import { HEIGHT, placed, sizes, zooms } from './geo';

const Z = 60; // pixels per world unit
// The What-if relieved hop, as on the map.
const CLIPS = { happy: 'hop' } as const;

export default function Stage3D() {
  const members = useStage((s) => s.members);
  return (
    <CastCanvas orthographic camera={{ zoom: Z, position: [0, 0, 50], near: 0.1, far: 200 }} style={{ position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none' }}>
      <CastLights />
      {members.map((m) => (
        <Tenant key={m.id} m={m} />
      ))}
    </CastCanvas>
  );
}

const _v = new THREE.Vector3();
function Tenant({ m }: { m: Member }) {
  const group = useRef<THREE.Group>(null);
  const size = useThree((s) => s.size);
  const mod = useTavern((s) => (m.kind === 'module' ? s.repo?.modules.find((x) => x.id === m.id) : undefined));
  const cast = useTavern((s) => s.repo?.modules);
  const color = useTavern((s) => s.characters[m.id]?.color);
  const mood = useTavern((s) => s.moods[m.id]);
  const keys = useTavern((s) => s.repo?.modules.length);
  const hold = useStage((s) => s.holdMoods);
  const [scale, setScale] = useState(0);
  useFrame(() => {
    const p = placed.get(m.id);
    if (!p || !group.current) return;
    group.current.position.set((p.x - size.width / 2) / Z, (size.height / 2 - p.y) / Z, 0);
    group.current.scale.setScalar(zooms.get(m.id) ?? 1); // smaller while perched
  });
  // Every character is HEIGHT pixels tall on stage, whatever its build; the hitbox takes the model's width.
  const onBuilt = useCallback(
    (b: Built) => {
      const box = new THREE.Box3().setFromObject(b.root);
      const k = b.root.parent?.getWorldScale(_v).y || 1;
      const h = (box.max.y - box.min.y) / k, w = (box.max.x - box.min.x) / k;
      const s = HEIGHT / (h * Z);
      sizes.set(m.id, { w: Math.min(HEIGHT * 1.6, Math.max(44, w * s * Z * 0.85)), h: HEIGHT });
      setScale(s);
    },
    [m.id],
  );
  if (m.kind === 'module' && !mod) return null;
  return (
    <group ref={group} visible={scale > 0}>
      <Character3D
        actor={actorOf(m.id)}
        module={mod}
        cast={cast}
        archetype={m.kind === 'module' ? undefined : m.kind}
        keys={m.kind === 'landlord' ? keys : undefined}
        color={color}
        detail="lite"
        scale={scale || 1}
        mood={m.kind === 'module' ? (hold ? 'idle' : (mood ?? 'idle')) : undefined}
        moodClips={CLIPS}
        clicks={false}
        hitbox
        onBuilt={onBuilt}
      />
    </group>
  );
}
