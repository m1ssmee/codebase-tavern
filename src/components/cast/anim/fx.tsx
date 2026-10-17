'use client';
// Pooled, instanced cartoon effects: one InstancedMesh per kind, drawn only while something of that kind is
// alive, so an idle cast costs no extra draw calls. Every kind has a cap; spawns past it are dropped.
// Positions are world space. Also the screen shake (skipped with reduced motion).
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { reducedMotion, useCastAnim } from '../settings';
import { tickClock } from './core';

export type FxKind = 'puff' | 'star' | 'drop' | 'confetti' | 'ring' | 'glow' | 'line' | 'chunk';
const CAP: Record<FxKind, number> = { puff: 160, star: 40, drop: 120, confetti: 160, ring: 24, glow: 12, line: 48, chunk: 64 };
type V3 = [number, number, number];
type Range = number | [number, number];

export type Burst = {
  n?: number;
  /** Base velocity, plus a random one up to `spread` in any direction and `up` upward. */
  vel?: V3;
  spread?: number;
  up?: number;
  /** Random start offset radius. */
  jitter?: number;
  life?: Range;
  size?: Range;
  /** Scale multiplier reached at the end of life (puffs swell); every particle pops in and shrinks out. */
  grow?: number;
  color?: string | string[];
  gravity?: number;
  drag?: number;
  spin?: number;
  /** World y to bounce on. */
  floor?: number;
  /** Follow an object (dizzy stars orbit a head). */
  anchor?: THREE.Object3D;
  orbit?: { r: number; speed: number; y: number };
  /** Orientation: face the camera, align with velocity, or face a fixed normal. */
  face?: 'cam' | 'vel' | V3;
  /** Length along the velocity (drops, speed lines). */
  stretch?: number;
};

type P = {
  p: THREE.Vector3; v: THREE.Vector3; q: THREE.Quaternion; w: THREE.Vector3; age: number; life: number; size: number; grow: number;
  color: THREE.Color; g: number; drag: number; floor: number | null; anchor?: THREE.Object3D; orbit?: { r: number; speed: number; y: number; a: number };
  face?: 'cam' | 'vel' | THREE.Vector3; stretch: number;
};

const pick = (r: Range | undefined, d: number) => (r === undefined ? d : typeof r === 'number' ? r : r[0] + Math.random() * (r[1] - r[0]));
const randDir = (v: THREE.Vector3) => v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();

function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.45 : 1;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false }).translate(0, 0, -0.175);
}

const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _up = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(0, 0, 1);

