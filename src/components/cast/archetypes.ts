// The ten archetypes, built procedurally on the shared rig. Each builder poses joints, adds meshes,
// and returns its neutral (deadpan) face. Character space: feet on y = 0, facing +z, +x is its left.
import * as THREE from 'three';
import type { ModuleStats } from '@/lib/types';
import type { Archetype, Variant } from '@/lib/cast';
import { faceTraits, sizeOf } from '@/lib/characters';
import { C, G, INK, OUTLINE, bake, flat, glow, hull, mesh, receiptMat, ribbon, shadowMat, tinted, toon, tris, tube, type Part, type V3 } from './kit';
import { aim, applyExpression, at, bones, createRig, face, limb, prop, snapshotRest, up, type CharacterRig, type Face } from './rig';

export type BuildParams = { archetype: Archetype; variant: Variant; color: string; stats: ModuleStats; silhouette?: boolean };
export type Built = { root: THREE.Group; rig: CharacterRig; neutral: Face; tris: { base: number; outline: number }; dispose: () => void };

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
  sweaty: boolean;
  bake: (parent: THREE.Object3D, build: (g: THREE.Group) => void, t?: Part) => THREE.Group;
  own: <T extends THREE.BufferGeometry>(g: T) => T;
};
type Result = { neutral: Face; shadow: [x: number, z: number, sx: number, sz: number] };

// ---------- shared body parts ----------
function legs(c: Ctx, o: { spread: number; thigh: number; shin: number; r: number; foot: V3; knee?: number; mat?: THREE.Material; footMat?: THREE.Material }) {
  const kf = o.knee ?? 0, fy = o.foot[1];
  const tv = Math.sqrt(o.thigh ** 2 - kf ** 2), sv = Math.sqrt(o.shin ** 2 - kf ** 2);
  const hipY = fy + tv + sv;
  c.rig.hips.position.set(0, hipY, 0);
  for (const s of SIDES) {
    const x = X(s, o.spread);
    const chain = [c.rig[`leg${s}`], c.rig[`hip${s}`], c.rig[`knee${s}`], c.rig[`foot${s}`]];
    bones(chain, limb(chain, [x, hipY, 0], [x, hipY - tv, kf], [x, fy, 0]), o.r, o.r * 0.9, o.mat ?? c.body);
    aim(chain[3], [0, 0, 0]);
    mesh(chain[3], G.sphere(10, 6), o.footMat ?? c.body, { p: [0, 0, o.foot[2] * 0.35], s: o.foot });
  }
  return hipY;
}

/** Arm through shoulder S, elbow E, wrist H (character space); r = [upper, fore, hand] radii (hand 0 = none). */
function arm(c: Ctx, s: Side, S: V3, E: V3, H: V3, r: V3, m1 = c.body, m2 = m1, hm = c.body) {
  const chain = [c.rig[`arm${s}`], c.rig[`shoulder${s}`], c.rig[`elbow${s}`], c.rig[`hand${s}`]];
  const L = limb(chain, S, E, H);
  bones(chain, L, r[0], r[1], m1, m2);
  if (r[2]) mesh(chain[3], G.sphere(10, 7), hm, { s: [r[2], r[2] * 1.1, r[2] * 0.9] });
  return L;
}

/** Sweat drops (any file over 300 lines), in the parent's space. */
function sweat(c: Ctx, parent: THREE.Object3D, pts: V3[]) {
  if (!c.sweaty) return;
  for (const p of pts) {
    const g = new THREE.Group();
    g.position.set(...p);
    parent.add(g);
    mesh(g, G.sphere(10, 8), toon(C.water), { s: [0.022, 0.026, 0.018] });
    mesh(g, G.cyl(0, 10), toon(C.water), { p: [0, 0.03, 0], s: [0.0195, 0.04, 0.0155] });
  }
}

/** Tube through character-space points, stored in the parent's space so it moves with it. */
function tubeIn(c: Ctx, parent: THREE.Object3D, pts: V3[], r: number, m: THREE.Material, t: Part & { segs?: number; radial?: number } = {}) {
  parent.updateWorldMatrix(true, false);
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => parent.worldToLocal(new THREE.Vector3(...p))));
  return mesh(parent, c.own(new THREE.TubeGeometry(curve, t.segs ?? 40, r, t.radial ?? 6, false)), m, t);
}

/** A group with its own transform inside a bake, for props made of several parts. */
function piece(g: THREE.Object3D, p: V3, r: V3 = [0, 0, 0]) {
  const o = new THREE.Group();
  o.position.set(...p);
  o.rotation.set(r[0], r[1], r[2], 'YXZ');
  g.add(o);
  return o;
}

// ---------- 1. The Bouncer: guards everything, held up by almost nothing ----------
function bouncer(c: Ctx): Result {
  const { rig, w } = c;
  const black = toon(C.black);
  legs(c, { spread: 0.075, thigh: 0.2, shin: 0.19, r: 0.03, foot: [0.055, 0.035, 0.085] });
  mesh(rig.hips, G.sphere(14, 10), c.body, { p: [0, 0.03, 0], s: [0.15 * w, 0.1, 0.12] });
  at(rig.torso, [0, 0.47, 0]);
  // Barrel chest about 2.5x the hips, on stick legs.
  mesh(rig.torso, G.sphere(18, 13), c.body, { p: [0, 0.48, 0.02], s: [0.39 * w, 0.44, 0.33] });
  at(rig.neck, [0, 1.36, 0.08]);
  at(rig.head, [0, 1.49, 0.11]);
  const hr: V3 = [0.12, 0.13, 0.12];
  mesh(rig.head, G.sphere(16, 12), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.045, eyeY: 0.012, eyeW: 0.024, eyeH: 0.031, mouthY: -0.068, mouthW: 0.05, browLen: 0.036, browR: 0.011, skin: c.body });
  // Round sunglasses one size too small: the eyes show around the lenses.
  c.bake(prop(rig, 'sunglasses', rig.head), (g) => {
    for (const s of SIDES) {
      mesh(g, G.cyl(1, 16), black, { p: [X(s, 0.045), 0.014, 0.133], r: [PI / 2, 0, 0], s: [0.017, 0.008, 0.017] });
      mesh(g, G.box(), black, { p: [X(s, 0.09), 0.018, 0.066], r: [0, X(s, -0.4), 0], s: [0.006, 0.006, 0.144] });
    }
    mesh(g, G.box(), black, { p: [0, 0.018, 0.135], s: [0.058, 0.006, 0.006] });
  });
  const ear = prop(rig, 'earpiece', rig.head);
  mesh(ear, G.sphere(10, 8), black, { p: [-0.118, -0.005, 0.01], s: 0.016 });
  const a: V3 = [-0.112, -0.03, -0.01], b: V3 = [-0.07, -0.16, -0.05];
  mesh(ear, c.own(tube((t) => { const p = lerp3(a, b, t); return [p[0] + 0.008 * Math.cos(t * 44), p[1], p[2] + 0.008 * Math.sin(t * 44)]; }, 0.0035, 70, 3)), black, { outline: false });
  // Arms permanently crossed.
  arm(c, 'L', [0.37 * w, 1.24, 0], [0.43 * w, 0.98, 0.24], [-0.16 * w, 1.07, 0.41], [0.1, 0.09, 0.085]);
  arm(c, 'R', [-0.37 * w, 1.24, 0], [-0.43 * w, 1.01, 0.27], [0.19 * w, 1.13, 0.48], [0.1, 0.09, 0.085]);
  const hand: V3 = [0.19 * w, 1.13, 0.48];
  if (!c.v) {
    // A tiny clipboard pinched between two fingers.
    const clip = prop(rig, 'clipboard', rig.handR);
    at(clip, [hand[0] + 0.08, hand[1] + 0.08, hand[2] + 0.04]);
    aim(clip, [-0.1, 0.25, -0.35]);
    c.bake(clip, (g) => {
      mesh(g, G.box(), toon(C.wood), { s: [0.085, 0.115, 0.008] });
      mesh(g, G.box(), toon(C.paper), { p: [0, -0.008, 0.006], s: [0.07, 0.085, 0.003] });
      mesh(g, G.box(), toon(C.metal), { p: [0, 0.052, 0.008], s: [0.04, 0.016, 0.01] });
      for (const z of [-0.016, 0.016]) mesh(g, G.capsule(0.014, 0.04, 2, 6), c.body, { p: [-0.045, -0.045, z], r: [0, 0, 0.9] });
    });
  } else {
    // Velvet-rope post instead of the clipboard; it holds the rope end in the same two fingers.
    const post = prop(rig, 'ropePost', rig.root);
    const base: V3 = [0.66 * w, 0, 0.3];
    c.bake(post, (g) => {
      mesh(g, G.cyl(1, 18), toon(C.metal), { p: [base[0], 0.015, base[2]], s: [0.11, 0.03, 0.11] });
      mesh(g, G.cyl(1, 10), toon(C.metal), { p: [base[0], 0.39, base[2]], s: [0.022, 0.75, 0.022] });
      mesh(g, G.sphere(12, 8), toon(C.metal), { p: [base[0], 0.79, base[2]], s: 0.045 });
    });
    const top: V3 = [base[0] - 0.03, 0.78, base[2]], end: V3 = [hand[0] + 0.05, hand[1] - 0.02, hand[2] + 0.03];
    tubeIn(c, post, [top, lerp3(lerp3(top, end, 0.35), [0, 0.42, 0.45], 0.5), lerp3(lerp3(top, end, 0.7), [0, 0.55, 0.5], 0.4), end], 0.018, toon('#a3243b'));
  }
  sweat(c, rig.head, [[0.1, 0.06, 0.05], [0.085, 0.0, 0.08]]);
  return { neutral: { browL: [0.05, 0.02], browR: [-0.4, 0.38], lid: 0.55, frown: 0.25, mouthW: 0.9 }, shadow: [0, 0.03, 0.42 * w, 0.32] };
}

