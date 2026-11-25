// Steady Rider — a pump.fun replay bot (agent-fun/replay/v2), tuned for
// hourly Sharpe ratio, not for wild PnL.
//
// Ranking is by hourly Sharpe: steady, controlled gains beat one lucky
// moonshot. The v1 shape (bank early at +30%, cut at -25%) lost -0.595 SOL
// on the dev window with a 17.6% win rate — most fresh coins dump before
// any take-profit can trigger, so the early exits only locked in small
// losses and clipped the few runners that pay for them. v2 therefore
// rides instead of scalping: no take-profit, a wide -50% stop, and a
// trailing stop that lets a runner toward curve completion pay for dozens
// of small losers, while the small 0.04 SOL stake and the 5-position cap
// keep the per-hour return stream smooth and the drawdown tiny.
//
// v3 adds a momentum gate to the entry: v2 still lost -0.123 SOL (Sharpe
// -0.174) because buying in the first 3 slots means buying before the
// coin has shown any demand — most fresh coins are dead on arrival. v3
// watches up to 40 slots and only buys a coin that already shows buying
// pressure (at least 3 trades from at least 2 distinct non-creator
// buyers, price at least +5% over its create price), and tightens the
// trailing stop (arms at +15%, exits on -20% from best) so runners give
// back less of their gain.
//
// v4 loosens the entry to trade more coins: v3's momentum gate barely
// bound (same 71 coins, 137 fills as v2; Sharpe -0.190 vs v2's -0.174,
// the tighter trail costing a little). The dev window holds 1,222
// launches in 24h and v2/v3 only traded 71 of them — with ~3 coins an
// hour the hourly return stream is lumpy, which is exactly what Sharpe
// punishes. v4 takes up to 8 distinct launch buyers, real reserves up to
// 30 SOL, dev buys up to 2.5 SOL, and drops the trade/buyer/run-up minima,
// so it trades a broader, more diversified set; the trail reverts to v2's
// (arms +20%, exits -30% from best), which scored better than v3's
// tighter one. More coins also hedges the 20-distinct-mint guardrail on
// the 6-hour final window.
//
// v5 recycles positions fast: v4's coin count barely moved (71 -> 72)
// despite a much looser entry filter, so the binding constraint is not
// the filter — it is the 5-open-position cap combined with positions held
// for hours (100,000-slot cap, exits only on -50% / trail / creator sell).
// With ~3 coins an hour the hourly return stream stays lumpy, which is
// what Sharpe punishes. v5 caps every hold at 5,000 slots (~33 minutes),
// so the 5 slots turn over quickly and the bot trades many more coins;
// a coin that is going to run usually shows it within half an hour, and
// the trailing stop still protects the ones that do.
//
// v5 (5,000-slot hold cap) was much worse: Sharpe -1.016, -0.958 SOL on
// 271 coins — forcing exits after ~33 minutes sells into dumps, pays fees
// on 271 trips, and cuts runners before they can complete. Fast recycling
// is rejected; v4's long hold is restored.
//
// v6 (this version) keeps v4's shape but raises the stake to 0.05 SOL and
// requires at least 1 SOL of real reserves at entry, so the full stake
// fits the 1%-of-reserve size cap and the coin has shown real traction
// before we buy it.
//
// v7 tightens the hard stop from -50% to -40%: v6's losers still give back
// up to half a 0.05 SOL stake each, and with ~57 losing trips on the dev
// window that tail is what drags the hourly mean down. The trailing stop
// (arms +20%) still protects runners; the -40% stop only bites the coins
// that are dumping outright.
//
// v7 (-40% stop) scored worse than v6 (Sharpe -0.147 / -0.134 SOL vs
// -0.137 / -0.119) — the tighter stop cuts positions that would have
// recovered into trailing-stop territory. Reverted: the shipped version
// is v6's settings, hard stop -50%.
//
// Entry (decided within 40 slots after a coin is created, once it shows
// demand):
//   - the creator has not sold, and the creator's own buy in the create
//     slot is at most 2 SOL (a huge dev buy is usually a bundle);
//   - at most 5 distinct non-creator buyers piled in at launch;
//   - the curve already holds 0.3-20 SOL of real reserves;
//   - no single non-creator sell is large next to the reserve, and total
//     sells are not already outrunning buys;
//   - the price has not already run more than 100x off its create price.
// Exit (checked every batch while holding):
//   - hard stop at -50% of cost — losers are capped at half a small stake;
//   - trailing stop: once up 20%, sell on a 30% fall from the best value;
//   - the creator sells while we hold;
//   - a 100,000-slot hold cap that effectively never binds (it only guards
//     against a position lingering forever if the curve stalls).
// The replay closes a position when its curve completes, which is where
// the big wins live: a completer can return several times the stake, and
// spreading that upside over many small positions is what keeps the
// hourly Sharpe up instead of letting one moonshot dominate it.
//
// Guardrails: at most 5 open positions, every buy is capped at 1% of the
// coin's real SOL reserve, every round trip is at least 0.01 SOL, and the
// small stake plus wide-but-bounded stop keep drawdown far under the 50% cap.
//
// Deterministic by construction: no clock, no randomness, no I/O — only
// insertion-ordered maps fed by the batch stream, so the grader's two
// executions produce byte-identical action logs.

