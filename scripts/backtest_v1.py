"""
Backtest the composite score as a market-timing signal vs. buy-and-hold SPY.

Rules to avoid lookahead:
  - At end of month t we observe score_t.
  - Position for month t+1 is set from score_t (decision uses only past data).
  - We then earn the SPY return between price_t and price_{t+1}.

Strategies tested:
  BH      Buy-and-hold, 100% SPY, always
  STANCE  HANDOFF stance bins (110-130 / 90-100 / 60-80 / 30-50 / 10-30) using midpoints
  STANCE_NL  Same bins but capped at 100% (no leverage)
  LINEAR   position = score/100  (linear, capped 0..1)
  BIN_50   100% SPY if score > 50 else cash
  BIN_40   100% SPY if score >= 40 else cash
  BIN_20   100% SPY if score > 20 else cash  (only avoid the worst quintile)

Cash earns rf_annual (default 2%). Leverage above 100% costs +1% over rf.
No transaction costs (acknowledged limitation — addressed later).
"""
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
m = json.loads((ROOT / "src/data/model.json").read_text())
ts = [r for r in m["timeseries"] if r.get("score") is not None]
ts.sort(key=lambda r: r["d"])

# Monthly returns from SPY prices
months = [r["d"] for r in ts]
spy = [r["spy"] for r in ts]
score = [r["score"] for r in ts]
mret = [spy[i+1]/spy[i] - 1 for i in range(len(spy)-1)]   # return earned during month i+1

# Cash return per month
rf_annual = 0.02
rf_m = (1 + rf_annual) ** (1/12) - 1
borrow_annual = rf_annual + 0.01   # cost of leverage above 100%
borrow_m = (1 + borrow_annual) ** (1/12) - 1


def stance_weight(s, allow_leverage=True):
    if s >= 80: return 1.20 if allow_leverage else 1.00
    if s >= 60: return 0.95
    if s >= 40: return 0.70
    if s >= 20: return 0.40
    return 0.20


def simulate(weights):
    """weights[i] = position held during month i+1 (set from score at end of month i)."""
    eq = [1.0]
    for i, w in enumerate(weights):
        r = mret[i]
        # Position w in SPY, (1-w) in cash if w<=1
        # If w>1, borrow (w-1) at borrow rate
        if w <= 1:
            r_port = w * r + (1 - w) * rf_m
        else:
            r_port = w * r - (w - 1) * borrow_m
        eq.append(eq[-1] * (1 + r_port))
    return eq


def metrics(eq, label):
    n_months = len(eq) - 1
    years = n_months / 12
    cagr = eq[-1] ** (1/years) - 1
    # monthly returns
    rets = [eq[i+1]/eq[i] - 1 for i in range(len(eq)-1)]
    mean_m = sum(rets)/len(rets)
    var_m = sum((r-mean_m)**2 for r in rets)/(len(rets)-1)
    std_m = math.sqrt(var_m)
    sharpe = (mean_m - rf_m) / std_m * math.sqrt(12) if std_m else 0
    # max drawdown
    peak = eq[0]; max_dd = 0
    for v in eq:
        if v > peak: peak = v
        dd = v/peak - 1
        if dd < max_dd: max_dd = dd
    # downside dev for Sortino
    neg = [min(r-rf_m, 0)**2 for r in rets]
    down_std = math.sqrt(sum(neg)/len(neg)) if neg else 0
    sortino = (mean_m - rf_m) / down_std * math.sqrt(12) if down_std else 0
    hit = sum(1 for r in rets if r > 0) / len(rets)
    return {
        "label": label,
        "final": eq[-1],
        "cagr": cagr,
        "sharpe": sharpe,
        "sortino": sortino,
        "max_dd": max_dd,
        "hit": hit,
        "vol_ann": std_m * math.sqrt(12),
    }


# Build weights for each strategy
# Position for month i+1 uses score[i]; len(weights) = len(mret)
w_bh    = [1.0] * len(mret)
w_stnc  = [stance_weight(score[i], True)  for i in range(len(mret))]
w_stnnl = [stance_weight(score[i], False) for i in range(len(mret))]
w_lin   = [max(0.0, min(1.0, score[i]/100)) for i in range(len(mret))]
w_b50   = [1.0 if score[i] > 50 else 0.0 for i in range(len(mret))]
w_b40   = [1.0 if score[i] >= 40 else 0.0 for i in range(len(mret))]
w_b20   = [1.0 if score[i] > 20 else 0.0 for i in range(len(mret))]

strats = [
    ("BH",        w_bh),
    ("STANCE",    w_stnc),
    ("STANCE_NL", w_stnnl),
    ("LINEAR",    w_lin),
    ("BIN_50",    w_b50),
    ("BIN_40",    w_b40),
    ("BIN_20",    w_b20),
]

print(f"Sample: {months[0]} → {months[-1]}  ({len(mret)} monthly returns)")
print(f"Risk-free: {rf_annual:.1%}/yr  Borrow: {borrow_annual:.1%}/yr")
print()
hdr = f"{'Strat':10s} {'Final':>8s} {'CAGR':>8s} {'Vol':>7s} {'Sharpe':>7s} {'Sortino':>8s} {'MaxDD':>8s} {'Hit%':>6s}"
print(hdr); print("-"*len(hdr))
for name, w in strats:
    eq = simulate(w)
    mt = metrics(eq, name)
    print(f"{mt['label']:10s} {mt['final']:7.2f}x {mt['cagr']*100:7.2f}% {mt['vol_ann']*100:6.2f}% "
          f"{mt['sharpe']:7.2f} {mt['sortino']:8.2f} {mt['max_dd']*100:7.2f}% {mt['hit']*100:5.1f}%")