// ---------- 2. The Accountant: counts everything twice and still isn't sure ----------
function accountant(c: Ctx): Result {
  const { rig, w } = c;
  const green = '#3fae68', dark = toon(C.metalDark);
  legs(c, { spread: 0.12 * w, thigh: 0.14, shin: 0.13, r: 0.06, foot: [0.075, 0.045, 0.11] });
  at(rig.torso, [0, 0.33, 0]);
  rig.torso.rotation.x = 0.24; // hunched over the numbers
  mesh(rig.torso, G.lathe('pear', [[0, -0.05], [0.2, -0.03], [0.33, 0.07], [0.38, 0.21], [0.37, 0.35], [0.31, 0.5], [0.23, 0.65], [0.16, 0.78], [0.1, 0.86], [0, 0.9]], 22), c.body, { s: [w, 1, 0.85] });
  at(rig.neck, [0, 1.13, 0.2]);
  at(rig.head, [0, 1.3, 0.27]);
  aim(rig.head, [0.06, 0, 0]);
  const hr: V3 = [0.27, 0.27, 0.25];
  mesh(rig.head, G.sphere(18, 12), c.body, { s: hr });
  // Huge round glasses magnify its eyes to about twice the size.
  face(rig, { r: hr, eyeX: 0.11, eyeY: -0.01, eyeW: 0.075, eyeH: 0.092, mouthY: -0.155, mouthW: 0.07, browY: 0.012, skin: c.body });
  const glasses = prop(rig, 'glasses', rig.head);
  c.bake(glasses, (g) => {
    for (const s of SIDES) {
      mesh(g, G.torus(0.11, PI * 2, 22, 4), dark, { p: [X(s, 0.11), -0.01, 0.29], s: 0.1 });
      mesh(g, G.box(), dark, { p: [X(s, 0.24), 0, 0.14], r: [0, X(s, -0.21), 0], s: [0.012, 0.012, 0.286] });
    }
    mesh(g, G.box(), dark, { p: [0, 0.01, 0.294], s: [0.03, 0.012, 0.012] });
  });
  for (const s of SIDES) mesh(glasses, G.disc(24), glow('#e3f4ff', 0.2), { p: [X(s, 0.11), -0.01, 0.293], s: 0.098, fx: true });
  // Green translucent visor.
  const visor = prop(rig, 'visor', rig.head);
  mesh(visor, G.torus(0.08, PI * 2, 24, 4), toon(green), { p: [0, 0.2, 0], r: [PI / 2, 0, 0], s: [0.186, 0.173, 0.2] });
  mesh(visor, G.halfDisc(), tinted(green, 0.62), { p: [0, 0.205, 0.02], r: [0.12, 0, 0], s: [0.34, 0.012, 0.37] });
  // Arms up at the wrist calculator; sleeve garters.
  const E: Record<Side, V3> = { L: [0.29 * w, 0.8, 0.24], R: [-0.29 * w, 0.8, 0.22] };
  const H: Record<Side, V3> = { L: [0.07, 0.86, 0.47], R: [-0.04, 0.87, 0.5] };
  for (const s of SIDES) {
    const L = arm(c, s, [X(s, 0.2 * w), 1.04, 0.14], E[s], H[s], [0.058, 0.052, 0.055]);
    mesh(rig[`shoulder${s}`], G.torus(0.25), toon(C.black), { p: [0, -L[0] * 0.5, 0], r: [PI / 2, 0, 0], s: 0.064 });
  }
  const gadget = prop(rig, c.v ? 'abacus' : 'calculator', rig.elbowL);
  const yaw = Math.atan2(H.L[0] - E.L[0], H.L[2] - E.L[2]);
  at(gadget, [...lerp3(E.L, H.L, 0.74)].map((v, i) => v + (i === 1 ? 0.065 : 0)) as V3);
  aim(gadget, [-0.25, yaw, 0]);
  c.bake(gadget, (g) => {
    mesh(g, G.box(), toon(C.black), { p: [0, -0.04, 0], s: [0.075, 0.03, 0.03], outline: false }); // strap
    if (!c.v) {
      mesh(g, G.rbox(0.1, 0.025, 0.13, 0.008), toon('#454a50'));
      mesh(g, G.box(), toon('#b9c9a7'), { p: [0, 0.014, 0.04], s: [0.08, 0.006, 0.035], outline: false });
      for (let i = 0; i < 9; i++) mesh(g, G.box(), toon(C.paper), { p: [((i % 3) - 1) * 0.026, 0.014, -0.01 - Math.floor(i / 3) * 0.022], s: [0.016, 0.006, 0.014], outline: false });
    } else {
      // Abacus strapped to the wrist instead of the calculator.
      for (const z of [-0.065, 0.065]) mesh(g, G.box(), toon(C.wood), { p: [0, 0, z], s: [0.18, 0.02, 0.02] });
      for (const x of [-0.085, 0.085]) mesh(g, G.box(), toon(C.wood), { p: [x, 0, 0], s: [0.02, 0.02, 0.15] });
      for (const z of [-0.032, 0, 0.032]) {
        mesh(g, G.cyl(1, 6), toon(C.metal), { p: [0, 0, z], r: [0, 0, PI / 2], s: [0.004, 0.17, 0.004], outline: false });
        for (let i = 0; i < 4; i++) mesh(g, G.sphere(6, 4), toon(i % 2 ? '#b8433a' : C.woodDark), { p: [-0.06 + i * 0.025 + (z > 0 ? 0.03 : 0), 0, z], s: [0.011, 0.013, 0.013], outline: false });
      }
    }
  });
  // A receipt roll spills from its pocket and trails along the floor; longer with more lines.
  const roll = prop(rig, 'receiptRoll', rig.torso);
  at(roll, [-0.31 * w, 0.52, 0.2]);
  mesh(roll, G.cyl(1, 14), toon(C.paper), { r: [0, 0, PI / 2], s: [0.045, 0.09, 0.045] });
  const len = 0.6 + 2.6 * c.size;
  const hang = new THREE.CatmullRomCurve3([[-0.31 * w, 0.48, 0.24], [-0.37 * w, 0.3, 0.27], [-0.41 * w, 0.1, 0.22], [-0.42 * w, 0.006, 0.12]].map((p) => new THREE.Vector3(...(p as V3))));
  const pts = hang.getPoints(10);
  for (let d = 0.04; d <= len; d += 0.04) {
    const a = d * 9, r = 0.07 * (1 - d / (len + 0.4));
    pts.push(new THREE.Vector3(-0.42 * w - 0.14 * d - 0.12 * Math.sin(d * 2.2), 0.006 + r * (1 - Math.cos(a)), 0.12 - 0.55 * d - r * Math.sin(a)));
  }
  mesh(prop(rig, 'receipt', rig.root), c.own(ribbon(pts, 0.1)), receiptMat());
  sweat(c, rig.head, [[0.21, 0.08, 0.08], [0.2, 0.0, 0.12]]);
  return { neutral: { brow: [0.18, -0.22], lid: 0.9, mouthW: 0.62, frown: 0.12, look: [0, -0.04] }, shadow: [0, 0.1, 0.45 * w, 0.42] };
}

