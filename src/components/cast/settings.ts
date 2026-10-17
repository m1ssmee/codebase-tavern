'use client';
// Global "3D characters: on/off" setting. The user's own choice is remembered across visits; the automatic
// switch to 2D (fps under 30 for 5 seconds) is not, and it stops happening once the user turns 3D back on.
import { create } from 'zustand';

const KEY = 'tavern-3d';
const saved = () => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};

type Cast3D = {
  on: boolean;
  /** True when 3D was switched off automatically (shows the note). */
  auto: boolean;
  /** The user picked a setting this session: no more automatic switching. */
  userChose: boolean;
  setOn: (on: boolean) => void;
  /** Called by the fps watchdog. */
  tooSlow: () => void;
};

export const useCast3D = create<Cast3D>((set, get) => ({
  on: typeof window === 'undefined' ? true : saved(),
  auto: false,
  userChose: false,
  setOn: (on) => {
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {}
    set({ on, auto: false, userChose: true });
  },
  tooSlow: () => {
    if (get().on && !get().userChose) set({ on: false, auto: true });
  },
}));

/**
 * Animation settings. Reduced motion follows the OS unless overridden (the /lab toggle); cooldown bypass and
 * ambient idles are review switches for /lab.
 */
type CastAnim = { reduced: boolean | null; ignoreCooldowns: boolean; ambient: boolean; /** Slow motion for review (1 = normal). */ speed: number; set: (p: Partial<Omit<CastAnim, 'set'>>) => void };
export const useCastAnim = create<CastAnim>((set) => ({ reduced: null, ignoreCooldowns: false, ambient: true, speed: 1, set: (p) => set(p) }));
export const reducedMotion = () => {
  const o = useCastAnim.getState().reduced;
  if (o !== null) return o;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
};
