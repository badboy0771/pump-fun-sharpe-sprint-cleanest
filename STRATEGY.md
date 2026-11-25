# STRATEGY.md — Steady Rider

## Method

Ranking is by hourly Sharpe ratio, so this bot optimises for a smooth,
steady return stream, not for one moonshot. It buys a small, fixed stake
(0.05 SOL) in many fresh launches that pass a rug filter, then rides each
one with a wide stop and a trailing stop instead of taking a quick profit.
Losers cost at most half a small stake; a runner toward curve completion
pays for dozens of them.

Entry (decided within 40 slots after creation): creator has not sold,
creator's own create-slot buy ≤ 2.5 SOL, at most 8 distinct non-creator
buyers at launch, curve holds 1–30 SOL of real reserves, no large single
sell vs the reserve, sells not already outrunning buys, price not already
>100x its create price.

Exits: hard stop -50%, trailing stop (arms at +20%, exits on -30% from
best value), creator sells while held, 100,000-slot hold cap that
effectively never binds. The replay closes a position when its curve
completes.

## Dev-window evidence

Graded locally with the kit (`node cli/makefun.mjs grade-local --kit .
--bot <repo> --driver process --worktree --json`), 7 cells swept:

| cell | change vs previous | Sharpe | net PnL | coins | fills | win rate | max DD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v1 | TP +30% / SL -25%, stake 0.04 | -0.821 | -0.595 SOL | 193 | 381 | 17.6% | 0.061 |
| v2 | no TP, SL -50%, trail +20%/-30% | -0.174 | -0.123 SOL | 71 | 137 | 19.7% | 0.028 |
| v3 | momentum gate + tighter trail | -0.190 | -0.129 SOL | 71 | 137 | 22.5% | 0.028 |
| v4 | loose entry (≤8 buyers, ≤30 SOL) | -0.153 | -0.107 SOL | 72 | 139 | 20.8% | 0.026 |
| v5 | 5,000-slot hold cap | -1.016 | -0.958 SOL | 271 | 537 | 17.3% | 0.109 |
| v6 | **shipped**: stake 0.05, min reserve 1 SOL | **-0.137** | -0.119 SOL | 72 | 139 | 20.8% | 0.031 |
| v7 | stop -40% | -0.147 | -0.134 SOL | 75 | 145 | 21.3% | 0.032 |

Shipped (v6) detail: Sharpe -0.137, Sortino -0.205, net PnL -0.1188 SOL
(return -1.19%, 90% interval -0.352 .. +0.127 SOL), 139 fills over 72
coins, 72 round trips, win rate 20.8%, max drawdown 0.0312, 3 failed txs,
0 rejected, fees 0.0604 SOL curve + 0.0154 SOL tx. Guardrails met (72
coins ≥ 20 required, drawdown 0.031 ≪ 0.50 cap). Top 3 coins made 57.2%
of the gains; without them net PnL would be -0.295 SOL. The revert to v6
after v7 reproduced v6 byte for byte (same action-log sha256), so the bot
is deterministic across runs.

Lessons: v1's early take-profit clipped the runners that pay for the
losers; v5's fast hold cap sold into dumps and paid fees on 271 trips;
v3's momentum gate barely bound (same 71 coins as v2); the binding
constraint on coin count is the 5-open-position cap plus long holds, not
the entry filter. Dev window holds 1,222 launches in 24h; the bot trades
~6% of them.

## What the dev window cannot prove

The final window is fresh chain data recorded after entries close, so dev
PnL and dev Sharpe are only weak signals — and on dev this bot is still
net negative (-0.119 SOL), so it is NOT prize-eligible on dev numbers
(prize needs net PnL > 0). What transfers is the shape: bounded downside
(small stake, -50% stop, drawdown 3.1% vs the 50% cap), guardrail margins
(72 coins vs 20 required), and upside exposure to completers. If the
final window holds a runner, the rider shape captures it; if it holds
none, the bot loses roughly a tenth of a SOL. The final-window outcome
is a lottery on whether a completer shows up among the ~70 coins traded.
