// The ten module archetypes and the Landlord, built procedurally on the shared rig. Each builder poses
// joints, adds meshes, and returns its neutral (deadpan) face. Character space: feet on y = 0,
// facing +z, +x is the character's left.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ModuleStats } from '@/lib/types';
import type { Archetype, Variant } from '@/lib/cast';
import { faceTraits, sizeOf } from '@/lib/characters';
import { C, G, INK, bake, dropInLite, flat, flatVertex, glow, hull, mesh, outlineColor, outlineFor, outlineSkinned, pagesMat, receiptMat, ribbon, seg, setDetail, shade, shadowMat, tinted, toon, tris, tube, wantsOutline, type Part, type V3 } from './kit';
import { JOINTS, aim, applyExpression, at, bones, createRig, face, limb, prop, snapshotRest, up, type CharacterRig, type Face } from './rig';

export type BuildParams = {
  archetype: Archetype;
  variant: Variant;
  color: string;
  stats: ModuleStats;
  silhouette?: boolean;
  /** Landlord only: one key per module on its key ring. */
  keys?: number;
  /** full: every detail (big stages, /lab). lite: for small on-screen sizes; same rig, far fewer triangles and draw calls. */
  detail?: Detail;
};
export type Detail = 'full' | 'lite';
/** Triangles (body, outline hulls) and draw calls for one character at its build pose. */
export type CastStats = { base: number; outline: number; calls: number };
export type Built = { root: THREE.Group; rig: CharacterRig; neutral: Face; tris: CastStats; dispose: () => void };
/** Segment scale for lite builds. */
const LITE = 0.4;

type Side = 'L' | 'R';
const SIDES = ['L', 'R'] as const;
/** Mirror an x coordinate to a side (+x is the character's left). */
const X = (s: Side, x: number) => (s === 'L' ? x : -x);
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const PI = Math.PI;
const metal = () => toon(C.metal, { gloss: true });
const wood = (color = C.wood) => toon(color, { grain: true });

type Ctx = {
  rig: CharacterRig;
  s: ModuleStats;
  v: Variant;
  /** Width factor from total lines: 1 .. 1.4. */
  w: number;
  /** 0 (tiny module) .. 1 (huge), log scale of total lines. */
  size: number;
  color: string;
  body: THREE.Material;
  /** Hands and feet: a shade darker than the body. */
  skin: THREE.Material;
  /** Sleeves, hems, collars: a darker shade of the body colour. */
  trim: THREE.Material;
  iris: string;
  sweaty: boolean;
  keys: number;
  bake: (parent: THREE.Object3D, build: (g: THREE.Group) => void, t?: Part) => THREE.Group;
  own: <T extends THREE.BufferGeometry>(g: T) => T;
};
type Result = { neutral: Face; shadow: [x: number, z: number, sx: number, sz: number] };

// ---------- shared body parts ----------
type LegOpts = { spread: number; thigh: number; shin: number; r: number; foot: V3; knee?: number; mat?: THREE.Material; footMat?: THREE.Material; hem?: number; hemMat?: THREE.Material };
/** Legs from the hips to the floor; `hem` is the height of a hem band where the legs leave the body. */
function legs(c: Ctx, o: LegOpts) {
  const kf = o.knee ?? 0, fy = o.foot[1];
  const tv = Math.sqrt(o.thigh ** 2 - kf ** 2), sv = Math.sqrt(o.shin ** 2 - kf ** 2);
  const hipY = fy + tv + sv;
  c.rig.hips.position.set(0, hipY, 0);
  for (const s of SIDES) {
    const x = X(s, o.spread);
    const chain = [c.rig[`leg${s}`], c.rig[`hip${s}`], c.rig[`knee${s}`], c.rig[`foot${s}`]];
    bones(chain, limb(chain, [x, hipY, 0], [x, hipY - tv, kf], [x, fy, 0]), o.r, o.r * 0.9, o.mat ?? c.body);
    if (o.hem !== undefined) mesh(chain[1], G.cyl(1.06), o.hemMat ?? c.trim, { p: [0, -(hipY - o.hem) * (o.thigh / tv), 0], s: [o.r * 1.32, 0.05, o.r * 1.32] });
    aim(chain[3], [0, 0, 0]);
    mesh(chain[3], G.sphere(), o.footMat ?? c.skin, { p: [0, 0, o.foot[2] * 0.35], s: o.foot });
  }
  return hipY;
}

type ArmOpts = { m1?: THREE.Material; m2?: THREE.Material; hand?: THREE.Material; sleeve?: THREE.Material | null; cuff?: THREE.Material | null };
/** Arm through shoulder S, elbow E, wrist H (character space); r = [upper, fore, hand] radii (hand 0 = none). */
function arm(c: Ctx, s: Side, S: V3, E: V3, H: V3, r: V3, o: ArmOpts = {}) {
  const chain = [c.rig[`arm${s}`], c.rig[`shoulder${s}`], c.rig[`elbow${s}`], c.rig[`hand${s}`]];
  const L = limb(chain, S, E, H);
  bones(chain, L, r[0], r[1], o.m1 ?? c.body, o.m2 ?? o.m1 ?? c.body);
  // Sleeve over the shoulder join and a cuff at the wrist, so limbs don't look stuck on.
  const sleeve = o.sleeve === undefined ? c.trim : o.sleeve;
  if (sleeve) {
    const o = piece(chain[1], [0, -L[0] * 0.17, 0]);
    mesh(o, G.sleeve(), sleeve, { s: [r[0] * 1.2, L[0] * 0.36, r[0] * 1.2] });
    mesh(o, G.torus(0.09, PI * 2, 32, 8), sleeve, { p: [0, -L[0] * 0.18, 0], r: [PI / 2, 0, 0], s: r[0] * 1.32 });
  }
  if (o.cuff) mesh(chain[2], G.torus(0.32, PI * 2, 24, 8), o.cuff, { p: [0, -L[1] + r[1] * 0.25, 0], r: [PI / 2, 0, 0], s: r[1] * 1.05 });
  if (r[2]) mesh(chain[3], G.sphere(), o.hand ?? c.skin, { s: [r[2], r[2] * 1.1, r[2] * 0.9] });
  return L;
}

/** Ring around a neck or waist (parent space), axis vertical. */
function ring(parent: THREE.Object3D, p: V3, rx: number, rz: number, m: THREE.Material, thick = 0.3, tilt: V3 = [0, 0, 0]) {
  const o = piece(parent, p, tilt);
  mesh(o, G.torus(thick, PI * 2, 40, 8), m, { r: [PI / 2, 0, 0], s: [rx, rz, rx] });
  return o;
}

/** Sweat drops (any file over 300 lines), in the parent's space. No outline: they're tiny. */
function sweat(c: Ctx, parent: THREE.Object3D, pts: V3[]) {
  if (!c.sweaty) return;
  for (const p of pts) {
    const g = new THREE.Group();
    g.position.set(...p);
    parent.add(g);
    mesh(g, G.sphere(), toon(C.water, { gloss: true }), { s: [0.022, 0.026, 0.018], outline: false, keep: true });
    mesh(g, G.cyl(0), toon(C.water, { gloss: true }), { p: [0, 0.03, 0], s: [0.0195, 0.04, 0.0155], outline: false, keep: true });
  }
}

/** Tube through character-space points, stored in the parent's space so it moves with it. */
function tubeIn(c: Ctx, parent: THREE.Object3D, pts: V3[], r: number, m: THREE.Material, t: Part & { segs?: number; radial?: number } = {}) {
  parent.updateWorldMatrix(true, false);
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => parent.worldToLocal(new THREE.Vector3(...p))));
  return mesh(parent, c.own(new THREE.TubeGeometry(curve, seg(t.segs ?? 64, 12), r, seg(t.radial ?? 8, 3), false)), m, t);
}

/** A group with its own transform inside a bake, for props made of several parts. */
function piece(g: THREE.Object3D, p: V3, r: V3 = [0, 0, 0]) {
  const o = new THREE.Group();
  o.position.set(...p);
  o.rotation.set(r[0], r[1], r[2], 'YXZ');
  g.add(o);
  return o;
}

/** Tape strip in the XY plane of its piece (facing +z): darker edges and torn, zigzag ends. */
function tape(g: THREE.Object3D, p: V3, r: V3, len: number, wid: number, color: string) {
  const o = piece(g, p, r);
  const m = toon(color), edge = toon(shade(color, -0.14));
  mesh(o, G.rbox(len, wid, 0.005, 0.002, 1), m, { outline: false });
  for (const y of [-wid / 2, wid / 2]) mesh(o, G.box(), edge, { p: [0, y * 0.94, 0.0012], s: [len, wid * 0.08, 0.005], outline: false });
  for (const x of [-len / 2, len / 2]) for (let i = 0; i < 3; i++) mesh(o, G.box(), m, { p: [x, -wid / 3 + (i * wid) / 3, 0], r: [0, 0, PI / 4], s: [wid * 0.23, wid * 0.23, 0.005], outline: false });
  return o;
}

/** Stitch dashes along a polyline (points just above the surface). */
function stitches(g: THREE.Object3D, pts: V3[], color: string, every = 0.034) {
  const m = flat(color);
  for (let i = 1; i < pts.length; i++) {
    const a = new THREE.Vector3(...pts[i - 1]), b = new THREE.Vector3(...pts[i]);
    const d = a.distanceTo(b), dir = b.clone().sub(a).normalize();
    for (let t = every / 2; t < d; t += every) {
      const o = new THREE.Group();
      o.position.copy(a).addScaledVector(dir, t);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      g.add(o);
      mesh(o, G.box(), m, { s: [every * 0.55, 0.0055, 0.0055], outline: false });
    }
  }
}

/** Button with two holes, facing +z of its piece (yaw it onto curved surfaces). */
function button(g: THREE.Object3D, p: V3, r: number, color: string, yaw = 0) {
  const o = piece(g, p, [PI / 2, yaw, 0]);
  mesh(o, G.puck(r, r * 0.5, r * 0.2, 18), toon(color, { gloss: true }), { outline: false });
  for (const dx of [-0.32, 0.32]) mesh(o, G.sphere(8, 6), flat(shade(color, -0.32)), { p: [dx * r, r * 0.25, 0], s: r * 0.15, outline: false });
}

/** Paper sheet with grey "lines" (no text) facing +z of its piece. */
function sheet(g: THREE.Object3D, p: V3, r: V3, w: number, h: number, lines = 5) {
  const o = piece(g, p, r);
  mesh(o, G.rbox(w, h, 0.004, 0.0015, 1), toon(C.paper));
  for (let i = 0; i < lines; i++) mesh(o, G.box(), flat('#a9a49a'), { p: [-w * 0.06 * (i % 2), h * 0.32 - (i * h * 0.64) / Math.max(1, lines - 1), 0.0025], s: [w * (0.7 - 0.12 * (i % 2)), h * 0.025, 0.002], outline: false });
  return o;
}

/** Point on a lathe surface: angle a around Y (0 = front), height y, pushed out by `out`. */
const profileR = (prof: [number, number][], y: number) => {
  for (let i = 1; i < prof.length; i++)
    if (y <= prof[i][1]) return prof[i - 1][0] + ((prof[i][0] - prof[i - 1][0]) * (y - prof[i - 1][1])) / (prof[i][1] - prof[i - 1][1]);
  return 0;
};
const onLathe = (prof: [number, number][], sx: number, sz: number) => (a: number, y: number, out = 0.006): V3 => {
  const r = profileR(prof, y) + out;
  return [Math.sin(a) * r * sx, y, Math.cos(a) * r * sz];
};

// ---------- 1. The Bouncer: guards everything, held up by almost nothing ----------
function bouncer(c: Ctx): Result {
  const { rig, w } = c;
  const black = toon(C.black, { gloss: true });
  legs(c, { spread: 0.075, thigh: 0.2, shin: 0.19, r: 0.03, foot: [0.055, 0.035, 0.085], hem: 0.375 });
  mesh(rig.hips, G.sphere(), c.trim, { p: [0, 0.03, 0], s: [0.15 * w, 0.1, 0.12] });
  at(rig.torso, [0, 0.47, 0]);
  // Barrel chest about 2.5x the hips, on stick legs.
  mesh(rig.torso, G.sphere(48, 36), c.body, { p: [0, 0.48, 0.02], s: [0.39 * w, 0.44, 0.33] });
  ring(rig.torso, [0, 0.09, 0.005], 0.17 * w, 0.14, c.trim, 0.3);
  at(rig.neck, [0, 1.36, 0.08]);
  at(rig.head, [0, 1.49, 0.11]);
  ring(rig.neck, [0, 0.025, 0.01], 0.075, 0.07, c.trim, 0.32);
  const hr: V3 = [0.12, 0.13, 0.12];
  mesh(rig.head, G.sphere(32, 24), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.045, eyeY: 0.012, eyeW: 0.024, eyeH: 0.031, mouthY: -0.068, mouthW: 0.05, browLen: 0.036, browR: 0.011, skin: c.body, iris: c.iris });
  // Round sunglasses one size too small: the eyes show around the lenses.
  c.bake(prop(rig, 'sunglasses', rig.head), (g) => {
    for (const s of SIDES) {
      const l = piece(g, [X(s, 0.045), 0.014, 0.134], [PI / 2, 0, 0]);
      mesh(l, G.puck(0.017, 0.007, 0.0025), black, { outline: true });
      mesh(g, G.rbox(0.006, 0.006, 0.144, 0.002, 1), black, { p: [X(s, 0.09), 0.018, 0.066], r: [0, X(s, -0.4), 0] });
    }
    mesh(g, G.rbox(0.058, 0.006, 0.006, 0.002, 1), black, { p: [0, 0.019, 0.136] });
  });
  const ear = prop(rig, 'earpiece', rig.head);
  mesh(ear, G.sphere(), black, { p: [-0.118, -0.005, 0.01], s: 0.016 });
  const a: V3 = [-0.112, -0.03, -0.01], b: V3 = [-0.07, -0.16, -0.05];
  mesh(ear, c.own(tube((t) => { const p = lerp3(a, b, t); return [p[0] + 0.008 * Math.cos(t * 44), p[1], p[2] + 0.008 * Math.sin(t * 44)]; }, 0.0035, 140, 4)), black, { outline: false });
  // Arms permanently crossed, resting on the chest; tight sleeves.
  arm(c, 'L', [0.37 * w, 1.24, 0], [0.43 * w, 0.98, 0.26], [-0.16 * w, 1.07, 0.44], [0.1, 0.09, 0.085]);
  arm(c, 'R', [-0.37 * w, 1.24, 0], [-0.43 * w, 1.01, 0.29], [0.19 * w, 1.13, 0.51], [0.1, 0.09, 0.085]);
  const hand: V3 = [0.19 * w, 1.13, 0.51];
  if (!c.v) {
    // A tiny clipboard pinched between two fingers.
    const clip = prop(rig, 'clipboard', rig.handR);
    at(clip, [hand[0] + 0.08, hand[1] + 0.08, hand[2] + 0.04]);
    aim(clip, [-0.1, 0.25, -0.35]);
    c.bake(clip, (g) => {
      mesh(g, G.rbox(0.085, 0.115, 0.008, 0.004, 2), wood(), { outline: true });
      sheet(g, [0, -0.008, 0.006], [0, 0, 0], 0.07, 0.085, 4);
      mesh(g, G.rbox(0.04, 0.016, 0.01, 0.004, 2), metal(), { p: [0, 0.052, 0.008] });
      for (const z of [-0.016, 0.016]) mesh(g, G.capsule(0.014, 0.04), c.skin, { p: [-0.045, -0.045, z], r: [0, 0, 0.9], outline: true });
    });
  } else {
    // Velvet-rope post instead of the clipboard; it holds the rope end in the same two fingers.
    const post = prop(rig, 'ropePost', rig.root);
    const base: V3 = [0.66 * w, 0, 0.3];
    c.bake(post, (g) => {
      mesh(g, G.puck(0.11, 0.035, 0.012), metal(), { p: [base[0], 0.0175, base[2]] });
      mesh(g, G.cyl(1), metal(), { p: [base[0], 0.39, base[2]], s: [0.022, 0.75, 0.022] });
      mesh(g, G.sphere(), metal(), { p: [base[0], 0.79, base[2]], s: 0.045 });
      mesh(g, G.torus(0.3), metal(), { p: [base[0], 0.76, base[2]], r: [PI / 2, 0, 0], s: 0.03, outline: false });
    });
    const top: V3 = [base[0] - 0.03, 0.78, base[2]], end: V3 = [hand[0] + 0.05, hand[1] - 0.02, hand[2] + 0.03];
    tubeIn(c, post, [top, lerp3(lerp3(top, end, 0.35), [0, 0.42, 0.45], 0.5), lerp3(lerp3(top, end, 0.7), [0, 0.55, 0.5], 0.4), end], 0.018, toon('#a3243b', { gloss: true }));
  }
  sweat(c, rig.head, [[0.1, 0.06, 0.05], [0.085, 0.0, 0.08]]);
  return { neutral: { browL: [0.05, 0.02], browR: [-0.4, 0.38], lid: 0.55, frown: 0.25, mouthW: 0.9 }, shadow: [0, 0.03, 0.42 * w, 0.32] };
}

