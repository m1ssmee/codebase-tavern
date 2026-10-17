// Per-archetype gags (the approved designs) and each archetype's way of pointing at a line of code.
// Every gag: anticipation, action, a 300-500 ms frozen beat, payoff, recover; deadpan faces throughout.
import * as THREE from 'three';
import type { Archetype } from '@/lib/cast';
import type { HandPose } from '../rig';
import type { Actor } from './actor';
import { spice } from './core';
import { bumps, call, emit, expr, face, fx, hand, hide, hold, one, osc, plus, show, snd, stash, unstash, type ClipFn, type Cue, type Dims, type IKKey, type Key, type Track, type V3 } from './dsl';
import { FX, shake, type FxSystem } from './fx';

const z: V3 = [0, 0, 0];
const PI = Math.PI;
const both = (keys: IKKey[]) => ({ L: keys, R: keys });
/** Turn around (to `back` degrees) at t0, hold, turn back at t1. */
const turned = (t0: number, t1: number, back = 168, a = 0.35, b = 0.35): Key[] => [[0, z], [t0, z], [t0 + a, [0, back, 0], 'back'], [t1, [0, back, 0]], [t1 + b, z, 'io']];
const at = <T>(times: number[], make: (t: number, i: number) => T) => times.map((t, i): [number, T] => [t, make(t, i)]);
const range = (a: number, b: number, step: number) => Array.from({ length: Math.max(0, Math.floor((b - a) / step) + 1) }, (_, i) => a + i * step);
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const JUNK = ['#e5533c', '#c9a54a', '#232326', '#f4ecd8', '#7fb6e8', '#e8dfcc'];
const STUFF = ['#ff7a1a', '#f4c430', '#c69c6d', '#4b5560', '#7f8f6a', '#f4ecd8'];
/** Butt shake while turned around: hips swing side to side, the chest counter-swings. No thrusting. */
const shakeTracks = (t0: number, t1: number, bend = 28, f = 2.5): Record<string, Track> => ({
  'torso.r': plus([[t0 - 0.17, z], [t0, [bend, 0, 0]], [t1, [bend, 0, 0]], [t1 + 0.2, z]], osc(f, [0, -8, 0], t0, t1, 0.1)),
  'hips.r': osc(f, [0, 13, 0], t0, t1, 0.1),
  'hips.p': osc(f * 2, [0, 0.014, 0], t0, t1, 0.1),
});
const lookBack = (t0: number, t1: number): Key[] => [[t0 - 0.2, z], [t0 + 0.05, [-12, -36, 0]], [t1, [-12, -36, 0]], [t1 + 0.2, z]];
const beatSounds = (times: number[], vol = 1) => at(times, () => snd('boomTss', vol));

// ---------- the Inspector's neck: the tube stretches, the head rides along it ----------
const NECK = 0.48;
type NeckKey = [t: number, stretch: number, dir?: V3, e?: Key[2]];
function neckKeys(k: Dims, keys: NeckKey[]): Record<string, Track> {
  return {
    'neckTube.s': keys.map(([t, s, , e]): Key => [t, [1, s, 1], e]),
    'head.p': keys.map(([t, s, , e]): Key => [t, [0, (s - 1) * NECK, 0], e]),
    'neck.r': keys.map(([t, , d, e]): Key => [t, d ? k.turn('neck', d) : z, e]),
  };
}

// ---------- the Plumber's leaks (pipe space) ----------
const leaks = (k: Dims): V3[] => (k.ud('pipe').leaks as V3[] | undefined) ?? [[0.3, 0.5, 0.3], [-0.3, 0.3, 0.3], [0, 0.2, 0.4]];
/** Leak the left hand can reach first (left and front), then the others. */
function leakOrder(k: Dims) {
  const L = leaks(k).map((p) => ({ p, r: k.pt('pipe', p) }));
  return L.sort((a, b) => b.r[0] + b.r[2] - (a.r[0] + a.r[2]));
}
const outward = (r: V3): V3 => {
  const l = Math.hypot(r[0], r[2]) || 1;
  return [r[0] / l, 0, r[2] / l];
};
const sprayAt = (leak: V3, n = 2): Cue => fx((s: FxSystem, a: Actor) => {
  const p = a.world('pipe', leak), c = a.world('pipe', [0, leak[1], 0]);
  const d = p.clone().sub(c).normalize().multiplyScalar(1.6);
  FX.spray(s, p, [d.x, d.y + 0.6, d.z], n);
});

/** Throw at the bonk target (or straight ahead), then call back on arrival. */
const tossAt = (name: string, o: { dur: number; arc: number; spin: number }, onHit: (a: Actor) => void): Cue =>
  call((a) => void a.toss(name, a.target ?? a.ahead(), { from: a.world(name), ...o }).then(() => onHit(a)));

