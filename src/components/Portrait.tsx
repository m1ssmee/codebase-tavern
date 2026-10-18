'use client';
// Portraits rendered from the 3D models (npm run portraits → public/portraits/<archetype>-<hex>.webp): the 2D face
// wherever one appears (the file tree, the 3D fallback, the Roast card, the landing page). Moods are CSS (globals.css).
import { assignCast, type Archetype } from '@/lib/cast';
import { portraitName } from '@/lib/portraits';
import { useTavern } from '@/lib/store';
import type { Module, Mood } from '@/lib/types';

export const portraitSrc = (arch: Archetype, color: string | undefined, name?: string) => `/portraits/${portraitName(arch, color, name)}.webp`;

const uris = new Map<string, Promise<string | null>>();
/** A portrait as a data URI (the Roast card's PNG download embeds it); null if it can't be fetched. */
export function portraitUri(arch: Archetype, color: string | undefined, name?: string): Promise<string | null> {
  const src = portraitSrc(arch, color, name);
  if (!uris.has(src))
    uris.set(
      src,
      fetch(src)
        .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
        .then((b) => new Promise<string>((ok) => Object.assign(new FileReader(), { onload: (e: ProgressEvent<FileReader>) => ok(String(e.target?.result)) }).readAsDataURL(b)))
        .catch(() => null),
    );
  return uris.get(src)!;
}

const casts = new WeakMap<Module[], Map<string, Archetype>>();
/** A module's archetype, as the 3D cast assigns it (cached per repo). */
export function archetypeOf(mods: Module[], id: string): Archetype {
  let m = casts.get(mods);
  if (!m) casts.set(mods, (m = new Map(assignCast(mods).map((c, i) => [mods[i].id, c.archetype]))));
  return m.get(id) ?? 'clerk';
}

type Props = { arch: Archetype; color?: string; name?: string; size: number; mood?: Mood | 'talking'; className?: string; alt?: string };
export function Portrait({ arch, color, name = arch, size, mood, className = '', alt = '' }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 4 KB static WebP, sized exactly; next/image adds nothing here
    <img
      src={portraitSrc(arch, color, name)}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
      className={`portrait shrink-0 rounded-full border border-edge bg-[#f3efe8] select-none ${mood && mood !== 'idle' ? `portrait-${mood}` : ''} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** A module's portrait from the store: its archetype, its colour, its mood. */
export function ModuleFace({ id, size, mood, still = false, className }: { id: string; size: number; mood?: Mood; still?: boolean; className?: string }) {
  const mods = useTavern((s) => s.repo?.modules);
  const color = useTavern((s) => s.characters[id]?.color);
  if (id === 'judge') return <JudgePortrait size={size} className={className} />;
  if (id === 'landlord') return <LandlordPortrait size={size} talking={mood === 'talking'} className={className} />;
  if (!mods) return null;
  return <Portrait arch={archetypeOf(mods, id)} color={color} name={mods.find((m) => m.id === id)?.name ?? id} size={size} mood={still ? undefined : mood} className={className} />;
}

/** The Landlord's and the Judge's portraits (their 3D models' default colours). */
export const LandlordPortrait = ({ size, talking, className }: { size: number; talking?: boolean; className?: string }) => <Portrait arch="landlord" size={size} mood={talking ? 'talking' : undefined} className={className} />;
export const JudgePortrait = ({ size, className }: { size: number; className?: string }) => <Portrait arch="judge" size={size} className={className} />;
