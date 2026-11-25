# Dip Catcher — Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana

[![make.fun](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/bagusin03/tiny-sol-dip-catcher/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/bagusin03/tiny-sol-dip-catcher/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A tiny mean-reversion bot for hourly Solana prices. It speaks the
`agent-fun/bars-replay/v1` protocol over stdin/stdout and trades 7 symbols
(FARTCOIN, JITOSOL, POPCAT, RAY, SOL, WETH, WIF) against USDC.

## Strategy

On the dev window every symbol fell (-3% to -14%) and buy-and-hold lost
$869, yet each symbol's trailing 24h return is strongly negatively
correlated with its next 24h return (corr -0.29 to -0.63): sharp 24h drops
bounce, slow grinds do not. So the bot buys dips and sells the bounce
quickly, long only:

- **Entry:** trailing 24-bar return ≤ -1.5% buys 10% of equity (shallow dip);
  ≤ -5% buys 25% of equity (deep dip, the weight cap). At most 2 new
  entries per bar, worst drops first. Zero-volume bars signal nothing.
- **Exit, whole position:** +3% from entry (shallow) / +8% (deep), or -2%
  stop, or after 12 bars held. A refused sell is retried while its reason
  still holds; a rejected buy never blocks a fresh entry.
- **Sizing** is capped by the 25% weight cap and by unspent cash; a sell's
  proceeds never fund a buy of the same reply.

Fully deterministic: float64 ratios of the closes only — no clock, no
randomness, no network, no environment reads.

## Dev results (grade-local, `--driver process`)

| Bot | Net PnL (USDC) | Trades | Max drawdown |
| --- | --- | --- | --- |
| **Dip Catcher (this bot)** | **+$649.24** | 68 | 3.24% |
| Best house baseline (macd-cci) | -$20.22 | 17 | 2.46% |
| Buy-and-hold | -$869.34 | 7 | 10.92% |

90% bootstrap interval over assets: +$305 to +$1,000. At 2x fees: +$540.72.
Stress-tested on 20 sliding 72-bar windows of the dev data: median +$23,
12/20 positive, beats buy-and-hold in 15/20, minimum 15 trades per window
(guardrail: 8).

## Run

```sh
node main.ts   # Node 22.18+; the grader runs Node 22.23.4
```

`main.ts` is the entrypoint; `vendor/makefun-bars.ts` is the kit's protocol
shim, copied byte-identical from the kit's `sdk/makefun-bars.ts`.