// ---------- 3. The Clerk: processes requests all day; one hand is a rubber stamp ----------
function clerk(c: Ctx): Result {
  const { rig, w } = c;
  const tie = '#8e2d3a';
  legs(c, { spread: 0.1 * w, thigh: 0.31, shin: 0.3, r: 0.045, foot: [0.06, 0.04, 0.1] });
  at(rig.torso, [0, 0.65, 0]);
  rig.torso.rotation.x = 0.07;
  mesh(rig.torso, G.rbox(0.42 * w, 0.64, 0.27, 0.08, 2), c.body, { p: [0, 0.3, 0] });
  at(rig.neck, [0, 1.25, 0.03]);
  aim(rig.neck, [0.16, 0, 0]);
  mesh(rig.neck, G.capsule(0.055, 0.06, 2, 8), c.body, { p: [0, 0.04, 0] });
  at(rig.head, [0, 1.45, 0.06]);
  aim(rig.head, [0.04, 0, 0]);
  mesh(rig.head, G.rbox(0.34, 0.3, 0.28, 0.09, 2), c.body);
  face(rig, { flat: 0.14, eyeX: 0.075, eyeY: 0.02, eyeW: 0.042, eyeH: 0.05, mouthY: -0.085, mouthW: 0.08, skin: c.body });
  for (const s of SIDES) mesh(rig.head, G.torus(0.22, PI, 16), toon('#8c8494'), { p: [X(s, 0.075), -0.036, 0.142], r: [0, 0, PI], s: [0.04, 0.02, 0.03], outline: false });
  // A tie that is far too short.
  c.bake(rig.torso, (g) => {
    for (const s of SIDES) mesh(g, G.box(), toon(C.white), { p: [X(s, 0.035), 0.6, 0.137], r: [0, 0, X(s, -0.5)], s: [0.07, 0.035, 0.01] });
    mesh(g, G.box(), toon(tie), { p: [0, 0.585, 0.143], s: [0.045, 0.04, 0.02] });
    mesh(g, G.box(), toon(tie), { p: [0, 0.52, 0.14], s: [0.05, 0.09, 0.012] });
    mesh(g, G.box(), toon(tie), { p: [0, 0.476, 0.14], r: [0, 0, PI / 4], s: [0.035, 0.035, 0.012] });
  });
  arm(c, 'L', [0.235 * w, 1.17, 0.02], [0.27 * w, 0.9, 0.06], [0.26 * w, 0.64, 0.1], [0.045, 0.042, 0.05]);
  arm(c, 'R', [-0.235 * w, 1.17, 0.02], [-0.28 * w, 0.9, 0.07], [-0.28 * w, 0.63, 0.12], [0.045, 0.042, 0]);
  const stamp = prop(rig, 'stamp', rig.handR);
  aim(stamp, [0, 0, 0]);
  c.bake(stamp, (g) => {
    mesh(g, G.sphere(14, 10), toon(C.wood), { s: 0.055 });
    mesh(g, G.cyl(0.8, 12), toon(C.wood), { p: [0, -0.08, 0], s: [0.03, 0.11, 0.03] });
    mesh(g, G.rbox(0.24, 0.08, 0.16, 0.015), toon(C.woodDark), { p: [0, -0.17, 0] });
    mesh(g, G.box(), toon(C.black), { p: [0, -0.222, 0], s: [0.22, 0.025, 0.14] });
  });
  // The paperwork on its head grows with the file count.
  const n = Math.min(24, Math.max(2, c.s.fileCount * 2));
  if (!c.v) {
    c.bake(prop(rig, 'inTray', rig.head), (g) => {
      mesh(g, G.box(), toon(C.metal), { p: [0, 0.158, 0], s: [0.38, 0.012, 0.29] });
      for (const z of [-0.14, 0.14]) mesh(g, G.box(), toon(C.metal), { p: [0, 0.19, z], s: [0.38, 0.065, 0.012] });
      for (const x of [-0.185, 0.185]) mesh(g, G.box(), toon(C.metal), { p: [x, 0.19, 0], s: [0.012, 0.065, 0.29] });
      for (const k of [0, 1]) mesh(g, G.box(), toon(C.paper), { p: [k ? 0.08 : -0.1, 0.2 + n * 0.0105, k ? -0.02 : 0.03], r: [0.2, k ? 0.4 : -0.3, k ? -0.35 : 0.3], s: [0.2, 0.008, 0.15] });
      for (let i = 0; i < n; i++) mesh(g, G.box(), toon(i % 3 ? C.paper : C.white), { p: [(rnd(i) - 0.5) * 0.03, 0.172 + i * 0.0105, (rnd(i + 7) - 0.5) * 0.025], r: [0, (rnd(i + 3) - 0.5) * 0.3, 0], s: [0.27, 0.008, 0.2] });
    });
  } else {
    // Take-a-number dispenser instead of the in-tray; the ticket strip grows with the file count.
    const disp = prop(rig, 'ticketDispenser', rig.head);
    disp.rotation.set(0, 0.25, -0.08);
    mesh(disp, G.rbox(0.3, 0.13, 0.2, 0.02), toon(C.metal), { p: [0, 0.215, 0] });
    mesh(disp, G.box(), toon(tie), { p: [0, 0.215, 0.101], s: [0.12, 0.05, 0.006], outline: false });
    mesh(disp, G.box(), toon(C.black), { p: [0.151, 0.2, 0], s: [0.006, 0.012, 0.08] });
    const drop = 0.1 + 0.025 * n;
    const pts = [new THREE.Vector3(0.15, 0.2, 0), new THREE.Vector3(0.2, 0.19, 0.01), new THREE.Vector3(0.23, 0.12, 0.02)];
    for (let d = 0.04; d <= drop; d += 0.04) pts.push(new THREE.Vector3(0.235 + 0.01 * Math.sin(d * 8), 0.12 - d, 0.02 + 0.02 * Math.sin(d * 5)));
    mesh(disp, c.own(ribbon(pts, 0.065)), receiptMat());
  }
  sweat(c, rig.head, [[0.16, 0.07, 0.12]]);
  return { neutral: { lid: 0.32, brow: [-0.15, 0.02], pupil: 0.8, frown: 0.15, mouthW: 0.9 }, shadow: [0, 0.03, 0.3 * w, 0.25] };
}

// ---------- 4. The Doorman: extremely important about timing, extremely small ----------
function doorman(c: Ctx): Result {
  const { rig, w } = c;
  const coat = toon('#26262c'), white = toon(C.white), gold = '#d6a531';
  legs(c, { spread: 0.065, thigh: 0.1, shin: 0.1, r: 0.036, foot: [0.05, 0.034, 0.085], footMat: toon(C.black) });
  at(rig.torso, [0, 0.24, 0]);
  mesh(rig.torso, G.lathe('tailcoat', [[0, -0.03], [0.14, -0.01], [0.21, 0.09], [0.225, 0.21], [0.2, 0.33], [0.14, 0.41], [0, 0.44]], 20), coat, { s: [w, 1, 0.9] });
  c.bake(rig.torso, (g) => {
    mesh(g, G.sphere(14, 10), white, { p: [0, 0.27, 0.125], s: [0.085, 0.12, 0.07] });
    for (const s of SIDES) mesh(g, G.cyl(0, 8), toon(C.black), { p: [X(s, 0.03), 0.37, 0.165], r: [0, 0, X(s, PI / 2)], s: [0.025, 0.05, 0.02] });
    // Tailcoat tails dragging on the floor.
    for (const s of SIDES) {
      mesh(g, G.rbox(0.1, 0.34, 0.03, 0.012), coat, { p: [X(s, 0.065), -0.05, -0.215], r: [0.15, 0, X(s, -0.06)] });
      mesh(g, G.rbox(0.1, 0.03, 0.36, 0.012), coat, { p: [X(s, 0.075), -0.225, -0.42], r: [0, X(s, -0.1), 0] });
    }
  });
  at(rig.neck, [0, 0.66, 0.02]);
  rig.neck.rotation.x = -0.28; // chin raised, looking down its nose at you
  at(rig.head, [0, 0.82, 0.03]);
  const hr: V3 = [0.19, 0.18, 0.18];
  mesh(rig.head, G.sphere(16, 12), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.068, eyeY: 0, eyeW: 0.037, eyeH: 0.046, mouthY: -0.085, mouthW: 0.065, skin: c.body });
  // A top hat taller than the rest of it.
  const hat = prop(rig, 'topHat', rig.head);
  hat.position.set(0, 0.15, -0.01);
  hat.rotation.set(0.16, 0, 0.05); // stays nearly upright while the chin goes up
  c.bake(hat, (g) => {
    mesh(g, G.cyl(1, 24), toon(C.black), { p: [0, 0.0125, 0], s: [0.27, 0.025, 0.27] });
    mesh(g, G.cyl(1.05, 24), toon(C.black), { p: [0, 0.545, 0], s: [0.155, 1.04, 0.155] });
    mesh(g, G.cyl(1, 24), toon('#55555d'), { p: [0, 0.08, 0], s: [0.159, 0.07, 0.159] });
  });
  // White gloves; one hand holds the timepiece up mid-check, the other is behind its back.
  arm(c, 'R', [-0.19 * w, 0.58, 0], [-0.3 * w, 0.48, 0.1], [-0.36, 0.62, 0.17], [0.04, 0.037, 0.052], coat, coat, white);
  arm(c, 'L', [0.19 * w, 0.58, 0], [0.25 * w, 0.42, -0.08], [0.1, 0.36, -0.2], [0.04, 0.037, 0.052], coat, coat, white);
  const piecePos: V3 = [-0.4, 0.86, 0.19];
  const timer = prop(rig, c.v ? 'hourglass' : 'pocketWatch', rig.handR);
  at(timer, piecePos);
  aim(timer, [0, 0.3, 0]);
  if (!c.v) {
    // Pocket watch bigger than its head, on a chain to the waistcoat.
    const hand = (a: number, len: number, z: number): Part => ({ p: [Math.sin(a) * len * 0.45, Math.cos(a) * len * 0.45, z], r: [0, 0, -a], s: [0.012, len, 0.004], outline: false });
    c.bake(timer, (g) => {
      mesh(g, G.cyl(1, 32), toon(gold), { r: [PI / 2, 0, 0], s: [0.23, 0.055, 0.23] });
      mesh(g, G.cyl(1, 32), toon(C.paper), { p: [0, 0, 0.03], r: [PI / 2, 0, 0], s: [0.195, 0.012, 0.195], outline: false });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * PI * 2;
        mesh(g, G.box(), flat(INK), { p: [Math.sin(a) * 0.165, Math.cos(a) * 0.165, 0.037], r: [0, 0, -a], s: [0.008, i % 3 ? 0.018 : 0.03, 0.004], outline: false });
      }
      mesh(g, G.box(), flat(INK), hand(0.65, 0.15, 0.04));
      mesh(g, G.box(), flat(INK), hand(4.3, 0.1, 0.042));
      mesh(g, G.cyl(1, 12), toon(gold), { p: [0, 0.255, 0], s: [0.03, 0.05, 0.03] });
      mesh(g, G.torus(0.22), toon(gold), { p: [0, 0.3, 0], s: 0.04 });
    });
    tubeIn(c, rig.torso, [[-0.33, 0.6, 0.2], [-0.2, 0.42, 0.24], [-0.05, 0.4, 0.23], [0.06, 0.46, 0.19]], 0.008, toon(gold), { outline: false, segs: 24, radial: 4 });
  } else {
    // Hourglass instead of the watch, still bigger than its head.
    c.bake(timer, (g) => {
      const glass = tinted('#e9f6ff', 0.45);
      mesh(g, G.cyl(0.12, 20), glass, { p: [0, -0.11, 0], s: [0.13, 0.2, 0.13] });
      mesh(g, G.cyl(0.12, 20), glass, { p: [0, 0.11, 0], r: [PI, 0, 0], s: [0.13, 0.2, 0.13] });
      mesh(g, G.cyl(0.3, 16), toon('#e3c58c'), { p: [0, -0.17, 0], s: [0.11, 0.08, 0.11], outline: false });
      mesh(g, G.cyl(0, 12), toon('#e3c58c'), { p: [0, 0.045, 0], r: [PI, 0, 0], s: [0.05, 0.05, 0.05], outline: false });
      for (const y of [-0.225, 0.225]) mesh(g, G.cyl(1, 20), toon(C.wood), { p: [0, y, 0], s: [0.16, 0.03, 0.16] });
      for (let i = 0; i < 3; i++) mesh(g, G.cyl(1, 8), toon(C.woodDark), { p: [Math.sin(i * 2.1) * 0.14, 0, Math.cos(i * 2.1) * 0.14], s: [0.012, 0.42, 0.012] });
    });
  }
  sweat(c, rig.head, [[0.16, 0.06, 0.07]]);
  return { neutral: { browL: [0.4, -0.1], browR: [0.05, 0.1], lid: 0.42, look: [0, -0.4], frown: 0.35, mouthW: 0.8 }, shadow: [0, -0.1, 0.3, 0.42] };
}

