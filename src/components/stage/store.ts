'use client';
// The stage's state: who stands over the code panel, where, what they say. No three.js here, so the chat, the top
// bar and the code panel can read and write it; the overlay (Stage.tsx, lazy) and scenes.ts act on it.
import { create } from 'zustand';
import type { Citation } from '@/lib/types';
import { useTavern } from '@/lib/store';
import { chooseBubble } from '@/lib/quip';

/** on stage: they walk and point; parked: they stand at home and only talk; off: no characters at all. */
export type Tenants = 'stage' | 'parked' | 'off';

/** Where a member stands (feet, in screen pixels), worked out every frame. */
export type Anchor =
  | { k: 'home' } // its perch (on stage), or the bottom-right of the code panel in member order (parked)
  | { k: 'line'; c: Citation; side: 'L' | 'R' } // in the gutter at that line, pointing at it
  | { k: 'at'; x: number; y: number } // a fixed screen point (dropped, flung, peeking)
  | { k: 'row'; i: number; n: number } // a lineup along the bottom of the code panel (scenes)
  | { k: 'court'; i: number; n: number } // the Tribunal: suspects in a row
  | { k: 'judge' } // behind the bench, centre top
  | { k: 'gallery' } // the Landlord, at the right edge
  | { k: 'edge'; y: number }; // popped in at the right screen edge

export type MemberKind = 'module' | 'judge' | 'landlord';
/** Where a companion perches when it's at home: the speaker's strongest dependency above, its strongest dependent beside the chat. */
export type Role = 'up' | 'side';
export type Member = { id: string; kind: MemberKind; anchor: Anchor; temp?: boolean; role?: Role };
/**
 * A speech bubble. `msg`: a chat answer streaming in (the bubble shows its quip); `link`: the element with the full
 * text (a transcript message, the Tribunal's transcript), which a click on the bubble scrolls to.
 */
export type Bubble = { text: string; msg?: { mod: string; id: string }; until?: number; avoid?: Citation | null; link?: string };

type Stage = {
  tenants: Tenants;
  members: Member[];
  speaker: string | null;
  bubbles: Record<string, Bubble>;
  /** Members that are talking or touring lines right now: reactions leave them alone. */
  busy: Record<string, boolean>;
  menu: string | null;
  scene: 'tribunal' | 'who' | 'argue' | 'potato' | null;
  potato: { path: string[]; t0: number; hop: number } | null;
  /** Reduced motion and parked: a plain arrow at the line instead of a pointing character. */
  arrows: Record<string, Citation>;
  dim: boolean;
  /** The Judge is performing the verdict: everyone's app mood waits until it is done. */
  holdMoods: boolean;
  grudges: Record<string, { roasts: number[]; pesters: number[] }>;
  /**
   * Characters waiting on an AI call (the thinking cue): since when, and how many waits are open on each. A second
   * wait on the same character joins the first one's cue instead of stacking.
   */
  thinking: Record<string, { since: number; n: number }>;
  /** Two modules arguing: on the Neighbourhood the road between them lights up and they meet on it. */
  road: { a: string; b: string } | null;
  /** "What if I change you?": the code panel selects these lines and opens its presets. */
  whatIfFor: { path: string; start: number; end: number; at: number } | null;
  setTenants: (t: Tenants) => void;
  /** Every 20-40 s one idle character floats to another free perch. */
  wander: boolean;
  setWander: (on: boolean) => void;
};

const KEY = 'tavern-tenants';
const saved = (): Tenants => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'parked' || v === 'off' ? v : 'stage';
  } catch {
    return 'stage';
  }
};

const WANDER = 'tavern-wander';
const savedWander = () => {
  try {
    return localStorage.getItem(WANDER) !== 'off';
  } catch {
    return true;
  }
};

export const useStage = create<Stage>((set) => ({
  tenants: typeof window === 'undefined' ? 'stage' : saved(),
  members: [],
  speaker: null,
  bubbles: {},
  busy: {},
  menu: null,
  scene: null,
  potato: null,
  arrows: {},
  dim: false,
  holdMoods: false,
  grudges: {},
  thinking: {},
  road: null,
  whatIfFor: null,
  setTenants: (tenants) => {
    try {
      localStorage.setItem(KEY, tenants);
    } catch {}
    set({ tenants, menu: null });
  },
  wander: typeof window === 'undefined' ? true : savedWander(),
  setWander: (wander) => {
    try {
      localStorage.setItem(WANDER, wander ? 'on' : 'off');
    } catch {}
    set({ wander });
  },
}));

export const memberId = (kind: MemberKind, id: string) => (kind === 'module' ? id : kind);
/** Actor ids for the stage's 3D characters (the map, the tour and the panels use their own). */
export const actorOf = (id: string) => `stage:${id}`;

/**
 * A character (or several: both sides of an argument) starts waiting on an AI call: its thinking cue shows at once.
 * Returns the end of the wait; calling it more than once is harmless. Ids: module ids, 'judge', 'landlord'.
 */
export function think(ids: string[]): () => void {
  if (!ids.length) return () => {};
  const now = Date.now();
  useStage.setState((s) => {
    const t = { ...s.thinking };
    for (const id of new Set(ids)) t[id] = { since: t[id]?.since ?? now, n: (t[id]?.n ?? 0) + 1 };
    return { thinking: t };
  });
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    useStage.setState((s) => {
      const t = { ...s.thinking };
      for (const id of new Set(ids)) {
        const x = t[id];
        if (x && x.n > 1) t[id] = { ...x, n: x.n - 1 };
        else delete t[id];
      }
      return { thinking: t };
    });
  };
}
/** Waits on `p` with the cue on `ids`; the cue ends however `p` ends (answer, error, cancel). */
export async function thinkWhile<T>(ids: string[], p: Promise<T>): Promise<T> {
  const end = think(ids);
  try {
    return await p;
  } finally {
    end();
  }
}

// The bubbles shown this session (any character), oldest first: the repetition guard, and "don't reuse" in prompts.
const shown: string[] = [];
export const recentBubbles = (n = 5) => shown.slice(-n);
/** The bubble to show for an answer: the AI's (`ai`) unless it breaks the rules or repeats a recent one, else the fallback from `full`. */
export function bubbleFor(ai: unknown, full: string): string {
  const t = chooseBubble(ai, full, useTavern.getState().spice, shown.slice(-10));
  if (t) {
    shown.push(t);
    if (shown.length > 10) shown.shift();
  }
  return t;
}

const MIN10 = 10 * 60_000;
/** A character's grudge: roasts and pesterings in the last 10 minutes. */
export function grudgeOf(id: string, now = Date.now()) {
  const g = useStage.getState().grudges[id];
  const roasted = g?.roasts.filter((t) => now - t < MIN10) ?? [];
  const pestered = g?.pesters.filter((t) => now - t < MIN10) ?? [];
  return { roasted: roasted.length, pestered: pestered.length, minutesSinceRoast: roasted.length ? Math.round((now - Math.max(...roasted)) / 60_000) : null };
}
export function addGrudge(id: string, kind: 'roasts' | 'pesters') {
  useStage.setState((s) => {
    const g = s.grudges[id] ?? { roasts: [], pesters: [] };
    return { grudges: { ...s.grudges, [id]: { ...g, [kind]: [...g[kind].filter((t) => Date.now() - t < MIN10), Date.now()] } } };
  });
}
