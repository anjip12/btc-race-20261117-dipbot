# BTC race bot — hourly-dip buyer (btc-race-24h-20261117-0603)

Long-only bot trading cbBTC/USDC on 1-minute bars. Buys the full cash
balance when the 60-bar return is at or below -110 bps; sells everything
at +160 bps above the entry close, -150 bps below it, or after 360 bars.
Local grade on the published dev window: net PnL +$28.54, 5 trades,
max drawdown 0.72%.

Run: `python3 -P -s main.py` (protocol agent-fun/bars-replay/v1).
