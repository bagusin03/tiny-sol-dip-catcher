// Dip Catcher: a tiny mean-reversion bot for hourly Solana bars.
//
// Idea, from the dev window (solana-bars-1h-01-dev, 136 bars, 7 symbols):
// every symbol fell (-3% to -14%), buy-and-hold lost $869, yet the trailing
// 24h return is strongly negatively correlated with the next 24h return
// (corr -0.29 to -0.63 per symbol): sharp 24h drops bounce, slow grinds do
// not. So the bot buys dips and sells the bounce quickly, long only.
//
// Rules, per symbol, on each bar's close (fills land at the next bar's open):
//   - entry: trailing 24-bar return <= -1.5% buys 10% of equity (shallow dip),
//     <= -5% buys 25% of equity (deep dip, the weight cap), at most 2 new
//     entries per bar, worst drops first. A zero-volume bar signals nothing.
//   - exit, whole position: +3% from entry (shallow) / +8% (deep), or -2%
//     (stop), or after 12 bars held. A sell the market refuses is retried on
//     the next bar while its reason still holds.
//   - sizing is capped by the weight cap (25% of equity per symbol) and by
//     the cash this reply has not spent yet; a sell's proceeds never fund a
//     buy of the same reply.
// Deterministic: float64 ratios of the closes only, no clock, no randomness,
// no network, no environment reads. History is built from warm-up bars too.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const LOOKBACK = 24;
const SHALLOW_DROP = -0.015;
const DEEP_DROP = -0.05;
const SHALLOW_SIZE = 0.1;
const DEEP_SIZE = 0.25;
const SHALLOW_TAKE = 0.03;
const DEEP_TAKE = 0.08;
const STOP = -0.02;
const HOLD_MAX = 12;
const TOP_PER_BAR = 2;
const MAX_SLIPPAGE_BPS = 100;

const closes = new Map<string, number[]>();
const entry = new Map<string, { price: number; bar: number; take: number }>();

function ret24(symbol: string): number | null {
  const h = closes.get(symbol);
  if (h === undefined || h.length <= LOOKBACK) return null;
  return h[h.length - 1] / h[h.length - 1 - LOOKBACK] - 1;
}

await runBars({
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      const h = closes.get(bar.symbol) ?? [];
      h.push(Number(bar.c));
      closes.set(bar.symbol, h);
    }
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    // Prune entries whose position is gone (buy rejected, or sell filled):
    // a rejected buy must not block a fresh entry, and a rejected sell must
    // keep its entry so the exit is retried while its reason still holds.
    for (const symbol of [...entry.keys()]) {
      if (!state.positions.has(symbol)) entry.delete(symbol);
    }
    const sells: SellInput[] = [];
    for (const [symbol, held] of state.positions) {
      const e = entry.get(symbol);
      const c = state.close(symbol);
      if (e === undefined || c === null) continue;
      const r = Number(c) / e.price - 1;
      if (r >= e.take || r <= STOP || batch.seq - e.bar >= HOLD_MAX) {
        sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }

    const cand: { symbol: string; ret: number; deep: boolean }[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (state.positions.has(symbol) || entry.has(symbol)) continue;
      const bar = batch.bars.find((b) => b.symbol === symbol);
      if (bar === undefined || bar.v === '0') continue;
      const r = ret24(symbol);
      if (r === null) continue;
      if (r <= DEEP_DROP) cand.push({ symbol, ret: r, deep: true });
      else if (r <= SHALLOW_DROP) cand.push({ symbol, ret: r, deep: false });
    }
    cand.sort((a, b) => a.ret - b.ret);

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    // Slots free after this reply's sells: their proceeds land at the next
    // open and never fund this reply's buys, but the slots themselves do free up.
    let room = Math.min(state.hello.symbols.length, caps.max_open_positions) - state.positions.size + sells.length;
    let cash = state.cash;
    const equity = state.equity;
    for (const { symbol, deep } of cand) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      const frac = deep ? DEEP_SIZE : SHALLOW_SIZE;
      let slice = (BigInt(Math.floor(frac * 10000)) * equity) / BPS;
      const byWeight = (BigInt(caps.max_weight_bps) * equity) / BPS;
      if (slice > byWeight) slice = byWeight;
      if (slice > cash) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) continue;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      const c = state.close(symbol);
      if (c !== null) entry.set(symbol, { price: Number(c), bar: batch.seq, take: deep ? DEEP_TAKE : SHALLOW_TAKE });
      cash -= slice;
      room--;
    }
    return orders;
  },
});