// ---------- 2. The Accountant: counts everything twice and still isn't sure ----------
const PEAR: [number, number][] = [[0, -0.05], [0.2, -0.03], [0.33, 0.07], [0.38, 0.21], [0.37, 0.35], [0.31, 0.5], [0.23, 0.65], [0.16, 0.78], [0.1, 0.86], [0, 0.9]];
function accountant(c: Ctx): Result {
  const { rig, w } = c;
  const green = '#3fae68', dark = toon(C.metalDark, { gloss: true }), shirt = toon('#f2efe6');
  legs(c, { spread: 0.12 * w, thigh: 0.14, shin: 0.13, r: 0.06, foot: [0.075, 0.045, 0.11], hem: 0.29 });
  at(rig.torso, [0, 0.33, 0]);
  rig.torso.rotation.x = 0.24; // hunched over the numbers
  // The pear is a sweater vest: ribbed hem, shirt collar at the neck.
  mesh(rig.torso, G.lathe('pear', PEAR, 48), c.body, { s: [w, 1, 0.85] });
  ring(rig.torso, [0, 0.07, 0], (profileR(PEAR, 0.07) + 0.01) * w, (profileR(PEAR, 0.07) + 0.01) * 0.85, c.trim, 0.09);
  const vest = onLathe(PEAR, w, 0.85);
  c.bake(rig.torso, (g) => {
    for (const s of SIDES) mesh(piece(g, vest(X(s, 0.25), 0.84, 0.0), [0.5, X(s, 0.25), X(s, -0.6)]), G.rbox(0.09, 0.05, 0.02, 0.008, 2), shirt);
    stitches(g, [0.1, 0.25, 0.4, 0.55, 0.7].map((y) => vest(0, y, 0.004)), shade(c.color, -0.3), 0.03);
  });
  at(rig.neck, [0, 1.13, 0.2]);
  at(rig.head, [0, 1.3, 0.27]);
  aim(rig.head, [0.06, 0, 0]);
  const hr: V3 = [0.27, 0.27, 0.25];
  mesh(rig.head, G.sphere(32, 24), c.body, { s: hr });
  // Huge round glasses magnify its eyes to about twice the size.
  face(rig, { r: hr, eyeX: 0.11, eyeY: -0.01, eyeW: 0.075, eyeH: 0.092, mouthY: -0.155, mouthW: 0.07, browY: 0.012, skin: c.body, iris: c.iris });
  const glasses = prop(rig, 'glasses', rig.head);
  c.bake(glasses, (g) => {
    for (const s of SIDES) {
      mesh(g, G.torus(0.13, PI * 2, 40, 10), dark, { p: [X(s, 0.11), -0.01, 0.29], s: 0.1 });
      mesh(g, G.rbox(0.012, 0.012, 0.286, 0.004, 1), dark, { p: [X(s, 0.24), 0, 0.14], r: [0, X(s, -0.21), 0] });
    }
    mesh(g, G.rbox(0.034, 0.012, 0.012, 0.004, 1), dark, { p: [0, 0.01, 0.294] });
  });
  for (const s of SIDES) mesh(glasses, G.disc(), glow('#e3f4ff', 0.18), { p: [X(s, 0.11), -0.01, 0.293], s: 0.098, fx: true, full: true });
  for (const s of SIDES) mesh(glasses, G.sphere(10, 6), flat('#ffffff'), { p: [X(s, 0.11) - 0.04, 0.03, 0.296], r: [0, 0, -0.6], s: [0.022, 0.008, 0.002], outline: false, full: true });
  // Green translucent visor, wider than its head.
  const visor = prop(rig, 'visor', rig.head);
  ring(visor, [0, 0.2, 0], 0.186, 0.173, toon(green), 0.08);
  mesh(visor, G.halfDisc(), tinted(green, 0.62), { p: [0, 0.205, 0.02], r: [0.12, 0, 0], s: [0.34, 0.012, 0.37] });
  mesh(visor, G.torus(0.04, PI, 48, 6), toon(shade(green, -0.15)), { p: [0, 0.205, 0.02], r: [PI / 2 + 0.12, 0, 0], s: [0.34, 0.37, 0.34] });
  // White shirt sleeves under the vest, sleeve garters, shirt cuffs.
  const E: Record<Side, V3> = { L: [0.29 * w, 0.8, 0.24], R: [-0.29 * w, 0.8, 0.22] };
  const H: Record<Side, V3> = { L: [0.07, 0.86, 0.47], R: [-0.04, 0.87, 0.5] };
  for (const s of SIDES) {
    const L = arm(c, s, [X(s, 0.2 * w), 1.04, 0.14], E[s], H[s], [0.058, 0.052, 0.055], { m1: shirt, sleeve: null, cuff: shirt });
    mesh(rig[`shoulder${s}`], G.torus(0.25), toon(C.black), { p: [0, -L[0] * 0.55, 0], r: [PI / 2, 0, 0], s: 0.064 });
  }
  const gadget = prop(rig, c.v ? 'abacus' : 'calculator', rig.elbowL);
  const yaw = Math.atan2(H.L[0] - E.L[0], H.L[2] - E.L[2]);
  at(gadget, [...lerp3(E.L, H.L, 0.74)].map((v, i) => v + (i === 1 ? 0.065 : 0)) as V3);
  aim(gadget, [-0.25, yaw, 0]);
  c.bake(gadget, (g) => {
    mesh(g, G.rbox(0.078, 0.03, 0.032, 0.008, 2), toon(C.black), { p: [0, -0.04, 0], outline: false }); // strap
    mesh(g, G.rbox(0.03, 0.012, 0.036, 0.004, 1), metal(), { p: [0.03, -0.028, 0], outline: false });
    if (!c.v) {
      mesh(g, G.rbox(0.1, 0.026, 0.13, 0.008, 2), toon('#454a50'), { outline: true });
      mesh(g, G.rbox(0.08, 0.006, 0.035, 0.002, 1), toon('#b9c9a7', { gloss: true }), { p: [0, 0.014, 0.04], outline: false });
      for (let i = 0; i < 4; i++) mesh(g, G.box(), flat('#6f7d63'), { p: [0.025 - i * 0.014, 0.0175, 0.04], s: [0.008, 0.001, 0.016], outline: false });
      for (let i = 0; i < 12; i++)
        mesh(g, G.rbox(0.017, 0.008, 0.014, 0.003, 1), toon(i === 11 ? '#e8833a' : C.paper), { p: [((i % 3) - 1) * 0.026, 0.015, 0.006 - Math.floor(i / 3) * 0.02], outline: false });
    } else {
      // Abacus strapped to the wrist instead of the calculator.
      for (const z of [-0.065, 0.065]) mesh(g, G.rbox(0.18, 0.02, 0.02, 0.006, 1), wood(), { p: [0, 0, z] });
      for (const x of [-0.085, 0.085]) mesh(g, G.rbox(0.02, 0.02, 0.15, 0.006, 1), wood(), { p: [x, 0, 0] });
      for (const z of [-0.032, 0, 0.032]) {
        mesh(g, G.cyl(1, 8), metal(), { p: [0, 0, z], r: [0, 0, PI / 2], s: [0.004, 0.17, 0.004], outline: false });
        for (let i = 0; i < 4; i++) mesh(g, G.sphere(10, 8), toon(i % 2 ? '#b8433a' : C.woodDark, { gloss: true }), { p: [-0.06 + i * 0.025 + (z > 0 ? 0.03 : 0), 0, z], s: [0.011, 0.013, 0.013], outline: false });
      }
    }
  });
  // A receipt roll spills from its pocket and curls along the floor; longer with more lines.
  const roll = prop(rig, 'receiptRoll', rig.torso);
  at(roll, [-0.31 * w, 0.52, 0.2]);
  mesh(roll, G.puck(0.045, 0.09, 0.008), toon(C.paper), { r: [0, 0, PI / 2] });
  mesh(roll, G.cyl(1, 12), toon('#8c8577'), { r: [0, 0, PI / 2], s: [0.012, 0.092, 0.012], outline: false });
  const len = 0.6 + 2.6 * c.size;
  const hang = new THREE.CatmullRomCurve3([[-0.31 * w, 0.48, 0.24], [-0.37 * w, 0.3, 0.27], [-0.41 * w, 0.1, 0.22], [-0.42 * w, 0.006, 0.12]].map((p) => new THREE.Vector3(...(p as V3))));
  const pts = hang.getPoints(16);
  for (let d = 0.025; d <= len; d += 0.025) {
    const a = d * 9, r = 0.07 * (1 - d / (len + 0.4));
    pts.push(new THREE.Vector3(-0.42 * w - 0.14 * d - 0.12 * Math.sin(d * 2.2), 0.006 + r * (1 - Math.cos(a)), 0.12 - 0.55 * d - r * Math.sin(a)));
  }
  mesh(prop(rig, 'receipt', rig.root), c.own(ribbon(pts, 0.1)), receiptMat(), { outline: false });
  sweat(c, rig.head, [[0.23, 0.08, 0.1], [0.22, 0.0, 0.13]]);
  return { neutral: { brow: [0.18, -0.22], lid: 0.9, mouthW: 0.62, frown: 0.12, look: [0, -0.04] }, shadow: [0, 0.1, 0.45 * w, 0.42] };
}

