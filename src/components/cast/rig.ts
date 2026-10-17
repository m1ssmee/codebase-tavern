// The shared rig: one named joint hierarchy for every character, the shared face construction,
// and expression presets that only move brows, lids, pupils, mouth and head tilt.
import * as THREE from 'three';
import { C, G, INK, flat, mesh, seg, toon, tube, type V3 } from './kit';

export type PupilKind = 'dot' | 'x' | 'spiral';
export const EXPRESSIONS = ['deadpan', 'smug', 'nervous', 'furious', 'horrified', 'dead'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/**
 * Same joint names on every character, pivots at the joints, poses stored on the joints (never baked
 * into geometry). Names are unique within a character, so one AnimationClip with tracks such as
 * "head.quaternion" or "shoulderL.quaternion" drives any of them via `new AnimationMixer(rig.root)`;
 * use AdditiveAnimationBlendMode to layer motion on top of the static pose. Parts a character lacks
 * (the Junk Drawer's neck, the Librarian's arms) are still here, empty, at a sensible position.
 * Every joint keeps its rest transform in `userData.rest` ({ p, r, s }).
 */
export interface CharacterRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  pupilL: THREE.Group;
  pupilR: THREE.Group;
  lidL: THREE.Group;
  lidR: THREE.Group;
  browL: THREE.Group;
  browR: THREE.Group;
  jaw: THREE.Group;
  mouth: THREE.Group;
  armL: THREE.Group;
  shoulderL: THREE.Group;
  elbowL: THREE.Group;
  handL: THREE.Group;
  armR: THREE.Group;
  shoulderR: THREE.Group;
  elbowR: THREE.Group;
  handR: THREE.Group;
  legL: THREE.Group;
  hipL: THREE.Group;
  kneeL: THREE.Group;
  footL: THREE.Group;
  legR: THREE.Group;
  hipR: THREE.Group;
  kneeR: THREE.Group;
  footR: THREE.Group;
  /** Closed-mouth line; morph targets "smile", "frown", "smirk", "wavy". */
  mouthLine: THREE.Mesh;
  /** Dark mouth cavity: scale.y is how far the mouth is open. Teeth sit inside it. */
  mouthOpen: THREE.Group;
  teeth: THREE.Group;
  /** Pupil shapes per eye; expressions show one. */
  pupils: Record<'L' | 'R', Record<PupilKind, THREE.Object3D>>;
  /** Props by name, each parented to the joint that carries it (e.g. props.clipboard under handR). */
  props: Record<string, THREE.Group>;
  /** Face unit (eye half-height): expression offsets are multiples of it. */
  unit: number;
  /** Finger sets per hand, hidden until a gesture shows one. Separate toggled meshes at both detail levels. */
  hands: Record<'L' | 'R', Partial<Record<FingerPose, THREE.Group>>>;
  /** Parts that appear or disappear (bump, bandage, soot, wig, blunderbuss, BANG flag...), hidden until shown. */
  toggles: Record<string, THREE.Group>;
}

/** Hand shapes for gestures; 'mitten' is the plain hand with no finger set shown. */
export type HandPose = 'mitten' | FingerPose;
export const FINGER_POSES = ['fist', 'point', 'middle', 'thumbs', 'palm', 'posh'] as const;
export type FingerPose = (typeof FINGER_POSES)[number];

export const JOINTS = [
  'root', 'hips', 'torso', 'neck', 'head', 'eyeL', 'eyeR', 'pupilL', 'pupilR', 'lidL', 'lidR', 'browL', 'browR', 'jaw', 'mouth',
  'armL', 'shoulderL', 'elbowL', 'handL', 'armR', 'shoulderR', 'elbowR', 'handR', 'legL', 'hipL', 'kneeL', 'footL', 'legR', 'hipR', 'kneeR', 'footR',
] as const satisfies readonly (keyof CharacterRig)[];

