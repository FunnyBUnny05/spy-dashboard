"""
fit_ridge.py  —  SPY Dashboard v5 model fitter
------------------------------------------------
Changes from v4 (PCA+OLS):
  1. Ridge regression directly on 7 z-scored signals (no PCA)
  2. rank-gauss normalisation for ppi_yoy and mdebt_yoy
  3. Fixed-CDF scoring:  score = norm.cdf((pred - 0.08) / resid_std) * 100
  4. Walk-forward structure: train only on rows[:t-12] at each step t
  5. Ridge alpha tuned via TimeSeriesSplit CV
  6. Bucket CIs use non-overlapping (::12) windows

Output: updates src/data/model.json in-place with new keys:
  ridge_alpha, ridge_intercept, ridge_coefs (7 values, signal order),
  resid_std (OOS), oos_rho, rank_gauss_ppi_sorted, rank_gauss_mdebt_sorted,
  updated buckets (n_eff, ci from ::12 obs)
"""

import json, sys
import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path

# ── paths ─────────────────────────────────────────────────────────────────────
REPO   = Path(__file__).parent.parent
CSV    = Path("/tmp/velv/master_dataset.csv")
MFILE  = REPO / "src/data/model.json"

SIGNALS = ['rsi_14m', 'mfi_14m', 'ema_dist_pct', 'ppi_yoy', 'mdebt_yoy', 'aaii_spread', 'vix_close']
RANK_GAUSS_SIGNALS = {'ppi_yoy', 'mdebt_yoy'}

# ── load data ─────────────────────────────────────────────────────────────────
df = pd.read_csv(CSV, parse_dates=['date'])
df = df[['date','spy_close'] + SIGNALS + ['fwd_12m']].copy()
df = df.dropna(subset=SIGNALS).reset_index(drop=True)
print(f"Loaded {len(df)} rows with all signals")

# ── rank-gauss helper ──────────────────────────────────────────────────────────
def rank_gauss_transform(values: np.ndarray, ref_sorted: np.ndarray) -> float:
    """Transform a single value using rank-gauss against ref_sorted distribution."""
    n = len(ref_sorted)
    rank = np.searchsorted(ref_sorted, values, side='left')
    p = np.clip(rank / (n + 1), 0.01, 0.99)
    return stats.norm.ppf(p)

def rank_gauss_series(vals: np.ndarray, ref_sorted: np.ndarray) -> np.ndarray:
    """Vectorised rank-gauss."""
    n = len(ref_sorted)
    ranks = np.searchsorted(ref_sorted, vals, side='left')
    p = np.clip(ranks / (n + 1), 0.01, 0.99)
    return stats.norm.ppf(p)

# ── standardise features (walk-forward) ───────────────────────────────────────
MIN_TRAIN = 36   # need at least 36 monthly obs before first prediction

rows_with_fwd = df.dropna(subset=['fwd_12m'])
print(f"Rows with realized fwd_12m: {len(rows_with_fwd)}")

ALPHAS = [0.01, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0]

oos_preds  = []
oos_actual = []
oos_dates  = []
final_alpha = None
final_coefs = None
final_intercept = None