// ---------- 3. The Clerk: processes requests all day; one hand is a rubber stamp ----------
function clerk(c: Ctx): Result {
  const { rig, w } = c;
  const tie = '#8e2d3a', shirt = toon('#f2efe6');
  legs(c, { spread: 0.1 * w, thigh: 0.31, shin: 0.3, r: 0.045, foot: [0.06, 0.04, 0.1], hem: 0.63 });
  at(rig.torso, [0, 0.65, 0]);
  rig.torso.rotation.x = 0.07;
  mesh(rig.torso, G.rbox(0.42 * w, 0.64, 0.27, 0.08, 5), c.body, { p: [0, 0.3, 0] });
  at(rig.neck, [0, 1.25, 0.03]);
  aim(rig.neck, [0.16, 0, 0]);
  mesh(rig.neck, G.capsule(0.055, 0.06), c.body, { p: [0, 0.04, 0] });
  ring(rig.neck, [0, 0.005, 0], 0.07, 0.066, shirt, 0.32);
  at(rig.head, [0, 1.45, 0.06]);
  aim(rig.head, [0.04, 0, 0]);
  mesh(rig.head, G.rbox(0.34, 0.3, 0.28, 0.09, 5), c.body);
  face(rig, { flat: 0.14, eyeX: 0.075, eyeY: 0.02, eyeW: 0.042, eyeH: 0.05, mouthY: -0.085, mouthW: 0.08, skin: c.body, iris: c.iris });
  for (const s of SIDES) mesh(rig.head, G.torus(0.22, PI, 24, 6), toon('#8c8494'), { p: [X(s, 0.075), -0.036, 0.142], r: [0, 0, PI], s: [0.04, 0.02, 0.03], outline: false });
  // Shirt collar, a tie that is far too short, a breast pocket with a pen.
  c.bake(rig.torso, (g) => {
    for (const s of SIDES) mesh(g, G.rbox(0.075, 0.04, 0.012, 0.005, 2), shirt, { p: [X(s, 0.035), 0.6, 0.137], r: [0, 0, X(s, -0.5)] });
    mesh(g, G.rbox(0.045, 0.04, 0.022, 0.008, 2), toon(tie), { p: [0, 0.585, 0.143] });
    mesh(g, G.rbox(0.05, 0.09, 0.014, 0.005, 2), toon(tie), { p: [0, 0.52, 0.141] });
    mesh(g, G.rbox(0.036, 0.036, 0.014, 0.005, 2), toon(tie), { p: [0, 0.476, 0.141], r: [0, 0, PI / 4] });
    mesh(g, G.rbox(0.05, 0.007, 0.006, 0.002, 1), toon('#d4b04a', { gloss: true }), { p: [0, 0.505, 0.15], outline: false });
    mesh(g, G.rbox(0.09, 0.08, 0.012, 0.006, 2), c.trim, { p: [0.11 * w, 0.43, 0.138] });
    stitches(g, [[0.11 * w - 0.04, 0.455, 0.145], [0.11 * w + 0.04, 0.455, 0.145]], shade(c.color, -0.35), 0.018);
    mesh(g, G.cyl(1, 12), toon('#2f4a8a', { gloss: true }), { p: [0.13 * w, 0.48, 0.14], s: [0.008, 0.07, 0.008], outline: false });
    stitches(g, [[0, 0.44, 0.137], [0, 0.04, 0.137]], shade(c.color, -0.3), 0.03);
  });
  arm(c, 'L', [0.235 * w, 1.17, 0.02], [0.27 * w, 0.9, 0.06], [0.26 * w, 0.64, 0.1], [0.045, 0.042, 0.05], { cuff: shirt });
  arm(c, 'R', [-0.235 * w, 1.17, 0.02], [-0.28 * w, 0.9, 0.07], [-0.28 * w, 0.63, 0.12], [0.045, 0.042, 0], { cuff: shirt });
  const stamp = prop(rig, 'stamp', rig.handR);
  aim(stamp, [0, 0, 0]);
  c.bake(stamp, (g) => {
    mesh(g, G.sphere(), wood(), { s: 0.055 });
    mesh(g, G.cyl(0.8), wood(), { p: [0, -0.08, 0], s: [0.03, 0.11, 0.03] });
    mesh(g, G.torus(0.3), toon('#c9a54a', { gloss: true }), { p: [0, -0.13, 0], r: [PI / 2, 0, 0], s: 0.034, outline: false });
    mesh(g, G.rbox(0.24, 0.08, 0.16, 0.018), wood(C.woodDark), { p: [0, -0.17, 0] });
    mesh(g, G.rbox(0.22, 0.026, 0.14, 0.008), toon('#3a1d1f'), { p: [0, -0.222, 0] });
  });
  // The paperwork on its head grows with the file count.
  const n = Math.min(24, Math.max(2, c.s.fileCount * 2));
  if (!c.v) {
    c.bake(prop(rig, 'inTray', rig.head), (g) => {
      mesh(g, G.rbox(0.38, 0.014, 0.29, 0.006, 2), metal(), { p: [0, 0.158, 0] });
      for (const z of [-0.14, 0.14]) mesh(g, G.rbox(0.38, 0.065, 0.014, 0.006, 2), metal(), { p: [0, 0.19, z] });
      for (const x of [-0.185, 0.185]) mesh(g, G.rbox(0.014, 0.065, 0.29, 0.006, 2), metal(), { p: [x, 0.19, 0] });
      for (let i = 0; i < n; i++) mesh(g, G.rbox(0.27, 0.008, 0.2, 0.003, 1), toon(i % 3 ? C.paper : C.white), { p: [(rnd(i) - 0.5) * 0.03, 0.172 + i * 0.0105, (rnd(i + 7) - 0.5) * 0.025], r: [0, (rnd(i + 3) - 0.5) * 0.3, 0] });
      for (const k of [0, 1]) sheet(g, [k ? 0.08 : -0.1, 0.2 + n * 0.0105, k ? -0.02 : 0.03], [PI / 2 - 0.2, k ? 0.4 : -0.3, k ? -0.35 : 0.3], 0.2, 0.15, 4);
    });
  } else {
    // Take-a-number ticket machine instead of the in-tray; the strip grows with the file count.
    const disp = prop(rig, 'ticketDispenser', rig.head);
    disp.rotation.set(0, 0.25, -0.08);
    mesh(disp, G.rbox(0.3, 0.13, 0.2, 0.03), metal(), { p: [0, 0.215, 0] });
    mesh(disp, G.rbox(0.12, 0.05, 0.006, 0.002, 1), toon(tie), { p: [0, 0.215, 0.101], outline: false });
    mesh(disp, G.box(), toon(C.black), { p: [0.151, 0.2, 0], s: [0.006, 0.012, 0.08] });
    const drop = 0.1 + 0.025 * n;
    const pts = [new THREE.Vector3(0.15, 0.2, 0), new THREE.Vector3(0.2, 0.19, 0.01), new THREE.Vector3(0.23, 0.12, 0.02)];
    for (let d = 0.03; d <= drop; d += 0.03) pts.push(new THREE.Vector3(0.235 + 0.01 * Math.sin(d * 8), 0.12 - d, 0.02 + 0.02 * Math.sin(d * 5)));
    mesh(disp, c.own(ribbon(pts, 0.065)), receiptMat(), { outline: false });
  }
  sweat(c, rig.head, [[0.16, 0.07, 0.12]]);
  return { neutral: { lid: 0.32, brow: [-0.15, 0.02], pupil: 0.8, frown: 0.15, mouthW: 0.9 }, shadow: [0, 0.03, 0.3 * w, 0.25] };
}

// ---------- 4. The Doorman: extremely important about timing, extremely small ----------
const TAILCOAT: [number, number][] = [[0, -0.03], [0.14, -0.01], [0.21, 0.09], [0.225, 0.21], [0.2, 0.33], [0.14, 0.41], [0, 0.44]];
function doorman(c: Ctx): Result {
  const { rig, w } = c;
  const coat = toon('#26262c'), satin = toon('#3d3d47', { gloss: true }), white = toon(C.white), gold = '#d6a531';
  legs(c, { spread: 0.065, thigh: 0.1, shin: 0.1, r: 0.036, foot: [0.05, 0.034, 0.085], footMat: toon(C.black, { gloss: true }), hem: 0.2, hemMat: coat });
  at(rig.torso, [0, 0.24, 0]);
  mesh(rig.torso, G.lathe('tailcoat', TAILCOAT, 40), coat, { s: [w, 1, 0.9] });
  const coatAt = onLathe(TAILCOAT, w, 0.9);
  c.bake(rig.torso, (g) => {
    mesh(g, G.sphere(), white, { p: [0, 0.27, 0.125], s: [0.085, 0.12, 0.07] });
    // Bow tie, satin lapels, two gold buttons.
    for (const s of SIDES) mesh(g, G.cyl(0, 12), toon(C.black), { p: [X(s, 0.03), 0.37, 0.165], r: [0, 0, X(s, PI / 2)], s: [0.025, 0.05, 0.02] });
    mesh(g, G.sphere(), toon(C.black), { p: [0, 0.37, 0.168], s: 0.014 });
    for (const s of SIDES) mesh(piece(g, coatAt(X(s, 0.42), 0.3, 0.004), [0.15, X(s, 0.42), X(s, 0.35)]), G.rbox(0.035, 0.17, 0.012, 0.005, 2), satin);
    for (const y of [0.14, 0.2]) button(g, coatAt(0.32, y, 0.004), 0.014, gold, 0.32);
    // Tailcoat tails dragging on the floor.
    for (const s of SIDES) {
      mesh(g, G.rbox(0.1, 0.34, 0.03, 0.012), coat, { p: [X(s, 0.065), -0.05, -0.215], r: [0.15, 0, X(s, -0.06)] });
      mesh(g, G.rbox(0.1, 0.03, 0.36, 0.012), coat, { p: [X(s, 0.075), -0.225, -0.42], r: [0, X(s, -0.1), 0] });
    }
  });
  at(rig.neck, [0, 0.66, 0.02]);
  rig.neck.rotation.x = -0.28; // chin raised, looking down its nose at you
  at(rig.head, [0, 0.82, 0.03]);
  ring(rig.neck, [0, -0.005, 0], 0.11, 0.1, white, 0.3);
  const hr: V3 = [0.19, 0.18, 0.18];
  mesh(rig.head, G.sphere(32, 24), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.068, eyeY: 0, eyeW: 0.037, eyeH: 0.046, mouthY: -0.085, mouthW: 0.065, skin: c.body, iris: c.iris });
  // A top hat taller than the rest of it.
  const hat = prop(rig, 'topHat', rig.head);
  hat.position.set(0, 0.15, -0.01);
  hat.rotation.set(0.16, 0, 0.05); // stays nearly upright while the chin goes up
  c.bake(hat, (g) => {
    const silk = toon(C.black, { gloss: true });
    mesh(g, G.puck(0.27, 0.025, 0.01, 48), silk, { p: [0, 0.0125, 0] });
    mesh(g, G.cyl(1.05, 48), silk, { p: [0, 0.545, 0], s: [0.155, 1.04, 0.155] });
    mesh(g, G.cyl(1, 48), toon('#55555d'), { p: [0, 0.08, 0], s: [0.159, 0.07, 0.159] });
    mesh(g, G.rbox(0.03, 0.05, 0.012, 0.004, 1), toon('#55555d'), { p: [0.11, 0.08, 0.115], r: [0, 0.8, 0], outline: false });
  });
  // White gloves; one hand holds the timepiece up mid-check, the other is behind its back.
  arm(c, 'R', [-0.19 * w, 0.58, 0], [-0.3 * w, 0.48, 0.1], [-0.36, 0.62, 0.17], [0.04, 0.037, 0.052], { m1: coat, sleeve: satin, cuff: white, hand: white });
  arm(c, 'L', [0.19 * w, 0.58, 0], [0.25 * w, 0.42, -0.08], [0.1, 0.36, -0.2], [0.04, 0.037, 0.052], { m1: coat, sleeve: satin, cuff: white, hand: white });
  const timer = prop(rig, c.v ? 'hourglass' : 'pocketWatch', rig.handR);
  at(timer, [-0.4, 0.86, 0.19]);
  aim(timer, [0, 0.3, 0]);
  if (!c.v) {
    // Pocket watch bigger than its head: minute and hour ticks, a glass dome, a crown.
    const hand = (a: number, len: number, z: number, wd: number): Part => ({ p: [Math.sin(a) * len * 0.45, Math.cos(a) * len * 0.45, z], r: [0, 0, -a], s: [wd, len, 0.004], outline: false });
    c.bake(timer, (g) => {
      const g1 = toon(gold, { gloss: true });
      mesh(piece(g, [0, 0, 0], [PI / 2, 0, 0]), G.puck(0.23, 0.055, 0.018, 48), g1);
      mesh(piece(g, [0, 0, 0.026], [PI / 2, 0, 0]), G.puck(0.198, 0.012, 0.004, 48), toon(C.paper), { outline: false });
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * PI * 2, major = i % 5 === 0;
        mesh(g, G.box(), flat(INK), { p: [Math.sin(a) * 0.172, Math.cos(a) * 0.172, 0.034], r: [0, 0, -a], s: [major ? 0.008 : 0.003, major ? 0.03 : 0.012, 0.003], outline: false });
      }
      mesh(g, G.torus(0.04, PI * 2, 48, 6), toon('#b8892a'), { p: [0, 0, 0.034], s: 0.14, outline: false });
      mesh(g, G.box(), flat(INK), hand(0.65, 0.15, 0.037, 0.009));
      mesh(g, G.box(), flat(INK), hand(4.3, 0.1, 0.039, 0.013));
      mesh(g, G.sphere(), toon(gold, { gloss: true }), { p: [0, 0, 0.041], s: 0.013, outline: false });
      mesh(g, G.sphere(32, 12), toon('#eef6ff', { gloss: true, opacity: 0.22 }), { p: [0, 0, 0.03], s: [0.2, 0.2, 0.025], outline: false, full: true });
      mesh(g, G.cyl(1, 20), g1, { p: [0, 0.255, 0], s: [0.03, 0.05, 0.03] });
      for (let i = 0; i < 4; i++) mesh(g, G.torus(0.12), toon('#b8892a'), { p: [0, 0.24 + i * 0.01, 0], r: [PI / 2, 0, 0], s: 0.032, outline: false });
      mesh(g, G.torus(0.22), g1, { p: [0, 0.3, 0], s: 0.04 });
    });
    tubeIn(c, rig.torso, [[-0.33, 0.6, 0.2], [-0.2, 0.42, 0.24], [-0.05, 0.4, 0.23], [0.06, 0.46, 0.19]], 0.008, toon(gold, { gloss: true }), { outline: false, segs: 48, radial: 6 });
  } else {
    // Hourglass instead of the watch, still bigger than its head.
    c.bake(timer, (g) => {
      const glass = toon('#e9f6ff', { gloss: true, opacity: 0.45 });
      mesh(g, G.cyl(0.12, 32), glass, { p: [0, -0.11, 0], s: [0.13, 0.2, 0.13] });
      mesh(g, G.cyl(0.12, 32), glass, { p: [0, 0.11, 0], r: [PI, 0, 0], s: [0.13, 0.2, 0.13] });
      mesh(g, G.cyl(0.3, 24), toon('#e3c58c'), { p: [0, -0.17, 0], s: [0.11, 0.08, 0.11], outline: false });
      mesh(g, G.cyl(0, 16), toon('#e3c58c'), { p: [0, 0.045, 0], r: [PI, 0, 0], s: [0.05, 0.05, 0.05], outline: false });
      for (const y of [-0.225, 0.225]) mesh(g, G.puck(0.16, 0.03, 0.01, 40), wood(), { p: [0, y, 0] });
      for (let i = 0; i < 3; i++) mesh(g, G.cyl(1, 12), wood(C.woodDark), { p: [Math.sin(i * 2.1) * 0.14, 0, Math.cos(i * 2.1) * 0.14], s: [0.012, 0.42, 0.012] });
    });
  }
  sweat(c, rig.head, [[0.16, 0.06, 0.07]]);
  return { neutral: { browL: [0.4, -0.1], browR: [0.05, 0.1], lid: 0.42, look: [0, -0.4], frown: 0.35, mouthW: 0.8 }, shadow: [0, -0.1, 0.3, 0.42] };
}

