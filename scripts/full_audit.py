"""Comprehensive accuracy audit of the v5.3 SPY composite indicator.

Runs 8 different evaluation angles to expose any weakness:
  1. Strategy backtest    — timing rule vs buy-and-hold (Sharpe, MDD, return)
  2. Sub-period stability — 2011-15, 2015-20, 2020-25
  3. Naive baselines      — drift-only, VIX-only, AR(1) on past fwd
  4. Reliability diagram  — predicted-decile vs realised mean
  5. Leave-one-out        — re-fit dropping each signal in turn
  6. Walk-forward integrity check — recompute one OOS prediction by hand
  7. Bootstrap CI on ρ    — resample 1000x to bound the headline metric
  8. Tail-event review    — what did the model say at the biggest highs/lows?
"""
import json
import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path
from sklearn.linear_model import Ridge
from sklearn.model_selection import TimeSeriesSplit
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from variant_sweep import fit_ridge_with_sign, rank_gauss_series, UNIVARIATE_SIGN, SIGNALS

# v5.4: predictors exclude VIX (kept in SIGNALS for UI percentiles + σ_t).
PREDICTORS = [s for s in SIGNALS if s != 'vix_close']

ROOT = Path(__file__).resolve().parent.parent
m = json.loads((ROOT / 'src/data/model.json').read_text())
df = pd.read_csv('/tmp/velv/master_dataset.csv', parse_dates=['date'])
df = df[['date', 'spy_close'] + SIGNALS + ['fwd_12m']].dropna(subset=SIGNALS).reset_index(drop=True)

ts = m['timeseries']
oos_rows = [r for r in ts if r.get('in_sample') is False]
df_ym = df.assign(ym=df['date'].dt.strftime('%Y-%m')).set_index('ym')
fwd_map = dict(zip(df_ym.index, df_ym['fwd_12m']))
spy_map = dict(zip(df_ym.index, df_ym['spy_close']))

OOS = []
for r in oos_rows:
    fwd = fwd_map.get(r['d'])
    if fwd is None or pd.isna(fwd): continue
    OOS.append({'d': r['d'], 'pred': r['pred'], 'score': r['score'],
                'fwd': fwd, 'spy': spy_map[r['d']]})
OOS = sorted(OOS, key=lambda x: x['d'])
preds  = np.array([r['pred']  for r in OOS])
scores = np.array([r['score'] for r in OOS])
fwds   = np.array([r['fwd']   for r in OOS])
spys   = np.array([r['spy']   for r in OOS])
dates  = np.array([r['d']     for r in OOS])

def spearman(x, y):
    r, _ = stats.spearmanr(x, y)
    return float(r)

# ════════════════════════════════════════════════════════════════════════════
print('═══════════════════════════════════════════════════════════════════════')
print('  v5.3 COMPREHENSIVE ACCURACY AUDIT')
print('═══════════════════════════════════════════════════════════════════════\n')

# ── 1. Strategy backtest ─────────────────────────────────────────────────────
print('1 ─ STRATEGY BACKTEST: score-timing vs buy-and-hold (12m horizons)\n')

# Map score → equity exposure (matches the app's stance ladder)
def exposure(score):
    if score >= 80: return 1.20  # aggressive long
    if score >= 60: return 1.00  # bullish
    if score >= 40: return 0.70  # neutral
    if score >= 20: return 0.40  # defensive
    return 0.20                  # wait/buy panic

cash_yield = 0.04  # ~rough OOS-period avg short rate
exposures = np.array([exposure(s) for s in scores])
strat_returns = exposures * fwds + (1 - exposures) * cash_yield
bh_returns    = fwds.copy()

def metrics(r, label):
    mean = float(np.mean(r))
    std  = float(np.std(r, ddof=1))
    sharpe = (mean / std) if std > 1e-9 else float('nan')
    cum = float(np.prod(1 + r) ** (1/len(r)) - 1)
    hit = float(np.mean(r > 0))
    worst = float(np.min(r))
    sh_str = f'{sharpe:+.2f}' if not np.isnan(sharpe) else '   —'
    print(f'  {label:<22}  mean={mean:+.2%}  std={std:.2%}  '
          f'Sharpe={sh_str}  geo={cum:+.2%}  hit={hit:.0%}  worst={worst:+.2%}')
    return {'mean': mean, 'std': std, 'sharpe': sharpe}

m_strat = metrics(strat_returns, 'Score-timed (5-tier)')
m_bh    = metrics(bh_returns,    'Buy-and-hold')
m_cash  = metrics(np.full_like(fwds, cash_yield), '100% cash @4%')

# Simpler binary strategy: long when score >= 50, cash otherwise
binary_exp = np.where(scores >= 50, 1.0, 0.0)
binary_ret = binary_exp * fwds + (1 - binary_exp) * cash_yield
m_bin = metrics(binary_ret, 'Binary (long if≥50)')

