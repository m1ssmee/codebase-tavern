'use client';
// The stage: characters over the three panels, standing on the code panel's edges and gutters. A transparent 3D
// canvas draws them (Stage3D); this DOM layer above it takes the pointer only on the characters (real buttons, so
// they work from the keyboard), and holds the speech bubbles, the radial menu, arrows and the hot potato.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import dynamic from 'next/dynamic';
import { useTavern } from '@/lib/store';
import Rich from '../Rich';
import { sendChat } from '../ChatPanel';
import { useCast3D } from '../cast/settings';
import { reducedMotion } from '../cast/settings';
import { getActor } from '../cast/anim/actor';
import { actorOf, think, thinkWhile, useStage, type Member } from './store';
import { bus, lineAt, lineBox } from './bus';
import { anchorPoint, codeRect, cursor, perches, placed, sizeOf, updateAim, zooms, zoomTarget } from './geo';
import { perchNear, tickPerches, typed } from './perches';
import * as scenes from './scenes';
import { JudgePortrait, LandlordPortrait, ModuleFace } from '../Portrait';
import { ThinkingText, useThinking } from '../Thinking';

const Stage3D = dynamic(() => import('./Stage3D'), { ssr: false });

const hitEls = new Map<string, HTMLElement>();
const bubbleEls = new Map<string, HTMLElement>();
const arrowEls = new Map<string, HTMLElement>();
const potatoEl = { current: null as HTMLElement | null };
const menuEl = { current: null as HTMLElement | null };
const flights = new Map<string, { vx: number; vy: number; bounces: number }>();
const scoots = new Map<string, { x: number; until: number; next: number }>();
/** Getting somewhere: a short crouch (takeoff), the character's float style on the way, a squash on landing. */
const travel = new Map<string, { phase: 'still' | 'takeoff' | 'fly'; t0: number }>();
const drag = { id: null as string | null, active: false, x0: 0, y0: 0, samples: [] as { x: number; y: number; t: number }[], swallow: false };

const send = (text: string, moduleId: string) => sendChat(text, { moduleId });
// ?fasttimers (browser tests): the minute of boredom becomes 5 seconds.
const FAST = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fasttimers');

export default function Stage() {
  const tenants = useStage((s) => s.tenants);
  const members = useStage((s) => s.members);
  const view = useTavern((s) => s.view);
  const repo = useTavern((s) => s.repo);
  const selected = useTavern((s) => s.selectedModuleId);
  const threeD = useCast3D((s) => s.on);
  const tour = useTavern((s) => s.tourOn);
  // Hidden on the Neighbourhood and the Blueprint (their own casts) and during the Landlord's tour (its own show).
  const show = tenants !== 'off' && view !== 'map' && view !== 'diagram' && !tour && !!repo;

  // The cast follows the repo and the selected module: the speaker and its two closest neighbours.
  useEffect(() => {
    if (repo) scenes.castFor(useTavern.getState().selectedModuleId);
  }, [repo]);
  useEffect(() => {
    if (selected && !useStage.getState().scene) scenes.castFor(selected);
  }, [selected]);
  // Its AI persona still on the way: the selected character shows the thinking cue until it arrives.
  const personaDue = useTavern((s) => s.personas === 'pending' && !!s.selectedModuleId && !s.arrivals[s.selectedModuleId]);
  useEffect(() => {
    if (personaDue && selected) return think([selected]);
  }, [personaDue, selected]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      cursor.x = e.clientX;
      cursor.y = e.clientY;
      if (drag.id) drag.samples = [...drag.samples.filter((s) => e.timeStamp - s.t < 120), { x: e.clientX, y: e.clientY, t: e.timeStamp }];
    };
    // Idle for a minute: a bored gag. Every 2 s: grudges show as a sulky pose.
    let last = performance.now();
    const touch = (e: Event) => {
      last = performance.now();
      if (e.type === 'keydown') typed();
    };
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;
    window.addEventListener('pointermove', move, { passive: true });
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      scenes.sulk();
      if (!document.hidden && performance.now() - last > (FAST ? 5_000 : 60_000)) {
        last = performance.now();
        scenes.bored();
      }
    }, 2000);
    // Perches follow the layout (and wandering ticks) a few times a second; waiting characters strike the thinking pose.
    const perch = setInterval(() => {
      if (scenes.visible()) tickPerches();
      scenes.thinkPoses();
      // Bubbles with an end time go, in every cast (the stage, the Neighbourhood, the Blueprint).
      const b = useStage.getState().bubbles, now = Date.now();
      if (Object.values(b).some((x) => x.until && x.until < now)) useStage.setState({ bubbles: Object.fromEntries(Object.entries(b).filter(([, x]) => !x.until || x.until >= now)) });
    }, 400);
    return () => {
      window.removeEventListener('pointermove', move);
      evs.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(timer);
      clearInterval(perch);
    };
  }, []);

  useFrameLoop(show);
  // For the browser tests: the stage store, and what each member is playing right now.
  useEffect(() => {
    const w = window as unknown as { __stage?: unknown; __tavern?: unknown; __perches?: unknown; __clips?: () => Record<string, string[]> };
    w.__stage = useStage;
    w.__tavern = useTavern;
    w.__perches = perches;
    w.__clips = () =>
      Object.fromEntries(
        useStage.getState().members.map((m) => {
          const a = getActor(actorOf(m.id));
          return [m.id, [a?.cur?.name, a?.loop?.name, ...(a?.holds.map((h) => h.name) ?? [])].filter((x): x is string => !!x)];
        }),
      );
  }, []);

  if (!show) return null;
  return (
    <>
      {threeD && <Stage3D />}
      <div className="pointer-events-none fixed inset-0 z-[41]" data-stage-layer>
        {members.map((m) => (
          <Tenant key={m.id} m={m} threeD={threeD} />
        ))}
        <Arrows />
        <Bubbles />
        <Potato />
        <RadialMenu />
        <SlowNote />
      </div>
    </>
  );
}

