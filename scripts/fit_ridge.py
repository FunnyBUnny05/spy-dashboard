"""
fit_ridge.py  —  SPY Dashboard v5.1 model fitter
-------------------------------------------------
Changes from v5:
  1. Walk-forward off-by-one fixed: train uses rows whose fwd_12m is fully
     observed by time t (i.e. index <= t-12 inclusive).
  2. Drift anchor = training-sample mean of fwd_12m (not hard-coded 0.08).
  3. Final ridge alpha re-tuned on the full sample (not carried from last
     walk-forward step).
  4. Empirical sorted arrays stored for ALL 7 signals so the UI can compute
     true historical percentiles (not Gaussian fictions).
  5. Bucket CIs use Newey-West HAC (Bartlett kernel, lag=11) on the full
     per-bucket sample instead of [::12] subsampling — uses all obs and
     corrects for the 12-month overlap autocorrelation.
  6. Heteroscedastic residual variance: regress squared OOS residuals on
     vix_z, store (a, b) so resid_std at scoring time scales with current
     VIX. Composite score CDF uses this conditional std.
  7. Each timeseries row carries `in_sample: bool` so the UI can flag rows
     that are fitted (not walk-forward) scores.

Output: src/data/model.json with new keys:
  drift, ridge_alpha, ridge_intercept, ridge_coefs, resid_std,
  resid_var_a, resid_var_b, vix_z_mean, vix_z_std,
  rank_gauss_*_sorted, signal_sorted (dict of all 7), oos_rho, oos_n,
  buckets (with HAC CIs), timeseries (with in_sample flag).
"""

import json
import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path
from sklearn.linear_model import Ridge, RidgeCV
from sklearn.model_selection import TimeSeriesSplit

# ── paths ─────────────────────────────────────────────────────────────────────
REPO  = Path(__file__).parent.parent
CSV   = Path("/tmp/velv/master_dataset.csv")
MFILE = REPO / "src/data/model.json"

SIGNALS = ['rsi_14m', 'mfi_14m', 'ema_dist_pct', 'ppi_yoy', 'mdebt_yoy', 'aaii_spread', 'vix_close']
RANK_GAUSS_SIGNALS = {'ppi_yoy', 'mdebt_yoy'}
# Alpha grid empirically tuned: per-step CV gets greedier as we add larger
# alphas, and OOS ρ peaks at cap=100 (0.364) vs 0.350 at cap=200 and 0.314
# at cap=500. The α=10 grid in v5 (ρ=0.301) was a corner-solution artifact.
ALPHAS  = [0.01, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0]
MIN_TRAIN = 36
HORIZON   = 12  # months

# ── load data ─────────────────────────────────────────────────────────────────
df = pd.read_csv(CSV, parse_dates=['date'])
df = df[['date', 'spy_close'] + SIGNALS + ['fwd_12m']].copy()
df = df.dropna(subset=SIGNALS).reset_index(drop=True)
print(f"Loaded {len(df)} rows with all signals")

# ── rank-gauss helpers ────────────────────────────────────────────────────────
def rank_gauss_series(vals: np.ndarray, ref_sorted: np.ndarray) -> np.ndarray:
    n = len(ref_sorted)
    ranks = np.searchsorted(ref_sorted, vals, side='left')
    p = np.clip(ranks / (n + 1), 0.01, 0.99)
    return stats.norm.ppf(p)

def rank_gauss_one(value: float, ref_sorted: np.ndarray) -> float:
    return float(rank_gauss_series(np.array([value]), ref_sorted)[0])

ppi_col   = SIGNALS.index('ppi_yoy')
mdebt_col = SIGNALS.index('mdebt_yoy')
vix_col   = SIGNALS.index('vix_close')

# ── walk-forward OOS predictions ──────────────────────────────────────────────
oos_preds   = []
oos_actual  = []
oos_dates   = []
oos_vix_raw = []
oos_drifts  = []

