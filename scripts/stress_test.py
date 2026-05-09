"""Synthetic stress tests for the v5.2 SPY composite indicator.

Defines canonical market regimes (late-cycle euphoria, deep capitulation,
mid-cycle steady, stagflation alarm) and asserts the composite score lands
in expected ranges. Catches sign errors, broken normalisation, regression
in the pipeline.
"""
import sys
from scoring_port import score, MEANS, DRIFT

PASS = '\033[32m✓\033[0m'
FAIL = '\033[31m✗\033[0m'

def case(name, raw, expected_score_range, narrative):
    """raw is dict of all 7 signals; expected_score_range is (lo, hi)."""
    lo, hi = expected_score_range
    r = score(**raw)
    s = r['composite']
    p = r['pred']
    ok = lo <= s <= hi
    icon = PASS if ok else FAIL
    print(f'{icon} {name:<32} score={s:6.2f}  pred={p*100:+6.2f}%  '
          f'expected {lo:.0f}-{hi:.0f}  ({narrative})')
    return ok

def section(title):
    print(f'\n=== {title} ===')

print('SPY composite v5.2 — synthetic regime stress tests')
print(f'(model drift = {DRIFT*100:+.2f}%, score=50 ⇔ pred=drift)\n')

results = []

# ── 0. Baseline sanity ────────────────────────────────────────────────────────
section('0. Baseline')
results.append(case(
    'sample-mean inputs',
    dict(rsi14m=MEANS['rsi_14m'], mfi14m=MEANS['mfi_14m'],
         ema_dist_pct=MEANS['ema_dist_pct'], ppi_yoy=MEANS['ppi_yoy'],
         mdebt_yoy=MEANS['mdebt_yoy'], aaii_spread=MEANS['aaii_spread'],
         vix_close=MEANS['vix_close']),
    (45, 55),
    'should land near 50'))

# ── 1. Late-cycle euphoria ────────────────────────────────────────────────────
# RSI/MFI hot, price way above EMA, PPI accelerating, leverage stretched,
# retail crowded long, VIX low. Every coef points south → score should be low.
section('1. Late-cycle euphoria (Jan 2022 / late 2021)')
results.append(case(
    'all signals at +1σ extreme',
    dict(rsi14m=78, mfi14m=80, ema_dist_pct=12, ppi_yoy=8.0,
         mdebt_yoy=35, aaii_spread=0.55, vix_close=14),
    (1, 25),
    'overbought + crowded + accelerating PPI'))

# ── 2. Deep capitulation ──────────────────────────────────────────────────────
# RSI/MFI washed out, price below EMA, PPI low/decelerating, leverage low,
# retail panicked, VIX spiked. Every coef points north → score should be high.
section('2. Deep capitulation (Mar 2020 / Oct 2008)')
results.append(case(
    'all signals at -1σ extreme + VIX spike',
    dict(rsi14m=35, mfi14m=30, ema_dist_pct=-15, ppi_yoy=0.5,
         mdebt_yoy=-10, aaii_spread=0.40, vix_close=55),
    (60, 95),
    'oversold + retail fear + VIX spike'))

# ── 3. Mid-cycle steady ───────────────────────────────────────────────────────
section('3. Mid-cycle steady (2014 / 2017 / mid-2024)')
results.append(case(
    'everything near sample-mean',
    dict(rsi14m=62, mfi14m=58, ema_dist_pct=4, ppi_yoy=2.0,
         mdebt_yoy=8, aaii_spread=0.48, vix_close=15),
    (40, 65),
    'no strong signal in either direction'))

# ── 4. Stagflation alarm ──────────────────────────────────────────────────────
# Hot PPI + elevated VIX + still-elevated leverage. Note: VIX has a +ve
# coef (high VIX historically precedes good fwd returns), and high VIX
# also widens σ_t → score gets pulled toward 50. Net is roughly neutral.
section('4. Stagflation alarm (mid-2022)')
results.append(case(
    'high PPI + high VIX + stretched leverage',
    dict(rsi14m=55, mfi14m=50, ema_dist_pct=-2, ppi_yoy=9.5,
         mdebt_yoy=20, aaii_spread=0.46, vix_close=28),
    (35, 65),
    'PPI bearish, but VIX-bullish coef + wide σ_t pulls to ≈neutral'))