// ---------- the frame loop: positions for everything ----------
function useFrameLoop(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = useStage.getState();
      const threeD = useCast3D.getState().on;
      const reduced = reducedMotion();
      const r = codeRect();
      let homeRight = r ? r.right - 8 : null;
      for (const m of st.members) {
        // Perched characters are drawn smaller; the change eases in.
        const z0 = zooms.get(m.id) ?? zoomTarget(m);
        const zoom = reduced ? zoomTarget(m) : z0 + (zoomTarget(m) - z0) * (1 - Math.exp(-dt * 8));
        zooms.set(m.id, zoom);
        const full = sizeOf(m.id, threeD);
        const size = { w: full.w * zoom, h: full.h * zoom };
        const target = anchorPoint(m, homeRight, size);
        if (m.anchor.k === 'home' && !perches.has(m.id) && homeRight !== null) homeRight -= size.w + 12;
        let p = placed.get(m.id);
        if (!p) {
          // New members walk in from the right edge (reduced motion: they are just there).
          p = { x: reduced && target ? target.x : innerWidth + size.w, y: target?.y ?? innerHeight - 10, w: size.w, h: size.h };
          placed.set(m.id, p);
        }
        p.w = size.w;
        p.h = size.h;
        const f = flights.get(m.id);
        if (drag.id === m.id && drag.active) {
          // Held by the head: hangs below the cursor.
          p.x = cursor.x;
          p.y = cursor.y + p.h * 0.85;
        } else if (f && r) {
          f.vy += 2600 * dt;
          p.x += f.vx * dt;
          p.y += f.vy * dt;
          const L = r.left + p.w / 2, R = r.right - p.w / 2, top = r.top + p.h, floor = r.bottom - 6;
          if (p.x < L) [p.x, f.vx] = [L, Math.abs(f.vx) * 0.6];
          if (p.x > R) [p.x, f.vx] = [R, -Math.abs(f.vx) * 0.6];
          if (p.y < top) [p.y, f.vy] = [top, Math.abs(f.vy) * 0.5];
          if (p.y > floor) {
            p.y = floor;
            f.vy = -Math.abs(f.vy) * 0.42;
            f.vx *= 0.7;
            if (Math.abs(f.vy) < 170 || ++f.bounces > 4) {
              flights.delete(m.id);
              void scenes.landed(m.id, p.x, floor);
            }
          }
        } else if (target) {
          const sc = scoot(m, p, now, reduced || st.tenants !== 'stage' || st.menu === m.id || (m.anchor.k === 'home' && perches.has(m.id)));
          const tx = target.x + sc;
          const ty = target.y;
          const tr = travel.get(m.id) ?? { phase: 'still', t0: 0 };
          travel.set(m.id, tr);
          const a = getActor(actorOf(m.id));
          // Off somewhere: a crouch first, then it floats there in its own style, and squashes when it lands.
          if (!reduced && tr.phase === 'still' && Math.hypot(tx - p.x, ty - p.y) > 30) {
            Object.assign(tr, { phase: 'takeoff', t0: now });
            void a?.play('takeoff', { priority: 0 });
          }
          if (tr.phase === 'takeoff' && now - tr.t0 > 200) {
            tr.phase = 'fly';
            void a?.play('floats', { priority: 0 });
          }
          if (reduced) [p.x, p.y] = [tx, ty];
          else if (tr.phase !== 'takeoff') {
            const k = 1 - Math.exp(-dt * 6);
            const max = 1100 * dt;
            p.x += Math.max(-max, Math.min(max, (tx - p.x) * k));
            p.y += Math.max(-max, Math.min(max, (ty - p.y) * k));
          }
          if (tr.phase === 'fly' && Math.hypot(tx - p.x, ty - p.y) < 12) {
            tr.phase = 'still';
            a?.stopLoop('floats');
            void a?.play('land', { priority: 0 });
          }
        }
        updateAim(m);
        const el = hitEls.get(m.id);
        if (el) {
          el.style.transform = `translate(${p.x - p.w / 2}px,${p.y - p.h}px)`;
          el.style.width = `${p.w}px`;
          el.style.height = `${p.h}px`;
          const face = el.firstElementChild as HTMLElement | null;
          if (face) face.style.transform = `scale(${zoom})`;
        }
      }
      for (const id of placed.keys())
        if (!st.members.some((m) => m.id === id)) {
          placed.delete(id);
          zooms.delete(id);
          travel.delete(id);
        }
      placeBubbles(st.bubbles, r);
      placeArrows(st.arrows);
      placePotato(st.potato, now);
      placeMenu(st.menu);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
}