# Pure long-only at high conviction (score >= 60), else cash
hc_exp = np.where(scores >= 60, 1.0, 0.0)
hc_ret = hc_exp * fwds + (1 - hc_exp) * cash_yield
m_hc = metrics(hc_ret, 'Long if score≥60')

print(f'\n  Δ Sharpe (5-tier vs B&H): {m_strat["sharpe"] - m_bh["sharpe"]:+.2f}')
print(f'  Δ Sharpe (binary vs B&H): {m_bin["sharpe"] - m_bh["sharpe"]:+.2f}')
print(f'  Δ Sharpe (long-if≥60 vs B&H): {m_hc["sharpe"] - m_bh["sharpe"]:+.2f}')

# ── 2. Sub-period stability ──────────────────────────────────────────────────
print('\n2 ─ SUB-PERIOD STABILITY: does the model work across regimes?\n')

ymd = pd.to_datetime(dates)
periods = [
    ('2011-2015 (post-GFC bull)',     '2011-01', '2015-12'),
    ('2016-2019 (Trump rally)',       '2016-01', '2019-12'),
    ('2020-2022 (COVID + 2022 bear)', '2020-01', '2022-12'),
    ('2023-2025 (AI bull)',           '2023-01', '2025-12'),
]
print(f'  {"period":<32}  {"n":>4}  {"ρ":>7}  {"MAE":>7}  {"Q5−Q1":>7}')
for label, lo, hi in periods:
    mask = (dates >= lo) & (dates <= hi)
    if mask.sum() < 12:
        print(f'  {label:<32}  {mask.sum():>4}  (too few obs)')
        continue
    sp = preds[mask]; sf = fwds[mask]
    rho = spearman(sp, sf)
    mae = float(np.mean(np.abs(sp - sf)))
    if mask.sum() >= 10:
        order = np.argsort(sp)
        q = np.array_split(order, 5)
        spread = float(np.mean(sf[q[-1]]) - np.mean(sf[q[0]]))
    else:
        spread = float('nan')
    print(f'  {label:<32}  {mask.sum():>4}  {rho:>+7.4f}  {mae:>.4f}  {spread:>+7.4f}')

# ── 3. Naive baselines ───────────────────────────────────────────────────────
print('\n3 ─ NAIVE BASELINES: how much does the model beat trivial alternatives?\n')

# (a) drift only — predict the mean of training fwd_12m at each step
# We need to redo walk-forward with the naive predictor. Use the same train
# cutoff logic as fit_ridge.py.
HORIZON = 12; MIN_TRAIN = 36
naive_drift, naive_vix, naive_ar1 = [], [], []
naive_actual = []
naive_dates_list = []
for idx in range(len(df)):
    row = df.iloc[idx]
    if pd.isna(row['fwd_12m']): continue
    cutoff = idx - HORIZON + 1
    train = df.iloc[:cutoff].dropna(subset=['fwd_12m'])
    if len(train) < MIN_TRAIN: continue

    naive_drift.append(float(train['fwd_12m'].mean()))
    # VIX-only: linear regression of fwd_12m on vix_close
    X = train[['vix_close']].values
    y = train['fwd_12m'].values
    a, b = np.polyfit(X[:, 0], y, 1)
    naive_vix.append(float(a * row['vix_close'] + b))
    # AR(1) on past fwd_12m: predict last observed fwd (lagged HORIZON)
    naive_ar1.append(float(train['fwd_12m'].iloc[-1]))

    naive_actual.append(float(row['fwd_12m']))
    naive_dates_list.append(row['date'].strftime('%Y-%m'))

na = np.array(naive_actual)
nd = np.array(naive_drift)
nv = np.array(naive_vix)
nar = np.array(naive_ar1)

print(f'  {"baseline":<22}  {"ρ":>7}  {"MAE":>7}  {"Q5−Q1":>7}  {"hit":>5}')
for label, p in [('drift-only',   nd),
                 ('VIX-only',     nv),
                 ('AR(1) lagged', nar),
                 ('v5.3 model',   preds)]:
    rho = spearman(p, na if label != 'v5.3 model' else fwds)
    actual_for = na if label != 'v5.3 model' else fwds
    mae = float(np.mean(np.abs(p - actual_for)))
    order = np.argsort(p)
    q = np.array_split(order, 5)
    spread = float(np.mean(actual_for[q[-1]]) - np.mean(actual_for[q[0]]))
    hit = float(np.mean(p > actual_for.mean())) if len(p) else float('nan')
    print(f'  {label:<22}  {rho:>+7.4f}  {mae:>.4f}  {spread:>+7.4f}  '
          f'{float(np.mean(np.sign(p - actual_for.mean()) == np.sign(actual_for - actual_for.mean()))):.0%}')