// ---------- 5. The Hoarder: kept everything, just in case ----------
function hoarder(c: Ctx): Result {
  const { rig, w } = c;
  const strapM = toon('#7a6646'), buckle = metal(), cardboard = '#c69c6d';
  legs(c, { spread: 0.1 * w, thigh: 0.21, shin: 0.2, r: 0.055, knee: 0.08, foot: [0.07, 0.045, 0.11], hem: 0.38 }); // knees buckled
  at(rig.torso, [0, 0.43, 0]);
  rig.torso.rotation.x = 0.2;
  mesh(rig.torso, G.capsule(0.24, 0.3, 8, 32), c.body, { p: [0, 0.3, 0], s: [w, 1, 0.9] });
  at(rig.neck, [0, 1.06, 0.16]);
  at(rig.head, [0, 1.24, 0.22]);
  aim(rig.head, [0, 0, 0]);
  ring(rig.neck, [0, 0.0, -0.01], 0.13, 0.12, c.trim, 0.3);
  const hr: V3 = [0.23, 0.22, 0.22];
  mesh(rig.head, G.sphere(32, 24), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.08, eyeY: 0, eyeW: 0.044, eyeH: 0.054, mouthY: -0.095, mouthW: 0.08, skin: c.body, iris: c.iris });
  // Load 3-4x its body, growing with total lines; item count too.
  const bs = 0.95 + 0.4 * c.size;
  const Wp = 1.15 * bs, Hp = 1.35 * bs, Dp = 0.78 * bs;
  const pack = prop(rig, c.v ? 'boxTower' : 'backpack', rig.torso);
  at(pack, [0, 0.35 + Hp / 2, -0.25 - Dp / 2]);
  aim(pack, [0.1, 0, 0]);
  let top = Hp / 2;
  const packed = (b: THREE.Object3D, bw: number, bh: number, bd: number, i: number) => {
    mesh(b, G.rbox(bw, bh, bd, 0.02, 2), toon(i % 2 ? '#b98e5e' : cardboard));
    tape(b, [0, bh / 2 + 0.003, 0], [PI / 2, 0, 0], bd + 0.02, 0.07, '#d9cfb8');
  };
  c.bake(pack, (g) => {
    if (!c.v) {
      const canvas = toon(C.canvas), flap = toon('#a58c66'), seam = shade(C.canvas, -0.32);
      mesh(g, G.rbox(Wp, Hp, Dp, 0.22 * bs, 4), canvas);
      mesh(g, G.rbox(Wp * 0.9, 0.24 * bs, Dp * 0.92, 0.1 * bs, 3), flap, { p: [0, Hp * 0.47, 0.03], r: [0.08, 0, 0] });
      for (const s of SIDES) mesh(g, G.rbox(0.26 * bs, 0.46 * bs, Dp * 0.6, 0.09 * bs, 3), flap, { p: [X(s, Wp * 0.52), -Hp * 0.12, 0] });
      mesh(g, G.cyl(1, 32), toon('#7f8f6a'), { p: [0, Hp * 0.6, -0.08], r: [0, 0, PI / 2], s: [0.15 * bs, Wp * 0.95, 0.15 * bs] });
      for (const x of [-0.3, 0.3]) mesh(g, G.torus(0.25), strapM, { p: [x * Wp, Hp * 0.6, -0.08], r: [0, PI / 2, 0], s: [0.16 * bs, 0.16 * bs, 0.16 * bs], outline: false });
      // Back pocket with a buckled flap, straps, stitching along the seams.
      mesh(g, G.rbox(Wp * 0.6, Hp * 0.36, 0.1, 0.05, 3), flap, { p: [0, -Hp * 0.18, -Dp / 2 - 0.03] });
      mesh(g, G.rbox(Wp * 0.62, Hp * 0.12, 0.11, 0.04, 2), toon(shade('#a58c66', -0.08)), { p: [0, -Hp * 0.02, -Dp / 2 - 0.035] });
      for (const s of SIDES) {
        mesh(g, G.rbox(0.07, Hp * 0.8, 0.02, 0.008, 1), strapM, { p: [X(s, 0.25 * bs), 0, -Dp / 2 - 0.01] });
        mesh(g, G.rbox(0.08, 0.06, 0.024, 0.006, 1), buckle, { p: [X(s, 0.25 * bs), -Hp * 0.05, -Dp / 2 - 0.09], outline: false });
      }
      stitches(g, [[-Wp * 0.42, Hp * 0.42, -Dp / 2 - 0.004], [-Wp * 0.48, -Hp * 0.3, -Dp / 2 + 0.02], [-Wp * 0.3, -Hp * 0.48, -Dp / 2 + 0.03]], seam, 0.04);
      stitches(g, [[Wp * 0.42, Hp * 0.42, -Dp / 2 - 0.004], [Wp * 0.48, -Hp * 0.3, -Dp / 2 + 0.02], [Wp * 0.3, -Hp * 0.48, -Dp / 2 + 0.03]], seam, 0.04);
      top = Hp * 0.6 + 0.12;
    } else {
      // A tower of taped cardboard boxes instead of the backpack.
      const k = 3 + Math.round(3 * c.size);
      let y = -Hp / 2;
      for (let i = 0; i < k; i++) {
        const bw = Wp * (0.78 + 0.2 * rnd(i)), bh = Hp * (0.38 + 0.12 * rnd(i + 4)), bd = Dp * (0.85 + 0.15 * rnd(i + 8));
        packed(piece(g, [(rnd(i + 2) - 0.5) * 0.12, y + bh / 2, (rnd(i + 6) - 0.5) * 0.08], [0, (rnd(i + 1) - 0.5) * 0.25, 0]), bw, bh, bd, i);
        y += bh;
      }
      top = y;
    }
    const items: ((p: THREE.Group) => void)[] = [
      (p) => { // traffic cone
        const o = piece(p, [-0.3 * bs, top + 0.18, 0.02], [0.15, 0, 0.35]);
        mesh(o, G.cyl(0.12, 32), toon('#ff7a1a'), { s: [0.12, 0.42, 0.12] });
        mesh(o, G.cyl(0.6, 32), toon(C.white, { gloss: true }), { p: [0, 0.03, 0], s: [0.088, 0.07, 0.088], outline: false });
        mesh(o, G.rbox(0.28, 0.03, 0.28, 0.01, 2), toon('#ff7a1a'), { p: [0, -0.21, 0] });
      },
      (p) => { // lamp
        const o = piece(p, [0.32 * bs, top + 0.05, -0.05], [-0.15, 0, -0.25]);
        mesh(o, G.cyl(1, 12), metal(), { p: [0, 0.25, 0], s: [0.015, 0.5, 0.015] });
        mesh(o, G.cyl(0.55, 32, true), toon(C.paper, { double: true }), { p: [0, 0.55, 0], s: [0.16, 0.18, 0.16] });
        mesh(o, G.torus(0.12), toon(shade(C.paper, -0.2)), { p: [0, 0.46, 0], r: [PI / 2, 0, 0], s: 0.16, outline: false });
      },
      (p) => { // chair leg
        const o = piece(p, [Wp / 2 + 0.1, Hp * 0.2, 0.05], [0, 0, -1.05]);
        mesh(o, G.cyl(0.8, 16), wood(), { s: [0.035, 0.7, 0.035] });
        mesh(o, G.puck(0.032, 0.04, 0.008, 16), wood(C.woodDark), { p: [0, 0.36, 0] });
      },
      (p) => { // stacked boxes
        packed(piece(p, [0, top + 0.13, -0.12], [0, 0.2, 0]), 0.36, 0.26, 0.3, 0);
        packed(piece(p, [0.03, top + 0.36, -0.12], [0, -0.15, 0]), 0.28, 0.2, 0.24, 1);
      },
      (p) => { // rubber duck, on top of the boxes
        const o = piece(p, [0.02, top + 0.51, -0.1], [0, 0.4, 0]);
        const duck = toon('#f4c430', { gloss: true });
        mesh(o, G.sphere(), duck, { s: [0.1, 0.075, 0.085] });
        mesh(o, G.sphere(), duck, { p: [0, 0.08, 0.05], s: 0.055 });
        mesh(o, G.rbox(0.04, 0.016, 0.032, 0.006, 1), toon('#ff7a1a'), { p: [0, 0.075, 0.108], outline: false });
        for (const s of SIDES) mesh(o, G.sphere(8, 6), flat(INK), { p: [X(s, 0.026), 0.095, 0.092], s: 0.008, outline: false });
      },
      (p) => { // coiled hose, hung on the side
        const o = piece(p, [-(Wp / 2 + 0.05), Hp * 0.02, 0.05], [0, PI / 2, 0]);
        for (let i = 0; i < 3; i++) mesh(o, G.torus(0.2, PI * 2, 32, 8), toon('#4b5560'), { p: [0.01 * i, -0.05 * i, 0.03 * i - 0.03], s: 0.14 });
        mesh(o, G.rbox(0.05, 0.08, 0.05, 0.01, 1), strapM, { p: [0, 0.13, -0.02], outline: false });
      },
      (p) => { // umbrella handle
        const o = piece(p, [-0.08, top + 0.15, 0.22], [0.2, 0, 0.1]);
        mesh(o, G.cyl(1, 12), toon(C.black, { gloss: true }), { s: [0.018, 0.4, 0.018] });
        mesh(o, G.torus(0.25, PI, 20, 8), toon(C.black, { gloss: true }), { p: [0.06, 0.2, 0], s: 0.06 });
      },
      (p) => { // frying pan, hanging by its handle
        const o = piece(p, [Wp / 2 + 0.03, -Hp * 0.25, 0.1], [0, PI / 2, 0.3]);
        mesh(piece(o, [0, 0, 0], [PI / 2, 0, 0]), G.puck(0.15, 0.03, 0.01, 40), toon(C.metalDark, { gloss: true }));
        mesh(o, G.rbox(0.035, 0.2, 0.02, 0.008, 1), toon(C.black), { p: [0, -0.24, 0] });
      },
    ];
    const count = Math.min(items.length, 3 + Math.round(5 * c.size));
    items.slice(0, count).forEach((f) => f(g));
  });
  // Shoulder straps with buckles, and a loose one across its forehead it peeks out from under.
  for (const s of SIDES) {
    tubeIn(c, rig.torso, [[X(s, 0.17 * w), 1.25, -0.24], [X(s, 0.21 * w), 1.07, 0.12], [X(s, 0.2 * w), 0.84, 0.3], [X(s, 0.12 * w), 0.6, 0.27]], 0.035, strapM, { segs: 40, radial: 8 });
    const b = prop(rig, `buckle${s}`, rig.torso);
    at(b, [X(s, 0.2 * w), 0.86, 0.33]);
    aim(b, [-0.3, X(s, -0.2), 0]);
    mesh(b, G.rbox(0.075, 0.06, 0.016, 0.008, 2), buckle);
  }
  tubeIn(c, rig.torso, [[0.24, 1.7, -0.28], [0.15, 1.5, 0.2], [0.02, 1.43, 0.37], [-0.17, 1.42, 0.31], [-0.27, 1.32, 0.12]], 0.028, strapM, { segs: 40, radial: 8 });
  for (const s of SIDES) arm(c, s, [X(s, 0.24 * w), 0.98, 0.1], [X(s, 0.34 * w), 0.78, 0.22], [X(s, 0.16 * w), 0.86, 0.33], [0.06, 0.055, 0.06]);
  sweat(c, rig.head, [[0.19, 0.08, 0.1]]);
  return { neutral: { lid: 0.5, brow: [0.12, -0.06], smile: 0.6, mouthW: 0.85 }, shadow: [0, -0.3, 0.75 * bs, 0.75] };
}

// ---------- 6. The Inspector: gets far too close to everything ----------
const VEST: [number, number][] = [[0.272, 0.0], [0.287, 0.14], [0.287, 0.34], [0.264, 0.48], [0.2, 0.58]];
function inspector(c: Ctx): Result {
  const { rig, w } = c;
  const lime = '#d4ef3c', silver = toon('#eceeee', { gloss: true });
  legs(c, { spread: 0.1 * w, thigh: 0.17, shin: 0.16, r: 0.055, foot: [0.072, 0.048, 0.11], footMat: toon('#3a2c22'), hem: 0.33 });
  at(rig.torso, [0, 0.38, 0]);
  rig.torso.rotation.x = 0.14;
  mesh(rig.torso, G.capsule(0.26, 0.22, 8, 32), c.body, { p: [0, 0.27, 0], s: [w, 1, 0.9] });
  // Hi-vis vest: reflective bands round the middle and up over the shoulders, trim, a zip, seams.
  mesh(rig.torso, G.lathe('vest', VEST, 48), toon(lime, { double: true }), { s: [w, 1, 0.9] });
  const vest = onLathe(VEST, w, 0.9);
  for (const y of [0.17, 0.32]) ring(rig.torso, [0, y, 0], 0.292 * w, 0.262, silver, 0.08);
  ring(rig.torso, [0, 0.005, 0], 0.276 * w, 0.248, toon(shade(lime, -0.18)), 0.06);
  c.bake(rig.torso, (g) => {
    for (const s of SIDES) {
      const pts = [0.32, 0.4, 0.48, 0.56].map((y) => vest(X(s, 0.42), y, 0.008));
      for (let i = 1; i < pts.length; i++) {
        const a = new THREE.Vector3(...pts[i - 1]), b = new THREE.Vector3(...pts[i]);
        const o = new THREE.Group();
        o.position.copy(a).lerp(b, 0.5);
        o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        g.add(o);
        mesh(o, G.box(), silver, { s: [0.045, a.distanceTo(b) + 0.01, 0.01], outline: false });
      }
      stitches(g, [0.05, 0.2, 0.35, 0.5].map((y) => vest(X(s, 1.5), y, 0.004)), shade(lime, -0.4));
    }
    stitches(g, [0.02, 0.14, 0.26, 0.38, 0.5].map((y) => vest(0, y, 0.005)), '#5b6612', 0.022);
    mesh(piece(g, vest(0, 0.52, 0.01), [0, 0, 0]), G.rbox(0.018, 0.03, 0.008, 0.003, 1), metal(), { outline: false });
  });
  // Long neck already craned forward and to one side: the head sits well ahead of the body.
  const B: V3 = [0, 0.95, 0.12], Hc: V3 = [-0.27, 1.33, 0.46];
  at(rig.neck, B);
  up(rig.neck, [Hc[0] - B[0], Hc[1] - B[1], Hc[2] - B[2]]);
  const nl = Math.hypot(Hc[0] - B[0], Hc[1] - B[1], Hc[2] - B[2]) - 0.1;
  mesh(rig.neck, G.capsule(0.06, nl, 6, 20), c.body, { p: [0, nl / 2, 0] });
  ring(rig.neck, [0, 0.03, 0], 0.085, 0.085, c.trim, 0.3);
  at(rig.head, Hc);
  aim(rig.head, [-0.05, 0.28, 0.16]);
  const hr: V3 = [0.21, 0.2, 0.2];
  mesh(rig.head, G.sphere(32, 24), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.075, eyeY: 0, eyeW: 0.042, eyeH: 0.052, mouthY: -0.088, mouthW: 0.065, skin: c.body, iris: c.iris });
  c.bake(prop(rig, 'hardHat', rig.head), (g) => {
    const shell = toon('#f6f4ee', { gloss: true });
    mesh(g, G.lid(), shell, { p: [0, 0.07, 0], s: [0.222, 0.17, 0.232] });
    mesh(g, G.puck(0.27, 0.02, 0.008, 48), shell, { p: [0, 0.075, 0.035], s: [1, 1, 1.1] });
    mesh(g, G.rbox(0.04, 0.03, 0.3, 0.012, 2), toon('#e2ded2'), { p: [0, 0.235, 0] });
  });
  arm(c, 'R', [-0.25 * w, 0.84, 0.08], [-0.35 * w, 0.66, 0.34], [-0.06, 0.76, 0.62], [0.052, 0.048, 0.055]);
  arm(c, 'L', [0.25 * w, 0.84, 0.08], [0.33 * w, 0.62, 0.22], [0.2, 0.62, 0.4], [0.052, 0.048, 0.055]);
  const tool = prop(rig, c.v ? 'tapeMeasure' : 'magnifier', rig.handR);
  aim(tool, [0, 0, 0]);
  c.bake(tool, (g) => {
    if (!c.v) {
      mesh(g, G.cyl(0.9, 16), wood(), { p: [0, 0.06, 0], s: [0.022, 0.13, 0.022] });
      mesh(g, G.torus(0.3), metal(), { p: [0, 0.13, 0], r: [PI / 2, 0, 0], s: 0.024, outline: false });
      mesh(g, G.torus(0.14, PI * 2, 48, 10), metal(), { p: [0, 0.22, 0.02], s: 0.11 });
      mesh(g, G.disc(), glow('#dff2ff', 0.3), { p: [0, 0.22, 0.02], s: 0.1, fx: true, full: true });
      mesh(g, G.sphere(10, 6), flat('#ffffff'), { p: [-0.04, 0.26, 0.025], r: [0, 0, -0.7], s: [0.03, 0.01, 0.002], outline: false, full: true });
    } else {
      // Tape measure, already extended at you.
      const o = piece(g, [0, 0.04, 0.02], [0.1, 1.05, 0]);
      mesh(o, G.rbox(0.12, 0.12, 0.05, 0.025, 3), toon('#f2c41b', { gloss: true }), { r: [0, PI / 2, 0] });
      mesh(o, G.rbox(0.028, 0.004, 0.72, 0.0015, 1), toon('#f5d84c'), { p: [0, -0.03, 0.4] });
      for (let i = 0; i < 24; i++) mesh(o, G.box(), flat(INK), { p: [0.008, -0.027, 0.06 + i * 0.03], s: [i % 4 ? 0.008 : 0.014, 0.002, 0.002], outline: false });
      mesh(o, G.rbox(0.032, 0.025, 0.006, 0.002, 1), metal(), { p: [0, -0.02, 0.765] });
    }
  });
  const board = prop(rig, 'clipboard', rig.handL);
  at(board, [0.2, 0.7, 0.43]);
  aim(board, [-0.4, -0.3, 0]);
  c.bake(board, (g) => {
    mesh(g, G.rbox(0.2, 0.27, 0.012, 0.01, 2), wood());
    sheet(g, [0, -0.01, 0.008], [0, 0, 0], 0.17, 0.22, 6);
    for (let i = 0; i < 6; i++) mesh(g, G.box(), flat(i % 3 === 1 ? '#3a8a4a' : '#7d7a73'), { p: [0.065, 0.06 - i * 0.028, 0.012], s: [0.012, 0.012, 0.002], outline: false });
    mesh(g, G.rbox(0.07, 0.03, 0.02, 0.006, 2), metal(), { p: [0, 0.125, 0.012] });
  });
  sweat(c, rig.head, [[0.17, 0.08, 0.09]]);
  return { neutral: { browL: [-0.32, 0.42], browR: [0.12, 0.3], lidL: 0.28, lidR: 1.02, pupil: 0.72, mouthW: 0.7, frown: 0.2 }, shadow: [0, 0.12, 0.38 * w, 0.42] };
}

