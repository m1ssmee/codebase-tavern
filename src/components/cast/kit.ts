// Shared building blocks for the procedural cast: toon materials, cached geometries, inverted-hull
// outlines, static-prop merging. Everything is generated in code; nothing is downloaded.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type V3 = [number, number, number];
export const INK = '#17110e';
export const C = {
  white: '#ffffff', cavity: '#4a1518', wood: '#9b6a43', woodDark: '#6e4a2e', metal: '#a6acb1', metalDark: '#666c72',
  paper: '#f4ecd8', water: '#5fb8ff', canvas: '#b8a07a', tape: '#c9ccce', gaffer: '#3d3f42', black: '#232326',
};

// ---------- materials (one instance per colour, shared by every character) ----------
const mats = new Map<string, THREE.Material>();
function memo<M extends THREE.Material>(key: string, make: () => M): M {
  if (!mats.has(key)) mats.set(key, make());
  return mats.get(key) as M;
}
let gradient: THREE.DataTexture | undefined;
/** 3-step toon ramp: shadow, mid, lit. */
function ramp() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([89, 173, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}
export const toon = (color: string) => memo(`t${color}`, () => new THREE.MeshToonMaterial({ color, gradientMap: ramp() }));
export const flat = (color: string) => memo(`f${color}`, () => new THREE.MeshBasicMaterial({ color }));
export const tinted = (color: string, opacity: number) =>
  memo(`n${color}${opacity}`, () => new THREE.MeshToonMaterial({ color, gradientMap: ramp(), transparent: true, opacity, side: THREE.DoubleSide }));
export const glow = (color: string, opacity: number) =>
  memo(`g${color}${opacity}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));

/** Inverted hull: back faces pushed out along smoothed normals, scaled by depth so every line is the same width on screen. */
export const OUTLINE = new THREE.ShaderMaterial({
  uniforms: { width: { value: 0.0024 } },
  vertexShader: /* glsl */ `
    uniform float width;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      mv.xyz += normalize(normalMatrix * normal) * width * -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `void main() { gl_FragColor = vec4(0.09, 0.067, 0.055, 1.0); }`,
  side: THREE.BackSide,
});

// ---------- textures (drawn on a canvas once) ----------
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  draw(el.getContext('2d')!);
  const tex = new THREE.CanvasTexture(el);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** Soft round contact shadow. */
export const shadowMat = () =>
  memo('shadow', () => {
    const map = canvasTexture(64, 64, (g) => {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(0,0,0,0.42)');
      r.addColorStop(0.55, 'rgba(0,0,0,0.22)');
      r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    });
    return new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, color: '#000' });
  });
/** Receipt paper: cream with grey "print" stripes, no text. */
export const receiptMat = () =>
  memo('receipt', () => {
    const map = canvasTexture(32, 32, (g) => {
      g.fillStyle = C.paper;
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = '#9b9a96';
      g.fillRect(5, 6, 22, 3);
      g.fillRect(5, 15, 15, 3);
      g.fillRect(22, 15, 5, 3);
      g.fillRect(5, 24, 18, 3);
    });
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.NearestFilter;
    return new THREE.MeshToonMaterial({ map, gradientMap: ramp(), side: THREE.DoubleSide });
  });

// ---------- geometry (unit shapes scaled per mesh; cached and shared) ----------
const geos = new Map<string, THREE.BufferGeometry>();
function geo<G extends THREE.BufferGeometry>(key: string, make: () => G): G {
  if (!geos.has(key)) geos.set(key, make());
  return geos.get(key) as G;
}
const k = (...n: number[]) => n.map((x) => +x.toFixed(3)).join(',');
export const G = {
  sphere: (ws = 16, hs = 12) => geo(`s${ws},${hs}`, () => new THREE.SphereGeometry(1, ws, hs)),
  /** Rounded both ends; total height = len + 2r. */
  capsule: (r: number, len: number, cap = 3, radial = 10) => geo(`c${k(r, len, cap, radial)}`, () => new THREE.CapsuleGeometry(r, len, cap, radial)),
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  /** Rounded box; segs 1 is a cheap chamfer, 2 a smooth round for big visible surfaces. */
  rbox: (w: number, h: number, d: number, r: number, segs = 1) => geo(`rb${k(w, h, d, r, segs)}`, () => new RoundedBoxGeometry(w, h, d, segs, r)),
  /** Unit-height cylinder of bottom radius 1; `top` is the top radius (0 = cone). Scale it to size. */
  cyl: (top = 1, segs = 16, open = false) => geo(`cy${k(top, segs)}${open}`, () => new THREE.CylinderGeometry(top, 1, 1, segs, 1, open)),
  /** Ring of radius 1 in the XY plane; `tube` is relative to the ring radius. */
  torus: (tube: number, arc = Math.PI * 2, ts = 20, rs = 5) => geo(`to${k(tube, arc, ts, rs)}`, () => new THREE.TorusGeometry(1, tube, rs, ts, arc)),
  lathe: (key: string, pts: [number, number][], segs = 20, phiStart = 0, phiLength = Math.PI * 2) =>
    geo(`la${key}`, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs, phiStart, phiLength)),
  disc: (segs = 20) => geo(`di${segs}`, () => new THREE.CircleGeometry(1, segs)),
  /** Front half (z >= 0) of a unit-height cylinder: visor brims. */
  halfDisc: () => geo('hd', () => new THREE.CylinderGeometry(1, 1, 1, 18, 1, false, -Math.PI / 2, Math.PI)),
  /** Front half (z >= 0) of a unit sphere: the Star's facade head. */
  halfSphere: () => geo('hs', () => new THREE.SphereGeometry(1, 18, 12, 0, Math.PI)),
  /** Flat panel in the shape of a lathe profile, facing -z: the plywood back of a facade. */
  panel: (key: string, pts: [number, number][]) =>
    geo(`pa${key}`, () => {
      const outline = [...pts.map(([x, y]) => new THREE.Vector2(x, y)), ...[...pts].reverse().map(([x, y]) => new THREE.Vector2(-x, y))];
      return new THREE.ShapeGeometry(new THREE.Shape(outline)).rotateY(Math.PI);
    }),
  /** Eyelid: upper hemisphere closed by a flat disc, so its outline draws the lid line. */
  lid: () =>
    geo('lid', () =>
      mergeGeometries([new THREE.SphereGeometry(1, 14, 4, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.CircleGeometry(1, 14).rotateX(Math.PI / 2)]),
    ),
};

