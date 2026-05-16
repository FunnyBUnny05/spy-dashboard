"""
prune_mfi_test.py — Compare 4-predictor model (drop MFI) vs 5-predictor (current).

Reports:
  1. rho(RSI, MFI) — confirms collinearity hypothesis
  2. OOS Spearman rho: 4-predictor vs 5-predictor
  3. Decision: prune if OOS rho delta < 0.01

Requires: /tmp/velv/master_dataset.csv
"""
import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path

CSV = Path("/tmp/velv/master_dataset.csv")

SIGNALS = ['rsi_14m', 'mfi_14m', 'ema_dist_pct', 'ppi_yoy', 'mdebt_yoy',
           'aaii_spread', 'vix_close', 'yield_curve_10y3m', 'breadth_12m_chg']
PREDICTORS_5 = [s for s in SIGNALS if s != 'vix_close']   # current
PREDICTORS_4 = [s for s in PREDICTORS_5 if s != 'mfi_14m']  # pruned

UNIVARIATE_SIGN = {
    'rsi_14m': -1, 'mfi_14m': -1, 'ema_dist_pct': -1,
    'ppi_yoy': -1, 'mdebt_yoy': -1, 'aaii_spread': -1,
    'yield_curve_10y3m': -1, 'breadth_12m_chg': -1,
}
MACRO_LAGS = {'ppi_yoy': 1, 'mdebt_yoy': 2}
FIXED_ALPHA = 5.0
MIN_TRAIN = 36
HORIZON = 12


def fit_ridge_with_sign(X, y, alpha, signs):
    Xc = X - X.mean(axis=0)
    yc = y - y.mean()
    p = Xc.shape[1]
    XTy = Xc.T @ yc
    XTX = Xc.T @ Xc + alpha * np.eye(p)
    diag = np.diag(XTX).copy()
    beta = np.linalg.solve(XTX, XTy)
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
    return beta, float(y.mean() - X.mean(axis=0) @ beta)


def rank_gauss_series(vals, ref_sorted):
    n = len(ref_sorted)
    ranks = np.searchsorted(ref_sorted, vals, side='left')
    p = np.clip(ranks / (n + 1), 0.01, 0.99)
    return stats.norm.ppf(p)


def walk_forward_oos(df, predictors):
    preds, actuals = [], []
    signs = np.array([UNIVARIATE_SIGN[s] for s in predictors])
    for idx in range(len(df)):
        row = df.iloc[idx]
        if pd.isna(row['fwd_12m']):
            continue
        train_cutoff = idx - HORIZON + 1
        train = df.iloc[:train_cutoff].dropna(subset=['fwd_12m'])
        if len(train) < MIN_TRAIN:
            continue
        X_tr = train[predictors].values.astype(float)
        y_tr = train['fwd_12m'].values.astype(float)
        X_rg = X_tr.copy()
        for c in range(X_tr.shape[1]):
            ref = np.sort(X_tr[:, c])
            X_rg[:, c] = rank_gauss_series(X_tr[:, c], ref)
        beta, intercept = fit_ridge_with_sign(X_rg, y_tr, FIXED_ALPHA, signs)
        x_test = row[predictors].values.astype(float)
        x_rg = np.array([
            rank_gauss_series(np.array([x_test[c]]), np.sort(X_tr[:, c]))[0]
            for c in range(len(predictors))
        ])
        preds.append(float(intercept + x_rg @ beta))
        actuals.append(float(row['fwd_12m']))
    return np.array(preds), np.array(actuals)


def main():
    df = pd.read_csv(CSV, parse_dates=['date'])
    df = df[['date'] + SIGNALS + ['fwd_12m']].copy()
    for col, lag in MACRO_LAGS.items():
        if col in df.columns:
            df[col] = df[col].shift(lag)
    df = df.dropna(subset=SIGNALS).reset_index(drop=True)

    # 1. RSI/MFI collinearity
    valid = df.dropna(subset=['rsi_14m', 'mfi_14m'])
    rho_rsi_mfi, p_rsi_mfi = stats.spearmanr(valid['rsi_14m'], valid['mfi_14m'])
    print(f"rho(RSI, MFI) = {rho_rsi_mfi:.3f}  (p={p_rsi_mfi:.4f})")
    print(f"  -> {'Collinear (rho > 0.6)' if abs(rho_rsi_mfi) > 0.6 else 'Not strongly collinear'}")

    # 2. Walk-forward OOS for both models
    print("\nRunning 5-predictor walk-forward OOS (current)...")
    p5, a5 = walk_forward_oos(df, PREDICTORS_5)
    rho5, _ = stats.spearmanr(p5, a5)

    print("Running 4-predictor walk-forward OOS (MFI dropped)...")
    p4, a4 = walk_forward_oos(df, PREDICTORS_4)
    rho4, _ = stats.spearmanr(p4, a4)

    delta = rho4 - rho5
    print(f"\n5-predictor OOS rho: {rho5:.4f}")
    print(f"4-predictor OOS rho: {rho4:.4f}")
    print(f"Delta (4 - 5):       {delta:+.4f}")

    print("\n" + "=" * 50)
    if abs(delta) < 0.01:
        print("RECOMMENDATION: PRUNE MFI")
        print("   OOS rho change is negligible (<0.01).")
        print("   Drop mfi_14m from PREDICTORS in fit_ridge.py and retrain.")
    else:
        print(f"RECOMMENDATION: KEEP MFI")
        print(f"   OOS rho change {delta:+.4f} exceeds threshold.")
        print("   Add collinearity warning comment instead of pruning.")


if __name__ == '__main__':
    main()