export const GAGS: Partial<Record<Archetype, Record<string, ClipFn>>> = {
  // ---------- 1. Bouncer: guards everything, held up by almost nothing ----------
  bouncer: {
    idle: () => ({
      dur: 2.3, beat: 0.75,
      tracks: {
        'torso.s': one(...[0.7, 1.5].flatMap((t): Key[] => [[t - 0.3, [1, 1, 1]], [t, [1.09, 1.04, 1.12], 'back'], [t + 0.35, [1, 1, 1]]])),
        'armL.p': bumps([0.7, 1.5], [0.015, 0.025, 0.02], 0.3, 0.35), 'armR.p': bumps([0.7, 1.5], [-0.015, 0.025, 0.02], 0.3, 0.35),
        'head.p': bumps([0.7, 1.5], [0, 0.02, 0], 0.3, 0.35),
        'kneeL.r': osc(10, [0, 0, 5], 0.45, 1.95, 0.15), 'kneeR.r': osc(10, [0, 0, -5], 0.45, 1.95, 0.15, 1.3),
        'hipL.r': osc(10, [3, 0, 0], 0.45, 1.95), 'hipR.r': osc(10, [-3, 0, 0], 0.45, 1.95, 0.12, 0.7),
      },
      cues: [[0.4, face({ browL: [0.35, 0], lid: 0.5 })]],
    }),
    /** Uncrosses its arms for the first time ever, a beat, then the legs buckle. */
    accused: () => ({
      dur: 2.7, beat: 1.0,
      tracks: {
        'hips.p': [[0, z], [1.0, z], [1.22, [0, -0.09, 0], 'out'], [2.2, [0, -0.09, 0]], [2.6, z]],
        'hipL.r': [[1.0, z], [1.22, [0, 0, 14], 'out'], [2.2, [0, 0, 14]], [2.6, z]],
        'hipR.r': [[1.0, z], [1.22, [0, 0, -14], 'out'], [2.2, [0, 0, -14]], [2.6, z]],
        'kneeL.r': plus([[1.0, z], [1.22, [0, 0, -30], 'out'], [2.2, [0, 0, -30]], [2.6, z]], osc(9, [0, 0, 5], 1.22, 2.2)),
        'kneeR.r': plus([[1.0, z], [1.22, [0, 0, 30], 'out'], [2.2, [0, 0, 30]], [2.6, z]], osc(9, [0, 0, -5], 1.22, 2.2, 0.12, 1)),
      },
      ik: both([[0, null], [0.15, null], [0.62, [0.12, -0.9, 0.15]], [2.2, [0.12, -0.9, 0.15]], [2.65, null]]),
      cues: [[0.62, face({ brow: [0.5, -0.4], lid: 1.0 })], [1.0, snd('boing')]],
    }),
    /** Topples stiff as a plank. */
    guilty: () => ({
      dur: 1.75, beat: 0.4, hold: true,
      tracks: {
        'root.r': [[0, z], [0.25, [0, 0, 5]], [0.45, [0, 0, 3]], [1.25, [0, 0, -88], 'in'], [1.38, [0, 0, -80], 'out'], [1.55, [0, 0, -88], 'in'], [1.75, [0, 0, -87]]],
        'root.p': [[0.45, z], [1.0, [0, 0.02, 0]], [1.25, [-0.35, 0.36, 0], 'in'], [1.38, [-0.35, 0.4, 0]], [1.55, [-0.35, 0.36, 0]]],
      },
      cues: [[0.45, face({ lid: 0.3 })], [1.25, snd('thud')], [1.25, fx((s, a) => FX.dust(s, a.world('root', [0, 0.9, 0])))], [1.55, snd('thud', 0.5)]],
    }),
    /** One stiff hop. */
    happy: () => ({ dur: 1.0, beat: 0.35, tracks: { 'root.p': [[0, z], [0.15, [0, -0.01, 0]], [0.35, [0, 0.2, 0], 'out'], [0.55, z, 'in']] }, cues: [[0.1, expr('smug')], [0.55, snd('thud')]] }),
    /** Stick legs kick frantically. */
    floats: () => ({
      dur: 0.5, loop: true,
      tracks: {
        'hipL.r': osc(4, [35, 0, 0], 0, 1e9, 0), 'hipR.r': osc(4, [-35, 0, 0], 0, 1e9, 0),
        'kneeL.r': plus([[0, [25, 0, 0]]], osc(4, [20, 0, 0], 0, 1e9, 0, 1.2)), 'kneeR.r': plus([[0, [25, 0, 0]]], osc(4, [-20, 0, 0], 0, 1e9, 0, 1.2)),
        'root.p': osc(2, [0, 0.025, 0], 0, 1e9, 0),
      },
    }),
    /** Chest bump (knocks the target over). */
    bonks: () => ({
      dur: 1.3, beat: 0.5,
      tracks: {
        'torso.r': [[0, z], [0.4, [-14, 0, 0]], [0.5, [-14, 0, 0]], [0.62, [10, 0, 0], 'out'], [0.9, [10, 0, 0]], [1.3, z]],
        'torso.p': [[0.5, z], [0.62, [0, 0.03, 0.14], 'out'], [0.9, [0, 0.03, 0.14]], [1.3, z]],
        'root.sq': one([0.4, 0.94], [0.62, 1.06, 'out'], [1.0, 1]),
      },
      cues: [[0.62, emit('hit')], [0.62, snd('bonk')], [0.4, face({ lid: 0.4 })]],
    }),
    /** Pops up out of its still-crossed arms. */
    middle: () => ({
      dur: 1.5, beat: 0.7, crude: true, min: 1,
      aim: { L: [[0, null], [0.25, null], [0.4, [0.1, 1, 0.3], 'back'], [1.1, [0.1, 1, 0.3]], [1.4, null]] },
      tracks: { 'torso.s': one([0.25, [1, 1, 1]], [0.4, [1.04, 1.02, 1.05], 'back'], [1.1, [1.04, 1.02, 1.05]], [1.4, [1, 1, 1]]), 'handL_middle.s': [[0, [1.35, 1.35, 1.35]]] },
      cues: [[0.32, hand('L', 'middle')], [1.25, hand('L', 'mitten')], [0.3, face({ lid: 0.45 })], [0.4, snd('pop', 0.7)]],
    }),
    /** The legs can't take it: the chest bounces instead, then the legs buckle. */
    twerk: () => ({
      dur: 2.9, beat: 1.4, crude: true, min: 2,
      tracks: {
        'root.r': turned(0.05, 2.4, 168),
        'torso.p': bumps([0.75, 1.05, 1.35, 1.65], [0, 0.06, 0], 0.08, 0.16),
        'torso.r': [[0.4, z], [0.55, [12, 0, 0]], [1.8, [12, 0, 0]], [2.1, z]],
        'hips.p': [[1.75, z], [1.9, [0, -0.12, 0], 'out'], [2.4, [0, -0.12, 0]], [2.7, z]],
        'hipL.r': [[1.75, z], [1.9, [0, 0, 16], 'out'], [2.4, [0, 0, 16]], [2.7, z]],
        'hipR.r': [[1.75, z], [1.9, [0, 0, -16], 'out'], [2.4, [0, 0, -16]], [2.7, z]],
        'kneeL.r': plus(osc(11, [0, 0, 8], 0.6, 1.75), [[1.75, z], [1.9, [0, 0, -34], 'out'], [2.4, [0, 0, -34]], [2.7, z]]),
        'kneeR.r': plus(osc(11, [0, 0, -8], 0.6, 1.75, 0.12, 1), [[1.75, z], [1.9, [0, 0, 34], 'out'], [2.4, [0, 0, 34]], [2.7, z]]),
      },
      cues: [...beatSounds([0.75, 1.05, 1.35, 1.65]), [1.9, snd('thud')], [0.5, face({ lid: 0.45 })], [1.9, face({ brow: [0.4, -0.3], lid: 0.9 })]],
    }),
  },

  // ---------- 2. Accountant: counts everything twice and still isn't sure ----------
  accountant: {
    /** Taps the calculator, eyes dart, the receipt prints a bit more. */
    idle: (k) => {
      const c = k.at('gadget'), tap = (dy: number) => ({ r: [c[0] - 0.02, c[1] + 0.035 + dy, c[2] + 0.01] as V3 });
      return {
        dur: 2.6, beat: 0.9,
        ik: { R: [[0, null], [0.3, tap(0.05)], ...[0.45, 0.65, 0.85, 1.05].flatMap((t): IKKey[] => [[t, tap(0), 'in'], [t + 0.1, tap(0.05), 'out']]), [1.6, tap(0.05)], [2.0, null]] },
        tracks: { 'receiptRoll.r': [[1.2, z], [2.0, [-540, 0, 0]]], 'receipt.p': [[1.2, z], [1.9, [0, 0, 0.06]], [2.5, z]], 'head.r': hold([10, 0, 0], 0.2, 1.6, 0.3, 0.4, 'io') },
        cues: [
          [0.4, face({ look: [-0.35, -0.3] })], [0.6, face({ look: [0.35, -0.3] })], [0.85, face({ look: [-0.2, -0.38] })], [1.05, face({ look: [0.3, -0.25] })], [1.5, face({ look: [0, -0.15] })],
          ...at([0.45, 0.65, 0.85, 1.05], () => snd('tick', 0.5)), [1.25, snd('tear', 0.4)],
        ],
      };
    },
    /** The receipt spools out wildly. */
    accused: () => ({
      dur: 2.2, beat: 0.8,
      tracks: {
        'spool.r': [[0, z], [2.0, [0, 900, 0], 'lin']], 'spool.s': one([0.1, [0.2, 0.2, 0.2], 'snap'], [0.7, [1, 1, 1], 'out'], [1.7, [1.1, 1.2, 1.1]], [2.0, [0.3, 0.3, 0.3], 'in']),
        'receiptRoll.r': [[0, z], [2.0, [-1800, 0, 0], 'lin']],
        'root.p': osc(15, [0.01, 0, 0], 0.1, 1.9), 'head.r': osc(6, [0, 10, 0], 0.2, 1.8),
      },
      cues: [[0.1, show('spool')], [2.0, hide('spool')], ...at([0.1, 0.6, 1.1], () => snd('tear')), [0.1, expr('nervous')]],
    }),
    /** Faints, and the receipt wraps it like a mummy. */
    guilty: (k) => ({
      dur: 2.4, beat: 0.5, hold: true,
      tracks: {
        'root.r': [[0, z], [0.35, [0, 0, -5]], [0.5, [0, 0, -3]], [1.05, [0, 0, 86], 'in'], [1.2, [0, 0, 80], 'out'], [1.35, [0, 0, 84]]],
        'root.p': [[0, z], [0.5, z], [1.05, [k.H * 0.4, 0.24, 0], 'in']],
        'mummy.s': one([1.4, [1, 0.01, 1], 'snap'], [2.2, [1, 1, 1], 'out']),
        'mummy.r': [[1.4, z], [2.2, [0, 720, 0], 'out']],
      },
      cues: [[0, face({ look: [0, 0.45], lid: 0.5 })], [1.05, expr('dead')], [1.05, snd('thud')], [1.4, show('mummy')], [1.4, snd('tear')], [1.8, snd('tear')]],
    }),
    /** Neatly tears off a receipt. */
    happy: (k) => {
      const r = k.at('receiptRoll'), roll = { r: [r[0] - 0.02, r[1] + 0.02, r[2] + 0.08] as V3 }, up = { r: [r[0] - 0.1, r[1] + 0.32, r[2] + 0.3] as V3 };
      return {
        dur: 2.2, beat: 1.1,
        ik: { R: [[0, null], [0.4, roll], [0.7, roll], [1.0, up, 'out'], [1.7, up], [2.1, null]] },
        tracks: { 'head.r': [[0.8, z], [1.1, [8, -12, 6]], [1.7, [8, -12, 6]], [2.1, z]] },
        cues: [[0.75, show('tornStrip')], [0.75, snd('tear')], [1.9, hide('tornStrip')], [1.0, expr('smug')], [1.0, face({ look: [-0.3, 0.1] })]],
      };
    },
    /** Hunched, the receipt trailing like a kite tail. */
    floats: () => ({
      dur: 1.2, loop: true,
      tracks: {
        'torso.r': [[0, [10, 0, 0]]], 'root.p': osc(1 / 1.2, [0, 0.03, 0], 0, 1e9, 0),
        'receipt.r': osc(1 / 0.6, [0, 6, 4], 0, 1e9, 0), 'receipt.p': [[0, [0, 0.05, -0.05]]], 'kneeL.r': [[0, [20, 0, 0]]], 'kneeR.r': [[0, [16, 0, 0]]],
      },
    }),
    /** Smacks with the calculator. */
    bonks: () => ({
      dur: 1.2, beat: 0.5,
      ik: { L: [[0, null], [0.35, [0.35, 0.55, -0.1]], [0.55, [-0.1, 0.25, 1.0], 'out'], [0.85, [-0.1, 0.2, 0.95]], [1.15, null]] },
      tracks: { 'torso.r': [[0, z], [0.35, [-6, 20, 0]], [0.55, [10, -18, 0], 'out'], [0.85, [10, -18, 0]], [1.2, z]] },
      cues: [[0.55, emit('hit')], [0.55, snd('bonk')], [0.6, snd('tick')]],
    }),
    /** Middle finger with the free hand, still typing on the calculator with the other, eyes on the numbers. */
    middle: () => {
      const taps = [0.3, 0.5, 0.7, 0.9, 1.1, 1.3];
      return {
        dur: 1.7, beat: 0.75, crude: true, min: 1,
        ik: { R: [[0, null], [0.2, [0.25, -0.6, 0.4]], [0.42, [0.45, 0.8, 0.3], 'back'], [1.25, [0.45, 0.8, 0.3]], [1.6, null]] },
        tracks: { 'handL.r': bumps(taps, [-25, 0, 0], 0.05, 0.08) },
        cues: [[0.34, hand('R', 'middle')], [1.4, hand('R', 'mitten')], [0.3, face({ lid: 0.85, look: [0, -0.35] })], ...at(taps, () => snd('tick', 0.5))],
      };
    },
    /** Perfectly metronomic, counting the beats on the calculator. */
    twerk: (k) => {
      const c = k.at('gadget'), tap = (dy: number) => ({ r: [c[0] - 0.02, c[1] + 0.035 + dy, c[2] + 0.01] as V3 });
      const beats = [0.6, 1.1, 1.6, 2.1];
      const hips: Key[] = [[0, z], [0.55, z]];
      beats.forEach((t, i) => hips.push([t - 0.04, hips[hips.length - 1][1]], [t, [0, i % 2 ? -12 : 12, 0], 'out']));
      hips.push([2.25, z]);
      return {
        dur: 2.9, beat: 1.1, crude: true, min: 2,
        tracks: { 'root.r': turned(0.05, 2.35, 168), 'torso.r': [[0.4, z], [0.55, [28, 0, 0]], [2.2, [28, 0, 0]], [2.4, z]], 'hips.r': hips, 'head.r': lookBack(0.5, 2.2) },
        ik: { R: [[0, null], [0.45, tap(0.05)], ...beats.flatMap((t): IKKey[] => [[t, tap(0), 'in'], [t + 0.1, tap(0.05), 'out']]), [2.3, null]] },
        cues: [...at(beats, () => snd('tick')), ...beatSounds(beats, 0.7), [0.5, face({ lid: 0.6, look: [0, -0.3] })]],
      };
    },
  },

  // ---------- 3. Clerk: one hand is a rubber stamp ----------
  clerk: {
    /** Stamps the air on schedule; a ticket falls off the tray and gets stamped on its way down. */
    idle: (k) => {
      const S = k.arm.R.S, up = { r: [S[0] - 0.02, S[1] - 0.18, S[2] + 0.36] as V3 }, down = { r: [S[0] - 0.02, S[1] - 0.36, S[2] + 0.36] as V3 };
      const t0 = k.at('ticket'), to = (p: V3) => k.to('ticket', p);
      const face0 = add(down.r, [0, -0.24, 0.02]);
      return {
        dur: 3.2, beat: 1.6,
        ik: { R: [[0, null], [0.3, up], [0.42, down, 'in'], [0.6, up, 'out'], [1.25, up], [1.6, down, 'in'], [1.85, up, 'out'], [2.6, up], [3.1, null]] },
        aim: { R: [[0, null], [0.3, [0, -1, 0.15]], [2.6, [0, -1, 0.15]], [3.1, null]] },
        tracks: {
          'ticket.p': [[0, z], [0.95, z], [1.1, to(add(t0, [0.05, -0.05, 0.12]))], [1.6, to(face0), 'in'], [1.75, to(add(face0, [0, -0.03, 0]))], [2.5, to([face0[0] + 0.15, 0.01, face0[2] + 0.12]), 'in']],
          'ticket.r': [[0.95, z], [1.6, [40, 120, 20]], [2.5, [80, 260, 0]]],
          'torso.r': bumps([0.42, 1.6], [3, 0, 0], 0.06, 0.2),
        },
        cues: [[0.42, snd('stamp', 0.7)], [0.95, call((a) => a.showFor('ticket', 2.2))], [1.6, snd('stamp')], [1.6, fx((s, a) => FX.ring(s, a.world('ticket'), [0, 1, 0.3], '#26357a', 0.03, 1.5))], [0.3, face({ lid: 0.3 })]],
      };
    },
    /** Stamps harder each time. */
    accused: (k) => {
      const S = k.arm.R.S, f = (d: number, lift = 0) => ({ r: [S[0] - 0.02, S[1] - 0.15 - d + lift, S[2] + 0.36] as V3 });
      const times = [0.4, 0.85, 1.25, 1.6], depth = [0.12, 0.17, 0.22, 0.28];
      return {
        dur: 2.3, beat: 1.6,
        ik: { R: [[0, null], [0.25, f(0)], ...times.flatMap((t, i): IKKey[] => [[t - 0.13, f(0, 0.06 * i), 'out'], [t, f(depth[i]), 'in']]), [1.9, f(0)], [2.3, null]] },
        aim: { R: [[0, null], [0.25, [0, -1, 0.15]], [1.9, [0, -1, 0.15]], [2.3, null]] },
        tracks: { 'root.sq': plus([[0, 1]], bumps(times, -0.06, 0.04, 0.15)), 'torso.r': bumps(times, [6, 0, 0], 0.05, 0.18) },
        cues: [[0, expr('nervous')], ...at(times, (_, i) => snd('stamp', 0.5 + 0.17 * i)), [1.6, call(() => shake(0.03, 0.2))]],
      };
    },
    /** The in-tray slides off and collapses into a pile of paper. */
    guilty: (k) => {
      const tray = k.at('paperwork'), land: V3 = [tray[0] + 0.6, 0.02, tray[2] + 0.22];
      return {
        dur: 2.0, beat: 1.1, hold: true,
        tracks: {
          'paperwork.p': [[0, z], [0.25, k.to('paperwork', add(tray, [0.06, 0.02, 0]))], [0.7, k.to('paperwork', add(tray, [0.45, -0.25, 0.1])), 'in'], [1.1, k.to('paperwork', [land[0], 0.06, land[2]]), 'in']],
          'paperwork.r': [[0, z], [0.25, [0, 0, -4]], [0.7, [0, 0, -30], 'in'], [1.1, [0, 0, -85], 'in']],
          'paperPile.p': [[0, k.to('paperPile', land)]],
          'paperPile.s': one([1.1, [0.3, 0.3, 0.3], 'snap'], [1.4, [1, 1, 1], 'back']),
          'head.r': [[0, z], [0.2, [-6, 0, 4]], [1.1, [10, 0, -12]], [1.6, [16, 0, -14]]],
          'torso.r': [[1.1, z], [1.6, [6, 0, 0]]],
        },
        cues: [[0.2, snd('whoosh', 0.6)], [1.1, snd('thud')], [1.1, stash('paperwork')], [1.1, show('paperPile')], [1.1, fx((s, a) => FX.paper(s, a.world('paperPile'), 12))], [0.3, face({ look: [0.4, 0.2], lid: 1.0 })], [1.3, face({ look: [0.4, -0.3], lid: 0.4 })]],
      };
    },
    /** One bored stamp of approval. */
    happy: (k) => {
      const S = k.arm.R.S, up = { r: [S[0] - 0.02, S[1] - 0.18, S[2] + 0.36] as V3 }, down = { r: [S[0] - 0.02, S[1] - 0.34, S[2] + 0.36] as V3 };
      return {
        dur: 1.6, beat: 0.75,
        ik: { R: [[0, null], [0.4, up], [0.75, down, 'in'], [1.05, up, 'out'], [1.5, null]] },
        aim: { R: [[0, null], [0.4, [0, -1, 0.15]], [1.05, [0, -1, 0.15]], [1.5, null]] },
        cues: [[0.75, snd('stamp')], [0.2, face({ lid: 0.28 })], [0.76, fx((s, a) => FX.ring(s, a.world('stamp', [0, -0.24, 0]), [0, 0.2, 1], '#26357a', 0.05, 1.2))]],
      };
    },
    /** Drifts side to side like a dropped sheet of paper. */
    floats: () => ({
      dur: 2.0, loop: true,
      tracks: { 'root.p': (t) => [0.22 * Math.sin(t * PI), -0.04 * Math.abs(Math.cos(t * PI)), 0], 'root.r': (t) => [0, 0, -14 * Math.cos(t * PI)], 'armL.p': [[0, [0.02, 0.02, 0]]], 'armR.p': [[0, [-0.02, 0.02, 0]]] },
    }),
    /** Stamps the target's forehead (the ink ring stays on it a while). */
    bonks: (k) => {
      const S = k.arm.R.S;
      return {
        dur: 1.25, beat: 0.5,
        ik: { R: [[0, null], [0.35, { r: [S[0], S[1] + 0.15, S[2] + 0.05] }], [0.55, [0.05, 0.25, 1.0], 'out'], [0.85, [0.05, 0.25, 0.95]], [1.2, null]] },
        aim: { R: [[0, null], [0.35, [0, 0.4, 1]], [0.85, [0, 0.1, 1]], [1.2, null]] },
        cues: [[0.55, emit('hit')], [0.55, snd('stamp')], [0.3, face({ lid: 0.3 })]],
      };
    },
    /** Dead-eyed and slow. */
    middle: () => ({
      dur: 2.6, beat: 1.3, crude: true, min: 1,
      ik: { L: [[0, null], [1.0, [0.2, 0.45, 0.7], 'io'], [1.9, [0.2, 0.45, 0.7]], [2.5, null, 'io']] },
      cues: [[0, face({ lid: 0.22, look: [0, 0] })], [0.75, hand('L', 'middle')], [2.25, hand('L', 'mitten')]],
    }),
    /** Slow, bored, half-lidded. */
    twerk: () => ({
      dur: 3.0, beat: 1.3, crude: true, min: 2,
      tracks: { 'root.r': turned(0.1, 2.55, 165, 0.6, 0.45), ...shakeTracks(0.85, 2.35, 22, 1), 'head.r': lookBack(0.9, 2.3) },
      cues: [[0.3, face({ lid: 0.18 })], ...beatSounds([0.85, 1.85], 0.6)],
    }),
  },

  // ---------- 4. Doorman: extremely important about timing, extremely small ----------
  doorman: {
    /** Checks the watch, taps a foot, the hat wobbles. */
    idle: () => ({
      dur: 2.4, beat: 0.9,
      tracks: { 'footL.r': bumps([0.6, 0.95, 1.3, 1.65], [-22, 0, 0], 0.08, 0.12), 'topHat.r': osc(2.4, [0, 0, 4], 0.4, 2.0, 0.2), 'head.r': hold([10, -8, 0], 0.2, 1.9, 0.3, 0.4, 'io'), 'timer.r': hold([-10, 0, 0], 0.2, 1.9) },
      ik: { R: [[0, null], [0.35, [0.25, 0.25, 0.7]], [1.9, [0.25, 0.25, 0.7]], [2.3, null]] },
      cues: [[0.3, face({ look: [-0.3, -0.35], lid: 0.4 })], ...at([0.6, 0.95, 1.3, 1.65], () => snd('tick', 0.5))],
    }),
    /** The pocket-watch alarm goes off. */
    accused: () => ({
      dur: 1.7, beat: 0.6,
      tracks: { 'timer.r': osc(24, [0, 0, 12], 0.15, 1.3, 0.05), 'timer.p': osc(30, [0.006, 0.006, 0], 0.15, 1.3, 0.05), 'root.p': osc(14, [0.004, 0, 0], 0.15, 1.3), 'topHat.r': osc(12, [0, 0, 3], 0.15, 1.3) },
      ik: { R: [[0, null], [0.15, [0.25, 0.3, 0.75], 'out'], [1.3, [0.25, 0.3, 0.75]], [1.65, null]] },
      cues: [[0.15, snd('ring')], [0.15, expr('nervous')], ...at([0.2, 0.6, 1.0], () => fx((s, a) => FX.speed(s, a.world('timer'), 8, 0.3)))],
    }),
    /** The hat drops over it; only the feet poke out. */
    guilty: (k) => {
      const hat = k.at('topHat');
      return {
        dur: 1.5, beat: 0.55, hold: true,
        tracks: {
          'topHat.p': [[0, z], [0.25, k.to('topHat', add(hat, [0, 0.12, 0]))], [0.55, k.to('topHat', add(hat, [0, 0.12, 0]))], [0.8, k.to('topHat', [0, 0.06, 0.02]), 'in'], [0.92, k.to('topHat', [0, 0.12, 0.02]), 'out'], [1.05, k.to('topHat', [0, 0.06, 0.02]), 'in']],
          'topHat.s': one([0.55, [1, 1, 1]], [0.8, [1.8, 1.0, 1.8], 'in']),
          'topHat.r': [[0.25, z], [0.8, k.turn('topHat', [0, 1, 0])]],
        },
        cues: [[0.8, snd('thud')], [0.8, stash('timer')], [0.8, fx((s, a) => FX.dust(s, a.world('root')))], [0.25, face({ look: [0, 0.5], lid: 1.0 })]],
      };
    },
    /** Tips the hat. It takes forever: the hat is huge. */
    happy: (k) => {
      const hat = k.at('topHat'), brim = { r: add(hat, [0.05, 0.02, 0.16]) };
      return {
        dur: 3.0, beat: 1.4,
        ik: { L: [[0, null], [0.6, brim, 'io'], [2.3, brim], [2.9, null, 'io']] },
        tracks: {
          'topHat.p': [[0.6, z], [1.4, k.to('topHat', add(hat, [0, 0.1, 0.04])), 'io'], [1.9, k.to('topHat', add(hat, [0, 0.1, 0.04]))], [2.4, z, 'io']],
          'topHat.r': [[0.6, z], [1.4, [18, 0, 0], 'io'], [1.9, [18, 0, 0]], [2.4, z, 'io']],
          'torso.r': osc(1.5, [0, 0, 3], 0.6, 2.4, 0.3), 'head.r': [[0.6, z], [1.4, [8, 0, 0]], [1.9, [8, 0, 0]], [2.4, z]],
        },
        cues: [[0.5, expr('smug')]],
      };
    },
    /** Dangles from its hat brim like a balloon. */
    floats: (k) => {
      const H = k.head[1] + 0.3;
      return {
        dur: 2.0, loop: true,
        tracks: {
          'root.r': (t) => [0, 0, 10 * Math.sin(t * PI)],
          'root.p': (t) => {
            const a = ((10 * Math.sin(t * PI)) * PI) / 180;
            return [H * Math.sin(a), H * (1 - Math.cos(a)), 0];
          },
          'topHat.r': (t) => [0, 0, -10 * Math.sin(t * PI)],
          'kneeL.r': [[0, [12, 0, 0]]], 'kneeR.r': [[0, [8, 0, 0]]], 'footL.r': [[0, [35, 0, 0]]], 'footR.r': [[0, [30, 0, 0]]],
        },
        ik: both([[0, [0.1, -0.95, 0.05]]]),
      };
    },
    /** Whacks with the watch on its chain, like a flail. */
    bonks: () => ({
      dur: 1.4, beat: 0.6,
      tracks: {
        'timer.p': (t) => {
          if (t < 0.1 || t > 1.2) return z;
          if (t < 0.6) {
            const a = (t - 0.1) * 40, r = 0.2 * Math.min(1, (t - 0.1) / 0.15);
            return [r * Math.cos(a), r * Math.sin(a), 0];
          }
          return [0, -0.25 * Math.min(1, (t - 0.6) / 0.08) * (t > 0.9 ? Math.max(0, 1 - (t - 0.9) / 0.3) : 1), 0];
        },
        'timer.r': [[0.1, z], [0.6, [0, 0, 720], 'lin'], [1.2, [0, 0, 720]], [1.4, [0, 0, 720]]],
      },
      ik: { R: [[0, null], [0.1, [0.3, 0.5, 0.4]], [0.55, [0.3, 0.55, 0.3]], [0.66, [0.05, 0.2, 1.0], 'out'], [0.95, [0.05, 0.2, 1.0]], [1.35, null]] },
      cues: [[0.15, snd('whoosh', 0.5)], [0.4, snd('whoosh', 0.5)], [0.66, emit('hit')], [0.66, snd('clang', 0.6)]],
    }),
    /** A white glove, pinky raised. Posh. */
    middle: () => ({
      dur: 1.8, beat: 0.8, crude: true, min: 1,
      ik: { L: [[0, null], [0.2, [0.2, -0.85, -0.3]], [0.45, [0.25, 0.55, 0.65], 'back'], [1.3, [0.25, 0.55, 0.65]], [1.75, null]] },
      tracks: { 'neck.r': hold([-8, 0, 0], 0.3, 1.3, 0.2, 0.4) },
      cues: [[0.38, hand('L', 'posh')], [1.5, hand('L', 'mitten')], [0.3, face({ lid: 0.35, brow: [0.3, -0.1] })]],
    }),
    /** Refuses, checks the watch, does exactly two seconds, stops. */
    twerk: () => ({
      dur: 4.0, beat: 2.0, crude: true, min: 2,
      tracks: {
        'head.r': [[0, z], [0.15, [0, 16, 0]], [0.3, [0, -16, 0]], [0.45, [0, 14, 0]], [0.6, z], [0.75, [12, -8, 0]], [1.05, [12, -8, 0]], [1.2, z], [1.45, [-8, -30, 0]], [3.3, [-8, -30, 0]], [3.5, [12, -8, 0]], [3.85, z]],
        'root.r': [[0, z], [1.1, z], [1.35, [0, 168, 0], 'back'], [3.4, [0, 168, 0]], [3.55, z, 'out']],
        'torso.r': [[1.25, z], [1.4, [24, 0, 0]], [3.4, [24, 0, 0]], [3.45, z, 'out']],
        'hips.r': osc(3, [0, 14, 0], 1.4, 3.4, 0.04),
      },
      ik: { R: [[0, null], [0.7, [0.25, 0.3, 0.72]], [1.1, [0.25, 0.3, 0.72]], [1.3, null], [3.45, null], [3.6, [0.25, 0.3, 0.72]], [3.9, [0.25, 0.3, 0.72]], [4.0, null]] },
      cues: [[0, face({ lid: 0.35 })], [0.8, snd('tick')], ...beatSounds([1.4, 1.9, 2.4, 2.9]), [3.4, snd('tick')], [3.65, snd('tick')]],
    }),
  },

  // ---------- 5. Hoarder: kept everything, just in case ----------
  hoarder: {
    /** The duck falls out, bounces off its head into its hands, and gets stuffed back. */
    idle: (k) => {
      const top: V3 = [k.head[0] + 0.03, k.head[1] + k.headR + 0.07, k.head[2]];
      const h = k.at('handR'), catchP: V3 = [0, h[1] + 0.12, h[2] + 0.08], over: V3 = [0, k.H + 0.4, k.head[2] - 0.15];
      const to = (p: V3) => k.to('fallingDuck', p);
      return {
        dur: 2.7, beat: 1.1,
        tracks: {
          'fallingDuck.p': [[0, z], [0.45, to(top), 'in'], [0.8, to(catchP), 'out'], [1.5, to(catchP)], [1.8, to(over), 'out'], [2.05, z, 'in']],
          'fallingDuck.r': [[0, z], [0.45, [0, 0, 40]], [0.8, z], [1.5, z], [2.05, [0, 360, 0]]],
          'head.r': [[0.4, z], [0.48, [12, 0, 0], 'out'], [0.65, z], [0.9, [16, 0, 0]], [1.45, [16, 0, 0]], [1.7, [-10, 0, 0]], [2.2, z]],
          'pack.s': one([2.05, [1, 1, 1]], [2.12, [1.05, 0.95, 1.05], 'out'], [2.35, [1, 1, 1]]),
        },
        ik: {
          L: [[0, null], [0.75, { r: add(catchP, [0.07, -0.03, 0]) }], [1.5, { r: add(catchP, [0.07, -0.03, 0]) }], [1.8, { r: add(over, [0.08, -0.2, 0.1]) }, 'out'], [2.6, null]],
          R: [[0, null], [0.75, { r: add(catchP, [-0.07, -0.03, 0]) }], [1.5, { r: add(catchP, [-0.07, -0.03, 0]) }], [1.8, { r: add(over, [-0.08, -0.2, 0.1]) }, 'out'], [2.6, null]],
        },
        cues: [[0, show('fallingDuck')], [2.05, hide('fallingDuck')], [0.45, snd('squeak')], [0.9, face({ look: [0, -0.45] })], [1.55, face({ look: [0, 0.4] })], [2.05, snd('pop')]],
      };
    },
    /** The backpack bursts. */
    accused: () => ({
      dur: 1.9, beat: 0.6,
      tracks: { 'pack.s': one([0.45, [1.22, 1.15, 1.22], 'in'], [0.55, [0.92, 0.95, 0.92], 'out'], [0.8, [1.04, 1.02, 1.04]], [1.1, [1, 1, 1]]), 'root.p': [[0.5, z], [0.6, [0, 0.08, 0.05], 'out'], [0.9, z]] },
      cues: [[0, expr('nervous')], [0.5, snd('bang', 0.5)], [0.52, fx((s, a) => FX.chunks(s, a.world('pack', [0, 0.3, 0]), STUFF, 14))], [0.55, snd('rattle')]],
    }),
    /** Buried under its own stuff. */
    guilty: () => ({
      dur: 1.7, beat: 0.9, hold: true,
      tracks: { 'pile.p': [[0, [0, 2.4, 0.12]], [0.55, [0, 0, 0.12], 'in'], [0.68, [0, 0.08, 0.12], 'out'], [0.8, [0, 0, 0.12], 'in']], 'pile.s': [[0, [1.45, 1.3, 1.3]]], 'hips.s': one([0.55, [1, 1, 1]], [0.62, [1.1, 0.8, 1.1], 'out'], [0.9, [1, 0.88, 1]]) },
      cues: [[0, show('pile')], [0.55, snd('thud')], [0.6, snd('rattle')], [0.55, fx((s, a) => FX.dust(s, a.world('root'), 14))], [0.6, face({ lid: 0.4, look: [0, 0] })]],
    }),
    /** Finds a new item and adds it to the pile. */
    happy: (k) => ({
      dur: 2.4, beat: 0.9,
      ik: { L: [[0, null], [0.3, [0.2, -0.3, 0.6]], [0.5, [0.15, 0.25, 0.75], 'back'], [1.2, [0.15, 0.25, 0.75]], [1.7, { r: [0.15, k.H + 0.2, k.head[2] - 0.35] }], [1.85, { r: [0.15, k.H + 0.2, k.head[2] - 0.35] }], [2.3, null]] },
      tracks: { 'head.r': [[0.4, z], [0.6, [10, 12, -6]], [1.2, [10, 12, -6]], [1.6, [-12, 0, 0]], [2.2, z]], 'pack.s': one([1.85, [1, 1, 1]], [1.92, [1.05, 0.95, 1.05], 'out'], [2.15, [1, 1, 1]]) },
      cues: [[0.3, show('newItem')], [0.3, snd('pop')], [1.85, hide('newItem')], [1.85, snd('pop')], [0.5, expr('smug')], [0.6, face({ look: [0.3, -0.1] })]],
    }),
    /** Floats low and struggling, the backpack dragging. */
    floats: () => ({
      dur: 1.0, loop: true,
      tracks: {
        'root.p': plus([[0, [0, -0.2, 0]]], osc(1, [0, 0.025, 0], 0, 1e9, 0)), 'torso.r': [[0, [14, 0, 0]]],
        'pack.r': osc(1, [-6, 0, 3], 0, 1e9, 0), 'pack.p': [[0, [0, -0.06, -0.05]]], 'hipL.r': osc(1, [25, 0, 0], 0, 1e9, 0), 'hipR.r': osc(1, [-25, 0, 0], 0, 1e9, 0),
      },
      cues: [[0, face({ lid: 0.5, brow: [0.2, -0.3] })]],
    }),
    /** Throws the rubber duck. */
    bonks: () => ({
      dur: 1.3, beat: 0.45,
      ik: { R: [[0, null], [0.3, [0.25, 0.75, -0.25]], [0.5, [0.1, 0.35, 0.95], 'out'], [0.8, [0.1, 0.3, 0.9]], [1.2, null]] },
      tracks: { 'torso.r': [[0, z], [0.3, [-6, -18, 0]], [0.5, [8, 14, 0], 'out'], [0.8, [8, 14, 0]], [1.2, z]] },
      cues: [[0.5, tossAt('fallingDuck', { dur: 0.5, arc: 0.5, spin: 14 }, (a) => (a.emit('hit'), a.sound('squeak')))], [0.5, snd('whoosh', 0.6)]],
    }),
    /** A hand emerges from under the backpack strap. */
    middle: (k) => ({
      dur: 1.6, beat: 0.75, crude: true, min: 1,
      ik: { R: [[0, null], [0.2, { r: add(k.at('handR'), [0, 0.12, -0.04]) }], [0.45, { r: [k.arm.R.S[0] - 0.12, k.head[1] + 0.05, k.head[2] + 0.05] }, 'back'], [1.2, { r: [k.arm.R.S[0] - 0.12, k.head[1] + 0.05, k.head[2] + 0.05] }], [1.55, null]] },
      cues: [[0.35, hand('R', 'middle')], [1.3, hand('R', 'mitten')], [0.3, face({ lid: 0.45 })]],
    }),
    /** The backpack bounces and things fly out. */
    twerk: () => ({
      dur: 2.7, beat: 1.0, crude: true, min: 2,
      tracks: { 'root.r': turned(0.05, 2.25, 168), ...shakeTracks(0.6, 2.1, 16), 'pack.p': bumps([0.65, 1.05, 1.45, 1.85], [0, 0.12, 0], 0.08, 0.2), 'pack.r': osc(2.5, [0, 0, 6], 0.6, 2.1) },
      cues: [...beatSounds([0.65, 1.05, 1.45, 1.85]), ...at([0.7, 1.1, 1.5, 1.9], () => fx((s, a) => FX.chunks(s, a.world('pack', [0, 0.5, 0]), STUFF, 3))), [0.5, face({ lid: 0.45 })]],
    }),
  },

  // ---------- 6. Inspector: gets far too close to everything ----------
  inspector: {
    /** The neck stretches toward the camera to inspect you, then retracts. */
    idle: (k) => ({
      dur: 2.7, beat: 1.2,
      tracks: { ...neckKeys(k, [[0, 1], [0.3, 0.85], [0.75, 2.3, [0.15, 0.35, 1], 'back'], [1.7, 2.3, [0.15, 0.35, 1]], [2.0, 0.9, undefined, 'in'], [2.3, 1, undefined, 'out']]), 'head.r': [[0.6, z], [0.9, [0, -20, 8]], [1.7, [0, -20, 8]], [2.0, z]] },
      cues: [[0.7, show('headLens')], [0.7, stash('lens')], [1.95, hide('headLens')], [1.95, unstash('lens')], [0.8, face({ lidL: 0.15, lidR: 1.15, look: [0, 0] })], [0.75, snd('boing', 0.5)], [2.0, snd('pop', 0.6)]],
    }),
    /** The neck retracts into the vest like a turtle's. */
    accused: (k) => ({
      dur: 2.1, beat: 0.6,
      tracks: { ...neckKeys(k, [[0, 1], [0.12, 1.15], [0.35, 0.12, undefined, 'in'], [1.5, 0.12], [1.75, 1.3, undefined, 'back'], [2.0, 1]]), 'neck.p': [[0, z], [0.35, [0, -0.06, -0.02], 'in'], [1.5, [0, -0.06, -0.02]], [1.75, z, 'back']] },
      cues: [[0, expr('nervous')], [0.35, snd('pop', 0.5)], [0.5, face({ look: [-0.35, 0] })], [0.9, face({ look: [0.35, 0] })], [1.75, snd('boing', 0.5)]],
    }),
    /** The neck goes limp and droops. */
    guilty: (k) => ({
      dur: 1.8, beat: 0.6, hold: true,
      tracks: { ...neckKeys(k, [[0, 1], [0.4, 1.05], [1.1, 1.5, [-0.1, -0.55, 1], 'in'], [1.3, 1.6, [-0.1, -0.7, 1], 'out'], [1.55, 1.5, [-0.1, -0.62, 1]], [1.8, 1.52, [-0.1, -0.65, 1]]]), 'head.r': [[0.4, z], [1.1, [35, 0, 10]], [1.3, [45, 0, 14]], [1.8, [40, 0, 12]]] },
      cues: [[0.4, face({ lid: 0.4 })], [1.1, expr('dead')], [1.15, snd('boing', 0.6)]],
    }),
    /** Ticks a box on the clipboard. */
    happy: (k) => {
      const b = k.at('clipboard'), pen: V3 = [b[0] - 0.02, b[1] + 0.02, b[2] + 0.06];
      return {
        dur: 1.9, beat: 0.9,
        ik: { R: [[0, null], [0.45, { r: pen }], [0.6, { r: add(pen, [0.03, -0.02, 0]) }], [0.75, { r: add(pen, [-0.03, 0.04, 0]) }], [1.3, { r: pen }], [1.8, null]] },
        tracks: { 'head.r': hold([18, 10, 0], 0.2, 1.4, 0.3, 0.4, 'io') },
        cues: [[0.75, call((a) => a.showFor('tick', 6))], [0.6, snd('scribble', 0.7)], [1.0, expr('smug')], [0.3, face({ look: [0.3, -0.4] })]],
      };
    },
    /** Head first, the body trailing on the long neck. */
    floats: (k) => ({
      dur: 1.0, loop: true,
      tracks: { ...neckKeys(k, [[0, 1.8, [0.1, 0.45, 1]]]), 'torso.r': [[0, [-12, 0, 0]]], 'root.p': osc(1, [0, 0.03, 0], 0, 1e9, 0, 1.2), 'hipL.r': [[0, [20, 0, 0]]], 'hipR.r': [[0, [14, 0, 0]]] },
    }),
    /** Spring-loaded neck headbutt. */
    bonks: (k) => ({
      dur: 1.3, beat: 0.45,
      tracks: neckKeys(k, [[0, 1], [0.35, 0.5, [0, 0.35, 1], 'io'], [0.47, 2.6, [0, 0.2, 1], 'out'], [0.7, 2.4, [0, 0.2, 1]], [1.1, 0.9, undefined, 'el'], [1.3, 1]]),
      cues: [[0.35, snd('boing')], [0.47, emit('hit')], [0.47, snd('bonk')], [0.35, face({ lid: 0.4, brow: [-0.3, 0.3] })]],
    }),
    /** Holds the magnifier in front, so the finger is magnified. */
    middle: (k) => {
      const S = k.arm.L.S, len = k.arm.L.len, f: V3 = [S[0] + 0.12, S[1] + 0.72 * len, S[2] + 0.45 * len];
      return {
        dur: 1.9, beat: 0.85, crude: true, min: 1,
        ik: { L: [[0, null], [0.4, { r: f }, 'back'], [1.4, { r: f }], [1.8, null]], R: [[0, null], [0.5, { r: add(f, [-0.06, -0.24, 0.2]) }], [1.4, { r: add(f, [-0.06, -0.24, 0.2]) }], [1.8, null]] },
        tracks: { 'handL_middle.s': one([0.55, [1, 1, 1]], [0.7, [1.9, 1.9, 1.9], 'back'], [1.35, [1.9, 1.9, 1.9]], [1.5, [1, 1, 1]]) },
        cues: [[0.2, stash('clipboard')], [0.35, hand('L', 'middle')], [1.55, hand('L', 'mitten')], [0.5, face({ lid: 0.5 })]],
      };
    },
    /** Inspects its own twerk over its shoulder, with the magnifier. */
    twerk: (k) => ({
      dur: 2.8, beat: 1.2, crude: true, min: 2,
      tracks: { 'root.r': turned(0.05, 2.35, 168), ...shakeTracks(0.62, 2.15, 20), ...neckKeys(k, [[0.4, 1], [0.8, 1.7, [0.5, -0.1, -1]], [2.1, 1.7, [0.5, -0.1, -1]], [2.4, 1]]) },
      cues: [[0.8, show('headLens')], [0.8, stash('lens')], [2.15, hide('headLens')], [2.15, unstash('lens')], ...beatSounds([0.65, 1.05, 1.45, 1.85]), [0.9, face({ lidL: 0.15, lidR: 1.15 })]],
    }),
  },

  // ---------- 7. Junk Drawer: everything nobody knew where to put ----------
  junkDrawer: {
    /** The drawer slides open, a spring pops out, the handle-moustache twitches, the drawer slams. */
    idle: () => ({
      dur: 2.4, beat: 0.9,
      tracks: {
        'head.p': [[0, z], [0.3, [0, 0, 0.1], 'out'], [1.25, [0, 0, 0.1]], [1.4, [0, 0, -0.22], 'in'], [1.55, [0, 0, -0.18], 'out'], [1.9, [0, 0, -0.18]], [2.3, z, 'io']],
        'spring.s': one([0.4, [1, 0.05, 1]], [0.6, [1, 1.3, 1], 'el'], [1.05, [1, 1.3, 1]], [1.25, [1, 0.05, 1], 'in']),
        'spring.p': [[0, [0, 0.1, 0.12]]],
        'handle.r': osc(14, [0, 0, 10], 0.7, 1.1, 0.05),
        'root.sq': one([1.4, 1], [1.46, 0.95, 'out'], [1.65, 1]),
      },
      cues: [[0.4, show('spring')], [1.25, hide('spring')], [0.5, snd('boing', 0.6)], [1.4, snd('thud', 0.5)], [1.42, snd('rattle', 0.4)], [0.75, face({ look: [0.3, 0.3] })]],
    }),
    /** Slams itself shut. */
    accused: () => ({
      dur: 2.1, beat: 0.5,
      tracks: { 'head.p': [[0, z], [0.08, [0, 0, 0.04]], [0.18, [0, 0, -0.235], 'in'], [1.4, [0, 0, -0.235]], [1.55, [0, 0, -0.2]], [2.0, z, 'io']], 'root.sq': one([0.18, 1], [0.24, 0.92, 'out'], [0.45, 1]), 'root.p': [[0.18, z], [0.22, [0, 0.03, 0]], [0.4, z]] },
      cues: [[0, expr('nervous')], [0.18, snd('thud')], [0.18, call(() => shake(0.03, 0.2))], [0.6, face({ look: [-0.4, 0] })], [1.0, face({ look: [0.4, 0] })], [1.55, snd('rattle', 0.5)]],
    }),
    /** The drawer falls out and the junk scatters. */
    guilty: (k) => {
      const y = -k.at('neck')[1] + 0.27;
      return {
        dur: 1.6, beat: 0.5, hold: true,
        tracks: { 'head.p': [[0, z], [0.35, [0, 0.02, 0.32], 'out'], [0.45, [0, 0.02, 0.36]], [0.8, [0, y, 0.5], 'in'], [0.92, [0, y + 0.04, 0.52], 'out'], [1.05, [0, y, 0.53], 'in']], 'head.r': [[0.35, z], [0.8, [22, 0, 6], 'in'], [1.05, [18, 0, 5]]] },
        cues: [[0.35, snd('whoosh', 0.5)], [0.8, snd('thud')], [0.82, snd('rattle')], [0.8, fx((s, a) => FX.chunks(s, a.world('head', [0, 0, -0.1]), JUNK, 14))], [0.8, expr('dead')]],
      };
    },
    /** The drawer opens wide, like a grin (the face doesn't). */
    happy: () => ({
      dur: 1.5, beat: 0.65,
      tracks: { 'head.p': hold([0, 0.01, 0.2], 0.1, 1.0, 0.3, 0.4), 'head.r': hold([-8, 0, 0], 0.15, 1.0), 'drawerItems.p': bumps([0.45, 0.65, 0.85], [0, 0.03, 0], 0.06, 0.1), 'handle.r': osc(10, [0, 0, 8], 0.4, 0.9) },
      cues: [[0.1, expr('smug')], [0.4, snd('rattle', 0.5)]],
    }),
    /** Half open, junk trailing out. */
    floats: () => ({
      dur: 1.2, loop: true,
      tracks: { 'head.p': plus([[0, [0, 0, 0.06]]], osc(1 / 0.6, [0, 0, 0.015], 0, 1e9, 0)), 'root.p': osc(1 / 1.2, [0, 0.03, 0], 0, 1e9, 0), 'kneeL.r': [[0, [25, 0, 0]]], 'kneeR.r': [[0, [20, 0, 0]]] },
      cues: [[0.6, fx((s, a) => s.spawn('chunk', a.world('head', [0, -0.2, 0.05]), { vel: [0, 0, -0.3], gravity: 6, spin: 8, floor: 0, life: 1.2, size: 0.05, color: JUNK }))]],
    }),
    /** Launches the mystery key at the target. */
    bonks: () => ({
      dur: 1.2, beat: 0.4,
      tracks: { 'head.p': [[0, z], [0.3, [0, 0, -0.1]], [0.42, [0, 0, 0.16], 'out'], [0.8, [0, 0, 0.12]], [1.2, z]], 'root.sq': one([0.3, 0.92], [0.42, 1.06, 'out'], [0.8, 1]) },
      cues: [[0.42, tossAt('thrownKey', { dur: 0.45, arc: 0.4, spin: 18 }, (a) => (a.emit('hit'), a.sound('bonk'), a.sound('jangle', 0, 0.5)))], [0.42, snd('boing', 0.6)]],
    }),
    /** A tiny side arm does it while the moustache twitches. */
    middle: () => ({
      dur: 1.6, beat: 0.7, crude: true, min: 1,
      ik: { L: [[0, null], [0.4, [0.35, 0.75, 0.4], 'back'], [1.15, [0.35, 0.75, 0.4]], [1.5, null]] },
      tracks: { 'handle.r': osc(16, [0, 0, 12], 0.4, 1.2, 0.05), 'handle.p': osc(16, [0, 0.004, 0], 0.4, 1.2, 0.05) },
      cues: [[0.3, hand('L', 'middle')], [1.3, hand('L', 'mitten')], [0.35, face({ lid: 0.45 })]],
    }),
    /** The whole drawer rattles and junk clatters out. */
    twerk: () => ({
      dur: 2.6, beat: 1.0, crude: true, min: 2,
      tracks: { 'root.r': turned(0.05, 2.2, 168), 'torso.r': osc(3, [0, 7, 3], 0.55, 2.0, 0.1), 'root.p': osc(6, [0, 0.02, 0], 0.55, 2.0, 0.1), 'head.p': osc(9, [0, 0, 0.03], 0.55, 2.0) },
      cues: [...beatSounds([0.6, 0.93, 1.27, 1.6]), ...at([0.7, 1.1, 1.5], () => snd('rattle', 0.6)), ...at([0.7, 1.1, 1.5], () => fx((s, a) => FX.chunks(s, a.world('head', [0, 0.1, -0.2]), JUNK, 3)))],
    }),
  },

  // ---------- 8. Plumber: everything flows through it, held together with tape ----------
  plumber: {
    /** Plugs a leak with a finger; another leak starts somewhere else. */
    idle: (k) => {
      const [A, B] = leakOrder(k), plug = { r: add(A.r, outward(A.r).map((v) => v * 0.1) as V3) };
      return {
        dur: 2.8, beat: 1.2,
        ik: { L: [[0, null], [0.45, plug], [2.3, plug], [2.7, null]] },
        cues: [
          [0.4, hand('L', 'point')], [2.45, hand('L', 'mitten')], ...at(range(0, 0.45, 0.08), () => sprayAt(A.p)), [0.02, snd('spray', 0.6)],
          ...at(range(1.3, 2.3, 0.08), () => sprayAt(B.p)), [1.3, snd('spray', 0.6)], [1.4, face({ look: [B.r[0] > 0 ? 0.4 : -0.4, -0.2] })], [2.0, face({ lid: 0.4, look: [0, 0] })],
        ],
      };
    },
    /** The pipe bursts and sprays everywhere. */
    accused: (k) => ({
      dur: 1.9, beat: 0.6,
      tracks: { 'pipe.s': plus([[0, [1, 1, 1]]], bumps([0.12, 0.5, 0.9], [0.04, 0.04, 0.04], 0.05, 0.2)), 'pipe.r': osc(12, [0, 3, 0], 0.15, 1.4), 'root.p': [[0.1, z], [0.18, [0, 0.05, -0.04], 'out'], [0.5, z]] },
      cues: [[0, expr('nervous')], [0.12, snd('spray')], [0.6, snd('spray')], [0.12, snd('pop', 0.6)], ...range(0.12, 1.4, 0.07).flatMap((t) => leaks(k).map((L): [number, Cue] => [t, sprayAt(L, 1)])), [1.5, face({ lid: 0.35, look: [0, 0] })]],
    }),
    /** Sinks into its own tiny bucket. */
    guilty: (k) => {
      const b = k.at('bucket'), s = 0.2, top = 0.27, hip = top - (k.H - k.hip) * s;
      return {
        dur: 1.9, beat: 0.8, hold: true,
        tracks: {
          'bucket.p': [[0, z], [0.45, [-b[0], 0, -b[2] + 0.04], 'io']], 'bucket.s': one([0.45, [1, 1, 1]], [0.6, [1.4, 1.35, 1.4], 'back']),
          'hips.p': [[0.5, z], [0.75, [0, 0.12, 0], 'out'], [1.25, [0, hip - k.hip, 0], 'in']], 'hips.s': one([0.75, [1, 1, 1]], [1.25, [s, s, s], 'in']),
        },
        cues: [[0.1, face({ look: [0.3, -0.4] })], [1.25, snd('splash')], [1.25, fx((s2, a) => FX.spray(s2, a.world('bucket', [0, 0.2, 0]), [0, 1.2, 0], 8))], [1.3, face({ lid: 0.45, look: [0, 0] })]],
      };
    },
    /** Tapes a leak and admires it. */
    happy: (k) => {
      const P = k.at('patch'), o = outward(P), tgt: V3 = [P[0] + o[0] * 0.07, P[1], P[2] + o[2] * 0.07];
      return {
        dur: 2.2, beat: 1.0,
        ik: { L: [[0, null], [0.45, { r: tgt }], [0.95, { r: tgt }], [1.25, { r: add(tgt, [0.12, -0.05, 0.15]) }], [1.8, { r: add(tgt, [0.12, -0.05, 0.15]) }], [2.1, null]] },
        tracks: { 'head.r': [[0, z], [0.4, [14, 0, 0]], [0.95, [14, 0, 0]], [1.3, [10, 0, 14]], [1.9, [10, 0, 14]], [2.2, z]] },
        cues: [[0.4, hand('L', 'palm')], [1.0, hand('L', 'mitten')], [0.6, snd('tear')], [0.9, call((a) => a.showFor('patch', 10))], [1.25, expr('smug')]],
      };
    },
    /** The pipe trails like a tail; the bucket swings underneath. */
    floats: () => ({
      dur: 1.2, loop: true,
      tracks: { 'pipe.r': osc(1 / 1.2, [0, 10, 3], 0, 1e9, 0), 'bucket.r': osc(1 / 1.2, [12, 0, 6], 0, 1e9, 0, 0.8), 'bucket.p': [[0, [0, -0.1, -0.1]]], 'root.p': osc(1 / 1.2, [0, 0.03, 0], 0, 1e9, 0), 'kneeL.r': [[0, [20, 0, 0]]], 'kneeR.r': [[0, [16, 0, 0]]] },
    }),
    /** The wrench, to the head. */
    bonks: () => ({
      dur: 1.3, beat: 0.5,
      ik: { R: [[0, null], [0.35, [0.15, 0.9, -0.1]], [0.55, [0.05, 0.3, 0.95], 'out'], [0.85, [0.05, 0.25, 0.9]], [1.25, null]] },
      tracks: { 'torso.r': [[0, z], [0.35, [-10, -10, 0]], [0.55, [14, 12, 0], 'out'], [0.85, [14, 12, 0]], [1.3, z]] },
      cues: [[0.55, emit('hit')], [0.55, snd('clang')]],
    }),
    /** Deadpan, while the other finger keeps plugging a leak. */
    middle: (k) => {
      const h = k.at('handR'), near = leaks(k).map((p) => ({ p, d: Math.hypot(...k.pt('pipe', p).map((v, i) => v - h[i])) })).sort((a, b) => a.d - b.d)[0].p;
      return {
        dur: 1.9, beat: 0.85, crude: true, min: 1,
        ik: { L: [[0, null], [0.25, [0.2, -0.75, 0.25]], [0.47, [0.4, 0.75, 0.35], 'back'], [1.35, [0.4, 0.75, 0.35]], [1.8, null]] },
        cues: [[0, hand('R', 'point')], [0.38, hand('L', 'middle')], [1.5, hand('L', 'mitten')], ...at(range(0, 0.3, 0.08), () => sprayAt(near)), [0.3, face({ lid: 0.45, look: [0, 0] })]],
      };
    },
    /** The pipe sprays in rhythm. */
    twerk: (k) => ({
      dur: 2.7, beat: 1.0, crude: true, min: 2,
      tracks: { 'root.r': turned(0.05, 2.25, 168), ...shakeTracks(0.6, 2.1, 18) },
      cues: [...beatSounds([0.65, 1.05, 1.45, 1.85]), ...[0.65, 1.05, 1.45, 1.85].flatMap((t) => leaks(k).map((L): [number, Cue] => [t, sprayAt(L, 3)])), ...at([0.65, 1.05, 1.45, 1.85], () => snd('spray', 0.4)), [0.5, face({ lid: 0.45 })]],
    }),
  },

  // ---------- 9. Star: flawless from the front, clamps behind ----------
  star: {
    /** Poses for the camera (it always turns back to face you). */
    idle: (k) => ({
      dur: 2.3, beat: 0.9,
      tracks: { 'neck.r': hold([-8, 0, 0], 0.3, 1.6, 0.3, 0.4), 'hips.r': hold([0, 0, 6], 0.3, 1.6, 0.3, 0.4), 'torso.r': hold([0, -8, -4], 0.3, 1.6, 0.3, 0.4) },
      ik: { L: [[0, null], [0.5, { r: [k.head[0] + 0.25, k.head[1] - 0.05, k.head[2] + 0.35] }, 'back'], [1.6, { r: [k.head[0] + 0.25, k.head[1] - 0.05, k.head[2] + 0.35] }], [2.1, null]] },
      cues: [[0.55, snd('sparkle', 0.6)], [0.55, fx((s, a) => FX.sparkle(s, a.world('held', [0, 0.27, 0])))], [0.4, expr('smug')]],
    }),
    /** Its spotlight switches off. */
    accused: () => ({
      dur: 1.9, beat: 0.6,
      tracks: { 'root.p': osc(12, [0.003, 0, 0], 0.2, 1.4) },
      cues: [[0.15, snd('click')], [0.15, stash('spotlight')], [0.15, stash('sparkles')], [1.5, unstash('spotlight')], [1.5, unstash('sparkles')], [1.5, snd('click')], [0.2, expr('nervous')], [0.5, face({ look: [0, 0.4] })], [0.9, face({ look: [-0.3, 0] })]],
    }),
    /** The facade tips forward and falls flat, plywood back up. */
    guilty: () => ({
      dur: 1.6, beat: 0.4, hold: true,
      tracks: { 'root.r': [[0, z], [0.2, [-4, 0, 0]], [0.4, [-2, 0, 0]], [1.15, [89, 0, 0], 'in'], [1.27, [84, 0, 0], 'out'], [1.4, [89, 0, 0], 'in']], 'root.p': [[0.4, z], [1.15, [0, 0.14, 0], 'in']] },
      cues: [[0.4, face({ lid: 0.5 })], [1.15, snd('thud')], [1.15, snd('bonk', 0.5)], [1.15, fx((s, a) => FX.dust(s, a.world('root', [0, 0.8, 0])))], [1.2, stash('spotlight')], [1.2, stash('sparkles')]],
    }),
    /** A deep bow. */
    happy: () => ({
      dur: 2.1, beat: 1.0,
      tracks: { 'torso.r': [[0, z], [0.25, [-6, 0, 0]], [0.7, [52, 0, 0], 'io'], [1.3, [52, 0, 0]], [1.8, z, 'io']], 'head.r': [[0.25, z], [0.7, [12, 0, 0]], [1.3, [12, 0, 0]], [1.8, z]] },
      ik: { R: [[0, null], [0.7, [-0.3, -0.3, 0.6]], [1.3, [-0.3, -0.3, 0.6]], [1.8, null]], L: [[0, null], [0.7, [0.8, 0.0, 0.2]], [1.3, [0.8, 0.0, 0.2]], [1.8, null]] },
      cues: [[0.2, expr('smug')], [0.75, snd('sparkle', 0.6)], [0.8, fx((s, a) => FX.sparkle(s, a.world('head', [0, 0.25, 0])))]],
    }),
    /** Glides gracefully, always facing the camera. */
    floats: () => ({
      dur: 2.0, loop: true,
      tracks: { 'root.p': osc(0.5, [0, 0.04, 0], 0, 1e9, 0), 'kneeL.r': [[0, [8, 0, 0]]], 'kneeR.r': [[0, [14, 0, 0]]], 'footL.r': [[0, [45, 0, 0]]], 'footR.r': [[0, [45, 0, 0]]], 'torso.r': osc(0.5, [0, 0, 3], 0, 1e9, 0, 1) },
      ik: both([[0, [0.75, 0.15, 0.35]]]),
    }),
    /** Slaps with the hand mirror. */
    bonks: () => ({
      dur: 1.2, beat: 0.45,
      ik: { L: [[0, null], [0.35, [0.9, 0.35, -0.1]], [0.52, [-0.2, 0.25, 0.95], 'out'], [0.8, [-0.2, 0.2, 0.9]], [1.15, null]] },
      tracks: { 'torso.r': [[0, z], [0.35, [0, 18, 0]], [0.52, [0, -16, 0], 'out'], [0.8, [0, -16, 0]], [1.2, z]] },
      cues: [[0.52, emit('hit')], [0.52, snd('clap')], [0.55, fx((s, a) => FX.sparkle(s, a.world('held', [0, 0.27, 0])))], [0.3, face({ lid: 0.4 })]],
    }),
    /** With a sparkle. */
    middle: () => ({
      dur: 1.6, beat: 0.75, crude: true, min: 1,
      ik: { R: [[0, null], [0.2, [0.4, -0.7, 0.2]], [0.4, [0.25, 0.5, 0.7], 'back'], [1.15, [0.25, 0.5, 0.7]], [1.55, null]] },
      cues: [[0.32, hand('R', 'middle')], [1.35, hand('R', 'mitten')], [0.5, snd('sparkle')], [0.5, fx((s, a) => FX.sparkle(s, a.world('handR', [0, -0.12, 0])))], [0.3, face({ lid: 0.35 })]],
    }),
    /** Turns around to twerk, shows the plywood back, freezes, panics, spins back to the front. */
    twerk: () => ({
      dur: 2.8, beat: 1.4, crude: true, min: 2,
      tracks: {
        'root.r': [[0, z], [0.35, [0, 170, 0], 'back'], [1.6, [0, 170, 0]], [1.85, [0, 380, 0], 'out'], [2.0, [0, 360, 0]]],
        'torso.r': plus([[0.35, z], [0.5, [24, 0, 0]], [1.3, [24, 0, 0]], [1.6, z]], osc(2.5, [0, -8, 0], 0.5, 1.2, 0.08)),
        'hips.r': osc(2.5, [0, 13, 0], 0.5, 1.2, 0.05),
        'root.sq': one([1.2, 1], [1.25, 1.08, 'out'], [1.6, 1.08], [1.85, 0.95], [2.1, 1]),
      },
      cues: [...beatSounds([0.5, 0.9]), [1.2, snd('click')], [1.6, expr('horrified')], [1.6, snd('whoosh')], [1.9, fx((s, a) => FX.sweat(s, a.world('head', [0, 0.2, 0]), 4))]],
    }),
  },

  // ---------- 10. Librarian: knows everything; nobody has asked in years ----------
  librarian: {
    /** Opens up (the head tips back), dust puffs, sneezes, the stack wobbles. */
    idle: (k) => {
      const n = k.books, tr: Record<string, Track> = {};
      for (let i = 0; i < n; i++) tr[`book${i}.r`] = osc(2.2, [0, 0, 1 + (3 * i) / n], 1.45, 2.6, 0.1, -i * 0.35);
      tr['head.r'] = plus([[0, z], [0.3, [-26, 0, 0], 'out'], [0.9, [-26, 0, 0]], [1.1, [-34, 0, 0]], [1.3, [14, 0, 0], 'out'], [1.6, z]], osc(2.2, [0, 0, 5], 1.45, 2.6, 0.1, -n * 0.35));
      return {
        dur: 2.7, beat: 1.3, tracks: tr,
        cues: [[0.3, fx((s, a) => FX.dust(s, a.world('head', [0, 0.2, 0.1]), 6))], [0.9, face({ lid: 0.6, brow: [0.3, -0.2] })], [1.0, snd('sneeze', 0.8)], [1.3, fx((s, a) => FX.dust(s, a.world('head', [0, 0, 0.3]), 12))], [1.3, face({ lid: 0.05 })], [1.5, face({ lid: 1 })]],
      };
    },
    /** The stack sways dangerously. */
    accused: (k) => {
      const n = k.books, amp = (t: number) => Math.min(1, t / 1.0) * Math.max(0, Math.min(1, (2.0 - t) / 0.6));
      const tr: Record<string, Track> = {};
      for (let i = 0; i <= n; i++) {
        const name = i === n ? 'head' : `book${i}`, h = i / n;
        tr[`${name}.p`] = (t) => [amp(t) * h * 0.07 * Math.sin(t * PI * 3.2 - i * 0.25), 0, 0];
        tr[`${name}.r`] = (t) => [0, 0, -amp(t) * h * 7 * Math.sin(t * PI * 3.2 - i * 0.25)];
      }
      return { dur: 2.1, beat: 0.9, tracks: tr, cues: [[0, expr('nervous')], [0.8, snd('whoosh', 0.4)], [1.3, snd('whoosh', 0.4)]] };
    },
    /** The stack topples, book by book. */
    guilty: (k) => {
      const n = k.books, tr: Record<string, Track> = { 'torso.r': [[0, z], [0.3, [0, 0, -8]], [0.45, z]] };
      const cues: [number, Cue][] = [[0.35, face({ lid: 1.1, brow: [0.5, -0.3] })]];
      const fall = (name: string, j: number, y: number) => {
        const t0 = 0.45 + j * 0.09, land: V3 = [0.35 + j * 0.2, y, 0.12 * Math.sin(j * 2.3)];
        const p0 = k.at(name), mid = add(p0, [0.15, 0.05, 0]);
        tr[`${name}.p`] = [[0, z], [t0, z], [t0 + 0.12, k.to(name, mid), 'out'], [t0 + 0.42, k.to(name, land), 'in']];
        tr[`${name}.r`] = [[t0, z], [t0 + 0.42, [0, 25 * j, -180], 'in']];
        cues.push([t0 + 0.42, snd('thud', 0.5)]);
      };
      fall('head', 0, 0.16);
      for (let i = n - 1; i >= 1; i--) fall(`book${i}`, n - i, 0.1);
      cues.push([0.9, fx((s, a) => FX.dust(s, a.world('root', [0.7, 0, 0]), 16))], [1.0, expr('dead')]);
      return { dur: 0.95 + n * 0.09, beat: 0.5, hold: true, tracks: tr, cues };
    },
    /** The bookmark "hair" wiggles: someone finally asked. */
    happy: () => ({
      dur: 1.6, beat: 0.6,
      tracks: { 'bookmarks.r': osc(6, [14, 0, 26], 0.2, 1.3), 'bookmarks.p': bumps([0.35, 0.65, 0.95], [0, 0.05, 0], 0.05, 0.1), 'bookmarks.s': hold([1, 1.4, 1], 0.2, 1.2, 0.15, 0.25, 'back', 1), 'head.p': bumps([0.4, 0.8], [0, 0.05, 0], 0.08, 0.15) },
      cues: [[0.1, face({ lid: 1.15, brow: [0.55, -0.4], look: [0, 0] })], [0.4, snd('pop', 0.5)]],
    }),
    /** The books drift slightly apart and back. */
    floats: (k) => {
      const n = k.books, gap = (t: number) => (0.035 * (1 - Math.cos(t * PI))) / 2, tr: Record<string, Track> = {};
      for (let i = 0; i < n; i++) {
        tr[`book${i}.p`] = (t) => [0.01 * Math.sin(t * PI + i), i * gap(t), 0];
        tr[`book${i}.r`] = (t) => [0, (6 * Math.sin(t * PI + i * 0.7) * gap(t)) / 0.035, 0];
      }
      tr['head.p'] = (t) => [0, n * gap(t), 0];
      return { dur: 2.0, loop: true, tracks: tr };
    },
    /** Drops its heaviest book on the target's head. */
    bonks: () => ({
      dur: 1.4, beat: 0.5,
      tracks: { 'handR.p': [[0, z], [0.3, [0.05, 0.25, 0.25]], [1.0, [0.05, 0.25, 0.25]], [1.3, z]], 'handR.s': [[0, [1.5, 1.5, 1.5]]] },
      cues: [
        [0.2, show('popHand')], [0.25, hand('R', 'point')], [1.1, hand('R', 'mitten')],
        [0.45, call((a) => {
          const top = a.resolve(a.target ?? a.ahead()).add(new THREE.Vector3(0, 0.12, 0));
          void a.toss('heavyBook', top, { from: top.clone().add(new THREE.Vector3(0, 1.4, 0)), dur: 0.45, arc: 0, spin: 0 }).then(() => {
            a.emit('hit');
            a.sound('thud');
            a.fx((s) => FX.dust(s, top, 8));
          });
        })],
      ],
    }),
    /** Starts as a "shush" finger, then switches. */
    middle: (k) => {
      const hd = k.head, mouth: V3 = [hd[0] - 0.02, hd[1] - 0.09, hd[2] + 0.34], flip: V3 = [hd[0] - 0.48, hd[1] + 0.12, hd[2] + 0.3];
      return {
        dur: 2.2, beat: 1.4, crude: true, min: 1,
        tracks: { 'handR.p': [[0, z], [0.3, k.to('handR', mouth), 'back'], [0.95, k.to('handR', mouth)], [1.15, k.to('handR', flip), 'back'], [1.8, k.to('handR', flip)], [2.1, z]], 'handR.r': [[0, [0, 0, 180]]], 'handR.s': [[0, [1.6, 1.6, 1.6]]] },
        cues: [[0.15, show('popHand')], [0.25, hand('R', 'point')], [0.35, snd('shh')], [0.4, face({ lid: 0.5, brow: [-0.1, 0.2] })], [0.95, hand('R', 'middle')], [1.95, hand('R', 'mitten')]],
      };
    },
    /** The books jump, dust everywhere, a sneeze mid-twerk. */
    twerk: (k) => {
      const n = k.books, beats = [0.6, 0.95, 1.3, 1.65, 2.0], tr: Record<string, Track> = { 'root.r': turned(0.05, 2.35, 168), 'torso.r': osc(2.85, [0, 6, 0], 0.6, 2.1) };
      for (let i = 0; i < n; i++) tr[`book${i}.p`] = bumps(beats.map((t) => t + i * 0.015), [0, 0.03 + 0.01 * i, 0], 0.06, 0.12);
      tr['head.p'] = bumps(beats.map((t) => t + n * 0.015), [0, 0.03 + 0.01 * n, 0], 0.06, 0.12);
      tr['head.r'] = [[1.25, z], [1.35, [-15, 0, 0]], [1.45, [20, 0, 0], 'out'], [1.7, z]];
      return {
        dur: 2.7, beat: 1.4, crude: true, min: 2, tracks: tr,
        cues: [...beatSounds(beats), ...at(beats, () => fx((s, a) => FX.dust(s, a.world('torso', [0, 0.2, 0]), 5))), [1.1, snd('sneeze')], [1.42, fx((s, a) => FX.dust(s, a.world('head', [0, 0, -0.3]), 14))]],
      };
    },
  },

  // ---------- 11. Landlord: narrator and judge, never on trial ----------
  landlord: {
    /** Jangles the keys, reads the clipboard, sighs with its whole body. */
    idle: () => ({
      dur: 3.2, beat: 1.2,
      tracks: {
        'keyRing.r': osc(6, [0, 0, 14], 0.1, 0.9, 0.1), 'keyRing.p': osc(6, [0.01, 0.01, 0], 0.1, 0.9, 0.1),
        'head.r': [[0.9, z], [1.25, [10, -38, 0]], [2.0, [10, -38, 0]], [2.3, z]],
        'torso.s': one([2.1, [1, 1, 1]], [2.5, [1.04, 1.06, 1.04]], [2.8, [0.97, 0.94, 0.97]], [3.2, [1, 1, 1]]),
        'torso.r': [[2.1, z], [2.5, [-5, 0, 0]], [2.8, [8, 0, 0]], [3.2, z]],
        'armL.p': [[2.1, z], [2.5, [0, 0.03, 0]], [2.8, [0, -0.03, 0]], [3.2, z]], 'armR.p': [[2.1, z], [2.5, [0, 0.03, 0]], [2.8, [0, -0.03, 0]], [3.2, z]],
      },
      cues: [[0.15, snd('jangle', 0.6)], [1.2, face({ look: [-0.4, 0], lid: 0.4 })], [1.5, face({ look: [-0.25, -0.1] })], [1.8, face({ look: [-0.45, -0.05] })], [2.5, snd('sigh', 0.7)], [2.4, face({ lid: 0.3 })]],
    }),
    /** Counts the money: raising the rent. */
    happy: (k) => {
      const f: V3 = [-0.12, k.arm.R.S[1] - 0.15, k.arm.R.S[2] + 0.35], hold0 = { r: add(f, [0.12, 0.05, 0.02]) };
      const flicks = [0.8, 1.1, 1.4, 1.7];
      return {
        dur: 2.6, beat: 1.2,
        ik: { R: [[0, null], [0.4, { r: f }], [2.1, { r: f }], [2.55, null]], L: [[0, null], [0.5, hold0], ...flicks.flatMap((t): IKKey[] => [[t, { r: add(f, [0.06, 0.02, 0.03]) }, 'in'], [t + 0.12, hold0, 'out']]), [2.1, hold0], [2.5, null]] },
        cues: [[0.35, stash('complaints')], [0.35, show('money')], ...at(flicks, () => snd('tick', 0.6)), [1.95, snd('kaching')], [1.0, face({ look: [-0.2, -0.4], lid: 0.45 })], [2.0, expr('smug')]],
      };
    },
    rent: (k) => GAGS.landlord!.happy(k),
    /** Shuffles through the air in its slippers. */
    floats: () => ({
      dur: 1.0, loop: true,
      tracks: { 'footL.p': osc(1, [0, 0, 0.06], 0, 1e9, 0), 'footR.p': osc(1, [0, 0, -0.06], 0, 1e9, 0), 'footL.r': osc(1, [-10, 0, 0], 0, 1e9, 0), 'footR.r': osc(1, [10, 0, 0], 0, 1e9, 0), 'kneeL.r': [[0, [10, 0, 0]]], 'kneeR.r': [[0, [10, 0, 0]]], 'torso.r': [[0, [6, 0, 0]]], 'root.p': osc(2, [0, 0.015, 0], 0, 1e9, 0) },
    }),
    /** A swing of the key ring. */
    bonks: () => ({
      dur: 1.2, beat: 0.45,
      ik: { L: [[0, null], [0.35, [0.3, 0.7, 0.2]], [0.55, [0.1, 0.15, 0.95], 'out'], [0.85, [0.1, 0.1, 0.9]], [1.15, null]] },
      tracks: { 'keyRing.r': [[0.35, z], [0.55, [0, 0, -40], 'out'], [0.8, [0, 0, 20]], [1.1, z]] },
      cues: [[0.55, emit('hit')], [0.55, snd('jangle')], [0.55, snd('bonk', 0.7)]],
    }),
    /** Annoyed: writes a complaint on the clipboard. */
    annoyed: () => {
      const hold1: V3 = [-0.25, 0.95, 0.45], pen = add(hold1, [-0.08, 0.1, 0.09]);
      return {
        dur: 2.2, beat: 1.0,
        ik: { R: [[0, null], [0.4, { r: hold1 }], [1.8, { r: hold1 }], [2.15, null]], L: [[0, null], [0.5, { r: pen }], [1.7, { r: pen }], [2.1, null]] },
        tracks: { 'handL.p': osc(7, [0.012, 0.008, 0], 0.6, 1.6), 'head.r': hold([12, -24, 0], 0.2, 1.7, 0.3, 0.4, 'io') },
        cues: [[0.6, snd('scribble')], [1.1, snd('scribble')], [0.3, face({ lid: 0.35, look: [-0.3, -0.3] })]],
      };
    },
    /** Without looking up from the clipboard. */
    middle: () => ({
      dur: 1.9, beat: 0.85, crude: true, min: 1,
      tracks: { 'head.r': hold([10, -38, 0], 0.1, 1.6, 0.25, 0.35, 'io'), 'keyRing.r': osc(5, [0, 0, 10], 0.4, 1.0), 'keyRing.p': hold([0, 0.42, 0.05], 0.3, 1.35, 0.15, 0.3, 'io') },
      ik: { L: [[0, null], [0.25, [0.1, -0.85, 0.2]], [0.45, [0.25, 0.5, 0.7], 'back'], [1.35, [0.25, 0.5, 0.7]], [1.8, null]] },
      cues: [[0.38, hand('L', 'middle')], [1.55, hand('L', 'mitten')], [0.1, face({ look: [-0.45, -0.1], lid: 0.38 })], [0.5, snd('jangle', 0.4)]],
    }),
    /** Below nuclear it refuses (a twerk gag is still feral+). */
    twerkRefuse: () => ({
      dur: 1.9, beat: 0.9, cool: true, min: 2,
      tracks: { 'head.r': [[0, z], [0.2, [0, 18, 0]], [0.4, [0, -18, 0]], [0.6, [0, 16, 0]], [0.8, [0, -14, 0]], [1.0, z]], 'torso.r': hold([4, 0, 0], 1.0, 1.6, 0.2, 0.3) },
      cues: [[0, face({ lid: 0.3, brow: [-0.1, 0.1] })], [1.1, snd('sigh', 0.7)]],
    }),
    /** Nuclear: one reluctant hip shake, then the back cracks. */
    twerkNuke: (k) => ({
      dur: 2.6, beat: 1.3, crude: true, min: 3,
      tracks: { 'root.r': [[0, z], [0.4, [0, 70, 0], 'io'], [2.0, [0, 70, 0]], [2.5, z]], 'hips.r': [[0.5, z], [0.7, [0, 16, 0], 'out'], [0.9, z, 'in']], 'torso.r': [[0.9, z], [1.0, [-10, 0, 0], 'out'], [1.9, [-10, 0, 0]], [2.3, z]] },
      ik: { L: [[0.9, null], [1.15, { r: [0.15, k.hip + 0.15, -0.2] }], [1.9, { r: [0.15, k.hip + 0.15, -0.2] }], [2.4, null]] },
      cues: [[0.2, face({ lid: 0.3 })], [0.6, snd('boomTss', 0.6)], [0.95, snd('crack')], [1.0, face({ brow: [0.3, -0.5], lid: 0.9, open: 0.3 })], [1.4, snd('groan', 0.6)]],
    }),
    // ---------- the judge's kit ----------
    /** The wig goes on, over the reading glasses. */
    judgeIn: () => ({
      dur: 1.1, beat: 0.5,
      tracks: { 'torso.r': hold([-7, 0, 0], 0.3, 0.9, 0.2, 0.2), 'wig.s': one([0.25, [0.01, 0.01, 0.01], 'snap'], [0.45, [1.15, 1.15, 1.15], 'back'], [0.6, [1, 1, 1]]) },
      cues: [[0.25, call((a) => a.showFor('wig', 40))], [0.28, snd('pop')], [0.3, fx((s, a) => FX.dust(s, a.world('wig'), 8))], [0.5, face({ lid: 0.38 })]],
    }),
    /** Bangs the key ring like a gavel. */
    gavel: () => {
      const up: V3 = [0.2, 0.45, 0.6], desk: V3 = [0.15, -0.35, 0.7];
      return {
        dur: 1.7, beat: 0.6,
        ik: { L: [[0, null], [0.3, up], [0.45, desk, 'in'], [0.75, up, 'out'], [0.9, desk, 'in'], [1.3, desk], [1.65, null]] },
        tracks: { 'keyRing.r': bumps([0.45, 0.9], [0, 0, 25], 0.05, 0.25) },
        cues: [[0.45, snd('gavel')], [0.9, snd('gavel')], [0.46, snd('jangle', 0.5)], [0.91, snd('jangle', 0.5)], [0.9, call(() => spice() >= 3 && shake(0.03, 0.15))], [0.2, face({ lid: 0.35, brow: [-0.15, 0.2] })]],
      };
    },
    /** Puts the clipboard away and pulls the toy blunderbuss. */
    drawGun: () => ({
      dur: 0.9, beat: 0.6,
      ik: { R: [[0, null], [0.35, [-0.1, 0.1, 0.6]], [0.6, [0.05, 0.12, 0.98], 'back'], [0.9, [0.05, 0.12, 0.98]]] },
      cues: [[0.3, call((a) => (a.stashFor('complaints', 14), a.showFor('blunderbuss', 14)))], [0.32, snd('whoosh')], [0.35, snd('click', 0.6)]],
    }),
    /** Unhinged: the BANG flag. */
    fire: () => ({
      dur: 1.0, beat: 0.2,
      tracks: { 'torso.r': [[0, z], [0.05, [-10, 0, 0], 'out'], [0.4, z]], 'root.p': [[0, z], [0.05, [0, 0, -0.05], 'out'], [0.4, z]], 'bangFlag.s': one([0, [1, 0.05, 1]], [0.12, [1, 1.25, 1], 'out'], [0.3, [1, 1, 1]]) },
      cues: [[0, snd('bang')], [0, call((a) => a.showFor('bangFlag', 2.5))], [0, emit('fire')], [0.02, fx((s, a) => FX.smoke(s, a.world('blunderbuss', [0, -0.5, 0]), 5, 0.06))]],
    }),
    /** Feral: a soot blast (the director sends the cloud to the culprits). */
    fireSoot: () => ({
      dur: 1.0, beat: 0.2,
      tracks: { 'torso.r': [[0, z], [0.05, [-14, 0, 0], 'out'], [0.45, z]], 'root.p': [[0, z], [0.05, [0, 0, -0.08], 'out'], [0.45, z]] },
      cues: [[0, snd('bang')], [0.02, snd('whoosh')], [0, emit('fire')], [0.02, fx((s, a) => FX.smoke(s, a.world('blunderbuss', [0, -0.5, 0]), 14, 0.1, ['#5a524a', '#3d3833', '#6e655c']))]],
    }),
    /** Nuclear: a cartoon cannon, a lit fuse, BOOM. */
    cannon: (k) => {
      const fuse: V3 = add(k.at('cannon'), [-0.26, 0.26, 0]);
      return {
        dur: 2.6, beat: 1.5,
        tracks: { 'cannon.p': [[0.2, [0, -0.3, 0]], [0.45, z, 'back'], [1.5, z], [1.55, [0.15, 0, 0], 'out'], [2.0, z]], 'cannon.r': [[1.5, z], [1.55, [0, 0, -6], 'out'], [2.0, z]] },
        ik: { L: [[0.5, null], [0.9, { r: fuse }], [1.35, { r: fuse }], [1.7, null]] },
        cues: [
          [0.2, call((a) => a.showFor('cannon', 5))], [0.2, snd('pop')], [0.25, fx((s, a) => FX.dust(s, a.world('cannon'), 10))], [0.95, snd('hiss', 0.5)],
          ...at(range(0.95, 1.45, 0.1), () => fx((s, a) => FX.sparkle(s, a.world('cannon', [-0.26, 0.26, 0])))),
          [1.5, snd('cannon')], [1.5, emit('fire')], [1.5, call(() => shake(0.1, 0.6))], [1.5, fx((s, a) => FX.smoke(s, a.world('cannon', [0.4, 0.5, 0]), 18, 0.18, ['#5a524a', '#8a8178', '#3d3833']))],
        ],
      };
    },
    /** Wig off, everything away. */
    judgeOut: () => ({
      dur: 1.0, beat: 0.4,
      tracks: { 'torso.r': hold([5, 0, 0], 0.3, 0.7) },
      cues: [[0.3, call((a) => { for (const t of ['wig', 'blunderbuss', 'bangFlag', 'cannon']) a.showFor(t, 0); a.stashFor('complaints', 0); })], [0.3, snd('pop', 0.6)], [0.3, fx((s, a) => FX.dust(s, a.world('head', [0, 0.2, 0]), 6))], [0.5, face({ lid: 0.3 })]],
    }),
  },
};

