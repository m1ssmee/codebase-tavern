import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { verifyCard } from '@/lib/roastSign';
import { qrSvg } from '@/lib/faceSvg';
import RoastCardView from '@/components/RoastCardView';
import FitCard from './FitCard';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Props = { searchParams: Promise<{ d?: string | string[] }> };
const FONTS = { sans: 'var(--font-inter-tight), system-ui, sans-serif', mono: 'var(--font-jetbrains), ui-monospace, monospace', display: 'var(--font-newsreader), Georgia, serif' };
const payload = async (p: Props) => {
  const d = (await p.searchParams).d;
  return typeof d === 'string' ? d : '';
};
async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  return `${h.get('x-forwarded-proto') ?? (/^(localhost|127\.)/.test(host) ? 'http' : 'https')}://${host}`;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const d = await payload(props);
  const card = verifyCard(d);
  if (!card) return { title: 'Tampered notice · Codebase Tavern', robots: { index: false } };
  const o = await origin();
  const title = `${card.repo}: health inspection, grade ${card.grade}`;
  const image = `${o}/roast/og?d=${d}`;
  return {
    metadataBase: new URL(o),
    title,
    description: card.headline,
    openGraph: { type: 'website', title, description: card.headline, url: `${o}/roast?d=${d}`, siteName: 'Codebase Tavern', images: [{ url: image, width: 1200, height: 630, alt: `${card.repo}, grade ${card.grade}` }] },
    twitter: { card: 'summary_large_image', title, description: card.headline, images: [image] },
  };
}

/** A shared health-inspection notice: verified server-side before anything is shown. */
export default async function RoastPage(props: Props) {
  const d = await payload(props);
  const card = verifyCard(d);
  if (!card) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#efe9dd] px-6 text-center">
        <div>
          <p className="font-display text-3xl text-tomato italic">This notice has been tampered with.</p>
          <Link href="/" className="mt-4 inline-block text-sm text-muted underline underline-offset-4 hover:text-cream">
            Codebase Tavern
          </Link>
        </div>
      </main>
    );
  }
  const o = await origin();
  return (
    <main className="min-h-screen bg-[#efe9dd] px-4 py-8">
      <div className="mx-auto max-w-[1200px]">
        <FitCard width={1200} height={630}>
          <RoastCardView card={card} size="landscape" fonts={FONTS} qr={qrSvg(`${o}/roast?d=${d}`)} url={new URL(o).host} />
        </FitCard>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {card.repo.includes('/') && (
            <Link href={`/tavern?repo=${encodeURIComponent(card.repo)}`} className="bounce-hover rounded-full bg-amber px-5 py-2.5 text-sm font-medium text-ink">
              Open this repo in the tavern
            </Link>
          )}
          <Link href="/" className="rounded-full border border-edge bg-panel px-5 py-2.5 text-sm text-cream hover:border-amber">
            Roast another repo
          </Link>
        </div>
      </div>
    </main>
  );
}
