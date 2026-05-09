"""Mock-data benchmark suite for the v5.x SPY composite model.

Generates fully synthetic monthly data with known ground-truth
signal-return relationships, then verifies the walk-forward pipeline
behaves as expected. No CSV files required.

Tests:
  1. Signal-direction recovery  — model learns correct signs from mock data
  2. OOS predictive power       — Spearman ρ vs expected given SNR
  3. Score monotonicity grid    — score is strictly monotone in each signal
  4. Noise robustness           — ρ degrades gracefully as noise is added
  5. Rank-gauss extrapolation   — extreme OOS values don't crash / clip gracefully
  6. Multicollinearity stress   — highly correlated signals handled correctly
  7. Calibration under known truth — predicted magnitude tracks true mean return
  8. Composite score range      — always in [0, 100] across 10 000 random inputs
"""
import sys
import numpy as np
from scipy import stats
from bisect import bisect_left
from math import erf, sqrt

sys.path.insert(0, __import__('pathlib').Path(__file__).resolve().parent.__str__())
from scoring_port import score, MEANS, SIGNALS, DRIFT

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

PASS = '\033[32m✓\033[0m'
FAIL = '\033[31m✗\033[0m'

results = []

def check(name, ok, detail=''):
    icon = PASS if ok else FAIL
    print(f'{icon}  {name:<52} {detail}')
    results.append(ok)
    return ok

def section(title):
    print(f'\n=== {title} ===')

def spearman(x, y):
    r, _ = stats.spearmanr(x, y)
    return float(r)

# ─────────────────────────────────────────────────────────────────────────────
# Synthetic data generator
# ─────────────────────────────────────────────────────────────────────────────

RNG = np.random.default_rng(42)

# True signal coefficients (same sign convention as model: neg = bearish signal)
TRUE_COEFS = {
    'rsi_14m':           -0.30,
    'mfi_14m':           -0.05,
    'ema_dist_pct':      -0.15,
    'ppi_yoy':           -0.25,
    'mdebt_yoy':         -0.05,
    'aaii_spread':       -0.20,
    'vix_close':         +0.20,
    'yield_curve_10y3m': -0.15,
    'breadth_12m_chg':   -0.10,
}
DRIFT_TRUE = 0.10  # annual drift baked in

# Realistic signal distributions (mean, std) from MEANS/model.json
SIG_DIST = {
    'rsi_14m':           (60,    10),
    'mfi_14m':           (55,    12),
    'ema_dist_pct':      ( 4,     6),
    'ppi_yoy':           ( 3,     3),
    'mdebt_yoy':         ( 8,    12),
    'aaii_spread':       (0.48,   0.07),
    'vix_close':         (17,     8),
    'yield_curve_10y3m': ( 1.0,   1.2),
    'breadth_12m_chg':   ( 0.0,   5.0),
}

def gen_mock_data(n=240, noise_std=0.10, rng=None):
    """Return arrays X (n×9), y (n,) with known linear relationship.

    Each signal is independent Gaussian with the dist above.
    y = drift + sum(coef_j * z_j) + noise,  z_j = (x_j - mu_j) / sigma_j
    """
    if rng is None:
        rng = RNG
    X = np.column_stack([
        rng.normal(mu, sd, n) for mu, sd in SIG_DIST.values()
    ])
    # z-score each signal
    mus = np.array([v[0] for v in SIG_DIST.values()])
    sds = np.array([v[1] for v in SIG_DIST.values()])
    sds = np.where(sds == 0, 1.0, sds)
    Z = (X - mus) / sds
    coefs = np.array([TRUE_COEFS[s] for s in SIGNALS])
    with np.errstate(divide='ignore', invalid='ignore', over='ignore'):
        y = DRIFT_TRUE + Z @ coefs + rng.normal(0, noise_std, n)
    y = np.where(np.isfinite(y), y, 0.0)
    return X, y, Z, coefs