// ---------- 5. The Hoarder: kept everything, just in case ----------
function hoarder(c: Ctx): Result {
  const { rig, w } = c;
  const strapM = toon('#7a6646');
  legs(c, { spread: 0.1 * w, thigh: 0.21, shin: 0.2, r: 0.055, knee: 0.08, foot: [0.07, 0.045, 0.11] }); // knees buckled
  at(rig.torso, [0, 0.43, 0]);
  rig.torso.rotation.x = 0.2;
  mesh(rig.torso, G.capsule(0.24, 0.3, 4, 14), c.body, { p: [0, 0.3, 0], s: [w, 1, 0.9] });
  at(rig.neck, [0, 1.06, 0.16]);
  at(rig.head, [0, 1.24, 0.22]);
  aim(rig.head, [0, 0, 0]);
  const hr: V3 = [0.23, 0.22, 0.22];
  mesh(rig.head, G.sphere(18, 12), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.08, eyeY: 0, eyeW: 0.044, eyeH: 0.054, mouthY: -0.095, mouthW: 0.08, skin: c.body });
  // Load 3-4x its body, growing with total lines; item count too.
  const bs = 0.95 + 0.4 * c.size;
  const Wp = 1.15 * bs, Hp = 1.35 * bs, Dp = 0.78 * bs;
  const pack = prop(rig, c.v ? 'boxTower' : 'backpack', rig.torso);
  at(pack, [0, 0.35 + Hp / 2, -0.25 - Dp / 2]);
  aim(pack, [0.1, 0, 0]);
  let top = Hp / 2;
  c.bake(pack, (g) => {
    if (!c.v) {
      mesh(g, G.rbox(Wp, Hp, Dp, 0.22 * bs, 2), toon(C.canvas));
      mesh(g, G.rbox(Wp * 0.9, 0.24 * bs, Dp * 0.92, 0.1 * bs), toon('#a58c66'), { p: [0, Hp * 0.47, 0.03], r: [0.08, 0, 0] });
      for (const s of SIDES) mesh(g, G.rbox(0.26 * bs, 0.46 * bs, Dp * 0.6, 0.09 * bs), toon('#a58c66'), { p: [X(s, Wp * 0.52), -Hp * 0.12, 0] });
      mesh(g, G.cyl(1, 18), toon('#7f8f6a'), { p: [0, Hp * 0.6, -0.08], r: [0, 0, PI / 2], s: [0.15 * bs, Wp * 0.95, 0.15 * bs] });
      for (const s of SIDES) mesh(g, G.box(), strapM, { p: [X(s, 0.25 * bs), 0, -Dp / 2 - 0.01], s: [0.07, Hp * 0.8, 0.02] });
      top = Hp * 0.6 + 0.12;
    } else {
      // A tower of taped cardboard boxes instead of the backpack.
      const k = 3 + Math.round(3 * c.size);
      let y = -Hp / 2;
      for (let i = 0; i < k; i++) {
        const bw = Wp * (0.78 + 0.2 * rnd(i)), bh = Hp * (0.38 + 0.12 * rnd(i + 4)), bd = Dp * (0.85 + 0.15 * rnd(i + 8));
        const b = piece(g, [(rnd(i + 2) - 0.5) * 0.12, y + bh / 2, (rnd(i + 6) - 0.5) * 0.08], [0, (rnd(i + 1) - 0.5) * 0.25, 0]);
        mesh(b, G.rbox(bw, bh, bd, 0.02), toon('#c69c6d'));
        mesh(b, G.box(), toon('#d9cfb8'), { p: [0, bh / 2 + 0.002, 0], s: [0.12, 0.006, bd + 0.01], outline: false });
        y += bh;
      }
      top = y;
    }
    const items: ((p: THREE.Group) => void)[] = [
      (p) => { // traffic cone
        const o = piece(p, [-0.3 * bs, top + 0.18, 0.02], [0.15, 0, 0.35]);
        mesh(o, G.cyl(0.12, 16), toon('#ff7a1a'), { s: [0.12, 0.42, 0.12] });
        mesh(o, G.cyl(0.6, 16), toon(C.white), { p: [0, 0.03, 0], s: [0.09, 0.07, 0.09], outline: false });
        mesh(o, G.box(), toon('#ff7a1a'), { p: [0, -0.21, 0], s: [0.28, 0.03, 0.28] });
      },
      (p) => { // lamp
        const o = piece(p, [0.32 * bs, top + 0.05, -0.05], [-0.15, 0, -0.25]);
        mesh(o, G.cyl(1, 8), toon(C.metal), { p: [0, 0.25, 0], s: [0.015, 0.5, 0.015] });
        mesh(o, G.cyl(0.55, 18), toon(C.paper), { p: [0, 0.55, 0], s: [0.16, 0.18, 0.16] });
      },
      (p) => { // chair leg
        const o = piece(p, [Wp / 2 + 0.1, Hp * 0.2, 0.05], [0, 0, -1.05]);
        mesh(o, G.cyl(0.8, 10), toon(C.wood), { s: [0.035, 0.7, 0.035] });
        mesh(o, G.cyl(1, 10), toon(C.woodDark), { p: [0, 0.36, 0], s: [0.03, 0.04, 0.03] });
      },
      (p) => { // stacked boxes
        mesh(piece(p, [0, top + 0.13, -0.12], [0, 0.2, 0]), G.rbox(0.36, 0.26, 0.3, 0.02), toon('#c69c6d'));
        mesh(piece(p, [0.03, top + 0.36, -0.12], [0, -0.15, 0]), G.rbox(0.28, 0.2, 0.24, 0.02), toon('#b98e5e'));
      },
      (p) => { // rubber duck, on top of the boxes
        const o = piece(p, [0.02, top + 0.51, -0.1], [0, 0.4, 0]);
        mesh(o, G.sphere(10, 7), toon('#f4c430'), { s: [0.1, 0.075, 0.085] });
        mesh(o, G.sphere(10, 7), toon('#f4c430'), { p: [0, 0.08, 0.05], s: 0.055 });
        mesh(o, G.box(), toon('#ff7a1a'), { p: [0, 0.075, 0.108], s: [0.04, 0.015, 0.03] });
      },
      (p) => { // coiled hose
        const o = piece(p, [-(Wp / 2 + 0.07), Hp * 0.02, 0.05], [0, PI / 2, 0]);
        for (let i = 0; i < 3; i++) mesh(o, G.torus(0.2, PI * 2, 14, 4), toon('#4b5560'), { p: [0.01 * i, -0.05 * i, 0.03 * i - 0.03], s: 0.14 });
      },
      (p) => { // umbrella handle
        const o = piece(p, [-0.08, top + 0.15, 0.22], [0.2, 0, 0.1]);
        mesh(o, G.cyl(1, 8), toon(C.black), { s: [0.018, 0.4, 0.018] });
        mesh(o, G.torus(0.25, PI, 12), toon(C.black), { p: [0.06, 0.2, 0], s: 0.06 });
      },
      (p) => { // frying pan
        const o = piece(p, [Wp / 2 + 0.03, -Hp * 0.25, 0.1], [0, PI / 2, 0.3]);
        mesh(o, G.cyl(1, 20), toon(C.metalDark), { r: [PI / 2, 0, 0], s: [0.15, 0.025, 0.15] });
        mesh(o, G.box(), toon(C.black), { p: [0, -0.24, 0], s: [0.035, 0.2, 0.02] });
      },
    ];
    const count = Math.min(items.length, 3 + Math.round(5 * c.size));
    items.slice(0, count).forEach((f) => f(g));
  });
  // Shoulder straps, and a loose one across its forehead it peeks out from under.
  for (const s of SIDES) tubeIn(c, rig.torso, [[X(s, 0.17 * w), 1.25, -0.24], [X(s, 0.21 * w), 1.07, 0.12], [X(s, 0.2 * w), 0.84, 0.3], [X(s, 0.12 * w), 0.6, 0.27]], 0.035, strapM, { segs: 20, radial: 5 });
  tubeIn(c, rig.torso, [[0.24, 1.7, -0.28], [0.15, 1.5, 0.2], [0.02, 1.43, 0.37], [-0.17, 1.42, 0.31], [-0.27, 1.32, 0.12]], 0.028, strapM, { segs: 24, radial: 5 });
  for (const s of SIDES) arm(c, s, [X(s, 0.24 * w), 0.98, 0.1], [X(s, 0.34 * w), 0.78, 0.22], [X(s, 0.16 * w), 0.86, 0.33], [0.06, 0.055, 0.06]);
  sweat(c, rig.head, [[0.19, 0.08, 0.1]]);
  return { neutral: { lid: 0.5, brow: [0.12, -0.06], smile: 0.6, mouthW: 0.85 }, shadow: [0, -0.3, 0.75 * bs, 0.75] };
}

