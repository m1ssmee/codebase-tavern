'use client';
// Perches: where the characters stand when they aren't doing anything, worked out from the live layout. The code
// panel's top edge (left and right), the top bar, the top of the file tree, the code gutter at three heights, beside
// the chat input, above the chat's quick questions, the code panel's top-right corner. The speaker stands next to
// the line being discussed; its strongest dependency perches above, its strongest dependent beside the chat.
// A spot is free when a character there covers no control, no text outside the editor, nothing near the editor's
// cursor or selection or a line being pointed at, and no other character. Every 400 ms: blocked perches are given
// up, members at home without one take the first free spot in their order, and (if on) every 20-40 s one idle
// character wanders to another free spot.
import { useTavern } from '@/lib/store';
import { reducedMotion, useCast3D } from '../cast/settings';
import { bus, lineBox } from './bus';
import { codeRect, cursor, perches, placed, sizeOf, type Perch } from './geo';
import { useStage, type Member } from './store';

type Spot = { name: string; y: number; s: number; xs: number[] };
type Box = { l: number; t: number; r: number; b: number };
const SMALL = 0.72; // perched characters are this fraction of their full height
const HEIGHT = 112;

const ORDER: Record<'speaker' | 'up' | 'side' | 'other', string[]> = {
  speaker: ['chat', 'corner', 'gutter3', 'gutter2', 'gutter1', 'chatUp', 'topR', 'topL', 'tree', 'bar'],
  up: ['topR', 'topL', 'bar', 'tree', 'corner', 'gutter1', 'gutter2', 'gutter3', 'chatUp', 'chat'],
  side: ['chatUp', 'chat', 'gutter3', 'corner', 'gutter2', 'gutter1', 'topR', 'topL', 'tree', 'bar'],
  other: ['gutter2', 'gutter3', 'gutter1', 'corner', 'topL', 'topR', 'tree', 'chatUp', 'chat', 'bar'],
};

const rectOf = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
function scan(from: number, to: number, step = 14) {
  const xs: number[] = [];
  const dir = to >= from ? 1 : -1;
  for (let x = from; dir > 0 ? x <= to : x >= to; x += step * dir) xs.push(x);
  return xs;
}

/** Every perch for a character `w` px wide at full size, from where the panels are right now. */
function spots(w: number): Spot[] {
  const e = codeRect();
  if (!e) return [];
  const bar = rectOf('[data-perch="bar"]'), head = rectOf('[data-perch="code-head"]'), tree = rectOf('[data-perch="tree"]'), chips = rectOf('[data-perch="chat-chips"]');
  const out: Spot[] = [];
  // On a header strip: as tall as fits under the top bar, no smaller than 40%.
  const fit = (feet: number) => Math.max(0.4, Math.min(SMALL, (feet - (bar?.bottom ?? 0) + 8) / HEIGHT));
  const half = (s: number) => (w * s) / 2 + 6;
  if (head) {
    const s = fit(head.bottom);
    out.push({ name: 'topL', y: head.bottom - 1, s, xs: scan(head.left + half(s), head.right - half(s)) }, { name: 'topR', y: head.bottom - 1, s, xs: scan(head.right - half(s), head.left + half(s)) });
  }
  if (bar) {
    const s = Math.max(0.35, Math.min(0.6, (bar.height - 4) / HEIGHT));
    out.push({ name: 'bar', y: bar.bottom - 1, s, xs: scan(bar.right - half(s), bar.left + half(s)) });
  }
  if (tree) {
    const s = fit(tree.bottom);
    out.push({ name: 'tree', y: tree.bottom - 1, s, xs: scan(tree.right - half(s), tree.left + half(s)) });
  }
  const hw = (w * SMALL) / 2, hh = HEIGHT * SMALL;
  // In the gutter: shrunk to fit beside the line numbers (wide builds still poke out a little).
  const gs = Math.max(0.5, Math.min(SMALL, ((bus.ed?.getLayoutInfo().contentLeft ?? 60) + 8) / w));
  [0.35, 0.6, 0.85].forEach((f, i) => out.push({ name: `gutter${i + 1}`, y: e.top + e.height * f + (HEIGHT * gs) / 2, s: gs, xs: [e.left + (w * gs) / 2 + 2] }));
  out.push({ name: 'chat', y: e.bottom - 6, s: SMALL, xs: scan(e.right - hw - 10, e.right - hw - 150, 35) });
  if (chips) out.push({ name: 'chatUp', y: chips.top - 2, s: SMALL, xs: scan(chips.right - hw - 8, chips.left + hw + 8) });
  out.push({ name: 'corner', y: e.top + hh + 8, s: SMALL, xs: [e.right - hw - 18] });
  return out;
}