for idx in range(len(df)):
    row = df.iloc[idx]
    if pd.isna(row['fwd_12m']):
        continue

    # Training data = rows strictly before idx-11 (last realized return is idx-12)
    train_end = idx - 12
    if train_end < MIN_TRAIN:
        continue

    train = df.iloc[:train_end].dropna(subset=['fwd_12m'])
    if len(train) < MIN_TRAIN:
        continue

    X_train = train[SIGNALS].values.copy().astype(float)
    y_train = train['fwd_12m'].values.astype(float)

    # Z-score params from training window
    means = X_train.mean(axis=0)
    stds  = X_train.std(axis=0, ddof=1)
    stds[stds == 0] = 1.0

    # rank-gauss reference distributions from training window
    ppi_col   = SIGNALS.index('ppi_yoy')
    mdebt_col = SIGNALS.index('mdebt_yoy')
    ppi_sorted   = np.sort(X_train[:, ppi_col])
    mdebt_sorted = np.sort(X_train[:, mdebt_col])

    # Transform training features
    X_z = (X_train - means) / stds
    X_z[:, ppi_col]   = rank_gauss_series(X_train[:, ppi_col],   ppi_sorted)
    X_z[:, mdebt_col] = rank_gauss_series(X_train[:, mdebt_col], mdebt_sorted)

    # Tune alpha via simple 3-fold TimeSeriesSplit on training data
    if len(train) >= 48:
        from sklearn.linear_model import RidgeCV
        from sklearn.model_selection import TimeSeriesSplit
        tscv = TimeSeriesSplit(n_splits=3)
        rcv = RidgeCV(alphas=ALPHAS, cv=tscv, fit_intercept=True)
        rcv.fit(X_z, y_train)
        best_alpha = rcv.alpha_
    else:
        best_alpha = 1.0  # default until we have enough data

    # Fit final model on full training window
    from sklearn.linear_model import Ridge
    ridge = Ridge(alpha=best_alpha, fit_intercept=True)
    ridge.fit(X_z, y_train)

    # Transform test row
    test_raw = row[SIGNALS].values.astype(float)
    test_z   = (test_raw - means) / stds
    test_z[ppi_col]   = rank_gauss_transform(test_raw[ppi_col],   ppi_sorted)
    test_z[mdebt_col] = rank_gauss_transform(test_raw[mdebt_col], mdebt_sorted)

    pred = ridge.predict(test_z.reshape(1, -1))[0]
    oos_preds.append(pred)
    oos_actual.append(row['fwd_12m'])
    oos_dates.append(row['date'])

    # Save the last fitted model
    final_alpha     = best_alpha
    final_coefs     = ridge.coef_.tolist()
    final_intercept = ridge.intercept_

print(f"\nWalk-forward OOS predictions: {len(oos_preds)}")

oos_preds  = np.array(oos_preds)
oos_actual = np.array(oos_actual)
rho, pval  = stats.spearmanr(oos_preds, oos_actual)
resid      = oos_actual - oos_preds
resid_std  = float(np.std(resid, ddof=1))
mae        = float(np.mean(np.abs(resid)))

print(f"OOS Spearman ρ  = {rho:.4f}  (p={pval:.4f})")
print(f"OOS residual std = {resid_std:.4f}")
print(f"OOS MAE          = {mae:.4f}")
print(f"Final Ridge alpha = {final_alpha}")
print(f"Final intercept   = {final_intercept:.6f}")
for i, (sig, coef) in enumerate(zip(SIGNALS, final_coefs)):
    print(f"  {sig:20s}: {coef:+.6f}")

# ── fit FINAL model on ALL available data (for deployed scoring) ──────────────
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

ridge_final = Ridge(alpha=final_alpha, fit_intercept=True)
ridge_final.fit(X_all_z, y_all)

print(f"\nFinal (full data) model:")
print(f"  intercept = {ridge_final.intercept_:.6f}")
for sig, coef in zip(SIGNALS, ridge_final.coef_):
    print(f"  {sig:20s}: {coef:+.6f}")

# ── compute OOS score timeseries ──────────────────────────────────────────────
DRIFT = 0.08
score_ts = []
for d, p in zip(oos_dates, oos_preds):
    s = float(stats.norm.cdf((p - DRIFT) / resid_std) * 100)
    score_ts.append({'d': d.strftime('%Y-%m'), 'pred': round(float(p), 6), 'score': round(s, 2)})

