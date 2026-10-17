'use client';
// One actor per on-screen character, in layers:
//   base     breathing, blinking, eyes (and a little head) following the cursor
//   talk     mouth flaps, head bob and hand beats while talking
//   mood     the expression for the mood (deadpan, nervous, smug, dead)
//   one-shot gags and reactions from the clip library: one slot with priority, a queue, 30 s cooldowns on gags,
//            only one crude gag on screen at a time, spice gating with a clean fallback
//   loco     floatTo in each archetype's float style
//   aim      pointAt (arm IK, neck reach, spring, spotlight, bookmark), lookAt, turnTo
// Clips are THREE.AnimationClips played by an AnimationMixer on proxy nodes named like the rig's parts, all in
// additive mode. Each frame a compositor resets the rig to rest, applies the expression, adds the clip deltas,
// then the procedural layers, so nothing fights over a property and full and lite move identically.
import { useMemo } from 'react';
import * as THREE from 'three';
import type { RootState } from '@react-three/fiber';
import type { Archetype } from '@/lib/cast';
import type { Mood } from '@/lib/types';
import type { Built } from '../archetypes';
import { animatable, applyExpression, FINGER_POSES, PRESETS, type CharacterRig, type Expression, type Face, type HandPose } from '../rig';
import { reducedMotion, useCastAnim } from '../settings';
import { clock, spice, tickClock, wait } from './core';
import { compile, nodeName, type ClipInfo, type Dims, type V3 } from './dsl';
import { ALIASES, clipFor, resolveName } from './clips';
import { POINTER } from './gags';
import { FX, fxFor, type FxSystem } from './fx';
import { sfx, type Sfx } from './sound';

export type PlayOpts = {
  /** 0 ambient idle, 1 gesture (default), 2 scripted, 3 reaction. Lower priority never interrupts higher. */
  priority?: number;
  /** Wait for the slot instead of giving up when something more important is playing. */
  queue?: boolean;
  /** Additive weight: 1.6 plays a gag bigger. */
  weight?: number;
  /** Skip the cooldown and the crude lock (scripted Tribunal moments). */
  force?: boolean;
  speed?: number;
  /** Play without its sounds (a ripple's flinch on every module it reaches). */
  silent?: boolean;
};
type State = { hand: Partial<Record<'L' | 'R', HandPose>>; expr?: Expression; face?: Face; show: Set<string>; stash: Set<string> };
export type Running = { name: string; info: ClipInfo; action: THREE.AnimationAction; priority: number; prev: number; st: State; done: (ok: boolean) => void; still: boolean; silent: boolean };
export type Target = THREE.Vector3 | THREE.Object3D | { client: [number, number] };
export type Pointer = { from: Target; to?: Target; side: 'L' | 'R'; t0: number; sweep: number; hold: number; w: number; out: boolean; resolve: () => void; pose?: HandPose; cur: THREE.Vector3; fired: Set<string>; arm: boolean };
type Tween = { name: string; from: THREE.Vector3; to: Target; t0: number; dur: number; arc: number; spin: number; stay: number; resolve: () => void };

const CRUDE_COOLDOWN = 30;
let crudeOwner: { actor: Actor; until: number } | null = null;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _ray = new THREE.Raycaster(), _plane = new THREE.Plane(), _ndc = new THREE.Vector2();
const D2R = Math.PI / 180;
const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1);

// ---------- cursor (one listener for every actor) ----------
const cursor = { x: 0, y: 0, at: -1e9 };
const rects = new WeakMap<HTMLCanvasElement, { at: number; r: DOMRect }>();
/** The canvas rect, measured at most once per frame. */
function rectOf(el: HTMLCanvasElement) {
  const c = rects.get(el);
  if (c && c.at === clock.now) return c.r;
  const r = el.getBoundingClientRect();
  rects.set(el, { at: clock.now, r });
  return r;
}
if (typeof window !== 'undefined')
  window.addEventListener('pointermove', (e) => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    cursor.at = performance.now();
  }, { passive: true });

/** Rotate joint j so its local -Y (down the bone) points along world direction d; blend by w. */
function aimDown(j: THREE.Object3D, d: THREE.Vector3, w: number) {
  if (w <= 0 || d.lengthSq() < 1e-10) return;
  j.updateWorldMatrix(true, false);
  j.getWorldQuaternion(_q);
  _q2.setFromUnitVectors(_v.copy(DOWN).applyQuaternion(_q), _w.copy(d).normalize()).multiply(_q);
  j.parent!.getWorldQuaternion(_q3).invert();
  j.quaternion.slerp(_q3.multiply(_q2), Math.min(1, w));
}