const boxAt = (x: number, y: number, w: number, h: number): Box => ({ l: x - w / 2, t: y - h, r: x + w / 2, b: y });
const overlap = (a: Box, b: Box, pad = 0) => a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;
const CONTROL = 'button, a, input, textarea, select, summary, label, [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"]';

/** A control (or, with `text`, a run of text outside the editor) at this point, under the stage's own layers. */
function taken(x: number, y: number, text: boolean): boolean {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.tagName === 'CANVAS' || el.closest('[data-stage-layer]')) continue;
    if (el.closest('.monaco-editor')) return false; // the editor has the line rule instead
    if (el.closest(CONTROL)) return true;
    if (!text) return false;
    for (const n of el.childNodes) {
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (x > r.left - 8 && x < r.right + 8 && y > r.top - 4 && y < r.bottom + 4) return true;
    }
    return false;
  }
  return false;
}
const samples = (b: Box) => [0.12, 0.5, 0.88].flatMap((u) => [0.2, 0.5, 0.85].map((v): [number, number] => [b.l + (b.r - b.l) * u, b.t + (b.b - b.t) * v]));

/** Lines nobody may cover: the editor's selection or cursor line (while it has focus), lines pointed at, the discussed lines. */
function bands(members: Member[]): { t: number; b: number }[] {
  const ed = bus.ed;
  if (!ed) return [];
  const out: { t: number; b: number }[] = [];
  const add = (path: string | null | undefined, from: number, to: number) => {
    const a = path === bus.path ? lineBox(from) : null, z = a ? lineBox(to) : null;
    if (a && z && z.bottom > a.viewTop && a.top < a.viewBottom) out.push({ t: a.top - 6, b: z.bottom + 6 });
  };
  const sel = ed.getSelection();
  if (sel && (ed.hasTextFocus() || !sel.isEmpty())) add(bus.path, sel.startLineNumber, sel.endLineNumber);
  for (const m of members) if (m.anchor.k === 'line') add(m.anchor.c.path, m.anchor.c.startLine, m.anchor.c.endLine);
  for (const c of Object.values(useStage.getState().arrows)) add(c.path, c.startLine, c.endLine);
  const h = useTavern.getState().highlight;
  if (h) add(h.path, h.startLine, h.endLine);
  return out;
}

type Ctx = { others: Box[]; bands: { t: number; b: number }[]; e: DOMRect | null; codeLeft: number };
/** `choose`: picking a new spot (also keeps clear of text and the cursor); else only checking it can stay. */
function free(b: Box, c: Ctx, choose: boolean): boolean {
  if (b.l < 2 || b.r > innerWidth - 2 || b.t < 0 || b.b > innerHeight) return false;
  if (c.others.some((q) => overlap(b, q, 4))) return false;
  const e = c.e;
  if (e && b.r > c.codeLeft + 4 && b.l < e.right && b.t < e.bottom && b.b > e.top && c.bands.some((x) => b.t < x.b && b.b > x.t)) return false;
  if (choose && cursor.x > b.l - 40 && cursor.x < b.r + 40 && cursor.y > b.t - 40 && cursor.y < b.b + 40) return false;
  return !samples(b).some(([x, y]) => taken(x, y, choose));
}

// The 3D model is a little wider than its hitbox (arms, props): perches leave room for all of it.
const sizeFor = (id: string) => {
  const on = useCast3D.getState().on;
  const z = sizeOf(id, on);
  return on ? { w: z.w * 1.18, h: z.h } : z;
};
const perchBox = (id: string, p: Perch): Box | null => {
  if (p.c) {
    const q = placed.get(id);
    return q ? boxAt(q.x, q.y, q.w, q.h) : null;
  }
  const z = sizeFor(id);
  return boxAt(p.x, p.y, z.w * p.s, z.h * p.s);
};

/** First free spot in `order` (or nearest to `near`), skipping `not`. */
function choose(id: string, order: string[], c: Ctx, o: { not?: string; near?: { x: number; y: number }; shuffle?: boolean } = {}): Perch | null {
  const z = sizeFor(id);
  const all = spots(z.w);
  let tries = order.map((n) => all.find((s) => s.name === n)).filter((s): s is Spot => !!s && s.name !== o.not);
  if (o.shuffle) tries = tries.sort(() => Math.random() - 0.5);
  const cands = tries.flatMap((s) => s.xs.map((x) => ({ s, x })));
  if (o.near) cands.sort((a, b) => Math.hypot(a.x - o.near!.x, a.s.y - o.near!.y) - Math.hypot(b.x - o.near!.x, b.s.y - o.near!.y));
  for (const { s, x } of cands) if (free(boxAt(x, s.y, z.w * s.s, z.h * s.s), c, true)) return { name: s.name, x, y: s.y, s: s.s };
  return null;
}

