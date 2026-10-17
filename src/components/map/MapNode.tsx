'use client';
import type { ThreeEvent } from '@react-three/fiber';
import { motion, useReducedMotion } from 'framer-motion';
import CharacterFace from '../CharacterFace';
import type { Module, ModuleStats, Mood } from '@/lib/types';
import { Dom } from './Dom';

export type MapNodeProps = {
  module: Module;
  stats: ModuleStats;
  mood?: Mood;
  talking?: boolean; // its chat reply is streaming
  position?: [number, number, number]; // local to the floating group the map moves every frame
  scale?: number; // diameter in world units, from totalLines
  color?: string;
  flinch?: boolean; // true for a moment when a ripple hits it
  dimmed?: boolean; // hovering another node
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
};

const PX = 120; // face rendered at this size, then scaled to `scale` world units

/** Placeholder until Character3D lands: the module's 2D face as a camera-facing billboard, over an invisible hit sphere. */
export default function MapNode({ module, stats, mood = 'idle', talking, position = [0, 0, 0], scale = 1, color, flinch, dimmed, onClick }: MapNodeProps) {
  const reduced = useReducedMotion();
  return (
    <group position={position}>
      {/* Pointer events come from this sphere; the face is DOM and ignores the pointer. */}
      <mesh onClick={onClick}>
        <sphereGeometry args={[scale / 2, 12, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <Dom worldSize={scale} px={PX} z={2}>
        <motion.div
          animate={
            flinch && !reduced
              ? { x: [0, -10, 8, -4, 0], rotate: [0, -10, 7, -3, 0], scale: [1, 0.82, 1.08, 1] }
              : { x: 0, rotate: 0, scale: 1 }
          }
          transition={{ duration: 0.45 }}
          style={{ opacity: dimmed ? 0.25 : 1, transition: 'opacity 200ms' }}
        >
          <CharacterFace name={module.name} stats={stats} color={color} mood={talking ? 'talking' : mood} size={PX} />
        </motion.div>
      </Dom>
    </group>
  );
}