// ---------- 7. The Junk Drawer: everything nobody knew where to put ----------
function junkDrawer(c: Ctx): Result {
  const { rig, w } = c;
  const W = 1.0 * w, H = 0.8, D = 0.62, t = 0.05;
  const painted = toon(c.color, { grain: true });
  legs(c, { spread: 0.3 * w, thigh: 0.16, shin: 0.15, r: 0.045, foot: [0.06, 0.04, 0.09] });
  at(rig.torso, [0, 0.37, 0]);
  c.bake(rig.torso, (g) => {
    mesh(g, G.rbox(W, t, D, 0.012, 2), painted, { p: [0, H - t / 2, 0] });
    mesh(g, G.rbox(W + 0.06, 0.03, D + 0.04, 0.012, 2), painted, { p: [0, H + 0.015, 0.01] });
    mesh(g, G.rbox(W, t, D, 0.012, 2), painted, { p: [0, t / 2, 0] });
    for (const s of SIDES) mesh(g, G.rbox(t, H, D, 0.012, 2), painted, { p: [X(s, W / 2 - t / 2), H / 2, 0] });
    mesh(g, G.box(), toon(C.woodDark, { grain: true }), { p: [0, H / 2, -D / 2 + 0.015], s: [W - 2 * t, H - 2 * t, 0.03] });
    // Plinths where the legs meet the cabinet, grommets where the arms come out.
    for (const s of SIDES) mesh(g, G.puck(0.07, 0.03, 0.01), wood(C.woodDark), { p: [X(s, 0.3 * w), -0.012, 0] });
    for (const s of SIDES) mesh(piece(g, [X(s, W / 2 + 0.004), H * 0.55, 0.05], [0, 0, X(s, PI / 2)]), G.torus(0.3), metal(), { r: [PI / 2, 0, 0], s: 0.045 });
  });
  // The drawer is the head: half open, its front is the face.
  const Wd = W - 2 * t - 0.01, Hd = 0.52, Dd = D - 0.05, pull = 0.42 * Dd;
  at(rig.neck, [0, 0.37 + t + Hd / 2 + 0.005, D / 2]);
  rig.head.position.set(0, 0, pull + 0.025);
  c.bake(rig.head, (g) => {
    mesh(g, G.rbox(Wd + 0.02, Hd + 0.03, 0.05, 0.014, 4), painted);
    const pine = wood('#b98a5a');
    mesh(g, G.rbox(Wd - 0.02, 0.02, Dd, 0.006, 1), pine, { p: [0, -Hd / 2 + 0.01, -Dd / 2] });
    for (const s of SIDES) mesh(g, G.rbox(0.02, Hd * 0.76, Dd, 0.006, 1), pine, { p: [X(s, Wd / 2 - 0.02), -Hd * 0.12, -Dd / 2] });
    mesh(g, G.rbox(Wd - 0.02, Hd * 0.76, 0.02, 0.006, 1), pine, { p: [0, -Hd * 0.12, -Dd + 0.01] });
    // A crumpled pile everything else sits on.
    for (let i = 0; i < 12; i++) mesh(g, G.sphere(16, 12), toon(i % 3 ? C.paper : '#d9d2c2'), { p: [(rnd(i) - 0.5) * (Wd - 0.15), -Hd / 2 + 0.24 + rnd(i + 3) * 0.07, -0.06 - rnd(i + 5) * (Dd - 0.12)], s: [0.12, 0.09, 0.11], outline: false });
  });
  face(rig, { flat: 0.026, eyeX: 0.15, eyeY: 0.075, eyeW: 0.052, eyeH: 0.062, mouthY: -0.165, mouthW: 0.1, skin: painted, iris: c.iris });
  // Knob nose, and the handle under it like a moustache.
  c.bake(prop(rig, c.v ? 'bowHandle' : 'barHandle', rig.head), (g) => {
    mesh(g, G.sphere(), wood(), { p: [0, 0, 0.05], s: [0.035, 0.032, 0.03] });
    if (!c.v) {
      mesh(g, G.capsule(0.016, 0.24, 6, 16), metal(), { p: [0, -0.075, 0.075], r: [0, 0, PI / 2] });
      for (const s of SIDES) mesh(g, G.cyl(0.8, 16), metal(), { p: [X(s, 0.11), -0.075, 0.05], r: [PI / 2, 0, 0], s: [0.013, 0.05, 0.013] });
    } else mesh(g, G.torus(0.13, PI, 32, 10), metal(), { p: [0, -0.115, 0.05], s: [0.14, 0.07, 0.14] });
  });
  // Items spilling out of the open drawer; one per file, up to 7. Small ones skip outlines.
  const fl = -Hd / 2 + 0.02;
  const ink = toon(C.black, { gloss: true });
  const main: ((g: THREE.Group) => void)[] = [
    (g) => mesh(piece(g, [0.2 * w, 0.32, -0.12], [0.2, 0, -0.32]), G.cyl(0.7, 12), wood(), { s: [0.012, 0.8, 0.012] }), // a single chopstick
    (g) => { // tangled cables, looping up and over the front edge
      const pts: V3[] = [[0.02, fl + 0.05, -0.17], [0.05, 0.42, -0.16], [-0.04, 0.62, -0.14], [-0.15, 0.56, -0.1], [-0.2, 0.36, -0.06], [-0.3, 0.29, 0.01], [-0.36, 0.17, 0.05], [-0.33, 0.03, 0.065], [-0.4, -0.12, 0.06], [-0.37, -0.25, 0.07]];
      g.add(new THREE.Mesh(c.own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg(80, 24), 0.012, seg(8, 3), false)), ink));
      mesh(g, G.rbox(0.04, 0.05, 0.025, 0.008, 2), ink, { p: [-0.37, -0.28, 0.07] });
      for (const dx of [-0.008, 0.008]) mesh(g, G.box(), metal(), { p: [-0.37 + dx, -0.315, 0.07], s: [0.004, 0.025, 0.008], outline: false });
    },
    (g) => { // folded takeaway menu
      for (const s of SIDES) {
        const o = piece(g, [X(s, 0.05) - 0.06, 0.3, -0.14], [0, 0, X(s, -0.42)]);
        mesh(o, G.rbox(0.005, 0.24, 0.17, 0.002, 1), toon(C.paper));
        mesh(o, G.box(), toon('#d9473a'), { p: [X(s, 0.003), 0.07, 0], s: [0.003, 0.05, 0.172], outline: false });
        for (let i = 0; i < 3; i++) mesh(o, G.box(), flat('#a9a49a'), { p: [X(s, 0.003), -0.01 - i * 0.03, 0], s: [0.003, 0.008, 0.12], outline: false });
      }
    },
    (g) => { // rubber-band ball
      const o = piece(g, [0.07, 0.25, -0.16]);
      mesh(o, G.sphere(), toon('#e5533c'), { s: 0.075 });
      for (let i = 0; i < 4; i++) mesh(o, G.torus(0.07, PI * 2, 32, 6), toon('#b83a28'), { r: [i * 1.1, i * 0.7, 0], s: 0.077, outline: false });
    },
    (g) => { // batteries
      for (let i = 0; i < 2; i++) {
        const o = piece(g, [0.3 * w + i * 0.05, 0.24, -0.16 + i * 0.05], [0.2, 0, -0.3 + i * 0.5]);
        mesh(o, G.cyl(1, 20), ink, { s: [0.022, 0.1, 0.022], outline: false });
        mesh(o, G.cyl(1, 20), toon('#c27a2e', { gloss: true }), { p: [0, 0.03, 0], s: [0.0225, 0.04, 0.0225], outline: false });
        mesh(o, G.cyl(1, 12), metal(), { p: [0, 0.055, 0], s: [0.01, 0.012, 0.01], outline: false });
      }
    },
    (g) => { // a mystery key
      const o = piece(g, [-0.27 * w, 0.36, -0.16], [0, 0.3, 0.25]);
      const brass = toon('#c9a54a', { gloss: true });
      mesh(o, G.torus(0.28, PI * 2, 24, 8), brass, { p: [0, 0.06, 0], s: 0.035, outline: false });
      mesh(o, G.rbox(0.014, 0.18, 0.006, 0.002, 1), brass, { p: [0, -0.06, 0], outline: false });
      for (const y of [-0.12, -0.14]) mesh(o, G.box(), brass, { p: [0.012, y, 0], s: [0.016, 0.012, 0.006], outline: false });
    },
    (g) => { // a dead pen
      const o = piece(g, [-0.12, 0.3, -0.08], [0.3, 0, 0.5]);
      mesh(o, G.capsule(0.013, 0.17, 4, 12), toon('#ececec', { gloss: true }), { outline: false });
      mesh(o, G.cyl(1, 12), ink, { p: [0, 0.08, 0], s: [0.015, 0.05, 0.015], outline: false });
      mesh(o, G.rbox(0.004, 0.04, 0.004, 0.0015, 1), metal(), { p: [0.016, 0.075, 0], outline: false });
    },
  ];
  const utensils: ((g: THREE.Group) => void)[] = [
    (g) => { // spatula
      const o = piece(g, [0.2 * w, 0.3, -0.12], [0.15, 0, -0.3]);
      mesh(o, G.cyl(1, 12), wood(), { s: [0.016, 0.55, 0.016] });
      mesh(o, G.rbox(0.12, 0.16, 0.012, 0.005, 2), wood(), { p: [0, 0.34, 0] });
    },
    (g) => { // whisk
      const o = piece(g, [-0.15, 0.34, -0.15], [0.1, 0, 0.3]);
      mesh(o, G.cyl(1, 16), metal(), { s: [0.015, 0.3, 0.015] });
      for (let i = 0; i < 3; i++) mesh(o, G.torus(0.06, PI * 2, 32, 6), metal(), { p: [0, 0.27, 0], r: [0, (i * PI) / 3, 0], s: [0.055, 0.11, 0.055], outline: false });
    },
    (g) => { // ladle
      const o = piece(g, [0.02, 0.27, -0.18], [-0.2, 0, 0.1]);
      mesh(o, G.cyl(1, 12), metal(), { s: [0.012, 0.5, 0.012] });
      mesh(o, G.lid(), metal(), { p: [0, -0.25, 0.02], r: [PI, 0, 0], s: 0.07 });
    },
    (g) => mesh(piece(g, [0.32 * w, 0.25, -0.15], [PI / 2, 0, 0.3]), G.torus(0.35, PI * 2, 32, 10), toon('#e8dfcc'), { s: 0.06 }), // tape roll
    (g) => { // birthday candles
      for (let i = 0; i < 2; i++) mesh(piece(g, [-0.3 * w + i * 0.05, 0.26, -0.15], [0, 0, 0.2 - i * 0.4]), G.cyl(1, 10), toon(i ? '#7fb6e8' : '#f29bb5'), { s: [0.008, 0.11, 0.008], outline: false });
    },
    main[1],
    main[6],
  ];
  const n = Math.min(7, Math.max(2, c.s.fileCount));
  c.bake(prop(rig, 'drawerItems', rig.head), (g) => (c.v ? utensils : main).slice(0, n).forEach((f) => f(g)));
  for (const s of SIDES) arm(c, s, [X(s, W / 2 + 0.02), 0.37 + H * 0.55, 0.05], [X(s, W / 2 + 0.13), 0.37 + H * 0.4, 0.1], [X(s, W / 2 + 0.14), 0.37 + H * 0.2, 0.17], [0.035, 0.032, 0.045], { sleeve: null });
  sweat(c, rig.head, [[0.33, 0.24, 0.05]]);
  return { neutral: { look: [-0.45, -0.32], brow: [0.25, -0.32], lid: 0.72, frown: 0.32, mouthW: 0.8 }, shadow: [0, 0.05, 0.62 * w, 0.5] };
}