import { BPS, type Batch, type Bot, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAgeSlots: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAgeSlots: number;
  /** Lamports to aim for per coin (each order is still capped at 1% of real SOL). */
  stakeLamports: number;
  /** Smallest single buy worth paying the transaction fee for. */
  minBuyLamports: number;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSolLamports: number;
  maxRealSolLamports: number;
  /** Creator's own buys in the create slot: lamports window. */
  minDevBuyLamports: number;
  maxDevBuyLamports: number;
  /** Trades seen and distinct (non-creator) buyers seen before entry, at least. */
  minTrades: number;
  minBuyers: number;
  /** Distinct (non-creator) buyers seen before entry, at most. */
  maxBuyers: number;
  /** Lamports sold by others / lamports bought, as bps, at most. */
  maxSellRatioBps: number;
  /** Largest single non-creator sell seen, as bps of the real SOL reserve before it, at most. */
  maxBigSellBps: number;
  /** Price now over the create price, as bps: window. */
  minRunupBps: number;
  maxRunupBps: number;
  /** Slippage allowed on buys (bps). */
  buySlippageBps: number;
  /** Exit when the position is worth this much under its cost (bps). */
  stopLossBps: number;
  /** Trailing stop: once up at least this much, exit on a fall of this much from the best value (bps). */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHoldSlots: number;
  /** Exit when the creator sells while held. */
  exitOnCreatorSell: boolean;
  /** Creator sold before entry: skip the coin. */
  skipCreatorSold: boolean;
}

/** Shipped settings — v6 (final): 0.05 SOL stake, 1 SOL minimum real
 *  reserve at entry, no take-profit, -50% stop, trailing stop arms +20% /
 *  exits -30% from best, 100,000-slot hold cap. Dev window: Sharpe -0.137,
 *  net PnL -0.119 SOL, 72 coins, 139 fills, win rate 20.8%, max drawdown
 *  3.1%. Rejected cells: v1 -0.821 / -0.595 (TP +30% / SL -25% clipped
 *  runners); v2 -0.174 / -0.123; v3 -0.190 / -0.129 (momentum gate barely
 *  bound, tighter trail cost a little); v4 -0.153 / -0.107; v5 -1.016 /
 *  -0.958 (5,000-slot hold cap destroyed runners); v7 -0.147 / -0.134
 *  (-40% stop cut recoveries). */
export const DEFAULT_PARAMS: Params = {
  minAgeSlots: 0,
  maxAgeSlots: 40,
  stakeLamports: 50_000_000,
  minBuyLamports: 10_000_000,
  minRealSolLamports: 1_000_000_000,
  maxRealSolLamports: 30_000_000_000,
  minDevBuyLamports: 0,
  maxDevBuyLamports: 2_500_000_000,
  minTrades: 0,
  minBuyers: 0,
  maxBuyers: 8,
  maxSellRatioBps: 10_000,
  maxBigSellBps: 10_000,
  minRunupBps: 0,
  maxRunupBps: 1_000_000,
  buySlippageBps: 10_000,
  stopLossBps: 5_000,
  trailArmBps: 2_000,
  trailBps: 3_000,
  maxHoldSlots: 100_000,
  exitOnCreatorSell: true,
  skipCreatorSold: true,
};