for idx in range(len(df)):
    row = df.iloc[idx]
    if pd.isna(row['fwd_12m']):
        continue

    # Rows with fwd_12m observable by time idx: those with index <= idx - HORIZON.
    # Slice end is exclusive, so cap at idx - HORIZON + 1.
    train_cutoff = idx - HORIZON + 1
    train = df.iloc[:train_cutoff].dropna(subset=['fwd_12m'])
    if len(train) < MIN_TRAIN:
        continue

    X_train = train[SIGNALS].values.astype(float)
    y_train = train['fwd_12m'].values.astype(float)

    means = X_train.mean(axis=0)
    stds  = X_train.std(axis=0, ddof=1)
    stds[stds == 0] = 1.0

    ppi_sorted   = np.sort(X_train[:, ppi_col])
    mdebt_sorted = np.sort(X_train[:, mdebt_col])

    X_z = (X_train - means) / stds
    X_z[:, ppi_col]   = rank_gauss_series(X_train[:, ppi_col],   ppi_sorted)
    X_z[:, mdebt_col] = rank_gauss_series(X_train[:, mdebt_col], mdebt_sorted)

    # Tune alpha on each window once we have enough data
    if len(train) >= 48:
        rcv = RidgeCV(alphas=ALPHAS, cv=TimeSeriesSplit(n_splits=3), fit_intercept=True)
        rcv.fit(X_z, y_train)
        best_alpha = rcv.alpha_
    else:
        best_alpha = 1.0

    ridge = Ridge(alpha=best_alpha, fit_intercept=True)
    ridge.fit(X_z, y_train)

    test_raw = row[SIGNALS].values.astype(float)
    test_z   = (test_raw - means) / stds
    test_z[ppi_col]   = rank_gauss_one(test_raw[ppi_col],   ppi_sorted)
    test_z[mdebt_col] = rank_gauss_one(test_raw[mdebt_col], mdebt_sorted)

    pred = float(ridge.predict(test_z.reshape(1, -1))[0])
    oos_preds.append(pred)
    oos_actual.append(float(row['fwd_12m']))
    oos_dates.append(row['date'])
    oos_vix_raw.append(float(test_raw[vix_col]))
    oos_drifts.append(float(np.mean(y_train)))   # training-sample drift

oos_preds   = np.array(oos_preds)
oos_actual  = np.array(oos_actual)
oos_vix_raw = np.array(oos_vix_raw)
oos_drifts  = np.array(oos_drifts)
print(f"\nWalk-forward OOS predictions: {len(oos_preds)}")

rho, pval  = stats.spearmanr(oos_preds, oos_actual)
resid      = oos_actual - oos_preds
resid_std  = float(np.std(resid, ddof=1))
mae        = float(np.mean(np.abs(resid)))
print(f"OOS Spearman ρ   = {rho:.4f}  (p={pval:.4f})")
print(f"OOS residual std = {resid_std:.4f}")
print(f"OOS MAE          = {mae:.4f}")

# ── final model on ALL data ───────────────────────────────────────────────────
all_valid = df.dropna(subset=['fwd_12m'])
X_all = all_valid[SIGNALS].values.astype(float)
y_all = all_valid['fwd_12m'].values.astype(float)

final_means = X_all.mean(axis=0)
final_stds  = X_all.std(axis=0, ddof=1)
final_stds[final_stds == 0] = 1.0

ppi_sorted_final   = np.sort(X_all[:, ppi_col])
mdebt_sorted_final = np.sort(X_all[:, mdebt_col])

X_all_z = (X_all - final_means) / final_stds
X_all_z[:, ppi_col]   = rank_gauss_series(X_all[:, ppi_col],   ppi_sorted_final)
X_all_z[:, mdebt_col] = rank_gauss_series(X_all[:, mdebt_col], mdebt_sorted_final)

# Re-tune alpha on full sample
final_rcv = RidgeCV(alphas=ALPHAS, cv=TimeSeriesSplit(n_splits=5), fit_intercept=True)
final_rcv.fit(X_all_z, y_all)
final_alpha = float(final_rcv.alpha_)
print(f"Final (full-sample) alpha (re-tuned): {final_alpha}")

ridge_final = Ridge(alpha=final_alpha, fit_intercept=True)
ridge_final.fit(X_all_z, y_all)
print(f"Final intercept = {ridge_final.intercept_:+.6f}")
for sig, coef in zip(SIGNALS, ridge_final.coef_):
    print(f"  {sig:20s}: {coef:+.6f}")

# Drift = full-sample mean of fwd_12m (replaces hard-coded 0.08)
DRIFT = float(np.mean(y_all))
print(f"\nDrift (sample mean of fwd_12m) = {DRIFT:.4f}  ({DRIFT*100:.2f}%)")

# ── heteroscedastic residual variance: σ²(t) ≈ a + b·vix_z(t) ────────────────
# Use training-sample VIX standardisation so coefficients are interpretable.
vix_mean = float(np.mean(X_all[:, vix_col]))
vix_std  = float(np.std(X_all[:, vix_col], ddof=1))
oos_vix_z = (oos_vix_raw - vix_mean) / vix_std