# ── 4. Reliability diagram ───────────────────────────────────────────────────
print('\n4 ─ RELIABILITY: predicted-decile mean vs realised mean\n')
print(f'  {"decile":<8}  {"pred range":<22}  {"mean pred":>10}  {"mean fwd":>10}  '
      f'{"residual":>10}  {"|err|":>7}')
order = np.argsort(preds)
deciles = np.array_split(order, 10)
calib_errors = []
for i, idx in enumerate(deciles, 1):
    pp = preds[idx]; ff = fwds[idx]
    mp = float(np.mean(pp)); mf = float(np.mean(ff))
    err = abs(mp - mf)
    calib_errors.append(err)
    print(f'  D{i:<7}  [{pp.min():>+.4f}, {pp.max():>+.4f}]  '
          f'{mp:>+10.4f}  {mf:>+10.4f}  {mf-mp:>+10.4f}  {err:>.4f}')
mae_calib = float(np.mean(calib_errors))
print(f'\n  Mean calibration error across 10 deciles: {mae_calib:.4f}  '
      f'({mae_calib*100:.1f}pp)')

# ── 5. Leave-one-signal-out ─────────────────────────────────────────────────
print('\n5 ─ LEAVE-ONE-OUT SENSITIVITY: drop each signal, re-fit walk-forward\n')

def walk_forward_loo(drop_signal):
    """Re-run walk-forward with a single signal dropped, return OOS rho."""
    sigs = [s for s in SIGNALS if s != drop_signal]
    signs = np.array([UNIVARIATE_SIGN[s] for s in sigs])
    rg_cols = list(range(len(sigs)))
    op, oa = [], []
    for idx in range(len(df)):
        row = df.iloc[idx]
        if pd.isna(row['fwd_12m']): continue
        cutoff = idx - HORIZON + 1
        train = df.iloc[:cutoff].dropna(subset=['fwd_12m'])
        if len(train) < MIN_TRAIN: continue
        Xt = train[sigs].values.astype(float)
        yt = train['fwd_12m'].values.astype(float)
        means = Xt.mean(axis=0); stds = Xt.std(axis=0, ddof=1); stds[stds==0]=1
        sorted_arrs = {c: np.sort(Xt[:, c]) for c in rg_cols}
        Xz = (Xt - means) / stds
        for c in rg_cols:
            Xz[:, c] = rank_gauss_series(Xt[:, c], sorted_arrs[c])
        beta, b0 = fit_ridge_with_sign(Xz, yt, 5.0, signs)
        xr = row[sigs].values.astype(float)
        xz = (xr - means) / stds
        for c in rg_cols:
            ranks = np.searchsorted(sorted_arrs[c], np.array([xr[c]]), side='left')
            p = np.clip(ranks/(len(sorted_arrs[c])+1), 0.01, 0.99)
            xz[c] = float(stats.norm.ppf(p)[0])
        op.append(float(b0 + xz @ beta))
        oa.append(float(row['fwd_12m']))
    return float(stats.spearmanr(op, oa)[0]), len(op)

base_rho = spearman(preds, fwds)
print(f'  {"dropped":<18}  {"ρ":>7}  {"Δρ vs full":>10}  {"interpretation":<30}')
print(f'  {"none (full v5.3)":<18}  {base_rho:>+7.4f}  {"":>10}  baseline')
for s in SIGNALS:
    rho_loo, n_loo = walk_forward_loo(s)
    delta = rho_loo - base_rho
    interp = ('critical'    if delta < -0.05 else
              'helpful'     if delta < -0.01 else
              'neutral'     if delta <  0.01 else
              'harms ρ')
    print(f'  {s:<18}  {rho_loo:>+7.4f}  {delta:>+10.4f}  {interp}')

# ── 6. Walk-forward integrity ────────────────────────────────────────────────
print('\n6 ─ WALK-FORWARD INTEGRITY: reproduce one OOS prediction by hand\n')

# Pick a recent prediction. Recompute by training only on data strictly
# before the prediction date (minus the horizon) and apply manually.
target_idx = len(OOS) - 1  # most recent OOS
target = OOS[target_idx]
target_date = target['d']
print(f'  Target: {target_date}  saved pred = {target["pred"]:+.6f}')

