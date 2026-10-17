'use client';
// The stage's state: who stands over the code panel, where, what they say. No three.js here, so the chat, the top
// bar and the code panel can read and write it; the overlay (Stage.tsx, lazy) and scenes.ts act on it.
import { create } from 'zustand';
import type { Citation } from '@/lib/types';

/** on stage: they walk and point; parked: they stand at home and only talk; off: no characters at all. */
export type Tenants = 'stage' | 'parked' | 'off';

/** Where a member stands (feet, in screen pixels), worked out every frame. */
export type Anchor =
  | { k: 'home' } // the bottom-right of the code panel, in member order
  | { k: 'line'; c: Citation; side: 'L' | 'R' } // in the gutter at that line, pointing at it
  | { k: 'at'; x: number; y: number } // a fixed screen point (dropped, flung, peeking)
  | { k: 'row'; i: number; n: number } // a lineup along the bottom of the code panel (scenes)
  | { k: 'court'; i: number; n: number } // the Tribunal: suspects in a row
  | { k: 'judge' } // behind the bench, centre top
  | { k: 'gallery' } // the Landlord, at the right edge
  | { k: 'edge'; y: number }; // popped in at the right screen edge

export type MemberKind = 'module' | 'judge' | 'landlord';
export type Member = { id: string; kind: MemberKind; anchor: Anchor; temp?: boolean };
export type Bubble = { text: string; msg?: { mod: string; id: string }; until?: number; avoid?: Citation | null };

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
  /** "What if I change you?": the code panel selects these lines and opens its presets. */
  whatIfFor: { path: string; start: number; end: number; at: number } | null;
  setTenants: (t: Tenants) => void;
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
  whatIfFor: null,
  setTenants: (tenants) => {
    try {
      localStorage.setItem(KEY, tenants);
    } catch {}
    set({ tenants, menu: null });
  },
}));

export const memberId = (kind: MemberKind, id: string) => (kind === 'module' ? id : kind);
/** Actor ids for the stage's 3D characters (the map, the tour and the panels use their own). */
export const actorOf = (id: string) => `stage:${id}`;

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
