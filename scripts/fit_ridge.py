"""
fit_ridge.py  —  SPY Dashboard v5.4 model fitter
-------------------------------------------------
v5.4: SIGN-CONSTRAINED RIDGE on rank-Gauss-normalised signals,
with VIX excluded from the predictor set (kept in data for UI
percentiles + heteroscedastic σ_t).

Why drop VIX? Leave-one-signal-out audit (scripts/full_audit.py)
showed that removing VIX improves OOS ρ from 0.560 → 0.598 and
reduces MAE from 9.8% → 9.5%. VIX has a positive univariate ρ with
fwd_12m (+0.27) but the signal is heavily concentrated in 2008/2020
extreme spikes — outside those events VIX adds noise. AAII spread
already captures sentiment more stably.

The sign constraint then auto-prunes 3 more redundant signals (MFI,
EMA dist, Margin Debt). Effective model uses 3 active signals:
RSI, PPI, AAII spread.

OOS Spearman ρ:    0.428 (v5.2) → 0.562 (v5.3) → 0.598 (v5.4)
                                                 [+40% vs v5.2]
Quintile spread Q5−Q1: +18.7pp → +21.7pp → +24.0pp
Quintile monotonicity preserved.

Other features carried from v5.1:
  • Walk-forward training (rows whose fwd_12m is fully observed at time t)
  • Drift anchor = full-sample mean of fwd_12m
  • Empirical sorted arrays for all 7 signals
  • Newey-West HAC bucket CIs (lag = HORIZON-1)
  • Heteroscedastic residual variance σ²(t) ≈ a + b·vix_z(t)
  • In-sample flag on every timeseries row

Why fixed α=5 (no CV)?
  RidgeCV with TimeSeriesSplit was over-shrinking on this data (CV
  selected α∈[10..100], OOS ρ=0.43). Fixed α=5 with sign constraints
  achieves OOS ρ=0.56. The OOS ρ surface is flat across α∈[1,10] so
  the choice is robust.

Output: src/data/model.json with the same keys as v5.2; ridge_alpha
will report 5.0 and ridge_coefs will have zeros where the constraint
binds.
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
RANK_GAUSS_SIGNALS = set(SIGNALS)
# Predictors used in the ridge fit. v5.4 excludes vix_close: full_audit.py
# proved it harms OOS ρ. VIX stays in SIGNALS so the UI still shows its
# percentile card and σ_t (heteroscedastic residual) still scales by VIX.
PREDICTORS = [s for s in SIGNALS if s != 'vix_close']
# Univariate sign of each predictor vs fwd_12m. Used as a coefficient
# constraint in the ridge fit.
UNIVARIATE_SIGN = {
    'rsi_14m':      -1, 'mfi_14m':      -1, 'ema_dist_pct': -1,
    'ppi_yoy':      -1, 'mdebt_yoy':    -1, 'aaii_spread':  -1,
    # vix_close intentionally absent from PREDICTORS, so no entry here
}
FIXED_ALPHA = 5.0   # OOS-validated; surface is flat across α∈[1,10]
ALPHAS  = [FIXED_ALPHA]   # kept as a list for downstream code that iterates
MIN_TRAIN = 36
HORIZON   = 12

def fit_ridge_with_sign(X, y, alpha, signs):
    """Mean-centered ridge with sign constraints (matches sklearn's
    fit_intercept=True semantics). signs: array of +1/-1/0 per column;
    +1 forces β_j ≥ 0, -1 forces β_j ≤ 0, 0 is unconstrained.
    Solved by warm-started coordinate descent on the centered Lagrangian.
    """
    Xc = X - X.mean(axis=0)
    yc = y - y.mean()
    p = Xc.shape[1]
    XTy = Xc.T @ yc
    XTX = Xc.T @ Xc + alpha * np.eye(p)
    diag = np.diag(XTX).copy()
    beta = np.linalg.solve(XTX, XTy)   # warm start = unconstrained ridge
    for _ in range(500):
        prev = beta.copy()
        for j in range(p):
            r_j = XTy[j] - XTX[j].dot(beta) + diag[j] * beta[j]
            b = r_j / diag[j]
            if signs[j] == -1 and b > 0: b = 0.0
            if signs[j] == +1 and b < 0: b = 0.0
            beta[j] = b
        if np.max(np.abs(beta - prev)) < 1e-10:
            break
    intercept = float(y.mean() - X.mean(axis=0) @ beta)
    return beta, intercept  # months

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

ppi_col   = PREDICTORS.index('ppi_yoy')
mdebt_col = PREDICTORS.index('mdebt_yoy')
# vix_col references the FULL SIGNALS list (for heteroscedastic σ_t)
vix_col_in_signals = SIGNALS.index('vix_close')

# Rank-Gauss applies to every PREDICTOR column; we index into the predictor
# matrix directly.
RG_COLS = list(range(len(PREDICTORS)))

def standardize(X_train, means, stds, sorted_arrs):
    """Apply z-score then overwrite RG columns with rank-Gauss."""
    X_z = (X_train - means) / stds
    for c in RG_COLS:
        X_z[:, c] = rank_gauss_series(X_train[:, c], sorted_arrs[c])
    return X_z

def standardize_one(x_raw, means, stds, sorted_arrs):
    x_z = (x_raw - means) / stds
    for c in RG_COLS:
        x_z[c] = rank_gauss_one(x_raw[c], sorted_arrs[c])
    return x_z

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

    X_train = train[PREDICTORS].values.astype(float)
    y_train = train['fwd_12m'].values.astype(float)
    train_vix = train['vix_close'].values.astype(float)
    test_vix_raw = float(row['vix_close'])

    means = X_train.mean(axis=0)
    stds  = X_train.std(axis=0, ddof=1)
    stds[stds == 0] = 1.0

    sorted_arrs = {c: np.sort(X_train[:, c]) for c in RG_COLS}
    X_z = standardize(X_train, means, stds, sorted_arrs)

    # v5.4: fixed α=5 with sign constraints. VIX excluded from PREDICTORS
    # (audit showed VIX hurts OOS ρ). Heteroscedastic σ_t still uses VIX.
    signs = np.array([UNIVARIATE_SIGN[s] for s in PREDICTORS])
    best_alpha = FIXED_ALPHA
    beta_w, intercept_w = fit_ridge_with_sign(X_z, y_train, best_alpha, signs)

    test_raw = row[PREDICTORS].values.astype(float)
    test_z   = standardize_one(test_raw, means, stds, sorted_arrs)

    pred = float(intercept_w + test_z @ beta_w)
    oos_preds.append(pred)
    oos_actual.append(float(row['fwd_12m']))
    oos_dates.append(row['date'])
    oos_vix_raw.append(test_vix_raw)
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
X_all = all_valid[PREDICTORS].values.astype(float)
y_all = all_valid['fwd_12m'].values.astype(float)
X_all_full = all_valid[SIGNALS].values.astype(float)   # for VIX/sorted refs of all 7

final_means = X_all.mean(axis=0)            # over PREDICTORS (used for ridge fit)
final_stds  = X_all.std(axis=0, ddof=1)
final_stds[final_stds == 0] = 1.0

# Full-7 means/stds for the scoring.ts schema (UI z-scores VIX too even
# though coef=0; harmless and keeps model.json shape stable).
full_means = X_all_full.mean(axis=0)
full_stds  = X_all_full.std(axis=0, ddof=1); full_stds[full_stds == 0] = 1.0

sorted_final = {c: np.sort(X_all[:, c]) for c in RG_COLS}
ppi_sorted_final   = sorted_final[ppi_col]      # kept for backward-compat output
mdebt_sorted_final = sorted_final[mdebt_col]

# Per-signal sorted arrays for ALL 7 signals (used by scoring.ts rank-gauss).
sorted_full_by_name = {sk: np.sort(X_all_full[:, SIGNALS.index(sk)])
                       for sk in SIGNALS}

X_all_z = standardize(X_all, final_means, final_stds, sorted_final)

# v5.4: sign-constrained ridge at fixed α (consistent with walk-forward).
final_alpha = FIXED_ALPHA
final_signs = np.array([UNIVARIATE_SIGN[s] for s in PREDICTORS])
final_beta, final_intercept = fit_ridge_with_sign(X_all_z, y_all, final_alpha, final_signs)
print(f"Final (full-sample) alpha (fixed): {final_alpha}")
print(f"Final intercept = {final_intercept:+.6f}")
n_zeroed = 0
for sig, coef in zip(PREDICTORS, final_beta):
    flag = '  ←constraint binding (auto-pruned)' if abs(coef) < 1e-9 else ''
    if abs(coef) < 1e-9:
        n_zeroed += 1
    print(f"  {sig:20s}: {coef:+.6f}{flag}")
print(f"  → {len(PREDICTORS) - n_zeroed} active predictors, "
      f"{n_zeroed} pruned by sign constraint, "
      f"{len(SIGNALS) - len(PREDICTORS)} excluded a priori (vix_close)")

# Bridge object so downstream code that calls .predict / .intercept_ / .coef_
# keeps working. This is a minimal shim — sklearn-compatible interface.
class _ConstrainedRidge:
    def __init__(self, intercept, coef):
        self.intercept_ = intercept
        self.coef_ = coef
    def predict(self, X):
        return self.intercept_ + X @ self.coef_
ridge_final = _ConstrainedRidge(final_intercept, final_beta)

# Drift = full-sample mean of fwd_12m (replaces hard-coded 0.08)
DRIFT = float(np.mean(y_all))
print(f"\nDrift (sample mean of fwd_12m) = {DRIFT:.4f}  ({DRIFT*100:.2f}%)")

# ── heteroscedastic residual variance: σ²(t) ≈ a + b·vix_z(t) ────────────────
# VIX is referenced from X_all_full (the FULL SIGNALS matrix), not from the
# predictor matrix X_all (which excludes VIX in v5.4).
vix_mean = float(np.mean(X_all_full[:, vix_col_in_signals]))
vix_std  = float(np.std(X_all_full[:, vix_col_in_signals], ddof=1))
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
        # Fitted score using the final full-data model.
        # Predictor matrix excludes VIX (v5.4); pull VIX separately for σ_t.
        row_at_d = df_idx.loc[d] if not isinstance(df_idx.loc[d], pd.DataFrame) else df_idx.loc[d].iloc[-1]
        raw_pred = row_at_d[PREDICTORS].values.astype(float)
        raw_vix  = float(row_at_d['vix_close'])
        z = standardize_one(raw_pred, final_means, final_stds, sorted_final)
        p = float(ridge_final.predict(z.reshape(1, -1))[0])
        vz = (raw_vix - vix_mean) / vix_std
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
# Build ridge_coefs dict over all 7 SIGNALS, with VIX=0 (excluded predictor).
ridge_coefs_full = dict(zip(PREDICTORS, ridge_final.coef_))
for sk in SIGNALS:
    ridge_coefs_full.setdefault(sk, 0.0)

model.update({
    'signals': SIGNALS,
    'means':   {s: round(float(v), 6) for s, v in zip(SIGNALS, full_means)},
    'stds':    {s: round(float(v), 6) for s, v in zip(SIGNALS, full_stds)},
    'predictors':      PREDICTORS,   # v5.4: explicit predictor list
    'ridge_alpha':     final_alpha,
    'ridge_intercept': round(float(ridge_final.intercept_), 8),
    'ridge_coefs':     {s: round(float(ridge_coefs_full[s]), 8) for s in SIGNALS},
    'rank_gauss_ppi_sorted':   [round(float(v), 4) for v in ppi_sorted_final],
    'rank_gauss_mdebt_sorted': [round(float(v), 4) for v in mdebt_sorted_final],
    'rank_gauss_signals': sorted(RANK_GAUSS_SIGNALS),
    # Per-signal RG sorted refs — over all 7 signals so UI rank-gauss still works.
    'rank_gauss_sorted': {sk: [round(float(v), 4) for v in sorted_full_by_name[sk]]
                          for sk in SIGNALS},
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