export class Actor {
  readonly id: string;
  archetype: Archetype = 'clerk';
  built: Built | null = null;
  rig: CharacterRig | null = null;
  dims: Dims | null = null;
  three: (() => RootState) | null = null;
  mood: Mood = 'idle';
  expression: Expression = 'deadpan';
  talking = false;
  cur: Running | null = null;
  holds: Running[] = [];
  private loop: Running | null = null;
  private fading: { action: THREE.AnimationAction; until: number }[] = [];
  private queue: { name: string; o: PlayOpts; resolve: (ok: boolean) => void }[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private proxyRoot = new THREE.Object3D();
  private proxy = new Map<string, THREE.Object3D>();
  private links: [THREE.Object3D, THREE.Object3D][] = [];
  private rests: [THREE.Object3D, THREE.Vector3, THREE.Euler, THREE.Vector3][] = [];
  private clips = new Map<string, ClipInfo>();
  private cool = new Map<string, number>();
  private shown = new Map<string, number>();
  private stashed = new Map<string, number>();
  private events = new Map<string, (() => void)[]>();
  private t = Math.random() * 10;
  private dt = 1 / 60;
  private nextIdle = clock.now + 4 + Math.random() * 8;
  private blinkAt = clock.now + 1 + Math.random() * 3;
  private boing = { x: 0, v: 0 };
  // locomotion and aiming
  private pos = new THREE.Vector3();
  private float: { from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number; arc: number; resolve: () => void } | null = null;
  private yaw = 0;
  private yawV = 0;
  private turn: Target | null = null;
  private look: { target: Target; until: number } | null = null;
  pointer: Pointer | null = null;
  /** What a bonk is aimed at (set by the director): thrown ducks, keys and books fly there. */
  target: Target | null = null;
  /** Plays its idle gag now and then when nothing else is going on (off in the app for now: no new gags yet). */
  ambient = true;
  /** Small per-character gag state (the Judge's bangs this hearing). */
  readonly memo: Record<string, number> = {};
  /** Props that stay put in the world while the character moves (the Judge's bench). */
  private planted: THREE.Object3D[] = [];
  private tweens: Tween[] = [];

  constructor(id: string) {
    this.id = id;
  }
  get bound() {
    return !!this.rig;
  }

  // ---------- binding to a built character (rebinds when the detail level swaps the build) ----------
  bind(built: Built, archetype: Archetype, variant: number, three: () => RootState) {
    this.unbind();
    this.built = built;
    this.rig = built.rig;
    this.archetype = archetype;
    this.three = three;
    const rig = built.rig;
    this.rests = animatable(rig).map((o) => [o, o.userData.rest.p, o.userData.rest.r, o.userData.rest.s]);
    this.proxyRoot = new THREE.Object3D();
    this.proxy.clear();
    this.links = [];
    const add = (name: string, obj?: THREE.Object3D) => {
      if (this.proxy.has(name)) return;
      const p = new THREE.Object3D();
      p.name = name;
      this.proxyRoot.add(p);
      this.proxy.set(name, p);
      if (obj) this.links.push([p, obj]);
    };
    for (const o of animatable(rig)) add(o.name, o);
    for (const [alias, names] of Object.entries(ALIASES[archetype] ?? {})) {
      const real = names.map((n) => rig.props[n]).find(Boolean);
      if (real) add(`prop_${alias}`, real);
    }
    for (const s of ['face', 'ikL', 'ikR', 'aimL', 'aimR']) add(s);
    this.planted = Object.values(rig.props).filter((o) => o.userData.planted);
    this.mixer = new THREE.AnimationMixer(this.proxyRoot);
    this.mixer.addEventListener('finished', (e) => this.finished(e.action as THREE.AnimationAction));
    this.clips.clear();
    this.dims = measure(rig, archetype, variant, (n) => this.part(n));
  }
  unbind() {
    if (!this.mixer) return;
    for (const r of [this.cur, this.loop, ...this.holds]) r?.done(false);
    this.cur = this.loop = null;
    this.holds = [];
    this.fading = [];
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.proxyRoot);
    this.mixer = null;
    this.rig = this.built = null;
  }

  /** A part by clip name: joint, prop (or alias), toggle. */
  part(name: string): THREE.Object3D | undefined {
    const rig = this.rig;
    if (!rig) return undefined;
    const n = nodeName(name);
    if (n.startsWith('tog_')) return rig.toggles[name];
    if (/^hand[LR]_/.test(n)) return rig.hands[n[4] as 'L' | 'R'][n.slice(6) as keyof CharacterRig['hands']['L']];
    if (n.startsWith('prop_')) return rig.props[name] ?? ALIASES[this.archetype]?.[name]?.map((x) => rig.props[x]).find(Boolean);
    return (rig as unknown as Record<string, THREE.Object3D>)[name];
  }
  /** World position of a part plus a local offset. */
  world(name: string, offset: V3 = [0, 0, 0], out = new THREE.Vector3()) {
    const o = this.part(name);
    if (!o) return out.set(0, 0, 0);
    o.updateWorldMatrix(true, false);
    return o.localToWorld(out.set(...offset));
  }