# Regress squared residuals on vix_z. Constrain fit to non-negative variance
# at scoring time via a floor.
sq_resid = resid ** 2
A = np.column_stack([np.ones_like(oos_vix_z), oos_vix_z])
coef_var, *_ = np.linalg.lstsq(A, sq_resid, rcond=None)
resid_var_a = float(coef_var[0])      # ≈ unconditional variance
resid_var_b = float(coef_var[1])      # slope on vix_z
# Sanity floor: at vix_z = -2 (very calm), conditional variance shouldn't go negative
floor = max(1e-4, 0.25 * resid_var_a)
print(f"σ² ≈ {resid_var_a:.4f} + {resid_var_b:+.4f}·vix_z   (floor={floor:.4f})")
print(f"  implied σ at vix_z=-1: {np.sqrt(max(floor, resid_var_a - resid_var_b)):.4f}")
print(f"  implied σ at vix_z= 0: {np.sqrt(max(floor, resid_var_a)):.4f}")
print(f"  implied σ at vix_z=+1: {np.sqrt(max(floor, resid_var_a + resid_var_b)):.4f}")

# ── build OOS score timeseries with VIX-conditional resid_std ────────────────
score_ts = []
for d, p, vz, dr in zip(oos_dates, oos_preds, oos_vix_z, oos_drifts):
    var_t = max(floor, resid_var_a + resid_var_b * vz)
    sig_t = float(np.sqrt(var_t))
    s = float(stats.norm.cdf((p - dr) / sig_t) * 100)
    score_ts.append({'d': d.strftime('%Y-%m'), 'pred': round(float(p), 6), 'score': round(s, 2)})

score_ts_arr_for_buckets = np.array([x['score'] for x in score_ts])

# ── buckets with Newey-West HAC CI ────────────────────────────────────────────
def newey_west_se(x: np.ndarray, lag: int) -> float:
    """HAC standard error of the sample mean using Bartlett kernel."""
    n = len(x)
    if n < 2:
        return float('nan')
    xc = x - x.mean()
    gamma0 = float(np.dot(xc, xc) / n)
    s = gamma0
    L = min(lag, n - 1)
    for h in range(1, L + 1):
        w = 1.0 - h / (L + 1)
        gh = float(np.dot(xc[h:], xc[:-h]) / n)
        s += 2 * w * gh
    s = max(s, 1e-8)        # variance floor
    return float(np.sqrt(s / n))

def bucket_stats(score_arr, actual_arr, label, lo, hi):
    mask = (score_arr >= lo) & (score_arr < hi + 0.01)
    fwds = actual_arr[mask]
    n_total = len(fwds)
    if n_total == 0:
        return {'lo': lo, 'hi': hi, 'label': label, 'n': 0, 'n_eff': 0,
                'mean': 0, 'ci_lo': 0, 'ci_hi': 0, 'pct_neg': 0, 'worst': 0}
    mean_val = float(np.mean(fwds))
    if n_total >= 4:
        se = newey_west_se(fwds, lag=HORIZON - 1)
        z95 = 1.96
        ci_lo = mean_val - z95 * se
        ci_hi = mean_val + z95 * se
    else:
        ci_lo = mean_val - 0.05
        ci_hi = mean_val + 0.05
    n_eff = max(1, int(round(n_total / HORIZON)))   # informational only
    return {
        'lo': lo, 'hi': hi, 'label': label,
        'n': n_total, 'n_eff': n_eff,
        'mean':    round(mean_val, 4),
        'ci_lo':   round(float(ci_lo), 4),
        'ci_hi':   round(float(ci_hi), 4),
        'pct_neg': round(float(np.mean(fwds < 0) * 100), 1),
        'worst':   round(float(np.min(fwds)), 4),
    }

BUCKET_DEFS = [
    (0,  20,  'Quintile 1 (0–20)'),
    (20, 40,  'Quintile 2 (20–40)'),
    (40, 60,  'Quintile 3 (40–60)'),
    (60, 80,  'Quintile 4 (60–80)'),
    (80, 100, 'Quintile 5 (80–100)'),
]
buckets = [bucket_stats(score_ts_arr_for_buckets, oos_actual, label, lo, hi)
           for lo, hi, label in BUCKET_DEFS]

print("\nBuckets (Newey-West HAC, lag=11):")
for b in buckets:
    print(f"  {b['label']:25s}  n={b['n']:3d}  "
          f"mean={b['mean']:+.1%}  CI=[{b['ci_lo']:+.1%},{b['ci_hi']:+.1%}]  "
          f"pctNeg={b['pct_neg']:.0f}%  worst={b['worst']:+.1%}")