export function createRig(): CharacterRig {
  const g = (name: string, parent?: THREE.Object3D, order?: THREE.EulerOrder) => {
    const o = new THREE.Group();
    o.name = name;
    if (order) o.rotation.order = order;
    parent?.add(o);
    return o;
  };
  const root = g('root'), hips = g('hips', root), torso = g('torso', hips), neck = g('neck', torso), head = g('head', neck);
  const eyeL = g('eyeL', head, 'YXZ'), eyeR = g('eyeR', head, 'YXZ');
  const jaw = g('jaw', head), mouth = g('mouth', jaw), mouthOpen = g('mouthOpen', mouth);
  const arm = (s: string) => {
    const a = g(`arm${s}`, torso), sh = g(`shoulder${s}`, a), el = g(`elbow${s}`, sh);
    return [a, sh, el, g(`hand${s}`, el)];
  };
  const leg = (s: string) => {
    const l = g(`leg${s}`, hips), hp = g(`hip${s}`, l), kn = g(`knee${s}`, hp);
    return [l, hp, kn, g(`foot${s}`, kn)];
  };
  const [armL, shoulderL, elbowL, handL] = arm('L'), [armR, shoulderR, elbowR, handR] = arm('R');
  const [legL, hipL, kneeL, footL] = leg('L'), [legR, hipR, kneeR, footR] = leg('R');
  return {
    root, hips, torso, neck, head, eyeL, eyeR,
    pupilL: g('pupilL', eyeL), pupilR: g('pupilR', eyeR),
    lidL: g('lidL', head, 'YXZ'), lidR: g('lidR', head, 'YXZ'), browL: g('browL', head, 'YXZ'), browR: g('browR', head, 'YXZ'),
    jaw, mouth, armL, shoulderL, elbowL, handL, armR, shoulderR, elbowR, handR, legL, hipL, kneeL, footL, legR, hipR, kneeR, footR,
    mouthLine: new THREE.Mesh(), mouthOpen, teeth: g('teeth', mouthOpen),
    pupils: { L: {} as Record<PupilKind, THREE.Object3D>, R: {} as Record<PupilKind, THREE.Object3D> },
    props: {}, unit: 0.05, hands: { L: {}, R: {} }, toggles: {},
  };
}

/** Prop group named prop_<name>, registered on the rig. */
export function prop(rig: CharacterRig, name: string, parent: THREE.Object3D) {
  const o = new THREE.Group();
  o.name = `prop_${name}`;
  parent.add(o);
  return (rig.props[name] = o);
}

// ---------- placement in character space (the root is at the origin, facing +z, while building) ----------
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
/** Put `o` at a character-space point, whatever its parent's transform. */
export function at(o: THREE.Object3D, p: V3) {
  o.parent!.updateWorldMatrix(true, false);
  o.position.copy(o.parent!.worldToLocal(_v.set(...p)));
}
/** Give `o` a character-space rotation [pitch, yaw, roll] (Euler YXZ), whatever its parent's rotation. */
export function aim(o: THREE.Object3D, r: V3) {
  o.parent!.updateWorldMatrix(true, false);
  o.parent!.getWorldQuaternion(_q);
  o.quaternion.copy(_q.invert().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ'))));
}
/** Point `o`'s local +Y along a character-space direction. */
export function up(o: THREE.Object3D, d: V3) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...d).normalize());
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  aim(o, [e.x, e.y, e.z]);
}
const DOWN = new THREE.Vector3(0, -1, 0);
function pointDown(j: THREE.Object3D, dir: THREE.Vector3) {
  j.parent!.updateWorldMatrix(true, false);
  j.parent!.getWorldQuaternion(_q);
  j.quaternion.setFromUnitVectors(DOWN, dir.clone().normalize().applyQuaternion(_q.invert()));
}
/**
 * Two-bone limb through character-space points: socket A, middle joint B (elbow/knee), end C (wrist/ankle).
 * Joints point their local -Y down each bone, so bone meshes hang along -Y. Returns the bone lengths.
 */
