import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyCard } from '@/lib/roastSign';
import { qrSvg } from '@/lib/faceSvg';
import RoastCardView from '@/components/RoastCardView';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Bundled OFL fonts (assets/fonts, licences alongside), read once per instance.
const font = (file: string) => readFile(join(process.cwd(), 'assets/fonts', file));
const fonts = Promise.all([
  font('inter-tight-latin-400-normal.woff'),
  font('inter-tight-latin-600-normal.woff'),
  font('jetbrains-mono-latin-400-normal.woff'),
  font('jetbrains-mono-latin-700-normal.woff'),
  font('newsreader-latin-500-normal.woff'),
  font('newsreader-latin-500-italic.woff'),
]).then(([s4, s6, m4, m7, d5, d5i]) => [
  { name: 'Inter Tight', data: s4, weight: 400 as const, style: 'normal' as const },
  { name: 'Inter Tight', data: s6, weight: 600 as const, style: 'normal' as const },
  { name: 'JetBrains Mono', data: m4, weight: 400 as const, style: 'normal' as const },
  { name: 'JetBrains Mono', data: m7, weight: 700 as const, style: 'normal' as const },
  { name: 'Newsreader', data: d5, weight: 500 as const, style: 'normal' as const },
  { name: 'Newsreader', data: d5i, weight: 500 as const, style: 'italic' as const },
]);

/** The 1200×630 link-preview image for a verified notice. Tampered or unsigned payloads get no image. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const d = url.searchParams.get('d') ?? '';
  const card = verifyCard(d);
  if (!card) return new Response('This notice has been tampered with.', { status: 400 });
  return new ImageResponse(
    <RoastCardView card={card} size="landscape" fonts={{ sans: 'Inter Tight', mono: 'JetBrains Mono', display: 'Newsreader' }} qr={qrSvg(`${url.origin}/roast?d=${d}`)} url={url.host} />,
    { width: 1200, height: 630, fonts: await fonts, headers: { 'Cache-Control': 'public, max-age=86400, immutable' } },
  );
}