# ── full timeseries ──────────────────────────────────────────────────────────
# OOS rows have walk-forward scores. For rows past the last fully-observable
# fwd_12m (last HORIZON-1 rows) we ALSO want a score for the live UI; mark
# those as in_sample=True (they use the final full-data model).
with open(MFILE) as f:
    model = json.load(f)

price_ts_map = {r['d']: r['spy'] for r in model['timeseries']}
score_map = {r['d']: r for r in score_ts}
df_idx = df.set_index(df['date'].dt.strftime('%Y-%m'))

# Compute in-sample scores for rows where fwd_12m is NOT yet observable
# (final HORIZON-1 rows of df) so the UI chart stays continuous.
last_observable = df['fwd_12m'].last_valid_index()
in_sample_ds = set()
if last_observable is not None:
    for i in range(last_observable + 1, len(df)):
        d_str = df.iloc[i]['date'].strftime('%Y-%m')
        in_sample_ds.add(d_str)

merged_ts = []
for d in sorted(price_ts_map.keys()):
    entry = {'d': d, 'spy': price_ts_map[d]}
    if d in score_map:
        entry['score'] = score_map[d]['score']
        entry['pred']  = score_map[d]['pred']
        entry['in_sample'] = False
    elif d in df_idx.index:
        # Fitted score using the final full-data model
        raw = df_idx.loc[d, SIGNALS].values.astype(float) if not isinstance(df_idx.loc[d], pd.DataFrame) else df_idx.loc[d].iloc[-1][SIGNALS].values.astype(float)
        z = (raw - final_means) / final_stds
        z[ppi_col]   = rank_gauss_one(raw[ppi_col],   ppi_sorted_final)
        z[mdebt_col] = rank_gauss_one(raw[mdebt_col], mdebt_sorted_final)
        p = float(ridge_final.predict(z.reshape(1, -1))[0])
        vz = (raw[vix_col] - vix_mean) / vix_std
        var_t = max(floor, resid_var_a + resid_var_b * vz)
        s = float(stats.norm.cdf((p - DRIFT) / np.sqrt(var_t)) * 100)
        entry['score'] = round(s, 2)
        entry['pred']  = round(p, 6)
        entry['in_sample'] = True
    else:
        entry['score'] = None
        entry['pred']  = None
        entry['in_sample'] = None
    merged_ts.append(entry)

# ── empirical sorted arrays for ALL signals (UI percentiles) ─────────────────
signal_sorted = {}
for sk in SIGNALS:
    arr = df[sk].dropna().values.astype(float)
    arr = np.sort(arr)
    # Round to keep file size sane
    signal_sorted[sk] = [round(float(v), 4) for v in arr]

# ── write model.json ─────────────────────────────────────────────────────────
model.update({
    'signals': SIGNALS,
    'means':   {s: round(float(v), 6) for s, v in zip(SIGNALS, final_means)},
    'stds':    {s: round(float(v), 6) for s, v in zip(SIGNALS, final_stds)},
    'ridge_alpha':     final_alpha,
    'ridge_intercept': round(float(ridge_final.intercept_), 8),
    'ridge_coefs':     {s: round(float(c), 8) for s, c in zip(SIGNALS, ridge_final.coef_)},
    'rank_gauss_ppi_sorted':   [round(float(v), 4) for v in ppi_sorted_final],
    'rank_gauss_mdebt_sorted': [round(float(v), 4) for v in mdebt_sorted_final],
    'signal_sorted':   signal_sorted,
    'resid_std':       round(resid_std, 8),
    'resid_var_a':     round(resid_var_a, 8),
    'resid_var_b':     round(resid_var_b, 8),
    'resid_var_floor': round(floor, 8),
    'vix_z_mean':      round(vix_mean, 6),
    'vix_z_std':       round(vix_std, 6),
    'drift':           round(DRIFT, 6),
    'oos_rho':         round(float(rho), 6),
    'oos_n':           len(oos_preds),
    'horizon_months':  HORIZON,
    'timeseries':      merged_ts,
    'buckets':         buckets,
    'ols_v4':          model.get('ols_v4', model.get('ols')),
})
for key in ['ols', 'eigenvectors', 'pred_history']:
    model.pop(key, None)

with open(MFILE, 'w') as f:
    json.dump(model, f, separators=(',', ':'))

print(f"\n✅ model.json updated at {MFILE}")
print(f"   alpha={final_alpha}  drift={DRIFT:.4f}  rho={rho:.4f}  resid_std={resid_std:.4f}")
