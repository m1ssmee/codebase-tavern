'use client';
// Orchestrators and named event sequences: the deterministic entry points the app will call once it is wired
// up (pester, outOfScope, roast, accuse, verdict, whatIf, completeFix, bored, undo). Everything waits on the
// animation clock and on cues ('hit', 'fire') from the clips, so timing holds at any frame rate.
import * as THREE from 'three';
import type { Archetype } from '@/lib/cast';
import { allActors, getActor, type Actor } from './actor';
import { clock, spice, wait } from './core';
import { FX } from './fx';

type Id = string;
const A = (id: Id) => {
  const a = getActor(id);
  return a?.bound ? a : null;
};
const many = (ids: Id[]) => ids.map(A).filter((a): a is Actor => !!a);
const head = (a: Actor) => a.part('head')!;
const after = (s: number, fn: () => unknown) => void wait(s).then(fn);
/** Scripted moments skip cooldowns and the crude lock, never spice gating. */
const SCRIPT = { priority: 2, force: true } as const;

/** Melee attackers float this far (metres, at scale 1) from the target; the rest throw from where they stand. */
const MELEE: Partial<Record<Archetype, number>> = { bouncer: 0.55, accountant: 0.62, clerk: 0.62, doorman: 0.72, plumber: 0.95, star: 0.62, landlord: 0.65, inspector: 1.15 };

/** Float over (melee) or aim (throwers), bonk with the signature prop, the target reacts, float back. */
export async function bonk(attackerId: Id, targetId: Id) {
  const a = A(attackerId), t = A(targetId);
  if (!a || !t || a === t) return;
  const reach = MELEE[a.archetype];
  a.target = head(t);
  a.turnTo(head(t));
  t.lookAt(head(a), 4);
  if (reach !== undefined) {
    const tp = t.rig!.root.getWorldPosition(new THREE.Vector3()), ap = a.rig!.root.getWorldPosition(new THREE.Vector3());
    const scale = a.rig!.root.getWorldScale(new THREE.Vector3()).x;
    await a.floatTo(tp.add(new THREE.Vector3(Math.sign(ap.x - tp.x || 1) * reach * scale, 0, 0.12 * scale)));
  }
  const done = a.play('bonks', SCRIPT);
  await a.when('hit', 3);
  // The Bouncer's chest bump knocks people over; the Clerk's stamp leaves an ink ring for a while.
  void t.play(a.archetype === 'bouncer' ? 'knocked' : 'bonked', { priority: 3, force: true });
  if (a.archetype === 'clerk') t.showFor('ink', 9);
  t.fx((s) => FX.speed(s, t.world('head'), 6, 0.3));
  await done;
  a.turnTo(null);
  a.target = null;
  if (reach !== undefined) await a.home();
}

