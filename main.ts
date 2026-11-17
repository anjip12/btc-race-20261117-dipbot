/** BTC race bot: hourly-dip buyer on 1-minute cbBTC bars.
 *
 * Long-only. The dev window's event study shows the one reliable edge in
 * this market: after cbBTC falls at least ~1% over an hour, it recovers
 * within the next one to two hours (after a >=100 bps 60-minute drop, the
 * mean forward return is about +40 bps at 60 minutes and +72 bps at 120
 * minutes, positive in every case). Shorter moves do not behave this way:
 * 5-minute drops keep falling and 5-minute rises fade, so this bot ignores
 * them entirely and waits for the hourly dip.
 *
 * Rules: while flat, buy the full cash balance when the 60-bar return is at
 * or below -110 bps. While holding, sell everything when the close rises
 * 160 bps above the entry close, when it falls 150 bps below it, or after
 * 360 bars, whichever comes first. A short cooldown after each exit avoids
 * immediate re-entry into the same dip. Pure function of the bars seen: no
 * clock, no environment, no randomness, so two runs agree exactly.
 *
 * Verified on the published dev window with the kit's official local grade
 * (two deterministic runs): net PnL +$28.54 after fees, 5 trades, 100% win
 * rate, max drawdown 0.72%. Guardrails pass: at least 1 trade, max drawdown
 * well under the 25% race limit.
 */
import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy parameters, tuned on the published dev window.
const DROP_BPS = 110n; // 60-bar return at or below this buys the dip
const TP_BPS = 160n; // sell when the close rises this far above entry
const STOP_BPS = 150n; // sell when the close falls this far below entry
const MAX_HOLD = 360; // bars before a position is closed regardless
const COOLDOWN = 10; // bars to wait after an exit before a new entry
const SLIP_BPS = 300; // max slippage allowed on any order

/** Floor division for bigints (matching Python's // on the negative leg). */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
}

class DipBot {
  closes: bigint[] = [];
  entryClose: bigint | null = null;
  holdBars = 0;
  coolUntil = -1;

  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);
    const seq = batch.seq;
    this.closes.push(close);
    if (this.closes.length < 61) return [];

    const pos = state.positions.get(SYMBOL);
    const qty = pos === undefined ? 0n : pos.qty;
    if (qty > 0n) {
      this.holdBars += 1;
      const entry = this.entryClose ?? close;
      const tpHit = close > (entry * (10000n + TP_BPS)) / 10000n;
      const stopHit = close < (entry * (10000n - STOP_BPS)) / 10000n;
      const aged = this.holdBars >= MAX_HOLD;
      if (tpHit || stopHit || aged) {
        this.entryClose = null;
        this.holdBars = 0;
        this.coolUntil = seq + COOLDOWN;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: SLIP_BPS }];
      }
      return [];
    }

    if (seq <= this.coolUntil) return [];
    const ref = this.closes[this.closes.length - 61];
    const ret60 = floorDiv((close - ref) * 10000n, ref);
    if (ret60 <= -DROP_BPS) {
      const cash = state.cash;
      if (cash < 1000000n) return [];
      this.entryClose = close;
      this.holdBars = 0;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: SLIP_BPS }];
    }
    return [];
  }
}

const bot = new DipBot();
await runBars({ onBatch: (state, batch) => bot.onBatch(state, batch) });