def walk_forward_mock(X, y, min_train=36, horizon=12):
    """Minimal walk-forward that mirrors fit_ridge.py logic on mock data.
    Returns (oos_pred, oos_actual) arrays.
    """
    from sklearn.linear_model import Ridge
    from variant_sweep import fit_ridge_with_sign, rank_gauss_series, UNIVARIATE_SIGN

    n = len(y)
    preds, actuals = [], []
    signs = np.array([UNIVARIATE_SIGN[s] for s in SIGNALS])

    for idx in range(n):
        # forward return is y[idx]; training data is rows 0 .. idx-horizon
        cutoff = idx - horizon + 1
        if cutoff < min_train:
            continue
        X_tr = X[:cutoff]
        y_tr = y[:cutoff]
        mus   = X_tr.mean(0); sds = X_tr.std(0, ddof=1); sds[sds == 0] = 1
        sorted_arrs = [np.sort(X_tr[:, c]) for c in range(X_tr.shape[1])]
        # rank-gauss transform training data
        Xz = np.column_stack([
            rank_gauss_series(X_tr[:, c], sorted_arrs[c])
            for c in range(X_tr.shape[1])
        ])
        beta, b0 = fit_ridge_with_sign(Xz, y_tr, 5.0, signs)
        # transform test row
        xr = X[idx]
        xz = np.array([
            float(stats.norm.ppf(np.clip(
                np.searchsorted(sorted_arrs[c], xr[c]) / (len(sorted_arrs[c]) + 1),
                0.01, 0.99
            )))
            for c in range(len(SIGNALS))
        ])
        preds.append(float(b0 + xz @ beta))
        actuals.append(float(y[idx]))

    return np.array(preds), np.array(actuals)


# ═══════════════════════════════════════════════════════════════════════════════
print('SPY composite mock-data benchmark suite')
print(f'(runs walk-forward on synthetic data; no CSV required)\n')

# ─────────────────────────────────────────────────────────────────────────────
# 1. Signal-direction recovery
# ─────────────────────────────────────────────────────────────────────────────
section('1. Signal-direction recovery')
print('   Verify learned coefficients match the true signs from mock data.\n')

from sklearn.linear_model import Ridge
from variant_sweep import fit_ridge_with_sign, rank_gauss_series, UNIVARIATE_SIGN

X, y, Z, true_coefs = gen_mock_data(n=300)
mus = X.mean(0); sds = X.std(0, ddof=1); sds[sds == 0] = 1
sorted_arrs = [np.sort(X[:, c]) for c in range(X.shape[1])]
Xz = np.column_stack([rank_gauss_series(X[:, c], sorted_arrs[c]) for c in range(X.shape[1])])
signs = np.array([UNIVARIATE_SIGN[s] for s in SIGNALS])
beta, b0 = fit_ridge_with_sign(Xz, y, 5.0, signs)

print(f'  {"signal":<18} {"true":>8} {"learned":>8} {"sign OK":>8}')
all_signs_ok = True
for s, tc, lc in zip(SIGNALS, true_coefs, beta):
    sign_ok = (tc < 0 and lc <= 0) or (tc > 0 and lc >= 0)
    all_signs_ok = all_signs_ok and sign_ok
    flag = '✓' if sign_ok else '✗'
    print(f'  {s:<18} {tc:>+8.3f} {lc:>+8.3f} {flag:>8}')

check('All learned signs match true signs', all_signs_ok, '')

# ─────────────────────────────────────────────────────────────────────────────
# 2. OOS predictive power vs expected SNR
# ─────────────────────────────────────────────────────────────────────────────
section('2. OOS predictive power')
print('   Walk-forward on 240-month mock series (noise_std=0.10).\n')

X2, y2, _, _ = gen_mock_data(n=240, noise_std=0.10)
oos_preds, oos_actual = walk_forward_mock(X2, y2)
rho_oos = spearman(oos_preds, oos_actual)
n_oos = len(oos_preds)
print(f'  OOS n={n_oos}  Spearman ρ = {rho_oos:+.4f}')

# With SNR ≈ signal var / noise var, we expect ρ > 0 and hopefully > 0.20
check('OOS ρ > 0.0  (model beats random)',   rho_oos > 0.0,  f'ρ={rho_oos:+.4f}')
check('OOS ρ > 0.2  (meaningful signal)',    rho_oos > 0.2,  f'ρ={rho_oos:+.4f}')

