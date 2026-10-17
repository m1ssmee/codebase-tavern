// OpenAI with two keys, in order: the primary until its account is out of credit, then the backup. Switching happens
// only on a credit or billing error (429 insufficient_quota, a billing hard limit) or a dead key (401), and the same
// request is retried on the next key at once; an ordinary rate limit waits and retries the same key. Exhausted keys
// stay out for the life of this server instance. No key value is ever logged or returned (errors are scrubbed).
// No SDK import here, so scripts/check.mjs can drive it with real SDK clients against a fake server.

type ErrLike = { status?: number; code?: string | null; type?: string | null; error?: { code?: string; type?: string; message?: string }; message?: string; headers?: Headers | Record<string, string> };

/** What an OpenAI error means for the key in use. */
export function keyError(err: unknown): 'switch' | 'retry' | 'other' {
  const e = (err ?? {}) as ErrLike;
  const code = String(e.code ?? e.error?.code ?? '');
  const type = String(e.type ?? e.error?.type ?? '');
  const text = `${code} ${type} ${e.message ?? ''} ${e.error?.message ?? ''}`;
  if (e.status === 401) return 'switch'; // revoked or invalid key
  if (code === 'insufficient_quota' || type === 'insufficient_quota' || /billing[_ ]hard[_ ]limit|exceeded your current quota/i.test(text)) return 'switch';
  if (e.status === 429 || e.status === 408 || e.status === 409 || (e.status ?? 0) >= 500) return 'retry'; // rate limit, overload
  return 'other';
}

/** Key fragments (OpenAI's own messages echo a masked key) never leave this module. */
export function scrub<T>(err: T): T {
  const s = (x: unknown) => (typeof x === 'string' ? x.replace(/sk-[A-Za-z0-9_*.\-]+/g, 'sk-…') : x);
  if (err && typeof err === 'object') {
    const e = err as { message?: string; error?: { message?: string } };
    try {
      if (typeof e.message === 'string') e.message = s(e.message) as string;
      if (e.error && typeof e.error.message === 'string') e.error.message = s(e.error.message) as string;
    } catch {
      // read-only message: leave it
    }
  }
  return err;
}

/** An attempt that ran past its own timeout (the SDK's APIConnectionTimeoutError): not a credit error, no key switch. */
export const timedOut = (err: unknown) => (err as Error)?.name === 'APIConnectionTimeoutError' || /request timed out/i.test(String((err as Error)?.message ?? ''));

/** How long to wait before retrying a rate-limited request: the server's hint, else 0.5 s, 1 s, 2 s. */
function backoff(err: unknown, attempt: number): number {
  const h = (err as ErrLike)?.headers;
  const get = (k: string) => (h instanceof Headers ? h.get(k) : (h as Record<string, string> | undefined)?.[k]) ?? null;
  const ms = Number(get('retry-after-ms')) || Number(get('retry-after')) * 1000;
  return Math.min(4000, ms > 0 ? ms : 500 * 2 ** attempt);
}

export type KeySlot = { name: string; key: string | undefined };

export function keyPool<C>(slots: KeySlot[], make: (key: string) => C, o: { retries?: number; log?: (msg: string) => void; sleep?: (ms: number) => Promise<void> } = {}) {
  const retries = o.retries ?? 2;
  const log = o.log ?? ((m: string) => console.warn(`[llm] ${m}`));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out = new Set<number>();
  const clients = new Map<number, C>();
  const client = (i: number) => {
    if (!clients.has(i)) clients.set(i, make(slots[i].key!));
    return clients.get(i)!;
  };
  const live = () => slots.map((s, i) => i).filter((i) => slots[i].key && !out.has(i));
  return {
    /** Is any key still usable? (Neither set, or both out of credit: the chain skips OpenAI.) */
    available: () => live().length > 0,
    /** Which key is serving now (for diagnostics; never the key itself). */
    current: () => slots[live()[0]]?.name ?? null,
    /**
     * One request, bounded: at most `timeoutRetries` (0 or 1) retries of an attempt that timed out, on the same key,
     * plus at most `retries` rate-limit backoffs; a credit error moves the same request to the next key. Counts are per
     * call, not per key, so a switch never resets them: no retry storms.
     */
    async call<T>(fn: (c: C) => Promise<T>, o: { retries?: number; timeoutRetries?: number; label?: string; attemptMs?: number } = {}): Promise<T> {
      const limit = o.retries ?? retries;
      let backoffs = 0;
      let timeouts = 0;
      for (const i of live()) {
        for (;;) {
          try {
            return await fn(client(i));
          } catch (err) {
            if (timedOut(err) && timeouts < (o.timeoutRetries ?? 0)) {
              timeouts++;
              log(`${o.label ?? 'call'}: attempt timed out${o.attemptMs ? ` after ${o.attemptMs / 1000}s` : ''} on the ${slots[i].name} key; retrying once on the same key.`);
              continue;
            }
            const kind = keyError(err);
            if (kind === 'retry' && backoffs < limit) {
              await sleep(backoff(err, backoffs++));
              continue;
            }
            if (kind !== 'switch') throw scrub(err);
            out.add(i);
            const next = live()[0];
            log(next !== undefined ? `OpenAI ${slots[i].name} key out of credit; switched to ${slots[next].name}.` : `OpenAI ${slots[i].name} key out of credit too; no OpenAI key left.`);
            break; // the same request, on the next key
          }
        }
      }
      // Every key is out: this message falls through to Gemini, then templates (llm.ts fallsThrough).
      throw new Error('insufficient_quota: every OpenAI key is out of credit');
    },
  };
}