export function limb([socket, j1, j2, end]: THREE.Group[], A: V3, B: V3, C3: V3): [number, number] {
  at(socket, A);
  const a = new THREE.Vector3(...A), b = new THREE.Vector3(...B), c = new THREE.Vector3(...C3);
  pointDown(j1, b.clone().sub(a));
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  j2.position.set(0, -l1, 0);
  pointDown(j2, c.clone().sub(b));
  end.position.set(0, -l2, 0);
  return [l1, l2];
}
/** Capsule bones for a posed limb: upper under the first joint, lower under the second. */
export function bones([, j1, j2]: THREE.Group[], [l1, l2]: [number, number], r1: number, r2: number, m1: THREE.Material, m2 = m1, radial = 9) {
  mesh(j1, G.capsule(r1, l1, 2, radial), m1, { p: [0, -l1 / 2, 0] });
  mesh(j2, G.capsule(r2, l2, 2, radial), m2, { p: [0, -l2 / 2, 0] });
}

// ---------- the face: same construction for everyone ----------
export type FaceSpec = {
  /** Head-local ellipsoid the face sits on (centre, radii), or a flat face at z = flat. */
  c?: V3;
  r?: V3;
  flat?: number;
  eyeX: number;
  eyeY: number;
  /** Eye half-width and half-height (white ovals, taller than wide). */
  eyeW: number;
  eyeH: number;
  mouthY: number;
  mouthW: number;
  browLen?: number;
  browR?: number;
  browY?: number;
  /** Lid colour (the skin around the eyes). */
  skin: THREE.Material;
  /** Iris ring colour; defaults to near-black. */
  iris?: string;
};

const spirals = new Map<number, THREE.BufferGeometry>();
const spiralGeo = () => {
  const n = seg(40, 16);
  if (!spirals.has(n)) spirals.set(n, tube((t) => [Math.cos(t * 16) * (0.08 + 0.64 * t), Math.sin(t * 16) * (0.08 + 0.64 * t), 0], 0.06, 40, 3));
  return spirals.get(n)!;
};
const mouthGeos = new Map<string, THREE.BufferGeometry>();
/** Mouth line tube with morph targets; bends are relative to half the mouth width. */
function mouthGeo(w: number) {
  const key = `${w}|${seg(24, 12)}`;
  if (!mouthGeos.has(key)) {
    const hw = w / 2;
    const make = (f: (u: number) => number) => tube((t) => [(t * 2 - 1) * hw, f(t * 2 - 1) * hw, 0], w * 0.075, 24, 8);
    const base = make(() => 0);
    const shapes: Record<string, (u: number) => number> = {
      smile: (u) => 0.45 * u * u - 0.12,
      frown: (u) => -0.45 * u * u + 0.12,
      smirk: (u) => (u > 0 ? 0.6 * u * u : -0.05 * u * u),
      wavy: (u) => 0.16 * Math.sin(u * Math.PI * 2.5),
    };
    base.morphAttributes.position = Object.entries(shapes).map(([name, f]) => {
      const g = make(f);
      const a = g.getAttribute('position');
      a.name = name;
      g.dispose();
      return a;
    });
    mouthGeos.set(key, base);
  }
  return mouthGeos.get(key)!;
}