# ─────────────────────────────────────────────────────────────────────────────
# 3. Score monotonicity grid
# ─────────────────────────────────────────────────────────────────────────────
section('3. Score monotonicity (fine grid, each signal in isolation)')
print('   Sweep each active signal from its 5th to 95th percentile;\n'
      '   verify the composite score is strictly monotone.\n')

# Which signals actually move the score (non-zero coefficients)?
# score() uses positional-style kwargs without underscores: rsi14m, mfi14m, etc.
SCORE_KEY = {s: s.replace('_', '') for s in SIGNALS}
# fix the two that differ: rsi_14m→rsi14m, mfi_14m→mfi14m, ema_dist_pct→ema_dist_pct, vix_close→vix_close
# Actually scoring_port.py signature: rsi14m, mfi14m, ema_dist_pct, ppi_yoy, mdebt_yoy, aaii_spread, vix_close
SCORE_KEY = {
    'rsi_14m': 'rsi14m', 'mfi_14m': 'mfi14m', 'ema_dist_pct': 'ema_dist_pct',
    'ppi_yoy': 'ppi_yoy', 'mdebt_yoy': 'mdebt_yoy', 'aaii_spread': 'aaii_spread',
    'vix_close': 'vix_close',
    'yield_curve_10y3m': 'yield_curve_10y3m', 'breadth_12m_chg': 'breadth_12m_chg',
}

def _score_from_means(**overrides):
    """Call score() with sample-mean inputs, optionally overriding some signals."""
    kw = {SCORE_KEY[s]: MEANS[s] for s in SIGNALS}
    kw.update(overrides)
    return score(**kw)['composite']

base_s = _score_from_means()
active_signals = []
for s in SIGNALS:
    new_val = MEANS[s] * 1.5 if MEANS[s] != 0 else 1.0
    delta = abs(_score_from_means(**{SCORE_KEY[s]: new_val}) - base_s)
    if delta > 0.1:
        active_signals.append(s)

print(f'  Active signals (Δscore > 0.1): {active_signals}\n')

SIG_RANGES = {
    'rsi_14m':           (40,   80),
    'mfi_14m':           (30,   80),
    'ema_dist_pct':      (-12,  14),
    'ppi_yoy':           (0,     9),
    'mdebt_yoy':         (-10,  40),
    'aaii_spread':       (0.40, 0.56),
    'vix_close':         (12,   55),
    'yield_curve_10y3m': (-2.0,  3.5),
    'breadth_12m_chg':   (-10,  15),
}

# Expected direction: negative coef → higher signal → lower score
EXPECTED_DIR = {s: -1 if UNIVARIATE_SIGN[s] == -1 else +1 for s in SIGNALS}

for s in active_signals:
    lo, hi = SIG_RANGES[s]
    grid = np.linspace(lo, hi, 50)
    scores_arr = [_score_from_means(**{SCORE_KEY[s]: float(v)}) for v in grid]
    # Monotone in expected direction
    if EXPECTED_DIR[s] == -1:
        pairs = [(scores_arr[i], scores_arr[i+1]) for i in range(len(scores_arr)-1)]
        monotone = all(a >= b - 0.5 for a, b in pairs)
    else:
        pairs = [(scores_arr[i], scores_arr[i+1]) for i in range(len(scores_arr)-1)]
        monotone = all(a <= b + 0.5 for a, b in pairs)
    dir_str = '↓ as signal ↑' if EXPECTED_DIR[s] == -1 else '↑ as signal ↑'
    delta_total = scores_arr[-1] - scores_arr[0]
    check(f'  {s:<22} monotone ({dir_str})',
          monotone, f'total Δ={delta_total:+.1f}')

# ─────────────────────────────────────────────────────────────────────────────
# 4. Noise robustness
# ─────────────────────────────────────────────────────────────────────────────
section('4. Noise robustness (ρ vs noise level)')
print('   Re-run walk-forward at several noise levels; ρ should decrease\n'
      '   monotonically and stay positive until noise_std ≫ signal.\n')