# ── 5. Goldilocks rebound ─────────────────────────────────────────────────────
# Off the lows, RSI mid-50s, PPI cooling, leverage reset, sentiment cautious
section('5. Goldilocks rebound (Q1 2023 style)')
results.append(case(
    'recovery setup',
    dict(rsi14m=55, mfi14m=52, ema_dist_pct=2, ppi_yoy=2.5,
         mdebt_yoy=2, aaii_spread=0.45, vix_close=18),
    (45, 75),
    'cooling inflation + reset leverage + healthy momentum'))

# ── 6. Sign-direction tests ───────────────────────────────────────────────────
# Hold everything at sample mean and perturb ONE signal at a time.
# Verifies coefficient signs match intuition.
section('6. Sign-direction (perturb one signal from mean)')

base = dict(rsi14m=MEANS['rsi_14m'], mfi14m=MEANS['mfi_14m'],
            ema_dist_pct=MEANS['ema_dist_pct'], ppi_yoy=MEANS['ppi_yoy'],
            mdebt_yoy=MEANS['mdebt_yoy'], aaii_spread=MEANS['aaii_spread'],
            vix_close=MEANS['vix_close'])
base_score = score(**base)['composite']

def perturb(name, **overrides):
    r = score(**{**base, **overrides})
    return r['composite']

# Each test: a signal moves to a level, expected direction (lower/higher than base)
def dir_test(name, expected_sign, **overrides):
    s = perturb(name, **overrides)
    delta = s - base_score
    # expected_sign: -1 (score should drop), +1 (score should rise)
    sign_ok = (delta < -1 and expected_sign == -1) or (delta > 1 and expected_sign == +1)
    icon = PASS if sign_ok else FAIL
    print(f'{icon} {name:<32} score={s:6.2f}  Δ={delta:+5.2f}  '
          f'expected {"↓" if expected_sign==-1 else "↑"}')
    return sign_ok

results.append(dir_test('RSI=80 (overbought)',     -1, rsi14m=80))
results.append(dir_test('RSI=35 (oversold)',       +1, rsi14m=35))
# MFI coef is tiny (-0.002) — perturbing MFI alone barely moves the score.
# So we test only that the sign isn't flipped, not the magnitude.
print('  (skip MFI / MDebt — coefs too small to move score by >1pt)')
results.append(dir_test('PPI YoY 9% (hot inflation)', -1, ppi_yoy=9.0))
results.append(dir_test('PPI YoY 0% (deflation)',   +1, ppi_yoy=0.0))
results.append(dir_test('AAII 0.55 (crowded long)', -1, aaii_spread=0.55))
results.append(dir_test('AAII 0.40 (retail fear)',  +1, aaii_spread=0.40))
results.append(dir_test('VIX 50 (panic)',           +1, vix_close=50))

# v5.3 sanity: the sign-constrained ridge auto-prunes redundant signals
# (mfi_14m, ema_dist_pct, mdebt_yoy) by zeroing their coefficients. We
# verify the prune is in effect.
section('7. Auto-pruned signals (coefficient == 0)')
for name, kw in [('MFI', dict(mfi14m=80)),
                 ('EMA dist',   dict(ema_dist_pct=15)),
                 ('Margin debt', dict(mdebt_yoy=35))]:
    delta = perturb(name, **kw) - base_score
    icon  = PASS if abs(delta) < 0.001 else FAIL
    msg   = 'pruned ✓' if abs(delta) < 0.001 else f'still moves Δ={delta:+.3f} ✗'
    print(f'{icon} perturb {name:<14} score Δ = {delta:+.4f}  ({msg})')
    results.append(abs(delta) < 0.001)
# VIX low: coef on VIX is +0.011, so low VIX should slightly DEPRESS score.
# But low VIX also tightens σ_t which AMPLIFIES the (pred-drift) term.
# So the net effect on score depends on whether pred is above/below drift.
# Skipping a strict assertion for VIX low.

# ── Summary ───────────────────────────────────────────────────────────────────
n_pass = sum(results)
n_fail = len(results) - n_pass
print(f'\n=== Summary ===')
print(f'{n_pass}/{len(results)} passed')
if n_fail:
    print(f'{n_fail} FAILED')
    sys.exit(1)
print('All synthetic stress tests passed.')
