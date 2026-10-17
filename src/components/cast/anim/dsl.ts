// The clip DSL: keyframes (with easing) or functions of time per channel, IK and hand-aim keys, and timed
// cues; compiled into additive THREE.AnimationClips sampled at 60 fps, plus a still pose for reduced motion.
// Channels are '<part>.<p|r|s|sq>': p = position offset (metres, parent space), r = rotation (degrees, Euler
// YXZ, in the part's own frame), s = scale multiplier, sq = volume-keeping squash (1 = rest).
import * as THREE from 'three';
import type { Archetype } from '@/lib/cast';
import { JOINTS, type Expression, type Face, type HandPose } from '../rig';
import type { Actor, Running } from './actor';
import type { FxSystem } from './fx';
import type { Sfx } from './sound';

export type V3 = [number, number, number];
export type Ease = 'lin' | 'in' | 'out' | 'io' | 'back' | 'el' | 'step' | 'snap';
export type Key = [t: number, v: number | V3, e?: Ease];
export type Track = Key[] | ((t: number) => number | V3);
/** IK target: arm space (x outward, y up, z forward, in arm lengths from the shoulder) or { r } in character space. */
export type Target = V3 | { r: V3 };
export type IKKey = [t: number, target: Target | null, e?: Ease];
export type Cue = (a: Actor, r: Running) => void;

export type ClipDef = {
  dur: number;
  /** The frozen beat: with reduced motion this pose is shown as a quick static pose. */
  beat?: number;
  loop?: boolean;
  /** Vulgar: only one on screen at a time, 30 s cooldown per character. */
  crude?: boolean;
  /** 30 s cooldown per character (crude gags always have one). */
  cool?: boolean;
  /** Lowest spice rank that allows it (0 clean .. 3 nuclear); below it `fallback` plays instead. */
  min?: number;
  fallback?: string;
  /** Keep the last pose until released (guilty, fainted, ducking). */
  hold?: boolean;
  tracks?: Record<string, Track>;
  ik?: { L?: IKKey[]; R?: IKKey[] };
  /** Point the hand's fingers along a character-space direction (rotates at the wrist). */
  aim?: { L?: IKKey[]; R?: IKKey[] };
  cues?: [number, Cue][];
};
export type ClipFn = (k: Dims) => ClipDef;

/** Rest-pose measurements of one character, so clips fit every body and every stat-driven size. */
export type Dims = {
  arch: Archetype;
  variant: number;
  /** Character-space rest position of a part (joint, prop or alias, toggle). */
  at: (name: string) => V3;
  /** Offset for part.p that moves the part to a character-space point. */
  to: (name: string, p: V3) => V3;
  /** Character space to the torso's rest frame (IK targets live there). */
  torso: (p: V3) => V3;
  torsoDir: (d: V3) => V3;
  arm: Record<'L' | 'R', { len: number; S: V3 }>;
  /** Top of the head (hats included), head centre, hip height, the back of the body at hip height. */
  H: number;
  head: V3;
  hip: number;
  back: V3;
  /** Books in the Librarian's stack (0 for everyone else). */
  books: number;
  /** Head radius (centre to the top of the head shell). */
  headR: number;
  /** Character-space rest position of a point given in a part's own frame. */
  pt: (name: string, local: V3) => V3;
  /** Rotation for part.r (degrees) that turns the part's local +y toward a character-space direction. */
  turn: (name: string, dir: V3) => V3;
  /** A part's userData (the Plumber's leak points). */
  ud: (name: string) => Record<string, unknown>;
  has: (name: string) => boolean;
};

export type ClipInfo = { name: string; def: ClipDef; clip: THREE.AnimationClip; still: THREE.AnimationClip; beat: number };