export function face(rig: CharacterRig, f: FaceSpec) {
  const [cx, cy, cz] = f.c ?? [0, 0, 0];
  const [rx, ry, rz] = f.r ?? [1, 1, 1];
  const surf = (x: number, y: number) => f.flat ?? cz + rz * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2));
  const turn = (x: number, y: number) => (f.flat !== undefined ? 0 : Math.atan2((x - cx) / rx ** 2, (surf(x, y) - cz) / rz ** 2) * 0.8);
  const a = f.eyeW, b = f.eyeH;
  rig.unit = b;
  const browR = (f.browR ?? b * 0.24) * 1.3, browLen = (f.browLen ?? a * 1.5) * 1.1;
  const iris = flat(f.iris ?? '#3a2c26');
  for (const s of ['L', 'R'] as const) {
    const x = s === 'L' ? f.eyeX : -f.eyeX, y = f.eyeY;
    const eye = rig[`eye${s}`];
    eye.position.set(x, y, surf(x, y) - b * 0.42);
    eye.rotation.y = turn(x, y);
    eye.scale.set(a, b, b);
    mesh(eye, G.sphere(32, 24), toon(C.white), { outline: true, keep: true });
    const pupil = rig[`pupil${s}`];
    const cross = new THREE.Group();
    for (const r of [Math.PI / 4, -Math.PI / 4]) mesh(cross, G.box(), flat(INK), { r: [0, 0, r], s: [1.05, 0.22, 0.1], outline: false, keep: true });
    pupil.add(cross);
    // Pupil: a subtle iris ring, the dark core, and a catchlight up and to the left.
    const dot = new THREE.Group();
    mesh(dot, G.sphere(20, 10), iris, { s: [0.48, 0.48, 0.14], outline: false, keep: true });
    mesh(dot, G.sphere(16, 8), flat(INK), { p: [0, 0, 0.03], s: [0.31, 0.31, 0.13], outline: false, keep: true });
    mesh(dot, G.sphere(12, 6), flat('#ffffff'), { p: [-0.15, 0.17, 0.08], s: [0.12, 0.12, 0.06], outline: false, keep: true });
    mesh(dot, G.sphere(8, 4), flat('#ffffff'), { p: [0.13, -0.12, 0.08], s: [0.05, 0.05, 0.04], outline: false, full: true });
    pupil.add(dot);
    rig.pupils[s] = {
      dot,
      x: cross,
      spiral: mesh(pupil, spiralGeo(), flat(INK), { outline: false, keep: true }),
    };
    const lid = rig[`lid${s}`];
    lid.position.copy(eye.position);
    lid.rotation.y = eye.rotation.y;
    lid.scale.set(a * 1.1, b * 1.1, b * 1.1);
    mesh(lid, G.lid(), f.skin, { outline: true, keep: true });
    const brow = rig[`brow${s}`];
    const by = y + b * 1.32 + (f.browY ?? 0);
    brow.position.set(x * 1.04, by, surf(x * 1.04, by) + browR * 0.3);
    brow.rotation.y = turn(x, by);
    mesh(brow, G.brow(browLen, browR), flat(INK), { s: [s === 'L' ? 1 : -1, 1, 1], outline: false, keep: true });
  }
  rig.jaw.position.set(cx, f.mouthY, surf(cx, f.mouthY) - 0.002);
  const w = f.mouthW;
  rig.mouthLine = mesh(rig.mouth, mouthGeo(+w.toFixed(3)), flat(INK, true), { outline: false, keep: true });
  rig.mouthLine.name = 'mouthLine';
  rig.mouthLine.updateMorphTargets();
  // Open mouth: dark cavity with a hint of tongue at the bottom, teeth along the top.
  mesh(rig.mouthOpen, G.sphere(24, 14), flat(C.cavity), { p: [0, 0, -0.004], s: [w * 0.62, w * 0.55, w * 0.18], outline: true, keep: true });
  mesh(rig.mouthOpen, G.sphere(16, 10), toon('#c75a63'), { p: [0, -w * 0.3, w * 0.07], s: [w * 0.38, w * 0.2, w * 0.1], outline: false, keep: true });
  mesh(rig.teeth, G.rbox(w * 0.8, w * 0.24, w * 0.08, w * 0.03), toon(C.white), { p: [0, w * 0.3, w * 0.11], outline: false, keep: true });
}

// ---------- expressions ----------
/** Brow [lift in face units, tilt in radians: + = inner ends down]; lid openness 0 closed .. 1 open; look in eye units. */
export type Face = {
  brow?: [number, number];
  browL?: [number, number];
  browR?: [number, number];
  lid?: number;
  lidL?: number;
  lidR?: number;
  look?: [number, number];
  pupil?: number;
  kind?: PupilKind;
  smile?: number;
  frown?: number;
  smirk?: number;
  wavy?: number;
  open?: number;
  teeth?: number;
  mouthW?: number;
  /** Head tilt [x: + = chin down, z: + = towards its left]. */
  tilt?: [number, number];
};

