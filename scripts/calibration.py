"""Calibration check on the v5.2 walk-forward predictions in model.json.

For each OOS row, compute the realised 12m forward SPY return and compare
against the predicted return / composite score. Reports:
  - Spearman ρ, Pearson r, MAE
  - Decile bucket table: predicted-score range -> realised mean / hit rate / n
  - Monotonicity check
"""
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
m = json.loads((ROOT / 'src/data/model.json').read_text())
ts = m['timeseries']

# Build a date->spy lookup so we can find the SPY price 12 months later.
by_date = {r['d']: r['spy'] for r in ts}
def fwd12(d, spy):
    y, mo = d.split('-')
    fy, fm = int(y) + 1, int(mo)
    fwd_d = f'{fy}-{fm:02d}'
    fwd_spy = by_date.get(fwd_d)
    if fwd_spy is None:
        return None
    return fwd_spy / spy - 1

oos = [r for r in ts if r.get('in_sample') is False]
rows = []
for r in oos:
    fwd = fwd12(r['d'], r['spy'])
    if fwd is None:
        continue
    rows.append({
        'd':     r['d'],
        'pred':  r['pred'],     # predicted 12m return
        'score': r['score'],    # composite 0..100
        'fwd':   fwd,           # realised 12m return
    })

n = len(rows)
print(f'Rows with realised forward returns: {n}/{len(oos)}')
if n == 0:
    raise SystemExit('No realised rows.')

preds  = np.array([r['pred']  for r in rows])
scores = np.array([r['score'] for r in rows])
fwds   = np.array([r['fwd']   for r in rows])

def spearman(x, y):
    rx = np.argsort(np.argsort(x))
    ry = np.argsort(np.argsort(y))
    return float(np.corrcoef(rx, ry)[0,1])

print('\n=== Aggregate metrics (realised-only) ===')
print(f'Spearman ρ (pred vs fwd):  {spearman(preds, fwds):+.4f}')
print(f'Spearman ρ (score vs fwd): {spearman(scores, fwds):+.4f}')
print(f'Pearson  r (pred vs fwd):  {float(np.corrcoef(preds, fwds)[0,1]):+.4f}')
print(f'MAE      |pred - fwd|:     {float(np.mean(np.abs(preds - fwds))):.4f}')
print(f'Bias     mean(pred - fwd): {float(np.mean(preds - fwds)):+.4f}')
print(f'Realised mean fwd return:  {float(np.mean(fwds)):+.4f}')
print(f'Realised std  fwd return:  {float(np.std(fwds)):+.4f}')

print('\n=== Decile buckets by predicted score ===')
print(f'{"bucket":<10}{"score range":<20}{"n":<5}{"mean fwd":<12}{"median fwd":<12}{"hit rate":<10}{"mean pred":<12}')
order = np.argsort(scores)
buckets = np.array_split(order, 10)
prev_mean = None
mono = True
for i, idx in enumerate(buckets, 1):
    s_range = f'{scores[idx].min():.1f}-{scores[idx].max():.1f}'
    nb      = len(idx)
    fmean   = float(np.mean(fwds[idx]))
    fmed    = float(np.median(fwds[idx]))
    hit     = float(np.mean(fwds[idx] > 0))
    pmean   = float(np.mean(preds[idx]))
    print(f'D{i:<9}{s_range:<20}{nb:<5}{fmean:+.4f}     {fmed:+.4f}     {hit:.2%}     {pmean:+.4f}')
    if prev_mean is not None and fmean < prev_mean - 0.005:  # tolerate 0.5pp wobble
        mono = False
    prev_mean = fmean

print(f'\nDecile monotonicity (fwd mean rises with score): {"YES" if mono else "NO"}')
print(f'D1 vs D10 fwd-mean spread: {float(np.mean(fwds[buckets[-1]]) - np.mean(fwds[buckets[0]])):+.4f}')

# Quintile buckets to match the in-app BucketsPanel
print('\n=== Quintile buckets (matches app) ===')
print(f'{"bucket":<10}{"score range":<20}{"n":<5}{"mean fwd":<12}{"hit rate":<10}')
quints = np.array_split(order, 5)
for i, idx in enumerate(quints, 1):
    s_range = f'{scores[idx].min():.1f}-{scores[idx].max():.1f}'
    print(f'Q{i:<9}{s_range:<20}{len(idx):<5}{float(np.mean(fwds[idx])):+.4f}     {float(np.mean(fwds[idx]>0)):.2%}')

# Sign-correctness: does score say "above 50" → positive return more often?
print('\n=== Sign agreement (score > 50 ↔ fwd > drift) ===')
drift = float(np.mean(fwds))
above = scores > 50
beat  = fwds  > drift
agree = (above == beat).mean()
print(f'Agreement rate: {agree:.2%} (50% = coin flip)')
print(f'Above-50 (n={above.sum()}): mean fwd {float(np.mean(fwds[above])):+.4f}')
print(f'Below-50 (n={(~above).sum()}): mean fwd {float(np.mean(fwds[~above])):+.4f}')
