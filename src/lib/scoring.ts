/**
 * SPY Composite Scoring System v5.5
 *
 * Model: SIGN-CONSTRAINED Ridge regression on rank-Gauss-normalised signals,
 * with VIX excluded from predictors (kept in data for σ_t and UI percentiles).
 *
 * Evolution:
 *   v5.2: Free Ridge + RG all 7. OOS ρ = 0.428.
 *   v5.3: Sign-constrained Ridge α=5 (auto-prunes MFI/EMA-dist/MDebt). ρ = 0.560.
 *   v5.4: Drop VIX from predictors (audit showed it harmed ρ).         ρ = 0.598.
 *   v5.5: Add yield curve (10Y−3m) + breadth (RSP/SPY 12m chg).        ρ = 0.641.
 *
 * Effective model uses 5 active signals: RSI, PPI, AAII spread,
 * yield curve 10Y−3m, breadth 12m chg.
 * Quintile spread Q5−Q1: +18.8pp.  Quintile monotonicity preserved.
 *
 * Pipeline:
 *   1. 9 input signals
 *   2. Rank-Gauss every signal against the full-sample sorted reference
 *   3. pred_fwd_12m = intercept + Σ ridge_coef_k * rg_k
 *      (4 of the 9 ridge_coefs are exactly 0 by sign-constraint)
 *   4. Composite score = norm.cdf((pred − drift) / σ(VIX)) × 100
 *      where drift = full-sample mean fwd_12m, σ(VIX) is heteroscedastic
 *      σ²(t) = max(floor, a + b·vix_z(t)). score=50 ⇔ pred = drift.
 *   5. Empirical historical percentiles for all 9 signals.
 */

import modelData from '../data/model.json';
import aaiiData  from '../data/aaii.json';
import tteData   from '../data/time_to_event.json';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalKey = 'rsi' | 'mfi' | 'trend' | 'ppi' | 'mdebt' | 'aaii' | 'vix' | 'yieldcurve' | 'breadth';

export interface SignalSpec {
  key: SignalKey;
  label: string;
  category: string;
  value: number;
  pctile: number;   // 0–100 historical percentile
  zVal: number;     // z-score (or rank-gauss value for ppi/mdebt)
  rho12m: number;   // correlation with 12m forward return
  ridgeCoef: number;
  mean: number;
  std: number;
}

export interface V5Result {
  signals: SignalSpec[];
  predFwd12m: number;
  pi80Lo: number;
  pi80Hi: number;
  pi95Lo: number;
  pi95Hi: number;
  compositeScore: number;  // 0–100, anchored: 50 = long-run drift (+8%)
  regime: string;
  vixRegime: string;
  ppiRegime: string;
  bucket: BucketDef;
  stance: Stance;
}

// ── Model constants ────────────────────────────────────────────────────────────

const SIGNAL_KEYS = (modelData as any).signals as string[];
const MEANS       = (modelData as any).means   as Record<string, number>;
const STDS        = (modelData as any).stds    as Record<string, number>;
const RIDGE_COEFS = (modelData as any).ridge_coefs as Record<string, number>;
const RIDGE_INT   = (modelData as any).ridge_intercept as number;
const RESID_STD   = (modelData as any).resid_std as number;
const DRIFT       = (modelData as any).drift as number;

// Heteroscedastic residual variance:  σ²(t) = max(floor, a + b · vix_z(t))
const RESID_VAR_A     = ((modelData as any).resid_var_a     ?? RESID_STD * RESID_STD) as number;
const RESID_VAR_B     = ((modelData as any).resid_var_b     ?? 0) as number;
const RESID_VAR_FLOOR = ((modelData as any).resid_var_floor ?? 1e-4) as number;
const VIX_Z_MEAN      = ((modelData as any).vix_z_mean ?? MEANS['vix_close']) as number;
const VIX_Z_STD       = ((modelData as any).vix_z_std  ?? STDS['vix_close'])  as number;

