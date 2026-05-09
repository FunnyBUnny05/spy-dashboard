"""Investigate the leave-one-out finding that dropping VIX improves ρ.

Tests:
  1. Compare 7-signal vs 6-signal (no VIX) on the SAME walk-forward
     across multiple metrics (ρ, MAE, calibration, tail-event detection).
  2. Check if VIX helps specifically at tail events (large fwd returns).
  3. Test 6-signal model with sub-period stability.
  4. Decision: keep VIX or drop?
"""
import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from variant_sweep import (df, fit_ridge_with_sign, rank_gauss_series,
                            UNIVARIATE_SIGN, SIGNALS, MIN_TRAIN, HORIZON)

def walk_forward(signal_list, alpha=5.0):
    signs = np.array([UNIVARIATE_SIGN[s] for s in signal_list])
    rg_cols = list(range(len(signal_list)))
    op, oa, od = [], [], []
    for idx in range(len(df)):
        row = df.iloc[idx]
        if pd.isna(row['fwd_12m']): continue
        cutoff = idx - HORIZON + 1
        train = df.iloc[:cutoff].dropna(subset=['fwd_12m'])
        if len(train) < MIN_TRAIN: continue
        Xt = train[signal_list].values.astype(float)
        yt = train['fwd_12m'].values.astype(float)
        means = Xt.mean(axis=0); stds = Xt.std(axis=0, ddof=1); stds[stds==0]=1
        sa = {c: np.sort(Xt[:, c]) for c in rg_cols}
        Xz = (Xt - means) / stds
        for c in rg_cols:
            Xz[:, c] = rank_gauss_series(Xt[:, c], sa[c])
        beta, b0 = fit_ridge_with_sign(Xz, yt, alpha, signs)
        xr = row[signal_list].values.astype(float)
        xz = (xr - means) / stds
        for c in rg_cols:
            ranks = np.searchsorted(sa[c], np.array([xr[c]]), side='left')
            p = np.clip(ranks/(len(sa[c])+1), 0.01, 0.99)
            xz[c] = float(stats.norm.ppf(p)[0])
        op.append(float(b0 + xz @ beta))
        oa.append(float(row['fwd_12m']))
        od.append(row['date'].strftime('%Y-%m'))
    return np.array(op), np.array(oa), np.array(od)

print('Running walk-forward for v5.3 (with VIX) and 6-signal (without VIX)...\n')
preds_full, fwds_full, dates_full = walk_forward(SIGNALS)
preds_noVIX, fwds_noVIX, _ = walk_forward([s for s in SIGNALS if s != 'vix_close'])
assert (fwds_full == fwds_noVIX).all()

def m(p, f, label):
    rho, _ = stats.spearmanr(p, f)
    pearson = float(np.corrcoef(p, f)[0,1])
    mae = float(np.mean(np.abs(p - f)))
    bias = float(np.mean(p - f))
    order = np.argsort(p)
    q = np.array_split(order, 5)
    qm = [float(np.mean(f[idx])) for idx in q]
    spread = qm[-1] - qm[0]
    mono = all(qm[i] <= qm[i+1] + 0.005 for i in range(4))
    print(f'  {label:<28}  ρ={rho:+.4f}  r={pearson:+.4f}  MAE={mae:.4f}  '
          f'bias={bias:+.4f}  Q5−Q1={spread:+.4f}  mono={"Y" if mono else "n"}')
    return {'rho': rho, 'mae': mae, 'q_means': qm, 'spread': spread}

print('1 ─ HEAD-TO-HEAD on full OOS sample (n={})\n'.format(len(fwds_full)))
m_full = m(preds_full, fwds_full, '7-signal v5.3 (with VIX)')
m_no   = m(preds_noVIX, fwds_noVIX, '6-signal (no VIX)')

print('\n2 ─ TAIL-EVENT DETECTION: did VIX help at the extremes?\n')

# Top/bottom decile of realised fwd returns
top = fwds_full >= np.percentile(fwds_full, 90)
bot = fwds_full <= np.percentile(fwds_full, 10)
print(f'  TOP decile (n={top.sum()}): mean realised = {float(np.mean(fwds_full[top])):+.2%}')
print(f'    7-sig predicted mean: {float(np.mean(preds_full[top])):+.2%}')
print(f'    6-sig predicted mean: {float(np.mean(preds_noVIX[top])):+.2%}')
print(f'    7-sig avg rank-percentile: {float(np.mean(stats.rankdata(preds_full)[top]))/len(preds_full):.0%}')
print(f'    6-sig avg rank-percentile: {float(np.mean(stats.rankdata(preds_noVIX)[top]))/len(preds_noVIX):.0%}')
print(f'  BOT decile (n={bot.sum()}): mean realised = {float(np.mean(fwds_full[bot])):+.2%}')
print(f'    7-sig predicted mean: {float(np.mean(preds_full[bot])):+.2%}')
print(f'    6-sig predicted mean: {float(np.mean(preds_noVIX[bot])):+.2%}')
print(f'    7-sig avg rank-percentile: {float(np.mean(stats.rankdata(preds_full)[bot]))/len(preds_full):.0%}')
print(f'    6-sig avg rank-percentile: {float(np.mean(stats.rankdata(preds_noVIX)[bot]))/len(preds_noVIX):.0%}')

print('\n3 ─ SUB-PERIOD STABILITY (with vs without VIX)\n')
periods = [
    ('2016-2019',     '2016-01', '2019-12'),
    ('2020-2022',     '2020-01', '2022-12'),
    ('2023-2025',     '2023-01', '2025-12'),
]
print(f'  {"period":<14}  {"n":>3}  {"7-sig ρ":>9}  {"6-sig ρ":>9}  {"Δρ":>7}')
for label, lo, hi in periods:
    mask = (dates_full >= lo) & (dates_full <= hi)
    if mask.sum() < 12: continue
    r7, _ = stats.spearmanr(preds_full[mask], fwds_full[mask])
    r6, _ = stats.spearmanr(preds_noVIX[mask], fwds_noVIX[mask])
    print(f'  {label:<14}  {mask.sum():>3}  {r7:>+9.4f}  {r6:>+9.4f}  {r6-r7:>+7.4f}')

print('\n4 ─ DECISION HEURISTIC\n')
delta_rho = m_no['rho'] - m_full['rho']
delta_q5q1 = m_no['spread'] - m_full['spread']
print(f'  Δρ on full sample:       {delta_rho:+.4f}')
print(f'  Δ Q5−Q1 spread:          {delta_q5q1:+.4f}')
print(f'  6-sig MAE:               {m_no["mae"]:.4f}')
print(f'  7-sig MAE:               {m_full["mae"]:.4f}')

if delta_rho > 0.02 and delta_q5q1 > 0:
    print('\n  → Recommend DROPPING VIX. The model is more accurate without it.')
elif abs(delta_rho) < 0.02:
    print('\n  → Within noise. Keep VIX (it does no harm and may help at tails).')
else:
    print('\n  → Mixed signal — VIX helps somewhere but hurts elsewhere. Investigate further.')