/** The judge's sequence, spice-gated; innocents duck when anything comes out. */
export async function judgeVerdict(culpritIds: Id[], innocentIds: Id[], level = spice()) {
  const L = allActors().find((x) => x.archetype === 'landlord');
  if (!L) return;
  const culprits = many(culpritIds), innocents = many(innocentIds);
  culprits.forEach((c) => c.setExpression('nervous'));
  await L.play('judgeIn', SCRIPT);
  await L.play('gavel', SCRIPT);
  if (level === 0) {
    // Clean: the gavel is enough. The culprits faint.
    culprits.forEach((c, i) => after(0.2 + i * 0.15, () => c.play('faint', { priority: 3, force: true })));
    await wait(1.9);
  } else {
    if (level < 3) {
      await L.play('drawGun', SCRIPT);
      if (culprits[0]) {
        // Aims a little over their heads, so the toy (and its flag) stays in view.
        L.turnTo(head(culprits[0]));
        void L.pointAt(culprits[0].world('head', [0, 0.55, 0.2]), { side: 'R', hold: 1.8 });
      }
    }
    innocents.forEach((x, i) => after(i * 0.06, () => x.play('duck', { priority: 3, force: true })));
    await wait(0.7);
    if (level === 1) {
      // Unhinged: the toy fires a BANG flag; the culprits faint anyway.
      const shot = L.play('fire', SCRIPT);
      await L.when('fire', 1);
      culprits.forEach((c, i) => after(0.25 + i * 0.12, () => c.play('bangFaint', { priority: 3, force: true })));
      await shot;
      await wait(1.9);
    } else if (level === 2) {
      // Feral: a soot blast rolls over the culprits.
      const shot = L.play('fireSoot', SCRIPT);
      await L.when('fire', 1);
      for (const c of culprits) sootCloud(L, c);
      culprits.forEach((c, i) => after(0.4 + i * 0.1, () => c.play('sooted', { priority: 3, force: true })));
      await shot;
      await wait(2.6);
    } else {
      // Nuclear: the cannon. Culprits are blasted off-screen or burst into smoke and pop back together.
      const shot = L.play('cannon', SCRIPT);
      await L.when('fire', 3);
      culprits.forEach((c, i) => after(0.1 + i * 0.12, () => c.play(i % 2 ? 'explode' : 'blasted', { priority: 3, force: true })));
      await shot;
      await wait(2.4);
    }
    L.unpoint();
    L.turnTo(null);
    innocents.forEach((x) => x.release(0.35));
    await wait(0.5);
    if (level >= 2 && culprits[0]) {
      // Feral+: the innocents flip the culprits off, one at a time (one crude gag on screen).
      for (const x of innocents.slice(0, 2)) {
        x.turnTo(head(culprits[0]));
        await x.play('middle', { priority: 2 });
        x.turnTo(null);
      }
    }
  }
  await L.play('judgeOut', SCRIPT);
  await wait(0.4);
  culprits.forEach((c) => {
    c.release(0.5);
    c.setExpression('deadpan');
  });
}
function sootCloud(from: Actor, to: Actor) {
  const muzzle = from.world('blunderbuss', [0, -0.5, 0]);
  const dir = to.world('head').sub(muzzle);
  const v = dir.clone().normalize().multiplyScalar(dir.length() / 0.45);
  from.fx((s) => s.spawn('puff', muzzle, { n: 16, vel: [v.x, v.y, v.z], spread: 0.6, jitter: 0.05, life: [0.45, 0.7], size: [0.08, 0.13], grow: 2.2, color: ['#5a524a', '#3d3833', '#6e655c'], drag: 0.6 }));
}

// ---------- named events ----------
const clicks = new Map<Id, number[]>();
const pestered = new Map<Id, number>();

/** A click on a character: boing, and pestering after 3+ clicks in 5 seconds. */
export function click(id: Id) {
  const a = A(id);
  if (!a) return;
  a.poke();
  const now = clock.now, list = (clicks.get(id) ?? []).filter((t) => now - t < 5);
  list.push(now);
  clicks.set(id, list);
  if (list.length >= 3) {
    clicks.set(id, []);
    void pester(id);
  }
}
/** Clean: a glare. Unhinged+: the middle finger. Feral+, if the pestering continues: a twerk at you. */
export async function pester(id: Id) {
  const a = A(id);
  if (!a) return;
  const again = clock.now - (pestered.get(id) ?? -1e9) < 12;
  pestered.set(id, clock.now);
  a.lookAt(null);
  if (spice() === 0) return a.play('glare', { priority: 2 });
  if (again && spice() >= 2) return a.play('twerk', { priority: 2 });
  return a.play('middle', { priority: 2 });
}
/** Asked about someone else's code: points at the right module, then (unhinged+) flips you off. */
export async function outOfScope(id: Id, rightId: Id) {
  const a = A(id), r = A(rightId);
  if (!a) return;
  if (r && r !== a) {
    a.turnTo(head(r));
    await a.pointAt(head(r), { hold: 0.9 });
    a.turnTo(null);
  }
  await a.play(spice() >= 1 ? 'middle' : 'shrug', { priority: 2 });
}
/**
 * Roasted: mortified; 1-2 neighbours point and laugh (unhinged) or twerk at it (feral+). Feral: the roasted one
 * goes red and steams. Nuclear: it screams at the camera, and the neighbours finish with a twerk-off.
 */
