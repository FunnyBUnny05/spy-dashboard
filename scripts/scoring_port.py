"""Python port of src/lib/scoring.ts so we can stress-test the pipeline
without spinning up the React app. Mirrors v5.2 exactly:

  rank-Gauss every signal → ridge predict → norm.cdf((pred - drift) / σ_t) × 100
"""
import json
from bisect import bisect_left
from math import erf, sqrt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = json.loads((ROOT / 'src/data/model.json').read_text())

SIGNALS         = MODEL['signals']
MEANS           = MODEL['means']
STDS            = MODEL['stds']
RIDGE_COEFS     = MODEL['ridge_coefs']
RIDGE_INT       = MODEL['ridge_intercept']
DRIFT           = MODEL['drift']
RESID_VAR_A     = MODEL['resid_var_a']
RESID_VAR_B     = MODEL['resid_var_b']
RESID_VAR_FLOOR = MODEL['resid_var_floor']
VIX_Z_MEAN      = MODEL['vix_z_mean']
VIX_Z_STD       = MODEL['vix_z_std']
RG_SORTED       = MODEL['rank_gauss_sorted']
RG_SIGNALS      = set(MODEL['rank_gauss_signals'])
SIGNAL_SORTED   = MODEL.get('signal_sorted', {})

def norm_cdf(x):
    return 0.5 * (1 + erf(x / sqrt(2)))

def norm_inv(p):
    """Beasley-Springer-Moro rational approximation, same as scoring.ts."""
    a = [0, -3.969683028665376e+01, 2.209460984245205e+02,
         -2.759285104469687e+02, 1.383577518672690e+02,
         -3.066479806614716e+01, 2.506628277459239e+00]
    b = [0, -5.447609879822406e+01, 1.615858368580409e+02,
         -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01,
         -2.400758277161838e+00, -2.549732539343734e+00,
          4.374664141464968e+00,  2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01,
         2.445134137142996e+00, 3.754408661907416e+00]
    p_low, p_high = 0.02425, 1 - 0.02425
    if p < p_low:
        q = sqrt(-2 * (p ** 0 * __import__('math').log(p)))
        return ((((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
                ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1))
    if p <= p_high:
        q = p - 0.5; r = q*q
        return (((((a[1]*r+a[2])*r+a[3])*r+a[4])*r+a[5])*r+a[6])*q / \
               (((((b[1]*r+b[2])*r+b[3])*r+b[4])*r+b[5])*r+1)
    q = sqrt(-2 * __import__('math').log(1 - p))
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)

def rank_gauss(value, sorted_ref):
    n = len(sorted_ref)
    rank = bisect_left(sorted_ref, value)
    p = max(0.01, min(0.99, rank / (n + 1)))
    return norm_inv(p)

def historical_pctile(value, sorted_ref):
    return bisect_left(sorted_ref, value) / len(sorted_ref) * 100

def cond_resid_std(vix_close):
    vz = (vix_close - VIX_Z_MEAN) / VIX_Z_STD
    v  = max(RESID_VAR_FLOOR, RESID_VAR_A + RESID_VAR_B * vz)
    return sqrt(v)

def score(rsi14m, mfi14m, ema_dist_pct, ppi_yoy, mdebt_yoy, aaii_spread, vix_close,
          yield_curve_10y3m=None, breadth_12m_chg=None):
    """Run a single set of raw signals through the full v5.5 pipeline."""
    raw = {
        'rsi_14m':            rsi14m,
        'mfi_14m':            mfi14m,
        'ema_dist_pct':       ema_dist_pct,
        'ppi_yoy':            ppi_yoy,
        'mdebt_yoy':          mdebt_yoy,
        'aaii_spread':        aaii_spread,
        'vix_close':          vix_close,
        'yield_curve_10y3m':  yield_curve_10y3m if yield_curve_10y3m is not None else MEANS.get('yield_curve_10y3m', 0.0),
        'breadth_12m_chg':    breadth_12m_chg   if breadth_12m_chg   is not None else MEANS.get('breadth_12m_chg',   0.0),
    }
    z = {}
    pct = {}
    for sk in SIGNALS:
        v = raw[sk]
        if sk in RG_SIGNALS and sk in RG_SORTED:
            z[sk] = rank_gauss(v, RG_SORTED[sk])
        else:
            z[sk] = (v - MEANS[sk]) / STDS[sk]
        if sk in SIGNAL_SORTED and SIGNAL_SORTED[sk]:
            pct[sk] = historical_pctile(v, SIGNAL_SORTED[sk])
        elif sk in RG_SORTED:
            pct[sk] = historical_pctile(v, RG_SORTED[sk])
        else:
            pct[sk] = None

    pred = RIDGE_INT + sum(RIDGE_COEFS[sk] * z[sk] for sk in SIGNALS)
    sigma_t = cond_resid_std(vix_close)
    composite = norm_cdf((pred - DRIFT) / sigma_t) * 100
    return {
        'raw':       raw,
        'z':         z,
        'pctile':    pct,
        'pred':      pred,
        'sigma_t':   sigma_t,
        'composite': composite,
    }

if __name__ == '__main__':
    # Quick sanity smoke test using sample-mean inputs (should land near 50).
    r = score(MEANS['rsi_14m'], MEANS['mfi_14m'], MEANS['ema_dist_pct'],
              MEANS['ppi_yoy'], MEANS['mdebt_yoy'], MEANS['aaii_spread'],
              MEANS['vix_close'],
              MEANS.get('yield_curve_10y3m'), MEANS.get('breadth_12m_chg'))
    print(f'mean-input pred = {r["pred"]:+.4f}  drift = {DRIFT:+.4f}  '
          f'composite = {r["composite"]:.2f}')