/** Where to perch after being dropped: the free spot nearest the drop. */
const near = new Map<string, { x: number; y: number }>();
export function perchNear(id: string, x: number, y: number) {
  perches.delete(id);
  near.set(id, { x, y });
}
/** Roles changed (another module was selected): everyone picks again. */
export const resetPerches = () => perches.clear();

// ?fasttimers (browser tests): wandering every 3-6 s instead of 20-40 s.
const GAP = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fasttimers') ? 3000 : 20_000;
const strikes = new Map<string, number>();
let nextWander = 0;
let lastKey = 0;
export const typed = () => void (lastKey = performance.now());

export function tickPerches(now = performance.now()) {
  const st = useStage.getState();
  if (st.tenants !== 'stage') return void perches.clear();
  for (const id of perches.keys()) if (!st.members.some((m) => m.id === id)) perches.delete(id);
  const e = codeRect();
  const c: Ctx = { others: [], bands: bands(st.members), e, codeLeft: e && bus.ed ? e.left + bus.ed.getLayoutInfo().contentLeft : (e?.left ?? 0) };
  const boxes = new Map<string, Box>();
  for (const m of st.members) {
    const p = perches.get(m.id);
    const q = placed.get(m.id);
    const b = m.anchor.k === 'home' && p ? perchBox(m.id, p) : q ? boxAt(q.x, q.y, q.w, q.h) : null;
    if (b) boxes.set(m.id, b);
  }
  const ctx = (id: string): Ctx => ({ ...c, others: [...boxes].filter(([k]) => k !== id).map(([, b]) => b) });
  const assign = (id: string, p: Perch | null) => {
    if (!p) return;
    perches.set(id, p);
    strikes.delete(id);
    const b = perchBox(id, p);
    if (b) boxes.set(id, b);
  };
  const h = useTavern.getState().highlight;
  const lineOk = h && h.path === bus.path && !!lineBox(h.startLine)?.visible;
  for (const m of st.members) {
    if (m.anchor.k !== 'home' || m.kind !== 'module') continue;
    const p = perches.get(m.id);
    const speaker = m.id === st.speaker;
    // The speaker stands next to the line being discussed while it's on screen.
    if (speaker && lineOk && h) {
      if (!p?.c || p.c.startLine !== h.startLine || p.c.path !== h.path) assign(m.id, { name: 'line', x: 0, y: 0, s: 1, c: h });
      continue;
    }
    if (p?.c) perches.delete(m.id);
    const cur = perches.get(m.id);
    if (cur) {
      const b = perchBox(m.id, cur);
      const n = b && free(b, ctx(m.id), false) ? 0 : (strikes.get(m.id) ?? 0) + 1;
      strikes.set(m.id, n);
      if (n < 2) continue; // blocked for 800 ms: give it up
    }
    const order = ORDER[speaker ? 'speaker' : (m.role ?? 'other')];
    const hint = near.get(m.id);
    near.delete(m.id);
    assign(m.id, choose(m.id, order, ctx(m.id), { not: cur?.name, near: hint }) ?? choose(m.id, ORDER.other, ctx(m.id)));
  }
  // Idle wandering: never while typing, while an answer streams, during scenes, or with reduced motion.
  const calm = st.wander && !reducedMotion() && !st.scene && !st.menu && !useTavern.getState().isLoading && now - lastKey > 5000 && !document.hidden;
  if (!calm) return void (nextWander = 0);
  if (!nextWander) return void (nextWander = now + GAP * (1 + Math.random()));
  if (now < nextWander) return;
  nextWander = now + GAP * (1 + Math.random());
  const idle = st.members.filter((m) => m.kind === 'module' && m.id !== st.speaker && m.anchor.k === 'home' && perches.has(m.id) && !st.busy[m.id] && !st.bubbles[m.id]);
  const who = idle[Math.floor(Math.random() * idle.length)];
  if (who) assign(who.id, choose(who.id, ORDER.other, ctx(who.id), { not: perches.get(who.id)?.name, shuffle: true }));
}
