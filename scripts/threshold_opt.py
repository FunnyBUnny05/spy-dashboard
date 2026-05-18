"""
Threshold optimization with expanding-window time-series CV.

Goal: find the score threshold(s) that produce the best risk-adjusted return
WITHOUT cheating. We never let the optimizer see future data.

Procedure:
  1. Expanding window. Start with first 60 months as initial training.
  2. On the training window, sweep all candidate thresholds for each strategy
     family (binary, two-level, stance-like) and pick the one with the best
     in-train Sortino.
  3. Apply that threshold to the next 12 test months, record the realised
     portfolio return.
  4. Slide forward by 12 months and repeat.
  5. Stitch the test-window returns into a single OOS equity curve.

Strategy families:
  BIN(t)         100% SPY if score>t else cash
  TWO(low,high)  cash if score<low, 100% SPY if score>=high, else 50%
  STANCE         fixed bins from HANDOFF (no fitting — control)

Metric inside training fold: Sortino ratio (penalises only downside vol).
Cash earns 2%/yr.
"""
import json, math
from pathlib import Path
from itertools import product

ROOT = Path(__file__).resolve().parent.parent
m = json.loads((ROOT / "src/data/model.json").read_text())
ts = [r for r in m["timeseries"] if r.get("score") is not None]
ts.sort(key=lambda r: r["d"])
months = [r["d"] for r in ts]
spy = [r["spy"] for r in ts]
score = [r["score"] for r in ts]
mret = [spy[i+1]/spy[i] - 1 for i in range(len(spy)-1)]
N = len(mret)  # 183

rf_m = (1 + 0.02) ** (1/12) - 1


def portfolio_return(w, r):
    return w * r + (1 - w) * rf_m  # no leverage in this test


def sortino(returns):
    if not returns: return 0
    mu = sum(returns) / len(returns)
    neg = [min(r - rf_m, 0)**2 for r in returns]
    dd = math.sqrt(sum(neg) / len(neg)) if neg else 0
    return (mu - rf_m) / dd * math.sqrt(12) if dd else 0


def cagr(eq, n_months):
    return eq[-1] ** (12 / n_months) - 1


def max_dd(eq):
    peak = eq[0]; mdd = 0
    for v in eq:
        if v > peak: peak = v
        d = v / peak - 1
        if d < mdd: mdd = d
    return mdd


def apply_bin(threshold, idx_range):
    """Return list of (weight, return) for indices in idx_range using BIN strategy."""
    out = []
    for i in idx_range:
        w = 1.0 if score[i] > threshold else 0.0
        out.append((w, mret[i]))
    return out


def apply_two(low, high, idx_range):
    out = []
    for i in idx_range:
        s = score[i]
        if s < low:    w = 0.0
        elif s >= high: w = 1.0
        else:          w = 0.5
        out.append((w, mret[i]))
    return out


def apply_stance(idx_range):
    out = []
    for i in idx_range:
        s = score[i]
        if s >= 80: w = 1.0
        elif s >= 60: w = 0.95
        elif s >= 40: w = 0.70
        elif s >= 20: w = 0.40
        else: w = 0.20
        out.append((w, mret[i]))
    return out


def fold_returns(pairs):
    return [portfolio_return(w, r) for w, r in pairs]


# ---- Walk-forward CV ----
INIT = 60   # months of initial training
STEP = 12   # advance one year at a time
HORIZON = 12

oos_returns_bin = []
oos_returns_two = []
oos_returns_stance = []
oos_returns_bh = []
fold_log = []

start_test = INIT
while start_test + HORIZON <= N:
    train_idx = list(range(0, start_test))
    test_idx  = list(range(start_test, start_test + HORIZON))

    # ---- Fit BIN: try thresholds 0..70 in steps of 5 ----
    best_t = None; best_sort = -1e9
    for t in range(0, 75, 5):
        rs = fold_returns(apply_bin(t, train_idx))
        s  = sortino(rs)
        if s > best_sort:
            best_sort = s; best_t = t
    test_pairs = apply_bin(best_t, test_idx)
    oos_returns_bin.extend(fold_returns(test_pairs))

    # ---- Fit TWO: low in 0..40, high in low+10..80 ----
    best_lh = None; best_sort_t = -1e9
    for low in range(0, 45, 5):
        for high in range(max(low+10, 20), 85, 5):
            rs = fold_returns(apply_two(low, high, train_idx))
            s  = sortino(rs)
            if s > best_sort_t:
                best_sort_t = s; best_lh = (low, high)
    test_pairs2 = apply_two(best_lh[0], best_lh[1], test_idx)
    oos_returns_two.extend(fold_returns(test_pairs2))

    # ---- STANCE (fixed, no fitting) ----
    oos_returns_stance.extend(fold_returns(apply_stance(test_idx)))

    # ---- Buy-and-hold ----
    for i in test_idx:
        oos_returns_bh.append(mret[i])

    fold_log.append({
        "train_end": months[start_test],
        "test_range": f"{months[start_test+1]}..{months[start_test+HORIZON]}",
        "bin_t": best_t,
        "two_lh": best_lh,
    })
    start_test += STEP


def eq_curve(rs):
    eq = [1.0]
    for r in rs: eq.append(eq[-1] * (1 + r))
    return eq


def summarize(rs, label):
    eq = eq_curve(rs)
    n = len(rs)
    mu = sum(rs)/n
    var = sum((r-mu)**2 for r in rs)/(n-1)
    std = math.sqrt(var)
    sharpe = (mu - rf_m) / std * math.sqrt(12) if std else 0
    sort = sortino(rs)
    print(f"{label:14s} final={eq[-1]:5.2f}x  CAGR={cagr(eq,n)*100:6.2f}%  "
          f"Sharpe={sharpe:5.2f}  Sortino={sort:5.2f}  MaxDD={max_dd(eq)*100:6.2f}%  "
          f"n_months={n}")


print(f"Walk-forward folds: {len(fold_log)} (init train={INIT}m, horizon={HORIZON}m)")
print(f"OOS coverage: {months[INIT+1]} → {months[INIT+HORIZON*len(fold_log)]}")
print()
print("Fold picks:")
for fl in fold_log:
    print(f"  train→{fl['train_end']}  test {fl['test_range']}  "
          f"BIN_t={fl['bin_t']}  TWO={fl['two_lh']}")
print()
print("OOS performance (only counts months the optimizer hadn't seen):")
summarize(oos_returns_bh,     "BH")
summarize(oos_returns_stance, "STANCE_NL")
summarize(oos_returns_bin,    "BIN_opt")
summarize(oos_returns_two,    "TWO_opt")
