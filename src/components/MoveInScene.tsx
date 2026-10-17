'use client';
// The 3D half of the loading show: the Landlord at the tavern door with its key ring, and once the modules are
// known, each tenant walking up with a suitcase and queueing at the door. Lite detail, no gags; the walk is a
// slide with a bob on a wrapper group (the shared rig and clips are untouched).
import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { CastCanvas, CastLights, Character3D } from './cast/Character3D';
import { assignCast } from '@/lib/cast';
import { assignColors } from '@/lib/characters';
import type { Module } from '@/lib/types';

const DOOR_X = -2;
const WALK_S = 1.0;
const STAGGER_S = 0.08;

function Door() {
  const wood = '#7a5230';
  return (
    <group position={[DOOR_X, 0, -0.4]}>
      <mesh position={[0, 1.05, -0.02]}>
        <boxGeometry args={[0.95, 2.1, 0.04]} />
        <meshStandardMaterial color="#2b1d14" />
      </mesh>
      {[-0.53, 0.53].map((x) => (
        <mesh key={x} position={[x, 1.1, 0]}>
          <boxGeometry args={[0.12, 2.2, 0.16]} />
          <meshStandardMaterial color={wood} />
        </mesh>
      ))}
      <mesh position={[0, 2.25, 0]}>
        <boxGeometry args={[1.2, 0.14, 0.18]} />
        <meshStandardMaterial color={wood} />
      </mesh>
      <mesh position={[0, 0.01, 0.3]}>
        <boxGeometry args={[1.3, 0.02, 0.7]} />
        <meshStandardMaterial color="#b4472e" />
      </mesh>
    </group>
  );
}

/** One tenant: walks in from the right, bobbing, carrying a suitcase in its colour, and stops in the queue. */
function Walker({ m, i, arch, color }: { m: Module; i: number; arch: ReturnType<typeof assignCast>[number]; color: string }) {
  const g = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const from = 5 + i * 0.4;
  const to = DOOR_X + 1.9 + i * 0.62;
  useFrame(({ clock }) => {
    const o = g.current;
    if (!o) return;
    start.current ??= clock.elapsedTime;
    const t = Math.max(0, clock.elapsedTime - start.current - i * STAGGER_S);
    const k = Math.min(1, t / WALK_S);
    o.position.x = from + (to - from) * (1 - (1 - k) ** 2);
    o.position.y = k < 1 ? Math.abs(Math.sin(t * 12)) * 0.05 : 0;
    o.rotation.z = k < 1 ? Math.sin(t * 12) * 0.035 : 0;
  });
  return (
    <group ref={g} position={[from, 0, 0.1 - (i % 2) * 0.25]} rotation={[0, -0.75, 0]}>
      <Character3D module={m} archetype={arch.archetype} variant={arch.variant} color={color} detail="lite" scale={0.68} ambient={false} clicks={false} />
      <group position={[0.34, 0.2, 0.08]}>
        <mesh>
          <boxGeometry args={[0.34, 0.24, 0.12]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.15, 0]}>
          <boxGeometry args={[0.12, 0.04, 0.03]} />
          <meshStandardMaterial color="#3a2a1e" />
        </mesh>
      </group>
    </group>
  );
}

export default function MoveInScene({ tenants, fallback }: { tenants: Module[] | null; fallback: ReactNode }) {
  const cast = useMemo(() => (tenants ? assignCast(tenants) : []), [tenants]);
  const colors = useMemo(() => assignColors(tenants ?? []), [tenants]);
  return (
    <CastCanvas camera={{ position: [0.9, 1.35, 7.4], fov: 32, rotation: [-0.07, 0, 0] }} fallback={fallback}>
      <CastLights />
      <Door />
      <group position={[DOOR_X + 0.85, 0, 0.35]} rotation={[0, 0.45, 0]}>
        <Character3D archetype="landlord" keys={Math.max(1, tenants?.length ?? 3)} detail="lite" scale={0.85} clicks={false} />
      </group>
      {tenants?.map((m, i) => <Walker key={m.id} m={m} i={i} arch={cast[i]} color={colors[m.id]} />)}
    </CastCanvas>
  );
}