/** Characters shuffle out of the cursor's way once, then hold still for a few seconds so they can be clicked. */
function scoot(m: Member, p: { x: number; y: number; w: number; h: number }, now: number, off: boolean): number {
  const s = scoots.get(m.id) ?? { x: 0, until: 0, next: 0 };
  scoots.set(m.id, s);
  if (off || drag.id === m.id || m.anchor.k === 'line' || scenes.isBusy(m.id)) s.x = 0;
  else if (now > s.next && !drag.active) {
    // Nobody scoots while a character is being carried (it must be possible to drop it on them), nor while the cursor
    // is on any character (reaching for a neighbour).
    const cx = p.x, cy = p.y - p.h / 2;
    const onOne = [...placed.values()].some((q) => Math.abs(cursor.x - q.x) < q.w / 2 + 4 && cursor.y < q.y + 4 && cursor.y > q.y - q.h - 4);
    if (!onOne && Math.abs(cursor.x - cx) < p.w / 2 + 34 && Math.abs(cursor.y - cy) < p.h / 2 + 24) {
      s.x = (Math.sign(cx - cursor.x) || 1) * 80;
      s.until = now + 3000;
      s.next = now + 6000;
    }
  }
  if (now > s.until) s.x *= 0.92;
  return s.x;
}

function placeBubbles(bubbles: Record<string, { avoid?: { path: string; startLine: number; endLine: number } | null }>, r: DOMRect | null) {
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  for (const [id, el] of bubbleEls) {
    const p = placed.get(id);
    if (!p || !r) {
      el.style.visibility = 'hidden';
      continue;
    }
    const bw = el.offsetWidth, bh = el.offsetHeight;
    let x = p.x + p.w / 2 + 6;
    let tail = 'left';
    // Right of the character, unless that runs past the code panel: then on its left.
    if (x + bw > Math.min(innerWidth - 8, r.right + 60)) [x, tail] = [Math.max(8, p.x - p.w / 2 - 6 - bw), 'right'];
    let y = p.y - p.h - bh + 26;
    // Never over the line being pointed at: below it if it fits, else above.
    const av = bubbles[id]?.avoid;
    const a = av && bus.path === av.path ? lineBox(av.startLine) : null;
    const b = av && bus.path === av.path ? lineBox(av.endLine) : null;
    if (a && b) {
      const top = a.top - 8, bot = b.bottom + 8;
      if (y < bot && y + bh > top) y = bot + bh <= Math.min(innerHeight - 8, r.bottom + 40) ? bot : top - bh;
    }
    y = Math.max(8, Math.min(innerHeight - bh - 8, y));
    // Several bubbles at once (What-if reactions): each one that would overlap an earlier one goes above it.
    for (let tries = 0; tries < 6; tries++) {
      const hit = taken.find((t) => x < t.x + t.w && x + bw > t.x && y < t.y + t.h && y + bh > t.y);
      if (!hit) break;
      y = hit.y - bh - 6 >= 8 ? hit.y - bh - 6 : hit.y + hit.h + 6;
    }
    taken.push({ x, y, w: bw, h: bh });
    el.style.transform = `translate(${x}px,${y}px)`;
    el.dataset.tail = tail;
    el.style.visibility = 'visible';
  }
}
function placeArrows(arrows: Record<string, { path: string; startLine: number }>) {
  for (const [id, el] of arrowEls) {
    const c = arrows[id];
    const lb = c && bus.path === c.path ? lineBox(c.startLine) : null;
    if (!lb?.visible) {
      el.style.visibility = 'hidden';
      continue;
    }
    el.style.transform = `translate(${lb.codeLeft - 30}px,${lb.mid - 9}px)`;
    el.style.visibility = 'visible';
  }
}
function placePotato(pot: { path: string[]; t0: number; hop: number } | null, now: number) {
  const el = potatoEl.current;
  if (!el) return;
  const t = Date.now() - (pot?.t0 ?? 0);
  if (!pot || t < 0 || t > pot.hop * pot.path.length + 1200) {
    el.style.visibility = 'hidden';
    return;
  }
  const i = Math.min(pot.path.length - 1, Math.floor(t / pot.hop));
  const u = Math.min(1, (t % pot.hop) / (pot.hop * 0.7));
  const hand = (id: string) => {
    const p = placed.get(id);
    return p ? { x: p.x, y: p.y - p.h * 0.62 } : null;
  };
  const a = hand(pot.path[Math.max(0, i - 1)]) ?? hand(pot.path[i]);
  const b = hand(pot.path[i]);
  if (!a || !b) return;
  const k = i === 0 ? 1 : u;
  const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k - Math.sin(Math.PI * k) * 70;
  el.style.transform = `translate(${x - 14}px,${y - 14}px) scale(${1 + 0.12 * Math.sin(now / 90)})`;
  el.style.visibility = 'visible';
}
function placeMenu(id: string | null) {
  const el = menuEl.current;
  const p = id ? placed.get(id) : null;
  if (!el || !p) return;
  // Centred on the character, kept far enough from the window's edges for every item to show.
  el.style.transform = `translate(${Math.min(innerWidth - 200, Math.max(200, p.x))}px,${Math.min(innerHeight - 120, Math.max(120, p.y - p.h / 2))}px)`;
}

