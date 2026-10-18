'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { QuadraticBezierLine, useCursor, type QuadraticBezierLineRef } from '@react-three/drei';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import * as THREE from 'three';
import { useReducedMotion } from 'framer-motion';
import { Package, Scissors, X } from 'lucide-react';
import { create } from 'zustand';
import { RIPPLE_HOP_MS as HOP_MS, useTavern, type RippleStep as Step } from '@/lib/store';
import { dependenciesOf, dependentsOf, type Edge, type ImportRef } from '@/lib/graph';
import { faceTraits, sizeOf, statsLine } from '@/lib/characters';
import { assignCast, type Archetype } from '@/lib/cast';
import { tourOrder } from '@/lib/landlord';
import type { Module } from '@/lib/types';
import MapNode from './MapNode';
import { Dom, DomLayer } from './Dom';
import Rich from '../Rich';
import { CastCanvas, CastFallbackNote, CastLights } from '../cast/Character3D';
import { getActor } from '../cast/anim/actor';
import { Menu } from '../stage/Stage';
import { stageDo } from '../stage/api';
import { useStage, type Bubble } from '../stage/store';

const PX = 30; // d3 layout pixels per world unit
const LIFT = 0.25; // gap between a face and the ground
const INK = '#171717';
const EDGE = '#bdb7ae';
const FAINT = '#ece9e4';
const HOT = '#ff5a3c';
const CALL = '#9db8d6'; // "calls" edges: dashed, blue-grey
const CALL_DARK = '#3d6a9c';
const UP = new THREE.Vector3(0, 1, 0);
const CAMERA: [number, number, number] = [5, 16, 9]; // ~57° down: tilted, but faces don't stack on each other

type N = SimulationNodeDatum & { id: string; scale: number; hx: number; hy: number };

/** The Neighbourhood's tools: a request being followed, the scissors, the caption they write. */
const useHood = create<{ follow: number | null; cut: boolean; caption: string | null }>(() => ({ follow: null, cut: false, caption: null }));

// "Follow a request": how each archetype handles the parcel when it arrives (no AI; the clip is its own gag).
const HANDLES: Record<Archetype, { clip: string; line: string }> = {
  bouncer: { clip: 'idle', line: 'flexes at it, then lets it through' },
  accountant: { clip: 'happy', line: 'logs it and tears off a receipt' },
  clerk: { clip: 'happy', line: 'gives it one bored stamp' },
  doorman: { clip: 'idle', line: 'checks the watch, then holds the door' },
  hoarder: { clip: 'happy', line: 'adds it to the pile, briefly' },
  inspector: { clip: 'happy', line: 'inspects it and ticks a box' },
  junkDrawer: { clip: 'happy', line: 'drops it in the drawer with everything else' },
  plumber: { clip: 'happy', line: 'pipes it along and tapes a leak' },
  star: { clip: 'happy', line: 'takes a bow, as if it did the work' },
  librarian: { clip: 'happy', line: 'files it on the right shelf' },
  landlord: { clip: 'happy', line: 'counts the rent' },
  judge: { clip: 'idle', line: 'bangs its head on the bench' },
};
const TRIP_HOP = 900; // ms along one road
const TRIP_STOP = 1500; // ms with the module handling it
const AMBER = '#f5a524';
type Leg = { a: string; b: string; k: number | null; handler: boolean };
const where = (r: ImportRef) => `${r.file}:${r.line}`;

/** d3-force in 2D, run to rest. Afterwards only a pull home (and collisions) stays on: a dragged node passes over
 *  the others (drop it on one to start an argument) and floats back home on release. */
function layout(mods: Module[], edges: Edge[]) {
  const nodes: N[] = mods.map((m) => ({ id: m.id, scale: 1.1 + 1.3 * sizeOf(m.stats.totalLines), hx: 0, hy: 0 }));
  const links = edges.map((e) => ({ source: e.from, target: e.to }));
  const sim = forceSimulation(nodes)
    .force('charge', forceManyBody<N>().strength(-600))
    .force('link', forceLink<N, (typeof links)[number]>(links).id((d) => d.id).distance(140).strength(0.2))
    .force('collide', forceCollide<N>((d) => (d.scale * PX) / 2 + 32))
    .force('x', forceX<N>(0).strength(0.05))
    .force('y', forceY<N>(0).strength(0.09)) // flatter than wide: the tilted camera squashes depth anyway
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();
  for (const n of nodes) [n.hx, n.hy] = [n.x!, n.y!];
  sim.force('x', forceX<N>((d) => d.hx).strength(0.1)).force('y', forceY<N>((d) => d.hy).strength(0.1)).force('charge', null).force('link', null).alpha(0);
  return { sim, nodes };
}

/** Centre and zoom the orthographic camera so every node, label and tooltip fits. */
function Fit({ nodes }: { nodes: N[] }) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const camera = get().camera;
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    camera.position.set(...CAMERA);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    const box = new THREE.Box2();
    for (const n of nodes) {
      const [x, z, r] = [n.hx / PX, n.hy / PX, n.scale * 0.75];
      for (const [px, py, pz] of [[x - r, 0, z], [x + r, 0, z], [x, 0, z + r + 0.6], [x, LIFT + n.scale * 1.6, z]]) {
        v.set(px, py, pz).applyMatrix4(camera.matrixWorldInverse);
        box.expandByPoint(new THREE.Vector2(v.x, v.y));
      }
    }
    const c = box.getCenter(new THREE.Vector2());
    const span = box.getSize(new THREE.Vector2());
    // Slide the camera within its view plane onto the layout's centre, then zoom to fit.
    camera.position.addScaledVector(v.setFromMatrixColumn(camera.matrixWorld, 0), c.x).addScaledVector(v.setFromMatrixColumn(camera.matrixWorld, 1), c.y);
    camera.zoom = Math.min(size.width / Math.max(span.x, 1), size.height / Math.max(span.y, 1)) * 0.9;
    camera.updateProjectionMatrix();
  }, [get, size, nodes]);
  return null;
}