// ---------- pointing ----------
export type PointHow = {
  kind: 'arm' | 'neck' | 'spring' | 'spot' | 'bookmark';
  side: 'L' | 'R';
  pose?: HandPose;
  /** Lock the elbow (the Bouncer's stiff arm). */
  straight?: boolean;
  start?: (a: Actor, target: THREE.Vector3) => void;
  /** Before the IK: may move the target (taps, stamps). */
  pre?: (a: Actor, target: THREE.Vector3, t: number) => void;
  /** After the IK: archetype extras. */
  frame?: (a: Actor, rig: NonNullable<Actor['rig']>, target: THREE.Vector3, w: number, t: number) => void;
  end?: (a: Actor) => void;
};
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const UPV = new THREE.Vector3(0, 1, 0), DOWNV = new THREE.Vector3(0, -1, 0);
/** Rotate o so its local `axis` points along a world direction, blended by w. */
function aimAxis(o: THREE.Object3D, axis: THREE.Vector3, dir: THREE.Vector3, w: number) {
  o.updateWorldMatrix(true, false);
  o.getWorldQuaternion(_q);
  _q2.setFromUnitVectors(_a.copy(axis).applyQuaternion(_q), _b.copy(dir).normalize()).multiply(_q);
  o.parent!.getWorldQuaternion(_q).invert();
  o.quaternion.slerp(_q.multiply(_q2), Math.min(1, w));
}
/** Fire once when the pointing clock passes `at`. */
const once = (a: Actor, key: string, t: number, at: number, fn: () => void) => {
  const p = a.pointer;
  if (p && t >= at && !p.fired.has(key)) {
    p.fired.add(key);
    fn();
  }
};
/** A jab toward the target along the arm: pull back, then thrust (taps, stamps). */
const jab = (a: Actor, side: 'L' | 'R', target: THREE.Vector3, t: number, times: number[], depth = 0.07) => {
  let k = 0;
  for (const c of times) if (t > c - 0.12 && t < c + 0.1) k = t < c ? (c - t) / 0.12 : -(1 - (t - c) / 0.1) * 0.25;
  if (!k) return;
  const S = a.world(`arm${side}`);
  target.addScaledVector(_a.copy(target).sub(S).normalize(), -depth * k);
};
const ends = (a: Actor) => 0.35 + (a.pointer?.sweep ?? 0);