function condResidStd(vixClose: number): number {
  const vz = (vixClose - VIX_Z_MEAN) / VIX_Z_STD;
  const v  = Math.max(RESID_VAR_FLOOR, RESID_VAR_A + RESID_VAR_B * vz);
  return Math.sqrt(v);
}

// Rank-Gauss reference distributions. v5.2 stores per-signal sorted refs in
// `rank_gauss_sorted` and the active set in `rank_gauss_signals`. Older models
// only had ppi/mdebt — fall back to those for backward compatibility.
const RG_SORTED_MAP = ((modelData as any).rank_gauss_sorted ?? {}) as Record<string, number[]>;
const RG_SIGNAL_LIST = ((modelData as any).rank_gauss_signals ?? ['ppi_yoy', 'mdebt_yoy']) as string[];
const RANK_GAUSS_SIGNALS = new Set(RG_SIGNAL_LIST);
// Legacy fallbacks kept so the file still compiles against pre-v5.2 model.json.
const RG_PPI_SORTED   = (RG_SORTED_MAP['ppi_yoy']   ?? (modelData as any).rank_gauss_ppi_sorted)   as number[];
const RG_MDEBT_SORTED = (RG_SORTED_MAP['mdebt_yoy'] ?? (modelData as any).rank_gauss_mdebt_sorted) as number[];

function rgRefFor(sk: string): number[] {
  if (RG_SORTED_MAP[sk] && RG_SORTED_MAP[sk].length > 0) return RG_SORTED_MAP[sk];
  if (sk === 'ppi_yoy')   return RG_PPI_SORTED;
  if (sk === 'mdebt_yoy') return RG_MDEBT_SORTED;
  // Last-resort: empirical sorted array of the signal itself.
  return getSorted(sk);
}

// Empirical sorted arrays for ALL 7 signals (for true historical percentiles).
// Falls back to a synthetic Gaussian draw only if the field is missing in
// older model.json files.
const SIGNAL_SORTED = ((modelData as any).signal_sorted ?? {}) as Record<string, number[]>;

const SIGNAL_META: Record<string, { label: string; category: string; rho12m: number }> = {
  rsi_14m:           { label: 'RSI (14m)',             category: 'Momentum',          rho12m: -0.523 },
  mfi_14m:           { label: 'MFI (14m)',             category: 'Volume momentum',   rho12m: -0.341 },
  ema_dist_pct:      { label: 'EMA-12m dist %',        category: 'Trend',             rho12m: -0.213 },
  ppi_yoy:           { label: 'PPI YoY %',             category: 'Inflation',         rho12m: -0.318 },
  mdebt_yoy:         { label: 'Margin debt YoY %',     category: 'Leverage',          rho12m: -0.226 },
  aaii_spread:       { label: 'AAII stocks−cash',      category: 'Retail sentiment',  rho12m: -0.607 },
  vix_close:         { label: 'VIX',                   category: 'Volatility / fear', rho12m: +0.267 },
  yield_curve_10y3m: { label: 'Yield curve 10Y−3m',   category: 'Macro / rates',     rho12m: -0.380 },
  breadth_12m_chg:   { label: 'Breadth (RSP/SPY 12m)', category: 'Market breadth',    rho12m: -0.350 },
};

const SIGNAL_KEY_MAP: Record<string, SignalKey> = {
  rsi_14m: 'rsi', mfi_14m: 'mfi', ema_dist_pct: 'trend',
  ppi_yoy: 'ppi', mdebt_yoy: 'mdebt', aaii_spread: 'aaii', vix_close: 'vix',
  yield_curve_10y3m: 'yieldcurve', breadth_12m_chg: 'breadth',
};

// ── Utility ───────────────────────────────────────────────────────────────────

/** Binary search rank in sorted array → index/n */
function sortedRank(sorted: number[], value: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Inverse normal CDF — rational approximation (Beasley-Springer-Moro) */
function normInv(p: number): number {
  const a = [0, -3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [0, -5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
     4.374664141464968e+00,  2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q*q;
    return (((((a[1]*r+a[2])*r+a[3])*r+a[4])*r+a[5])*r+a[6])*q /
           (((((b[1]*r+b[2])*r+b[3])*r+b[4])*r+b[5])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
              ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

/** Normal CDF via error function approximation */
function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429*t - 1.453152027)*t) + 1.421413741)*t
                 - 0.284496736)*t + 0.254829592)*t * Math.exp(-x*x);
  return x >= 0 ? y : -y;
}