// ---------- 8. The Plumber: everything flows through it, held together with tape ----------
const BOILER: [number, number][] = [[0, -0.07], [0.22, -0.05], [0.35, 0.06], [0.41, 0.22], [0.41, 0.4], [0.35, 0.57], [0.25, 0.7], [0.12, 0.77], [0, 0.79]];
function plumber(c: Ctx): Result {
  const { rig, w } = c;
  const covColor = '#6f86a0', cov = toon(covColor), seam = shade(covColor, -0.32), beanie = '#d6a12b', pipeM = metal(), tapeColor = C.tape;
  legs(c, { spread: 0.13 * w, thigh: 0.2, shin: 0.2, r: 0.075, foot: [0.085, 0.055, 0.13], mat: cov, footMat: toon('#4a3426') });
  for (const s of SIDES) mesh(c.rig[`knee${s}`], G.torus(0.28, PI * 2, 24, 8), toon(shade(covColor, -0.1)), { p: [0, -0.165, 0], r: [PI / 2, 0, 0], s: 0.08 }); // trouser cuffs over the boots
  at(rig.torso, [0, 0.46, 0]);
  mesh(rig.torso, G.lathe('boiler', BOILER, 48), cov, { s: [w, 1, 0.88] });
  at(rig.neck, [0, 1.2, 0]);
  at(rig.head, [0, 1.37, 0.02]);
  const hr: V3 = [0.24, 0.23, 0.23];
  mesh(rig.head, G.sphere(32, 24), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.085, eyeY: -0.01, eyeW: 0.045, eyeH: 0.055, mouthY: -0.105, mouthW: 0.09, skin: c.body, iris: c.iris });
  // A beanie with a ribbed cuff: no cap, no moustache.
  c.bake(prop(rig, 'beanie', rig.head), (g) => {
    mesh(g, G.lid(), toon(beanie), { p: [0, 0.07, -0.01], s: [0.25, 0.2, 0.245] });
    mesh(g, G.torus(0.2, PI * 2, 48, 10), toon(shade(beanie, -0.06)), { p: [0, 0.08, -0.01], r: [PI / 2, 0, 0], s: [0.24, 0.235, 0.3] });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * PI * 2;
      mesh(piece(g, [Math.sin(a) * 0.282, 0.08, -0.01 + Math.cos(a) * 0.277], [0, a, 0]), G.box(), flat(shade(beanie, -0.25)), { s: [0.004, 0.05, 0.004], outline: false });
    }
  });
  const surf = onLathe(BOILER, w, 0.88);
  // Coveralls: collar, zip, chest pocket with a button, seams, a tool belt with pouches.
  c.bake(rig.torso, (g) => {
    for (const s of SIDES) mesh(piece(g, surf(X(s, 0.35), 0.74, 0.01), [0.8, X(s, 0.35), X(s, -0.5)]), G.rbox(0.14, 0.07, 0.02, 0.008, 2), cov);
    stitches(g, [0.7, 0.6, 0.5, 0.4, 0.3, 0.22].map((y) => surf(0, y, 0.006)), seam, 0.026);
    mesh(piece(g, surf(0, 0.68, 0.012), [0.6, 0, 0]), G.rbox(0.02, 0.035, 0.008, 0.003, 1), metal(), { outline: false });
    for (const s of SIDES) stitches(g, [0.0, 0.2, 0.4, 0.6].map((y) => surf(X(s, 1.57), y, 0.004)), seam);
    mesh(piece(g, surf(0.35, 0.52, 0.012), [-0.5, 0.35, 0]), G.rbox(0.11, 0.1, 0.012, 0.006, 2), toon(shade(covColor, -0.05)));
    stitches(g, [surf(0.17, 0.57, 0.02), surf(0.52, 0.57, 0.02)], seam, 0.02);
    button(g, surf(0.35, 0.56, 0.022), 0.011, '#c9a54a', 0.35);
    ring(g, [0, 0.2, 0], 0.418 * w, 0.418 * 0.88, toon('#6a4a30'), 0.12);
    mesh(piece(g, surf(0, 0.2, 0.04), [0, 0, 0]), G.rbox(0.07, 0.06, 0.02, 0.008, 2), toon('#c9a54a', { gloss: true }));
    for (const s of SIDES) {
      const a = X(s, 0.62);
      const o = piece(g, surf(a, 0.13, 0.03), [0, a, 0]);
      mesh(o, G.rbox(0.12, 0.13, 0.07, 0.02, 3), toon('#7d5a3c'));
      mesh(o, G.rbox(0.125, 0.04, 0.075, 0.015, 2), toon('#6a4a30'), { p: [0, 0.055, 0.002] });
    }
    mesh(piece(g, surf(-0.62, 0.22, 0.05), [0, 0, 0.2]), G.cyl(0.85, 12), wood(), { s: [0.016, 0.22, 0.016] });
  });
  // Pipe coiled around its body (touching it), with joint collars, ending in a slow leak.
  const coil = (t: number): V3 => surf(t * PI * 2.4 - 0.9, 0.62 - 0.52 * t, 0.045);
  const pipe: V3[] = [];
  for (let i = 0; i <= 60; i++) pipe.push(coil(i / 60));
  const end = pipe[pipe.length - 1];
  pipe.push([end[0] + 0.05, end[1] - 0.01, end[2] + 0.1], [end[0] + 0.08, end[1] - 0.08, end[2] + 0.13]);
  const pipeGroup = prop(rig, 'pipe', rig.torso);
  const curve = new THREE.CatmullRomCurve3(pipe.map((p) => new THREE.Vector3(...p)));
  mesh(pipeGroup, c.own(new THREE.TubeGeometry(curve, seg(160, 40), 0.045, seg(12, 6), false)), pipeM);
  // Duct tape: always one on the pipe, plus one patch per TODO (up to 6) on coveralls and pipe.
  const patches = 1 + Math.min(6, c.s.todoCount);
  c.bake(pipeGroup, (g) => {
    for (const u of [0.05, 0.5, 0.995]) {
      const o = piece(g, curve.getPointAt(u).toArray() as V3);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(u));
      mesh(o, G.cyl(1, 20), pipeM, { s: [0.056, 0.05, 0.056] });
    }
    for (let i = 0; i < patches; i++) {
      if (i % 2 === 0) {
        const u = 0.12 + (0.76 * i) / Math.max(1, patches - 1); // stays on the pipe however many TODOs
        const o = piece(g, curve.getPointAt(u).toArray() as V3);
        o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(u));
        mesh(o, G.cyl(1, 20), toon(tapeColor), { s: [0.051, 0.07, 0.051], outline: false });
        for (const y of [-0.035, 0.035]) mesh(o, G.torus(0.08, PI * 2, 20, 4), toon(shade(tapeColor, -0.15)), { p: [0, y, 0], r: [PI / 2, 0, 0], s: 0.051, outline: false });
      } else {
        const spots: [number, number][] = [[0.45, 0.48], [-0.5, 0.32], [0.9, 0.62], [-1.0, 0.1]];
        const [a, y] = spots[(i >> 1) % spots.length];
        const o = piece(g, surf(a, y, 0.012), [0, a, 0]);
        for (const r of [0.6, -0.6]) tape(o, [0, 0, 0], [0, 0, r], 0.13, 0.035, tapeColor);
      }
    }
  });
  // Tiny bucket catching the drip.
  const tip: V3 = pipe[pipe.length - 1];
  rig.torso.updateWorldMatrix(true, false);
  const tipW = rig.torso.localToWorld(new THREE.Vector3(...tip));
  const bucket = prop(rig, 'bucket', rig.root);
  bucket.position.set(tipW.x + 0.02, 0, tipW.z + 0.04);
  c.bake(bucket, (g) => {
    mesh(g, G.lathe('bucket', [[0, 0], [0.085, 0], [0.095, 0.05], [0.108, 0.15], [0.104, 0.152]], 32), toon(C.metal, { gloss: true, double: true }));
    mesh(g, G.torus(0.08, PI * 2, 32, 6), metal(), { p: [0, 0.15, 0], r: [PI / 2, 0, 0], s: 0.108, outline: false });
    mesh(g, G.disc(), toon(C.water, { gloss: true }), { p: [0, 0.12, 0], r: [-PI / 2, 0, 0], s: 0.1, outline: false });
    mesh(g, G.torus(0.04, PI, 24, 4), toon(C.metalDark, { gloss: true }), { p: [0, 0.15, 0], s: 0.105, outline: false });
    for (let i = 0; i < 3; i++) {
      const y = 0.2 + (tipW.y - 0.25) * ((i + 0.5) / 3);
      mesh(g, G.sphere(12, 8), toon(C.water, { gloss: true }), { p: [-0.02, y, -0.04], s: [0.014, 0.019, 0.014], outline: false });
    }
  });
  // Rolled sleeves; a wrench taller than itself on its shoulder.
  const Hr: V3 = [-0.42 * w, 1.0, 0.3];
  arm(c, 'R', [-0.37 * w, 1.07, 0], [-0.53 * w, 0.88, 0.12], Hr, [0.075, 0.068, 0.072], { m1: cov, m2: c.body, sleeve: toon(shade(covColor, -0.08)) });
  arm(c, 'L', [0.37 * w, 1.07, 0], [0.55 * w, 0.85, -0.04], [0.42 * w, 0.72, 0.16], [0.075, 0.068, 0.072], { m1: cov, m2: c.body, sleeve: toon(shade(covColor, -0.08)) });
  for (const s of SIDES) mesh(rig[`elbow${s}`], G.torus(0.32, PI * 2, 24, 8), cov, { p: [0, -0.02, 0], r: [PI / 2, 0, 0], s: 0.085 });
  const tool = prop(rig, c.v ? 'plunger' : 'wrench', rig.handR);
  up(tool, [-0.3, 0.86, -0.42]);
  c.bake(tool, (g) => {
    if (!c.v) {
      const steel = toon(C.metal, { gloss: true });
      mesh(g, G.rbox(0.075, 1.6, 0.035, 0.016, 3), steel, { p: [0, 0.48, 0] });
      mesh(g, G.rbox(0.03, 1.3, 0.004, 0.0015, 1), toon(shade(C.metal, -0.15)), { p: [0, 0.48, 0.019], outline: false });
      mesh(g, G.rbox(0.25, 0.15, 0.045, 0.02, 3), steel, { p: [0, 1.3, 0] });
      for (const s of SIDES) mesh(g, G.rbox(0.075, 0.17, 0.045, 0.016, 3), steel, { p: [X(s, 0.087), 1.43, 0] });
      mesh(g, G.torus(0.3, PI * 2, 40, 10), steel, { p: [0, -0.38, 0], s: 0.075 });
    } else {
      // Plunger instead of the wrench, also taller than itself.
      mesh(g, G.cyl(1, 16), wood(), { p: [0, 0.5, 0], s: [0.03, 1.7, 0.03] });
      mesh(g, G.lathe('plungerCup', [[0.03, 0], [0.09, 0.02], [0.15, 0.08], [0.17, 0.17], [0.155, 0.18]], 32), toon('#4a2f2f', { gloss: true, double: true }), { p: [0, 1.32, 0] });
    }
  });
  sweat(c, rig.head, [[0.2, 0.06, 0.1]]);
  return { neutral: { lid: 0.52, brow: [-0.05, 0.06], mouthW: 0.85, smile: 0.1 }, shadow: [0, 0.05, 0.5 * w, 0.45] };
}

// ---------- 9. The Star: flawless from the front, clamps behind ----------
const STAR: [number, number][] = [[0, -0.05], [0.2, -0.03], [0.3, 0.08], [0.33, 0.25], [0.31, 0.45], [0.25, 0.6], [0.15, 0.69], [0, 0.72]];
function star(c: Ctx): Result {
  const { rig, w } = c;
  const ply = toon('#c9a27a', { grain: true }), gold = '#ffcf40', gloss = flat('#ffffff');
  const shiny = toon(c.color, { gloss: true });
  legs(c, { spread: 0.1 * w, thigh: 0.27, shin: 0.26, r: 0.06, foot: [0.07, 0.045, 0.11], mat: shiny, hem: 0.54 });
  at(rig.torso, [0, 0.58, 0]);
  // Only the front half exists; the back is a flat plywood panel, like a film-set facade.
  mesh(rig.torso, G.lathe('starFront', STAR, 48, -PI / 2, PI), shiny, { s: [w, 1, 0.8] });
  mesh(rig.torso, G.panel('star', STAR), ply, { s: [w, 1, 1] });
  mesh(rig.torso, G.sphere(), gloss, { p: [-0.15 * w, 0.42, 0.22], r: [0, 0, -0.5], s: [0.07, 0.03, 0.012], outline: false });
  at(rig.neck, [0, 1.28, 0]);
  rig.neck.rotation.x = -0.16; // chin up
  at(rig.head, [0, 1.38, 0]);
  const hr: V3 = [0.24, 0.23, 0.22];
  mesh(rig.head, G.halfSphere(), shiny, { s: hr });
  mesh(rig.head, G.disc(), ply, { r: [0, PI, 0], s: [0.24, 0.23, 1] });
  mesh(rig.head, G.sphere(), gloss, { p: [-0.1, 0.12, 0.16], r: [0, 0, -0.7], s: [0.05, 0.022, 0.012], outline: false });
  mesh(rig.head, G.sphere(), gloss, { p: [-0.15, 0.065, 0.15], s: [0.014, 0.012, 0.01], outline: false });
  face(rig, { r: hr, eyeX: 0.085, eyeY: 0, eyeW: 0.045, eyeH: 0.055, mouthY: -0.1, mouthW: 0.08, skin: shiny, iris: c.iris });
  // Spotlight and sparkles (light effects: no outline, hidden in silhouette mode).
  const fx = prop(rig, 'spotlight', rig.root);
  mesh(fx, G.cyl(0.07, 40, true), glow('#fff3c4', 0.13), { p: [0, 1.4, 0.05], s: [0.62, 2.8, 0.62], fx: true });
  mesh(fx, G.disc(48), glow('#fff3c4', 0.35), { p: [0, 0.004, 0.05], r: [-PI / 2, 0, 0], s: 0.62, fx: true });
  for (const [x, y, z, k] of [[0.42, 1.62, 0.25, 1], [-0.38, 1.25, 0.3, 0.8], [0.3, 0.95, 0.35, 0.6], [-0.22, 1.72, 0.2, 0.7], [0.12, 1.85, 0.15, 0.5]]) {
    for (const s of [[0.012, 0.055, 0.012], [0.055, 0.012, 0.012]] as V3[]) mesh(fx, G.sphere(4, 2), flat(gold), { p: [x * w, y, z], s: s.map((v) => v * k) as V3, fx: true });
  }
  arm(c, 'R', [-0.29 * w, 1.12, 0.05], [-0.5 * w, 0.92, -0.02], [-0.31 * w, 0.82, 0.1], [0.058, 0.053, 0.058], { m1: shiny }); // hand on hip
  arm(c, 'L', [0.29 * w, 1.12, 0.05], [0.47 * w, 0.98, 0.18], [0.4 * w, 1.24, 0.32], [0.058, 0.053, 0.058], { m1: shiny });
  const held = prop(rig, c.v ? 'bouquet' : 'handMirror', rig.handL);
  aim(held, [0, -0.85, 0.12]);
  c.bake(held, (g) => {
    const g1 = toon(gold, { gloss: true });
    if (!c.v) {
      mesh(g, G.cyl(0.8, 16), g1, { p: [0, 0.08, 0], s: [0.018, 0.17, 0.018] });
      mesh(g, G.torus(0.13, PI * 2, 48, 10), g1, { p: [0, 0.27, 0], s: 0.105 });
      mesh(g, G.disc(), toon('#d6eef8', { gloss: true }), { p: [0, 0.27, 0.004], s: 0.1, outline: false });
      mesh(g, G.disc(), g1, { p: [0, 0.27, -0.004], r: [0, PI, 0], s: 0.1, outline: false });
      mesh(g, G.box(), gloss, { p: [0.03, 0.3, 0.006], r: [0, 0, -0.7], s: [0.012, 0.08, 0.002], outline: false });
    } else {
      // A bouquet instead of the mirror.
      mesh(g, G.cyl(3.4, 24), toon(C.paper), { p: [0, 0.1, 0], s: [0.035, 0.22, 0.035] });
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05;
        mesh(g, G.sphere(), toon(i % 2 ? gold : C.white), { p: [Math.sin(a) * 0.06, 0.24 + (i % 3) * 0.02, Math.cos(a) * 0.06], s: 0.045 });
      }
    }
  });
  // The back: grained scaffolding, a brace held down by a sandbag, clamps, gaffer tape, loose wires.
  c.bake(rig.torso, (g) => {
    const bat = toon('#a77f57', { grain: true }), metalM = metal();
    for (const s of SIDES) mesh(g, G.rbox(0.05, 1.0, 0.05, 0.008, 1), bat, { p: [X(s, 0.17 * w), 0.42, -0.045] });
    for (const [y, sw] of [[0.12, 0.54], [0.38, 0.56], [0.6, 0.4]]) mesh(g, G.rbox(sw * w, 0.045, 0.04, 0.008, 1), bat, { p: [0, y, -0.085] });
    mesh(g, G.rbox(0.045, 1.3, 0.045, 0.008, 1), bat, { p: [0, -0.04, -0.435], r: [0.594, 0, 0] });
    mesh(g, G.rbox(0.3, 0.13, 0.22, 0.05, 3), toon(C.canvas), { p: [0, -0.515, -0.8] });
    stitches(g, [[-0.15, -0.45, -0.69], [0.15, -0.45, -0.69]], shade(C.canvas, -0.35), 0.025);
    const clamp = (p: V3, rz: number) => {
      const o = piece(g, p, [0, 0, rz]);
      mesh(o, G.torus(0.25, PI * 1.35, 24, 8), metalM, { r: [0, PI / 2, PI * 0.33], s: 0.065 });
      mesh(o, G.cyl(1, 12), metalM, { p: [0, 0, -0.075], r: [PI / 2, 0, 0], s: [0.01, 0.07, 0.01] });
      mesh(o, G.rbox(0.07, 0.012, 0.012, 0.004, 1), metalM, { p: [0, 0, -0.11] });
    };
    clamp([0.31 * w, 0.3, -0.02], 0);
    clamp([-0.29 * w, 0.48, -0.02], PI);
    clamp([0, 0.8, -0.06], PI / 2);
    for (const [x, y, r] of [[0.08, 0.72, 0.1], [-0.12, 0.25, -0.4], [0.18, 0.55, 0.9], [-0.05, 0.58, 0.0]]) tape(g, [x * w, y, -0.008], [0, PI, r], 0.2, 0.05, C.gaffer);
  });
  tubeIn(c, rig.torso, [[0.06, 1.42, -0.05], [0.12, 1.12, -0.12], [0.08, 0.72, -0.2], [0.12, 0.25, -0.35], [0.15, 0.02, -0.55], [0.25, 0.02, -0.75]], 0.012, toon(C.black, { gloss: true }));
  tubeIn(c, rig.torso, [[-0.04, 1.4, -0.05], [-0.12, 1.0, -0.15], [-0.08, 0.6, -0.15], [-0.12, 0.2, -0.35], [-0.2, 0.02, -0.6]], 0.011, toon('#b8392e', { gloss: true }));
  sweat(c, rig.head, [[-0.19, 0.08, 0.1]]);
  return { neutral: { lid: 0.3, brow: [0.22, -0.08], smile: 0.42, mouthW: 0.78 }, shadow: [0, -0.1, 0.4 * w, 0.55] };
}

