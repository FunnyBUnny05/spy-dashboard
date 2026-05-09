"""Sweep model variants on the same walk-forward harness as fit_ridge.py
to find the best-performing v5.x configuration. DOES NOT touch model.json.

Reports OOS Spearman ρ, MAE, bias, quintile mean spread, and quintile
monotonicity for each variant.
"""
import json
import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path
from sklearn.linear_model import Ridge, RidgeCV
from sklearn.model_selection import TimeSeriesSplit

CSV       = Path("/tmp/velv/master_dataset.csv")
SIGNALS   = ['rsi_14m', 'mfi_14m', 'ema_dist_pct', 'ppi_yoy', 'mdebt_yoy', 'aaii_spread', 'vix_close']
ALPHAS    = [0.01, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0]
ALPHAS_EXTENDED = ALPHAS + [200.0, 500.0]
MIN_TRAIN = 36
HORIZON   = 12

UNIVARIATE_SIGN = {
    'rsi_14m':      -1, 'mfi_14m':      -1, 'ema_dist_pct': -1,
    'ppi_yoy':      -1, 'mdebt_yoy':    -1, 'aaii_spread':  -1,
    'vix_close':    +1,
}

df = pd.read_csv(CSV, parse_dates=['date'])
df = df[['date', 'spy_close'] + SIGNALS + ['fwd_12m']].copy()
df = df.dropna(subset=SIGNALS).reset_index(drop=True)

def rank_gauss_series(vals, ref_sorted):
    n = len(ref_sorted)
    ranks = np.searchsorted(ref_sorted, vals, side='left')
    p = np.clip(ranks / (n + 1), 0.01, 0.99)
    return stats.norm.ppf(p)

def fit_ridge_with_sign(X, y, alpha, signs):
    """Mean-centered ridge with sign constraints (matches sklearn's
    fit_intercept=True semantics). signs: array of +1/-1/0 per column.
    """
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
            b   = r_j / diag[j]
            if signs[j] == -1 and b > 0: b = 0.0
            if signs[j] == +1 and b < 0: b = 0.0
            beta[j] = b
        if np.max(np.abs(beta - prev)) < 1e-10:
            break
    intercept = float(y.mean() - X.mean(axis=0) @ beta)
    return beta, intercept