# ── quintile buckets with non-overlapping CI ──────────────────────────────────
def bucket_stats(subset_preds, subset_actual, label, lo, hi):
    mask = (subset_preds_score >= lo) & (subset_preds_score < hi + 0.01)
    fwds = subset_actual[mask]
    n_total = len(fwds)
    if n_total == 0:
        return {'lo': lo, 'hi': hi, 'label': label, 'n': 0, 'n_eff': 0,
                'mean': 0, 'ci_lo': 0, 'ci_hi': 0, 'pct_neg': 0, 'worst': 0}
    # non-overlapping every 12th observation
    fwds_nonoverlap = fwds[::12]
    n_eff = len(fwds_nonoverlap)
    mean_val = float(np.mean(fwds))
    if n_eff >= 2:
        se   = float(np.std(fwds_nonoverlap, ddof=1) / np.sqrt(n_eff))
        t95  = float(stats.t.ppf(0.975, df=n_eff-1))
        ci_lo = mean_val - t95 * se
        ci_hi = mean_val + t95 * se
    else:
        ci_lo = mean_val - 0.05
        ci_hi = mean_val + 0.05
    return {
        'lo': lo, 'hi': hi, 'label': label,
        'n': n_total, 'n_eff': n_eff,
        'mean':    round(mean_val, 4),
        'ci_lo':   round(float(ci_lo), 4),
        'ci_hi':   round(float(ci_hi), 4),
        'pct_neg': round(float(np.mean(fwds < 0) * 100), 1),
        'worst':   round(float(np.min(fwds)), 4),
    }

subset_preds_score = np.array([
    float(stats.norm.cdf((p - DRIFT) / resid_std) * 100)
    for p in oos_preds
])

BUCKET_DEFS = [
    (0,  20,  'Quintile 1 (0–20)'),
    (20, 40,  'Quintile 2 (20–40)'),
    (40, 60,  'Quintile 3 (40–60)'),
    (60, 80,  'Quintile 4 (60–80)'),
    (80, 100, 'Quintile 5 (80–100)'),
]
buckets = [bucket_stats(subset_preds_score, oos_actual, label, lo, hi)
           for lo, hi, label in BUCKET_DEFS]

for b in buckets:
    print(f"  {b['label']:25s}  n={b['n']:3d}  n_eff={b['n_eff']:2d}  "
          f"mean={b['mean']:+.1%}  CI=[{b['ci_lo']:+.1%},{b['ci_hi']:+.1%}]  "
          f"pctNeg={b['pct_neg']:.0f}%  worst={b['worst']:+.1%}")

# ── build full timeseries (merge OOS scores into price series) ────────────────
# Load original price timeseries from model.json
with open(MFILE) as f:
    model = json.load(f)

price_ts = {r['d']: r['spy'] for r in model['timeseries']}
score_map = {r['d']: r for r in score_ts}

merged_ts = []
for d in sorted(price_ts.keys()):
    entry = {'d': d, 'spy': price_ts[d]}
    if d in score_map:
        entry['score'] = score_map[d]['score']
        entry['pred']  = score_map[d]['pred']
    else:
        entry['score'] = None
        entry['pred']  = None
    merged_ts.append(entry)

# ── write updated model.json ──────────────────────────────────────────────────
model.update({
    'signals': SIGNALS,
    'means':   {s: round(float(v), 6) for s, v in zip(SIGNALS, final_means)},
    'stds':    {s: round(float(v), 6) for s, v in zip(SIGNALS, final_stds)},
    # Ridge v5
    'ridge_alpha':     float(final_alpha),
    'ridge_intercept': round(float(ridge_final.intercept_), 8),
    'ridge_coefs':     {s: round(float(c), 8) for s, c in zip(SIGNALS, ridge_final.coef_)},
    # rank-gauss reference distributions (full history)
    'rank_gauss_ppi_sorted':   [round(float(v),4) for v in ppi_sorted_final],
    'rank_gauss_mdebt_sorted': [round(float(v),4) for v in mdebt_sorted_final],
    # scoring CDF params
    'resid_std':   round(resid_std, 8),
    'drift':       DRIFT,
    'oos_rho':     round(float(rho), 6),
    'oos_n':       len(oos_preds),
    # timeseries & buckets
    'timeseries':  merged_ts,
    'buckets':     buckets,
    # keep old OLS for reference
    'ols_v4': model.get('ols'),
})
# remove stale keys
for key in ['ols', 'eigenvectors', 'pred_history']:
    model.pop(key, None)

with open(MFILE, 'w') as f:
    json.dump(model, f, separators=(',', ':'))

print(f"\n✅ model.json updated at {MFILE}")
print(f"   ridge_alpha={final_alpha}  oos_rho={rho:.4f}  resid_std={resid_std:.4f}")