// ---------- easing and sampling ----------
const EASE: Record<Ease, (x: number) => number> = {
  lin: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - (1 - x) ** 3,
  io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  /** Overshoot, then settle. */
  back: (x) => 1 + 3.2 * (x - 1) ** 3 + 2.2 * (x - 1) ** 2,
  el: (x) => (x <= 0 || x >= 1 ? x : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  /** Hold the previous value, jump at the key. */
  step: (x) => (x < 1 ? 0 : 1),
  /** Jump right after the previous key. */
  snap: (x) => (x > 0 ? 1 : 0),
};
const mix = (a: number | V3, b: number | V3, u: number): number | V3 =>
  typeof a === 'number' ? a + ((b as number) - a) * u : [a[0] + ((b as V3)[0] - a[0]) * u, a[1] + ((b as V3)[1] - a[1]) * u, a[2] + ((b as V3)[2] - a[2]) * u];
export function sample(tr: Track, t: number): number | V3 {
  if (typeof tr === 'function') return tr(t);
  if (t <= tr[0][0]) return tr[0][1];
  for (let i = 1; i < tr.length; i++) {
    const [t1, v1, e = 'io'] = tr[i];
    if (t <= t1) {
      const [t0, v0] = tr[i - 1];
      return mix(v0, v1, EASE[e](t1 > t0 ? (t - t0) / (t1 - t0) : 1));
    }
  }
  return tr[tr.length - 1][1];
}
const v3 = (x: number | V3): V3 => (typeof x === 'number' ? [x, x, x] : x);

// ---------- authoring helpers ----------
/** Sine wobble of `amp` at `f` Hz between t0 and t1, faded in and out. */
export const osc = (f: number, amp: number | V3, t0 = 0, t1 = 1e9, fade = 0.12, phase = 0) => (t: number): number | V3 => {
  const env = fade > 0 ? Math.max(0, Math.min(1, (t - t0) / fade, (t1 - t) / fade)) : t >= t0 && t <= t1 ? 1 : 0;
  const s = Math.sin((t - t0) * f * Math.PI * 2 + phase) * env;
  return typeof amp === 'number' ? amp * s : [amp[0] * s, amp[1] * s, amp[2] * s];
};
/** Sum of tracks (keys and wobbles on one channel). */
export const plus = (...tracks: Track[]) => (t: number): number | V3 => {
  const vals = tracks.map((tr) => sample(tr, t));
  if (vals.every((x) => typeof x === 'number')) return (vals as number[]).reduce((a, b) => a + b, 0);
  return vals.map(v3).reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0] as V3);
};
/** Quick bumps of `amp` at the given times (stamps, taps, knocks): up in `up` s, back in `down` s. */
export const bumps = (times: number[], amp: number | V3, up = 0.08, down = 0.14) => (t: number): number | V3 => {
  let k = 0;
  for (const c of times) {
    if (t >= c - up && t < c) k = Math.max(k, EASE.out((t - (c - up)) / up));
    else if (t >= c && t < c + down) k = Math.max(k, 1 - EASE.io((t - c) / down));
  }
  return typeof amp === 'number' ? amp * k : [amp[0] * k, amp[1] * k, amp[2] * k];
};
/** rest → pose (in `a` s) → hold → rest (in `b` s) between t0 and t1. `base` is the rest value (1 for scales). */
export const hold = (pose: number | V3, t0: number, t1: number, a = 0.18, b = 0.25, e: Ease = 'back', base = 0): Key[] => {
  const zero = typeof pose === 'number' ? base : ([base, base, base] as V3);
  return [[t0, zero], [t0 + a, pose, e], [t1, pose], [t1 + b, zero, 'io']];
};
/** Scale or squash track that rests at 1. */
export const one = (...k: Key[]): Key[] => [[0, typeof k[0][1] === 'number' ? 1 : [1, 1, 1]], ...k];

// ---------- compile ----------
const FPS = 60;
const JOINT_SET = new Set<string>(JOINTS);
const SPECIAL = new Set(['face', 'ikL', 'ikR', 'aimL', 'aimR']);
/** Every toggled part, so channel names can say "bump.p" instead of "tog_bump.p". */
export const TOGGLE_NAMES = new Set([
  'bump', 'plaster', 'bandage', 'soot', 'redFace', 'ink', 'bum', 'spool', 'mummy', 'tornStrip', 'ticket', 'paperPile', 'pile', 'heldCone', 'heldLamp',
  'newItem', 'fallingDuck', 'tick', 'headLens', 'thrownKey', 'spring', 'patch', 'popHand', 'popHandL', 'heavyBook', 'flyBookmark', 'money',
  'toyGun', 'bangFlag', 'crack1', 'crack2', 'crack3',
]);
export const nodeName = (n: string) => (JOINT_SET.has(n) || SPECIAL.has(n) || /^hand[LR]_/.test(n) ? n : TOGGLE_NAMES.has(n) ? `tog_${n}` : `prop_${n}`);

const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const D2R = Math.PI / 180;

