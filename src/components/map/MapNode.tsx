'use client';
import { useEffect } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Euler } from 'three';
import { motion, useReducedMotion } from 'framer-motion';
import CharacterFace from '../CharacterFace';
import { Character3D } from '../cast/Character3D';
import { useCast3D } from '../cast/settings';
import { getActor } from '../cast/anim/actor';
import type { Module, ModuleStats, Mood } from '@/lib/types';
import { Dom } from './Dom';

export type MapNodeProps = {
  module: Module;
  stats: ModuleStats;
  /** Every module, so the 3D character gets the same archetype as everywhere else. */
  cast?: Module[];
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
// On the map, What-if's relieved ("happy") is a hop; the other moods play their usual clips.
const MAP_CLIPS: Partial<Record<Mood, string>> = { happy: 'hop' };
const FACE_CAMERA = new Euler(-0.45, Math.atan2(5, 9), 0, 'YXZ');

/** A module on the map: its lite 3D character, or (3D characters off) its 2D face as a camera-facing billboard. */
export default function MapNode(props: MapNodeProps) {
  const on = useCast3D((s) => s.on);
  return on ? <Node3D {...props} /> : <Node2D {...props} />;
}

// Characters stop growing past this node size: the biggest archetypes (the Hoarder's pack) spill onto neighbours' labels.
const MAX_CHARACTER = 1.7;

function Node3D({ module, stats, cast, mood = 'idle', talking, position = [0, 0, 0], scale = 1, color, flinch, dimmed, onClick }: MapNodeProps) {
  const id = `map:${module.id}`;
  // The ripple's flinch: the cast's small reaction (a squash and a blink), without its sound.
  useEffect(() => {
    if (flinch) void getActor(id)?.play('softBonked', { priority: 1, silent: true });
  }, [flinch, id]);
  return (
    <group position={[position[0], position[1] - scale / 2, position[2]]}>
      {/* Pointer events come from this sphere; the character's own meshes aren't picked (cheap hover and drag). */}
      <mesh position={[0, scale * 0.55, 0]} onClick={onClick}>
        <sphereGeometry args={[scale * 0.55, 12, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Turned toward the map's fixed camera (MapView's CAMERA, [5, 16, 9]) and leaning back, so faces read from above. */}
      <group rotation={FACE_CAMERA}>
        <Character3D
          actor={id}
          module={module}
          cast={cast}
          stats={stats}
          color={color}
          detail="lite"
          mood={talking ? 'talking' : mood}
          moodClips={MAP_CLIPS}
          scale={Math.min(scale, MAX_CHARACTER) * 0.7}
          ambient={false}
          clicks={false}
          hitbox
          dim={dimmed}
        />
      </group>
    </group>
  );
}

function Node2D({ module, stats, mood = 'idle', talking, position = [0, 0, 0], scale = 1, color, flinch, dimmed, onClick }: MapNodeProps) {
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