  // ---------- playing clips ----------
  private info(name: string) {
    let c = this.clips.get(name);
    if (!c && this.dims) {
      const fn = clipFor(this.archetype, name);
      if (!fn) return undefined;
      c = compile(name, fn(this.dims), this.dims);
      this.clips.set(name, c);
    }
    return c;
  }
  has(name: string) {
    return !!clipFor(this.archetype, name);
  }
  /** Why a gag would not play right now (spice, cooldown, someone else's crude gag), or null. */
  blocked(name: string, force = false): string | null {
    const c = this.info(name);
    if (!c) return 'missing';
    const d = c.def;
    if ((d.min ?? 0) > spice()) return 'spice';
    if (force || useCastAnim.getState().ignoreCooldowns) return null;
    if ((d.crude || d.cool) && (this.cool.get(name) ?? -1e9) > clock.now) return 'cooldown';
    if (d.crude && crudeOwner && crudeOwner.actor !== this && crudeOwner.until > clock.now) return 'crude';
    return null;
  }
  /** Play a clip; resolves true when it finished, false if it was refused or interrupted. */
  play(name: string, o: PlayOpts = {}): Promise<boolean> {
    if (!this.mixer) return Promise.resolve(false);
    name = resolveName(this.archetype, name);
    const why = this.blocked(name, o.force);
    if (why === 'missing') return Promise.resolve(false);
    if (why) {
      // Gated or cooling down: the clean fallback instead (a glare), never the vulgar thing.
      const fb = this.info(name)?.def.fallback ?? 'glare';
      return fb !== name && !this.blocked(fb, true) ? this.play(fb, { ...o, force: true }) : Promise.resolve(false);
    }
    const priority = o.priority ?? 1;
    if (this.info(name)!.def.loop) return new Promise((resolve) => this.start(name, o, resolve));
    if (this.cur && this.cur.priority > priority) {
      if (!o.queue) return Promise.resolve(false);
      return new Promise((resolve) => this.queue.push({ name, o, resolve }));
    }
    return new Promise((resolve) => this.start(name, o, resolve));
  }
  private start(name: string, o: PlayOpts, resolve: (ok: boolean) => void) {
    const c = this.info(name)!;
    const d = c.def;
    if (this.cur) this.stop(this.cur, 0.12);
    if (!d.loop) for (const h of this.holds.splice(0)) this.stop(h, 0.25);
    const still = reducedMotion() && !d.loop;
    const action = this.mixer!.clipAction(still ? c.still : c.clip);
    action.reset();
    action.setLoop(d.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !!d.hold || still;
    action.timeScale = still ? 1 : (o.speed ?? 1);
    action.setEffectiveWeight(o.weight ?? 1);
    action.fadeIn(still ? 0.1 : 0.06).play();
    const r: Running = { name, info: c, action, priority: o.priority ?? 1, prev: -1, st: { hand: {}, show: new Set(), stash: new Set() }, done: resolve, still, silent: !!o.silent };
    if (d.crude || d.cool) this.cool.set(name, clock.now + CRUDE_COOLDOWN);
    if (d.crude) crudeOwner = { actor: this, until: clock.now + d.dur + 0.3 };
    if (d.loop) {
      if (this.loop) this.stop(this.loop, 0.2);
      this.loop = r;
    } else this.cur = r;
    // The static pose shows what leads up to its beat; only the first sound plays, and every named moment
    // ('hit', 'fire', 'bang') still fires so scripted sequences carry on.
    if (still) {
      type Tag = { sound?: boolean; emits?: boolean };
      const cues = (d.cues ?? []).filter(([t, cue]) => t <= c.beat + 0.25 || (cue as Tag).emits);
      const first = cues.findIndex(([, cue]) => (cue as Tag).sound);
      cues.forEach(([, cue], i) => (!(cue as Tag).sound || (i === first && !o.silent)) && cue(this, r));
    }
  }
  private stop(r: Running, fade: number) {
    r.action.fadeOut(fade);
    this.fading.push({ action: r.action, until: clock.now + fade + 0.02 });
    if (this.cur === r) this.cur = null;
    if (this.loop === r) this.loop = null;
    this.holds = this.holds.filter((h) => h !== r);
    if (crudeOwner?.actor === this && r.info.def.crude) crudeOwner = null;
    r.done(false);
  }
  private finished(action: THREE.AnimationAction) {
    const r = this.cur?.action === action ? this.cur : null;
    if (!r) return;
    this.fireCues(r, r.info.def.dur + 1);
    if (crudeOwner?.actor === this && r.info.def.crude) crudeOwner = null;
    this.cur = null;
    if (r.info.def.hold) this.holds.push(r);
    else {
      action.stop();
      if (r.still) {
        // Static pose: ease back out rather than snapping.
        action.play().fadeOut(0.15);
        this.fading.push({ action, until: clock.now + 0.17 });
      }
    }
    r.done(true);
    const next = this.queue.shift();
    if (next) this.start(next.name, next.o, next.resolve);
  }
  /** Let go of held poses (fainted, buried, ducking), easing back to rest. */
  release(fade = 0.45) {
    for (const h of this.holds.splice(0)) this.stop(h, fade);
  }
  stopAll(fade = 0.15) {
    for (const r of [this.cur, this.loop, ...this.holds]) if (r) this.stop(r, fade);
    for (const q of this.queue.splice(0)) q.resolve(false);
  }
  /** Stop dead, mid-move (a judge's bang shuts a twerk down instantly). */
  halt() {
    this.stopAll(0.03);
  }
  /** Back to standing still at home: no gags, no pointing, no parts showing, cooldowns cleared. */
  reset() {
    this.stopAll();
    this.pointer?.resolve();
    this.float?.resolve();
    this.pointer = this.float = null;
    this.tweens = [];
    this.shown.clear();
    this.stashed.clear();
    this.cool.clear();
    this.pos.set(0, 0, 0);
    this.turn = this.look = this.target = null;
    this.mood = 'idle';
    this.expression = 'deadpan';
    this.talking = false;
  }
  /** Seconds left on a gag's cooldown. */
  cooldown(name: string) {
    return Math.max(0, (this.cool.get(resolveName(this.archetype, name)) ?? 0) - clock.now);
  }
  private fireCues(r: Running, t: number) {
    if (r.still) return;
    for (const [ct, cue] of r.info.def.cues ?? []) if (ct > r.prev && ct <= t && !(r.silent && (cue as { sound?: boolean }).sound)) cue(this, r);
    r.prev = t;
  }

  // ---------- small helpers used by cues and the director ----------
  sound(n: Sfx, delay = 0, vol = 1, pitch = 1) {
    // Ambient idles stay quiet.
    sfx(n, delay, this.cur?.priority === 0 ? vol * 0.35 : vol, pitch);
  }
  fx(fn: (s: FxSystem, a: Actor) => void) {
    const st = this.three?.(), s = st && fxFor(st.scene);
    if (s) fn(s, this);
  }
  showFor(t: string, secs: number) {
    this.shown.set(t, clock.now + secs);
  }
  stashFor(p: string, secs: number) {
    this.stashed.set(p, clock.now + secs);
  }
  emit(ev: string) {
    for (const cb of this.events.get(ev) ?? []) cb();
    this.events.delete(ev);
  }
  /** Resolves at the next emit(ev) from a cue, or after `timeout` seconds of animation time. */
  when(ev: string, timeout = 4) {
    return Promise.race([new Promise<void>((resolve) => this.events.set(ev, [...(this.events.get(ev) ?? []), resolve])), wait(timeout)]);
  }
  /**
   * The app's mood for this module, played on the character: idle and talking let go of any held pose; the rest
   * set the face and play a clip (accused, guilty and happy gags; What-if's horrified, faint, nervous and shrug).
   * `clips` swaps the clip for a mood (on the map, What-if's relieved "happy" is a hop).
   */
  setMood(m: Mood, clips: Partial<Record<Mood, string>> = {}) {
    if (m === this.mood) return;
    this.mood = m;
    this.talking = m === 'talking';
    const FACE: Partial<Record<Mood, Expression>> = { accused: 'nervous', guilty: 'horrified', happy: 'smug', horrified: 'horrified', nervous: 'nervous' };
    const CLIP: Partial<Record<Mood, string>> = { accused: 'accused', guilty: 'guilty', happy: 'happy', horrified: 'horrified', fainted: 'faint', nervous: 'nervous', shrug: 'shrug' };
    if (m === 'idle' || m === 'talking') this.release();
    this.expression = FACE[m] ?? 'deadpan';
    const clip = clips[m] ?? CLIP[m];
    if (clip) void this.play(clip, { priority: 2 });
  }
  setExpression(e: Expression) {
    this.expression = e;
  }
  setTalking(on: boolean) {
    this.talking = on;
  }
  /** Squash-and-stretch boing (a click). */
  poke() {
    this.boing.v -= reducedMotion() ? 1.2 : 3.2;
    sfx('boing');
  }
  lookAt(target: Target | null, secs = 3) {
    this.look = target ? { target, until: clock.now + secs } : null;
  }
  turnTo(target: Target | null) {
    this.turn = target;
  }

  /** Float to a point (world, an object, or a screen point), in this character's float style. */
  floatTo(target: Target, o: { dur?: number; arc?: number; offset?: V3 } = {}): Promise<void> {
    const parent = this.rig?.root.parent;
    if (!parent) return Promise.resolve();
    const to = parent.worldToLocal(this.resolve(target).add(_u.set(...(o.offset ?? [0, 0, 0]))));
    return this.floatLocal(to, o);
  }
  /** Float back to where the character stands. */
  home(o: { dur?: number; arc?: number } = {}) {
    return this.floatLocal(new THREE.Vector3(), o);
  }
  private floatLocal(to: THREE.Vector3, o: { dur?: number; arc?: number }) {
    this.float?.resolve();
    const dist = this.pos.distanceTo(to);
    if (dist < 0.02) return Promise.resolve();
    const quick = reducedMotion();
    return new Promise<void>((resolve) => {
      this.float = { from: this.pos.clone(), to: to.clone(), t0: clock.now, dur: quick ? 0.35 : (o.dur ?? Math.min(2.2, Math.max(0.7, dist / 1.8))), arc: quick ? 0 : (o.arc ?? 0.3), resolve };
      if (!quick) void this.play('floats', { priority: 0 });
    });
  }

  /**
   * Point at a target, or sweep from `from` to `range` (a line range), hold, then let go. Each archetype has
   * its own way: an arm, the Inspector's neck, the Junk Drawer's spring, the Star's spotlight, a bookmark.
   */
  pointAt(target: Target, o: { range?: Target; sweep?: number; hold?: number; side?: 'L' | 'R'; pose?: HandPose; arm?: boolean } = {}): Promise<void> {
    if (!this.rig) return Promise.resolve();
    this.pointer?.resolve();
    // arm: aim with the arm whatever the archetype's own way of pointing is (aiming a toy gun).
    const how = o.arm ? { kind: 'arm' as const, side: o.side ?? 'R' } : POINTER[this.archetype];
    const side = o.side ?? how.side;
    return new Promise<void>((resolve) => {
      this.pointer = {
        from: target, to: o.range, side, t0: clock.now, sweep: o.range ? (o.sweep ?? 1.2) : 0, hold: o.hold ?? 1.2, w: 0, out: false, resolve,
        pose: o.pose ?? ('pose' in how ? how.pose : undefined), cur: this.resolve(target), fired: new Set(), arm: !!o.arm,
      };
      this.lookAt(target, (o.hold ?? 1.2) + (o.range ? (o.sweep ?? 1.2) : 0) + 0.6);
      if (!o.arm) POINTER[this.archetype].start?.(this, this.pointer.cur);
    });
  }
  /** Stop pointing now. */
  unpoint() {
    if (this.pointer) this.pointer.out = true;
  }
  /** A point `d` metres in front of the head (where throws go without a target). */
  ahead(d = 1.4) {
    return this.world('head', [0, 0, d / Math.max(1e-3, this.rig?.head.getWorldScale(_u).z ?? 1)]);
  }

  /** Throw a toggled part along an arc to a target; it stays there `stay` seconds, then disappears. */
  toss(name: string, to: Target, o: { from?: THREE.Vector3; dur?: number; arc?: number; spin?: number; stay?: number } = {}) {
    return new Promise<void>((resolve) => {
      const from = o.from ?? this.world(name);
      this.tweens = this.tweens.filter((t) => t.name !== name);
      this.tweens.push({ name, from, to, t0: clock.now, dur: o.dur ?? 0.55, arc: o.arc ?? 0.6, spin: o.spin ?? 10, stay: o.stay ?? 0, resolve });
      this.showFor(name, (o.dur ?? 0.55) + (o.stay ?? 0));
    });
  }

  /** A target as a world point now. Screen points land on the plane through this character, facing the camera. */
  resolve(t: Target, out = new THREE.Vector3()) {
    if (t instanceof THREE.Vector3) return out.copy(t);
    if (t instanceof THREE.Object3D) return t.getWorldPosition(out);
    const st = this.three?.();
    if (!st || !this.rig) return out.set(0, 0, 0);
    const rect = rectOf(st.gl.domElement);
    _ndc.set(((t.client[0] - rect.left) / rect.width) * 2 - 1, -((t.client[1] - rect.top) / rect.height) * 2 + 1);
    _ray.setFromCamera(_ndc, st.camera);
    this.rig.root.getWorldPosition(_u);
    _plane.setFromNormalAndCoplanarPoint(st.camera.getWorldDirection(_w).negate(), _u);
    return _ray.ray.intersectPlane(_plane, out) ?? out.copy(_u);
  }

  // ---------- the frame ----------
  update(dt: number) {
    tickClock(dt);
    const rig = this.rig, built = this.built, mixer = this.mixer;
    if (!rig || !built || !mixer) return;
    dt = Math.min(dt, 0.1) * useCastAnim.getState().speed;
    this.dt = dt;
    this.t += dt;
    const now = clock.now;
    // Ambient idle gags now and then.
    if (!this.cur && !this.holds.length && !this.float && !this.pointer && this.mood === 'idle' && !this.talking && this.ambient && useCastAnim.getState().ambient && now > this.nextIdle) {
      void this.play('idle', { priority: 0 });
      this.nextIdle = now + 9 + Math.random() * 9;
    }
    mixer.update(dt);
    for (const r of [this.cur, this.loop]) if (r && !r.still) this.fireCues(r, r.action.time);
    this.fading = this.fading.filter((f) => (f.until > now ? true : (f.action.stop(), false)));

    // 1. Rest pose.
    for (const [o, p, r, s] of this.rests) {
      o.position.copy(p);
      o.rotation.copy(r);
      o.scale.copy(s);
    }
    // 2. Expression: mood, clip overrides, continuous face deltas, blinks, talking, gaze.
    const running = [...this.holds, this.cur, this.loop].filter(Boolean) as Running[];
    const faceOf = (e: Expression): Face => (e === 'deadpan' ? built.neutral : PRESETS[e]);
    let f: Face = { ...faceOf(this.expression) };
    for (const r of running) {
      if (r.st.expr) f = { ...faceOf(r.st.expr) };
      if (r.st.face) f = { ...f, ...r.st.face };
    }
    const fp = this.proxy.get('face')!.position;
    const lid = (s: 'L' | 'R') => (f[`lid${s}`] ?? f.lid ?? 0.8) + fp.x;
    let [lidL, lidR] = [lid('L'), lid('R')];
    if (now > this.blinkAt) {
      if (now > this.blinkAt + 0.13) this.blinkAt = now + 2 + Math.random() * 4 - (Math.random() < 0.2 ? 1.8 : 0);
      else [lidL, lidR] = [Math.min(lidL, 0.04), Math.min(lidR, 0.04)];
    }
    const brow = (s: 'L' | 'R'): [number, number] => {
      const [l, tl] = f[`brow${s}`] ?? f.brow ?? [0, 0];
      return [l + fp.z, tl];
    };
    let open = (f.open ?? 0) + fp.y;
    if (this.talking) open = Math.max(open, 0.1 + 0.32 * Math.abs(Math.sin(this.t * 11)) * (0.6 + 0.4 * Math.sin(this.t * 3.1)));
    const gaze = this.gaze();
    const look: [number, number] = f.look && running.some((r) => r.st.face?.look) ? f.look : [(f.look?.[0] ?? 0) * 0.5 + gaze[0], (f.look?.[1] ?? 0) * 0.5 + gaze[1]];
    applyExpression(rig, { ...f, lidL, lidR, lid: undefined, browL: brow('L'), browR: brow('R'), brow: undefined, open, teeth: open > 0.35 ? 1 : f.teeth, look }, built.traits);
    // 3. Clip deltas.
    for (const [p, o] of this.links) {
      o.position.add(p.position);
      o.quaternion.multiply(p.quaternion);
      o.scale.multiply(p.scale);
    }
    // 4. Procedural layers.
    const breath = Math.sin(this.t * 1.9);
    rig.torso.scale.y *= 1 + 0.011 * breath;
    rig.armL.position.y += 0.004 * breath;
    rig.armR.position.y += 0.004 * breath;
    rig.head.rotateY(gaze[0] * 0.28);
    rig.head.rotateX(-gaze[1] * 0.16);
    if (this.talking && this.archetype === 'judge') {
      // Nods like a hammer on key words: a sharp dip from the handle every second or so.
      const k = (this.t * 1.05) % 1, beat = Math.floor(this.t * 1.05) % 3 !== 2;
      if (beat && k < 0.16) rig.neck.rotateX(0.32 * Math.sin((k / 0.16) * Math.PI));
    } else if (this.talking) {
      rig.head.rotateX(0.035 * Math.sin(this.t * 5.3));
      if (!this.cur) for (const s of ['L', 'R'] as const) rig[`elbow${s}`].rotateX(-0.16 * Math.max(0, Math.sin(this.t * 2.6 + (s === 'L' ? 0 : 1.9))));
    }
    // Click boing: a damped spring on a volume-keeping squash.
    this.boing.v += (-120 * this.boing.x - 9 * this.boing.v) * dt;
    this.boing.x += this.boing.v * dt;
    if (Math.abs(this.boing.x) > 1e-4) {
      const k = Math.max(0.4, 1 + this.boing.x * 0.25);
      rig.root.scale.multiply(_u.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k)));
    }
    this.locomotion(rig, now, dt);
    this.floorShadow(rig);
    this.plant(rig);
    for (const [p, until] of this.stashed) if (until > now) this.part(p)?.scale.setScalar(1e-4);
    for (const r of running) for (const p of r.st.stash) this.part(p)?.scale.setScalar(1e-4);
    // 5. Arms: IK and hand aim from clips, then pointing on top.
    this.arms(rig);
    // 6. Parts that appear and disappear, finger sets, projectiles.
    for (const [name, g] of Object.entries(rig.toggles)) {
      g.visible = (this.shown.get(name) ?? -1) > now || running.some((r) => r.st.show.has(name));
      if (g.visible && g.userData.billboard) this.billboard(g);
    }
    for (const s of ['L', 'R'] as const) {
      let pose: HandPose = 'mitten';
      for (const r of running) pose = r.st.hand[s] ?? pose;
      if (this.pointer?.side === s && this.pointer.pose && this.pointer.w > 0.3) pose = this.pointer.pose;
      for (const k of FINGER_POSES) {
        const set = rig.hands[s][k];
        if (!set) continue;
        set.visible = k === pose;
        // Gestures read at small sizes: fingers a third bigger than life.
        if (set.visible) set.scale.multiplyScalar(1.3);
      }
      const pop = rig.toggles[s === 'R' ? 'popHand' : 'popHandL'];
      if (pop && pose !== 'mitten') pop.visible = true;
      if (pose !== 'mitten' && pose !== 'point' && rig[`hand${s}`].userData.rest) this.faceCamera(rig[`hand${s}`]);
    }
    this.projectiles(now);
  }

  /** Where the eyes look: a lookAt target, else the cursor when it moved lately, else straight ahead. */
  private gaze(): [number, number] {
    const rig = this.rig!, st = this.three?.();
    let target: THREE.Vector3 | null = null;
    if (this.look && this.look.until > clock.now) target = this.resolve(this.look.target, _w);
    else if (st && performance.now() - cursor.at < 6000) {
      const rect = rectOf(st.gl.domElement);
      if (cursor.x >= rect.left - 200 && cursor.x <= rect.right + 200 && cursor.y >= rect.top - 200 && cursor.y <= rect.bottom + 200) target = this.resolve({ client: [cursor.x, cursor.y] }, _w);
    }
    if (!target) return [0, 0];
    rig.head.updateWorldMatrix(true, false);
    const d = rig.head.worldToLocal(_u.copy(target)).normalize();
    return [Math.max(-0.5, Math.min(0.5, d.x * 0.9)), Math.max(-0.42, Math.min(0.42, d.y * 0.9))];
  }

  private locomotion(rig: CharacterRig, now: number, dt: number) {
    const fl = this.float;
    let lift = 0, dx = 0, dz = 0;
    const chess = this.archetype === 'judge';
    if (fl) {
      const u = Math.min(1, (now - fl.t0) / fl.dur), io = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
      if (chess) {
        // Like a chess piece being moved: lifted straight up, carried across, set straight down.
        this.pos.lerpVectors(fl.from, fl.to, io(Math.max(0, Math.min(1, (u - 0.25) / 0.5))));
        lift = fl.arc * 1.2 * io(Math.min(1, u / 0.25, (1 - u) / 0.25));
      } else {
        this.pos.lerpVectors(fl.from, fl.to, io(u));
        lift = Math.sin(Math.PI * u) * fl.arc;
      }
      dx = fl.to.x - fl.from.x;
      dz = fl.to.z - fl.from.z;
      if (u >= 1) {
        this.float = null;
        if (this.loop?.name === 'floats') this.stop(this.loop, 0.2);
        this.boing.v -= 1.6;
        fl.resolve();
      }
    }
    rig.root.position.add(this.pos).add(_u.set(0, lift, 0));
    // Facing: the Star always faces the camera; others turn a little toward where they float or toward a target.
    let want = 0;
    const st = this.three?.();
    if (this.archetype === 'star' && st) {
      const dir = rig.root.parent!.worldToLocal(st.camera.getWorldPosition(_w)).sub(this.pos);
      want = Math.atan2(dir.x, dir.z);
    } else if (this.turn) {
      const dir = rig.root.parent!.worldToLocal(this.resolve(this.turn, _w)).sub(this.pos);
      want = Math.atan2(dir.x, dir.z) * 0.8;
    } else if (fl && !chess && Math.hypot(dx, dz) > 0.1) want = Math.atan2(dx, Math.max(Math.abs(dz), 0.5)) * 0.45;
    // The Star snaps: an underdamped spring; everyone else turns smoothly.
    const [k, c] = this.archetype === 'star' ? [160, 9] : [40, 12];
    this.yawV += (k * (want - this.yaw) - c * this.yawV) * dt;
    this.yaw += this.yawV * dt;
    if (Math.abs(this.yaw) > 1e-4) rig.root.quaternion.premultiply(_q.setFromAxisAngle(UP, this.yaw));
  }

  /** Planted props keep their rest place in the character's parent space, whatever the root does. */
  private plant(rig: CharacterRig) {
    if (!this.planted.length) return;
    rig.root.updateMatrix();
    _m2.copy(rig.root.matrix).invert();
    for (const o of this.planted) {
      const r = o.userData.rest as { p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 };
      _m.compose(r.p, _q.setFromEuler(r.r), r.s).premultiply(_m2).decompose(o.position, o.quaternion, o.scale);
    }
  }

  /** The contact shadow stays flat on the floor under the body (the root may topple, hop or float); it shrinks with height. */
  private floorShadow(rig: CharacterRig) {
    const sh = this.built?.shadow;
    if (!sh) return;
    const { p, s } = sh.userData.rest as { p: THREE.Vector3; s: THREE.Vector3 };
    const root = rig.root;
    root.updateMatrix();
    // Where the body is over the floor: midway between hips and head, projected down, in the root's parent space.
    rig.head.updateWorldMatrix(true, false);
    const mid = rig.hips.getWorldPosition(_v).add(rig.head.getWorldPosition(_u)).multiplyScalar(0.5);
    const over = root.parent ? root.parent.worldToLocal(mid) : mid.copy(root.position);
    const lift = Math.max(0, root.position.y), k = 1 / (1 + lift * 1.2);
    _q.setFromAxisAngle(UP, this.yaw).multiply(_q2.setFromAxisAngle(_w.set(1, 0, 0), -Math.PI / 2));
    _m.compose(_u.set(over.x + p.x, p.y, over.z + p.z), _q, _w.set(s.x * k, s.y * k, s.z));
    _m.premultiply(_m2.copy(root.matrix).invert()).decompose(sh.position, sh.quaternion, sh.scale);
  }

  private arms(rig: CharacterRig) {
    const k = this.dims!;
    if (this.pointer) {
      this.pointerStep();
      if (!this.pointer.arm) POINTER[this.archetype].pre?.(this, this.pointer.cur, clock.now - this.pointer.t0);
    }
    const torso = rig.torso;
    let tq: THREE.Quaternion | null = null;
    const torsoQ = () => (tq ??= torso.getWorldQuaternion(new THREE.Quaternion()));
    for (const s of ['L', 'R'] as const) {
      if (!k.arm[s].len) continue;
      const ik = this.proxy.get(`ik${s}`)!, aim = this.proxy.get(`aim${s}`)!;
      const w = ik.scale.x - 1;
      if (w > 1e-3) {
        torso.updateWorldMatrix(true, false);
        this.solveArm(s, torso.localToWorld(_v.copy(ik.position).divideScalar(w)), w);
      }
      const p = this.pointer;
      if (p && p.side === s && (p.arm || POINTER[this.archetype].kind === 'arm') && p.w > 0) this.solveArm(s, _v.copy(p.cur), p.w, !p.arm && POINTER[this.archetype].straight);
      const wa = aim.scale.x - 1;
      if (wa > 1e-3) aimDown(rig[`hand${s}`], _w.copy(aim.position).divideScalar(wa).applyQuaternion(torsoQ()), wa);
    }
    const p = this.pointer;
    if (p) {
      const how = POINTER[this.archetype];
      if (!p.arm) how.frame?.(this, rig, p.cur, p.w, clock.now - p.t0);
      if (p.out && p.w <= 0) {
        if (!p.arm) how.end?.(this);
        this.pointer = null;
        p.resolve();
      }
    }
  }

  /** Two-bone IK through the shoulder and elbow joints toward a world target, elbow toward the pole. */
  private solveArm(s: 'L' | 'R', T: THREE.Vector3, w: number, straight = false) {
    const rig = this.rig!, k = this.dims!;
    const sock = rig[`arm${s}`], j1 = rig[`shoulder${s}`], j2 = rig[`elbow${s}`];
    sock.updateWorldMatrix(true, false);
    const S = sock.getWorldPosition(new THREE.Vector3());
    const scale = rig.root.getWorldScale(_u).x;
    const l1 = rig[`elbow${s}`].userData.rest.p.length() * scale, l2 = rig[`hand${s}`].userData.rest.p.length() * scale;
    if (k.arm[s].len === 0 || l1 + l2 < 1e-3) return;
    const dir = T.clone().sub(S);
    const dist = Math.max(0.15 * (l1 + l2), Math.min((straight ? 0.995 : 0.97) * (l1 + l2), dir.length()));
    dir.normalize();
    const a = (l1 * l1 + dist * dist - l2 * l2) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pole = new THREE.Vector3(s === 'L' ? 0.45 : -0.45, -0.5, -0.75).applyQuaternion(rig.torso.getWorldQuaternion(_q));
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-6) pole.set(0, -1, 0);
    pole.normalize();
    const E = S.clone().addScaledVector(dir, a).addScaledVector(pole, h);
    const Tc = S.clone().addScaledVector(dir, dist);
    aimDown(j1, E.clone().sub(S), w);
    j2.updateWorldMatrix(true, false);
    aimDown(j2, Tc.sub(j2.getWorldPosition(_u)), w);
  }

  /** Stand a part upright, facing the camera (the BANG flag), keeping its clip scale. */
  private billboard(o: THREE.Object3D) {
    const st = this.three?.();
    if (!st || !o.parent) return;
    o.updateWorldMatrix(true, false);
    const p = o.getWorldPosition(new THREE.Vector3()), cam = st.camera.getWorldPosition(_u);
    _q2.setFromAxisAngle(UP, Math.atan2(cam.x - p.x, cam.z - p.z));
    o.parent.getWorldQuaternion(_q3).invert();
    o.quaternion.copy(_q3.multiply(_q2));
  }

  /** Turn a hand about its forearm so the back of it (and the finger) faces the camera. */
  private faceCamera(hand: THREE.Object3D) {
    const st = this.three?.();
    if (!st) return;
    hand.updateWorldMatrix(true, false);
    hand.getWorldQuaternion(_q);
    const axis = _v.copy(DOWN).applyQuaternion(_q);
    const front = _w.copy(FWD).applyQuaternion(_q).addScaledVector(axis, -_w.dot(axis));
    const cam = st.camera.getWorldPosition(_u).sub(hand.getWorldPosition(new THREE.Vector3()));
    cam.addScaledVector(axis, -cam.dot(axis));
    if (front.lengthSq() < 1e-6 || cam.lengthSq() < 1e-6) return;
    front.normalize();
    cam.normalize();
    const ang = Math.atan2(axis.dot(new THREE.Vector3().crossVectors(front, cam)), front.dot(cam));
    _q2.setFromAxisAngle(axis, ang).multiply(_q);
    hand.parent!.getWorldQuaternion(_q3).invert();
    hand.quaternion.copy(_q3.multiply(_q2));
  }

  /** Pointing: weight in over 0.3 s, sweep the target across a range, hold, weight out. */
  private pointerStep() {
    const p = this.pointer!;
    const el = clock.now - p.t0;
    if (el > 0.35 + p.sweep + p.hold) p.out = true;
    p.w = p.out ? Math.max(0, p.w - this.dt / 0.3) : Math.min(1, el / 0.3);
    const a = this.resolve(p.from, new THREE.Vector3());
    if (p.to) a.lerp(this.resolve(p.to, _w), Math.max(0, Math.min(1, (el - 0.35) / Math.max(0.01, p.sweep))));
    p.cur.copy(a);
  }

  private projectiles(now: number) {
    const rig = this.rig!;
    for (const tw of this.tweens) {
      const g = rig.toggles[tw.name];
      if (!g?.parent) continue;
      const u = Math.min(1, (now - tw.t0) / tw.dur);
      const p = _v.copy(tw.from).lerp(this.resolve(tw.to, _w), u);
      p.y += Math.sin(Math.PI * Math.min(u, 1)) * tw.arc;
      g.parent.updateWorldMatrix(true, false);
      g.position.copy(g.parent.worldToLocal(p));
      if (u < 1) g.rotateX(tw.spin * u);
    }
    this.tweens = this.tweens.filter((tw) => {
      const left = now < tw.t0 + tw.dur + tw.stay;
      if (!left) tw.resolve();
      return left;
    });
  }

  /** Tell the director about a click (pester counting lives there). */
  onClick?: () => void;
}

