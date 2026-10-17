'use client';
// Screen geometry for the stage: where each member stands this frame (feet, in client pixels), its size, and what its
// hand aims at. The overlay's frame loop writes these; the 3D characters, bubbles and scenes read them.
import { bus, editorBox, lineBox } from './bus';
import type { Anchor, Member } from './store';

/** x = centre, y = feet. */
export type Box = { x: number; y: number; w: number; h: number };
export const placed = new Map<string, Box>();
/** On-screen size per member, from its 3D model (or the 2D face). */
export const sizes = new Map<string, { w: number; h: number }>();
/** What each member's hand points at, as screen points the actor re-reads every frame (follows scrolling). */
export const aims = new Map<string, { from: { client: [number, number] }; to: { client: [number, number] } }>();
export const cursor = { x: -1e4, y: -1e4 };

/** Characters are this tall on screen (px); the Judge's bench makes it wider, not taller. */
export const HEIGHT = 112;
export const FACE = 72;

/** The code panel's body: the editor when a file is open, else the panel under its tab bar. */
export function codeRect(): DOMRect | null {
  return editorBox() ?? document.querySelector('[data-stage="code"]')?.getBoundingClientRect() ?? null;
}

export function sizeOf(id: string, threeD: boolean) {
  return threeD ? (sizes.get(id) ?? { w: 70, h: HEIGHT }) : { w: FACE, h: FACE };
}

/**
 * Feet position for a member's anchor, or null (nowhere to stand: no code panel). `homeRight`: for home spots, the
 * right edge left over by the members already standing at home (they pack right to left by width).
 */
export function anchorPoint(m: Member, homeRight: number | null, size: { w: number; h: number }): { x: number; y: number } | null {
  const r = codeRect();
  if (!r) return null;
  const a: Anchor = m.anchor;
  const floor = r.bottom - 6;
  const spread = (i: number, n: number, y: number, from = r.left + 70, to = r.right - 70) => ({ x: n <= 1 ? (from + to) / 2 : from + ((to - from) * i) / (n - 1), y });
  switch (a.k) {
    case 'home':
      return { x: Math.max(r.left + size.w / 2, (homeRight ?? r.right - 8) - size.w / 2), y: floor };
    case 'at':
      return { x: a.x, y: a.y };
    case 'edge':
      return { x: r.right - size.w / 2 - 6, y: Math.min(floor, Math.max(r.top + size.h, a.y)) };
    case 'row':
      return spread(a.i, a.n, floor, r.left + 80, Math.max(r.left + 120, r.right - 80));
    case 'court': {
      // Suspects either side of the bench, inner pair first.
      const slots = [-1, 1, -2, 2].slice(0, a.n).sort((p, q) => p - q);
      return { x: r.left + r.width / 2 + slots[a.i] * Math.min(150, r.width / 5.5), y: r.top + r.height * 0.86 };
    }
    case 'judge':
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.5 };
    case 'gallery':
      return { x: r.right - size.w / 2 - 14, y: r.top + r.height * 0.5 };
    case 'line': {
      if (bus.path !== a.c.path) return { x: r.right - 52, y: floor };
      const lb = lineBox(a.c.startLine);
      if (!lb) return { x: r.right - 52, y: floor };
      // Hand at the line: the shoulder sits about 55% up the body. Off-screen lines park it at the edge they left by.
      const y = Math.min(floor, Math.max(r.top + size.h * 0.95, lb.mid + size.h * 0.5));
      return { x: a.side === 'L' ? lb.left + Math.max(22, size.w * 0.32) : lb.right - size.w / 2 - 18, y };
    }
  }
}

/** Where a line-anchored member aims: the start of the code on its first line, sweeping to its last. */
export function updateAim(m: Member) {
  if (m.anchor.k !== 'line' || bus.path !== m.anchor.c.path) return;
  const { c, side } = m.anchor;
  const a = lineBox(c.startLine), b = lineBox(c.endLine);
  if (!a || !b) return;
  const x = side === 'L' ? a.codeLeft + 16 : Math.min(a.right - 140, a.codeLeft + 280);
  const aim = aims.get(m.id) ?? { from: { client: [0, 0] as [number, number] }, to: { client: [0, 0] as [number, number] } };
  aim.from.client = [x, a.mid];
  aim.to.client = [x, b.mid];
  aims.set(m.id, aim);
}

/** Is another member already standing on the left near these lines? Then use the right side. */
export function leftBlocked(id: string, members: Member[], line: number): boolean {
  const me = lineBox(line);
  if (!me) return false;
  return members.some((m) => m.id !== id && m.anchor.k === 'line' && m.anchor.side === 'L' && Math.abs((lineBox(m.anchor.c.startLine)?.mid ?? -1e4) - me.mid) < HEIGHT);
}
