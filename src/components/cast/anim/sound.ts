'use client';
// Cartoon sound effects, synthesized with Web Audio (nothing downloaded). Every sound respects the app's mute.
import { useTavern } from '@/lib/store';

let ctx: AudioContext | null = null;
let out: AudioNode | null = null;
let noiseBuf: AudioBuffer | null = null;
/** Volume of the sound being scheduled (quiet ambient idles, louder payoffs). */
let vol = 1;

/** The shared context, created on first use (browsers only allow it to start after a click or key). */
function ac() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    out = master;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
if (typeof window !== 'undefined') for (const e of ['pointerdown', 'keydown']) window.addEventListener(e, () => ac(), { once: true });

type C = AudioContext;
/** Oscillator from f0 to f1 (exponential glide) with a 5 ms attack and exponential decay. */
function tone(c: C, t: number, type: OscillatorType, f0: number, f1: number, dur: number, g: number, glide: 'exp' | 'lin' = 'exp') {
  const o = c.createOscillator(), v = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency[glide === 'exp' ? 'exponentialRampToValueAtTime' : 'linearRampToValueAtTime'](f1, t + dur);
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(g * vol, t + 0.005);
  v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(v).connect(out!);
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}
/** Filtered white noise with a frequency sweep f0 -> f1. */
function noise(c: C, t: number, dur: number, g: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1, attack = 0.004) {
  const s = c.createBufferSource(), f = c.createBiquadFilter(), v = c.createGain();
  s.buffer = noiseBuf;
  s.loop = true;
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(g * vol, t + attack);
  v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(v).connect(out!);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}