/** Rank-Gauss transform a single value against a sorted reference array */
function rankGauss(value: number, sorted: number[]): number {
  const n = sorted.length;
  const rank = sortedRank(sorted, value);
  const p = Math.min(Math.max(rank / (n + 1), 0.01), 0.99);
  return normInv(p);
}

/** Historical percentile (0–100) using the sorted reference array */
function historicalPctile(value: number, sorted: number[]): number {
  return (sortedRank(sorted, value) / sorted.length) * 100;
}

// Empirical sorted arrays per signal — prefer real history, fall back to a
// synthetic Gaussian draw only if model.json predates v5.1.
const _sigSorted: Record<string, number[]> = {};
function getSorted(sigKey: string): number[] {
  if (_sigSorted[sigKey]) return _sigSorted[sigKey];
  if (SIGNAL_SORTED[sigKey] && SIGNAL_SORTED[sigKey].length > 0) {
    _sigSorted[sigKey] = SIGNAL_SORTED[sigKey];
    return _sigSorted[sigKey];
  }
  if (sigKey === 'ppi_yoy')   { _sigSorted[sigKey] = RG_PPI_SORTED;   return _sigSorted[sigKey]; }
  if (sigKey === 'mdebt_yoy') { _sigSorted[sigKey] = RG_MDEBT_SORTED; return _sigSorted[sigKey]; }
  // Legacy fallback: synthetic Gaussian draw around mean/std.
  const n = RG_PPI_SORTED.length;
  const m = MEANS[sigKey], s = STDS[sigKey];
  const arr: number[] = [];
  for (let i = 1; i <= n; i++) arr.push(m + s * normInv(i / (n + 1)));
  _sigSorted[sigKey] = arr;
  return arr;
}

// ── Core model computation ────────────────────────────────────────────────────

export interface RawSignalValues {
  rsi14m:          number;
  mfi14m:          number;
  emaDistPct:      number;
  ppiYoy:          number;
  mdebtYoy:        number;
  aaiiSpread:      number;
  vixClose:        number;
  yieldCurve10y3m: number;
  breadth12mChg:   number;
}

const RAW_TO_MODEL: Record<keyof RawSignalValues, string> = {
  rsi14m: 'rsi_14m', mfi14m: 'mfi_14m', emaDistPct: 'ema_dist_pct',
  ppiYoy: 'ppi_yoy', mdebtYoy: 'mdebt_yoy', aaiiSpread: 'aaii_spread', vixClose: 'vix_close',
  yieldCurve10y3m: 'yield_curve_10y3m', breadth12mChg: 'breadth_12m_chg',
};

