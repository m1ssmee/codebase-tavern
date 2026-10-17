// OpenAI spend guard: what each call cost (from the token usage it returns) and a daily budget per server instance.
// ponytail: per instance and in memory, so it's approximate (each serverless instance counts on its own, and a cold
// start begins at $0); the OpenAI account balance is the hard stop. A shared counter (KV) if it ever needs to be exact.

// gpt-5.4-mini's published prices, USD per token: input $0.75/M, cached input $0.075/M, output $4.50/M (reasoning
// tokens bill as output). Used for any OPENAI_MODEL; update them if the model changes.
const PRICE = { input: 0.75e-6, cached: 0.075e-6, output: 4.5e-6 };
const DEFAULT_BUDGET = 2.5;

export const costOf = (input: number, cached: number, output: number) => (input - cached) * PRICE.input + cached * PRICE.cached + output * PRICE.output;

const env = Number(process.env.OPENAI_DAILY_BUDGET_USD);
export const DAILY_BUDGET = process.env.OPENAI_DAILY_BUDGET_USD && env >= 0 ? env : DEFAULT_BUDGET;

/** Today's OpenAI spend on this instance (UTC day). */
export function makeMeter(budget = DAILY_BUDGET) {
  let day = '';
  let usd = 0;
  const roll = (now: Date) => {
    const d = now.toISOString().slice(0, 10);
    if (d !== day) [day, usd] = [d, 0];
  };
  return {
    add(cost: number, now = new Date()) {
      roll(now);
      usd += cost;
      return usd;
    },
    spent(now = new Date()) {
      roll(now);
      return usd;
    },
    over(now = new Date()) {
      roll(now);
      return usd >= budget;
    },
    budget,
  };
}
export const openaiSpend = makeMeter();

/**
 * Holds an estimate for an OpenAI call while it runs (prompt characters / 4 in, the output cap out), so calls running
 * at the same time, and streams that end without reporting usage, still count. The usage settles it; a call that
 * never started is refunded.
 */
export function reserve(chars: number, maxOut: number, meter = openaiSpend) {
  let held = costOf(Math.ceil(chars / 4), 0, maxOut);
  meter.add(held);
  return {
    /** The call's real cost replaces the estimate; returns today's total. */
    settle(usd: number) {
      const total = meter.add(usd - held);
      held = 0;
      return total;
    },
    refund() {
      meter.add(-held);
      held = 0;
    },
  };
}
export type Reservation = ReturnType<typeof reserve>;
