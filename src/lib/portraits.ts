// Portrait files (npm run portraits → public/portraits/<archetype>-<hex>.webp): which one a character uses. Pure,
// so the server (the Roast card's link preview) and the client agree.
import { hash, PALETTE } from './characters.ts';
import type { Archetype } from './cast.ts';

/** The palette colour a character is drawn in: its own, else the same name-hash colour its 3D model falls back to. */
export const portraitColor = (color: string | undefined, name: string) => (color && PALETTE.includes(color.toLowerCase()) ? color.toLowerCase() : PALETTE[hash(name) % PALETTE.length]);
/** File name without the extension, e.g. "bouncer-f5a524". */
export const portraitName = (arch: Archetype, color: string | undefined, name: string = arch) => `${arch}-${portraitColor(color, name).slice(1)}`;