// ---------- 10. The Librarian: knows everything; nobody has asked in years ----------
function librarian(c: Ctx): Result {
  const { rig, w } = c;
  legs(c, { spread: 0.13 * w, thigh: 0.12, shin: 0.12, r: 0.045, foot: [0.065, 0.04, 0.1] });
  at(rig.torso, [0, 0.3, 0]);
  const tint = (dl: number) => toon(shade(c.color, dl, -0.05));
  const covers = [tint(-0.1), toon(c.color), tint(0.07)];
  const bands = ['#d6b04a', shade(c.color, -0.25), '#f0e6cf'];
  const book = (g: THREE.Group, p: V3, ry: number, W: number, t: number, D: number, i: number) => {
    const b = piece(g, p, [0, ry, 0]), ct = 0.018, cover = covers[i % 3];
    for (const y of [t / 2 - ct / 2, -t / 2 + ct / 2]) mesh(b, G.rbox(W, ct, D, 0.006, 2), cover, { p: [0, y, 0] });
    mesh(b, G.rbox(W, t, 0.03, 0.01, 3), cover, { p: [0, 0, D / 2 - 0.015] }); // spine faces you
    mesh(b, G.box(), pagesMat(), { p: [0, 0, -0.012], s: [W - 0.03, t - 2 * ct + 0.002, D - 0.03] });
    // Coloured bands and a blank label on the spine (no text).
    for (const x of [-0.38, 0.38]) mesh(b, G.box(), toon(bands[i % 3], { gloss: i % 3 === 0 }), { p: [x * W, 0, D / 2 + 0.0015], s: [0.018, t * 0.88, 0.004], outline: false });
    mesh(b, G.rbox(W * 0.16, t * 0.34, 0.004, 0.0015, 1), toon(shade(c.color, 0.18, -0.2)), { p: [W * 0.12, 0, D / 2 + 0.0015], outline: false });
  };
  // Stack height grows with lines (ModuleStats has no separate doc-line count).
  const n = 5 + Math.round(4 * c.size);
  let y = 0;
  c.bake(rig.torso, (g) => {
    for (let i = 0; i < n; i++) {
      const t = 0.15 + 0.045 * rnd(i);
      book(g, [(rnd(i + 5) - 0.5) * 0.08, y + t / 2, (rnd(i + 9) - 0.5) * 0.05], (rnd(i + 3) - 0.5) * 0.42, (0.58 + 0.22 * rnd(i + 11)) * w, t, 0.42 + 0.12 * rnd(i + 23), i);
      y += t;
    }
    for (const s of SIDES) mesh(g, G.puck(0.06, 0.02, 0.008), toon(C.woodDark), { p: [X(s, 0.13 * w), -0.008, 0] });
  });
  const top = 0.3 + y;
  at(rig.neck, [0, top, 0]);
  at(rig.head, [0, top + 0.15, 0.02]);
  rig.head.rotation.y = 0.05;
  const HW = 0.74 * w, HD = 0.52;
  c.bake(rig.head, (g) => book(g, [0, 0, 0], 0, HW, 0.3, HD, 2));
  face(rig, { flat: HD / 2 + 0.001, eyeX: 0.1, eyeY: 0.025, eyeW: 0.048, eyeH: 0.06, mouthY: -0.095, mouthW: 0.08, browY: -0.005, skin: covers[2], iris: c.iris });
  // Bookmarks sticking out of the top like hair.
  c.bake(prop(rig, 'bookmarks', rig.head), (g) => {
    for (let i = 0; i < 4; i++)
      mesh(g, G.rbox(0.035, 0.2, 0.004, 0.0015, 1), toon(i % 2 ? C.paper : '#c0392b'), { p: [-0.12 + i * 0.08, 0.23, -0.05 - (i % 2) * 0.08], r: [-0.25 - 0.1 * rnd(i), 0, (rnd(i + 2) - 0.5) * 0.6] });
  });
  const webAt = (g: THREE.Group, o: V3, r: number) => {
    const web = flat('#eef3f6');
    const spokes = [0.3, 1.1, 1.9, 2.6, 3.5];
    for (const a of spokes) mesh(g, G.box(), web, { p: [o[0] + Math.cos(a) * r * 0.5, o[1] + Math.sin(a) * r * 0.5, o[2]], r: [0, 0, a], s: [r, 0.004, 0.003], outline: false });
    for (const k of [0.45, 0.8])
      spokes.slice(0, -1).forEach((a, i) => {
        const b = spokes[i + 1], pa = [Math.cos(a) * r * k, Math.sin(a) * r * k], pb = [Math.cos(b) * r * k, Math.sin(b) * r * k];
        mesh(g, G.box(), web, { p: [o[0] + (pa[0] + pb[0]) / 2, o[1] + (pa[1] + pb[1]) / 2, o[2]], r: [0, 0, Math.atan2(pb[1] - pa[1], pb[0] - pa[0])], s: [Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), 0.003, 0.003], outline: false });
      });
  };
  if (!c.v) {
    // Reading glasses on a chain, with a cobweb strung to the stack.
    const dark = toon(C.metalDark, { gloss: true });
    c.bake(prop(rig, 'readingGlasses', rig.head), (g) => {
      for (const s of SIDES) {
        mesh(g, G.torus(0.12, PI, 32, 8), dark, { p: [X(s, 0.1), -0.025, 0.305], r: [0, 0, PI], s: 0.05, outline: true });
        mesh(g, G.rbox(0.105, 0.007, 0.007, 0.003, 1), dark, { p: [X(s, 0.1), -0.025, 0.305], outline: true });
        mesh(g, G.rbox(0.006, 0.006, 0.22, 0.002, 1), dark, { p: [X(s, 0.26), -0.02, 0.21], r: [0, X(s, -0.95), 0] });
      }
      mesh(g, G.rbox(0.06, 0.007, 0.007, 0.003, 1), dark, { p: [0, -0.02, 0.305], outline: true });
      webAt(g, [-0.27, -0.15, 0.29], 0.12);
    });
    tubeIn(c, rig.head, [[0.35 * w, top + 0.13, 0.15], [0.32 * w, top - 0.12, 0.3], [0, top - 0.25, 0.34], [-0.32 * w, top - 0.12, 0.3], [-0.35 * w, top + 0.13, 0.15]], 0.005, toon('#c9a54a', { gloss: true }), { outline: false, segs: 64, radial: 5 });
  } else {
    // A service bell nobody rings, instead of the glasses; the cobweb is on the bell.
    c.bake(prop(rig, 'serviceBell', rig.head), (g) => {
      const brass = toon('#c9b06b', { gloss: true });
      mesh(g, G.puck(0.09, 0.025, 0.008), wood(), { p: [0.2 * w, 0.163, 0.06] });
      mesh(g, G.lid(), brass, { p: [0.2 * w, 0.175, 0.06], s: [0.075, 0.065, 0.075] });
      mesh(g, G.cyl(1, 12), brass, { p: [0.2 * w, 0.25, 0.06], s: [0.008, 0.03, 0.008] });
      mesh(g, G.sphere(), brass, { p: [0.2 * w, 0.27, 0.06], s: 0.013 });
      webAt(g, [0.2 * w - 0.09, 0.2, 0.09], 0.1);
    });
  }
  // Nobody has visited: a small dust cloud at its feet.
  c.bake(prop(rig, 'dust', rig.root), (g) => {
    for (const [x, z, r] of [[-0.3, 0.12, 0.07], [-0.22, 0.25, 0.05], [0.28, 0.2, 0.065], [0.36, 0.05, 0.05], [0.05, 0.3, 0.045], [-0.38, -0.08, 0.055]])
      mesh(g, G.sphere(), toon('#dcd7cd'), { p: [x * w, r * 0.8, z], s: [r * 1.3, r, r] });
  });
  // No arms: the groups still exist, at the sides of the top of the stack.
  for (const s of SIDES) at(rig[`arm${s}`], [X(s, 0.36 * w), 0.3 + y * 0.8, 0]);
  sweat(c, rig.head, [[0.28 * w, 0.1, 0.27]]);
  return { neutral: { look: [0, 0.42], brow: [0.42, -0.35], lid: 1.0, smile: 0.22, mouthW: 0.72 }, shadow: [0, 0, 0.45 * w, 0.38] };
}