export class FxSystem {
  readonly group = new THREE.Group();
  private meshes = {} as Record<FxKind, THREE.InstancedMesh>;
  private live = {} as Record<FxKind, P[]>;
  constructor() {
    const toon = new THREE.MeshToonMaterial({ color: '#ffffff' });
    const shapes: Record<FxKind, [THREE.BufferGeometry, THREE.Material]> = {
      puff: [new THREE.IcosahedronGeometry(1, 1), toon],
      star: [starGeometry(), toon],
      drop: [new THREE.SphereGeometry(1, 8, 6), toon],
      confetti: [new THREE.BoxGeometry(1, 0.6, 0.06), toon],
      ring: [new THREE.TorusGeometry(1, 0.16, 6, 24), toon],
      glow: [new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide })],
      line: [new THREE.BoxGeometry(0.08, 1, 0.08), new THREE.MeshBasicMaterial({ color: '#ffffff' })],
      chunk: [new THREE.BoxGeometry(1, 0.7, 0.8), toon],
    };
    for (const k of Object.keys(shapes) as FxKind[]) {
      const m = new THREE.InstancedMesh(shapes[k][0], shapes[k][1], CAP[k]);
      for (let i = 0; i < CAP[k]; i++) m.setColorAt(i, new THREE.Color('#ffffff'));
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false;
      m.raycast = () => {};
      this.meshes[k] = m;
      this.live[k] = [];
      this.group.add(m);
    }
  }
  /** Spawn up to b.n particles of a kind at a world point. */
  spawn(kind: FxKind, at: THREE.Vector3, b: Burst = {}) {
    const list = this.live[kind], colors = Array.isArray(b.color) ? b.color : [b.color ?? '#ffffff'];
    for (let i = 0; i < (b.n ?? 1) && list.length < CAP[kind]; i++) {
      const p: P = {
        p: at.clone(), v: new THREE.Vector3(...(b.vel ?? [0, 0, 0])), q: new THREE.Quaternion(), w: new THREE.Vector3(),
        age: 0, life: pick(b.life, 1), size: pick(b.size, 0.06), grow: b.grow ?? 1, color: new THREE.Color(colors[i % colors.length]),
        g: b.gravity ?? 0, drag: b.drag ?? 0, floor: b.floor ?? null, anchor: b.anchor, face: b.face === undefined || typeof b.face === 'string' ? b.face : new THREE.Vector3(...b.face).normalize(),
        stretch: b.stretch ?? 1,
      };
      if (b.jitter) p.p.add(randDir(_a).multiplyScalar(b.jitter * Math.random()));
      if (b.spread) p.v.add(randDir(_a).multiplyScalar(b.spread * (0.4 + 0.6 * Math.random())));
      if (b.up) p.v.y += b.up * (0.6 + 0.4 * Math.random());
      if (b.spin) {
        p.w.copy(randDir(_a)).multiplyScalar(b.spin);
        p.q.setFromEuler(_e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      }
      if (b.orbit) p.orbit = { ...b.orbit, a: ((i / (b.n ?? 1)) * Math.PI * 2) };
      list.push(p);
    }
  }
  update(dt: number, camera: THREE.Camera) {
    for (const k of Object.keys(this.live) as FxKind[]) {
      const list = this.live[k], mesh = this.meshes[k];
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.age += dt;
        if (p.age >= p.life) continue;
        if (p.orbit && p.anchor) {
          p.orbit.a += p.orbit.speed * dt;
          p.anchor.getWorldPosition(p.p).add(_a.set(Math.cos(p.orbit.a) * p.orbit.r, p.orbit.y, Math.sin(p.orbit.a) * p.orbit.r));
        } else {
          p.v.y -= p.g * dt;
          if (p.drag) p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
          p.p.addScaledVector(p.v, dt);
          if (p.floor !== null && p.p.y < p.floor) {
            p.p.y = p.floor;
            p.v.set(p.v.x * 0.6, Math.abs(p.v.y) * 0.35, p.v.z * 0.6);
            p.w.multiplyScalar(0.6);
          }
        }
        if (p.w.lengthSq()) p.q.multiply(_q.setFromAxisAngle(_a.copy(p.w).normalize(), p.w.length() * dt));
        // Pop in over the first 12%, swell toward `grow`, shrink away over the last 25%.
        const u = p.age / p.life;
        const env = Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.25);
        const s = p.size * env * (1 + (p.grow - 1) * u);
        let q = p.q;
        if (p.face === 'cam') q = camera.quaternion;
        else if (p.face === 'vel' && p.v.lengthSq() > 1e-6) q = _q.setFromUnitVectors(_up, _a.copy(p.v).normalize());
        else if (p.face instanceof THREE.Vector3) q = _q.setFromUnitVectors(_z, p.face);
        mesh.setMatrixAt(n, _m.compose(p.p, q, _s.set(s, s * p.stretch, s)));
        mesh.setColorAt(n, p.color);
        list[n++] = p;
      }
      list.length = n;
      mesh.count = n;
      mesh.visible = n > 0;
      if (n) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
      }
    }
  }
  clear() {
    for (const k of Object.keys(this.live) as FxKind[]) this.live[k].length = 0;
  }
  dispose() {
    for (const m of Object.values(this.meshes)) {
      m.geometry.dispose();
      m.dispose();
    }
  }
}

