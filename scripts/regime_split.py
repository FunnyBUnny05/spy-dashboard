"""
regime_split.py — Test whether v5.6 ridge coefs are stable across regimes.

Fits sign-constrained ridge on 2009–2016 only, evaluates on 2017–2025.
Compares coefs between halves. If any coef changes >2x or flips sign,
the model is regime-specific.

Requires: /tmp/velv/master_dataset.csv (same file as fit_ridge.py)
"""
import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path

CSV = Path("/tmp/velv/master_dataset.csv")

SIGNALS = ['rsi_14m', 'mfi_14m', 'ema_dist_pct', 'ppi_yoy', 'mdebt_yoy',
           'aaii_spread', 'vix_close', 'yield_curve_10y3m', 'breadth_12m_chg']
PREDICTORS = [s for s in SIGNALS if s != 'vix_close']
UNIVARIATE_SIGN = {
    'rsi_14m': -1, 'mfi_14m': -1, 'ema_dist_pct': -1,
    'ppi_yoy': -1, 'mdebt_yoy': -1, 'aaii_spread': -1,
    'yield_curve_10y3m': -1, 'breadth_12m_chg': -1,
}
MACRO_LAGS = {'ppi_yoy': 1, 'mdebt_yoy': 2}
FIXED_ALPHA = 5.0
SPLIT_DATE  = '2017-01-01'


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
    intercept = float(y.mean() - X.mean(axis=0) @ beta)
    return beta, intercept


def rank_gauss_series(vals, ref_sorted):
    n = len(ref_sorted)
    ranks = np.searchsorted(ref_sorted, vals, side='left')
    p = np.clip(ranks / (n + 1), 0.01, 0.99)
    return stats.norm.ppf(p)


def prepare(df_slice):
    X = df_slice[PREDICTORS].values.astype(float)
    y = df_slice['fwd_12m'].values.astype(float)
    X_rg = X.copy()
    for c in range(X.shape[1]):
        X_rg[:, c] = rank_gauss_series(X[:, c], np.sort(X[:, c]))
    return X_rg, y


def main():
    df = pd.read_csv(CSV, parse_dates=['date'])
    df = df[['date'] + SIGNALS + ['fwd_12m']].copy()
    for col, lag in MACRO_LAGS.items():
        if col in df.columns:
            df[col] = df[col].shift(lag)
    df = df.dropna(subset=SIGNALS + ['fwd_12m']).reset_index(drop=True)
    print(f"Total rows with all signals + fwd_12m: {len(df)}")

    split = pd.Timestamp(SPLIT_DATE)
    early = df[df['date'] < split].copy()
    late  = df[df['date'] >= split].copy()
    print(f"Pre-{SPLIT_DATE[:7]}:  {len(early)} rows")
    print(f"Post-{SPLIT_DATE[:7]}: {len(late)} rows")

    signs = np.array([UNIVARIATE_SIGN[s] for s in PREDICTORS])

    X_e, y_e = prepare(early)
    beta_e, int_e = fit_ridge_with_sign(X_e, y_e, FIXED_ALPHA, signs)

    X_l, y_l = prepare(late)
    beta_l, int_l = fit_ridge_with_sign(X_l, y_l, FIXED_ALPHA, signs)

    X_f, y_f = prepare(df)
    beta_f, int_f = fit_ridge_with_sign(X_f, y_f, FIXED_ALPHA, signs)

    # Evaluate: train on early, predict on late (rank-gauss within late)
    preds_late = int_e + X_l @ beta_e
    rho_late, p_late = stats.spearmanr(preds_late, y_l)

    print(f"\n{'Signal':<22} {'Full':>9} {'Pre-2017':>9} {'Post-2017':>10} {'Ratio':>8}  Flag")
    print("-" * 72)
    flags = []
    for i, sig in enumerate(PREDICTORS):
        bf, be, bl = beta_f[i], beta_e[i], beta_l[i]
        if abs(be) < 1e-9 and abs(bl) < 1e-9:
            ratio_str = "  both=0"
            flag = ""
        elif abs(be) < 1e-9:
            ratio_str = "    e=0 "
            flag = "⚠  zero in early" if abs(bl) > 0.01 else ""
        elif abs(bl) < 1e-9:
            ratio_str = "    l=0 "
            flag = "⚠  zero in late" if abs(be) > 0.01 else ""
        else:
            ratio = abs(bl / be)
            ratio_str = f"{ratio:8.2f}x"
            sign_flip = (be * bl) < 0
            flag = "SIGN FLIP" if sign_flip else (">2x change" if ratio > 2.0 else "")
        if flag:
            flags.append(f"  {sig}: {flag}")
        print(f"  {sig:<20} {bf:+9.5f} {be:+9.5f} {bl:+10.5f} {ratio_str}  {flag}")

    print(f"\nOOS rho (train pre-2017, eval post-2017): {rho_late:.4f}  (p={p_late:.4f})")
    print(f"Intercepts — full: {int_f:+.6f} | pre: {int_e:+.6f} | post: {int_l:+.6f}")

    print()
    if flags:
        print(f"REGIME INSTABILITY DETECTED ({len(flags)} signal(s)):")
        for f in flags:
            print(f)
        print("\nInterpretation: model may be fitting regime-specific behavior.")
        print("Consider: rolling-window fit, regime-conditional model, or ELO fallback.")
    else:
        print("Coefs broadly stable across regimes. OOS rho drop likely reflects")
        print("harder data (2022 inflation), not specification mining.")


if __name__ == '__main__':
    main()