function Scene() {
  const repo = useTavern((s) => s.repo)!;
  const graph = useTavern((s) => s.graph)!;
  const characters = useTavern((s) => s.characters);
  const moods = useTavern((s) => s.moods);
  const selected = useTavern((s) => s.selectedModuleId);
  const rippleFrom = useTavern((s) => s.rippleFrom);
  const bubbles = useTavern((s) => s.bubbles);
  const talk = useStage((s) => s.bubbles);
  const menu = useStage((s) => s.menu);
  const road = useStage((s) => s.road);
  const follow = useHood((s) => s.follow);
  const cutting = useHood((s) => s.cut);
  const reduced = !!useReducedMotion();
  const mods = repo.modules;
  const { sim, nodes } = useMemo(() => layout(mods, graph.edges), [mods, graph]);
  const arch = useMemo(() => new Map(assignCast(mods).map((c, i) => [mods[i].id, c.archetype])), [mods]);
  const nameOf = (id: string) => mods.find((m) => m.id === id)?.name ?? id;
  const index = useMemo(() => new Map(mods.map((m, i) => [m.id, i])), [mods]);
  // Both kinds of edge between the same pair: a ripple lights all of them and rides the first.
  const edgesOf = useMemo(() => {
    const m = new Map<string, number[]>();
    graph.edges.forEach((e, k) => m.set(`${e.from}>${e.to}`, [...(m.get(`${e.from}>${e.to}`) ?? []), k]));
    return (from: string, to: string) => m.get(`${from}>${to}`) ?? [];
  }, [graph]);
  const pathOf = (s: Step) => (s.dir === 'up' ? edgesOf(s.id, s.via) : edgesOf(s.via, s.id));
  const curves = useMemo(() => graph.edges.map(() => new THREE.QuadraticBezierCurve3()), [graph]);
  const radius = useMemo(() => Math.max(...nodes.map((n) => Math.hypot(n.hx, n.hy) / PX + n.scale)) + 2, [nodes]);

  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [card, setCard] = useState<{ k: number; at: [number, number, number] } | null>(null); // a clicked road: its lines, where it was clicked
  const [target, setTarget] = useState<string | null>(null); // the node a dragged one would land on
  const [flinching, setFlinching] = useState<string[]>([]);
  const steps = useMemo(() => (rippleFrom?.steps ?? []).filter((s) => index.has(s.id) && index.has(s.via)), [rippleFrom, index]); // one spark each
  useCursor(!!hovered || dragging, dragging ? 'grabbing' : 'grab');

  const outer = useRef<(THREE.Group | null)[]>([]); // ground position: shadow, rings, label
  const inner = useRef<(THREE.Group | null)[]>([]); // + bob: the face
  const lines = useRef<(QuadraticBezierLineRef | null)[]>([]);
  const hitLines = useRef<(QuadraticBezierLineRef | null)[]>([]); // invisible fat twins of every road, for hover and clicks
  const edgeTip = useRef<THREE.Group>(null);
  const arrows = useRef<(THREE.Mesh | null)[]>([]);
  const sparks = useRef<(THREE.Group | null)[]>([]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const hotRings = useRef<(THREE.Mesh | null)[]>([]);
  const drag = useRef<{ id: string; plane: THREE.Plane; dx: number; dz: number; x0: number; y0: number; moved: boolean } | null>(null);
  const drift = useRef<{ x: number; y: number; moving: boolean; slow: number }[]>([]); // per node: floating somewhere?
  const parcel = useRef<THREE.Group>(null);
  const trip = useRef<{ legs: Leg[]; i: number; t0: number; phase: 'move' | 'stop'; entry: string; done: number } | null>(null);
  const pulse = useRef<{ id: string; t0: number } | null>(null); // click: that node's edges throb once
  const ripple = useRef<{ from: string[]; t0: number; steps: Step[]; hit: Set<string>; edges: Set<number>; reduced: boolean } | null>(null);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Vector3(), d: new THREE.Vector3(), hit: new THREE.Vector3() }), []);

  useEffect(() => () => void sim.stop(), [sim]);
  // For the browser tests: where each node and each road's middle is on screen.
  const get = useThree((s) => s.get);
  useEffect(() => {
    const at = (p: THREE.Vector3) => {
      const { camera, size, gl } = get();
      const v = p.clone().project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return [Math.round(r.left + ((v.x + 1) / 2) * size.width), Math.round(r.top + ((1 - v.y) / 2) * size.height)];
    };
    (window as unknown as { __hoodPts?: unknown }).__hoodPts = () => ({
      nodes: Object.fromEntries(mods.map((m, i) => [m.id, at((outer.current[i]?.position ?? new THREE.Vector3()).clone().setY(LIFT + nodes[i].scale * 0.5))])),
      roads: graph.edges.map((e, k) => ({ from: e.from, to: e.to, kind: e.kind, at: at(curves[k].getPoint(0.5)) })),
    });
  }, [get, mods, nodes, graph, curves]);

  // An argument: the two float toward each other and meet on the road between them; home again after.
  useEffect(() => {
    const a = nodes.find((n) => n.id === road?.a), b = nodes.find((n) => n.id === road?.b);
    if (!a || !b) return;
    const was = [a.hx, a.hy, b.hx, b.hy];
    const dx = b.hx - a.hx, dy = b.hy - a.hy, k = Math.max(0, 0.5 - (((a.scale + b.scale) * PX) / 2 + 30) / 2 / Math.hypot(dx, dy));
    // d3 reads the home targets once, when a force is set: set them again.
    const rehome = () => sim.force('x', forceX<N>((d) => d.hx).strength(0.1)).force('y', forceY<N>((d) => d.hy).strength(0.1)).alpha(0.6);
    [a.hx, a.hy, b.hx, b.hy] = [a.hx + dx * k, a.hy + dy * k, b.hx - dx * k, b.hy - dy * k];
    rehome();
    return () => {
      [a.hx, a.hy, b.hx, b.hy] = was;
      rehome();
    };
  }, [road, nodes, sim]);

  /** The parcel arrives: the module does its thing, and the caption says how it got there. */
  const handle = (id: string, from: string | null) => {
    const how = HANDLES[arch.get(id) ?? 'clerk'];
    void getActor(`map:${id}`)?.play(how.clip, { priority: 2 });
    const ref = from ? graph.imports.find((r) => r.from === from && r.to === id) ?? graph.imports.find((r) => r.from === id && r.to === from) : null;
    const via = ref ? ` (${nameOf(ref.from)} ${ref.kind === 'calls' ? 'calls' : 'imports'} ${nameOf(ref.to!)} at ${where(ref)})` : '';
    useHood.setState({ caption: from ? `${nameOf(id)} ${how.line}.${via}` : `The request comes in at ${nameOf(id)}, which ${how.line}.` });
  };

  // Follow a request: the parcel starts at the entry point and visits every module in the tour's order, along the
  // roads of the tour's tree (back up and down again where it must); each one handles it in its own style.
  useEffect(() => {
    if (!follow) return void (trip.current = null);
    const { order, firstUnreachable, entry } = tourOrder(graph, mods);
    const reach = order.slice(0, firstUnreachable);
    const parent = new Map<string, string>();
    reach.forEach((id, j) => {
      const p = reach.slice(0, j).find((x) => graph.edges.some((e) => e.from === x && e.to === id));
      if (p) parent.set(id, p);
    });
    const up = (x: string) => {
      const out = [x];
      while (parent.has(out.at(-1)!)) out.push(parent.get(out.at(-1)!)!);
      return out;
    };
    const between = (a: string, b: string) => {
      const ks = graph.edges.map((e, k) => ((e.from === a && e.to === b) || (e.from === b && e.to === a) ? k : -1)).filter((k) => k >= 0);
      return ks.find((k) => graph.edges[k].kind === 'imports') ?? ks[0] ?? null;
    };
    const legs: Leg[] = [];
    let cur = entry;
    for (const id of reach.slice(1)) {
      const A = up(cur), B = up(id);
      const lca = A.find((x) => B.includes(x)) ?? cur;
      const path = [...A.slice(0, A.indexOf(lca) + 1), ...B.slice(0, B.indexOf(lca)).reverse()];
      path.slice(1).forEach((b, j) => legs.push({ a: path[j], b, k: between(path[j], b), handler: b === id }));
      cur = id;
    }
    trip.current = { legs, i: -1, t0: performance.now(), phase: 'stop', entry, done: 0 };
    handle(entry, null);
    const missed = order.slice(firstUnreachable).map(nameOf);
    const total = legs.filter((l) => l.handler).length * TRIP_STOP + legs.filter((l) => !l.handler).length * 150 + legs.length * TRIP_HOP + TRIP_STOP;
    const t = setTimeout(() => {
      useHood.setState({ caption: `Delivered: ${reach.length} ${reach.length === 1 ? 'module' : 'modules'} handled it.${missed.length ? ` Never reached: ${missed.join(', ')} (nothing on the way imports ${missed.length === 1 ? 'it' : 'them'}).` : ''}` });
    }, reduced ? TRIP_STOP * (legs.filter((l) => l.handler).length + 1) : total);
    return () => clearTimeout(t);
  }, [follow]); // eslint-disable-line react-hooks/exhaustive-deps -- one plan per request

  // ripple(): sparks travel hop by hop from the source(s): `up` to modules that import or call them, `down` to
  // modules they call. Reduced motion: no sparks or flinches, the whole path just lights up.
  useEffect(() => {
    if (!rippleFrom) return;
    const edges = new Set(reduced ? steps.flatMap(pathOf) : []);
    const hit = new Set(reduced ? steps.map((s) => s.id) : []);
    ripple.current = { from: rippleFrom.ids, t0: performance.now(), steps, hit, edges, reduced };
    return () => void (ripple.current = null);
  }, [rippleFrom, steps, reduced]); // eslint-disable-line react-hooks/exhaustive-deps -- pathOf only reads edgesOf

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    const now = performance.now();
    // ~60 layout ticks a second whatever the frame rate, so the float home takes the same time everywhere.
    for (let i = Math.min(4, Math.round(delta * 60)); i > 0 && sim.alpha() > sim.alphaMin(); i--) sim.tick();

    // Nodes: layout position + a slow drift and bob that never stops (slower for tired ones).
    nodes.forEach((n, i) => {
      const o = outer.current[i];
      const inn = inner.current[i];
      if (!o || !inn) return;
      const m = mods[i];
      const speed = moods[m.id] === 'guilty' || moods[m.id] === 'fainted' || faceTraits(m.stats).sweaty ? 0.45 : 1;
      const ph = i * 1.7;
      const still = reduced || drag.current?.id === m.id;
      o.position.set(n.x! / PX + (still ? 0 : 0.14 * Math.sin(t * 0.5 * speed + ph)), 0, n.y! / PX + (still ? 0 : 0.1 * Math.cos(t * 0.37 * speed + ph * 1.3)));
      inn.position.y = reduced ? 0 : 0.12 * (1 + Math.sin(t * 1.5 * speed + ph));
      // Drifting somewhere (floating home, meeting for an argument): takeoff, its float style, a squash on landing.
      const d = (drift.current[i] ??= { x: n.x!, y: n.y!, moving: false, slow: 0 });
      const v = Math.hypot(n.x! - d.x, n.y! - d.y) / PX / Math.max(delta, 1e-3);
      [d.x, d.y] = [n.x!, n.y!];
      const a = getActor(`map:${m.id}`);
      if (!reduced && !d.moving && v > 1.2 && drag.current?.id !== m.id) {
        d.moving = true;
        void a?.play('takeoff', { priority: 0 }).then(() => d.moving && a.play('floats', { priority: 0 }));
      } else if (d.moving && v < 0.3) {
        if ((d.slow += delta) > 0.3) {
          Object.assign(d, { moving: false, slow: 0 });
          a?.stopLoop('floats');
          void a?.play('land', { priority: 0 });
        }
      } else d.slow = 0;
    });

    // The parcel: rides the road during a hop, hovers over the module handling it.
    const tr = trip.current;
    const pc = parcel.current;
    if (pc) pc.visible = !!tr && tr.i < tr.legs.length;
    if (tr && pc && tr.i < tr.legs.length) {
      const el = now - tr.t0;
      const leg = tr.legs[tr.i];
      const over = (id: string) => {
        const i = index.get(id)!;
        const o = outer.current[i]?.position;
        if (o) pc.position.set(o.x, LIFT + nodes[i].scale * 1.25 + 0.08 * Math.sin(t * 4), o.z);
      };
      if (tr.phase === 'stop') {
        over(leg ? leg.b : tr.entry);
        if (el > (!leg || leg.handler ? TRIP_STOP : 150)) Object.assign(tr, { i: tr.i + 1, t0: now, phase: 'move' });
      } else {
        const p = reduced ? 1 : Math.min(1, el / TRIP_HOP);
        const e = leg.k === null ? null : graph.edges[leg.k];
        if (e && leg.k !== null) {
          curves[leg.k].getPoint(e.from === leg.a ? p : 1 - p, pc.position);
          pc.position.y += 0.35 + Math.sin(Math.PI * p) * 0.4;
        } else {
          const A = outer.current[index.get(leg.a)!]?.position, B = outer.current[index.get(leg.b)!]?.position;
          if (A && B) pc.position.lerpVectors(A, B, p).setY(0.4 + Math.sin(Math.PI * p) * 1.5);
        }
        if (p >= 1) {
          Object.assign(tr, { t0: now, phase: 'stop' });
          if (leg.handler) handle(leg.b, leg.a);
        }
      }
      pc.rotation.y = t * 1.6;
    }

    // Edges: ground-level curves from importer to imported, stopping at each node's rim; arrow at the imported end.
    graph.edges.forEach((e, k) => {
      const ia = index.get(e.from)!;
      const ib = index.get(e.to)!;
      const A = outer.current[ia]?.position;
      const B = outer.current[ib]?.position;
      if (!A || !B) return;
      tmp.d.set(B.x - A.x, 0, B.z - A.z);
      const len = tmp.d.length();
      tmp.d.normalize();
      const ra = nodes[ia].scale * 0.42;
      const rb = nodes[ib].scale * 0.42 + 0.05;
      const c = curves[k];
      c.v0.set(A.x + tmp.d.x * ra, 0.06, A.z + tmp.d.z * ra);
      c.v2.set(B.x - tmp.d.x * rb, 0.06, B.z - tmp.d.z * rb);
      // Bend sideways (A→B and B→A bend apart; calls bend further than imports) and slightly up.
      const bend = e.kind === 'calls' ? 0.22 : 0.12;
      c.v1.set((c.v0.x + c.v2.x) / 2 - tmp.d.z * len * bend, 0.2 + len * 0.05, (c.v0.z + c.v2.z) / 2 + tmp.d.x * len * bend);
      const line = lines.current[k];
      line?.setPoints(c.v0, c.v2, c.v1);
      if (e.kind === 'calls') line?.computeLineDistances(); // dashes follow the new length
      hitLines.current[k]?.setPoints(c.v0, c.v2, c.v1);
      if (k === hoveredEdge) c.getPoint(0.5, edgeTip.current?.position ?? tmp.m);
      const arrow = arrows.current[k];
      if (arrow) {
        const tan = c.getTangent(1, tmp.a);
        arrow.position.copy(c.v2).addScaledVector(tan, -0.14);
        arrow.quaternion.setFromUnitVectors(UP, tan);
      }
    });

    // Ripple: one spark per reached module, riding its edge during its hop; a ring on each module hit.
    const r = ripple.current;
    const el = r ? now - r.t0 : 0;
    if (r && !r.reduced) {
      r.steps.forEach((s, j) => {
        const path = pathOf(s);
        const k = path[0];
        const p = Math.min(1, Math.max(0, (el - (s.hops - 1) * HOP_MS) / HOP_MS));
        const sp = sparks.current[j];
        if (sp && k !== undefined) {
          sp.visible = p > 0 && p < 1;
          // Curves run importer/caller → imported/called: up travels backwards along them, down forwards.
          if (sp.visible) curves[k].getPoint(s.dir === 'up' ? 1 - p : p, sp.position);
        }
        if (p > 0) path.forEach((x) => r.edges.add(x));
        if (p >= 1 && !r.hit.has(s.id)) {
          r.hit.add(s.id);
          setFlinching((f) => [...f, s.id]);
          setTimeout(() => setFlinching((f) => f.filter((x) => x !== s.id)), 450);
        }
      });
    }
    (r?.from ?? []).forEach((id, j) => {
      const ring = rings.current[j];
      const src = outer.current[index.get(id) ?? -1];
      if (!ring || !src) return;
      const q = Math.min(1, el / 700);
      ring.visible = !r!.reduced && q < 1;
      ring.position.set(src.position.x, 0.03, src.position.z);
      ring.scale.setScalar(0.5 + q * 2.5);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - q);
    });
    mods.forEach((m, i) => {
      const hr = hotRings.current[i];
      if (hr) hr.visible = (!!r && (r.hit.has(m.id) || (r.reduced && r.from.includes(m.id)))) || target === m.id;
    });

    // Edge styling: ripple > hover > click pulse > resting.
    const pul = pulse.current ? Math.sin(Math.PI * Math.min(1, (now - pulse.current.t0) / 900)) : 0;
    if (pulse.current && now - pulse.current.t0 > 900) pulse.current = null;
    graph.edges.forEach((e, k) => {
      const line = lines.current[k];
      if (!line) return;
      const hov = (!!hovered && (e.from === hovered || e.to === hovered)) || hoveredEdge === k || card?.k === k;
      const throb = pulse.current && (e.from === pulse.current.id || e.to === pulse.current.id) ? pul : 0;
      // Lit: a ripple, an argument on this road (or one about to start: a node held over another), a cut being aimed.
      const pair = road ?? (target && drag.current ? { a: drag.current.id, b: target } : null);
      const fight = !!pair && ((e.from === pair.a && e.to === pair.b) || (e.from === pair.b && e.to === pair.a));
      const hot = !!ripple.current?.edges.has(k) || fight || (cutting && (hoveredEdge === k || card?.k === k));
      const carrying = !!trip.current && trip.current.legs[trip.current.i]?.k === k && trip.current.phase === 'move';
      const calls = e.kind === 'calls';
      const color = hot ? HOT : carrying ? AMBER : hov || throb ? (calls ? CALL_DARK : INK) : hovered || hoveredEdge !== null ? FAINT : calls ? CALL : EDGE;
      const mat = line.material;
      mat.color.set(color);
      mat.linewidth = (1.2 + Math.min(e.weight, 5) * 0.9) * (1 + 1.4 * throb) * (hov || hot || carrying ? 1.35 : 1) * (fight ? 1.6 : 1);
      (arrows.current[k]?.material as THREE.MeshStandardMaterial | undefined)?.color.set(color);
    });
  });

  const neighbours = useMemo(() => {
    if (!hovered) return null;
    return new Set([hovered, ...graph.edges.flatMap((e) => (e.from === hovered ? [e.to] : e.to === hovered ? [e.from] : []))]);
  }, [hovered, graph]);

  const down = (e: ThreeEvent<PointerEvent>, n: N) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    // Drag on a plane at face height, keeping the grab offset, so the node doesn't jump under the pointer.
    const plane = new THREE.Plane(UP, -(LIFT + n.scale / 2));
    if (!e.ray.intersectPlane(plane, tmp.hit)) return;
    drag.current = { id: n.id, plane, dx: n.x! / PX - tmp.hit.x, dz: n.y! / PX - tmp.hit.z, x0: n.x!, y0: n.y!, moved: false };
    n.fx = n.x;
    n.fy = n.y;
    // The held node passes over the others instead of shoving them, so it can be dropped on one.
    sim.force('collide', null).alphaTarget(0.3).alpha(Math.max(sim.alpha(), 0.3));
    setDragging(true);
  };
  /** The node a held one is over (its centre inside the other's circle), if any. */
  const under = (n: N) => nodes.find((o) => o !== n && Math.hypot(o.x! - n.x!, o.y! - n.y!) < (o.scale * PX) / 2 + 18)?.id ?? null;
  const move = (e: ThreeEvent<PointerEvent>, n: N) => {
    const d = drag.current;
    if (d?.id !== n.id || !e.ray.intersectPlane(d.plane, tmp.hit)) return;
    n.fx = (tmp.hit.x + d.dx) * PX;
    n.fy = (tmp.hit.z + d.dz) * PX;
    if (!d.moved && Math.hypot(n.fx - d.x0, n.fy - d.y0) > 8) {
      d.moved = true;
      void getActor(`map:${n.id}`)?.play('dangle', { priority: 3 });
    }
    const over = under(n);
    if (over !== target) setTarget(over);
  };
  const up = (e: ThreeEvent<PointerEvent>, n: N) => {
    const d = drag.current;
    if (d?.id !== n.id) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    drag.current = null;
    const onto = d.moved ? under(n) : null;
    n.fx = n.fy = null;
    sim.force('collide', forceCollide<N>((x) => (x.scale * PX) / 2 + 32)).alphaTarget(0).alpha(0.8);
    getActor(`map:${n.id}`)?.stopLoop('dangle');
    setDragging(false);
    setTarget(null);
    // Dropped on another character: an argument on the road between them.
    if (onto) void stageDo('argue', n.id, onto);
  };

  return (
    <>
      <color attach="background" args={['#fbfaf8']} />
      <CastLights />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01} onClick={() => setCard(null)}>
        <circleGeometry args={[radius, 72]} />
        <meshBasicMaterial color="#f2efe9" toneMapped={false} />
      </mesh>

      {graph.edges.map((e, k) => (
        <group key={`${e.from}>${e.to}>${e.kind}`}>
          <QuadraticBezierLine
            ref={(el) => void (lines.current[k] = el)}
            start={[0, 0, 0]}
            end={[0, 0, 0]}
            color={e.kind === 'calls' ? CALL : EDGE}
            lineWidth={1.5}
            dashed={e.kind === 'calls'}
            dashSize={0.22}
            gapSize={0.16}
          />
          <QuadraticBezierLine
            ref={(el) => void (hitLines.current[k] = el)}
            start={[0, 0, 0]}
            end={[0, 0, 0]}
            lineWidth={16}
            transparent
            opacity={0}
            depthWrite={false}
            onPointerOver={(ev) => (ev.stopPropagation(), setHoveredEdge(k))}
            onPointerOut={() => setHoveredEdge((h) => (h === k ? null : h))}
            onClick={(ev) => (ev.stopPropagation(), setCard({ k, at: [ev.point.x, ev.point.y, ev.point.z] }))}
          />
          <mesh ref={(el) => void (arrows.current[k] = el)}>
            <coneGeometry args={[0.1 + Math.min(e.weight, 5) * 0.02, 0.3, 12]} />
            <meshStandardMaterial color={e.kind === 'calls' ? CALL : EDGE} />
          </mesh>
        </group>
      ))}
      {card && graph.edges[card.k] && (
        // Pinned where the road was clicked, so it holds still while the town bobs.
        <group position={card.at}>
          <Dom z={6} clamp>
            <RoadCard e={graph.edges[card.k]} cut={cutting} onClose={() => setCard(null)} />
          </Dom>
        </group>
      )}
      {!card && hoveredEdge !== null && graph.edges[hoveredEdge] && (
        <group ref={edgeTip}>
          <Dom z={6} clamp>
            {(() => {
                const e = graph.edges[hoveredEdge!];
                const name = (id: string) => mods.find((m) => m.id === id)?.name ?? id;
                return (
                  <div className="rounded-lg border border-edge bg-panel px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md">
                    <div className="font-medium text-cream">{e.kind === 'calls' ? 'talks over the network' : 'imports'}</div>
                    <div className="font-mono text-muted">
                      {name(e.from)} → {name(e.to)} · {e.weight} {e.kind === 'calls' ? (e.weight === 1 ? 'call site' : 'call sites') : e.weight === 1 ? 'import' : 'imports'}
                    </div>
                    <div className="text-muted">{cutting ? 'Click to cut this road.' : 'Click for the exact lines.'}</div>
                  </div>
                );
              })()}
          </Dom>
        </group>
      )}
      <group ref={parcel} visible={false}>
        <mesh>
          <boxGeometry args={[0.34, 0.26, 0.34]} />
          <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={0.55} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.46, 16, 12]} />
          <meshBasicMaterial color="#ffd166" transparent opacity={0.28} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>

      {steps.map((s, j) => (
        <group key={`${rippleFrom?.at}-${s.id}`} ref={(el) => void (sparks.current[j] = el)} visible={false}>
          <mesh>
            <sphereGeometry args={[0.13, 16, 12]} />
            <meshBasicMaterial color={HOT} toneMapped={false} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.3, 16, 12]} />
            <meshBasicMaterial color={HOT} transparent opacity={0.25} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {(rippleFrom?.ids ?? []).map((id, j) => (
        <mesh key={`${rippleFrom?.at}-${id}`} ref={(el) => void (rings.current[j] = el)} rotation-x={-Math.PI / 2} visible={false}>
          <ringGeometry args={[0.9, 1, 64]} />
          <meshBasicMaterial color={HOT} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      ))}

      {mods.map((m, i) => {
        const n = nodes[i];
        const char = characters[m.id];
        const deps = dependenciesOf(graph, m.id, { calls: false }).length;
        const users = dependentsOf(graph, m.id, { calls: false }).length;
        const calls = dependenciesOf(graph, m.id).length - deps;
        const callers = dependentsOf(graph, m.id).length - users;
        const pkgs = graph.external[m.id]?.length ?? 0;
        return (
          <group
            key={m.id}
            ref={(el) => void (outer.current[i] = el)}
            position={[n.hx / PX, 0, n.hy / PX]}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHovered(m.id);
            }}
            onPointerOut={() => setHovered((h) => (h === m.id ? null : h))}
            onPointerDown={(e) => down(e, n)}
            onPointerMove={(e) => move(e, n)}
            onPointerUp={(e) => up(e, n)}
          >
            <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
              <circleGeometry args={[n.scale * 0.3, 32]} />
              <meshBasicMaterial color="#000" transparent opacity={0.07} depthWrite={false} toneMapped={false} />
            </mesh>
            {selected === m.id && (
              <mesh rotation-x={-Math.PI / 2} position-y={0.012}>
                <ringGeometry args={[n.scale * 0.5, n.scale * 0.5 + 0.07, 48]} />
                <meshBasicMaterial color={INK} toneMapped={false} />
              </mesh>
            )}
            <mesh ref={(el) => void (hotRings.current[i] = el)} rotation-x={-Math.PI / 2} position-y={0.018} visible={false}>
              <ringGeometry args={[n.scale * 0.58, n.scale * 0.58 + 0.09, 48]} />
              <meshBasicMaterial color={HOT} toneMapped={false} />
            </mesh>
            <group ref={(el) => void (inner.current[i] = el)}>
              <MapNode
                module={m}
                cast={mods}
                stats={m.stats}
                mood={moods[m.id]}
                talking={moods[m.id] === 'talking'}
                position={[0, LIFT + n.scale / 2, 0]}
                scale={n.scale}
                color={char?.color}
                flinch={flinching.includes(m.id)}
                dimmed={!!neighbours && !neighbours.has(m.id)}
                onClick={(e) => {
                  if (e.delta > 6) return; // that was a drag
                  useTavern.getState().selectModule(m.id);
                  pulse.current = { id: m.id, t0: performance.now() };
                  void stageDo('poke', m.id);
                  useStage.setState({ menu: m.id }); // the same click menu as on the stage
                }}
              />
              {menu === m.id && (
                <Dom position={[0, LIFT + n.scale * 0.6, 0]} z={7} keepIn={[190, 110]}>
                  <Menu id={m.id} />
                </Dom>
              )}
              {hovered === m.id && !dragging && menu !== m.id && !talk[m.id] && (
                <Dom position={[0, LIFT + n.scale + 0.1, 0]} z={3} clamp>
                  <div className="-translate-y-1/2 rounded-lg border border-edge bg-panel px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md">
                    <div className="font-medium text-cream">{char?.name ?? m.name}</div>
                    <div className="font-mono text-muted">{statsLine(m.stats)}</div>
                    <div className="font-mono text-muted">
                      imports {deps} {deps === 1 ? 'module' : 'modules'} · imported by {users}
                      {pkgs ? ` · ${pkgs} ${pkgs === 1 ? 'package' : 'packages'}` : ''}
                    </div>
                    {calls + callers > 0 && (
                      <div className="font-mono text-muted">
                        over the network: calls {calls} · called by {callers}
                      </div>
                    )}
                  </div>
                </Dom>
              )}
              {talk[m.id] && menu !== m.id ? (
                <Dom position={[0, LIFT + n.scale + 0.1, 0]} z={5} clamp>
                  <MapBubble id={m.id} b={talk[m.id]} />
                </Dom>
              ) : (
                bubbles[m.id] &&
                !(hovered === m.id && !dragging) && (
                  <Dom position={[0, LIFT + n.scale + 0.1, 0]} z={4} clamp>
                    <div className="w-max max-w-60 -translate-y-1/2 rounded-2xl rounded-bl-sm border border-edge bg-panel px-2.5 py-1.5 text-xs leading-snug text-cream shadow-md">
                      {bubbles[m.id]}
                    </div>
                  </Dom>
                )
              )}
            </group>
            <Dom position={[0, 0, n.scale * 0.42 + 0.35]} z={1}>
              <div
                className={`rounded-full px-2 font-mono text-xs whitespace-nowrap transition-opacity ${
                  selected === m.id ? 'bg-amber text-ink' : 'bg-panel/80 text-cream'
                } ${neighbours && !neighbours.has(m.id) ? 'opacity-25' : ''}`}
              >
                {m.name}
              </div>
            </Dom>
          </group>
        );
      })}
      <Fit nodes={nodes} />
    </>
  );
}