def run_variant(name, signal_list, rg_signals, alpha_grid, sign_constrain=False):
    """Walk-forward OOS evaluation. Returns metrics dict."""
    rg_set = set(rg_signals)
    rg_cols_local = [signal_list.index(s) for s in signal_list if s in rg_set]

    oos_preds, oos_actual = [], []
    chosen_alphas = []

    for idx in range(len(df)):
        row = df.iloc[idx]
        if pd.isna(row['fwd_12m']):
            continue
        train_cutoff = idx - HORIZON + 1
        train = df.iloc[:train_cutoff].dropna(subset=['fwd_12m'])
        if len(train) < MIN_TRAIN:
            continue

        X_train = train[signal_list].values.astype(float)
        y_train = train['fwd_12m'].values.astype(float)
        means = X_train.mean(axis=0)
        stds  = X_train.std(axis=0, ddof=1); stds[stds == 0] = 1.0

        sorted_arrs = {c: np.sort(X_train[:, c]) for c in rg_cols_local}
        X_z = (X_train - means) / stds
        for c in rg_cols_local:
            X_z[:, c] = rank_gauss_series(X_train[:, c], sorted_arrs[c])

        if len(alpha_grid) == 1:
            best_alpha = alpha_grid[0]
        elif len(train) >= 48:
            rcv = RidgeCV(alphas=alpha_grid, cv=TimeSeriesSplit(n_splits=3), fit_intercept=True)
            rcv.fit(X_z, y_train)
            best_alpha = rcv.alpha_
        else:
            best_alpha = alpha_grid[len(alpha_grid)//2]
        chosen_alphas.append(best_alpha)

        if sign_constrain:
            signs = np.array([UNIVARIATE_SIGN[s] for s in signal_list])
            beta, intercept = fit_ridge_with_sign(X_z, y_train, best_alpha, signs)
        else:
            ridge = Ridge(alpha=best_alpha, fit_intercept=True)
            ridge.fit(X_z, y_train)
            beta = ridge.coef_
            intercept = ridge.intercept_

        test_raw = row[signal_list].values.astype(float)
        test_z   = (test_raw - means) / stds
        for c in rg_cols_local:
            ranks = np.searchsorted(sorted_arrs[c], np.array([test_raw[c]]), side='left')
            p = np.clip(ranks / (len(sorted_arrs[c]) + 1), 0.01, 0.99)
            test_z[c] = float(stats.norm.ppf(p)[0])

        pred = float(intercept + test_z @ beta)
        oos_preds.append(pred)
        oos_actual.append(float(row['fwd_12m']))

    oos_preds  = np.array(oos_preds)
    oos_actual = np.array(oos_actual)
    rho, _   = stats.spearmanr(oos_preds, oos_actual)
    mae      = float(np.mean(np.abs(oos_actual - oos_preds)))
    bias     = float(np.mean(oos_preds - oos_actual))
    order    = np.argsort(oos_preds)
    quints   = np.array_split(order, 5)
    q_means  = [float(np.mean(oos_actual[q])) for q in quints]
    spread   = q_means[-1] - q_means[0]
    mono     = all(q_means[i] <= q_means[i+1] + 0.005 for i in range(4))
    return {
        'name': name, 'n': len(oos_preds),
        'rho': float(rho), 'mae': mae, 'bias': bias,
        'spread_q5_q1': spread, 'monotonic_quintile': mono,
        'q_means': q_means,
        'mean_alpha': float(np.mean(chosen_alphas)) if chosen_alphas else None,
    }

if __name__ == '__main__':
    variants = []
    variants.append(run_variant(
        'v5.2 baseline (RG all 7, free α)', SIGNALS, SIGNALS, ALPHAS))
    variants.append(run_variant(
        'drop ema_dist_pct (6 signals)',
        [s for s in SIGNALS if s != 'ema_dist_pct'],
        [s for s in SIGNALS if s != 'ema_dist_pct'], ALPHAS))
    variants.append(run_variant(
        'drop ema_dist + mfi (5 signals)',
        [s for s in SIGNALS if s not in ('ema_dist_pct', 'mfi_14m')],
        [s for s in SIGNALS if s not in ('ema_dist_pct', 'mfi_14m')], ALPHAS))
    variants.append(run_variant(
        'drop ema_dist + mfi + mdebt (4 signals)',
        [s for s in SIGNALS if s not in ('ema_dist_pct', 'mfi_14m', 'mdebt_yoy')],
        [s for s in SIGNALS if s not in ('ema_dist_pct', 'mfi_14m', 'mdebt_yoy')], ALPHAS))
    variants.append(run_variant(
        'all 7 signals, α extended [...500]', SIGNALS, SIGNALS, ALPHAS_EXTENDED))
    variants.append(run_variant(
        'all 7 signals, sign-constrained ridge', SIGNALS, SIGNALS,
        ALPHAS, sign_constrain=True))
    variants.append(run_variant(
        'all 7 signals, sign-constrained, α=100', SIGNALS, SIGNALS,
        [100.0], sign_constrain=True))
    print('\n[fair α-scan: sklearn-Ridge vs sign-constrained @ same fixed α]')
    for fixed_alpha in [1.0, 5.0, 10.0, 50.0, 100.0]:
        variants.append(run_variant(
            f'all 7 unconstrained, α={fixed_alpha:g}',
            SIGNALS, SIGNALS, [fixed_alpha], sign_constrain=False))
        variants.append(run_variant(
            f'all 7 sign-constrained, α={fixed_alpha:g}',
            SIGNALS, SIGNALS, [fixed_alpha], sign_constrain=True))

    print(f'\n{"variant":<48} {"n":>4} {"rho":>7} {"mae":>7} {"bias":>7} {"Q5−Q1":>7} {"mono?":>6}')
    print('-' * 96)
    for v in variants:
        print(f'{v["name"]:<48} {v["n"]:>4} '
              f'{v["rho"]:>+.4f} {v["mae"]:>.4f} {v["bias"]:>+.4f} '
              f'{v["spread_q5_q1"]:>+.4f} {"YES" if v["monotonic_quintile"] else "no":>6}')
    best = max(variants, key=lambda v: v['rho'])
    print(f'\nBest by Spearman ρ: {best["name"]}  (ρ={best["rho"]:+.4f})')
    print('\nQuintile means (Q1→Q5) for the top 3 variants:')
    for v in sorted(variants, key=lambda v: -v['rho'])[:3]:
        qm = '  '.join(f'{m*100:+5.1f}%' for m in v['q_means'])
        print(f'  {v["name"]:<48}  {qm}')
