/**
 * SPY Composite Scoring System v4
 *
 * Model: PCA + walk-forward OLS (from velv.zip expert model)
 *
 * Pipeline:
 *   1. 7 input signals → Z-score standardize (using full-history mean/std)
 *   2. Apply PCA eigenvectors → PC1, PC2, PC3
 *   3. Walk-forward OLS: pred_fwd_12m = intercept + Σ coef_k * PC_k
 *   4. Composite score = percentile rank of pred in historical pred distribution (0–100)
 *
 * PC loadings (57%/19%/11% of variance):
 *   PC1 — Momentum / Risk cluster: RSI, MFI, EMA dist, Margin debt, AAII spread
 *   PC2 — Inflation vs Fear:        PPI, VIX
 *   PC3 — Cross-currents:           VIX, PPI, Margin debt (mixed signals)
 */

import modelData from '../data/model.json';
import aaiiData  from '../data/aaii.json';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalKey = 'rsi' | 'mfi' | 'trend' | 'ppi' | 'mdebt' | 'aaii' | 'vix';

export interface SignalSpec {
  key: SignalKey;
  label: string;
  category: string;
  value: number;
  pctile: number;   // 0–100 historical percentile
  rho12m: number;   // correlation with 12m forward return (negative = bearish at high values)
  mean: number;
  std: number;
}

export interface V2Result {
  signals: SignalSpec[];
  pc1: number;
  pc2: number;
  pc3: number;
  predFwd12m: number;
  pi80Lo: number;
  pi80Hi: number;
  pi95Lo: number;
  pi95Hi: number;
  compositeScore: number;   // 0–100 percentile rank
  regime: string;
  vixRegime: string;
  ppiRegime: string;
  bucket: BucketDef;
  stance: Stance;
}

// ── Model constants (derived from master_dataset.csv) ─────────────────────────

const SIGNAL_KEYS = modelData.signals as string[];

const SIGNAL_META: Record<string, { label: string; category: string; rho12m: number }> = {
  rsi_14m:     { label: 'RSI (14m)',           category: 'Momentum',          rho12m: -0.523 },
  mfi_14m:     { label: 'MFI (14m)',           category: 'Volume momentum',   rho12m: -0.341 },
  ema_dist_pct:{ label: 'EMA-12m dist %',      category: 'Trend',             rho12m: -0.213 },
  ppi_yoy:     { label: 'PPI YoY %',           category: 'Inflation',         rho12m: -0.318 },
  mdebt_yoy:   { label: 'Margin debt YoY %',   category: 'Leverage',          rho12m: -0.226 },
  aaii_spread: { label: 'AAII stocks−cash',    category: 'Retail sentiment',  rho12m: -0.607 },
  vix_close:   { label: 'VIX',                 category: 'Volatility / fear', rho12m: +0.267 },
};

const SIGNAL_KEY_MAP: Record<string, SignalKey> = {
  rsi_14m: 'rsi', mfi_14m: 'mfi', ema_dist_pct: 'trend',
  ppi_yoy: 'ppi', mdebt_yoy: 'mdebt', aaii_spread: 'aaii', vix_close: 'vix',
};

// Pre-computed prediction distribution (145 walk-forward predictions, sorted)
const PRED_HISTORY: number[] = (modelData as any).pred_history;
const RESID_STD = (modelData as any).resid_std as number;   // 0.1155
const OLS       = (modelData as any).ols;
const EIGVECS   = (modelData as any).eigenvectors as number[][];
const MEANS     = (modelData as any).means as Record<string, number>;
const STDS      = (modelData as any).stds  as Record<string, number>;

// ── Utility ───────────────────────────────────────────────────────────────────

function percentileRank(sorted: number[], value: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; }
  return (lo / sorted.length) * 100;
}

function historicalPercentile(sigKey: string, value: number): number {
  // Use the timeseries to compute empirical percentile
  const ts = (modelData as any).timeseries as Array<Record<string,any>>;
  const vals = ts.map((r: any) => r[sigKey] as number).filter((v: any) => v != null && !isNaN(v));
  const sorted = [...vals].sort((a, b) => a - b);
  return percentileRank(sorted, value);
}