// ---------- a character ----------
function Tenant({ m, threeD }: { m: Member; threeD: boolean }) {
  const mod = useTavern((s) => s.repo?.modules.find((x) => x.id === m.id));
  const char = useTavern((s) => s.characters[m.id]);
  const mood = useTavern((s) => s.moods[m.id]);
  const menu = useStage((s) => s.menu);
  const label = m.kind === 'judge' ? 'The Judge' : m.kind === 'landlord' ? 'The Landlord' : (char?.name ?? mod?.name ?? m.id);
  const size = sizeOf(m.id, threeD);
  const open = menu === m.id;

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || m.kind !== 'module') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    Object.assign(drag, { id: m.id, active: false, x0: e.clientX, y0: e.clientY, samples: [], swallow: false });
  };
  const moveP = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag.id !== m.id || drag.active || Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
    drag.active = true;
    flights.delete(m.id);
    useStage.setState({ menu: null });
    void getActor(actorOf(m.id))?.play('dangle', { priority: 3 });
  };
  const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag.id !== m.id) return;
    const was = drag.active;
    drag.id = null;
    drag.active = false;
    if (!was) return;
    drag.swallow = true; // the click that follows a drag is not a click
    getActor(actorOf(m.id))?.stopLoop('dangle');
    // Only the movement just before letting go counts: a drag that stopped is a drop, not a throw.
    const s = drag.samples.filter((x) => e.timeStamp - x.t < 100), first = s[0], last = s.at(-1);
    const dt = first && last ? (last.t - first.t) / 1000 : 0;
    const vx = dt > 0.01 ? (last!.x - first!.x) / dt : 0, vy = dt > 0.01 ? (last!.y - first!.y) / dt : 0;
    const p = placed.get(m.id);
    if (Math.hypot(vx, vy) > 1100 && !reducedMotion()) {
      flights.set(m.id, { vx, vy, bounces: 0 });
      return;
    }
    // Dropped on another character: an argument. On a code line: it explains that line. Anywhere else: home.
    const other = scenes.memberAt(e.clientX, e.clientY, m.id);
    const box = bus.ed?.getDomNode()?.getBoundingClientRect();
    const inCode = box && e.clientX > box.left && e.clientX < box.right && e.clientY > box.top && e.clientY < box.bottom;
    const line = inCode && useTavern.getState().view === 'code' ? lineAt(e.clientX, e.clientY) : null;
    if (other && other !== 'judge' && other !== 'landlord') void scenes.argue(m.id, other);
    else if (line && bus.path) {
      useTavern.getState().selectModule(m.id);
      void send(`Explain line ${line} of ${bus.path}`, m.id);
    } else if (p) {
      // Anywhere else: it perches on the free spot nearest the drop.
      scenes.setAnchor(m.id, { k: 'at', x: p.x, y: Math.min(p.y, (codeRect()?.bottom ?? innerHeight) - 6) });
      perchNear(m.id, p.x, p.y);
      setTimeout(() => scenes.setAnchor(m.id, { k: 'home' }), 900);
    }
  };
  const click = () => {
    if (drag.swallow) return void (drag.swallow = false);
    if (m.kind === 'module') scenes.poke(m.id);
    else void getActor(actorOf(m.id))?.poke();
    if (m.kind === 'module') useStage.setState((s) => ({ menu: s.menu === m.id ? null : m.id }));
  };
  const keys2 = (e: ReactKeyboardEvent) => e.key === 'Escape' && useStage.setState({ menu: null });

  return (
    <button
      ref={(el) => {
        if (el) hitEls.set(m.id, el);
        else hitEls.delete(m.id);
      }}
      type="button"
      data-member={m.id}
      aria-label={m.kind === 'module' ? `${label}: open its menu` : label}
      aria-haspopup={m.kind === 'module' ? 'menu' : undefined}
      aria-expanded={m.kind === 'module' ? open : undefined}
      onPointerDown={down}
      onPointerMove={moveP}
      onPointerUp={up}
      onClick={click}
      onKeyDown={keys2}
      className="pointer-events-auto absolute top-0 left-0 cursor-grab touch-none rounded-2xl outline-amber focus-visible:outline-2 active:cursor-grabbing"
      style={{ width: size.w, height: size.h, transform: 'translate(-9999px,-9999px)' }}
    >
      {!threeD && (
        // Scaled down by the frame loop while perched.
        <span className="block h-full w-full origin-top-left">
          {m.kind === 'landlord' ? (
            <LandlordPortrait size={size.w} />
          ) : m.kind === 'judge' ? (
            <JudgePortrait size={size.w} />
          ) : (
            mod && <ModuleFace id={mod.id} size={size.w} mood={mood} />
          )}
        </span>
      )}
    </button>
  );
}