// ---------- 6. The Inspector: gets far too close to everything ----------
function inspector(c: Ctx): Result {
  const { rig, w } = c;
  const lime = '#d4ef3c';
  legs(c, { spread: 0.1 * w, thigh: 0.17, shin: 0.16, r: 0.055, foot: [0.072, 0.048, 0.11], footMat: toon('#3a2c22') });
  at(rig.torso, [0, 0.38, 0]);
  rig.torso.rotation.x = 0.14;
  mesh(rig.torso, G.capsule(0.26, 0.22, 4, 14), c.body, { p: [0, 0.27, 0], s: [w, 1, 0.9] });
  // Hi-vis vest with reflective stripes.
  mesh(rig.torso, G.lathe('vest', [[0.272, 0.0], [0.287, 0.14], [0.287, 0.34], [0.264, 0.48], [0.2, 0.58]], 22), toon(lime), { s: [w, 1, 0.9] });
  for (const y of [0.17, 0.32]) mesh(rig.torso, G.torus(0.08, PI * 2, 24, 4), toon('#eceeee'), { p: [0, y, 0], r: [PI / 2, 0, 0], s: [0.292 * w, 0.262, 0.2] });
  // Long neck already craned forward: the head sits well ahead of the body.
  const B: V3 = [0, 0.95, 0.12], Hc: V3 = [-0.27, 1.33, 0.46];
  at(rig.neck, B);
  up(rig.neck, [Hc[0] - B[0], Hc[1] - B[1], Hc[2] - B[2]]);
  const nl = Math.hypot(Hc[0] - B[0], Hc[1] - B[1], Hc[2] - B[2]) - 0.1;
  mesh(rig.neck, G.capsule(0.06, nl, 3, 10), c.body, { p: [0, nl / 2, 0] });
  at(rig.head, Hc);
  aim(rig.head, [-0.05, 0.28, 0.16]);
  const hr: V3 = [0.21, 0.2, 0.2];
  mesh(rig.head, G.sphere(18, 12), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.075, eyeY: 0, eyeW: 0.042, eyeH: 0.052, mouthY: -0.088, mouthW: 0.065, skin: c.body });
  c.bake(prop(rig, 'hardHat', rig.head), (g) => {
    mesh(g, G.lid(), toon('#f6f4ee'), { p: [0, 0.07, 0], s: [0.222, 0.17, 0.232] });
    mesh(g, G.cyl(1, 24), toon('#f6f4ee'), { p: [0, 0.075, 0.035], s: [0.27, 0.02, 0.3] });
    mesh(g, G.box(), toon('#e2ded2'), { p: [0, 0.235, 0], s: [0.04, 0.03, 0.3] });
  });
  arm(c, 'R', [-0.25 * w, 0.84, 0.08], [-0.35 * w, 0.66, 0.34], [-0.06, 0.76, 0.62], [0.052, 0.048, 0.055]);
  arm(c, 'L', [0.25 * w, 0.84, 0.08], [0.33 * w, 0.62, 0.22], [0.2, 0.62, 0.4], [0.052, 0.048, 0.055]);
  const tool = prop(rig, c.v ? 'tapeMeasure' : 'magnifier', rig.handR);
  aim(tool, [0, 0, 0]);
  c.bake(tool, (g) => {
    if (!c.v) {
      mesh(g, G.cyl(1, 10), toon(C.wood), { p: [0, 0.06, 0], s: [0.022, 0.13, 0.022] });
      mesh(g, G.torus(0.14, PI * 2, 22, 4), toon(C.metal), { p: [0, 0.22, 0.02], s: 0.11 });
      mesh(g, G.disc(24), glow('#dff2ff', 0.3), { p: [0, 0.22, 0.02], s: 0.1, fx: true });
    } else {
      // Tape measure, already extended at you.
      const o = piece(g, [0, 0.04, 0.02], [0.1, 1.05, 0]);
      mesh(o, G.rbox(0.12, 0.12, 0.05, 0.02), toon('#f2c41b'), { r: [0, PI / 2, 0] });
      mesh(o, G.box(), toon('#f5d84c'), { p: [0, -0.03, 0.4], s: [0.028, 0.004, 0.72] });
      mesh(o, G.box(), toon(C.metal), { p: [0, -0.02, 0.765], s: [0.032, 0.025, 0.006] });
    }
  });
  const board = prop(rig, 'clipboard', rig.handL);
  at(board, [0.2, 0.7, 0.43]);
  aim(board, [-0.4, -0.3, 0]);
  c.bake(board, (g) => {
    mesh(g, G.box(), toon(C.wood), { s: [0.2, 0.27, 0.012] });
    mesh(g, G.box(), toon(C.paper), { p: [0, -0.01, 0.008], s: [0.17, 0.22, 0.004] });
    mesh(g, G.box(), toon(C.metal), { p: [0, 0.125, 0.012], s: [0.07, 0.03, 0.02] });
  });
  sweat(c, rig.head, [[0.17, 0.08, 0.09]]);
  return { neutral: { browL: [-0.32, 0.42], browR: [0.12, 0.3], lidL: 0.28, lidR: 1.02, pupil: 0.72, mouthW: 0.7, frown: 0.2 }, shadow: [0, 0.12, 0.38 * w, 0.42] };
}

// ---------- 7. The Junk Drawer: everything nobody knew where to put ----------
function junkDrawer(c: Ctx): Result {
  const { rig, w } = c;
  const W = 1.0 * w, H = 0.8, D = 0.62, t = 0.05;
  legs(c, { spread: 0.3 * w, thigh: 0.16, shin: 0.15, r: 0.045, foot: [0.06, 0.04, 0.09] });
  at(rig.torso, [0, 0.37, 0]);
  c.bake(rig.torso, (g) => {
    mesh(g, G.box(), c.body, { p: [0, H - t / 2, 0], s: [W, t, D] });
    mesh(g, G.box(), c.body, { p: [0, H + 0.015, 0.01], s: [W + 0.06, 0.03, D + 0.04] });
    mesh(g, G.box(), c.body, { p: [0, t / 2, 0], s: [W, t, D] });
    for (const s of SIDES) mesh(g, G.box(), c.body, { p: [X(s, W / 2 - t / 2), H / 2, 0], s: [t, H, D] });
    mesh(g, G.box(), toon(C.woodDark), { p: [0, H / 2, -D / 2 + 0.015], s: [W - 2 * t, H - 2 * t, 0.03] });
  });
  // The drawer is the head: half open, its front is the face.
  const Wd = W - 2 * t - 0.01, Hd = 0.52, Dd = D - 0.05, pull = 0.42 * Dd;
  at(rig.neck, [0, 0.37 + t + Hd / 2 + 0.005, D / 2]);
  rig.head.position.set(0, 0, pull + 0.025);
  c.bake(rig.head, (g) => {
    mesh(g, G.rbox(Wd + 0.02, Hd + 0.03, 0.05, 0.012, 2), c.body);
    mesh(g, G.box(), toon(C.wood), { p: [0, -Hd / 2 + 0.01, -Dd / 2], s: [Wd - 0.02, 0.02, Dd] });
    for (const s of SIDES) mesh(g, G.box(), toon(C.wood), { p: [X(s, Wd / 2 - 0.02), -Hd * 0.12, -Dd / 2], s: [0.02, Hd * 0.76, Dd] });
    mesh(g, G.box(), toon(C.wood), { p: [0, -Hd * 0.12, -Dd + 0.01], s: [Wd - 0.02, Hd * 0.76, 0.02] });
  });
  face(rig, { flat: 0.026, eyeX: 0.15, eyeY: 0.075, eyeW: 0.052, eyeH: 0.062, mouthY: -0.165, mouthW: 0.1, skin: c.body });
  // Knob nose, and the handle under it like a moustache.
  c.bake(prop(rig, c.v ? 'bowHandle' : 'barHandle', rig.head), (g) => {
    mesh(g, G.sphere(12, 10), toon(C.wood), { p: [0, 0, 0.05], s: [0.035, 0.032, 0.03] });
    if (!c.v) {
      mesh(g, G.cyl(1, 12), toon(C.metal), { p: [0, -0.075, 0.075], r: [0, 0, PI / 2], s: [0.016, 0.27, 0.016] });
      for (const s of SIDES) mesh(g, G.cyl(1, 8), toon(C.metal), { p: [X(s, 0.11), -0.075, 0.05], r: [PI / 2, 0, 0], s: [0.012, 0.05, 0.012] });
    } else mesh(g, G.torus(0.13, PI, 20), toon(C.metal), { p: [0, -0.115, 0.05], s: [0.14, 0.07, 0.14] });
  });
  // Items spilling out of the open drawer; one per file, up to 7.
  const fl = -Hd / 2 + 0.02;
  const ink = toon(C.black);
  const main: ((g: THREE.Group) => void)[] = [
    (g) => mesh(piece(g, [0.2 * w, 0.32, -0.12], [0.2, 0, -0.32]), G.cyl(0.7, 8), toon(C.wood), { s: [0.012, 0.8, 0.012] }), // a single chopstick
    (g) => { // tangled cables, over the edge and down the front
      const pts: V3[] = [[0.02, fl + 0.05, -0.17], [0.05, 0.42, -0.16], [-0.04, 0.62, -0.14], [-0.15, 0.56, -0.1], [-0.2, 0.36, -0.06], [-0.3, 0.29, 0.01], [-0.36, 0.17, 0.05], [-0.33, 0.03, 0.065], [-0.4, -0.12, 0.06], [-0.37, -0.25, 0.07]];
      g.add(new THREE.Mesh(c.own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 36, 0.012, 4, false)), ink));
      mesh(g, G.box(), toon(C.black), { p: [-0.37, -0.28, 0.07], s: [0.04, 0.05, 0.025] });
    },
    (g) => { // folded takeaway menu
      for (const s of SIDES) {
        const o = piece(g, [X(s, 0.05) - 0.06, 0.32, -0.14], [0, 0, X(s, -0.42)]);
        mesh(o, G.box(), toon(C.paper), { s: [0.004, 0.24, 0.17] });
        mesh(o, G.box(), toon('#d9473a'), { p: [X(s, 0.003), 0.07, 0], s: [0.003, 0.05, 0.172], outline: false });
      }
    },
    (g) => { // rubber-band ball
      const o = piece(g, [0.07, 0.3, -0.16]);
      mesh(o, G.sphere(12, 8), toon('#e5533c'), { s: 0.075 });
      for (let i = 0; i < 3; i++) mesh(o, G.torus(0.08, PI * 2, 16, 3), toon('#b83a28'), { r: [i * 1.1, i * 0.7, 0], s: 0.077, outline: false });
    },
    (g) => { // batteries
      for (let i = 0; i < 2; i++) {
        const o = piece(g, [0.3 * w + i * 0.05, 0.28, -0.16 + i * 0.05], [0.2, 0, -0.3 + i * 0.5]);
        mesh(o, G.cyl(1, 12), ink, { s: [0.022, 0.1, 0.022] });
        mesh(o, G.cyl(1, 8), toon(C.metal), { p: [0, 0.055, 0], s: [0.01, 0.012, 0.01], outline: false });
      }
    },
    (g) => { // a mystery key
      const o = piece(g, [-0.27 * w, 0.45, -0.16], [0, 0.3, 0.25]);
      mesh(o, G.torus(0.25, PI * 2, 16), toon(C.metal), { p: [0, 0.06, 0], s: 0.035 });
      mesh(o, G.box(), toon(C.metal), { p: [0, -0.06, 0], s: [0.014, 0.18, 0.006] });
      mesh(o, G.box(), toon(C.metal), { p: [0.012, -0.05, 0], s: [0.016, 0.012, 0.006] });
    },
    (g) => { // a dead pen
      const o = piece(g, [-0.12, 0.42, -0.08], [0.3, 0, 0.5]);
      mesh(o, G.cyl(1, 10), toon('#ececec'), { s: [0.013, 0.2, 0.013] });
      mesh(o, G.cyl(1, 10), ink, { p: [0, 0.08, 0], s: [0.015, 0.05, 0.015] });
    },
  ];
  const utensils: ((g: THREE.Group) => void)[] = [
    (g) => { // spatula
      const o = piece(g, [0.2 * w, 0.3, -0.12], [0.15, 0, -0.3]);
      mesh(o, G.cyl(1, 8), toon(C.wood), { s: [0.016, 0.55, 0.016] });
      mesh(o, G.rbox(0.12, 0.16, 0.012, 0.004), toon(C.wood), { p: [0, 0.34, 0] });
    },
    (g) => { // whisk
      const o = piece(g, [-0.15, 0.34, -0.15], [0.1, 0, 0.3]);
      mesh(o, G.cyl(1, 8), toon(C.metal), { s: [0.015, 0.3, 0.015] });
      for (let i = 0; i < 3; i++) mesh(o, G.torus(0.06, PI * 2, 20), toon(C.metal), { p: [0, 0.27, 0], r: [0, (i * PI) / 3, 0], s: [0.055, 0.11, 0.055], outline: false });
    },
    (g) => { // ladle
      const o = piece(g, [0.02, 0.27, -0.18], [-0.2, 0, 0.1]);
      mesh(o, G.cyl(1, 8), toon(C.metal), { s: [0.012, 0.5, 0.012] });
      mesh(o, G.lid(), toon(C.metal), { p: [0, -0.25, 0.02], r: [PI, 0, 0], s: 0.07 });
    },
    (g) => mesh(piece(g, [0.32 * w, 0.29, -0.15], [PI / 2, 0, 0.3]), G.torus(0.35, PI * 2, 20), toon('#e8dfcc'), { s: 0.06 }), // tape roll
    (g) => { // birthday candles
      for (let i = 0; i < 2; i++) mesh(piece(g, [-0.3 * w + i * 0.05, 0.3, -0.15], [0, 0, 0.2 - i * 0.4]), G.cyl(1, 8), toon(i ? '#7fb6e8' : '#f29bb5'), { s: [0.008, 0.11, 0.008] });
    },
    main[1],
    main[6],
  ];
  const n = Math.min(7, Math.max(2, c.s.fileCount));
  c.bake(prop(rig, 'drawerItems', rig.head), (g) => (c.v ? utensils : main).slice(0, n).forEach((f) => f(g)));
  for (const s of SIDES) arm(c, s, [X(s, W / 2 + 0.02), 0.37 + H * 0.55, 0.05], [X(s, W / 2 + 0.13), 0.37 + H * 0.4, 0.1], [X(s, W / 2 + 0.14), 0.37 + H * 0.2, 0.17], [0.035, 0.032, 0.045]);
  sweat(c, rig.head, [[0.33, 0.24, 0.05]]);
  return { neutral: { look: [-0.45, -0.32], brow: [0.25, -0.32], lid: 0.72, frown: 0.32, mouthW: 0.8 }, shadow: [0, 0.05, 0.62 * w, 0.5] };
}