/** A curve from a function of t in [0, 1]; used for tubes (wires, pipes, mouths). */
export class FnCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private f: (t: number) => V3) {
    super();
  }
  getPoint(t: number, out = new THREE.Vector3()) {
    return out.set(...this.f(t));
  }
}
export const tube = (f: (t: number) => V3, r: number, segs = 32, radial = 6) => new THREE.TubeGeometry(new FnCurve(f), segs, r, radial, false);

/** Flat strip through `pts`, facing up where it can (receipts, coat tails). v runs along the length in metres. */
export function ribbon(pts: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  let side = new THREE.Vector3(1, 0, 0);
  let len = 0;
  pts.forEach((p, i) => {
    const tan = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
    const s = tan.clone().cross(up);
    if (s.lengthSq() > 1e-4) side = s.normalize();
    const n = side.clone().cross(tan).normalize();
    if (i) len += p.distanceTo(pts[i - 1]);
    for (const d of [-0.5, 0.5]) {
      pos.push(...p.clone().addScaledVector(side, d * width).toArray());
      nor.push(...n.toArray());
      uv.push(d + 0.5, len / 0.09);
    }
    if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------- meshes ----------
export type Part = { p?: V3; r?: V3; s?: V3 | number; outline?: boolean; fx?: boolean };
export function mesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, t: Part = {}) {
  const o = new THREE.Mesh(g, m);
  if (t.p) o.position.set(...t.p);
  if (t.r) o.rotation.set(...t.r);
  if (typeof t.s === 'number') o.scale.setScalar(t.s);
  else if (t.s) o.scale.set(...t.s);
  if (t.outline === false) o.userData.noOutline = true;
  if (t.fx) o.userData.fx = true; // light effects: no outline, hidden in silhouette mode
  parent.add(o);
  return o;
}

/**
 * Builds static props into a scratch group, then merges them into one mesh per material
 * (fewer draw calls). Merged geometries are unique, so they're pushed to `owned` for disposal.
 */
export function bake(parent: THREE.Object3D, owned: THREE.BufferGeometry[], build: (g: THREE.Group) => void, t: Part = {}) {
  const scratch = new THREE.Group();
  build(scratch);
  scratch.updateMatrixWorld(true);
  const buckets = new Map<string, { m: THREE.Material; flags: Part; list: THREE.BufferGeometry[] }>();
  scratch.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    let g = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.index) g = mergeVertices(g);
    const flags = { outline: !o.userData.noOutline, fx: !!o.userData.fx };
    const key = `${o.material.uuid}${flags.outline}${flags.fx}`;
    if (!buckets.has(key)) buckets.set(key, { m: o.material, flags, list: [] });
    buckets.get(key)!.list.push(g);
  });
  const out = new THREE.Group();
  if (t.p) out.position.set(...t.p);
  if (t.r) out.rotation.set(...t.r);
  parent.add(out);
  for (const { m, flags, list } of buckets.values()) {
    const merged = mergeGeometries(list);
    list.forEach((g) => g.dispose());
    owned.push(merged);
    mesh(out, merged, m, flags);
  }
  return out;
}

const hulls = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** Position-only copy with welded vertices and averaged normals, so hard edges don't crack the outline. */
export function hull(g: THREE.BufferGeometry, owned?: THREE.BufferGeometry[]) {
  let h = hulls.get(g);
  if (!h) {
    const p = new THREE.BufferGeometry();
    p.setAttribute('position', g.getAttribute('position'));
    if (g.index) p.setIndex(g.index);
    h = mergeVertices(p, 1e-4);
    h.computeVertexNormals();
    hulls.set(g, h);
    owned?.push(h);
  }
  return h;
}

export const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