/**
 * Rest measurements for clips, snapshotted at bind time while the fresh build is at rest: every part's
 * transform relative to the root, so clips compiled later (mid-gag, anywhere on stage) still fit.
 */
function measure(rig: CharacterRig, arch: Archetype, variant: number, part: (n: string) => THREE.Object3D | undefined): Dims {
  rig.root.updateMatrixWorld(true);
  const inv = rig.root.matrixWorld.clone().invert();
  const rel = new Map<THREE.Object3D, THREE.Matrix4>();
  rig.root.traverse((o) => rel.set(o, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
  const R = (o: THREE.Object3D) => rel.get(o) ?? new THREE.Matrix4();
  const arr = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];
  const pos = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(R(o));
  const rot = (o: THREE.Object3D) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(R(o)));
  const torsoInv = R(rig.torso).clone().invert();
  const torsoQInv = rot(rig.torso).invert();
  const arm = (s: 'L' | 'R') => ({ len: rig[`elbow${s}`].position.length() + rig[`hand${s}`].position.length(), S: arr(pos(rig[`arm${s}`])) });
  const box = new THREE.Box3().setFromObject(rig.head).applyMatrix4(inv);
  const bum = rig.toggles.bum?.children[0];
  const restPos = new Map<THREE.Object3D, THREE.Vector3>();
  rig.root.traverse((o) => restPos.set(o, o.position.clone()));
  return {
    arch, variant,
    at: (n) => {
      const o = part(n);
      return o ? arr(pos(o)) : [0, 0, 0];
    },
    to: (n, p) => {
      const o = part(n);
      if (!o?.parent) return [0, 0, 0];
      const local = new THREE.Vector3(...p).applyMatrix4(R(o.parent).clone().invert());
      return arr(local.sub(restPos.get(o) ?? o.position));
    },
    torso: (p) => arr(new THREE.Vector3(...p).applyMatrix4(torsoInv)),
    torsoDir: (d) => arr(new THREE.Vector3(...d).normalize().applyQuaternion(torsoQInv)),
    arm: { L: arm('L'), R: arm('R') },
    H: box.max.y,
    head: arr(pos(rig.head)),
    hip: pos(rig.hips).y,
    back: bum ? arr(pos(bum)) : [0, pos(rig.hips).y, -0.3],
    books: Object.keys(rig.props).filter((n) => n.startsWith('book')).length,
    ud: (n) => part(n)?.userData ?? {},
    headR: rig.toggles.bump ? pos(rig.toggles.bump).distanceTo(pos(rig.head)) : 0.2,
    pt: (n, local) => {
      const o = part(n);
      return o ? arr(new THREE.Vector3(...local).applyMatrix4(R(o))) : local;
    },
    turn: (n, dir) => {
      const o = part(n);
      if (!o) return [0, 0, 0];
      const q = rot(o);
      const d = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0).applyQuaternion(q), new THREE.Vector3(...dir).normalize());
      const e = new THREE.Euler().setFromQuaternion(q.clone().invert().multiply(d).multiply(q), 'YXZ');
      return [e.x / D2R, e.y / D2R, e.z / D2R];
    },
    has: (n) => !!part(n) || n === 'face' || /^(ik|aim)[LR]$/.test(n),
  };
}

