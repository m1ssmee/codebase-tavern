'use client';
import { useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, OrthographicCamera, Vector3 } from 'three';
import { create } from 'zustand';

// drei <Html> gives every instance its own React root, and under React 19 StrictMode the double-mounted
// root races its own unmount and can wipe a face. This renders all map DOM in one ordinary tree instead:
// <Dom> (inside the Canvas) parks its children here, <DomLayer> (outside) renders them, and the anchor
// moves the element every frame.
const useLayer = create<{ items: Record<string, ReactNode> }>(() => ({ items: {} }));

export function DomLayer() {
  const items = useLayer((s) => s.items);
  return <div className="pointer-events-none absolute inset-0 overflow-hidden">{Object.values(items)}</div>;
}

const v = new Vector3();

/** DOM pinned to a 3D point, centred on it. `worldSize`: scale so `px` pixels span that many world units (ortho zoom). */
export function Dom({ children, position = [0, 0, 0], worldSize, px = 100, z = 0, style }: {
  children: ReactNode;
  position?: [number, number, number];
  worldSize?: number;
  px?: number;
  z?: number;
  style?: CSSProperties;
}) {
  const id = useId();
  const group = useRef<Group>(null);
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    useLayer.setState((s) => ({
      items: { ...s.items, [id]: <div key={id} ref={el} style={{ position: 'absolute', left: 0, top: 0, zIndex: z, visibility: 'hidden', ...style }}>{children}</div> },
    }));
  }, [id, children, z, style]);
  useLayoutEffect(() => () => useLayer.setState((s) => ({ items: Object.fromEntries(Object.entries(s.items).filter(([k]) => k !== id)) })), [id]);
  useFrame(({ camera, size }) => {
    if (!group.current || !el.current) return;
    v.setFromMatrixPosition(group.current.matrixWorld).project(camera);
    const s = worldSize && camera instanceof OrthographicCamera ? (camera.zoom * worldSize) / px : 1;
    el.current.style.transform = `translate(${((v.x + 1) / 2) * size.width}px,${((1 - v.y) / 2) * size.height}px) translate(-50%,-50%) scale(${s})`;
    el.current.style.visibility = 'visible';
  });
  return <group ref={group} position={position} />;
}