// ── Core model computation ────────────────────────────────────────────────────

export interface RawSignalValues {
  rsi14m:    number;
  mfi14m:    number;
  emaDistPct:number;
  ppiYoy:    number;
  mdebtYoy:  number;
  aaiiSpread:number;
  vixClose:  number;
}

// Map from our internal names → model's signal names
const RAW_TO_MODEL: Record<keyof RawSignalValues, string> = {
  rsi14m: 'rsi_14m', mfi14m: 'mfi_14m', emaDistPct: 'ema_dist_pct',
  ppiYoy: 'ppi_yoy', mdebtYoy: 'mdebt_yoy', aaiiSpread: 'aaii_spread', vixClose: 'vix_close',
};

export function computeV2(raw: RawSignalValues): V2Result {
  // const p = SIGNAL_KEYS.length;

  // 1. Z-score each signal
  const zScores = SIGNAL_KEYS.map(sk => {
    const rawKey = Object.entries(RAW_TO_MODEL).find(([,v]) => v === sk)![0] as keyof RawSignalValues;
    const val = raw[rawKey];
    return (val - MEANS[sk]) / STDS[sk];
  });

  // 2. PCA: PC_k = eigvec_k · z
  const pc1 = EIGVECS[0].reduce((acc, w, _i) => acc + w * zScores[_i], 0);
  const pc2 = EIGVECS[1].reduce((acc, w, i) => acc + w * zScores[i], 0);
  const pc3 = EIGVECS[2].reduce((acc, w, i) => acc + w * zScores[i], 0);

  // 3. Walk-forward OLS prediction
  const predFwd12m = OLS.intercept + OLS.coef_PC1 * pc1 + OLS.coef_PC2 * pc2 + OLS.coef_PC3 * pc3;

  // 4. Prediction intervals (normal approximation)
  const z80 = 1.282, z95 = 1.960;
  const pi80Lo = predFwd12m - z80 * RESID_STD;
  const pi80Hi = predFwd12m + z80 * RESID_STD;
  const pi95Lo = predFwd12m - z95 * RESID_STD;
  const pi95Hi = predFwd12m + z95 * RESID_STD;

  // 5. Composite score = percentile rank of pred in historical distribution
  const compositeScore = percentileRank(PRED_HISTORY, predFwd12m);

  // 6. Build signal specs
  const signals: SignalSpec[] = SIGNAL_KEYS.map((sk) => {
    const rawKey = Object.entries(RAW_TO_MODEL).find(([,v]) => v === sk)![0] as keyof RawSignalValues;
    const value = raw[rawKey];
    const meta  = SIGNAL_META[sk];
    const pctile = historicalPercentile(sk, value);
    return {
      key:      SIGNAL_KEY_MAP[sk],
      label:    meta.label,
      category: meta.category,
      value,
      pctile,
      rho12m:   meta.rho12m,
      mean:     MEANS[sk],
      std:      STDS[sk],
    };
  });

  // 7. Regime
  const vixRegime = raw.vixClose > 25 ? 'high_vol' : raw.vixClose < 15 ? 'low_vol' : 'normal_vol';
  const ppiRegime = raw.ppiYoy > 3.5 ? 'accelerating' : raw.ppiYoy < 1.5 ? 'decelerating' : 'stable';
  const regime = `${vixRegime} · ppi_${ppiRegime}`;

  const bucket  = bucketFor(compositeScore);
  const stance  = stanceFor(compositeScore);

  return { signals, pc1, pc2, pc3, predFwd12m, pi80Lo, pi80Hi, pi95Lo, pi95Hi, compositeScore, regime, vixRegime, ppiRegime, bucket, stance };
}

// ── Buckets (quintile-based, empirical forward returns) ───────────────────────

export interface BucketDef {
  lo: number;
  hi: number;
  label: string;
  n: number;
  mean: number;    // avg 12m fwd return
  ciLo: number;
  ciHi: number;
  pctNeg: number;
  worst: number;
}