export async function roast(id: Id, neighbourIds: Id[] = []) {
  const a = A(id);
  if (!a) return;
  const s = spice(), ns = many(neighbourIds).filter((n) => n !== a).slice(0, 2);
  void a.play('mortified', SCRIPT);
  await wait(0.35);
  if (s === 0) {
    if (ns[0]) await ns[0].play('sigh', { priority: 2 });
    return;
  }
  if (s === 1) {
    await Promise.all(ns.map((n, i) => wait(i * 0.25).then(async () => {
      n.turnTo(head(a));
      void n.pointAt(head(a), { hold: 1.3 });
      await n.play('laugh', { priority: 2, force: true });
      n.turnTo(null);
    })));
    return;
  }
  // Feral+: one twerk at a time, back turned to the roasted one.
  for (const n of ns) {
    n.turnTo(head(a));
    await n.play('twerk', { priority: 2 });
    n.turnTo(null);
  }
  await a.play(s === 3 ? 'scream' : 'steam', SCRIPT);
  if (s === 3 && ns.length === 2) await twerkOff(ns[0].id, ns[1].id);
}
/** Nuclear: two characters out-twerk each other, bigger each round, never both at once; the loser moons. */
export async function twerkOff(aId: Id, bId: Id) {
  const pair = many([aId, bId]);
  if (pair.length < 2 || spice() < 3) return;
  const [a, b] = pair;
  for (const [i, x] of [a, b, a].entries()) {
    const other = x === a ? b : a;
    x.turnTo(head(other));
    await x.play('twerk', { priority: 2, force: true, weight: 1 + i * 0.25 });
    x.turnTo(null);
  }
  b.turnTo(head(a));
  await b.play('moon', { priority: 2, force: true });
  b.turnTo(null);
}
/** Accusation: the accuser floats over and bonks; the accused does its accused gag. */
export async function accuse(accuserId: Id, accusedId: Id) {
  await bonk(accuserId, accusedId);
  await wait(0.15);
  await A(accusedId)?.play('accused', SCRIPT);
}
export const verdict = (culprits: Id[], innocents: Id[]) => judgeVerdict(culprits, innocents, spice());
/** What-if: breaks (horrified, faints), at risk (sweats), fine (shrugs), relieved (a hop). */
export async function whatIf(o: { breaks?: Id[]; atRisk?: Id[]; fine?: Id[]; relieved?: Id[] }) {
  const go = (ids: Id[] | undefined, clip: string, d: number) => many(ids ?? []).forEach((x, i) => after(d + i * 0.15, () => x.play(clip, SCRIPT)));
  go(o.breaks, 'breaks', 0);
  go(o.atRisk, 'nervous', 0.1);
  go(o.fine, 'shrug', 0.2);
  go(o.relieved, 'hop', 0.3);
  await wait(3.4);
  many(o.breaks ?? []).forEach((x) => x.release(0.5));
}
/** A fix landed: everyone celebrates (deadpan), confetti, the Landlord counts money (raising the rent). */
export async function completeFix(ids?: Id[]) {
  const all = ids ? many(ids) : allActors();
  const L = all.find((x) => x.archetype === 'landlord');
  all.filter((x) => x !== L).forEach((x, i) => after(i * 0.12, () => x.play('happy', SCRIPT)));
  if (L) void L.play('rent', SCRIPT);
  const c = new THREE.Vector3();
  for (const x of all) c.add(x.world('root'));
  c.divideScalar(Math.max(1, all.length)).add(new THREE.Vector3(0, 2.2, 0));
  all[0]?.fx((s) => FX.confetti(s, c, 70));
  await wait(2.8);
}
/** Undo: a collective groan and eye-roll. */
export async function undo(ids?: Id[]) {
  (ids ? many(ids) : allActors()).forEach((x, i) => after(i * 0.08, () => x.play('groan', SCRIPT)));
  await wait(1.9);
}
/** Nobody has touched anything for a minute: a random character's idle gag, bigger (unhinged) or a twerk (feral+). */
export async function bored(ids?: Id[]) {
  const pool = (ids ? many(ids) : allActors()).filter((x) => !x.cur && !x.holds.length);
  const a = pool[Math.floor(Math.random() * pool.length)];
  if (!a) return;
  if (spice() >= 2) return a.play('twerk', { priority: 1 });
  return a.play('idle', { priority: 1, weight: spice() >= 1 ? 1.6 : 1 });
}
/** Fire `bored` after `secs` without pointer or key input. Returns a stop function. */
export function watchBored(secs = 60, ids?: Id[]) {
  let last = performance.now();
  const touch = () => (last = performance.now());
  const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;
  evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
  const id = setInterval(() => {
    if (document.hidden || performance.now() - last < secs * 1000) return;
    last = performance.now();
    void bored(ids);
  }, 1000);
  return () => {
    clearInterval(id);
    evs.forEach((e) => window.removeEventListener(e, touch));
  };
}

/** Everything the app will call, in one place. */
export const events = { click, pester, outOfScope, roast, accuse, verdict, whatIf, completeFix, bored, undo, twerkOff };