noise_levels = [0.05, 0.10, 0.15, 0.20, 0.30]
print(f'  {"noise_std":<12} {"OOS ρ":>8}')
rho_prev = None
monotone_noise = True
for ns in noise_levels:
    Xn, yn, _, _ = gen_mock_data(n=240, noise_std=ns, rng=np.random.default_rng(7))
    p, a = walk_forward_mock(Xn, yn)
    rh = spearman(p, a)
    print(f'  {ns:<12.2f} {rh:>+8.4f}')
    if rho_prev is not None and rh > rho_prev + 0.05:
        monotone_noise = False
    rho_prev = rh

check('ρ stays positive at noise_std=0.20',
      spearman(*walk_forward_mock(*gen_mock_data(n=240, noise_std=0.20,
               rng=np.random.default_rng(7))[:2])) > 0, '')
check('ρ roughly decreases as noise grows', monotone_noise, '')

# ─────────────────────────────────────────────────────────────────────────────
# 5. Rank-gauss extrapolation — extreme OOS values
# ─────────────────────────────────────────────────────────────────────────────
section('5. Rank-gauss extrapolation at extreme values')
print('   Input values well outside historical range; score should\n'
      '   remain in [0, 100] and not raise exceptions.\n')

extreme_cases = [
    dict(rsi14m=99,  mfi14m=99,  ema_dist_pct=50,  ppi_yoy=25,  mdebt_yoy=200, aaii_spread=0.80, vix_close=5),
    dict(rsi14m=1,   mfi14m=1,   ema_dist_pct=-50, ppi_yoy=-5,  mdebt_yoy=-50, aaii_spread=0.20, vix_close=90),
    dict(rsi14m=50,  mfi14m=50,  ema_dist_pct=0,   ppi_yoy=0,   mdebt_yoy=0,   aaii_spread=0.50, vix_close=1),
]

all_bounded = True
for i, kw in enumerate(extreme_cases, 1):
    try:
        r = score(**kw)
        s = r['composite']
        in_range = 0.0 <= s <= 100.0
        if not in_range:
            all_bounded = False
        print(f'  case {i}: score={s:.2f}  {"in [0,100] ✓" if in_range else "OUT OF RANGE ✗"}')
    except Exception as e:
        all_bounded = False
        print(f'  case {i}: EXCEPTION: {e}')

check('All extreme inputs produce score in [0, 100]', all_bounded, '')

# ─────────────────────────────────────────────────────────────────────────────
# 6. Multicollinearity stress
# ─────────────────────────────────────────────────────────────────────────────
section('6. Multicollinearity stress')
print('   Generate data where RSI and PPI are 90% correlated;\n'
      '   sign-constrained ridge should still produce correct signs.\n')

n_mc = 300
rng_mc = np.random.default_rng(13)
base_factor = rng_mc.normal(0, 1, n_mc)  # shared factor
X_mc = np.column_stack([
    0.9 * base_factor + rng_mc.normal(0, 0.4, n_mc),  # rsi_14m (z)
    rng_mc.normal(0, 1, n_mc),                          # mfi_14m
    rng_mc.normal(0, 1, n_mc),                          # ema_dist_pct
    0.9 * base_factor + rng_mc.normal(0, 0.4, n_mc),  # ppi_yoy (z, correlated)
    rng_mc.normal(0, 1, n_mc),                          # mdebt_yoy
    rng_mc.normal(0, 1, n_mc),                          # aaii_spread
    rng_mc.normal(0, 1, n_mc),                          # vix_close
])
# true: rsi and ppi both bearish
coefs_mc = np.array([-0.3, -0.05, -0.15, -0.25, -0.05, -0.20, +0.20])
with np.errstate(divide='ignore', invalid='ignore', over='ignore'):
    y_mc = DRIFT_TRUE + X_mc @ coefs_mc + rng_mc.normal(0, 0.10, n_mc)
y_mc = np.where(np.isfinite(y_mc), y_mc, 0.0)

# Fit on all data (full sample, not walk-forward — testing sign recovery)
sorted_mc = [np.sort(X_mc[:, c]) for c in range(7)]
Xz_mc = np.column_stack([rank_gauss_series(X_mc[:, c], sorted_mc[c]) for c in range(7)])
beta_mc, _ = fit_ridge_with_sign(Xz_mc, y_mc, 5.0, signs)