// ---------- 8. The Plumber: everything flows through it, held together with tape ----------
const BOILER: [number, number][] = [[0, -0.07], [0.22, -0.05], [0.35, 0.06], [0.41, 0.22], [0.41, 0.4], [0.35, 0.57], [0.25, 0.7], [0.12, 0.77], [0, 0.79]];
const profileR = (prof: [number, number][], y: number) => {
  for (let i = 1; i < prof.length; i++)
    if (y <= prof[i][1]) return prof[i - 1][0] + ((prof[i][0] - prof[i - 1][0]) * (y - prof[i - 1][1])) / (prof[i][1] - prof[i - 1][1]);
  return 0;
};
function plumber(c: Ctx): Result {
  const { rig, w } = c;
  const cov = toon('#6f86a0'), beanie = '#d6a12b', pipeM = toon(C.metal), tapeM = toon(C.tape);
  legs(c, { spread: 0.13 * w, thigh: 0.2, shin: 0.2, r: 0.075, foot: [0.085, 0.055, 0.13], mat: cov, footMat: toon('#4a3426') });
  at(rig.torso, [0, 0.46, 0]);
  mesh(rig.torso, G.lathe('boiler', BOILER, 22), cov, { s: [w, 1, 0.88] });
  at(rig.neck, [0, 1.2, 0]);
  at(rig.head, [0, 1.37, 0.02]);
  const hr: V3 = [0.24, 0.23, 0.23];
  mesh(rig.head, G.sphere(18, 12), c.body, { s: hr });
  face(rig, { r: hr, eyeX: 0.085, eyeY: -0.01, eyeW: 0.045, eyeH: 0.055, mouthY: -0.105, mouthW: 0.09, skin: c.body });
  // A beanie: no cap, no moustache.
  c.bake(prop(rig, 'beanie', rig.head), (g) => {
    mesh(g, G.lid(), toon(beanie), { p: [0, 0.07, -0.01], s: [0.25, 0.2, 0.245] });
    mesh(g, G.torus(0.2, PI * 2, 24, 4), toon(beanie), { p: [0, 0.08, -0.01], r: [PI / 2, 0, 0], s: [0.24, 0.235, 0.3] });
  });
  const surf = (a: number, y: number, out = 0.008): V3 => {
    const r = profileR(BOILER, y) + out;
    return [Math.sin(a) * r * w, y, Math.cos(a) * r * 0.88];
  };
  // Tool belt with pouches; a chest pocket.
  c.bake(rig.torso, (g) => {
    mesh(g, G.torus(0.12, PI * 2, 24, 4), toon('#6a4a30'), { p: [0, 0.2, 0], r: [PI / 2, 0, 0], s: [0.418 * w, 0.418 * 0.88, 0.25] });
    for (const s of SIDES) {
      const a = X(s, 0.62);
      mesh(piece(g, surf(a, 0.13, 0.03), [0, a, 0]), G.rbox(0.12, 0.13, 0.07, 0.02), toon('#7d5a3c'));
    }
    mesh(piece(g, surf(-0.62, 0.22, 0.05), [0, 0, 0.2]), G.cyl(1, 8), toon(C.wood), { s: [0.016, 0.22, 0.016] });
    mesh(piece(g, surf(0.35, 0.52, 0.0), [-0.5, 0.35, 0]), G.box(), toon('#5d7189'), { s: [0.11, 0.1, 0.012] });
  });
  // Pipe coiled around its body, ending in a slow leak.
  const coil = (t: number): V3 => surf(t * PI * 2.4 - 0.9, 0.62 - 0.52 * t, 0.055);
  const pipe: V3[] = [];
  for (let i = 0; i <= 40; i++) pipe.push(coil(i / 40));
  const end = pipe[pipe.length - 1];
  pipe.push([end[0] + 0.05, end[1] - 0.01, end[2] + 0.1], [end[0] + 0.08, end[1] - 0.08, end[2] + 0.13]);
  const pipeGroup = prop(rig, 'pipe', rig.torso);
  const curve = new THREE.CatmullRomCurve3(pipe.map((p) => new THREE.Vector3(...p)));
  mesh(pipeGroup, c.own(new THREE.TubeGeometry(curve, 48, 0.045, 5, false)), pipeM);
  // Duct tape: always one on the pipe, plus one patch per TODO (up to 6) on coveralls and pipe.
  const patches = 1 + Math.min(6, c.s.todoCount);
  c.bake(pipeGroup, (g) => {
    for (let i = 0; i < patches; i++) {
      if (i % 2 === 0) {
        const u = 0.12 + (0.76 * i) / Math.max(1, patches - 1); // stays on the pipe however many TODOs
        const o = piece(g, curve.getPointAt(u).toArray() as V3);
        o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(u));
        mesh(o, G.cyl(1, 10), tapeM, { s: [0.054, 0.07, 0.054] });
      } else {
        const spots: [number, number][] = [[0.45, 0.48], [-0.5, 0.32], [0.9, 0.62], [-1.0, 0.1]];
        const [a, y] = spots[(i >> 1) % spots.length];
        const o = piece(g, surf(a, y, 0.012), [0, a, 0]);
        for (const r of [0.6, -0.6]) mesh(o, G.box(), tapeM, { r: [0, 0, r], s: [0.13, 0.035, 0.006] });
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
    mesh(g, G.cyl(1.28, 16), toon(C.metal), { p: [0, 0.075, 0], s: [0.085, 0.15, 0.085] });
    mesh(g, G.disc(16), toon(C.water), { p: [0, 0.152, 0], r: [-PI / 2, 0, 0], s: 0.1, outline: false });
    mesh(g, G.torus(0.25, PI, 16), toon(C.metalDark), { p: [0, 0.15, 0], s: 0.105, outline: false });
    for (let i = 0; i < 3; i++) {
      const y = 0.2 + (tipW.y - 0.25) * ((i + 0.5) / 3);
      mesh(g, G.sphere(8, 6), toon(C.water), { p: [-0.02, y, -0.04], s: [0.014, 0.019, 0.014] });
    }
  });
  // Rolled sleeves; a wrench taller than itself on its shoulder.
  const Hr: V3 = [-0.42 * w, 1.0, 0.3];
  arm(c, 'R', [-0.37 * w, 1.07, 0], [-0.53 * w, 0.88, 0.12], Hr, [0.075, 0.068, 0.072], cov);
  arm(c, 'L', [0.37 * w, 1.07, 0], [0.55 * w, 0.85, -0.04], [0.42 * w, 0.72, 0.16], [0.075, 0.068, 0.072], cov);
  for (const s of SIDES) mesh(rig[`elbow${s}`], G.torus(0.3, PI * 2, 12, 4), cov, { p: [0, -0.02, 0], r: [PI / 2, 0, 0], s: 0.085 });
  const tool = prop(rig, c.v ? 'plunger' : 'wrench', rig.handR);
  up(tool, [-0.3, 0.86, -0.42]);
  c.bake(tool, (g) => {
    if (!c.v) {
      mesh(g, G.rbox(0.075, 1.6, 0.035, 0.015), toon(C.metal), { p: [0, 0.48, 0] });
      mesh(g, G.rbox(0.25, 0.15, 0.045, 0.02), toon(C.metal), { p: [0, 1.3, 0] });
      for (const s of SIDES) mesh(g, G.rbox(0.075, 0.17, 0.045, 0.015), toon(C.metal), { p: [X(s, 0.087), 1.43, 0] });
      mesh(g, G.torus(0.3), toon(C.metal), { p: [0, -0.38, 0], s: 0.075 });
    } else {
      // Plunger instead of the wrench, also taller than itself.
      mesh(g, G.cyl(1, 10), toon(C.wood), { p: [0, 0.5, 0], s: [0.03, 1.7, 0.03] });
      mesh(g, G.lathe('plungerCup', [[0.03, 0], [0.09, 0.02], [0.15, 0.08], [0.17, 0.17], [0.155, 0.18]], 18), toon('#4a2f2f'), { p: [0, 1.32, 0] });
    }
  });
  sweat(c, rig.head, [[0.2, 0.06, 0.1]]);
  return { neutral: { lid: 0.52, brow: [-0.05, 0.06], mouthW: 0.85, smile: 0.1 }, shadow: [0, 0.05, 0.5 * w, 0.45] };
}

// ---------- 9. The Star: flawless from the front, clamps behind ----------
const STAR: [number, number][] = [[0, -0.05], [0.2, -0.03], [0.3, 0.08], [0.33, 0.25], [0.31, 0.45], [0.25, 0.6], [0.15, 0.69], [0, 0.72]];
function star(c: Ctx): Result {
  const { rig, w } = c;
  const ply = toon('#c9a27a'), gold = '#ffcf40', gloss = flat('#ffffff');
  legs(c, { spread: 0.1 * w, thigh: 0.27, shin: 0.26, r: 0.06, foot: [0.07, 0.045, 0.11] });
  at(rig.torso, [0, 0.58, 0]);
  // Only the front half exists; the back is a flat plywood panel, like a film-set facade.
  mesh(rig.torso, G.lathe('starFront', STAR, 20, -PI / 2, PI), c.body, { s: [w, 1, 0.8] });
  mesh(rig.torso, G.panel('star', STAR), ply, { s: [w, 1, 1] });
  mesh(rig.torso, G.sphere(10, 8), gloss, { p: [-0.15 * w, 0.42, 0.22], r: [0, 0, -0.5], s: [0.07, 0.03, 0.012], outline: false });
  at(rig.neck, [0, 1.28, 0]);
  rig.neck.rotation.x = -0.16; // chin up
  at(rig.head, [0, 1.38, 0]);
  const hr: V3 = [0.24, 0.23, 0.22];
  mesh(rig.head, G.halfSphere(), c.body, { s: hr });
  mesh(rig.head, G.disc(24), ply, { r: [0, PI, 0], s: [0.24, 0.23, 1] });
  mesh(rig.head, G.sphere(10, 8), gloss, { p: [-0.1, 0.12, 0.16], r: [0, 0, -0.7], s: [0.05, 0.022, 0.012], outline: false });
  mesh(rig.head, G.sphere(10, 8), gloss, { p: [-0.15, 0.065, 0.15], s: [0.014, 0.012, 0.01], outline: false });
  face(rig, { r: hr, eyeX: 0.085, eyeY: 0, eyeW: 0.045, eyeH: 0.055, mouthY: -0.1, mouthW: 0.08, skin: c.body });
  // Spotlight and sparkles (light effects: no outline, hidden in silhouette mode).
  const fx = prop(rig, 'spotlight', rig.root);
  mesh(fx, G.cyl(0.07, 24, true), glow('#fff3c4', 0.13), { p: [0, 1.4, 0.05], s: [0.62, 2.8, 0.62], fx: true });
  mesh(fx, G.disc(28), glow('#fff3c4', 0.35), { p: [0, 0.004, 0.05], r: [-PI / 2, 0, 0], s: 0.62, fx: true });
  for (const [x, y, z, k] of [[0.42, 1.62, 0.25, 1], [-0.38, 1.25, 0.3, 0.8], [0.3, 0.95, 0.35, 0.6], [-0.22, 1.72, 0.2, 0.7], [0.12, 1.85, 0.15, 0.5]]) {
    for (const s of [[0.012, 0.055, 0.012], [0.055, 0.012, 0.012]] as V3[]) mesh(fx, G.sphere(4, 2), flat(gold), { p: [x * w, y, z], s: s.map((v) => v * k) as V3, fx: true });
  }
  arm(c, 'R', [-0.29 * w, 1.12, 0.05], [-0.5 * w, 0.92, -0.02], [-0.31 * w, 0.82, 0.1], [0.058, 0.053, 0.058]); // hand on hip
  arm(c, 'L', [0.29 * w, 1.12, 0.05], [0.47 * w, 0.98, 0.18], [0.4 * w, 1.24, 0.32], [0.058, 0.053, 0.058]);
  const held = prop(rig, c.v ? 'bouquet' : 'handMirror', rig.handL);
  aim(held, [0, -0.85, 0.12]);
  c.bake(held, (g) => {
    if (!c.v) {
      mesh(g, G.cyl(1, 12), toon(gold), { p: [0, 0.08, 0], s: [0.018, 0.17, 0.018] });
      mesh(g, G.torus(0.13, PI * 2, 22, 4), toon(gold), { p: [0, 0.27, 0], s: 0.105 });
      mesh(g, G.disc(24), toon('#d6eef8'), { p: [0, 0.27, 0.004], s: 0.1, outline: false });
      mesh(g, G.disc(24), toon(gold), { p: [0, 0.27, -0.004], r: [0, PI, 0], s: 0.1, outline: false });
      mesh(g, G.box(), gloss, { p: [0.03, 0.3, 0.006], r: [0, 0, -0.7], s: [0.012, 0.08, 0.002], outline: false });
    } else {
      // A bouquet instead of the mirror.
      mesh(g, G.cyl(3.4, 14), toon(C.paper), { p: [0, 0.1, 0], s: [0.035, 0.22, 0.035] });
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05;
        mesh(g, G.sphere(10, 8), toon(i % 2 ? gold : C.white), { p: [Math.sin(a) * 0.06, 0.24 + (i % 3) * 0.02, Math.cos(a) * 0.06], s: 0.045 });
      }
    }
  });
  // The back: scaffolding, a brace held down by a sandbag, clamps, gaffer tape, loose wires.
  c.bake(rig.torso, (g) => {
    const bat = toon('#a77f57'), metalM = toon(C.metal), gaff = toon(C.gaffer);
    for (const s of SIDES) mesh(g, G.box(), bat, { p: [X(s, 0.17 * w), 0.42, -0.045], s: [0.05, 1.0, 0.05] });
    for (const [y, sw] of [[0.12, 0.54], [0.38, 0.56], [0.6, 0.4]]) mesh(g, G.box(), bat, { p: [0, y, -0.085], s: [sw * w, 0.045, 0.04] });
    mesh(g, G.box(), bat, { p: [0, -0.04, -0.435], r: [0.594, 0, 0], s: [0.045, 1.3, 0.045] });
    mesh(g, G.rbox(0.3, 0.13, 0.22, 0.05), toon(C.canvas), { p: [0, -0.515, -0.8] });
    const clamp = (p: V3, rz: number) => {
      const o = piece(g, p, [0, 0, rz]);
      mesh(o, G.torus(0.25, PI * 1.35, 10, 4), metalM, { r: [0, PI / 2, PI * 0.33], s: 0.065 });
      mesh(o, G.cyl(1, 8), metalM, { p: [0, 0, -0.075], r: [PI / 2, 0, 0], s: [0.01, 0.07, 0.01] });
      mesh(o, G.box(), metalM, { p: [0, 0, -0.11], s: [0.07, 0.012, 0.012] });
    };
    clamp([0.31 * w, 0.3, -0.02], 0);
    clamp([-0.29 * w, 0.48, -0.02], PI);
    clamp([0, 0.8, -0.06], PI / 2);
    for (const [x, y, r] of [[0.08, 0.72, 0.1], [-0.12, 0.25, -0.4], [0.18, 0.55, 0.9], [-0.05, 0.58, 0.0]]) mesh(g, G.box(), gaff, { p: [x * w, y, -0.008], r: [0, 0, r], s: [0.2, 0.05, 0.006] });
  });
  tubeIn(c, rig.torso, [[0.06, 1.42, -0.05], [0.12, 1.12, -0.12], [0.08, 0.72, -0.2], [0.12, 0.25, -0.35], [0.15, 0.02, -0.55], [0.25, 0.02, -0.75]], 0.012, toon(C.black), { segs: 28, radial: 4 });
  tubeIn(c, rig.torso, [[-0.04, 1.4, -0.05], [-0.12, 1.0, -0.15], [-0.08, 0.6, -0.15], [-0.12, 0.2, -0.35], [-0.2, 0.02, -0.6]], 0.011, toon('#b8392e'), { segs: 28, radial: 4 });
  sweat(c, rig.head, [[-0.19, 0.08, 0.1]]);
  return { neutral: { lid: 0.3, brow: [0.22, -0.08], smile: 0.42, mouthW: 0.78 }, shadow: [0, -0.1, 0.4 * w, 0.55] };
}

