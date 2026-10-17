// The clip library: shared clips every character can play (reactions, gestures, the spice-gated crude ones,
// the Tribunal's culprit fates) and lookup with per-archetype overrides from gags.ts. Gag timing follows the
// comedy rules: anticipation, action, a 300-500 ms frozen beat, payoff, recover; faces stay deadpan.
import * as THREE from 'three';
import type { Archetype } from '@/lib/cast';
import type { Actor } from './actor';
import { spice } from './core';
import { bumps, call, emit, expr, face, fx, hand, hide, hold, one, osc, plus, show, snd, type ClipFn, type IKKey, type V3 } from './dsl';
import { FX, shake } from './fx';
import { GAGS } from './gags';

const z: V3 = [0, 0, 0];
const both = (keys: IKKey[]) => ({ L: keys, R: keys });
/** World point of a character-space point on this actor (rest-relative, follows the body). */
export const wp = (a: Actor, p: V3) => a.rig!.root.localToWorld(new THREE.Vector3(...p));
/** The actor's backward direction in the world (fart clouds, recoil smoke). */
export const backDir = (a: Actor, k = 0.8): V3 => {
  const d = new THREE.Vector3(0, 0, -1).applyQuaternion(a.rig!.root.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(k);
  return [d.x, d.y, d.z];
};
const headTop = (a: Actor) => a.world('head', [0, a.dims!.headR * 0.9, 0]);

// ---------- shared clips ----------
export const SHARED: Record<string, ClipFn> = {
  /** Generic idle: a weight shift and a look around. */
  idle: () => ({
    dur: 2.2, beat: 0.8,
    tracks: { 'hips.r': hold([0, 0, 3], 0.2, 1.6, 0.5, 0.5, 'io'), 'torso.r': hold([0, 6, -2], 0.3, 1.6, 0.5, 0.5, 'io'), 'head.r': hold([4, -10, 0], 0.5, 1.5, 0.4, 0.5, 'io') },
  }),
  /** The clean fallback for anything gated: a long flat glare at you. */
  glare: () => ({
    dur: 1.5, beat: 0.6,
    tracks: { 'head.r': [[0, z], [0.18, [6, 0, 0]], [0.36, [-4, 0, 0], 'back'], [1.15, [-4, 0, 0]], [1.5, z]], 'torso.r': hold([-3, 0, 0], 0.15, 1.15, 0.2, 0.3), 'face.p': hold([-0.35, 0, -0.3], 0.2, 1.15, 0.15, 0.3, 'out') },
    cues: [[0.3, face({ look: [0, 0] })]],
  }),
  sigh: () => ({
    dur: 1.9, beat: 0.7,
    tracks: {
      'torso.s': one([0.6, [1.04, 1.05, 1.04]], [0.75, [1.04, 1.05, 1.04]], [1.3, [0.98, 0.95, 0.98]], [1.9, [1, 1, 1]]),
      'torso.r': [[0, z], [0.6, [-4, 0, 0]], [1.3, [7, 0, 0]], [1.9, z]],
      'head.r': [[0, z], [0.6, [-8, 0, 0]], [1.3, [10, 0, 0]], [1.9, z]],
      'armL.p': [[0, z], [0.6, [0, 0.03, 0]], [1.3, [0, -0.02, 0]], [1.9, z]],
      'armR.p': [[0, z], [0.6, [0, 0.03, 0]], [1.3, [0, -0.02, 0]], [1.9, z]],
      'face.p': [[0, z], [0.6, [0.1, 0, 0.15]], [1.3, [-0.4, 0, -0.05]], [1.9, z]],
    },
    cues: [[0.75, snd('sigh')]],
  }),
  shrug: () => ({
    dur: 1.35, beat: 0.55,
    tracks: { 'armL.p': hold([0, 0.06, 0], 0.15, 0.85, 0.15, 0.3), 'armR.p': hold([0, 0.06, 0], 0.15, 0.85, 0.15, 0.3), 'head.r': hold([0, 0, 9], 0.15, 0.85), 'neck.p': hold([0, -0.015, 0], 0.15, 0.85) },
    ik: both([[0, null], [0.28, [0.6, -0.4, 0.55], 'back'], [0.85, [0.6, -0.4, 0.55]], [1.25, null]]),
    cues: [[0.2, hand('L', 'palm')], [0.2, hand('R', 'palm')], [0.25, face({ brow: [0.35, -0.2], lid: 0.55 })], [1.1, hand('L', 'mitten')], [1.1, hand('R', 'mitten')]],
  }),
  /** Clean bonk reaction: a squash and a blink. */
  softBonked: () => ({
    dur: 0.75, beat: 0.12,
    tracks: { 'root.sq': one([0.06, 0.86, 'out'], [0.3, 1.05, 'out'], [0.55, 1]), 'head.r': [[0, z], [0.06, [10, 0, 0], 'out'], [0.5, z]] },
    cues: [[0, face({ lid: 0.1 })], [0.35, face({ lid: 0.8 })], [0, snd('bonk', 0.6)]],
  }),
  /** Unhinged+: bump, dizzy stars, spiral eyes; feral+ also leaves a plaster; nuclear shakes the screen. */
  bonked: (k) => ({
    dur: 1.9, beat: 0.25, min: 1, fallback: 'softBonked',
    tracks: {
      'root.sq': one([0.05, 0.7, 'out'], [0.25, 1.12, 'out'], [0.45, 0.96], [0.6, 1]),
      'neck.r': [[0, z], [0.05, [14, 0, 0], 'out'], [0.5, z]],
      'root.r': osc(2.2, [0, 0, 7], 0.3, 1.8, 0.2),
      'head.r': osc(2.2, [0, 9, 0], 0.3, 1.8, 0.2, 1),
    },
    cues: [
      [0, show('bump', 7)], [0, face({ kind: 'spiral', lid: 0.75 })], [1.5, face({ kind: 'dot' })],
      [0.02, fx((s, a) => FX.stars(s, a.part('head')!, 2.2, Math.max(0.18, k.headR * 1.1)))],
      [0, call((a) => spice() >= 2 && a.showFor('plaster', 9))], [0, call(() => spice() >= 3 && shake(0.05, 0.25))],
    ],
  }),
  /** The Bouncer's chest bump knocks people over: down and straight back up. */
  knocked: (k) => ({
    dur: 1.6, beat: 0.3,
    tracks: {
      'root.r': [[0, z], [0.3, [-82, 0, 0], 'in'], [0.45, [-74, 0, 0], 'out'], [0.6, [-82, 0, 0], 'in'], [1.0, [-82, 0, 0]], [1.4, [6, 0, 0], 'back'], [1.6, z]],
      'root.p': [[0, z], [0.3, [0, 0.2, -0.15]], [1.0, [0, 0.2, -0.15]], [1.4, z]],
    },
    cues: [[0.3, snd('thud')], [0.3, fx((s, a) => FX.dust(s, a.world('root')))], [0.3, call((a) => spice() >= 1 && a.showFor('bump', 7))], [0.35, fx((s, a) => spice() >= 1 && FX.stars(s, a.part('head')!, 1.4, Math.max(0.18, k.headR * 1.1)))], [0.3, face({ lid: 0.3, kind: 'spiral' })], [1.3, face({ kind: 'dot' })]],
  }),
  // ---------- the stage (characters over the code panel) ----------
  /** Picked up by the cursor: hangs from the top, legs kicking, arms flailing (loops until put down). */
  dangle: () => ({
    dur: 0.6, loop: true,
    tracks: {
      'hipL.r': osc(10 / 3, [42, 0, 0], 0, 1e9, 0), 'hipR.r': osc(10 / 3, [-42, 0, 0], 0, 1e9, 0),
      'kneeL.r': plus([[0, [30, 0, 0]]], osc(10 / 3, [26, 0, 0], 0, 1e9, 0, 1.2)), 'kneeR.r': plus([[0, [30, 0, 0]]], osc(10 / 3, [-26, 0, 0], 0, 1e9, 0, 1.2)),
      'root.r': osc(5 / 3, [0, 0, 7], 0, 1e9, 0),
      'head.r': osc(5 / 3, [0, 0, -5], 0, 1e9, 0, 0.5),
    },
    ik: both([[0, [0.42, 0.62, 0.2]]]),
    cues: [[0, expr('nervous')], [0, hand('L', 'palm')], [0, hand('R', 'palm')]],
  }),
  /** Pops in at the screen edge: a hand up, a small wave, a flat face. */
  wave: () => ({
    dur: 1.8, beat: 0.6,
    ik: { R: [[0, null], [0.25, [0.36, 0.72, 0.38], 'back'], [1.45, [0.36, 0.72, 0.38]], [1.8, null]] },
    tracks: { 'handR.r': osc(3, [0, 0, 28], 0.35, 1.45, 0.15) },
    cues: [[0.2, hand('R', 'palm')], [1.5, hand('R', 'mitten')], [0.2, face({ lid: 0.55, smirk: 0.4 })], [0.25, snd('pop', 0.5)]],
  }),
  /** Somebody scrolled too fast: spiral eyes, stars, a wobble. Clean-safe; once per 30 s. */
  dizzy: (k) => ({
    dur: 1.8, beat: 0.4, cool: true,
    tracks: { 'root.r': osc(2.2, [0, 0, 6], 0, 1.7, 0.2), 'head.r': osc(2.2, [0, 10, 0], 0, 1.7, 0.2, 1) },
    cues: [[0, face({ kind: 'spiral', lid: 0.7 })], [1.6, face({ kind: 'dot' })], [0.02, fx((s, a) => FX.stars(s, a.part('head')!, 1.6, Math.max(0.18, k.headR * 1.1)))]],
  }),
  /** Holding a grudge: shoulders forward, head down and turned away, heavy lids (held while idle). */
  sulk: () => ({
    dur: 0.8, beat: 0.6, hold: true,
    tracks: { 'torso.r': [[0, z], [0.6, [7, 0, 0]]], 'head.r': [[0, z], [0.6, [12, -14, 0]]] },
    cues: [[0.1, face({ lid: 0.55, brow: [-0.25, 0.2], look: [-0.35, -0.25], frown: 0.5 })]],
  }),
  /** Faint sideways and stay down until released. */
  faint: (k) => ({
    dur: 1.35, beat: 0.5, hold: true,
    tracks: {
      'root.r': [[0, z], [0.35, [0, 0, -6], 'io'], [0.5, [0, 0, -4]], [1.05, [0, 0, 86], 'in'], [1.2, [0, 0, 80], 'out'], [1.35, [0, 0, 84], 'in']],
      'root.p': [[0, z], [0.5, z], [1.05, [k.H * 0.4, 0.16, 0], 'in']],
      'root.sq': one([1.05, 1], [1.12, 0.9, 'out'], [1.35, 1]),
    },
    cues: [[0, face({ look: [0, 0.45], lid: 0.55, brow: [0.4, -0.3] })], [0.5, face({ lid: 0.3 })], [1.05, expr('dead')], [1.05, snd('thud')], [1.05, fx((s, a) => FX.dust(s, a.world('root', [0, 0.6, 0])))]],
  }),
  /** Innocents duck when the blunderbuss comes out (held until released). */
  duck: (k) => ({
    dur: 0.5, beat: 0.45, hold: true,
    tracks: { 'root.sq': one([0.12, 1.06], [0.4, 0.74, 'out']), 'torso.r': [[0, z], [0.4, [16, 0, 0]]], 'head.r': [[0, z], [0.4, [16, 0, 0]]] },
    ik: { L: [[0, null], [0.35, { r: [0.07, k.H + 0.03, k.head[2] + 0.04] }]], R: [[0, null], [0.35, { r: [-0.07, k.H + 0.03, k.head[2] + 0.04] }]] },
    cues: [[0.1, face({ lid: 0.05, brow: [0.3, -0.3] })], [0.1, snd('whoosh', 0.6)], [0.3, hand('L', 'palm')], [0.3, hand('R', 'palm')]],
  }),
  /** Roasted: shrinks, hides its face, goes red. */
  mortified: (k) => ({
    dur: 2.4, beat: 0.8,
    tracks: { 'root.sq': hold(0.86, 0.1, 1.9, 0.25, 0.4, 'io', 1), 'head.r': hold([18, 0, 0], 0.1, 1.9, 0.3, 0.4, 'io'), 'torso.r': hold([10, 0, 0], 0.1, 1.9, 0.3, 0.4, 'io') },
    ik: {
      L: [[0, null], [0.45, { r: [0.05, k.head[1] - 0.02, k.head[2] + k.headR] }], [1.9, { r: [0.05, k.head[1] - 0.02, k.head[2] + k.headR] }], [2.3, null]],
      R: [[0, null], [0.45, { r: [-0.05, k.head[1] - 0.02, k.head[2] + k.headR] }], [1.9, { r: [-0.05, k.head[1] - 0.02, k.head[2] + k.headR] }], [2.3, null]],
    },
    cues: [[0.2, show('redFace')], [0.2, face({ lid: 0.1, brow: [0.3, -0.4] })], [0.5, fx((s, a) => FX.sweat(s, headTop(a)))], [1.2, fx((s, a) => FX.sweat(s, headTop(a)))], [0.3, snd('whoosh', 0.5)]],
  }),
  /** Three flat "ha"s, no grin; with a forward point (the director points it at someone instead). */
  laugh: () => ({
    dur: 1.6, beat: 0.6,
    tracks: { 'torso.p': bumps([0.45, 0.78, 1.11], [0, 0.025, 0], 0.06, 0.16), 'head.r': bumps([0.45, 0.78, 1.11], [-6, 0, 0], 0.06, 0.16), 'face.p': bumps([0.45, 0.78, 1.11], [0, 0.35, 0], 0.05, 0.12) },
    cues: [[0.3, face({ lid: 0.5 })], [0.45, snd('ha')], [0.78, snd('ha')], [1.11, snd('ha')]],
  }),
  pointLaugh: (k) => ({ ...SHARED.laugh(k), cool: true, min: 1, fallback: 'shrug', ik: { R: [[0, null], [0.3, [0.2, 0.15, 0.95], 'back'], [1.3, [0.2, 0.15, 0.95]], [1.6, null]] }, cues: [...SHARED.laugh(k).cues!, [0.25, hand('R', 'point')], [1.4, hand('R', 'mitten')]] }),
  /** Unhinged: four slow claps. */
  slowClap: (k) => {
    const c: V3 = [0, k.arm.L.S[1] - 0.14, k.arm.L.S[2] + Math.max(0.3, k.arm.L.len * 0.7)];
    const at = (dx: number): V3 => [c[0] + dx, c[1], c[2]];
    const L: IKKey[] = [[0, null]], R: IKKey[] = [[0, null]];
    for (const [i, t] of [0.55, 1.15, 1.75, 2.35].entries()) {
      L.push([t - 0.3, { r: at(0.16) }, i ? 'io' : 'out'], [t, { r: at(0.025) }, 'in']);
      R.push([t - 0.3, { r: at(-0.16) }, i ? 'io' : 'out'], [t, { r: at(-0.025) }, 'in']);
    }
    L.push([2.8, null]);
    R.push([2.8, null]);
    return { dur: 2.9, beat: 1.15, cool: true, min: 1, ik: { L, R }, cues: [[0.2, face({ lid: 0.42 })], ...[0.55, 1.15, 1.75, 2.35].map((t): [number, ReturnType<typeof snd>] => [t, snd('clap')])] };
  },
  /** Unhinged: a fart cloud, delivered deadpan. */
  fart: (k) => ({
    dur: 1.5, beat: 0.6, crude: true, min: 1,
    tracks: { 'root.p': [[0, z], [0.35, [0, 0.03, 0]], [0.45, z, 'out']], 'torso.r': hold([-5, 0, 0], 0.1, 0.9, 0.25, 0.4), 'root.sq': one([0.35, 1.06], [0.45, 0.94, 'out'], [0.7, 1]) },
    cues: [[0.4, snd('raspberry')], [0.42, fx((s, a) => FX.fart(s, wp(a, k.back), backDir(a)))], [0.3, face({ lid: 0.5, look: [0, 0] })]],
  }),
  /** Unhinged: one middle finger. Anticipation, raise, frozen beat, a little jab, down. */
  middle: () => ({
    dur: 1.55, beat: 0.7, crude: true, min: 1,
    tracks: { 'torso.r': [[0, z], [0.2, [4, -6, 0]], [0.38, [-3, 8, 0], 'back'], [1.15, [-3, 8, 0]], [1.55, z]] },
    ik: { R: [[0, null], [0.18, [0.15, -0.8, 0.25]], [0.38, [0.38, 0.72, 0.42], 'back'], [0.8, [0.38, 0.72, 0.42]], [0.9, [0.36, 0.72, 0.58], 'out'], [1.15, [0.38, 0.72, 0.45]], [1.5, null]] },
    cues: [[0.3, hand('R', 'middle')], [0.3, face({ lid: 0.42, brow: [-0.1, 0.12] })], [1.32, hand('R', 'mitten')]],
  }),
  /** Feral: both hands. */
  doubleMiddle: () => ({
    dur: 1.75, beat: 0.8, crude: true, min: 2, fallback: 'middle',
    tracks: { 'torso.r': [[0, z], [0.2, [5, 0, 0]], [0.4, [-6, 0, 0], 'back'], [1.3, [-6, 0, 0]], [1.75, z]], 'root.p': [[0, z], [0.4, [0, 0, 0.06]], [1.3, [0, 0, 0.06]], [1.75, z]] },
    ik: both([[0, null], [0.2, [0.2, -0.8, 0.25]], [0.4, [0.42, 0.7, 0.4], 'back'], [0.9, [0.42, 0.7, 0.4]], [1.0, [0.4, 0.7, 0.58], 'out'], [1.3, [0.42, 0.7, 0.42]], [1.7, null]]),
    cues: [[0.32, hand('L', 'middle')], [0.32, hand('R', 'middle')], [0.32, face({ lid: 0.42, brow: [-0.15, 0.15] })], [1.48, hand('L', 'mitten')], [1.48, hand('R', 'mitten')]],
  }),
  /** Feral: turn around, bend, a short side-to-side butt shake (no thrusting), deadpan look back. */
  twerk: () => ({
    dur: 2.7, beat: 1.0, crude: true, min: 2,
    tracks: {
      'root.r': [[0, z], [0.15, [0, -12, 0]], [0.45, [0, 168, 0], 'back'], [2.25, [0, 168, 0]], [2.6, z, 'io']],
      'torso.r': plus([[0.45, z], [0.62, [30, 0, 0]], [2.1, [30, 0, 0]], [2.3, z]], osc(2.5, [0, -8, 0], 0.62, 2.1, 0.1)),
      'hips.r': osc(2.5, [0, 13, 0], 0.62, 2.1, 0.1),
      'hips.p': osc(5, [0, 0.014, 0], 0.62, 2.1, 0.1),
      'head.r': [[0.45, z], [0.7, [-12, -38, 0]], [2.1, [-12, -38, 0]], [2.3, z]],
    },
    cues: [[0.5, face({ lid: 0.45 })], ...[0.62, 1.02, 1.42, 1.82].map((t): [number, ReturnType<typeof snd>] => [t, snd('boomTss')])],
  }),
  /** Nuclear: turn, bend, a plain cartoon bum (no detail), a small wiggle. */
  moon: () => ({
    dur: 2.4, beat: 1.1, crude: true, min: 3, fallback: 'twerk',
    tracks: {
      'root.r': [[0, z], [0.4, [0, 178, 0], 'back'], [1.95, [0, 178, 0]], [2.35, z]],
      'torso.r': [[0.4, z], [0.65, [42, 0, 0], 'back'], [1.75, [42, 0, 0]], [1.95, z]],
      'hips.r': osc(2, [0, 5, 0], 0.75, 1.7, 0.1),
    },
    cues: [[0.6, show('bum')], [1.8, hide('bum')], [0.65, snd('pop')], [0.66, face({ lid: 0.45 })]],
  }),
  /** Feral: red face, steam from the ears, shaking. */
  steam: (k) => ({
    dur: 1.9, beat: 0.7, cool: true, min: 2,
    tracks: { 'root.p': osc(16, [0.008, 0, 0], 0.2, 1.6), 'torso.r': hold([-4, 0, 0], 0.1, 1.5), 'head.r': osc(9, [0, 0, 2], 0.2, 1.6) },
    cues: [
      [0.15, expr('furious')], [0.15, show('redFace')], [0.25, snd('hiss')],
      ...[0.25, 0.5, 0.75, 1.0, 1.25].map((t): [number, ReturnType<typeof fx>] => [t, fx((s, a) => {
        for (const x of [-1, 1]) FX.steam(s, a.world('head', [x * k.headR, 0.02, 0]));
      })]),
    ],
  }),
  /** Nuclear: screams at the camera. */
  scream: () => ({
    dur: 1.7, beat: 0.5, cool: true, min: 3,
    tracks: {
      'root.p': [[0, z], [0.2, [0, 0, -0.05]], [0.35, [0, 0, 0.35], 'back'], [1.3, [0, 0, 0.35]], [1.7, z]],
      'torso.r': [[0, z], [0.2, [-8, 0, 0]], [0.35, [12, 0, 0], 'back'], [1.3, [12, 0, 0]], [1.7, z]],
      'head.r': plus([[0, z], [0.35, [-12, 0, 0]], [1.3, [-12, 0, 0]], [1.7, z]], osc(9, [0, 7, 0], 0.4, 1.3)),
      'root.sq': one([0.2, 0.9], [0.35, 1.1, 'back'], [1.3, 1.08], [1.7, 1]),
    },
    cues: [
      [0.3, face({ brow: [-0.4, 0.6], lid: 1.1, open: 1.5, teeth: 1, mouthW: 1.5, pupil: 0.5 })], [0.33, snd('scream')], [0.35, call(() => shake(0.07, 0.8))],
      ...[0.4, 0.7, 1.0].map((t): [number, ReturnType<typeof fx>] => [t, fx((s, a) => FX.speed(s, a.world('head'), 8, 0.4))]),
    ],
  }),
  /** Accused (anyone without a signature version): nervous, sweating. */
  accused: (k) => SHARED.nervous(k),
  /** Guilty (anyone without a signature version): faints and stays down. */
  guilty: (k) => SHARED.faint(k),
  /** What-if, at risk: sweats and glances around. */
  nervous: () => ({
    dur: 1.8, beat: 0.6,
    tracks: { 'root.p': osc(14, [0.006, 0, 0], 0.1, 1.7), 'head.r': [[0, z], [0.3, [0, -14, 0]], [0.7, [0, 14, 0]], [1.1, [0, -8, 0]], [1.6, z]] },
    cues: [[0, expr('nervous')], [0.3, face({ look: [-0.4, 0] })], [0.7, face({ look: [0.4, 0] })], [1.1, face({ look: [0, -0.1] })], ...[0.1, 0.7, 1.3].map((t): [number, ReturnType<typeof fx>] => [t, fx((s, a) => FX.sweat(s, headTop(a)))]), [0.2, snd('drip', 0.6)]],
  }),
  /** What-if, relieved: the shoulders drop and a little hop. */
  hop: () => ({
    dur: 1.2, beat: 0.45,
    tracks: {
      'root.p': [[0, z], [0.25, z], [0.47, [0, 0.22, 0], 'out'], [0.67, z, 'in']],
      'root.sq': one([0.25, 0.8, 'io'], [0.33, 1.15, 'out'], [0.6, 1.04], [0.67, 0.86, 'out'], [0.85, 1.03], [1.05, 1]),
      'armL.p': [[0, z], [0.2, [0, -0.03, 0]], [0.6, z]], 'armR.p': [[0, z], [0.2, [0, -0.03, 0]], [0.6, z]],
    },
    cues: [[0, face({ lid: 0.4, brow: [0.2, -0.2] })], [0.05, snd('sigh', 0.5)], [0.3, snd('pop')], [0.67, snd('thud', 0.5)]],
  }),
  horrified: () => ({
    dur: 0.9, beat: 0.35,
    tracks: { 'root.p': [[0, z], [0.15, [0, 0.06, -0.06], 'out'], [0.9, [0, 0, -0.03]]], 'root.sq': one([0.12, 1.18, 'out'], [0.4, 1.02], [0.9, 1]), 'torso.r': [[0, z], [0.15, [-10, 0, 0]], [0.9, [-4, 0, 0]]] },
    ik: both([[0, null], [0.18, [0.4, 0.15, 0.6], 'back'], [0.9, [0.4, 0.1, 0.6]]]),
    cues: [[0, expr('horrified')], [0.1, hand('L', 'palm')], [0.1, hand('R', 'palm')], [0.05, snd('whoosh', 0.6)]],
  }),
  /** What-if, breaks: horrified, then out cold (held). */
  breaks: (k) => {
    const h = SHARED.horrified(k), f = SHARED.faint(k);
    const later = <T,>(list: [number, T][], dt: number) => list.map(([t, v]): [number, T] => [t + dt, v]);
    return {
      dur: 2.2, beat: 0.35, hold: true,
      tracks: { 'root.p': [[0, z], [0.15, [0, 0.06, -0.06], 'out'], [0.9, [0, 0, -0.03]], [1.2, [0, 0, -0.03]], [1.95, [k.H * 0.4, 0.16, -0.03], 'in']], 'root.sq': one([0.12, 1.18, 'out'], [0.4, 1.02], [0.9, 1], [1.95, 1], [2.02, 0.9, 'out'], [2.2, 1]), 'root.r': [[0, z], [1.2, [0, 0, -5]], [1.95, [0, 0, 86], 'in'], [2.08, [0, 0, 80], 'out'], [2.2, [0, 0, 84]]] },
      ik: h.ik,
      cues: [...h.cues!, [0.95, hand('L', 'mitten')], [0.95, hand('R', 'mitten')], ...later(f.cues!.filter(([t]) => t >= 1.05), 0.9)],
    };
  },
  /** Undo: an eye-roll and a groan. */
  groan: () => ({
    dur: 1.6, beat: 0.6,
    tracks: {
      'head.r': [[0, z], [0.4, [-14, 0, 6]], [0.9, [-10, 0, -4]], [1.25, [8, 0, 0]], [1.6, z]],
      'torso.r': [[0, z], [0.9, [-4, 0, 0]], [1.25, [8, 0, 0]], [1.6, z]],
      'armL.p': [[0.9, z], [1.25, [0, -0.03, 0]], [1.6, z]], 'armR.p': [[0.9, z], [1.25, [0, -0.03, 0]], [1.6, z]],
    },
    cues: [[0, face({ look: [-0.35, 0.3], lid: 0.55 })], [0.3, face({ look: [0, 0.42] })], [0.6, face({ look: [0.35, 0.3] })], [0.9, face({ look: [0.2, -0.1], lid: 0.4 })], [0.35, snd('groan')]],
  }),
  happy: () => ({
    dur: 1.2, beat: 0.45,
    tracks: { 'root.p': [[0, z], [0.2, z], [0.4, [0, 0.12, 0], 'out'], [0.6, z, 'in']], 'root.sq': one([0.2, 0.88], [0.3, 1.08, 'out'], [0.6, 0.92, 'out'], [0.8, 1]), 'head.r': [[0.6, z], [0.8, [8, 0, 0]], [1.1, z]] },
    cues: [[0.1, expr('smug')], [0.3, snd('pop', 0.6)]],
  }),
  /** Generic float: a bob, legs dangling. */
  floats: () => ({
    dur: 1.2, loop: true,
    tracks: { 'root.p': osc(1 / 1.2, [0, 0.03, 0], 0, 1e9, 0), 'kneeL.r': [[0, [18, 0, 0]]], 'kneeR.r': [[0, [14, 0, 0]]], 'footL.r': [[0, [25, 0, 0]]], 'footR.r': [[0, [22, 0, 0]]] },
  }),
  /** Generic bonk: wind up, swing, follow through. */
  bonks: () => ({
    dur: 1.2, beat: 0.45,
    tracks: { 'torso.r': [[0, z], [0.35, [-8, -25, 0]], [0.55, [12, 20, 0], 'out'], [0.85, [12, 20, 0]], [1.2, z]] },
    ik: { R: [[0, null], [0.35, [0.3, 0.6, -0.2]], [0.55, [0.1, 0.1, 1.0], 'out'], [0.85, [0.1, 0.1, 0.95]], [1.15, null]] },
    cues: [[0.3, hand('R', 'fist')], [0.55, emit('hit')], [0.55, snd('bonk')], [1.0, hand('R', 'mitten')]],
  }),

  // ---------- the Tribunal's culprit fates ----------
  /** Unhinged: the BANG flag scares it into a faint anyway (held). */
  bangFaint: (k) => ({
    dur: 1.9, beat: 0.3, hold: true,
    tracks: {
      'root.p': [[0, z], [0.1, [0, 0.12, 0], 'out'], [0.3, z, 'in'], [0.9, z], [1.6, [k.H * 0.4, 0.16, 0], 'in']],
      'root.sq': one([0.1, 1.2, 'out'], [0.3, 0.9], [0.45, 1]),
      'root.r': [[0, z], [0.9, [0, 0, -5]], [1.6, [0, 0, 86], 'in'], [1.75, [0, 0, 80], 'out'], [1.9, [0, 0, 84]]],
    },
    cues: [[0, expr('horrified')], [0.9, face({ lid: 0.3, look: [0, 0.45] })], [1.6, expr('dead')], [1.6, snd('thud')]],
  }),
  /** Feral: soot-blasted. Black face, singed hair, coughs a smoke ring, topples (held). */
  sooted: () => ({
    dur: 2.6, beat: 0.45, hold: true,
    tracks: {
      'root.p': [[0, z], [0.08, [0, 0, -0.08], 'out'], [0.4, z], [2.35, [0, 0.12, 0]]],
      'root.sq': one([0.08, 0.85, 'out'], [0.3, 1]),
      'head.r': [[0.9, z], [1.0, [14, 0, 0], 'out'], [1.15, z], [1.3, [12, 0, 0], 'out'], [1.45, z]],
      'root.r': [[0, z], [1.8, [-4, 0, 0]], [2.35, [-84, 0, 0], 'in'], [2.5, [-78, 0, 0], 'out'], [2.6, [-82, 0, 0]]],
    },
    cues: [
      [0, show('soot', 12)], [0, face({ lid: 0.3, brow: [-0.1, 0], look: [0, 0] })], [0.05, fx((s, a) => FX.smoke(s, a.world('head'), 10, 0.1, ['#5a524a', '#3d3833', '#6e655c']))],
      [1.0, snd('cough')], [1.0, fx((s, a) => FX.smokeRing(s, a.world('mouth'), [0, 0.1, 1]))], [1.3, fx((s, a) => FX.smoke(s, a.world('mouth'), 3, 0.05))],
      [2.35, snd('thud')], [2.35, expr('dead')],
    ],
  }),
  /** Nuclear: blasted off-screen with a slide whistle, falls back in bandages. */
  blasted: (k) => ({
    dur: 3.3, beat: 0.2,
    tracks: {
      'root.p': [[0, z], [0.08, [0, 0, -0.05]], [0.7, [2.6, 7, -2], 'out'], [1.6, [2.6, 7, -2]], [1.6001, [0, 7, 0], 'snap'], [2.2, z, 'in']],
      'root.r': [[0, z], [0.7, [0, 0, -540], 'out'], [1.6, [0, 0, -540]], [1.6001, z, 'snap'], [2.2, [0, 0, 20], 'in'], [2.5, z]],
      'root.sq': one([0.08, 0.8], [0.15, 1.2], [0.4, 1], [2.2, 1], [2.25, 0.62, 'out'], [2.5, 1.08], [2.75, 1]),
    },
    cues: [
      [0, expr('horrified')], [0.05, snd('slideUp')], [1.45, snd('slideDown')], [2.2, snd('thud')], [2.2, show('bandage', 14)], [2.2, call(() => shake(0.06, 0.3))],
      [2.2, fx((s, a) => FX.dust(s, a.world('root'), 16))], [2.25, fx((s, a) => FX.stars(s, a.part('head')!, 2.4, Math.max(0.18, k.headR * 1.1)))], [2.2, face({ kind: 'spiral', lid: 0.6 })],
    ],
  }),
  /** Nuclear, alternate: bursts into smoke and pops back together (sooty). */
  explode: () => ({
    dur: 2.4, beat: 0.25,
    tracks: { 'root.s': one([0.25, [1.25, 1.25, 1.25], 'in'], [0.3, [0.001, 0.001, 0.001], 'snap'], [1.2, [0.001, 0.001, 0.001]], [1.45, [1.18, 1.18, 1.18], 'back'], [1.7, [1, 1, 1]]) },
    cues: [
      [0, expr('horrified')], [0.3, snd('cannon')], [0.3, call(() => shake(0.08, 0.5))],
      [0.3, fx((s, a) => FX.smoke(s, a.world('torso', [0, 0.4, 0]), 26, 0.22, ['#5a524a', '#8a8178', '#3d3833', '#b5aea4']))],
      [1.2, snd('pop')], [1.2, fx((s, a) => FX.smoke(s, a.world('torso', [0, 0.4, 0]), 8, 0.12))], [1.2, show('soot', 10)], [1.45, face({ lid: 0.3, kind: 'dot' })],
    ],
  }),
};

// ---------- lookup ----------
/** Alternate props share one name in clips (the Doorman's watch or hourglass is "timer"). */
export const ALIASES: Partial<Record<Archetype, Record<string, string[]>>> = {
  bouncer: { board: ['clipboard', 'ropePost'] },
  accountant: { gadget: ['calculator', 'abacus'] },
  clerk: { paperwork: ['inTray', 'ticketDispenser'] },
  doorman: { timer: ['pocketWatch', 'hourglass'] },
  hoarder: { pack: ['backpack', 'boxTower'] },
  inspector: { lens: ['magnifier', 'tapeMeasure'] },
  junkDrawer: { handle: ['barHandle', 'bowHandle'] },
  plumber: { tool: ['wrench', 'plunger'] },
  star: { held: ['handMirror', 'bouquet'] },
  librarian: { glasses: ['readingGlasses', 'serviceBell'] },
};

/** Every clip name the board offers, in order. */
export const GAG_NAMES = ['idle', 'accused', 'guilty', 'happy', 'points', 'floats', 'bonks', 'middle', 'twerk'] as const;
export const SHARED_NAMES = ['glare', 'sigh', 'shrug', 'nervous', 'hop', 'horrified', 'breaks', 'groan', 'mortified', 'laugh', 'pointLaugh', 'slowClap', 'fart', 'doubleMiddle', 'steam', 'moon', 'scream', 'softBonked', 'bonked', 'knocked', 'faint', 'duck', 'bangFaint', 'sooted', 'blasted', 'explode', 'dangle', 'wave', 'dizzy', 'sulk'] as const;

export function clipFor(arch: Archetype, name: string): ClipFn | undefined {
  return GAGS[arch]?.[name] ?? SHARED[name];
}
/**
 * Names that depend on who and how spicy: the Landlord only gives in to a twerk at nuclear; the Judge never
 * twerks (or moons) at any level, it bangs its head instead.
 */
export function resolveName(arch: Archetype, name: string) {
  if (arch === 'landlord' && name === 'twerk') return spice() >= 3 ? 'twerkNuke' : 'twerkRefuse';
  if (arch === 'judge' && (name === 'twerk' || name === 'moon')) return 'order';
  return name;
}
