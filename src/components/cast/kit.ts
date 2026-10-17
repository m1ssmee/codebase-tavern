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

// ---------- materials (one instance per colour and finish, shared by every character) ----------
const mats = new Map<string, THREE.Material>();
function memo<M extends THREE.Material>(key: string, make: () => M): M {
  if (!mats.has(key)) mats.set(key, make());
  return mats.get(key) as M;
}
let gradient: THREE.DataTexture | undefined;
/** 4-step toon ramp: core shadow, shadow, lit, highlight. */
function ramp() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([62, 120, 205, 255]), 4, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

/** World height of the floor the cast stands on (the ground darkening fades up from it). */
export const CAST_GROUND = { value: 0 };

export type Finish = { gloss?: boolean; grain?: boolean; opacity?: number; double?: boolean };
/**
 * Toon material plus three touches injected into three's toon shader: darker near the floor, a crisp
 * fresnel rim that separates the character from dark backgrounds, and (gloss only) a hard specular spot.
 */
export function toon(color: string, f: Finish = {}) {
  return memo(`t${color}${f.gloss ? 'g' : ''}${f.grain ? 'w' : ''}${f.opacity ?? ''}${f.double ? 'd' : ''}`, () => {
    const m = new THREE.MeshToonMaterial({
      color,
      gradientMap: ramp(),
      map: f.grain ? grainTexture() : null,
      transparent: f.opacity !== undefined,
      opacity: f.opacity ?? 1,
      side: f.double || f.opacity !== undefined ? THREE.DoubleSide : THREE.FrontSide,
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uGround = CAST_GROUND;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vCastY;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vCastY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCastY;\nuniform float uGround;')
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `{
    vec3 n = normalize(normal), v = normalize(vViewPosition);
    outgoingLight *= mix(0.72, 1.0, smoothstep(0.0, 0.6, vCastY - uGround));
    float fr = 1.0 - max(dot(n, v), 0.0);
    outgoingLight += mix(diffuseColor.rgb, vec3(1.0), 0.5) * smoothstep(0.6, 0.68, fr) * smoothstep(-0.25, 0.55, n.y) * 0.3;
    ${f.gloss ? `#if NUM_DIR_LIGHTS > 0
    outgoingLight += vec3(0.6) * smoothstep(0.962, 0.972, max(dot(n, normalize(directionalLights[0].direction + v)), 0.0));
    #endif` : ''}
  }
  #include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => `cast-toon${f.gloss ? '-gloss' : ''}`;
    return m;
  });
}
/** Flat colour, no lighting: ink lines, pupils, brows. */
export const flat = (color: string, double = false) =>
  memo(`f${color}${double ? 'd' : ''}`, () => new THREE.MeshBasicMaterial({ color, side: double ? THREE.DoubleSide : THREE.FrontSide }));
export const tinted = (color: string, opacity: number) => toon(color, { opacity });
export const glow = (color: string, opacity: number) =>
  memo(`g${color}${opacity}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
/** A darker or lighter shade of a colour (HSL lightness offset). */
export const shade = (color: string, dl: number, ds = 0) => `#${new THREE.Color(color).offsetHSL(0, ds, dl).getHexString()}`;

/** Outline width as a fraction of depth: the same apparent thickness at any distance and any object scale. */
export const OUTLINE_WIDTH = { value: 0.0019 };
/**
 * Inverted hull in a darkened version of the part's own colour: back faces pushed out along
 * smoothed normals in view space, scaled by depth.
 */
export function outlineFor(m: THREE.Material) {
  const base = (m as THREE.MeshToonMaterial).color ?? new THREE.Color(INK);
  const hsl = base.getHSL({ h: 0, s: 0, l: 0 });
  const dark = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9), Math.min(0.13, hsl.l * 0.2));
  return memo(`o${dark.getHexString()}`, () => new THREE.ShaderMaterial({
    uniforms: { width: OUTLINE_WIDTH, color: { value: dark } },
    vertexShader: /* glsl */ `
      uniform float width;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xyz += normalize(normalMatrix * normal) * width * -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      void main() {
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
  }));
}

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
      r.addColorStop(0, 'rgba(0,0,0,0.5)');
      r.addColorStop(0.3, 'rgba(0,0,0,0.36)');
      r.addColorStop(0.7, 'rgba(0,0,0,0.12)');
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
/** Book page block: cream with fine page lines. */
export const pagesMat = () =>
  memo('pages', () => {
    const map = canvasTexture(16, 64, (g) => {
      g.fillStyle = '#f4ecd8';
      g.fillRect(0, 0, 16, 64);
      g.fillStyle = 'rgba(120,105,80,0.35)';
      for (let y = 2; y < 64; y += 4) g.fillRect(0, y, 16, 1);
    });
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshToonMaterial({ map, gradientMap: ramp() });
  });
let grain: THREE.CanvasTexture | undefined;
/** Faint wood grain (multiplies the colour), for drawers, plywood and handles. */
function grainTexture() {
  if (!grain) {
    grain = canvasTexture(256, 256, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 46; i++) {
        const y = (i * 5.6 + 3 * Math.sin(i * 1.7)) % 256, a = 0.03 + 0.05 * ((i * 37) % 7) / 7;
        g.strokeStyle = `rgba(90,55,25,${a})`;
        g.lineWidth = 1 + ((i * 13) % 3);
        g.beginPath();
        for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + 2.5 * Math.sin(x / 40 + i));
        g.stroke();
      }
      g.strokeStyle = 'rgba(90,55,25,0.14)';
      for (const [x, y] of [[70, 90], [190, 180]]) {
        g.beginPath();
        g.ellipse(x, y, 10, 4, 0, 0, Math.PI * 2);
        g.stroke();
      }
    });
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  }
  return grain;
}

// ---------- geometry (unit shapes scaled per mesh; cached and shared) ----------
const geos = new Map<string, THREE.BufferGeometry>();
function geo<G extends THREE.BufferGeometry>(key: string, make: () => G): G {
  if (!geos.has(key)) geos.set(key, make());
  return geos.get(key) as G;
}
const k = (...n: number[]) => n.map((x) => +x.toFixed(3)).join(',');
/** Catmull-Rom through a lathe profile, so bodies are smooth curves instead of polylines. */
const smoothProfile = (pts: [number, number][], n: number) =>
  new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y))).getSpacedPoints(n).map((v) => new THREE.Vector2(Math.max(0, v.x), v.y));
export const G = {
  sphere: (ws = 24, hs = 18) => geo(`s${ws},${hs}`, () => new THREE.SphereGeometry(1, ws, hs)),
  /** Rounded both ends; total height = len + 2r. */
  capsule: (r: number, len: number, cap = 4, radial = 16) => geo(`c${k(r, len, cap, radial)}`, () => new THREE.CapsuleGeometry(r, len, cap, radial)),
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  /** Bevelled box (smooth rounded edges); keep the radius below half the smallest side. */
  rbox: (w: number, h: number, d: number, r: number, segs = 3) => geo(`rb${k(w, h, d, r, segs)}`, () => new RoundedBoxGeometry(w, h, d, segs, Math.min(r, Math.min(w, h, d) / 2 - 1e-4))),
  /** Unit-height cylinder of bottom radius 1; `top` is the top radius (0 = cone). Scale it to size. */
  cyl: (top = 1, segs = 28, open = false) => geo(`cy${k(top, segs)}${open}`, () => new THREE.CylinderGeometry(top, 1, 1, segs, 1, open)),
  /** Bevelled disc (radius r, height h, edge round b), axis along Y: watch cases, buttons, lenses. */
  puck: (r: number, h: number, b: number, segs = 32) =>
    geo(`pk${k(r, h, b, segs)}`, () => {
      const pts: THREE.Vector2[] = [new THREE.Vector2(0, -h / 2)];
      for (let i = 0; i <= 4; i++) {
        const a = (i / 4) * (Math.PI / 2);
        pts.push(new THREE.Vector2(r - b + Math.sin(a) * b, -h / 2 + b - Math.cos(a) * b));
      }
      for (let i = 0; i <= 4; i++) {
        const a = (i / 4) * (Math.PI / 2);
        pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, h / 2 - b + Math.sin(a) * b));
      }
      pts.push(new THREE.Vector2(0, h / 2));
      return new THREE.LatheGeometry(pts, segs);
    }),
  /** Ring of radius 1 in the XY plane; `tube` is relative to the ring radius. */
  torus: (tube: number, arc = Math.PI * 2, ts = 32, rs = 8) => geo(`to${k(tube, arc, ts, rs)}`, () => new THREE.TorusGeometry(1, tube, rs, ts, arc)),
  /** Lathe through a smoothed profile. */
  lathe: (key: string, pts: [number, number][], segs = 40, phiStart = 0, phiLength = Math.PI * 2) =>
    geo(`la${key}${k(segs, phiStart, phiLength)}`, () => new THREE.LatheGeometry(smoothProfile(pts, 28), segs, phiStart, phiLength)),
  disc: (segs = 32) => geo(`di${segs}`, () => new THREE.CircleGeometry(1, segs)),
  /** Front half (z >= 0) of a unit-height cylinder: visor brims. */
  halfDisc: () => geo('hd', () => new THREE.CylinderGeometry(1, 1, 1, 32, 1, false, -Math.PI / 2, Math.PI)),
  /** Front half (z >= 0) of a unit sphere: the Star's facade head. */
  halfSphere: () => geo('hs', () => new THREE.SphereGeometry(1, 32, 24, 0, Math.PI)),
  /** Flat panel in the shape of a lathe profile, facing -z: the plywood back of a facade. */
  panel: (key: string, pts: [number, number][]) =>
    geo(`pa${key}`, () => {
      const half = smoothProfile(pts, 28);
      const outline = [...half, ...[...half].reverse().map((v) => new THREE.Vector2(-v.x, v.y))];
      return new THREE.ShapeGeometry(new THREE.Shape(outline), 4).rotateY(Math.PI);
    }),
  /** Eyelid: upper hemisphere closed by a flat disc, so its outline draws the lid line. */
  lid: () =>
    geo('lid', () =>
      mergeGeometries([new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.CircleGeometry(1, 24).rotateX(Math.PI / 2)]),
    ),
  /** Open sleeve tube (unit radius and height, centred), flaring slightly toward the hem at the bottom. */
  sleeve: () => geo('sl', () => new THREE.LatheGeometry([[1.0, 0.5], [1.03, 0.15], [1.07, -0.25], [1.1, -0.5]].map(([x, y]) => new THREE.Vector2(x, y)), 32)),
  /** Eyebrow: thick in the middle, tapered ends, slightly arched; length along X. */
  brow: (len: number, r: number) =>
    geo(`br${k(len, r)}`, () => {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(new THREE.Vector2(r * (0.25 + 0.75 * Math.pow(Math.sin(Math.PI * t), 0.7)) * (i === 0 || i === 12 ? 0 : 1), (t - 0.5) * len));
      }
      const g = new THREE.LatheGeometry(pts, 12).rotateZ(-Math.PI / 2);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 0.35 * r - (p.getX(i) / (len / 2)) ** 2 * 0.35 * r);
      g.computeVertexNormals();
      return g;
    }),
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
/** outline: true always, false never, unset = automatic (tiny details get none, they only add noise). */
export type Part = { p?: V3; r?: V3; s?: V3 | number; outline?: boolean; fx?: boolean };
export function mesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, t: Part = {}) {
  const o = new THREE.Mesh(g, m);
  if (t.p) o.position.set(...t.p);
  if (t.r) o.rotation.set(...t.r);
  if (typeof t.s === 'number') o.scale.setScalar(t.s);
  else if (t.s) o.scale.set(...t.s);
  if (t.outline !== undefined) o.userData.outline = t.outline;
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
    const flags = { outline: wantsOutline(o), fx: !!o.userData.fx };
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

const _s = new THREE.Vector3();
/** Explicit flag, else outline anything bigger than a few centimetres across. */
export function wantsOutline(o: THREE.Mesh) {
  if (o.userData.fx) return false;
  if (o.userData.outline !== undefined) return o.userData.outline as boolean;
  const g = o.geometry as THREE.BufferGeometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  o.getWorldScale(_s);
  return g.boundingSphere!.radius * Math.max(_s.x, _s.y, _s.z) > 0.032;
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
