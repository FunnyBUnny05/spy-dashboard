"""
walk_forward_score.py — compute temporally-honest walk-forward scores and patch model.json

Algorithm (per spec Change 9):
  For each month t (starting at index 60):
    - Training rows: [0, t-12) — excludes last 12 months (fwd returns not yet realized).
    - Fit ridge with same sign constraints and α=5 as fit_ridge.py.
    - Rank-Gauss normalize month t using ONLY the training reference array.
    - drift_wf = mean(fwd_12m in training set).
    - sigma_t  = sqrt(resid_var_a + resid_var_b * vix_z(t))  [full-sample params from model.json].
    - score_wf = normCdf((pred_wf - drift_wf) / sigma_t) * 100.

Output: patches src/data/model.json timeseries rows with score_wf where computed.

Run from repo root:  python3 scripts/walk_forward_score.py
"""

import json
import sys
import numpy as np
from pathlib import Path
from scipy import stats

REPO  = Path(__file__).parent.parent
CSV   = Path("/tmp/velv/master_dataset.csv")
MFILE = REPO / "src/data/model.json"

SIGNALS    = ['rsi_14m', 'mfi_14m', 'ema_dist_pct', 'ppi_yoy', 'mdebt_yoy',
              'aaii_spread', 'vix_close', 'yield_curve_10y3m', 'breadth_12m_chg']
PREDICTORS = [s for s in SIGNALS if s not in ('vix_close', 'mfi_14m')]
UNIVARIATE_SIGN = {
    'rsi_14m': -1, 'ema_dist_pct': -1, 'ppi_yoy': -1, 'mdebt_yoy': -1,
    'aaii_spread': -1, 'yield_curve_10y3m': -1, 'breadth_12m_chg': -1,
}
SIGNS      = np.array([UNIVARIATE_SIGN[s] for s in PREDICTORS])
FIXED_ALPHA = 5.0
HORIZON     = 12
MIN_TRAIN   = 60    # spec: start at month index 60
MACRO_LAGS  = {'ppi_yoy': 1, 'mdebt_yoy': 2}
RG_COLS     = list(range(len(PREDICTORS)))


def fit_ridge_sign(X_z, y, alpha, signs):
    """Sign-constrained ridge on pre-standardized data (same as fit_ridge.py)."""
    Xc = X_z - X_z.mean(axis=0)
    yc = y   - y.mean()
    XTy = Xc.T @ yc
    XTX = Xc.T @ Xc + alpha * np.eye(Xc.shape[1])
    diag = np.diag(XTX).copy()
    beta = np.linalg.solve(XTX, XTy)
    for _ in range(500):
        prev = beta.copy()
        for j in range(len(beta)):
            r_j = XTy[j] - XTX[j].dot(beta) + diag[j] * beta[j]
            b   = r_j / diag[j]
            if signs[j] == -1 and b > 0: b = 0.0
            if signs[j] == +1 and b < 0: b = 0.0
            beta[j] = b
        if np.max(np.abs(beta - prev)) < 1e-10:
            break
    intercept = float(y.mean() - X_z.mean(axis=0) @ beta)
    return beta, intercept


def rank_gauss_one(value, ref_sorted):
    n = len(ref_sorted)
    rank = np.searchsorted(ref_sorted, value, side='left')
    p = np.clip(rank / (n + 1), 0.01, 0.99)
    return float(stats.norm.ppf(p))


def standardize_rg(X_train):
    means = X_train.mean(axis=0)
    stds  = X_train.std(axis=0, ddof=1)
    stds[stds == 0] = 1.0
    sorted_arrs = {c: np.sort(X_train[:, c]) for c in RG_COLS}
    X_z = np.zeros_like(X_train)
    for c in RG_COLS:
        for i, v in enumerate(X_train[:, c]):
            X_z[i, c] = rank_gauss_one(v, sorted_arrs[c])
    return X_z, means, stds, sorted_arrs


def score_one(pred, drift, vix_raw, resid_var_a, resid_var_b, resid_var_floor, vix_z_mean, vix_z_std):
    vix_z = (vix_raw - vix_z_mean) / vix_z_std
    var_t = max(resid_var_a + resid_var_b * vix_z, resid_var_floor)
    sigma_t = float(np.sqrt(var_t))
    if sigma_t == 0:
        return 50.0
    return float(stats.norm.cdf((pred - drift) / sigma_t) * 100)


def main():
    try:
        import pandas as pd
    except ImportError:
        print("pandas required: pip install pandas")
        sys.exit(1)

    if not CSV.exists():
        print(f"Master dataset not found at {CSV}")
        print("Run fit_ridge.py first or point CSV to the correct path.")
        sys.exit(1)

    print(f"Loading {CSV}")
    df = pd.read_csv(CSV, parse_dates=['date'])
    df = df[['date', 'spy_close'] + SIGNALS + ['fwd_12m']].copy()
    for col, lag in MACRO_LAGS.items():
        if col in df.columns:
            df[col] = df[col].shift(lag)
    df = df.dropna(subset=PREDICTORS).reset_index(drop=True)
    print(f"  {len(df)} rows after dropping missing predictors")

    # Load full-sample sigma params from model.json
    model = json.loads(MFILE.read_text())
    rv_a     = float(model['resid_var_a'])
    rv_b     = float(model['resid_var_b'])
    rv_floor = float(model['resid_var_floor'])
    vix_z_mean = float(model['vix_z_mean'])
    vix_z_std  = float(model['vix_z_std'])

    results: dict[str, dict] = {}   # date_str → {score, pred}

    n = len(df)
    for t in range(MIN_TRAIN, n):
        row = df.iloc[t]

        # Training window: rows [0, t-HORIZON) with realized fwd_12m
        train_end = t - HORIZON
        if train_end < MIN_TRAIN:
            continue
        train = df.iloc[:train_end].dropna(subset=['fwd_12m'])
        if len(train) < MIN_TRAIN:
            continue

        X_train = train[PREDICTORS].values.astype(float)
        y_train = train['fwd_12m'].values.astype(float)
        drift_wf = float(y_train.mean())

        X_z, means, stds, sorted_arrs = standardize_rg(X_train)
        beta, intercept = fit_ridge_sign(X_z, y_train, FIXED_ALPHA, SIGNS)

        test_raw = row[PREDICTORS].values.astype(float)
        test_z   = np.array([rank_gauss_one(test_raw[c], sorted_arrs[c]) for c in RG_COLS])
        pred_wf  = float(intercept + test_z @ beta)

        vix_raw = float(row['vix_close'])
        s_wf    = score_one(pred_wf, drift_wf, vix_raw, rv_a, rv_b, rv_floor, vix_z_mean, vix_z_std)

        date_str = row['date'].strftime('%Y-%m')
        results[date_str] = {'score': round(s_wf, 2), 'pred': round(pred_wf, 6)}
        if t % 20 == 0:
            print(f"  t={t:3d}  {date_str}  pred_wf={pred_wf:.4f}  score_wf={s_wf:.1f}")

    print(f"\nComputed {len(results)} walk-forward scores")

    # Patch model.json timeseries — overwrite score and pred for OOS rows with WF values
    ts = model['timeseries']
    patched = 0
    for row in ts:
        date_key = row.get('d', '')
        if date_key in results:
            row['score'] = results[date_key]['score']
            if not row.get('in_sample'):
                row['pred'] = results[date_key]['pred']
            patched += 1

    MFILE.write_text(json.dumps(model, indent=2))
    print(f"Patched {patched} timeseries rows in {MFILE}")
    print("Done. Restart the Vite dev server to see updated scores.")


if __name__ == '__main__':
    main()