// ---------- speech bubbles ----------
function Bubbles() {
  const bubbles = useStage((s) => s.bubbles);
  const reactions = useTavern((s) => s.bubbles); // What-if reactions, also shown on the map
  const members = useStage((s) => s.members);
  const thinking = useStage((s) => s.thinking);
  const [, tick] = useState(0);
  // Re-placed twice a second (the frame loop moves them; this catches new sizes).
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  const ids = members.map((m) => m.id).filter((id) => bubbles[id] || reactions[id] || thinking[id]);
  return (
    <>
      {ids.map((id) => (
        <BubbleView key={id} id={id} text={bubbles[id]?.text ?? reactions[id] ?? ''} msg={bubbles[id]?.msg} />
      ))}
    </>
  );
}

const MAX_CHARS = 420;
function BubbleView({ id, text, msg }: { id: string; text: string; msg?: { mod: string; id: string } }) {
  const live = useTavern((s) => (msg ? s.chats[msg.mod]?.find((m) => m.id === msg.id) : undefined));
  const thinking = useThinking(id);
  const files = useTavern((s) => s.repo?.files ?? []);
  const name = useTavern((s) => (id === 'judge' ? 'The Judge' : id === 'landlord' ? 'The Landlord' : (s.characters[id]?.name ?? id)));
  // A citation still being typed shows only once it closes.
  const body = (live ? live.text : text).replace(/\[[^\]\n]*$/, '');
  if (live?.role === 'system') return null;
  const long = body.length > MAX_CHARS;
  return (
    <div
      ref={(el) => {
        if (el) bubbleEls.set(id, el);
        else bubbleEls.delete(id);
      }}
      className="stage-bubble pointer-events-auto absolute top-0 left-0 w-80 max-w-[42vw] rounded-2xl border-2 border-cream bg-white px-3 py-2 text-[13px] leading-snug text-cream shadow-[3px_3px_0_rgba(0,0,0,0.85)]"
      style={{ visibility: 'hidden' }}
      role="status"
      aria-live="polite"
    >
      <div className="text-[11px] font-semibold text-muted">{name}</div>
      <div className="max-h-48 overflow-hidden">
        {body && <Rich text={long ? body.slice(0, MAX_CHARS).replace(/\s+\S*$/, '') + '…' : body} files={files} />}
        {/* Waiting on the AI: the thinking cue until the answer starts. */}
        {thinking ? <ThinkingText id={id} className="block text-muted italic" /> : !body && <span className="text-muted">…</span>}
      </div>
      {long && msg && (
        <button type="button" className="mt-1 text-[11px] font-medium text-amber-700 underline underline-offset-2" onClick={() => document.getElementById(`msg-${msg.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          Continue in transcript
        </button>
      )}
    </div>
  );
}

// ---------- arrows (parked, reduced motion), the hot potato ----------
function Arrows() {
  const arrows = useStage((s) => s.arrows);
  return (
    <>
      {Object.keys(arrows).map((id) => (
        <svg
          key={id}
          ref={(el) => {
            if (el) arrowEls.set(id, el as unknown as HTMLElement);
            else arrowEls.delete(id);
          }}
          width="26"
          height="18"
          viewBox="0 0 26 18"
          className="absolute top-0 left-0 text-tomato drop-shadow"
          style={{ visibility: 'hidden' }}
          aria-hidden
        >
          <path d="M0 6h15V0l11 9-11 9v-6H0z" fill="currentColor" />
        </svg>
      ))}
    </>
  );
}
function Potato() {
  return (
    <div
      ref={(el) => void (potatoEl.current = el)}
      className="absolute top-0 left-0 h-7 w-7 rounded-full"
      style={{ visibility: 'hidden', background: 'radial-gradient(circle at 35% 35%, #fff6c2, #ffb020 45%, #e8590c 80%)', boxShadow: '0 0 18px 8px rgba(255,170,40,0.65)' } as CSSProperties}
      aria-hidden
    />
  );
}

/** The fps watchdog switched everyone to 2D faces: say so, with a way back. */
function SlowNote() {
  const auto = useCast3D((s) => s.auto);
  const setOn = useCast3D((s) => s.setOn);
  if (!auto) return null;
  return (
    <div role="status" className="pointer-events-auto fixed bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-edge bg-panel px-3 py-1.5 text-xs text-cream shadow-sm">
      Switched to 2D faces to keep things smooth.
      <button type="button" className="rounded border border-edge px-2 py-0.5 hover:bg-wood" onClick={() => setOn(true)}>
        Use 3D characters
      </button>
    </div>
  );
}

// ---------- the radial menu ----------
/** Keyboard: arrows (and Home/End) move between the items, wrapping around; Escape closes and returns focus. */
function menuKeys(e: ReactKeyboardEvent<HTMLElement>, close: () => void, id: string) {
  if (e.key === 'Escape') {
    close();
    return (document.querySelector(`[data-member="${id}"]`) as HTMLElement | null)?.focus();
  }
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  const to = step ? (i + step + items.length) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
  if (to < 0 || !items.length) return;
  e.preventDefault();
  items[to].focus();
}
type Item = { label: string; run: () => void };
function RadialMenu() {
  const id = useStage((s) => s.menu);
  return id ? <Menu key={id} id={id} /> : null;
}
/** The click menu: radial items around the character (also used on the Neighbourhood, at the node). */
export function Menu({ id }: { id: string }) {
  const repo = useTavern((s) => s.repo);
  const characters = useTavern((s) => s.characters);
  const [fight, setFight] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  // A frame later: on the Neighbourhood the menu's layer is still hidden (unfocusable) on its first frame.
  useEffect(() => {
    const t = setTimeout(() => first.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [id, fight]);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-stage-menu]') && !t.closest(`[data-member="${id}"]`)) useStage.setState({ menu: null });
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [id]);
  if (!repo) return null;
  const close = () => useStage.setState({ menu: null });
  const go = (f: () => unknown) => () => {
    close();
    void f();
  };
  const items: Item[] = fight
    ? [
        ...repo.modules.filter((m) => m.id !== id).map((m) => ({ label: characters[m.id]?.name ?? m.name, run: go(() => scenes.argue(id, m.id)) })),
        { label: 'Back', run: () => setFight(false) },
      ]
    : [
        { label: 'Explain yourself', run: go(() => (useTavern.getState().selectModule(id), send('Explain yourself. What do you do, and which files matter most?', id))) },
        { label: 'Who needs you?', run: go(() => scenes.whoNeedsYou(id, send)) },
        { label: 'Roast me', run: go(() => scenes.roastMe(id, send)) },
        { label: 'What if I change you?', run: go(() => scenes.whatIfMe(id)) },
        // Written on request (store.getGossip): the character's thinking cue while it's written.
        { label: 'Gossip', run: go(async () => (await thinkWhile([id], useTavern.getState().getGossip(id)), scenes.gossip(id))) },
        { label: 'Pick a fight with…', run: () => setFight(true) },
      ];
  const n = items.length;
  const radius = fight ? 0 : 92;
  return (
    <div ref={(el) => void (menuEl.current = el)} data-stage-menu className="absolute top-0 left-0" role="menu" aria-label={`${characters[id]?.name ?? id}`} onKeyDown={(e) => menuKeys(e, close, id)}>
      {fight ? (
        <div className="pointer-events-auto absolute -translate-x-1/2 translate-y-14 rounded-xl border border-edge bg-panel p-1 shadow-lg">
          <div className="px-2 py-1 text-[11px] font-medium text-muted">Pick a fight with</div>
          {items.map((it, i) => (
            <button key={it.label} ref={i === 0 ? first : undefined} role="menuitem" type="button" onClick={it.run} className="block w-full rounded-lg px-2 py-1 text-left text-xs whitespace-nowrap text-cream hover:bg-wood focus-visible:bg-wood focus-visible:outline-none">
              {it.label}
            </button>
          ))}
        </div>
      ) : (
        items.map((it, i) => {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
          return (
            <button
              key={it.label}
              ref={i === 0 ? first : undefined}
              role="menuitem"
              type="button"
              onClick={it.run}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-edge bg-panel px-2.5 py-1 text-xs font-medium whitespace-nowrap text-cream shadow-md hover:border-amber hover:bg-amber hover:text-ink focus-visible:bg-amber focus-visible:text-ink focus-visible:outline-none"
              style={{ left: Math.cos(a) * radius * 1.35, top: Math.sin(a) * radius }}
            >
              {it.label}
            </button>
          );
        })
      )}
    </div>
  );
}