// ---------- 11. The Landlord: owns the building, fixes nothing, tired of every tenant ----------
const CARDIGAN: [number, number][] = [[0, -0.06], [0.24, -0.05], [0.33, 0.06], [0.35, 0.22], [0.33, 0.4], [0.27, 0.56], [0.18, 0.67], [0, 0.71]];
function landlord(c: Ctx): Result {
  const { rig, w } = c;
  const knitColor = '#c8b291', knit = toon(knitColor), rib = toon(shade(knitColor, -0.12)), slipper = '#8c3f52', fluff = toon('#efe6d6');
  legs(c, { spread: 0.1 * w, thigh: 0.22, shin: 0.21, r: 0.058, foot: [0.085, 0.045, 0.16], mat: toon('#7a6e64'), footMat: toon(slipper) });
  // Slippers: fluffy cuffs, a puff on the toe.
  for (const s of SIDES) {
    mesh(c.rig[`foot${s}`], G.torus(0.45, PI * 2, 24, 10), fluff, { p: [0, 0.03, 0.0], r: [PI / 2, 0, 0], s: [0.07, 0.065, 0.06] });
    mesh(c.rig[`foot${s}`], G.sphere(), fluff, { p: [0, 0.035, 0.1], s: [0.04, 0.03, 0.035] });
  }
  at(rig.torso, [0, 0.48, 0]);
  rig.torso.rotation.x = 0.24; // stooped
  mesh(rig.torso, G.lathe('cardigan', CARDIGAN, 48), knit, { s: [w, 1, 0.9] });
  const surf = onLathe(CARDIGAN, w, 0.9);
  // The cardigan is buttoned one hole off: the button line runs crooked and the hem hangs lower on one side.
  ring(rig.torso, [0, 0.03, 0], (profileR(CARDIGAN, 0.03) + 0.012) * w, (profileR(CARDIGAN, 0.03) + 0.012) * 0.9, rib, 0.1, [0, 0, 0.1]);
  c.bake(rig.torso, (g) => {
    const line = [0.6, 0.48, 0.36, 0.24, 0.12].map((y, i) => surf(0.05 - i * 0.045, y, 0.004));
    for (let i = 1; i < line.length; i++) {
      const a = new THREE.Vector3(...line[i - 1]), b = new THREE.Vector3(...line[i]);
      const o = new THREE.Group();
      o.position.copy(a).lerp(b, 0.5);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(o);
      mesh(o, G.box(), rib, { s: [0.035, a.distanceTo(b) + 0.01, 0.014], outline: false });
    }
    line.slice(1).forEach((p, i) => button(g, [p[0] + 0.03, p[1] + 0.045, p[2] + 0.006], 0.016, '#5a3d2a', 0.05 - i * 0.045));
    line.forEach((p) => mesh(piece(g, [p[0] - 0.035, p[1], p[2]], [0, 0.05, 0]), G.rbox(0.022, 0.006, 0.004, 0.002, 1), flat(shade(knitColor, -0.4)), { outline: false }));
    for (const s of SIDES) {
      const o = piece(g, surf(X(s, 0.6), s === 'L' ? 0.16 : 0.12, 0.012), [0, X(s, 0.6), 0]);
      mesh(o, G.rbox(0.13, 0.12, 0.016, 0.01, 2), toon(shade(knitColor, -0.05)));
      mesh(o, G.box(), rib, { p: [0, 0.055, 0.006], s: [0.13, 0.016, 0.01], outline: false });
    }
    for (const s of SIDES) mesh(piece(g, surf(X(s, 0.2), 0.64, 0.004), [0.7, X(s, 0.2), X(s, -0.55)]), G.rbox(0.08, 0.045, 0.014, 0.006, 2), toon('#f2efe6'));
  });
  at(rig.neck, [0, 1.13, 0.2]);
  ring(rig.neck, [0, 0.0, 0], 0.11, 0.1, rib, 0.35);
  at(rig.head, [0, 1.3, 0.28]);
  aim(rig.head, [0.12, 0.25, 0]); // looking away from the complaints
  const hr: V3 = [0.25, 0.24, 0.24];
  mesh(rig.head, G.sphere(32, 24), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.088, eyeY: -0.005, eyeW: 0.046, eyeH: 0.056, mouthY: -0.105, mouthW: 0.085, skin: c.body, iris: c.iris });
  // Reading glasses pushed up on its head.
  c.bake(prop(rig, 'readingGlasses', rig.head), (g) => {
    const frame = toon('#5a3d2a', { gloss: true });
    const o = piece(g, [0, 0.175, 0.165], [-0.5, 0, 0]);
    for (const s of SIDES) {
      mesh(o, G.torus(0.14, PI, 32, 8), frame, { p: [X(s, 0.085), 0, 0], r: [0, 0, PI], s: 0.064, outline: true });
      mesh(o, G.rbox(0.135, 0.011, 0.011, 0.004, 1), frame, { p: [X(s, 0.085), 0, 0], outline: true });
      mesh(o, G.disc(), toon('#dff1fb', { gloss: true, opacity: 0.55 }), { p: [X(s, 0.085), -0.03, -0.002], s: [0.062, 0.03, 1], outline: false, full: true });
    }
    mesh(o, G.rbox(0.05, 0.011, 0.011, 0.004, 1), frame, { outline: true });
    for (const s of SIDES) mesh(g, G.rbox(0.01, 0.01, 0.22, 0.004, 1), frame, { p: [X(s, 0.17), 0.16, 0.05], r: [0.3, X(s, 0.3), 0] });
  });
  // One arm out at full length holding the complaints away; the other carries the key ring.
  const cuff = rib;
  arm(c, 'R', [-0.3 * w, 1.04, 0.14], [-0.62 * w, 1.0, 0.34], [-0.95 * w, 0.98, 0.52], [0.06, 0.055, 0.06], { m1: knit, sleeve: null, cuff });
  arm(c, 'L', [0.3 * w, 1.04, 0.14], [0.38 * w, 0.78, 0.2], [0.36 * w, 0.58, 0.25], [0.06, 0.055, 0.06], { m1: knit, sleeve: null, cuff });
  const board = prop(rig, 'complaints', rig.handR);
  at(board, [-0.95 * w - 0.13, 1.06, 0.55]);
  aim(board, [0.05, 0.45, 0.06]);
  c.bake(board, (g) => {
    mesh(g, G.rbox(0.28, 0.36, 0.016, 0.012, 2), wood());
    for (let i = 0; i < 9; i++) sheet(g, [(rnd(i) - 0.5) * 0.03, -0.01 + (rnd(i + 2) - 0.5) * 0.02, 0.012 + i * 0.005], [0, 0, (rnd(i + 4) - 0.5) * 0.12], 0.24, 0.3, i === 8 ? 7 : 0);
    for (let i = 0; i < 3; i++) mesh(g, G.rbox(0.06, 0.06, 0.003, 0.002, 1), toon(['#f2d24a', '#f7a8b8', '#a8d8f0'][i]), { p: [0.1 - i * 0.03, 0.12 - i * 0.1, 0.06 + i * 0.002], r: [0, 0, 0.3 - i * 0.4], outline: false });
    mesh(g, G.rbox(0.1, 0.04, 0.03, 0.01, 2), metal(), { p: [0, 0.17, 0.05] });
  });
  // An enormous key ring: one key per module.
  const keys = prop(rig, 'keyRing', rig.handL);
  at(keys, [0.36 * w, 0.4, 0.27]);
  aim(keys, [0, 0.2, 0]);
  const N = Math.max(1, Math.min(16, c.keys));
  c.bake(keys, (g) => {
    mesh(g, G.torus(0.06, PI * 2, 64, 10), metal(), { s: 0.17 });
    mesh(g, G.rbox(0.05, 0.1, 0.03, 0.012, 2), toon('#5a3d2a', { gloss: true }), { p: [0, 0.2, 0] });
    for (let i = 0; i < N; i++) {
      const a = PI * (1.12 + (0.76 * (i + 0.5)) / N); // along the bottom of the ring, hanging under their own weight
      const dx = Math.cos(a) * 0.55, dy = Math.sin(a) * 0.55 - 1;
      const o = piece(g, [Math.cos(a) * 0.17, Math.sin(a) * 0.17, (i % 2) * 0.014 - 0.007], [0, 0, Math.atan2(dx, -dy)]);
      const m = toon(i % 3 === 1 ? C.metal : '#c9a54a', { gloss: true });
      mesh(o, G.torus(0.3, PI * 2, 20, 6), m, { p: [0, -0.035, 0], s: 0.03 });
      mesh(o, G.rbox(0.018, 0.12, 0.008, 0.003, 1), m, { p: [0, -0.12, 0] });
      for (let k = 0; k < 3; k++) mesh(o, G.box(), m, { p: [0.012, -0.13 - k * 0.018, 0], s: [0.012 + 0.008 * rnd(i * 3 + k), 0.01, 0.008], outline: false });
    }
  });
  sweat(c, rig.head, [[0.21, 0.07, 0.12]]);
  return { neutral: { lid: 0.36, brow: [-0.02, -0.12], browR: [0.14, -0.06], frown: 0.22, mouthW: 0.85, look: [0.12, 0] }, shadow: [-0.15, 0.1, 0.55 * w, 0.42] };
}

const BUILDERS: Record<Archetype, (c: Ctx) => Result> = { bouncer, accountant, clerk, doorman, hoarder, inspector, junkDrawer, plumber, star, librarian, landlord };

/** Merge sibling meshes that share a material (fewer draw calls); joints and toggled parts stay separate. */
function mergeSiblings(root: THREE.Object3D, keep: Set<THREE.Object3D>, owned: THREE.BufferGeometry[]) {
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => parents.push(o));
  for (const parent of parents) {
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const ch of parent.children) {
      if (!(ch instanceof THREE.Mesh) || ch.children.length || keep.has(ch) || ch.userData.fx || (ch.geometry as THREE.BufferGeometry).morphAttributes.position) continue;
      const key = `${(ch.material as THREE.Material).uuid}${wantsOutline(ch)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(ch);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        let g = (m.geometry as THREE.BufferGeometry).clone().applyMatrix4(m.matrix);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.index) g = mergeVertices(g);
        return g;
      });
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      owned.push(merged);
      mesh(parent, merged, list[0].material as THREE.Material, { outline: wantsOutline(list[0]) });
      list.forEach((m) => parent.remove(m));
    }
  }
}

// ---------- lite finishing: few draw calls, same rig ----------
const colourOf = (m: THREE.Material | THREE.Material[]) => ((m as THREE.MeshBasicMaterial).color ?? new THREE.Color('#ffffff')).clone();
/** Geometry baked by `matrix`, coloured per vertex, optionally bound rigidly (weight 1) to one bone. */
function coloured(src: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color, bone = -1) {
  let g = src.clone().applyMatrix4(matrix);
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  g.morphAttributes = {};
  if (!g.index) g = mergeVertices(g);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  // A mirrored part (negative scale, like the right eyebrow) reverses winding once baked: put it back.
  if (matrix.determinant() < 0) {
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  }
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (bone >= 0) {
    const idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      idx[i * 4] = bone;
      wt[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
  }
  return g;
}
/** Reverse winding and normals: the back side of an open or paper-thin part, as front faces. */
function flipped(g: THREE.BufferGeometry) {
  const f = g.clone(), idx = f.index!, n = f.getAttribute('normal');
  for (let i = 0; i < idx.count; i += 3) {
    const b = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, b);
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return f;
}
const within = (o: THREE.Object3D, set: Set<THREE.Object3D>) => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (set.has(p)) return true;
  return false;
};
/** Merge a group's direct mesh children into one unlit, vertex-coloured mesh (pupil shapes, mouth interior). */
function mergeUnlit(group: THREE.Object3D, owned: THREE.BufferGeometry[]) {
  const kids = group.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
  if (kids.length < 2) return;
  const merged = mergeGeometries(kids.map((m) => (m.updateMatrix(), coloured(m.geometry, m.matrix, colourOf(m.material)))));
  owned.push(merged);
  kids.forEach((m) => group.remove(m));
  mesh(group, merged, flatVertex(), { outline: false, keep: true });
}
/** Merge light-effect siblings that share a material (the Star's sparkles) into one mesh. */
function mergeFx(root: THREE.Object3D, owned: THREE.BufferGeometry[]) {
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.userData.fx) return;
    const key = `${o.parent!.uuid}${(o.material as THREE.Material).uuid}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const parent = list[0].parent!, material = list[0].material as THREE.Material;
    const merged = mergeGeometries(list.map((m) => (m.updateMatrix(), coloured(m.geometry, m.matrix, colourOf(m.material)))).map((g) => (g.deleteAttribute('color'), g)));
    owned.push(merged);
    list.forEach((m) => parent.remove(m));
    const o = mesh(parent, merged, material, { fx: true });
    o.raycast = () => {};
  }
}
/**
 * Lite: every remaining mesh becomes part of one vertex-coloured mesh rigidly skinned to the joint (or prop
 * group) it hung from, plus one skinned outline hull for the main silhouette parts. The joints stay the same
 * named groups, so moving them (animation, expressions) moves the parts exactly as in full detail.
 */
function skinLite(rig: CharacterRig, owned: THREE.BufferGeometry[], silhouette: boolean) {
  const boneList: THREE.Object3D[] = [...JOINTS.map((j) => rig[j] as THREE.Object3D), ...Object.values(rig.props)];
  const index = new Map(boneList.map((b, i) => [b, i]));
  const separate = new Set<THREE.Object3D>([rig.mouthLine, rig.mouthOpen, ...SIDES.flatMap((s) => Object.values(rig.pupils[s]))]);
  rig.root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  rig.root.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
  const body: THREE.BufferGeometry[] = [], lines: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    if (m.userData.fx || within(m, separate)) continue;
    let b: THREE.Object3D | null = m.parent;
    while (b && !index.has(b)) b = b.parent;
    const bone = index.get(b!) ?? 0, color = colourOf(m.material);
    const g = coloured(m.geometry, m.matrixWorld, silhouette ? new THREE.Color(0, 0, 0) : color, bone);
    body.push(g);
    // Single-sided body (half the raster work); open or paper-thin parts get their back side as real faces.
    if ((m.material as THREE.Material).side === THREE.DoubleSide) body.push(flipped(g));
    if (!silhouette && wantsOutline(m)) lines.push(coloured(hull(m.geometry), m.matrixWorld, outlineColor(color), bone));
    m.removeFromParent();
  }
  const skeleton = new THREE.Skeleton(boneList as unknown as THREE.Bone[], boneList.map((b) => b.matrixWorld.clone().invert()));
  const add = (geos: THREE.BufferGeometry[], material: THREE.Material, isHull: boolean) => {
    if (!geos.length) return;
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    owned.push(merged);
    const sm = new THREE.SkinnedMesh(merged, material);
    sm.bind(skeleton, new THREE.Matrix4());
    sm.frustumCulled = false; // parts can move past the bind-pose bounds once animated
    sm.userData.outline = false;
    sm.userData.isHull = isHull;
    if (isHull) sm.raycast = () => {};
    rig.root.add(sm);
  };
  add(body, silhouette ? flat('#000000') : toon('#ffffff', { vertex: true }), false);
  add(lines, outlineSkinned(), true);
}

export function buildCharacter(p: BuildParams): Built {
  const lite = p.detail === 'lite';
  setDetail(lite ? LITE : 1);
  try {
    return build(p, lite);
  } finally {
    setDetail(1);
  }
}

function build(p: BuildParams, lite: boolean): Built {
  const rig = createRig();
  const owned: THREE.BufferGeometry[] = [];
  const traits = faceTraits(p.stats);
  const c: Ctx = {
    rig, s: p.stats, v: p.variant, w: 1 + 0.4 * traits.width, size: sizeOf(p.stats.totalLines), color: p.color,
    body: toon(p.color), skin: toon(shade(p.color, -0.07)), trim: toon(shade(p.color, -0.13, -0.04)),
    iris: `#${new THREE.Color(INK).lerp(new THREE.Color(p.color), 0.35).getHexString()}`,
    sweaty: traits.sweaty, keys: p.keys ?? 7,
    bake: (parent, build, t) => bake(parent, owned, build, t),
    own: (g) => (owned.push(g), g),
  };
  const { neutral, shadow } = BUILDERS[p.archetype](c);
  if (!p.silhouette) mesh(rig.root, G.disc(), shadowMat(), { p: [shadow[0], 0.003, shadow[1]], r: [-PI / 2, 0, 0], s: [shadow[2] * 1.3, shadow[3] * 1.3, 1], fx: true });

  rig.root.updateMatrixWorld(true);
  if (lite) {
    const small: THREE.Mesh[] = [];
    rig.root.traverse((o) => o instanceof THREE.Mesh && dropInLite(o) && small.push(o));
    small.forEach((m) => m.removeFromParent());
    for (const s of SIDES) for (const kind of Object.values(rig.pupils[s])) mergeUnlit(kind, owned);
    mergeUnlit(rig.mouthOpen, owned);
    mergeFx(rig.root, owned);
    skinLite(rig, owned, !!p.silhouette);
  } else {
    const keep = new Set<THREE.Object3D>([rig.mouthLine, ...SIDES.flatMap((s) => Object.values(rig.pupils[s]))]);
    mergeSiblings(rig.root, keep, owned);
  }

  // Finish: outlines in a darkened version of each part's colour, or everything solid black for silhouette mode.
  const ownedSet = new Set(owned);
  const meshes: THREE.Mesh[] = [];
  rig.root.updateMatrixWorld(true);
  rig.root.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
  for (const m of meshes) {
    if (p.silhouette) {
      if (m.userData.fx) m.removeFromParent();
      else m.material = flat('#000000');
      continue;
    }
    if (m.userData.fx) m.raycast = () => {};
    if (!wantsOutline(m)) continue;
    const o = new THREE.Mesh(hull(m.geometry, ownedSet.has(m.geometry) ? owned : undefined), outlineFor(m.material as THREE.Material));
    o.userData.outline = true;
    o.userData.isHull = true;
    o.raycast = () => {};
    m.add(o);
  }
  snapshotRest(rig);
  applyExpression(rig, neutral, traits);
  const count: CastStats = { base: 0, outline: 0, calls: 0 };
  rig.root.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    count[o.userData.isHull ? 'outline' : 'base'] += tris(o.geometry);
    count.calls++;
  });
  return { root: rig.root, rig, neutral, tris: count, dispose: () => owned.forEach((g) => g.dispose()) };
}
