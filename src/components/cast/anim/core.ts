// Shared animation clock (advances once per rendered frame, so a hidden tab pauses every gag and every
// scripted wait together) and spice ranks.
import { useTavern } from '@/lib/store';
import type { SpiceLevel } from '@/lib/types';
import { useCastAnim } from '../settings';

export const SPICE_RANK: Record<SpiceLevel, number> = { clean: 0, unhinged: 1, feral: 2, nuclear: 3 };
/** Current spice as a rank: clean 0, unhinged 1, feral 2, nuclear 3. */
export const spice = () => SPICE_RANK[useTavern.getState().spice];

export const clock = { now: 0 };
let stamp = -1;
const waits: { at: number; resolve: () => void }[] = [];

/** Called by every actor and FX pool each frame; only the first call per frame advances the clock. */
export function tickClock(dt: number) {
  const s = typeof document !== 'undefined' && document.timeline ? Number(document.timeline.currentTime) : performance.now();
  if (s === stamp) return;
  stamp = s;
  clock.now += Math.min(dt, 0.1) * useCastAnim.getState().speed;
  for (let i = waits.length - 1; i >= 0; i--)
    if (waits[i].at <= clock.now) {
      waits[i].resolve();
      waits.splice(i, 1);
    }
}

/** Resolves after `s` seconds of animation time. */
export const wait = (s: number) => new Promise<void>((resolve) => waits.push({ at: clock.now + s, resolve }));
