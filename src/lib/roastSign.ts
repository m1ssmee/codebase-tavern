import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { fromCompact, toCompact, type RoastCard } from './roast';

// Share links carry the whole card (no database): Brotli-compressed compact JSON (its built-in dictionary suits
// English lines), base64url, plus a truncated HMAC-SHA256 (96 bits) under ROAST_SIGNING_SECRET. Only the server
// signs; /roast and the OG image verify before rendering anything.
const secret = () => process.env.ROAST_SIGNING_SECRET ?? '';
const mac = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url').slice(0, 16);
const BROTLI = { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT };

export const canSign = () => secret().length >= 32;

export function signCard(card: RoastCard): string | null {
  if (!canSign()) return null;
  const body = brotliCompressSync(Buffer.from(JSON.stringify(toCompact(card))), { params: BROTLI }).toString('base64url');
  return `${body}.${mac(body)}`;
}

/** The card, or null if the payload is malformed, oversized, unsigned or tampered with. */
export function verifyCard(d: unknown): RoastCard | null {
  if (typeof d !== 'string' || d.length > 8000 || !canSign()) return null;
  const [body, sig, ...rest] = d.split('.');
  if (!body || !sig || rest.length) return null;
  const [want, got] = [Buffer.from(mac(body)), Buffer.from(sig)];
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    return fromCompact(JSON.parse(brotliDecompressSync(Buffer.from(body, 'base64url'), { maxOutputLength: 32_000 }).toString('utf8')));
  } catch {
    return null;
  }
}