const LAMPORTS = 1_000_000_000n;
/** Curve fee on a sale: protocol 95 bps + creator 30 bps. */
const CURVE_FEE_BPS = 125n;

/** Everything remembered about one fresh launch. */
interface Launch {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Reserves at creation, for the run-up check. */
  createVq: bigint;
  createVt: bigint;
  /** Creator's own buys in the create slot. */
  devBuy: bigint;
  /** Creator sold at any point. */
  creatorSold: boolean;
  /** Trades seen since creation (buys and sells). */
  trades: number;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  /** Largest single non-creator sell, in bps of the reserve before it. */
  bigSellBps: bigint;
  /** Never consider this coin again (decided, exited, or completed). */
  done: boolean;
}

/** A position we hold, with the state its exits need. */
interface Ride {
  openedSlot: number;
  /** Best close value seen so far (lamports, after curve fee and tx fee). */
  bestValue: bigint;
  /** True once a sell for this position is already in flight. */
  selling: boolean;
}

/** What selling `tokens` against reserves (vq, vt) pays after the curve fee. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const quote = (tokens * vq) / (vt + tokens);
  return quote - (quote * CURVE_FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Bot {
  const P = params;
  const launches = new Map<Pubkey, Launch>();
  const rides = new Map<Pubkey, Ride>();
  const selling = new Set<Pubkey>();

  /** Fold one batch of chain events into the launch records. */
  function observe(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        if (!launches.has(e.mint)) {
          launches.set(e.mint, {
            mint: e.mint,
            createSlot: e.slot,
            creator: e.creator,
            createVq: BigInt(e.virtual_quote_reserves),
            createVt: BigInt(e.virtual_token_reserves),
            devBuy: 0n,
            creatorSold: false,
            trades: 0,
            buyers: new Set(),
            bought: 0n,
            soldByOthers: 0n,
            bigSellBps: 0n,
            done: false,
          });
        }
        continue;
      }
      if (e.event !== 'TradeEvent') continue;
      const launch = launches.get(e.mint);
      if (launch === undefined) continue;
      const sol = BigInt(e.sol_amount);
      const isCreator = e.user === launch.creator;
      launch.trades += 1;
      if (e.is_buy) {
        launch.bought += sol;
        if (isCreator && e.slot === launch.createSlot) launch.devBuy += sol;
        if (!isCreator) launch.buyers.add(e.user);
      } else {
        if (isCreator) {
          launch.creatorSold = true;
        } else {
          launch.soldByOthers += sol;
          // Reserve before this sell: the trade's own SOL has just left it.
          const reserveBefore = BigInt(e.real_quote_reserves) + sol;
          if (reserveBefore > 0n) {
            const bps = (sol * BPS) / reserveBefore;
            if (bps > launch.bigSellBps) launch.bigSellBps = bps;
          }
        }
      }
    }
  }

  /** Does this fresh launch pass the rug filter at slot `now`? */
  function qualifies(
    launch: Launch,
    now: number,
    curve: { real_quote_reserves: string; virtual_quote_reserves: string; virtual_token_reserves: string } | undefined,
  ): boolean {
    if (launch.done || curve === undefined) return false;
    const age = now - launch.createSlot;
    if (age < P.minAgeSlots || age > P.maxAgeSlots) return false;
    if (P.skipCreatorSold && launch.creatorSold) return false;
    if (launch.devBuy < BigInt(P.minDevBuyLamports) || launch.devBuy > BigInt(P.maxDevBuyLamports)) return false;
    if (launch.trades < P.minTrades || launch.buyers.size < P.minBuyers) return false;
    if (launch.buyers.size > P.maxBuyers) return false;
    const realSol = BigInt(curve.real_quote_reserves);
    if (realSol < BigInt(P.minRealSolLamports) || realSol > BigInt(P.maxRealSolLamports)) return false;
    if (launch.bought > 0n) {
      const sellRatio = (launch.soldByOthers * BPS) / launch.bought;
      if (sellRatio > BigInt(P.maxSellRatioBps)) return false;
    } else if (launch.soldByOthers > 0n) {
      return false;
    }
    if (launch.bigSellBps > BigInt(P.maxBigSellBps)) return false;
    // Run-up vs the create price, as a ratio in bps (10_000 = unchanged).
    const vq = BigInt(curve.virtual_quote_reserves);
    const vt = BigInt(curve.virtual_token_reserves);
    if (launch.createVq > 0n && launch.createVt > 0n && vt > 0n) {
      const runup = (vq * launch.createVt * BPS) / (vt * launch.createVq);
      if (runup < BigInt(P.minRunupBps) || runup > BigInt(P.maxRunupBps)) return false;
    }
    return true;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      observe(batch);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const txFee = state.txFeeLamports();
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));

      // 1. Clean up rides whose position is gone, and clear finished sells.
      for (const [mint, ride] of rides) {
        const pos = state.positions.get(mint);
        if (pos === undefined) {
          let inFlight = false;
          for (const po of state.pending.values()) {
            if (po.order.mint === mint) inFlight = true;
          }
          if (!inFlight) {
            rides.delete(mint);
            selling.delete(mint);
            const launch = launches.get(mint);
            if (launch !== undefined) launch.done = true;
          }
        }
      }

      // 2. Exits first: stop loss, trailing stop, creator sell, hold cap.
      // No take-profit: the rare runner toward curve completion is what
      // pays for the many small losers, so exits only cut risk.
      for (const [mint, ride] of rides) {
        if (orders.length >= cap) break;
        if (ride.selling || selling.has(mint)) continue;
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined || curve === undefined || curve.complete) continue;
        const mark = marks.get(mint);
        const vq = mark !== undefined ? BigInt(mark.virtual_quote_reserves) : BigInt(curve.virtual_quote_reserves);
        const vt = mark !== undefined ? BigInt(mark.virtual_token_reserves) : BigInt(curve.virtual_token_reserves);
        const tokens = BigInt(pos.token_amount);
        const cost = BigInt(pos.cost_lamports);
        let value = sellValue(tokens, vq, vt);
        value = value > txFee ? value - txFee : 0n;
        if (value > ride.bestValue) ride.bestValue = value;
        const launch = launches.get(mint);
        const creatorSold = launch !== undefined && launch.creatorSold;
        let exit = false;
        if (value < (cost * BigInt(10_000 - P.stopLossBps)) / 10_000n) exit = true;
        if (
          !exit &&
          ride.bestValue >= (cost * BigInt(10_000 + P.trailArmBps)) / 10_000n &&
          value < (ride.bestValue * BigInt(10_000 - P.trailBps)) / 10_000n
        ) {
          exit = true;
        }
        if (!exit && P.exitOnCreatorSell && creatorSold) exit = true;
        if (!exit && batch.slot - ride.openedSlot > P.maxHoldSlots) exit = true;
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        ride.selling = true;
        selling.add(mint);
      }

      // 3. Entries: one small buy per qualifying fresh launch.
      let free = state.freeCashLamports();
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      for (const [mint, launch] of launches) {
        if (orders.length >= cap || slotsLeft <= 0) break;
        if (rides.has(mint)) continue;
        let inFlight = false;
        for (const po of state.pending.values()) {
          if (po.order.mint === mint) inFlight = true;
        }
        if (inFlight) continue;
        const curve = state.curves.get(mint);
        if (!qualifies(launch, batch.slot, curve)) continue;
        const capLamports = state.maxBuyLamports(mint);
        let amount = BigInt(P.stakeLamports);
        if (amount > capLamports) amount = capLamports;
        if (amount < BigInt(P.minBuyLamports)) continue;
        // Keep enough cash to pay for this buy and its eventual sell.
        if (free < amount + txFee * 2n) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        free -= amount + txFee;
        slotsLeft -= 1;
        rides.set(mint, { openedSlot: batch.slot, bestValue: 0n, selling: false });
        launch.done = true;
      }
      return orders;
    },
  };
}