/** A sung vowel: sawtooth through two or three formant filters, with a breathy onset ("ha", "uh"). */
function vowel(c: C, t: number, f0: number, f1: number, dur: number, g: number, formants: number[], vibrato = 0) {
  const bus = c.createGain();
  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.exponentialRampToValueAtTime(g * vol, t + 0.025);
  bus.gain.setValueAtTime(g * vol, t + dur * 0.6);
  bus.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  bus.connect(out!);
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  if (vibrato) lfo(c, t, dur, 7, vibrato, o.frequency);
  for (const f of formants) {
    const b = c.createBiquadFilter();
    b.type = 'bandpass';
    b.frequency.value = f;
    b.Q.value = 5;
    o.connect(b).connect(bus);
  }
  o.start(t);
  o.stop(t + dur + 0.02);
  noise(c, t, 0.06, g * 0.6, 'bandpass', 1600, 1600, 1);
}
/** Sine LFO added to a parameter (vibrato, wobble, flutter). */
function lfo(c: C, t: number, dur: number, rate: number, depth: number, target: AudioParam, decay = false) {
  const o = c.createOscillator(), v = c.createGain();
  o.frequency.value = rate;
  v.gain.setValueAtTime(depth, t);
  if (decay) v.gain.exponentialRampToValueAtTime(depth * 0.05, t + dur);
  o.connect(v).connect(target);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const r = (a: number, b: number) => a + Math.random() * (b - a);

const SOUNDS = {
  /** Woodblock. */
  bonk: (c: C, t: number) => {
    tone(c, t, 'triangle', 860, 560, 0.09, 0.55);
    noise(c, t, 0.025, 0.3, 'bandpass', 2400, 2400, 2);
  },
  /** Wrench on a head: inharmonic metal partials. */
  clang: (c: C, t: number) => {
    [523, 1310, 1972, 2680].forEach((f, i) => tone(c, t, 'sine', f * r(0.99, 1.01), f * 0.995, 0.95 - i * 0.18, 0.2 - i * 0.035));
    noise(c, t, 0.04, 0.25, 'highpass', 3000);
  },
  /** Rubber duck. */
  squeak: (c: C, t: number) => {
    for (const [d, len] of [[0, 0.2], [0.24, 0.12]]) {
      const o = tone(c, t + d, 'square', 1100, 1100, len, 0.07);
      o.frequency.cancelScheduledValues(t + d);
      o.frequency.setValueAtTime(1000, t + d);
      o.frequency.linearRampToValueAtTime(1850, t + d + len * 0.35);
      o.frequency.linearRampToValueAtTime(1250, t + d + len);
    }
  },
  /** One gavel knock (the key ring on the desk). */
  gavel: (c: C, t: number) => {
    tone(c, t, 'sine', 310, 165, 0.14, 0.7);
    noise(c, t, 0.05, 0.45, 'bandpass', 1100, 900, 1.5);
  },
  /** Toy blunderbuss: a cap-gun pop and the BANG flag springing out. */
  bang: (c: C, t: number) => {
    noise(c, t, 0.28, 0.6, 'lowpass', 2600, 260, 0.8);
    tone(c, t, 'sine', 150, 50, 0.2, 0.6);
    SOUNDS.boing(c, t + 0.05);
  },
  /** Cartoon cannon: low boom with a rumble. */
  cannon: (c: C, t: number) => {
    tone(c, t, 'sine', 78, 30, 1.1, 0.9);
    noise(c, t, 1.2, 0.7, 'lowpass', 900, 90, 0.7);
    noise(c, t, 0.12, 0.35, 'highpass', 1500);
  },
  slideUp: (c: C, t: number) => lfo(c, t, 0.75, 7, 14, tone(c, t, 'sine', 380, 1550, 0.75, 0.22, 'lin').frequency),
  slideDown: (c: C, t: number) => lfo(c, t, 0.85, 7, 14, tone(c, t, 'sine', 1550, 260, 0.85, 0.22, 'lin').frequency),
  /** Blown raspberry (fart cloud). */
  raspberry: (c: C, t: number) => {
    const o = c.createOscillator(), f = c.createBiquadFilter(), am = c.createGain(), v = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(68, t + 0.6);
    f.type = 'lowpass';
    f.frequency.value = 1000;
    am.gain.value = 0.5;
    lfo(c, t, 0.6, 31, 0.5, am.gain);
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(f).connect(am).connect(v).connect(out!);
    o.start(t);
    o.stop(t + 0.62);
  },
  cough: (c: C, t: number) => {
    noise(c, t, 0.14, 0.55, 'bandpass', 700, 520, 1.3, 0.003);
    noise(c, t + 0.22, 0.12, 0.45, 'bandpass', 600, 450, 1.3, 0.003);
  },
  /** Back crack: a few dry clicks. */
  crack: (c: C, t: number) => {
    [0, 0.035, 0.07, 0.12].forEach((d) => noise(c, t + d, 0.014, 0.7, 'highpass', 2200));
    tone(c, t, 'sine', 190, 90, 0.06, 0.3);
  },
  /** One "boom-tss" of the twerk beat. */
  boomTss: (c: C, t: number) => {
    tone(c, t, 'sine', 150, 45, 0.2, 0.8);
    noise(c, t + 0.22, 0.07, 0.3, 'highpass', 7000);
  },
  /** Spring: a pitch wobble that settles. */
  boing: (c: C, t: number) => lfo(c, t, 0.5, 13, 70, tone(c, t, 'sine', 170, 200, 0.5, 0.3).frequency, true),
  /** Keys on a ring. */
  jangle: (c: C, t: number) => {
    for (let i = 0; i < 7; i++) tone(c, t + i * 0.045 + r(0, 0.02), 'sine', r(2600, 5200), r(2500, 5000), 0.08, 0.05);
  },
  /** Pocket-watch alarm bell. */
  ring: (c: C, t: number) => {
    for (const f of [1040, 1570]) {
      const o = c.createOscillator(), v = c.createGain(), am = c.createGain();
      o.frequency.value = f;
      am.gain.value = 0.5;
      lfo(c, t, 1.0, 17, 0.5, am.gain);
      v.gain.setValueAtTime(0.0001, t);
      v.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
      v.gain.setValueAtTime(0.1, t + 0.85);
      v.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      o.connect(am).connect(v).connect(out!);
      o.start(t);
      o.stop(t + 1.02);
    }
  },
  sneeze: (c: C, t: number) => {
    noise(c, t, 0.3, 0.18, 'bandpass', 900, 1500, 2, 0.24);
    noise(c, t + 0.32, 0.18, 0.75, 'lowpass', 5000, 1200, 0.7, 0.004);
  },
  sigh: (c: C, t: number) => noise(c, t, 1.0, 0.22, 'lowpass', 1100, 340, 0.8, 0.25),
  whoosh: (c: C, t: number) => noise(c, t, 0.32, 0.3, 'bandpass', 420, 2200, 1.2, 0.12),
  /** Screaming at the camera: a shaky sung "aah", not too harsh. */
  scream: (c: C, t: number) => vowel(c, t, 420, 560, 0.9, 0.16, [900, 1400, 2600], 22),
  /** One flat "ha". */
  ha: (c: C, t: number) => vowel(c, t, 150, 138, 0.13, 0.2, [750, 1200]),
  groan: (c: C, t: number) => vowel(c, t, 125, 82, 0.8, 0.2, [560, 950]),
  clap: (c: C, t: number) => noise(c, t, 0.07, 0.75, 'bandpass', 1600, 1400, 0.9, 0.002),
  /** Cash register (raising the rent). */
  kaching: (c: C, t: number) => {
    noise(c, t, 0.08, 0.4, 'bandpass', 3000);
    tone(c, t, 'sine', 1568, 1568, 0.12, 0.1);
    [2093, 2637, 3136].forEach((f) => tone(c, t + 0.06, 'sine', f, f, 0.65, 0.12));
  },
  spray: (c: C, t: number) => noise(c, t, 0.6, 0.22, 'bandpass', 3600, 3000, 0.6, 0.05),
  pop: (c: C, t: number) => tone(c, t, 'sine', 720, 210, 0.07, 0.4),
  stamp: (c: C, t: number) => {
    tone(c, t, 'sine', 175, 70, 0.11, 0.65);
    noise(c, t, 0.07, 0.4, 'bandpass', 480, 380, 1.2);
  },
  tick: (c: C, t: number) => tone(c, t, 'square', 2400, 2400, 0.018, 0.08),
  thud: (c: C, t: number) => {
    tone(c, t, 'sine', 100, 40, 0.24, 0.85);
    noise(c, t, 0.12, 0.4, 'lowpass', 420, 200);
  },
  sparkle: (c: C, t: number) => [2637, 3322, 4186].forEach((f, i) => tone(c, t + i * 0.06, 'sine', f, f, 0.25, 0.07)),
  /** Junk rattling around a drawer. */
  rattle: (c: C, t: number) => {
    for (let i = 0; i < 9; i++) noise(c, t + i * 0.055 + r(0, 0.02), 0.022, 0.35, 'bandpass', r(1200, 3200), r(1100, 3000), 3);
  },
  /** Steam from the ears: a hiss and a kettle whistle. */
  hiss: (c: C, t: number) => {
    noise(c, t, 0.9, 0.18, 'highpass', 3500, 3500, 0.7, 0.05);
    tone(c, t, 'sine', 1800, 2150, 0.9, 0.05);
  },
  click: (c: C, t: number) => {
    noise(c, t, 0.012, 0.5, 'highpass', 2500);
    tone(c, t, 'square', 1400, 1400, 0.015, 0.06);
  },
  /** Receipt tearing off. */
  tear: (c: C, t: number) => {
    for (let i = 0; i < 10; i++) noise(c, t + i * 0.022, 0.02, 0.3, 'bandpass', 2800, 2600, 1.5);
  },
  drip: (c: C, t: number) => tone(c, t, 'sine', 900, 1600, 0.07, 0.25),
  /** Librarian's "shh". */
  shh: (c: C, t: number) => noise(c, t, 0.55, 0.22, 'highpass', 3800, 3200, 0.7, 0.08),
  /** Pen on a clipboard. */
  scribble: (c: C, t: number) => {
    for (let i = 0; i < 8; i++) noise(c, t + i * 0.07 + r(0, 0.02), 0.05, 0.16, 'bandpass', r(2200, 3600), r(1800, 3000), 2.5, 0.01);
  },
  splash: (c: C, t: number) => {
    noise(c, t, 0.35, 0.45, 'lowpass', 2500, 500);
    SOUNDS.drip(c, t + 0.05);
  },
};
export type Sfx = keyof typeof SOUNDS;

/** Play a sound now (or `delay` seconds from now), at volume `v`. Silent while the app is muted. */
export function sfx(name: Sfx, delay = 0, v = 1) {
  if (useTavern.getState().muted) return;
  const c = ac();
  if (!c || c.state !== 'running') return;
  vol = v;
  SOUNDS[name](c, c.currentTime + 0.01 + delay);
  vol = 1;
}