export const POINTER: Record<Archetype, PointHow> = {
  bouncer: { kind: 'arm', side: 'R', pose: 'point', straight: true },
  accountant: {
    kind: 'arm', side: 'L', pose: 'point',
    pre: (a, tg, t) => {
      jab(a, 'L', tg, t, [0.45, 0.62, 1.2]);
      for (const [i, c] of [0.45, 0.62, 1.2].entries()) once(a, `tap${i}`, t, c, () => a.sound('tick'));
      once(a, 'check', t, 0.95, () => a.lookAt(a.pointer!.cur, 1.2));
    },
  },
  clerk: {
    kind: 'arm', side: 'R',
    pre: (a, tg, t) => {
      const times = a.pointer?.to ? [0.45, ends(a) + 0.15] : [0.45];
      jab(a, 'R', tg, t, times, 0.1);
      times.forEach((c, i) => once(a, `stamp${i}`, t, c, () => {
        a.sound('stamp');
        a.fx((s) => FX.ring(s, a.pointer!.cur.clone(), [0, 0, 1], '#26357a', 0.05, 4));
      }));
    },
    frame: (a, rig, tg, w) => aimAxis(rig.handR, DOWNV, _a.copy(tg).sub(a.world('handR')), w),
  },
  doorman: { kind: 'arm', side: 'R', frame: (a, rig, tg, w, t) => a.part('timer')?.rotateZ(0.45 * Math.sin(t * PI * 2 * 1.1) * w) },
  hoarder: {
    kind: 'arm', side: 'R', pose: 'fist',
    start: (a) => {
      const item = Math.random() < 0.5 ? 'heldCone' : 'heldLamp';
      a.showFor(item, 0.35 + (a.pointer?.sweep ?? 0) + (a.pointer?.hold ?? 1.2) + 0.25);
      a.sound('pop');
    },
  },
  inspector: {
    kind: 'neck', side: 'R',
    start: (a) => a.sound('boing', 0, 0.6),
    frame: (a, rig, tg, w) => {
      const base = a.world('neck');
      const d = _b.copy(tg).sub(base);
      const s = Math.max(0.8, Math.min(5, (d.length() - 0.3) / NECK)) * w + (1 - w);
      aimAxis(rig.neck, UPV, d, w);
      a.part('neckTube')?.scale.multiply(_a.set(1, s, 1));
      rig.head.position.y += (s - 1) * NECK;
      a.showFor('headLens', w > 0.5 ? 0.1 : 0);
      if (w > 0.5) a.stashFor('lens', 0.1);
    },
  },
  junkDrawer: {
    kind: 'spring', side: 'R',
    start: (a) => a.sound('boing'),
    frame: (a, rig, tg, w, t) => {
      const sp = rig.toggles.spring;
      if (!sp) return;
      a.showFor('spring', w > 0.05 ? 0.1 : 0);
      const base = a.world('spring');
      const d = _b.copy(tg).sub(base), len = d.length();
      aimAxis(sp, UPV, d, 1);
      const e = 1 - Math.exp(-7 * t) * Math.cos(16 * t);
      sp.scale.set(1, Math.max(0.05, (len / 0.45) * Math.min(1, e) * w), 1);
    },
  },
  plumber: {
    kind: 'arm', side: 'R',
    pre: (a, tg, t) => {
      once(a, 'drip', t, 0.55, () => a.fx((s) => FX.drip(s, a.pointer!.cur.clone().add(_a.set(0, 0.35, 0)))));
      once(a, 'land', t, 0.92, () => {
        a.sound('drip');
        a.fx((s) => FX.ring(s, a.pointer!.cur.clone(), [0, 0, 1], '#5fb8ff', 0.04, 1.2, 1.6));
      });
    },
  },
  star: {
    kind: 'spot', side: 'R',
    start: (a) => a.sound('click'),
    frame: (a, rig, tg, w) => {
      const sp = a.part('spotlight');
      if (!sp) return;
      const top = a.world('spotlight');
      const d = _b.copy(tg).sub(top);
      aimAxis(sp, DOWNV, d, w);
      sp.scale.y *= 1 + (d.length() / (2.8 * rig.root.getWorldScale(_a).y) - 1) * w;
    },
  },
  librarian: {
    kind: 'bookmark', side: 'R',
    start: (a) => {
      const p = a.pointer!;
      void a.toss('flyBookmark', p.cur, { from: a.world('bookmarks', [0, 0.25, 0]), dur: 0.45, arc: 0.35, spin: 6, stay: p.sweep + p.hold });
      a.sound('whoosh', 0, 0.6);
    },
    end: (a) => a.fx((s) => FX.sparkle(s, a.world('flyBookmark'))),
  },
  landlord: { kind: 'arm', side: 'L', start: (a) => a.sound('jangle'), frame: (a, rig, tg, w, t) => a.part('keyRing')?.rotateZ(0.3 * Math.sin(t * PI * 2 * 3) * w) },
};