# Find the row in df. v5.4: PREDICTORS excludes vix_close.
df_match = df[df['date'].dt.strftime('%Y-%m') == target_date]
if not df_match.empty:
    idx_in_df = df_match.index[0]
    cutoff = idx_in_df - HORIZON + 1
    train = df.iloc[:cutoff].dropna(subset=['fwd_12m'])
    print(f'  Train rows: {len(train)}  (last train date: {train["date"].iloc[-1].strftime("%Y-%m")})')
    Xt = train[PREDICTORS].values.astype(float)
    yt = train['fwd_12m'].values.astype(float)
    means = Xt.mean(axis=0); stds = Xt.std(axis=0, ddof=1); stds[stds==0]=1
    sorted_arrs = {c: np.sort(Xt[:, c]) for c in range(len(PREDICTORS))}
    Xz = (Xt - means) / stds
    for c in range(len(PREDICTORS)):
        Xz[:, c] = rank_gauss_series(Xt[:, c], sorted_arrs[c])
    signs = np.array([UNIVARIATE_SIGN[s] for s in PREDICTORS])
    beta, b0 = fit_ridge_with_sign(Xz, yt, 5.0, signs)
    xr = df.iloc[idx_in_df][PREDICTORS].values.astype(float)
    xz = (xr - means) / stds
    for c in range(len(PREDICTORS)):
        ranks = np.searchsorted(sorted_arrs[c], np.array([xr[c]]), side='left')
        p = np.clip(ranks/(len(sorted_arrs[c])+1), 0.01, 0.99)
        xz[c] = float(stats.norm.ppf(p)[0])
    pred_manual = float(b0 + xz @ beta)
    print(f'  Manual recompute: {pred_manual:+.6f}')
    diff = abs(pred_manual - target['pred'])
    print(f'  |saved − manual| = {diff:.2e}   →  {"PASS" if diff < 1e-3 else "FAIL"}')

# ── 7. Bootstrap CI on ρ ─────────────────────────────────────────────────────
print('\n7 ─ BOOTSTRAP CI on Spearman ρ (1000 resamples of OOS pairs)\n')

rng = np.random.default_rng(0)
n = len(preds)
boot_rho = np.array([spearman(preds[idx], fwds[idx])
                     for idx in (rng.integers(0, n, n) for _ in range(1000))])
lo, hi = np.percentile(boot_rho, [2.5, 97.5])
print(f'  ρ̂ = {base_rho:+.4f}   95% CI = [{lo:+.4f}, {hi:+.4f}]   '
      f'(mean={boot_rho.mean():+.4f}, sd={boot_rho.std(ddof=1):.4f})')

# ── 8. Tail-event review ─────────────────────────────────────────────────────
print('\n8 ─ TAIL-EVENT REVIEW: what did the model say at extremes?\n')

# Top 5 best forward returns
top_idx = np.argsort(fwds)[-5:][::-1]
print('  TOP-5 realised 12m fwd returns (best buying opportunities):')
print(f'  {"date":<10}  {"fwd":>8}  {"saved score":>12}  {"saved pred":>11}')
for i in top_idx:
    print(f'  {dates[i]:<10}  {fwds[i]:>+8.2%}  {scores[i]:>12.1f}  {preds[i]:>+11.2%}')

# Bottom 5 worst forward returns
bot_idx = np.argsort(fwds)[:5]
print('\n  BOTTOM-5 realised 12m fwd returns (worst entry points):')
print(f'  {"date":<10}  {"fwd":>8}  {"saved score":>12}  {"saved pred":>11}')
for i in bot_idx:
    print(f'  {dates[i]:<10}  {fwds[i]:>+8.2%}  {scores[i]:>12.1f}  {preds[i]:>+11.2%}')

# Where did the model say "buy panic" (score < 20)? did it work?
buy_panic = scores < 20
print(f'\n  When score < 20 (n={buy_panic.sum()}): mean fwd = '
      f'{float(np.mean(fwds[buy_panic])) if buy_panic.any() else float("nan"):+.2%}')
sell_high = scores >= 70
print(f'  When score ≥ 70 (n={sell_high.sum()}): mean fwd = '
      f'{float(np.mean(fwds[sell_high])) if sell_high.any() else float("nan"):+.2%}')
neutral = (scores >= 40) & (scores < 60)
print(f'  When score ∈ [40,60) (n={neutral.sum()}): mean fwd = '
      f'{float(np.mean(fwds[neutral])) if neutral.any() else float("nan"):+.2%}')

# ── Summary ──────────────────────────────────────────────────────────────────
print('\n═══════════════════════════════════════════════════════════════════════')
print('  SUMMARY SCORECARD')
print('═══════════════════════════════════════════════════════════════════════')
print(f'  Headline OOS Spearman ρ:    {base_rho:+.4f}  (95% CI [{lo:+.4f},{hi:+.4f}])')
print(f'  vs naive drift baseline:    +{base_rho - spearman(nd, na):+.4f} edge')
print(f'  vs VIX-only baseline:       +{base_rho - spearman(nv, na):+.4f} edge')
print(f'  Strategy Sharpe:            {m_strat["sharpe"]:+.2f}  vs B&H {m_bh["sharpe"]:+.2f}')
print(f'  Mean calibration error:     {mae_calib*100:.1f}pp across 10 deciles')
print('═══════════════════════════════════════════════════════════════════════')