/** Compile a clip for one character: keyframes become additive position/quaternion/scale tracks on proxies. */
export function compile(name: string, def: ClipDef, k: Dims): ClipInfo {
  const n = Math.max(2, Math.ceil(def.dur * FPS) + 1);
  const times = Array.from({ length: n }, (_, i) => Math.min(def.dur, i / FPS));
  const tracks: THREE.KeyframeTrack[] = [];
  const nodes = new Map<string, Partial<Record<'p' | 'r' | 's' | 'sq', Track>>>();
  for (const [ch, tr] of Object.entries(def.tracks ?? {})) {
    const i = ch.lastIndexOf('.'), part = ch.slice(0, i), kind = ch.slice(i + 1) as 'p' | 'r' | 's' | 'sq';
    if (!k.has(part)) continue; // a part this variant doesn't have
    const node = nodeName(part);
    nodes.set(node, { ...nodes.get(node), [kind]: tr });
  }
  for (const [node, ch] of nodes) {
    if (ch.p) tracks.push(new THREE.VectorKeyframeTrack(`${node}.position`, times, times.flatMap((t) => v3(sample(ch.p!, t)))));
    if (ch.r)
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, times.flatMap((t) => {
        const [x, y, z] = v3(sample(ch.r!, t));
        return _q.setFromEuler(_e.set(x * D2R, y * D2R, z * D2R, 'YXZ')).toArray();
      })));
    if (ch.s || ch.sq)
      tracks.push(new THREE.VectorKeyframeTrack(`${node}.scale`, times, times.flatMap((t) => {
        const m = ch.s ? v3(sample(ch.s, t)) : [1, 1, 1];
        const q = ch.sq ? (sample(ch.sq, t) as number) : 1;
        const side = 1 / Math.sqrt(Math.max(q, 0.05));
        return [m[0] * side - 1, m[1] * q - 1, m[2] * side - 1];
      })));
  }
  // IK and hand aim: torso-space target (or direction) premultiplied by weight in .position, weight in .scale.x.
  for (const kind of ['ik', 'aim'] as const) {
    for (const s of ['L', 'R'] as const) {
      const keys = def[kind]?.[s];
      if (!keys?.length || !k.arm[s].len) continue;
      const pts = keys.map(([, tg]) => (tg ? (kind === 'ik' ? ikPoint(k, s, tg) : k.torsoDir(Array.isArray(tg) ? tg : tg.r)) : null));
      const filled = pts.map((p, i) => p ?? pts.slice(i).find(Boolean) ?? [...pts.slice(0, i)].reverse().find(Boolean) ?? ([0, -1, 0] as V3));
      const wt: Key[] = keys.map(([t, tg, e], i) => [t, tg ? 1 : 0, i ? e : undefined]);
      const tp: Key[] = keys.map(([t, , e], i) => [t, filled[i]!, i ? e : undefined]);
      const pos: number[] = [], sc: number[] = [];
      for (const t of times) {
        const w = Math.max(0, Math.min(1.2, sample(wt, t) as number));
        let p = v3(sample(tp, t));
        if (kind === 'aim') {
          const l = Math.hypot(...p) || 1;
          p = [p[0] / l, p[1] / l, p[2] / l];
        }
        pos.push(p[0] * w, p[1] * w, p[2] * w);
        sc.push(w, 0, 0);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${kind}${s}.position`, times, pos), new THREE.VectorKeyframeTrack(`${kind}${s}.scale`, times, sc));
    }
  }
  const clip = new THREE.AnimationClip(name, def.dur, tracks, THREE.AdditiveAnimationBlendMode);
  clip.optimize();
  // The still pose: every track's value at the beat, held for a second.
  const beat = def.beat ?? def.dur * 0.45;
  const still = new THREE.AnimationClip(`${name}:still`, 1, clip.tracks.map((tr) => {
    const I = tr instanceof THREE.QuaternionKeyframeTrack ? THREE.QuaternionLinearInterpolant : THREE.LinearInterpolant;
    const v = Array.from(new I(tr.times, tr.values, tr.getValueSize(), new Float32Array(tr.getValueSize())).evaluate(beat));
    const T = tr.constructor as new (n: string, t: number[], v: number[]) => THREE.KeyframeTrack;
    return new T(tr.name, [0, 1], [...v, ...v]);
  }), THREE.AdditiveAnimationBlendMode);
  return { name, def, clip, still, beat };
}
function ikPoint(k: Dims, s: 'L' | 'R', tg: Target): V3 {
  if (!Array.isArray(tg)) return k.torso(tg.r);
  const { len, S } = k.arm[s];
  return k.torso([S[0] + (s === 'L' ? tg[0] : -tg[0]) * len, S[1] + tg[1] * len, S[2] + tg[2] * len]);
}

// ---------- cues ----------
export const snd = (n: Sfx, vol = 1): Cue => Object.assign((a: Actor) => a.sound(n, 0, vol), { sound: true });
/** Show a toggled part for the rest of the clip, or for `secs` (outlives the clip). */
export const show = (t: string, secs?: number): Cue => (a, r) => (secs ? a.showFor(t, secs) : r.st.show.add(t));
export const hide = (t: string): Cue => (a, r) => {
  r.st.show.delete(t);
  a.showFor(t, 0);
};
/** Shrink a prop to nothing for the rest of the clip (or `secs`); works in lite too, where props are skinned. */
export const stash = (p: string, secs?: number): Cue => (a, r) => (secs ? a.stashFor(p, secs) : r.st.stash.add(p));
export const unstash = (p: string): Cue => (a, r) => {
  r.st.stash.delete(p);
  a.stashFor(p, 0);
};
export const hand = (s: 'L' | 'R', pose: HandPose): Cue => (_, r) => (r.st.hand[s] = pose);
export const expr = (e: Expression): Cue => (_, r) => (r.st.expr = e);
export const face = (f: Face): Cue => (_, r) => (r.st.face = { ...r.st.face, ...f });
export const fx = (fn: (s: FxSystem, a: Actor) => void): Cue => (a) => a.fx(fn);
/** A named moment the director can wait for ('hit', 'fire'...). */
export const emit = (ev: string): Cue => Object.assign((a: Actor) => a.emit(ev), { emits: true });
export const call = (fn: (a: Actor) => void): Cue => (a) => fn(a);