export function computeV2(raw: RawSignalValues): V5Result {
  // 1+2. Z-score / rank-gauss each signal
  const signals: SignalSpec[] = SIGNAL_KEYS.map(sk => {
    const rawKey = Object.entries(RAW_TO_MODEL).find(([, v]) => v === sk)![0] as keyof RawSignalValues;
    const value  = raw[rawKey];
    const meta   = SIGNAL_META[sk];

    const zVal = RANK_GAUSS_SIGNALS.has(sk)
      ? rankGauss(value, rgRefFor(sk))
      : (value - MEANS[sk]) / STDS[sk];

    const pctile = historicalPctile(value, getSorted(sk));

    return {
      key:       SIGNAL_KEY_MAP[sk],
      label:     meta.label,
      category:  meta.category,
      value,
      pctile,
      zVal,
      rho12m:    meta.rho12m,
      ridgeCoef: RIDGE_COEFS[sk],
      mean:      MEANS[sk],
      std:       STDS[sk],
    };
  });

  // 3. Ridge prediction
  const predFwd12m = RIDGE_INT + signals.reduce((acc, s) => acc + s.ridgeCoef * s.zVal, 0);

  // 4. Prediction intervals — use VIX-conditional residual std
  const sigmaT = condResidStd(raw.vixClose);
  const z80 = 1.282, z95 = 1.960;
  const pi80Lo = predFwd12m - z80 * sigmaT;
  const pi80Hi = predFwd12m + z80 * sigmaT;
  const pi95Lo = predFwd12m - z95 * sigmaT;
  const pi95Hi = predFwd12m + z95 * sigmaT;

  // 5. Composite score — fixed CDF anchored at sample-mean drift, scaled by
  //    the regime-conditional residual std. score=50 ⇔ pred equals drift.
  const compositeScore = normCdf((predFwd12m - DRIFT) / sigmaT) * 100;

  // 6. Regime
  const vixRegime = raw.vixClose > 25 ? 'high_vol' : raw.vixClose < 15 ? 'low_vol' : 'normal_vol';
  const ppiRegime = raw.ppiYoy > 3.5 ? 'accelerating' : raw.ppiYoy < 1.5 ? 'decelerating' : 'stable';
  const regime    = `${vixRegime} · ppi_${ppiRegime}`;

  return {
    signals, predFwd12m, pi80Lo, pi80Hi, pi95Lo, pi95Hi,
    compositeScore, regime, vixRegime, ppiRegime,
    bucket: bucketFor(compositeScore),
    stance: stanceFor(compositeScore),
  };
}

// ── Buckets ───────────────────────────────────────────────────────────────────

export interface BucketDef {
  lo: number;
  hi: number;
  label: string;
  n: number;
  nEff?: number;   // non-overlapping obs used for CI
  mean: number;
  ciLo: number;
  ciHi: number;
  pctNeg: number;
  worst: number;
}

export const BUCKETS: BucketDef[] = (modelData as any).buckets.map((b: any) => ({
  lo: b.lo, hi: b.hi, label: b.label,
  n: b.n, nEff: b.n_eff,
  mean: b.mean, ciLo: b.ci_lo, ciHi: b.ci_hi,
  pctNeg: b.pct_neg, worst: b.worst,
}));

export function bucketFor(score: number): BucketDef {
  return BUCKETS.find(b => score >= b.lo && score < b.hi + 0.01) ?? BUCKETS[BUCKETS.length - 1];
}

// ── Time-to-event (historical median months until SPY moved by ±X%) ──────────

export interface TTEStat {
  median: number | null;
  mean:   number | null;
  pctNever: number | null;
  nObserved: number;
}

export interface TTEBucket {
  label: string;
  lo: number;
  hi: number;
  n: number;
  dd:    Record<string, TTEStat>;   // key = "5", "10", "15"
  rally: Record<string, TTEStat>;   // key = "5", "10", "20"
}

export const TIME_TO_EVENT = {
  lookaheadMonths:   (tteData as any).lookahead_months as number,
  ddThresholds:      (tteData as any).dd_thresholds    as number[],
  rallyThresholds:   (tteData as any).rally_thresholds as number[],
  buckets: ((tteData as any).buckets as any[]).map((b): TTEBucket => ({
    label: b.label, lo: b.lo, hi: b.hi, n: b.n,
    dd:    b.dd,
    rally: b.rally,
  })),
};

export function tteForScore(score: number): TTEBucket {
  const idx = Math.min(4, Math.floor(score / 20));
  return TIME_TO_EVENT.buckets[idx];
}

// ── Stance ────────────────────────────────────────────────────────────────────

export interface Stance {
  label: string;
  exposure: string;
  action: string;
  tone: 'bear' | 'warn' | 'neutral' | 'bull' | 'strong';
}