// ---------- registry ----------
const actors = new Map<string, Actor>();
export const getActor = (id: string) => actors.get(id);
export const allActors = () => [...actors.values()].filter((a) => a.bound);
export function bindActor(id: string, built: Built, archetype: Archetype, variant: number, three: () => RootState) {
  let a = actors.get(id);
  if (!a) actors.set(id, (a = new Actor(id)));
  a.bind(built, archetype, variant, three);
  return a;
}
export function unbindActor(id: string, built: Built) {
  const a = actors.get(id);
  if (a?.built === built) a.unbind();
}

/** Stable handle to an actor by id; calls go to whoever is bound under that id at the time. */
export function actorHandle(id: string) {
  const a = () => actors.get(id);
  return {
    play: (clip: string, o?: PlayOpts) => a()?.play(clip, o) ?? Promise.resolve(false),
    setMood: (m: Mood) => a()?.setMood(m),
    setTalking: (on: boolean) => a()?.setTalking(on),
    pointAt: (p: Target, o?: Parameters<Actor['pointAt']>[1]) => a()?.pointAt(p, o) ?? Promise.resolve(),
    floatTo: (p: Target, o?: Parameters<Actor['floatTo']>[1]) => a()?.floatTo(p, o) ?? Promise.resolve(),
    home: () => a()?.home() ?? Promise.resolve(),
    lookAt: (p: Target | null, secs?: number) => a()?.lookAt(p, secs),
    release: () => a()?.release(),
  };
}
export type ActorHandle = ReturnType<typeof actorHandle>;
/** `useActor(id) -> { play, setMood, setTalking, pointAt, floatTo, lookAt, home, release }`. */
export function useActor(id: string): ActorHandle {
  return useMemo(() => actorHandle(id), [id]);
}

export { FX };