// ---------- 10. The Librarian: knows everything; nobody has asked in years ----------
function librarian(c: Ctx): Result {
  const { rig, w } = c;
  legs(c, { spread: 0.13 * w, thigh: 0.12, shin: 0.12, r: 0.045, foot: [0.065, 0.04, 0.1] });
  at(rig.torso, [0, 0.3, 0]);
  const shade = (dl: number) => toon(`#${new THREE.Color(c.color).offsetHSL(0, -0.05, dl).getHexString()}`);
  const covers = [shade(-0.1), toon(c.color), shade(0.07)];
  const book = (g: THREE.Group, p: V3, ry: number, W: number, t: number, D: number, cover: THREE.Material) => {
    const b = piece(g, p, [0, ry, 0]), ct = 0.018;
    for (const y of [t / 2 - ct / 2, -t / 2 + ct / 2]) mesh(b, G.box(), cover, { p: [0, y, 0], s: [W, ct, D] });
    mesh(b, G.box(), cover, { p: [0, 0, D / 2 - 0.015], s: [W, t, 0.03] }); // spine faces you
    mesh(b, G.box(), toon(C.paper), { p: [0, 0, -0.012], s: [W - 0.03, t - 2 * ct + 0.002, D - 0.03] });
    for (const x of [-0.36, 0.36]) mesh(b, G.box(), flat(INK), { p: [x * W, 0, D / 2 + 0.002], s: [0.012, t * 0.86, 0.004], outline: false });
  };
  // Stack height grows with lines (ModuleStats has no separate doc-line count).
  const n = 5 + Math.round(4 * c.size);
  let y = 0;
  c.bake(rig.torso, (g) => {
    for (let i = 0; i < n; i++) {
      const t = 0.15 + 0.045 * rnd(i);
      book(g, [(rnd(i + 5) - 0.5) * 0.08, y + t / 2, (rnd(i + 9) - 0.5) * 0.05], (rnd(i + 3) - 0.5) * 0.42, (0.58 + 0.22 * rnd(i + 11)) * w, t, 0.42 + 0.12 * rnd(i + 23), covers[i % 3]);
      y += t;
    }
  });
  const top = 0.3 + y;
  at(rig.neck, [0, top, 0]);
  at(rig.head, [0, top + 0.15, 0.02]);
  rig.head.rotation.y = 0.05;
  const HW = 0.74 * w, HD = 0.52;
  c.bake(rig.head, (g) => book(g, [0, 0, 0], 0, HW, 0.3, HD, covers[2]));
  face(rig, { flat: HD / 2 + 0.001, eyeX: 0.1, eyeY: 0.025, eyeW: 0.048, eyeH: 0.06, mouthY: -0.095, mouthW: 0.08, browY: -0.005, skin: covers[2] });
  // Bookmarks sticking out of the top like hair.
  c.bake(prop(rig, 'bookmarks', rig.head), (g) => {
    for (let i = 0; i < 4; i++)
      mesh(g, G.box(), toon(i % 2 ? C.paper : '#c0392b'), { p: [-0.12 + i * 0.08, 0.23, -0.05 - (i % 2) * 0.08], r: [-0.25 - 0.1 * rnd(i), 0, (rnd(i + 2) - 0.5) * 0.6], s: [0.035, 0.2, 0.004] });
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
    const dark = toon(C.metalDark);
    c.bake(prop(rig, 'readingGlasses', rig.head), (g) => {
      for (const s of SIDES) {
        mesh(g, G.torus(0.12, PI, 20), dark, { p: [X(s, 0.1), -0.025, 0.305], r: [0, 0, PI], s: 0.05 });
        mesh(g, G.box(), dark, { p: [X(s, 0.1), -0.025, 0.305], s: [0.105, 0.007, 0.007] });
        mesh(g, G.box(), dark, { p: [X(s, 0.26), -0.02, 0.21], r: [0, X(s, -0.95), 0], s: [0.006, 0.006, 0.22] });
      }
      mesh(g, G.box(), dark, { p: [0, -0.02, 0.305], s: [0.06, 0.007, 0.007] });
      webAt(g, [-0.27, -0.15, 0.29], 0.12);
    });
    tubeIn(c, rig.head, [[0.35 * w, top + 0.13, 0.15], [0.32 * w, top - 0.12, 0.3], [0, top - 0.25, 0.34], [-0.32 * w, top - 0.12, 0.3], [-0.35 * w, top + 0.13, 0.15]], 0.005, toon(C.metal), { outline: false, segs: 28, radial: 3 });
  } else {
    // A service bell nobody rings, instead of the glasses; the cobweb is on the bell.
    c.bake(prop(rig, 'serviceBell', rig.head), (g) => {
      mesh(g, G.cyl(1, 18), toon(C.wood), { p: [0.2 * w, 0.163, 0.06], s: [0.09, 0.025, 0.09] });
      mesh(g, G.lid(), toon('#c9b06b'), { p: [0.2 * w, 0.175, 0.06], s: [0.075, 0.065, 0.075] });
      mesh(g, G.cyl(1, 8), toon('#c9b06b'), { p: [0.2 * w, 0.25, 0.06], s: [0.008, 0.03, 0.008] });
      mesh(g, G.sphere(8, 6), toon('#c9b06b'), { p: [0.2 * w, 0.27, 0.06], s: 0.013 });
      webAt(g, [0.2 * w - 0.09, 0.2, 0.09], 0.1);
    });
  }
  // Nobody has visited: a small dust cloud at its feet.
  c.bake(prop(rig, 'dust', rig.root), (g) => {
    for (const [x, z, r] of [[-0.3, 0.12, 0.07], [-0.22, 0.25, 0.05], [0.28, 0.2, 0.065], [0.36, 0.05, 0.05], [0.05, 0.3, 0.045], [-0.38, -0.08, 0.055]])
      mesh(g, G.sphere(10, 8), toon('#dcd7cd'), { p: [x * w, r * 0.8, z], s: [r * 1.3, r, r] });
  });
  // No arms: the groups still exist, at the sides of the top of the stack.
  for (const s of SIDES) at(rig[`arm${s}`], [X(s, 0.36 * w), 0.3 + y * 0.8, 0]);
  sweat(c, rig.head, [[0.28 * w, 0.1, 0.27]]);
  return { neutral: { look: [0, 0.42], brow: [0.42, -0.35], lid: 1.0, smile: 0.22, mouthW: 0.72 }, shadow: [0, 0, 0.45 * w, 0.38] };
}

const BUILDERS: Record<Archetype, (c: Ctx) => Result> = { bouncer, accountant, clerk, doorman, hoarder, inspector, junkDrawer, plumber, star, librarian };

export function buildCharacter(p: BuildParams): Built {
  const rig = createRig();
  const owned: THREE.BufferGeometry[] = [];
  const traits = faceTraits(p.stats);
  const c: Ctx = {
    rig, s: p.stats, v: p.variant, w: 1 + 0.4 * traits.width, size: sizeOf(p.stats.totalLines), color: p.color, body: toon(p.color), sweaty: traits.sweaty,
    bake: (parent, build, t) => bake(parent, owned, build, t),
    own: (g) => (owned.push(g), g),
  };
  const { neutral, shadow } = BUILDERS[p.archetype](c);
  if (!p.silhouette) mesh(rig.root, G.disc(24), shadowMat(), { p: [shadow[0], 0.003, shadow[1]], r: [-PI / 2, 0, 0], s: [shadow[2] * 1.3, shadow[3] * 1.3, 1], fx: true });

  // Finish: outlines on every solid part, or everything solid black for silhouette mode.
  const ownedSet = new Set(owned);
  const meshes: THREE.Mesh[] = [];
  rig.root.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
  for (const m of meshes) {
    if (p.silhouette) {
      if (m.userData.fx) m.removeFromParent();
      else m.material = flat('#000000');
      continue;
    }
    if (m.userData.fx) m.raycast = () => {};
    if (m.userData.fx || m.userData.noOutline) continue;
    const o = new THREE.Mesh(hull(m.geometry, ownedSet.has(m.geometry) ? owned : undefined), OUTLINE);
    o.userData.outline = true;
    o.raycast = () => {};
    m.add(o);
  }
  snapshotRest(rig);
  applyExpression(rig, neutral, traits);
  const count = { base: 0, outline: 0 };
  rig.root.traverseVisible((o) => {
    if (o instanceof THREE.Mesh) count[o.userData.outline ? 'outline' : 'base'] += tris(o.geometry);
  });
  return { root: rig.root, rig, neutral, tris: count, dispose: () => owned.forEach((g) => g.dispose()) };
}