/** Presets for every expression except deadpan, which is each archetype's own neutral. */
export const PRESETS: Record<Exclude<Expression, 'deadpan'>, Face> = {
  smug: { browL: [0.45, -0.12], browR: [-0.15, 0.28], lid: 0.4, look: [0.2, -0.1], smirk: 1, tilt: [-0.14, 0.08] },
  nervous: { brow: [0.35, -0.42], lid: 0.98, look: [-0.38, 0.04], pupil: 0.7, wavy: 1, open: 0.24, teeth: 1, mouthW: 1.1 },
  furious: { brow: [-0.36, 0.55], lid: 0.6, pupil: 0.75, open: 0.55, teeth: 1, mouthW: 1.45 },
  horrified: { brow: [0.7, -0.34], lid: 1.15, pupil: 0.4, open: 1.2, mouthW: 1.05 },
  dead: { brow: [-0.08, -0.15], lid: 0.95, kind: 'x', wavy: 0.5, frown: 0.25, tilt: [0.06, 0.2] },
};

export type Traits = { shifty: boolean; dizzy: boolean };

export function applyExpression(rig: CharacterRig, f: Face, t: Traits) {
  const kind: PupilKind = f.kind === 'x' ? 'x' : t.dizzy ? 'spiral' : (f.kind ?? 'dot');
  // TODOs >= 5: pupils pushed sideways and one brow up, unless the face is dead or horrified.
  const shifty = t.shifty && kind !== 'x' && (f.pupil ?? 1) > 0.5;
  const [lx, ly] = f.look ?? [0, 0];
  const look = new THREE.Vector3(Math.max(-0.55, Math.min(0.55, lx + (shifty ? 0.42 : 0))), ly, 0);
  look.z = Math.sqrt(1 - look.x ** 2 - look.y ** 2);
  for (const s of ['L', 'R'] as const) {
    const [lift, tilt] = f[`brow${s}`] ?? f.brow ?? [0, 0];
    const brow = rig[`brow${s}`];
    brow.position.y = brow.userData.rest.p.y + (lift + (shifty && s === 'R' ? 0.4 : 0)) * rig.unit;
    brow.rotation.z = (s === 'L' ? 1 : -1) * tilt;
    rig[`lid${s}`].rotation.x = Math.PI / 2 - (f[`lid${s}`] ?? f.lid ?? 0.8) * Math.PI;
    const pupil = rig[`pupil${s}`];
    pupil.position.copy(look).multiplyScalar(0.985);
    pupil.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), look);
    pupil.scale.setScalar(kind === 'dot' ? (f.pupil ?? 1) : 1);
    for (const [k, o] of Object.entries(rig.pupils[s])) o.visible = k === kind;
  }
  const inf = rig.mouthLine.morphTargetInfluences!, dict = rig.mouthLine.morphTargetDictionary!;
  for (const k of ['smile', 'frown', 'smirk', 'wavy'] as const) inf[dict[k]] = f[k] ?? 0;
  const open = f.open ?? 0;
  rig.mouthLine.visible = open < 0.3;
  rig.mouthOpen.visible = open > 0.02;
  rig.mouthOpen.scale.y = Math.max(open, 0.01);
  rig.teeth.visible = (f.teeth ?? 0) > 0;
  rig.mouth.scale.x = f.mouthW ?? 1;
  const [tx, tz] = f.tilt ?? [0, 0];
  rig.head.rotation.x = rig.head.userData.rest.r.x + tx;
  rig.head.rotation.z = rig.head.userData.rest.r.z + tz;
}

/** Record every joint's rest transform (after the build pose) in userData.rest. */
export function snapshotRest(rig: CharacterRig) {
  for (const o of animatable(rig)) o.userData.rest = { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() };
}

/** Everything animation can move: the joints, then prop groups, toggled parts and finger sets (all uniquely named). */
export const animatable = (rig: CharacterRig): THREE.Object3D[] => [
  ...JOINTS.map((j) => rig[j]),
  ...Object.values(rig.props),
  ...Object.values(rig.toggles),
  ...(['L', 'R'] as const).flatMap((s) => Object.values(rig.hands[s]) as THREE.Group[]),
];
