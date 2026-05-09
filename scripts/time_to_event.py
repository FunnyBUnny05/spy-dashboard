"""For each historical OOS score, measure the time (in months) until SPY
either drew down or rallied by a given threshold from the entry price.

Reports, per score bucket:
  • mean / median months until a drawdown of 5%, 10%, 15%
  • mean / median months until a rally of 5%, 10%, 20%
  • % of cases where the drawdown event never occurred within the lookahead

This is descriptive (not a forecast). It tells you "historically, when score
was X, the next 5% drawdown took Y months on average." Combined with the
quintile mean fwd-12m return, it adds time-horizon context to the score.
"""
import json
import numpy as np
import pandas as pd
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
m = json.loads((ROOT / 'src/data/model.json').read_text())

# Build full SPY timeseries (continuous, including non-OOS rows)
ts = m['timeseries']
spy_series = [(r['d'], r['spy']) for r in ts]
spy_series.sort()
ymonths = [d for d, _ in spy_series]
spy_arr = np.array([s for _, s in spy_series])
ym_index = {d: i for i, d in enumerate(ymonths)}

# Score history (OOS only — those are honest walk-forward predictions)
oos = [r for r in ts if r.get('in_sample') is False and r.get('score') is not None]

LOOKAHEAD = 36  # months
DD_THRESHOLDS    = [0.05, 0.10, 0.15]
RALLY_THRESHOLDS = [0.05, 0.10, 0.20]

def first_event(start_idx, threshold, direction):
    """Find first month at start_idx+1..start_idx+LOOKAHEAD where
    SPY moves by `threshold` in `direction` ('down' or 'up').
    Returns months_until or None if never within lookahead.

    direction='down' looks for SPY drawdown from the running peak since entry,
    so a +5% rise then -5% from peak counts as a 5% drawdown (not from entry).
    direction='up'   looks for SPY rally from entry price (cumulative, simple).
    """
    end = min(start_idx + LOOKAHEAD, len(spy_arr) - 1)
    entry = spy_arr[start_idx]
    if direction == 'up':
        target = entry * (1 + threshold)
        for j in range(start_idx + 1, end + 1):
            if spy_arr[j] >= target:
                return j - start_idx
        return None
    else:
        # Drawdown from running peak (more intuitive for "next correction")
        peak = entry
        for j in range(start_idx + 1, end + 1):
            if spy_arr[j] > peak:
                peak = spy_arr[j]
            if spy_arr[j] <= peak * (1 - threshold):
                return j - start_idx
        return None

