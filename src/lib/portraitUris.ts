// Server only: portraits as PNG data URIs for the Roast card rendered on the server (/roast and its link preview; the
// preview's rasteriser can't paint WebP). Converted once per instance; a missing file falls back to the SVG face.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { portraitName } from './portraits';
import type { RoastCard } from './roast';

const cache = new Map<string, Promise<string | null>>();
const uri = (name: string) => {
  if (!cache.has(name))
    cache.set(
      name,
      readFile(join(process.cwd(), 'public/portraits', `${name}.webp`))
        .then((b) => sharp(b).png().toBuffer())
        .then((b) => `data:image/png;base64,${b.toString('base64')}`, () => null),
    );
  return cache.get(name)!;
};

export async function cardPortraits(card: RoastCard): Promise<{ faces: Record<string, string>; landlord?: string }> {
  const faces: Record<string, string> = {};
  await Promise.all(card.entries.map(async (e) => e.arch && (await uri(portraitName(e.arch, e.face[0], e.name)).then((u) => u && (faces[e.name] = u)))));
  return { faces, landlord: (await uri(portraitName('landlord', undefined))) ?? undefined };
}