/** A clicked road: the exact import or call lines behind it (from the import graph, no AI); a line opens in Code. */
function RoadCard({ e, cut, onClose }: { e: Edge; cut: boolean; onClose: () => void }) {
  const repo = useTavern((s) => s.repo)!;
  const graph = useTavern((s) => s.graph)!;
  const name = (id: string) => repo.modules.find((m) => m.id === id)?.name ?? id;
  const refs = graph.imports.filter((r) => r.from === e.from && r.to === e.to && r.kind === e.kind);
  const code = (r: ImportRef) => repo.files.find((f) => f.path === r.file)?.content.split('\n')[r.line - 1]?.trim() ?? '';
  const open = (r: ImportRef) => {
    const s = useTavern.getState();
    s.highlightCitation({ path: r.file, startLine: r.line, endLine: r.kind === 'calls' ? r.line : Math.max(r.line, r.endLine) });
    s.setView('code');
  };
  const verb = e.kind === 'calls' ? 'calls' : 'imports';
  const cutIt = () => {
    const r = refs[0];
    if (!r) return;
    const A = name(e.from), B = name(e.to);
    useTavern.getState().openWhatIf({
      kind: 'describe',
      title: `Cut the road from ${A} to ${B}`,
      description: `Remove the dependency from ${A} to ${B}: ${A} stops ${e.kind === 'calls' ? 'calling' : 'importing'} ${B}. Delete the ${e.kind === 'calls' ? 'call' : 'import'} at ${where(r)} and change ${A}'s code so it works without ${B}.`,
      path: r.file,
      startLine: r.line,
      endLine: r.kind === 'calls' ? r.line : Math.max(r.line, r.endLine),
    });
    useHood.setState({ cut: false });
    onClose();
  };
  return (
    <div className="pointer-events-auto w-80 rounded-xl border border-edge bg-panel p-2.5 text-xs shadow-lg" onPointerDown={(ev) => ev.stopPropagation()}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-cream">
            {name(e.from)} {verb} {name(e.to)}
          </div>
          <div className="text-muted">
            {e.weight} {e.kind === 'calls' ? (e.weight === 1 ? 'call site' : 'call sites') : e.weight === 1 ? 'import' : 'imports'}
            {e.kind === 'calls' ? ' · spotted by a heuristic (a service lookup or URL), not an import' : ''}
          </div>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded p-0.5 text-muted hover:bg-wood hover:text-cream">
          <X size={13} />
        </button>
      </div>
      {cut ? (
        <div className="mt-2">
          <p className="text-cream">
            Cut it: What-if writes the change that removes this dependency{refs[0] ? ` at ${where(refs[0])}` : ''}, then shows who it hits.
          </p>
          <button type="button" onClick={cutIt} disabled={!refs.length} className="mt-2 flex items-center gap-1 rounded-full bg-tomato px-3 py-1 font-medium text-white disabled:opacity-50">
            <Scissors size={12} /> Cut this road
          </button>
        </div>
      ) : (
        <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
          {refs.slice(0, 12).map((r) => (
            <li key={`${r.file}:${r.line}`}>
              <button type="button" onClick={() => open(r)} className="w-full rounded-md border border-edge px-2 py-1 text-left hover:border-amber hover:bg-wood">
                <div className="font-mono text-[11px] text-muted">{where(r)}</div>
                <div className="truncate font-mono text-[11px] text-cream">{code(r)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A speech bubble from the stage's scenes (an answer streaming in, gossip, an argument), over its node. */
function MapBubble({ id, b }: { id: string; b: Bubble }) {
  const live = useTavern((s) => (b.msg ? s.chats[b.msg.mod]?.find((x) => x.id === b.msg!.id) : undefined));
  const files = useTavern((s) => s.repo?.files ?? []);
  const name = useTavern((s) => s.characters[id]?.name ?? id);
  if (live?.role === 'system') return null;
  const body = (live ? live.text : b.text).replace(/\[[^\]\n]*$/, '');
  const short = body.length > 280 ? body.slice(0, 280).replace(/\s+\S*$/, '') + '…' : body;
  return (
    <div className="pointer-events-auto w-72 -translate-y-1/2 rounded-2xl rounded-bl-sm border-2 border-cream bg-white px-3 py-2 text-xs leading-snug text-cream shadow-[3px_3px_0_rgba(0,0,0,0.85)]">
      <div className="text-[11px] font-semibold text-muted">{name}</div>
      {short ? <Rich text={short} files={files} /> : <span className="text-muted">…</span>}
    </div>
  );
}

/** The import graph as a floating town: drag, hover, click for the menu, roads, a request to follow, ripple(). Lazy-loaded; never server-rendered. */
export default function MapView() {
  const repo = useTavern((s) => s.repo);
  const graph = useTavern((s) => s.graph);
  const selected = useTavern((s) => s.selectedModuleId);
  const rippleFrom = useTavern((s) => s.rippleFrom);
  const follow = useHood((s) => s.follow);
  const cut = useHood((s) => s.cut);
  const said = useHood((s) => s.caption);
  // Leaving the Neighbourhood closes its menu and stops the parcel; expired bubbles go (the stage isn't running here).
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      const b = useStage.getState().bubbles;
      if (Object.values(b).some((x) => x.until && x.until < now)) useStage.setState({ bubbles: Object.fromEntries(Object.entries(b).filter(([, x]) => !x.until || x.until >= now)) });
    }, 500);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && useHood.setState({ cut: false });
    window.addEventListener('keydown', esc);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', esc);
      useStage.setState({ menu: null });
      useHood.setState({ follow: null, cut: false, caption: null });
    };
  }, []);
  // The request's last caption stays a few seconds after the trip.
  useEffect(() => {
    if (!said || !said.startsWith('Delivered')) return;
    const t = setTimeout(() => useHood.setState({ follow: null, caption: null }), 5000);
    return () => clearTimeout(t);
  }, [said]);
  // Say where the ripple went; "nothing imports or calls X" is a real answer, not a broken animation.
  const caption = useMemo(() => {
    if (!rippleFrom || !graph || !repo) return null;
    if (rippleFrom.label) return rippleFrom.label;
    const name = (id: string) => repo.modules.find((m) => m.id === id)?.name ?? id;
    const st = rippleFrom.steps ?? [];
    const hops = Math.max(0, ...st.map((s) => s.hops));
    const from = rippleFrom.ids.map(name).join(' and ');
    return st.length
      ? `If ${from} breaks, ${st.map((s) => name(s.id)).join(', ')} feel it, up to ${hops} ${hops === 1 ? 'hop' : 'hops'} out.`
      : `Nothing imports or calls ${from}. The ripple stops there.`;
  }, [rippleFrom, graph, repo]);

  if (!repo || !graph) return null;
  const busiest = [...repo.modules].sort((a, b) => dependentsOf(graph, b.id).length - dependentsOf(graph, a.id).length)[0];
  return (
    <div className={`relative isolate h-full w-full overflow-hidden bg-[#fbfaf8] ${cut ? 'cursor-crosshair' : ''}`}>
      {/* The shared cast canvas, kept on when 3D characters are off: the map still works, with 2D faces. */}
      <CastCanvas keep orthographic camera={{ position: CAMERA, zoom: 40, near: 0.1, far: 200 }}>
        <Scene />
      </CastCanvas>
      <DomLayer />
      <CastFallbackNote className="absolute bottom-3 left-3" />
      {(said ?? caption) && (
        <div role="status" className="pointer-events-none absolute top-12 left-1/2 max-w-[80%] -translate-x-1/2 rounded-2xl border border-edge bg-panel px-3 py-1 text-center text-sm text-cream shadow-sm">
          {said ?? caption}
        </div>
      )}
      <div className="absolute top-3 right-3 flex gap-1.5">
        <button
          type="button"
          disabled={!!follow}
          onClick={() => useHood.setState({ follow: Date.now(), cut: false, caption: null })}
          className="flex items-center gap-1.5 rounded-full border border-edge bg-panel px-3 py-1 text-xs font-medium text-cream shadow-sm hover:border-amber disabled:opacity-60"
        >
          <Package size={13} /> Follow a request
        </button>
        <button
          type="button"
          aria-pressed={cut}
          onClick={() => useHood.setState({ cut: !cut })}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-sm ${cut ? 'border-tomato bg-tomato text-white' : 'border-edge bg-panel text-cream hover:border-amber'}`}
        >
          <Scissors size={13} /> {cut ? 'Pick a road to cut (Esc to stop)' : 'Cut a road'}
        </button>
      </div>
      <div className="pointer-events-none absolute right-3 bottom-3 text-xs text-muted">
        Roads point at what a module imports (solid) or calls over the network (dashed). Click a road for its lines; drop a character on another to start an argument.
      </div>
      {process.env.NODE_ENV !== 'production' && (
        <button
          type="button"
          onClick={() => useTavern.getState().ripple(selected ?? busiest.id)}
          className="absolute top-12 right-3 rounded-full border border-dashed border-tomato px-3 py-1 text-xs text-tomato hover:bg-tomato/10"
        >
          Test ripple (dev)
        </button>
      )}
    </div>
  );
}
