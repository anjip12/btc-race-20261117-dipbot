"""BTC race bot: hourly-dip buyer on 1-minute cbBTC bars.

Long-only. The dev window's event study shows the one reliable edge in
this market: after cbBTC falls at least ~1% over an hour, it recovers
within the next one to two hours (after a >=100 bps 60-minute drop, the
mean forward return is about +40 bps at 60 minutes and +72 bps at 120
minutes, positive in every case). Shorter moves do not behave this way:
5-minute drops keep falling and 5-minute rises fade, so this bot ignores
them entirely and waits for the hourly dip.

Rules: while flat, buy the full cash balance when the 60-bar return is at
or below -110 bps. While holding, sell everything when the close rises
160 bps above the entry close, when it falls 150 bps below it, or after
360 bars, whichever comes first. A short cooldown after each exit avoids
immediate re-entry into the same dip. Pure function of the bars seen: no
clock, no environment, no randomness, so two runs agree exactly.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
import makefun_bars

SYMBOL = "CBBTC"

# Strategy parameters, tuned on the published dev window.
PARAMS = {
    "drop_bps": 110,  # 60-bar return at or below this buys the dip
    "tp_bps": 160,    # sell when the close rises this far above entry
    "stop_bps": 150,  # sell when the close falls this far below entry
    "max_hold": 360,  # bars before a position is closed regardless
    "cooldown": 10,   # bars to wait after an exit before a new entry
    "slip_bps": 300,  # max slippage allowed on any order
}


class DipBot:
    def __init__(self):
        self.closes = []
        self.entry_close = None
        self.hold_bars = 0
        self.cool_until = -1

    def on_batch(self, state, batch):
        if state.warming_up:
            return []
        bar = None
        for b in batch["bars"]:
            if b["symbol"] == SYMBOL:
                bar = b
                break
        if bar is None:
            return []
        close = int(bar["c"])
        seq = batch["seq"]
        self.closes.append(close)
        if len(self.closes) < 61:
            return []

        holding = state.positions.get(SYMBOL)
        qty = holding.qty if holding is not None else 0
        if qty > 0:
            self.hold_bars += 1
            tp_hit = close > self.entry_close * (10000 + PARAMS["tp_bps"]) // 10000
            stop_hit = close < self.entry_close * (10000 - PARAMS["stop_bps"]) // 10000
            aged = self.hold_bars >= PARAMS["max_hold"]
            if tp_hit or stop_hit or aged:
                self.entry_close = None
                self.hold_bars = 0
                self.cool_until = seq + PARAMS["cooldown"]
                return [{
                    "side": "sell",
                    "symbol": SYMBOL,
                    "qty": qty,
                    "max_slippage_bps": PARAMS["slip_bps"],
                }]
            return []

        if seq <= self.cool_until:
            return []
        ret60 = (close - self.closes[-61]) * 10000 // self.closes[-61]
        if ret60 <= -PARAMS["drop_bps"]:
            cash = state.cash
            if cash < 1000000:
                return []
            self.entry_close = close
            self.hold_bars = 0
            return [{
                "side": "buy",
                "symbol": SYMBOL,
                "notional_quote_units": cash,
                "max_slippage_bps": PARAMS["slip_bps"],
            }]
        return []


_BOT = DipBot()


def on_batch(state, batch):
    return _BOT.on_batch(state, batch)


if __name__ == "__main__":
    makefun_bars.run(on_batch)