export const BUCKETS: BucketDef[] = (modelData as any).buckets.map((b: any) => ({
  lo: b.lo, hi: b.hi, label: b.label, n: b.n,
  mean: b.mean, ciLo: b.ci_lo, ciHi: b.ci_hi,
  pctNeg: b.pct_neg, worst: b.worst,
}));

export function bucketFor(score: number): BucketDef {
  return BUCKETS.find(b => score >= b.lo && score < b.hi + 0.01) ?? BUCKETS[BUCKETS.length - 1];
}

// ── Stance ────────────────────────────────────────────────────────────────────

export interface Stance {
  label: string;
  exposure: string;
  action: string;
  tone: 'bear' | 'warn' | 'neutral' | 'bull' | 'strong';
}

export function stanceFor(score: number): Stance {
  if (score >= 80) return { label: 'Aggressive long',   exposure: '110–130%', action: 'Add on dips, lever up',        tone: 'strong'  };
  if (score >= 60) return { label: 'Bullish',           exposure: '90–100%',  action: 'Full long, no hedges',          tone: 'bull'    };
  if (score >= 40) return { label: 'Neutral',           exposure: '60–80%',   action: 'Moderate long, light hedges',   tone: 'neutral' };
  if (score >= 20) return { label: 'Defensive',         exposure: '30–50%',   action: 'Trim, raise cash',              tone: 'warn'    };
  return               { label: 'Wait / buy panic',   exposure: '10–30%',   action: 'Hedged or buy >15% drawdown',   tone: 'bear'    };
}

// ── Historical score/price timeseries (for chart) ─────────────────────────────

export interface TsRow {
  date: string;
  spy: number;
  score: number | null;
  pred: number | null;
  regime: string;
}

export function getTimeseries(): TsRow[] {
  return ((modelData as any).timeseries as any[]).map((r: any) => ({
    date: r.d, spy: r.spy, score: r.score ?? null, pred: r.pred ?? null, regime: r.regime ?? '',
  }));
}

// ── AAII scoring (kept for context display) ───────────────────────────────────

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
  const spreadMean = spreadValues.reduce((a,b)=>a+b,0)/spreadValues.length;
  const spreadStd  = Math.sqrt(spreadValues.reduce((a,b)=>a+(b-spreadMean)**2,0)/(spreadValues.length-1));
  const currentSpread = reading.stocks - reading.cash;
  const zSpread = (currentSpread - spreadMean) / spreadStd;
  const pctStocks = (history.filter(r => r.stocks < reading.stocks).length / history.length)*100;
  const pctCash   = (history.filter(r => r.cash   < reading.cash  ).length / history.length)*100;
  const score = Math.max(0, Math.min(100, 50 - zSpread*25));
  const flag = zSpread > 1.5 ? 'extreme-greed' : zSpread > 0.75 ? 'greed' : zSpread < -1.5 ? 'extreme-fear' : zSpread < -0.75 ? 'fear' : 'neutral';
  const flagLabel = zSpread > 1.5 ? 'Extreme retail euphoria — contrarian SELL' : zSpread > 0.75 ? 'Retail crowded long — caution' : zSpread < -1.5 ? 'Extreme retail fear — contrarian BUY' : zSpread < -0.75 ? 'Retail defensive — opportunity' : 'Allocations near norms';
  const [yy, mm] = reading.date.split('-').map(Number);
  const staleDays = Math.floor((Date.now() - new Date(yy, mm-1, 28).getTime()) / 86400000);
  const raw = `${(reading.stocks*100).toFixed(1)}% stocks · ${(reading.cash*100).toFixed(1)}% cash`;
  const desc = `Z-spread ${zSpread>=0?'+':''}${zSpread.toFixed(2)} · ${pctStocks.toFixed(0)}th pct stocks`;
  return { reading, stats, zSpread, pctStocks, pctCash, spread: currentSpread, score, flag, flagLabel, raw, desc, staleDays };
}
