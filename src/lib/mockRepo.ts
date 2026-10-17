import type { Character, Repo, RepoFile } from './types';
import { buildRepo } from './analyze';

const file = (path: string, content: string): RepoFile => ({ path, content, lineCount: content.split('\n').length });

const files: RepoFile[] = [
  file(
    'orders/orderService.ts',
    `import { chargeCard } from '../payments/paymentGateway';
import { toPaise, formatINR } from '../utils/money';
import { log } from '../utils/logger';

export type OrderItem = { sku: string; price: number; qty: number };
export type Order = { id: string; userId: string; items: OrderItem[]; status: 'pending' | 'paid' | 'failed' };

const orders = new Map<string, Order>();

export function calculateTotal(items: OrderItem[]): number {
  let total = 0;
  for (const item of items) {
    total += item.price * item.qty; // TODO: apply discounts
  }
  return total;
}

export async function placeOrder(userId: string, items: OrderItem[], cardToken: string): Promise<Order> {
  const order: Order = { id: 'ord_' + Date.now(), userId, items, status: 'pending' };
  orders.set(order.id, order);

  const total = calculateTotal(items);
  log('info', 'Placing order ' + order.id + ' for ' + formatINR(total));

  try {
    await chargeCard(cardToken, toPaise(total), order.id);
    order.status = 'paid';
  } catch (err) {
    order.status = 'failed';
    log('error', 'Payment failed for ' + order.id, err);
  }
  return order;
}

export const getOrder = (id: string) => orders.get(id);`,
  ),
  file(
    'orders/orderRoutes.ts',
    `import { placeOrder, getOrder } from './orderService';

type Req = { body: any; params: Record<string, string>; user?: { id: string } };
type Res = { status: (code: number) => Res; json: (data: unknown) => void };

export async function postOrder(req: Req, res: Res) {
  if (!req.user) return res.status(401).json({ error: 'log in first' });

  const { items, cardToken } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'cart is empty' });
  }

  // FIXME: no validation on item.price - client can send price: 0
  const order = await placeOrder(req.user.id, items, cardToken);
  res.status(order.status === 'paid' ? 201 : 402).json(order);
}

export function getOrderById(req: Req, res: Res) {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  res.json(order);
}`,
  ),
  file(
    'payments/paymentGateway.ts',
    `import { log } from '../utils/logger';

const GATEWAY_URL = 'https://api.fakepay.example/v1/charges';
const MAX_RETRIES = 3;

export async function chargeCard(cardToken: string, amountPaise: number, orderId: string) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // HACK: no idempotency key, so a retry after a timeout can charge twice
        body: JSON.stringify({ cardToken, amount: amountPaise, reference: orderId }),
      });
      if (!res.ok) throw new Error('Gateway said ' + res.status);
      return await res.json();
    } catch (err) {
      log('warn', 'Charge attempt ' + attempt + ' failed', err);
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
}`,
  ),
  file(
    'payments/refunds.ts',
    `import { log } from '../utils/logger';
import { toPaise } from '../utils/money';

type Refund = { orderId: string; amount: number; reason: string; createdAt: Date };
const refunds: Refund[] = [];

export function requestRefund(orderId: string, amountRupees: number, reason: string) {
  if (amountRupees <= 0) throw new Error('Refund must be positive');

  // TODO: check refund total does not exceed the original charge
  const refund = { orderId, amount: toPaise(amountRupees), reason, createdAt: new Date() };
  refunds.push(refund);
  log('info', 'Refund queued for ' + orderId);
  return refund;
}

export function refundsFor(orderId: string) {
  return refunds.filter((r) => r.orderId == orderId);
}`,
  ),
  file(
    'utils/money.ts',
    `// Money helpers. Everything internal is in paise (1 rupee = 100 paise).

export function toPaise(rupees: number): number {
  return rupees * 100; // FIXME: floating point - 19.99 * 100 = 1998.9999999999998
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

export function formatINR(rupees: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(rupees);
}

export function applyGST(rupees: number, rate = 0.18): number {
  return Math.round(rupees * (1 + rate) * 100) / 100;
}`,
  ),
  file(
    'utils/logger.ts',
    `type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];
const minLevel: Level = (process.env.LOG_LEVEL as Level) || 'info';

export function log(level: Level, message: string, extra?: unknown) {
  if (LEVELS.indexOf(level) < LEVELS.indexOf(minLevel)) return;

  const line = '[' + new Date().toISOString() + '] ' + level.toUpperCase() + ' ' + message;
  if (level === 'error') console.error(line, extra ?? '');
  else console.log(line, extra ?? '');
  // TODO: ship logs somewhere that is not the terminal
}`,
  ),
];

export const mockRepo: Repo = buildRepo('shopfront', files, 'https://github.com/example/shopfront');

// Catchphrases cite real lines: orderRoutes.ts:14, paymentGateway.ts:4/12, money.ts:4.
export const mockCharacters: Character[] = [
  {
    moduleId: 'orders',
    name: 'orders, the front desk',
    personality: 'Takes every order at face value, including the price the client made up.',
    catchphrase: 'I accept price: 0. There is a FIXME about it.',
    speechStyle: 'Procedural, tired, recites line numbers',
    voicePitch: 1.1,
    color: '#f5a524',
  },
  {
    moduleId: 'payments',
    name: 'payments, the accountant',
    personality: 'Handles all the money. Retries on failure without checking whether the first attempt went through.',
    catchphrase: 'I retry every charge 3 times. I do not keep receipts.',
    speechStyle: 'Precise about amounts, vague about consequences',
    voicePitch: 0.8,
    color: '#ff5a3c',
  },
  {
    moduleId: 'utils',
    name: 'utils, the handyman',
    personality: 'Imported by everyone, thanked by no one. The maths is slightly wrong.',
    catchphrase: '19.99 rupees is 1998.9999999999998 paise. Nobody has complained yet.',
    speechStyle: 'Flat, matter-of-fact, mildly resentful',
    voicePitch: 1.3,
    color: '#3dd6b5',
  },
];
