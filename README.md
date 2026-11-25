# Steady Rider — Pump.fun Sharpe Sprint

[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/badboy0771/pump-fun-sharpe-sprint-cleanest/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/badboy0771/pump-fun-sharpe-sprint-cleanest/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

A paper-trading bot for the [Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532) bounty on make.fun. It trades on a 6-hour pump.fun forward replay; places go by hourly Sharpe ratio, so steady, controlled gains beat one lucky moonshot.

## Strategy

Small (0.05 SOL) stakes in many fresh launches that pass a rug filter
(creator hasn't sold, no bundle smell, real reserves 1–30 SOL), then ride
with a wide -50% stop and a trailing stop (+20% arm / -30% from best) so
a runner toward curve completion pays for dozens of small losers. See
[STRATEGY.md](STRATEGY.md).

## Run

```sh
node cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

`main.ts` runs on Node 22+ (`node main.ts`); the SDK shim is vendored in
`vendor/makefun-bot.ts`. No network, no randomness, no clock — the bot is
a pure function of the replayed batch stream, so the grader's two runs
produce byte-identical action logs.
