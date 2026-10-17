// The health-inspection notice. Inline styles and flexbox only, no hooks: the same component renders in the app,
// on /roast, and inside next/og's ImageResponse (Satori), so the PNG, the page and the link preview match.
// Every text block is one string: several JSX text pieces in a flex box become separate items that wrap apart.
import type { RoastCard } from '@/lib/roast';
import { SMALL_PRINT, STAMP } from '@/lib/roast';
import { faceSvg, landlordSvg, type Qr } from '@/lib/faceSvg';

export type CardSize = 'landscape' | 'square';
export const CARD_SIZE: Record<CardSize, { width: number; height: number }> = { landscape: { width: 1200, height: 630 }, square: { width: 1080, height: 1080 } };
export type CardFonts = { sans: string; mono: string; display: string };

const INK = '#171717';
const MUTED = '#6f6a62';
const RULE = '#d8d0c2';
const STAMP_COLOR: Record<string, string> = { PASSED: '#2e7d32', 'PASSED WITH CONCERNS': '#b26a00', FAILED: '#c62828' };

export default function RoastCardView({ card, size, fonts, qr, url }: { card: RoastCard; size: CardSize; fonts: CardFonts; qr?: Qr; url: string }) {
  const { width, height } = CARD_SIZE[size];
  const sq = size === 'square';
  const stamp = STAMP[card.grade];
  const tone = STAMP_COLOR[stamp];
  const row = { display: 'flex', flexDirection: 'row' } as const;
  const col = { display: 'flex', flexDirection: 'column' } as const;

  const qrPx = qr ? qr.modules * 2 : 0; // two whole pixels per module: scannable from the PNG
  const qrImg = qr && (
    // eslint-disable-next-line @next/next/no-img-element -- data URI, rendered by Satori too
    <img src={qr.uri} width={qrPx} height={qrPx} alt="" style={{ marginLeft: sq ? 30 : 18 }} />
  );
  const grade = (
    <div style={{ ...col, alignItems: 'center' }}>
      <div
        style={{
          ...row,
          width: sq ? 190 : 150,
          height: sq ? 190 : 150,
          borderRadius: 9999,
          border: `9px solid ${tone}`,
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.display,
          fontSize: sq ? 132 : 104,
          color: tone,
          lineHeight: 1,
        }}
      >
        {card.grade}
      </div>
    </div>
  );
  const counts = (
    <div style={{ ...row, marginTop: 10, fontFamily: fonts.mono, fontSize: sq ? 18 : 15, color: MUTED }}>
      {`${card.violations} ${card.violations === 1 ? 'violation' : 'violations'} in ${card.modules} ${card.modules === 1 ? 'module' : 'modules'} inspected`}
    </div>
  );
  const headline = (
    <div style={{ ...row, alignItems: 'flex-start', marginTop: sq ? 14 : 16 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URI, rendered by Satori too */}
      <img src={landlordSvg(card.keys)} width={sq ? 76 : 58} height={sq ? 76 : 58} alt="" />
      {/* Attribution first: the quote is the one block whose length varies, so it goes last and has room to grow. */}
      <div style={{ ...col, flex: 1, marginLeft: 12 }}>
        <div style={{ ...row, marginBottom: 4, fontFamily: fonts.mono, fontSize: sq ? 15 : 13, color: MUTED }}>{sq ? 'the Landlord, owner of the building:' : 'the Landlord:'}</div>
        <div style={{ ...row, fontFamily: fonts.display, fontStyle: 'italic', fontSize: sq ? 25 : 20, lineHeight: 1.25, color: INK }}>{`“${card.headline}”`}</div>
      </div>
    </div>
  );
  const entries = (
    <div style={{ ...col, flex: 1, justifyContent: 'space-around' }}>
      {card.entries.map((e) => (
        <div key={e.name} style={{ ...row, alignItems: 'flex-start', marginBottom: sq ? 14 : 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URI, rendered by Satori too */}
          <img src={faceSvg(e.name, e.face)} width={sq ? 76 : 58} height={sq ? 84 : 64} alt="" />
          <div style={{ ...col, flex: 1, marginLeft: 12 }}>
            <div style={{ ...row, fontFamily: fonts.sans, fontWeight: 600, fontSize: sq ? 23 : 18, color: INK }}>{e.title}</div>
            <div style={{ ...row, fontFamily: fonts.mono, fontSize: sq ? 17 : 14, color: '#8a4a1c', marginTop: 2 }}>{e.stat}</div>
            <div style={{ ...row, fontFamily: fonts.sans, fontSize: sq ? 20 : 16, color: '#2b2824', marginTop: 3, lineHeight: 1.3 }}>{e.line}</div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ ...col, width, height, padding: 16, background: '#efe9dd', fontFamily: fonts.sans, color: INK, position: 'relative' }}>
      <div style={{ ...col, flex: 1, background: '#fffdf8', border: `2px solid ${INK}`, borderRadius: 6, padding: sq ? '30px 40px 24px' : '22px 32px 16px' }}>
        <div style={{ ...row, fontFamily: fonts.mono, fontSize: sq ? 18 : 15, color: MUTED }}>{`codebase_tavern / health inspection · ${card.date}`}</div>
        <div style={{ ...row, fontFamily: fonts.display, fontSize: sq ? 52 : 40, marginTop: 4, color: INK }}>{card.repo}</div>
        <div style={{ ...row, borderTop: `2px dashed ${RULE}`, marginTop: sq ? 14 : 10, marginBottom: sq ? 22 : 14 }} />
        {sq ? (
          <div style={{ ...col, flex: 1 }}>
            <div style={{ ...row, alignItems: 'center' }}>
              {grade}
              <div style={{ ...col, flex: 1, marginLeft: 30 }}>
                {counts}
                {headline}
              </div>
              {qrImg}
            </div>
            <div style={{ ...row, borderTop: `2px dashed ${RULE}`, marginTop: 24, marginBottom: 18 }} />
            {entries}
          </div>
        ) : (
          <div style={{ ...row, flex: 1 }}>
            <div style={{ ...col, width: 350, paddingRight: 24 }}>
              <div style={{ ...row, alignItems: 'center' }}>
                {grade}
                {qrImg}
              </div>
              {counts}
              {headline}
            </div>
            <div style={{ ...col, flex: 1, paddingLeft: 26, borderLeft: `2px dashed ${RULE}` }}>{entries}</div>
          </div>
        )}
        <div style={{ ...row, borderTop: `2px dashed ${RULE}`, paddingTop: sq ? 14 : 10, marginTop: sq ? 12 : 6, alignItems: 'center' }}>
          <div style={{ ...col, flex: 1 }}>
            <div style={{ ...row, fontFamily: fonts.mono, fontSize: sq ? 17 : 14, color: INK }}>{`${url} · Every roast cites real code.`}</div>
            <div style={{ ...row, fontFamily: fonts.mono, fontSize: sq ? 14 : 12, color: MUTED, marginTop: 3 }}>{SMALL_PRINT}</div>
          </div>
        </div>
      </div>
      {/* The stamp, across the notice's top right: clear of the QR code and the lines people need to read. */}
      <div
        style={{
          ...row,
          position: 'absolute',
          right: sq ? 60 : 56,
          top: sq ? 96 : 66,
          transform: 'rotate(-8deg)',
          border: `5px solid ${tone}`,
          borderRadius: 10,
          padding: '4px 16px',
          color: tone,
          fontFamily: fonts.mono,
          fontWeight: 700,
          fontSize: stamp.length > 10 ? (sq ? 34 : 30) : sq ? 48 : 42,
          letterSpacing: 3,
          whiteSpace: 'nowrap',
          opacity: 0.85,
          background: 'rgba(255,253,248,0.6)',
        }}
      >
        {stamp}
      </div>
    </div>
  );
}