// ---------- presets: the cast's effects in one place ----------
const v = (p: THREE.Vector3) => p.clone();
export const FX = {
  /** Dizzy stars circling a head. */
  stars: (s: FxSystem, head: THREE.Object3D, life = 2.4, r = 0.24) =>
    s.spawn('star', head.getWorldPosition(new THREE.Vector3()), { n: 5, anchor: head, orbit: { r, speed: 4.5, y: r * 1.1 }, life, size: 0.055, color: ['#ffd23f', '#ffe680'], spin: 5 }),
  smoke: (s: FxSystem, at: THREE.Vector3, n = 10, size = 0.12, color: string | string[] = ['#d8d2c8', '#c4bdb1', '#e6e1d8']) =>
    s.spawn('puff', v(at), { n, jitter: size, spread: 0.5, up: 0.5, life: [0.6, 1.1], size: [size * 0.7, size * 1.3], grow: 1.8, color, drag: 2.5 }),
  dust: (s: FxSystem, at: THREE.Vector3, n = 12) => FX.smoke(s, at, n, 0.09, ['#e2dccf', '#d3ccbd', '#efe9dd']),
  /** Rolls out from behind and round both sides, so it shows from the front. */
  fart: (s: FxSystem, at: THREE.Vector3, back: V3) => {
    for (const side of [-1, 1])
      s.spawn('puff', v(at), { n: 7, jitter: 0.07, vel: [back[0] * 0.6 + side * 0.55, 0.25, back[2] * 0.6 + 0.15], spread: 0.3, life: [1.1, 1.7], size: [0.1, 0.17], grow: 2.6, color: ['#9bc56b', '#b5d68a', '#86b35a'], drag: 1.5 });
  },
  steam: (s: FxSystem, at: THREE.Vector3) =>
    s.spawn('puff', v(at), { n: 3, jitter: 0.05, spread: 0.15, up: 1.4, life: [0.6, 0.9], size: [0.05, 0.08], grow: 2.4, color: '#ffffff', drag: 1.2 }),
  sweat: (s: FxSystem, at: THREE.Vector3, n = 3) =>
    s.spawn('drop', v(at), { n, jitter: 0.05, spread: 0.6, up: 0.6, gravity: 5, life: 0.7, size: 0.022, stretch: 1.5, face: 'vel', color: '#5fb8ff' }),
  spray: (s: FxSystem, at: THREE.Vector3, dir: V3, n = 6) =>
    s.spawn('drop', v(at), { n, vel: dir, spread: 0.35, gravity: 4.5, life: [0.5, 0.8], size: [0.016, 0.026], stretch: 1.8, face: 'vel', color: ['#5fb8ff', '#8fd0ff'] }),
  drip: (s: FxSystem, at: THREE.Vector3) => s.spawn('drop', v(at), { gravity: 5, life: 0.42, size: 0.03, stretch: 1.4, face: 'vel', color: '#5fb8ff' }),
  confetti: (s: FxSystem, at: THREE.Vector3, n = 40) =>
    s.spawn('confetti', v(at), { n, jitter: 0.2, spread: 1.4, up: 2.2, gravity: 2.2, drag: 1.6, spin: 9, life: [1.4, 2.2], size: [0.035, 0.05], color: ['#f2c14e', '#e8573f', '#5fb8ff', '#7ac36a', '#c38bff'] }),
  /** A ring stamped onto a surface (ink on a code line) or blown out (smoke ring). */
  ring: (s: FxSystem, at: THREE.Vector3, normal: V3, color = '#26357a', size = 0.06, life = 4, grow = 1) =>
    s.spawn('ring', v(at), { face: normal, size, life, grow, color }),
  smokeRing: (s: FxSystem, at: THREE.Vector3, dir: V3) =>
    s.spawn('ring', v(at), { face: dir, vel: dir.map((x) => x * 0.5) as V3, up: 0.25, size: 0.04, grow: 3.2, life: 1.3, color: '#bdb6aa', drag: 1.5 }),
  glow: (s: FxSystem, at: THREE.Vector3, life = 1.6, size = 0.18, color = '#fff3c4') => s.spawn('glow', v(at), { face: 'cam', size, life, color }),
  speed: (s: FxSystem, at: THREE.Vector3, n = 8, r = 0.35, color = '#3a2c26') => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const d: V3 = [Math.cos(a), Math.sin(a), 0];
      s.spawn('line', at.clone().add(new THREE.Vector3(d[0] * r, d[1] * r, 0)), { vel: d.map((x) => x * 0.9) as V3, face: 'vel', size: 0.12, stretch: 1.6, life: 0.35, color });
    }
  },
  sparkle: (s: FxSystem, at: THREE.Vector3) => s.spawn('star', v(at), { n: 4, spread: 0.9, life: 0.6, size: 0.035, spin: 8, drag: 3, color: ['#ffd23f', '#ffffff'] }),
  /** Junk, paper or backpack items flying out. */
  chunks: (s: FxSystem, at: THREE.Vector3, colors: string[], n = 8, floor = 0) =>
    s.spawn('chunk', v(at), { n, jitter: 0.08, spread: 1.6, up: 2.2, gravity: 7, spin: 10, floor, life: [1.4, 2.0], size: [0.05, 0.09], color: colors }),
  paper: (s: FxSystem, at: THREE.Vector3, n = 10, floor = 0) =>
    s.spawn('confetti', v(at), { n, jitter: 0.15, spread: 0.9, up: 1.2, gravity: 1.4, drag: 2.2, spin: 5, floor, life: [1.6, 2.4], size: [0.1, 0.14], color: ['#f4ecd8', '#ffffff'] }),
};

// ---------- screen shake ----------
let shakeUntil = 0, shakeAmp = 0;
/** Shake everything on the canvas for `dur` seconds (no-op with reduced motion). */
export function shake(amp = 0.06, dur = 0.4) {
  if (reducedMotion()) return;
  shakeAmp = Math.max(amp, performance.now() < shakeUntil ? shakeAmp : 0);
  shakeUntil = performance.now() + dur * 1000;
}

const pools = new WeakMap<THREE.Object3D, FxSystem>();
/** The FX pools of the canvas a scene belongs to. */
export const fxFor = (scene: THREE.Object3D) => pools.get(scene);

/** The FX pools for one canvas, plus screen shake; registered per scene so actors can find them. */
export function CastFX() {
  const scene = useThree((s) => s.scene);
  const sys = useMemo(() => new FxSystem(), []);
  useEffect(() => {
    scene.add(sys.group);
    pools.set(scene, sys);
    return () => {
      scene.remove(sys.group);
      if (pools.get(scene) === sys) pools.delete(scene);
      sys.dispose();
    };
  }, [scene, sys]);
  useFrame(({ camera }, dt) => {
    tickClock(dt);
    sys.update(Math.min(dt, 0.1) * useCastAnim.getState().speed, camera);
    const left = shakeUntil - performance.now();
    if (left > 0) {
      const k = shakeAmp * Math.min(1, left / 200);
      scene.position.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, 0);
    } else if (scene.position.lengthSq()) scene.position.set(0, 0, 0);
  });
  return null;
}