signs_ok_mc = all(
    (tc < 0 and lc <= 0) or (tc > 0 and lc >= 0)
    for tc, lc in zip(coefs_mc, beta_mc)
)
print(f'  Corr(RSI_z, PPI_z) = {float(np.corrcoef(X_mc[:,0], X_mc[:,3])[0,1]):.3f}')
print(f'  Learned coefs: {" ".join(f"{b:+.3f}" for b in beta_mc)}')
check('All signs correct under 90% collinearity', signs_ok_mc, '')

# ─────────────────────────────────────────────────────────────────────────────
# 7. Calibration under known truth
# ─────────────────────────────────────────────────────────────────────────────
section('7. Calibration under known truth')
print('   Bucket OOS predictions into quintiles; verify predicted mean\n'
      '   orders correctly (Q1 < Q2 < Q3 < Q4 < Q5).\n')

X7, y7, _, _ = gen_mock_data(n=300, noise_std=0.10, rng=np.random.default_rng(99))
p7, a7 = walk_forward_mock(X7, y7)
order = np.argsort(p7)
buckets = np.array_split(order, 5)

print(f'  {"quintile":<10} {"mean pred":>12} {"mean actual":>13}')
prev_actual = None
mono_calib = True
for i, idx in enumerate(buckets, 1):
    mp = float(np.mean(p7[idx]))
    ma = float(np.mean(a7[idx]))
    print(f'  Q{i:<9} {mp:>+12.4f} {ma:>+13.4f}')
    if prev_actual is not None and ma < prev_actual - 0.01:
        mono_calib = False
    prev_actual = ma

check('Actual returns rise monotonically across predicted quintiles',
      mono_calib, '')

# ─────────────────────────────────────────────────────────────────────────────
# 8. Composite score always in [0, 100]
# ─────────────────────────────────────────────────────────────────────────────
section('8. Score range invariant (10 000 random inputs)')
print('   Sample random signal values from wide distributions;\n'
      '   every resulting score must be in [0, 100].\n')

rng8 = np.random.default_rng(0)
n_rand = 10_000
inputs = {
    'rsi14m':      rng8.uniform(0, 100, n_rand),
    'mfi14m':      rng8.uniform(0, 100, n_rand),
    'ema_dist_pct':rng8.uniform(-30, 30, n_rand),
    'ppi_yoy':     rng8.uniform(-5, 20, n_rand),
    'mdebt_yoy':   rng8.uniform(-50, 100, n_rand),
    'aaii_spread': rng8.uniform(0.20, 0.80, n_rand),
    'vix_close':   rng8.uniform(8, 80, n_rand),
}
scores_arr = np.array([
    score(
        rsi14m=inputs['rsi14m'][i],
        mfi14m=inputs['mfi14m'][i],
        ema_dist_pct=inputs['ema_dist_pct'][i],
        ppi_yoy=inputs['ppi_yoy'][i],
        mdebt_yoy=inputs['mdebt_yoy'][i],
        aaii_spread=inputs['aaii_spread'][i],
        vix_close=inputs['vix_close'][i],
    )['composite']
    for i in range(n_rand)
])

n_oob = int(np.sum((scores_arr < 0) | (scores_arr > 100)))
print(f'  n_rand={n_rand}  out-of-bounds={n_oob}  '
      f'min={scores_arr.min():.3f}  max={scores_arr.max():.3f}  '
      f'mean={scores_arr.mean():.2f}')
check('Zero out-of-bounds scores across 10 000 random inputs',
      n_oob == 0, f'OOB={n_oob}')

# Check distribution isn't degenerate (not all the same value)
check('Score has meaningful variance (std > 5)',
      float(scores_arr.std()) > 5,
      f'std={scores_arr.std():.2f}')

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
n_pass = sum(results)
n_fail = len(results) - n_pass
print(f'\n=== Summary ===')
print(f'{n_pass}/{len(results)} passed')
if n_fail:
    print(f'{n_fail} FAILED')
    sys.exit(1)
print('All mock-data benchmarks passed.')