# Bucket each OOS row
def bucket(score):
    return min(4, int(score // 20))   # 0..4 corresponds to Q1..Q5

bins = defaultdict(list)
for r in oos:
    if r['d'] not in ym_index:
        continue
    idx = ym_index[r['d']]
    rec = {'score': r['score'], 'd': r['d']}
    for th in DD_THRESHOLDS:
        rec[f'dd_{int(th*100)}'] = first_event(idx, th, 'down')
    for th in RALLY_THRESHOLDS:
        rec[f'up_{int(th*100)}'] = first_event(idx, th, 'up')
    bins[bucket(r['score'])].append(rec)

# ── Report ──
labels = ['Q1 (0–20)', 'Q2 (20–40)', 'Q3 (40–60)', 'Q4 (60–80)', 'Q5 (80–100)']
print(f'\nTime-to-event by score quintile (lookahead = {LOOKAHEAD} months)\n')

# Drawdowns
print('▼ DRAWDOWN — months until SPY falls X% from running peak\n')
print(f'  {"bucket":<14} {"n":>4}  ' +
      '  '.join(f'{"-"+str(int(t*100))+"%":>15}' for t in DD_THRESHOLDS))
print(f'  {"":<14} {"":>4}  ' +
      '  '.join(f'{"med (mean) %nev":>15}' for _ in DD_THRESHOLDS))
for q, lab in enumerate(labels):
    rows = bins.get(q, [])
    if not rows:
        print(f'  {lab:<14} {0:>4}  (no observations)')
        continue
    cells = []
    for th in DD_THRESHOLDS:
        vals = [r[f'dd_{int(th*100)}'] for r in rows]
        observed = [v for v in vals if v is not None]
        never_pct = 100 * (len(vals) - len(observed)) / len(vals)
        if observed:
            med = float(np.median(observed))
            mean = float(np.mean(observed))
            cells.append(f'{med:>4.0f} ({mean:>4.1f}) {never_pct:>3.0f}%')
        else:
            cells.append(f'   (never within {LOOKAHEAD}m)')
    print(f'  {lab:<14} {len(rows):>4}  ' + '  '.join(f'{c:>15}' for c in cells))

# Rallies
print('\n▲ RALLY — months until SPY rises X% from entry\n')
print(f'  {"bucket":<14} {"n":>4}  ' +
      '  '.join(f'{"+"+str(int(t*100))+"%":>15}' for t in RALLY_THRESHOLDS))
print(f'  {"":<14} {"":>4}  ' +
      '  '.join(f'{"med (mean) %nev":>15}' for _ in RALLY_THRESHOLDS))
for q, lab in enumerate(labels):
    rows = bins.get(q, [])
    if not rows: continue
    cells = []
    for th in RALLY_THRESHOLDS:
        vals = [r[f'up_{int(th*100)}'] for r in rows]
        observed = [v for v in vals if v is not None]
        never_pct = 100 * (len(vals) - len(observed)) / len(vals)
        if observed:
            med = float(np.median(observed))
            mean = float(np.mean(observed))
            cells.append(f'{med:>4.0f} ({mean:>4.1f}) {never_pct:>3.0f}%')
        else:
            cells.append(f'   (never within {LOOKAHEAD}m)')
    print(f'  {lab:<14} {len(rows):>4}  ' + '  '.join(f'{c:>15}' for c in cells))

# Compact "headline" table for adding to UI
print('\n\nHEADLINE summary (for UI):')
print(f'  {"bucket":<14}  {"med m to -10%":>14}  {"med m to +10%":>14}  '
      f'{"% never -10%":>14}  {"% never +10%":>14}')
for q, lab in enumerate(labels):
    rows = bins.get(q, [])
    if not rows:
        print(f'  {lab:<14}  (none)')
        continue
    dd10 = [r['dd_10'] for r in rows if r['dd_10'] is not None]
    up10 = [r['up_10'] for r in rows if r['up_10'] is not None]
    n_dd_never = sum(1 for r in rows if r['dd_10'] is None)
    n_up_never = sum(1 for r in rows if r['up_10'] is None)
    med_dd = f'{int(np.median(dd10)):>3}m' if dd10 else 'n/a'
    med_up = f'{int(np.median(up10)):>3}m' if up10 else 'n/a'
    print(f'  {lab:<14}  {med_dd:>14}  {med_up:>14}  '
          f'{100*n_dd_never/len(rows):>13.0f}%  {100*n_up_never/len(rows):>13.0f}%')

# Also save as JSON for the UI to consume
out = {
    'lookahead_months': LOOKAHEAD,
    'dd_thresholds': DD_THRESHOLDS,
    'rally_thresholds': RALLY_THRESHOLDS,
    'buckets': []
}
for q, lab in enumerate(labels):
    rows = bins.get(q, [])
    bucket_data = {
        'label': lab, 'lo': q*20, 'hi': (q+1)*20, 'n': len(rows),
        'dd': {}, 'rally': {},
    }
    for th in DD_THRESHOLDS:
        vals = [r[f'dd_{int(th*100)}'] for r in rows]
        observed = [v for v in vals if v is not None]
        bucket_data['dd'][f'{int(th*100)}'] = {
            'median': float(np.median(observed)) if observed else None,
            'mean':   float(np.mean(observed))   if observed else None,
            'pct_never': float(100 * (len(vals) - len(observed)) / len(vals))
                         if vals else None,
            'n_observed': len(observed),
        }
    for th in RALLY_THRESHOLDS:
        vals = [r[f'up_{int(th*100)}'] for r in rows]
        observed = [v for v in vals if v is not None]
        bucket_data['rally'][f'{int(th*100)}'] = {
            'median': float(np.median(observed)) if observed else None,
            'mean':   float(np.mean(observed))   if observed else None,
            'pct_never': float(100 * (len(vals) - len(observed)) / len(vals))
                         if vals else None,
            'n_observed': len(observed),
        }
    out['buckets'].append(bucket_data)

(ROOT / 'src/data/time_to_event.json').write_text(json.dumps(out, separators=(',', ':')))
print(f"\n✅ src/data/time_to_event.json written.")
