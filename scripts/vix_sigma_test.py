"""
vix_sigma_test.py — Compare OOS log-likelihood: constant sigma vs VIX-conditional.

Uses walk-forward OOS predictions from model.json timeseries aligned with
actual fwd_12m and vix_close from the master dataset.

Requires: src/data/model.json, /tmp/velv/master_dataset.csv
"""
import json
import numpy as np
import pandas as pd
from pathlib import Path

REPO = Path(__file__).parent.parent
m = json.loads((REPO / 'src/data/model.json').read_text())
df_raw = pd.read_csv('/tmp/velv/master_dataset.csv', parse_dates=['date'])
df_raw['ym'] = df_raw['date'].dt.strftime('%Y-%m')
df_raw = df_raw.set_index('ym')

# Pull OOS rows from timeseries (in_sample=False, pred not null)
oos = [r for r in m['timeseries']
       if r.get('in_sample') is False and r['pred'] is not None]

rows = []
for r in oos:
    ym = r['d']
    if ym not in df_raw.index:
        continue
    raw_row = df_raw.loc[ym]
    # handle duplicate index (take first)
    if isinstance(raw_row, pd.DataFrame):
        raw_row = raw_row.iloc[0]
    fwd = raw_row.get('fwd_12m', np.nan)
    vix = raw_row.get('vix_close', np.nan)
    if pd.isna(fwd) or pd.isna(vix):
        continue
    rows.append({'pred': float(r['pred']), 'actual': float(fwd), 'vix': float(vix)})

preds   = np.array([r['pred']   for r in rows])
actuals = np.array([r['actual'] for r in rows])
vix_raw = np.array([r['vix']    for r in rows])
resid   = actuals - preds
N       = len(resid)

# Model parameters from model.json
var_a   = m['resid_var_a']
var_b   = m['resid_var_b']
var_fl  = m['resid_var_floor']
vz_mean = m['vix_z_mean']
vz_std  = m['vix_z_std']
vix_z   = (vix_raw - vz_mean) / vz_std

# Constant-sigma: MLE estimate = sqrt(mean squared residual)
const_var = float(np.mean(resid ** 2))
const_std = float(np.sqrt(const_var))

# VIX-conditional sigma from model.json params
cond_vars = np.maximum(var_fl, var_a + var_b * vix_z)
cond_stds = np.sqrt(cond_vars)

def loglik(resid_arr, sigma_arr):
    """Gaussian log-likelihood sum."""
    return float(np.sum(
        -0.5 * np.log(2 * np.pi)
        - np.log(sigma_arr)
        - 0.5 * (resid_arr / sigma_arr) ** 2
    ))

ll_const = loglik(resid, np.full(N, const_std))
ll_cond  = loglik(resid, cond_stds)
delta_ll = ll_cond - ll_const
cond_pct = (var_b / var_a) * 100

print(f"N OOS rows matched: {N}")
print(f"resid range: [{resid.min():.3f}, {resid.max():.3f}]")
print(f"vix_z range: [{vix_z.min():.2f}, {vix_z.max():.2f}]")
print()
print(f"Constant-sigma:        sigma = {const_std:.4f},  log-lik = {ll_const:.2f}")
print(f"VIX-conditional sigma: sigma in [{cond_stds.min():.4f}, {cond_stds.max():.4f}],  log-lik = {ll_cond:.2f}")
print(f"Delta logL (conditional - constant): {delta_ll:+.2f} nats")
print(f"Conditional component (var_b / var_a): {cond_pct:.1f}% of base variance")
print()
print("=" * 55)
if delta_ll < 1.0:
    print("RECOMMENDATION: SIMPLIFY to constant sigma")
    print(f"  Delta logL = {delta_ll:.2f} nats — negligible gain.")
    print("  Set resid_var_b = 0.0 in model.json.")
    print("  condResidStd() in scoring.ts already handles var_b=0 correctly.")
else:
    print("RECOMMENDATION: KEEP VIX-conditional sigma")
    print(f"  Delta logL = {delta_ll:.2f} nats — meaningful improvement.")
