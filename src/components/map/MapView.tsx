'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { QuadraticBezierLine, useCursor, type QuadraticBezierLineRef } from '@react-three/drei';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import * as THREE from 'three';
import { useReducedMotion } from 'framer-motion';
import { RIPPLE_HOP_MS as HOP_MS, useTavern, type RippleStep as Step } from '@/lib/store';
import { dependenciesOf, dependentsOf, type Edge } from '@/lib/graph';
import { faceTraits, sizeOf, statsLine } from '@/lib/characters';
import type { Module } from '@/lib/types';
import MapNode from './MapNode';
import { Dom, DomLayer } from './Dom';

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

/** d3-force in 2D, run to rest. Afterwards only a pull home (and collisions) stays on; charge and links come back
 *  while dragging, so the others shove aside and everything floats back to the same layout on release. */
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
  const shove = { charge: sim.force('charge')!, link: sim.force('link')! };
  sim.force('x', forceX<N>((d) => d.hx).strength(0.1)).force('y', forceY<N>((d) => d.hy).strength(0.1)).force('charge', null).force('link', null).alpha(0);
  return { sim, nodes, shove };
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
  const reduced = !!useReducedMotion();
  const mods = repo.modules;
  const { sim, nodes, shove } = useMemo(() => layout(mods, graph.edges), [mods, graph]);
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
  const [flinching, setFlinching] = useState<string[]>([]);
  const steps = useMemo(() => (rippleFrom?.steps ?? []).filter((s) => index.has(s.id) && index.has(s.via)), [rippleFrom, index]); // one spark each
  useCursor(!!hovered || dragging, dragging ? 'grabbing' : 'grab');

  const outer = useRef<(THREE.Group | null)[]>([]); // ground position: shadow, rings, label
  const inner = useRef<(THREE.Group | null)[]>([]); // + bob: the face
  const lines = useRef<(QuadraticBezierLineRef | null)[]>([]);
  const hitLines = useRef<(QuadraticBezierLineRef | null)[]>([]); // invisible fat twins of "calls" edges, for hover
  const edgeTip = useRef<THREE.Group>(null);
  const arrows = useRef<(THREE.Mesh | null)[]>([]);
  const sparks = useRef<(THREE.Group | null)[]>([]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const hotRings = useRef<(THREE.Mesh | null)[]>([]);
  const drag = useRef<{ id: string; plane: THREE.Plane; dx: number; dz: number } | null>(null);
  const pulse = useRef<{ id: string; t0: number } | null>(null); // click: that node's edges throb once
  const ripple = useRef<{ from: string[]; t0: number; steps: Step[]; hit: Set<string>; edges: Set<number>; reduced: boolean } | null>(null);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Vector3(), d: new THREE.Vector3(), hit: new THREE.Vector3() }), []);

  useEffect(() => () => void sim.stop(), [sim]);

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
    });

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
      if (e.kind === 'calls') {
        line?.computeLineDistances(); // dashes follow the new length
        hitLines.current[k]?.setPoints(c.v0, c.v2, c.v1);
        if (k === hoveredEdge) c.getPoint(0.5, edgeTip.current?.position ?? tmp.m);
      }
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
      if (hr) hr.visible = !!r && (r.hit.has(m.id) || (r.reduced && r.from.includes(m.id)));
    });

    // Edge styling: ripple > hover > click pulse > resting.
    const pul = pulse.current ? Math.sin(Math.PI * Math.min(1, (now - pulse.current.t0) / 900)) : 0;
    if (pulse.current && now - pulse.current.t0 > 900) pulse.current = null;
    graph.edges.forEach((e, k) => {
      const line = lines.current[k];
      if (!line) return;
      const hov = (!!hovered && (e.from === hovered || e.to === hovered)) || hoveredEdge === k;
      const throb = pulse.current && (e.from === pulse.current.id || e.to === pulse.current.id) ? pul : 0;
      const hot = !!ripple.current?.edges.has(k);
      const calls = e.kind === 'calls';
      const color = hot ? HOT : hov || throb ? (calls ? CALL_DARK : INK) : hovered || hoveredEdge !== null ? FAINT : calls ? CALL : EDGE;
      const mat = line.material;
      mat.color.set(color);
      mat.linewidth = (1.2 + Math.min(e.weight, 5) * 0.9) * (1 + 1.4 * throb) * (hov || hot ? 1.35 : 1);
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
    drag.current = { id: n.id, plane, dx: n.x! / PX - tmp.hit.x, dz: n.y! / PX - tmp.hit.z };
    n.fx = n.x;
    n.fy = n.y;
    sim.force('charge', shove.charge).force('link', shove.link).alphaTarget(0.3).alpha(Math.max(sim.alpha(), 0.3));
    setDragging(true);
  };
  const move = (e: ThreeEvent<PointerEvent>, n: N) => {
    const d = drag.current;
    if (d?.id !== n.id || !e.ray.intersectPlane(d.plane, tmp.hit)) return;
    n.fx = (tmp.hit.x + d.dx) * PX;
    n.fy = (tmp.hit.z + d.dz) * PX;
  };
  const up = (e: ThreeEvent<PointerEvent>, n: N) => {
    if (drag.current?.id !== n.id) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    drag.current = null;
    n.fx = n.fy = null;
    sim.force('charge', null).force('link', null).alphaTarget(0).alpha(0.8);
    setDragging(false);
  };

  return (
    <>
      <color attach="background" args={['#fbfaf8']} />
      <ambientLight intensity={1.5} />
      <directionalLight position={[4, 10, 6]} intensity={1.2} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <circleGeometry args={[radius, 72]} />
        <meshBasicMaterial color="#f2efe9" />
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
          {e.kind === 'calls' && (
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
            />
          )}
          <mesh ref={(el) => void (arrows.current[k] = el)}>
            <coneGeometry args={[0.1 + Math.min(e.weight, 5) * 0.02, 0.3, 12]} />
            <meshStandardMaterial color={e.kind === 'calls' ? CALL : EDGE} />
          </mesh>
        </group>
      ))}
      {hoveredEdge !== null && graph.edges[hoveredEdge] && (
        <group ref={edgeTip}>
          <Dom z={3} clamp>
            {(() => {
              const e = graph.edges[hoveredEdge];
              const site = graph.imports.find((r) => r.kind === 'calls' && r.from === e.from && r.to === e.to);
              const name = (id: string) => mods.find((m) => m.id === id)?.name ?? id;
              return (
                <div className="rounded-lg border border-edge bg-panel px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md">
                  <div className="font-medium text-cream">talks over the network</div>
                  <div className="font-mono text-muted">
                    {name(e.from)} → {name(e.to)} · {e.weight} call {e.weight === 1 ? 'site' : 'sites'}
                    {site ? ` · ${site.file}:${site.line}` : ''}
                  </div>
                  <div className="text-muted">Spotted by a heuristic (service lookup or URL), not an import.</div>
                </div>
              );
            })()}
          </Dom>
        </group>
      )}

      {steps.map((s, j) => (
        <group key={`${rippleFrom?.at}-${s.id}`} ref={(el) => void (sparks.current[j] = el)} visible={false}>
          <mesh>
            <sphereGeometry args={[0.13, 16, 12]} />
            <meshBasicMaterial color={HOT} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.3, 16, 12]} />
            <meshBasicMaterial color={HOT} transparent opacity={0.25} depthWrite={false} />
          </mesh>
        </group>
      ))}
      {(rippleFrom?.ids ?? []).map((id, j) => (
        <mesh key={`${rippleFrom?.at}-${id}`} ref={(el) => void (rings.current[j] = el)} rotation-x={-Math.PI / 2} visible={false}>
          <ringGeometry args={[0.9, 1, 64]} />
          <meshBasicMaterial color={HOT} transparent depthWrite={false} />
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
              <meshBasicMaterial color="#000" transparent opacity={0.07} depthWrite={false} />
            </mesh>
            {selected === m.id && (
              <mesh rotation-x={-Math.PI / 2} position-y={0.012}>
                <ringGeometry args={[n.scale * 0.5, n.scale * 0.5 + 0.07, 48]} />
                <meshBasicMaterial color={INK} />
              </mesh>
            )}
            <mesh ref={(el) => void (hotRings.current[i] = el)} rotation-x={-Math.PI / 2} position-y={0.018} visible={false}>
              <ringGeometry args={[n.scale * 0.58, n.scale * 0.58 + 0.09, 48]} />
              <meshBasicMaterial color={HOT} />
            </mesh>
            <group ref={(el) => void (inner.current[i] = el)}>
              <MapNode
                module={m}
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
                }}
              />
              {hovered === m.id && !dragging && (
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
              {bubbles[m.id] && !(hovered === m.id && !dragging) && (
                <Dom position={[0, LIFT + n.scale + 0.1, 0]} z={4} clamp>
                  <div className="w-max max-w-60 -translate-y-1/2 rounded-2xl rounded-bl-sm border border-edge bg-panel px-2.5 py-1.5 text-xs leading-snug text-cream shadow-md">
                    {bubbles[m.id]}
                  </div>
                </Dom>
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

/** The import graph as a floating tabletop: drag, hover, click to chat, ripple(). Lazy-loaded; never server-rendered. */
export default function MapView() {
  const repo = useTavern((s) => s.repo);
  const graph = useTavern((s) => s.graph);
  const selected = useTavern((s) => s.selectedModuleId);
  const rippleFrom = useTavern((s) => s.rippleFrom);
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
    <div className="relative isolate h-full w-full overflow-hidden bg-[#fbfaf8]">
      <Canvas orthographic flat dpr={[1, 1.5]} camera={{ position: CAMERA, zoom: 40, near: 0.1, far: 200 }}>
        <Scene />
      </Canvas>
      <DomLayer />
      {caption && (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-edge bg-panel px-3 py-1 text-sm text-cream shadow-sm">
          {caption}
        </div>
      )}
      <div className="pointer-events-none absolute right-3 bottom-3 text-xs text-muted">
        Arrows point at what a module imports (solid) or calls over the network (dashed). Thicker means more. Drag to shove.
      </div>
      {process.env.NODE_ENV !== 'production' && (
        <button
          type="button"
          onClick={() => useTavern.getState().ripple(selected ?? busiest.id)}
          className="absolute top-3 right-3 rounded-full border border-dashed border-tomato px-3 py-1 text-xs text-tomato hover:bg-tomato/10"
        >
          Test ripple (dev)
        </button>
      )}
    </div>
  );
}
