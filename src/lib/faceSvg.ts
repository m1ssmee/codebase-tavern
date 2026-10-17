// Static SVG faces for the roast card and its OG image (no React, no animation: ImageResponse can't run hooks).
// Same drawing as CharacterFace (an inspected module: sweating, round mouth, eyes up) and LandlordFace. Pure.
import { faceTraits, hash, PALETTE } from './characters.ts';
import type { FaceSpec } from './roast.ts';
import qrcode from 'qrcode-generator';

const INK = '#17110e';
const uri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** A module's face, being inspected. */
export function faceSvg(name: string, [color, totalLines, todoCount, biggest, maxNesting, tested]: FaceSpec): string {
  const h = hash(name);
  const t = faceTraits({ totalLines, todoCount, biggestFile: { path: '', lines: biggest }, maxNesting, hasTests: !!tested, fileCount: 1 });
  const fill = /^#[0-9a-f]{3,8}$/i.test(color) ? color : PALETTE[h % PALETTE.length];
  const rx = 28 + 18 * t.width;
  const ry = 34 + (h % 5);
  const cy = 94 - ry;
  const ex = rx * 0.4;
  const ey = cy - ry * 0.12;
  const my = cy + ry * 0.38;
  const acc = (h >> 3) % 4;
  const top = cy - ry;
  const accessory =
    acc === 1
      ? `<path d="M44 ${top + 2} l-3 -9 M50 ${top} v-10 M56 ${top + 2} l3 -9" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`
      : acc === 2
        ? `<line x1="50" y1="${top}" x2="50" y2="${top - 11}" stroke="${INK}" stroke-width="3.5"/><circle cx="50" cy="${top - 13}" r="4.5" fill="${fill}" stroke="${INK}" stroke-width="3"/>`
        : acc === 3
          ? [-1, 1].map((d) => `<circle cx="${50 + d * rx * 0.62}" cy="${cy - ry * 0.78}" r="8" fill="${fill}" stroke="${INK}" stroke-width="4"/>`).join('')
          : '';
  const eyes = [-ex, ex].map((dx) => `<circle cx="${50 + dx}" cy="${ey}" r="9.5" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="${50 + dx}" cy="${ey - 3}" r="4.5" fill="${INK}"/>`).join('');
  return uri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -22 112 124" width="112" height="124">` +
      `<ellipse cx="50" cy="97" rx="${rx * 0.75}" ry="3" fill="#000" opacity="0.3"/>${accessory}` +
      `<ellipse cx="50" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${INK}" stroke-width="5"/>` +
      `<ellipse cx="${50 - rx * 0.45}" cy="${cy - ry * 0.5}" rx="6" ry="3.5" fill="#fff" opacity="0.28"/>${eyes}` +
      `<circle cx="50" cy="${my + 1}" r="5" fill="${INK}"/>` +
      `<path d="M${50 + rx - 2} ${cy - ry * 0.55} q5 8 0 11 q-5 -3 0 -11z" fill="#8ad4ff" stroke="${INK}" stroke-width="2"/></svg>`,
  );
}

/** The Landlord: half-shut eyes, reading glasses up, a key per module. */
export function landlordSvg(keys: number): string {
  const n = Math.max(1, Math.min(keys, 10));
  const ring = Array.from({ length: n }, (_, i) => {
    const a = -150 + (i * 120) / Math.max(1, n - 1);
    return `<g transform="rotate(${a}) translate(0 10)"><rect x="-1.6" y="0" width="3.2" height="10" rx="1" fill="#d9b44a" stroke="${INK}" stroke-width="1.2"/><rect x="1.4" y="6" width="3" height="2" fill="#d9b44a" stroke="${INK}" stroke-width="1"/></g>`;
  }).join('');
  const eye = (x: number) =>
    `<circle cx="${x}" cy="55" r="7" fill="#fff" stroke="${INK}" stroke-width="2.5"/><circle cx="${x}" cy="57" r="3.2" fill="${INK}"/>` +
    `<path d="M${x - 8} 54 h16 v-9 h-16 z" fill="#e8d8c3"/><line x1="${x - 7.5}" x2="${x + 7.5}" y1="54" y2="54" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>` +
    `<path d="M${x - 6} 65 q6 4 12 0" stroke="${INK}" stroke-width="1.8" fill="none" opacity="0.55" stroke-linecap="round"/>`;
  return uri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 104" width="104" height="104">` +
      `<ellipse cx="50" cy="97" rx="24" ry="3" fill="#000" opacity="0.3"/>` +
      `<ellipse cx="50" cy="58" rx="29" ry="34" fill="#e8d8c3" stroke="${INK}" stroke-width="5"/>` +
      `<path d="M36 28 q4 -6 8 -1 M47 25 q4 -6 8 -1 M58 27 q4 -5 7 0" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>` +
      `<g stroke="${INK}" stroke-width="3" fill="#cfe6f5" fill-opacity="0.55"><circle cx="39" cy="36" r="7.5"/><circle cx="61" cy="36" r="7.5"/>` +
      `<path d="M46.5 36 q3.5 -3 7 0 M31.5 35 l-6 2 M68.5 35 l6 2" fill="none" stroke-linecap="round"/></g>${eye(38)}${eye(62)}` +
      `<path d="M36 74 q7 -6 14 -1 q7 -5 14 1 q-7 4 -14 1 q-7 3 -14 -1 z" fill="#6f655c" stroke="${INK}" stroke-width="2"/>` +
      `<path d="M43 81 q7 -2 14 0" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>` +
      `<g transform="translate(84 84)"><circle r="6.5" fill="none" stroke="${INK}" stroke-width="2.5"/>${ring}</g></svg>`,
  );
}

/**
 * QR code for the share link: an SVG data URI and its module count, so the card can draw it at a whole number
 * of pixels per module (error correction L: the links are long; 2px a module decodes from the PNG).
 */
export type Qr = { uri: string; modules: number };
export function qrSvg(text: string): Qr {
  const qr = qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { modules: n + 4, uri: uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#171717"/></svg>`) };
}