export function stanceFor(score: number): Stance {
  if (score >= 80) return { label: 'Aggressive long', exposure: '110–130%', action: 'Add on dips, lever up',       tone: 'strong'  };
  if (score >= 60) return { label: 'Bullish',          exposure: '90–100%',  action: 'Full long, no hedges',        tone: 'bull'    };
  if (score >= 40) return { label: 'Neutral',          exposure: '60–80%',   action: 'Moderate long, light hedges', tone: 'neutral' };
  if (score >= 20) return { label: 'Defensive',        exposure: '30–50%',   action: 'Trim, raise cash',            tone: 'warn'    };
  return                   { label: 'Wait / buy panic',exposure: '10–30%',   action: 'Hedged or buy >15% drawdown', tone: 'bear'    };
}

// ── Historical timeseries ─────────────────────────────────────────────────────

export interface TsRow {
  date: string;
  spy: number;
  score: number | null;
  pred: number | null;
  regime: string;
  /** true ⇒ score is from the final full-sample model (look-ahead); false ⇒ walk-forward OOS. */
  inSample: boolean;
}

export function getTimeseries(): TsRow[] {
  return ((modelData as any).timeseries as any[]).map((r: any) => ({
    date: r.d, spy: r.spy,
    score: r.score ?? null, pred: r.pred ?? null,
    regime: r.regime ?? '',
    inSample: r.in_sample === true,
  }));
}

// ── AAII ──────────────────────────────────────────────────────────────────────

export interface AAIIReading { date: string; stocks: number; bonds: number; cash: number; }
export interface AAIIStats {
  n: number; first_date: string; last_date: string;
  stocks: { mean: number; std: number; min: number; max: number; median: number };
  bonds:  { mean: number; std: number; min: number; max: number; median: number };
  cash:   { mean: number; std: number; min: number; max: number; median: number };
}
export interface AAIIResult {
  reading: AAIIReading; stats: AAIIStats;
  zSpread: number; pctStocks: number; pctCash: number; spread: number;
  score: number; flag: string; flagLabel: string; raw: string; desc: string; staleDays: number;
}

export function getAAIIData(): { history: AAIIReading[]; stats: AAIIStats } {
  return aaiiData as { history: AAIIReading[]; stats: AAIIStats };
}

export function scoreAAII(history: AAIIReading[], stats: AAIIStats): AAIIResult {
  const reading = history[history.length - 1];
  const spreadValues = history.map(r => r.stocks - r.cash);
  const spreadMean = spreadValues.reduce((a, b) => a + b, 0) / spreadValues.length;
  const spreadStd  = Math.sqrt(spreadValues.reduce((a, b) => a + (b - spreadMean) ** 2, 0) / (spreadValues.length - 1));
  const currentSpread = reading.stocks - reading.cash;
  const zSpread  = (currentSpread - spreadMean) / spreadStd;
  const pctStocks = (history.filter(r => r.stocks < reading.stocks).length / history.length) * 100;
  const pctCash   = (history.filter(r => r.cash   < reading.cash  ).length / history.length) * 100;
  const score = Math.max(0, Math.min(100, 50 - zSpread * 25));
  const flag = zSpread > 1.5 ? 'extreme-greed' : zSpread > 0.75 ? 'greed' : zSpread < -1.5 ? 'extreme-fear' : zSpread < -0.75 ? 'fear' : 'neutral';
  const flagLabel = zSpread > 1.5 ? 'Extreme retail euphoria — contrarian SELL' : zSpread > 0.75 ? 'Retail crowded long — caution' : zSpread < -1.5 ? 'Extreme retail fear — contrarian BUY' : zSpread < -0.75 ? 'Retail defensive — opportunity' : 'Allocations near norms';
  const [yy, mm] = reading.date.split('-').map(Number);
  const staleDays = Math.floor((Date.now() - new Date(yy, mm - 1, 28).getTime()) / 86400000);
  const raw  = `${(reading.stocks * 100).toFixed(1)}% stocks · ${(reading.cash * 100).toFixed(1)}% cash`;
  const desc = `Z-spread ${zSpread >= 0 ? '+' : ''}${zSpread.toFixed(2)} · ${pctStocks.toFixed(0)}th pct stocks`;
  return { reading, stats, zSpread, pctStocks, pctCash, spread: currentSpread, score, flag, flagLabel, raw, desc, staleDays };
}
