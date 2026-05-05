/**
 * SPY Composite Scoring System v3
 *
 * v3 adds AAII Asset Allocation Survey as the 8th signal.
 *
 * Weights (sum to 100):
 *   MFI 12, PPI 15, Margin Debt 15, Trend 12, OBV 12, RSI 12, Buffett 12, AAII 10
 *
 * All sub-scores: 0-100, higher = more bullish.
 * Composite = weighted sum.
 *
 * AAII signal logic (CONTRARIAN):
 *   - High stock allocation = retail euphoria = bearish
 *   - High cash allocation  = retail fear     = bullish
 *   - We use a Z-score on (stocks - cash spread) and map inversely to 0-100
 *   - Hard contrarian flags fire at Z > +1.5 (extreme greed) or Z < -1.5 (extreme fear)
 */

import aaiiData from '../data/aaii.json';

export type SignalKey = 'mfi' | 'ppi' | 'mdebt' | 'trend' | 'obv' | 'rsi' | 'buffett' | 'aaii';

export interface SignalSpec {
  key: SignalKey;
  label: string;
  weight: number; // 0..1
  raw: string; // human-readable raw value
  score: number; // 0..100
  desc: string;
  isNew?: boolean;
}

export const WEIGHTS: Record<SignalKey, number> = {
  mfi: 0.12,
  ppi: 0.15,
  mdebt: 0.15,
  trend: 0.12,
  obv: 0.12,
  rsi: 0.12,
  buffett: 0.12,
  aaii: 0.10,
};

// ── AAII scoring ─────────────────────────────────────────────────────────────

export interface AAIIReading {
  date: string;
  stocks: number;
  bonds: number;
  cash: number;
}

export interface AAIIStats {
  n: number;
  first_date: string;
  last_date: string;
  stocks: { mean: number; std: number; min: number; max: number; median: number };
  bonds: { mean: number; std: number; min: number; max: number; median: number };
  cash: { mean: number; std: number; min: number; max: number; median: number };
}

export interface AAIIResult {
  reading: AAIIReading;
  stats: AAIIStats;
  zStocks: number;        // stocks vs full-sample mean
  zCash: number;          // cash vs full-sample mean
  zSpread: number;        // (stocks-cash) Z, the composite contrarian signal
  pctStocks: number;      // percentile rank of stocks
  pctCash: number;        // percentile rank of cash
  score: number;          // 0-100 sub-score (higher = bullish, contrarian-mapped)
  flag: 'extreme-greed' | 'greed' | 'neutral' | 'fear' | 'extreme-fear';
  flagLabel: string;
  raw: string;
  desc: string;
  staleDays: number;      // days since last reading (for staleness warnings)
}

const MS_PER_DAY = 86_400_000;

/**
 * Map a Z-score to a 0-100 sub-score using a contrarian mapping.
 * Z=0 → 50.  Z=+2 → 0 (extreme greed).  Z=-2 → 100 (extreme fear).
 * Linear in [-2, +2], clamped outside.
 */
function zToContrarianScore(z: number): number {
  const clamped = Math.max(-2, Math.min(2, z));
  return 50 - clamped * 25;
}

export function scoreAAII(history: AAIIReading[], stats: AAIIStats): AAIIResult {
  const reading = history[history.length - 1];
  const sStocks = stats.stocks;
  const sCash = stats.cash;

  const zStocks = (reading.stocks - sStocks.mean) / sStocks.std;
  const zCash = (reading.cash - sCash.mean) / sCash.std;

  // Spread Z-score: combines both sides into one contrarian metric.
  // We standardize the (stocks - cash) gap rather than each independently,
  // so we don't double-count when both are extreme in the same direction.
  const spreadValues = history.map((r) => r.stocks - r.cash);
  const spreadMean = spreadValues.reduce((a, b) => a + b, 0) / spreadValues.length;
  const spreadVar =
    spreadValues.reduce((a, b) => a + (b - spreadMean) ** 2, 0) / (spreadValues.length - 1);
  const spreadStd = Math.sqrt(spreadVar);
  const currentSpread = reading.stocks - reading.cash;
  const zSpread = (currentSpread - spreadMean) / spreadStd;

  const pctStocks =
    (history.filter((r) => r.stocks < reading.stocks).length / history.length) * 100;
  const pctCash =
    (history.filter((r) => r.cash < reading.cash).length / history.length) * 100;

  const score = zToContrarianScore(zSpread);

  let flag: AAIIResult['flag'];
  let flagLabel: string;
  if (zSpread > 1.5) {
    flag = 'extreme-greed';
    flagLabel = 'Extreme retail euphoria — strong contrarian SELL signal';
  } else if (zSpread > 0.75) {
    flag = 'greed';
    flagLabel = 'Retail crowded long — contrarian caution';
  } else if (zSpread < -1.5) {
    flag = 'extreme-fear';
    flagLabel = 'Extreme retail fear — strong contrarian BUY signal';
  } else if (zSpread < -0.75) {
    flag = 'fear';
    flagLabel = 'Retail defensive — contrarian opportunity';
  } else {
    flag = 'neutral';
    flagLabel = 'Allocations near historical norms';
  }

  // Staleness check: AAII publishes monthly, so anything > ~45 days is stale
  const [yy, mm] = reading.date.split('-').map(Number);
  const readingDate = new Date(yy, mm - 1, 28); // approximate end-of-month
  const staleDays = Math.floor((Date.now() - readingDate.getTime()) / MS_PER_DAY);

  const raw = `${(reading.stocks * 100).toFixed(1)}% stocks · ${(reading.cash * 100).toFixed(1)}% cash`;
  const desc = `Z-spread ${zSpread >= 0 ? '+' : ''}${zSpread.toFixed(2)} · ${pctStocks.toFixed(0)}th pct stocks`;

  return {
    reading,
    stats,
    zStocks,
    zCash,
    zSpread,
    pctStocks,
    pctCash,
    score,
    flag,
    flagLabel,
    raw,
    desc,
    staleDays,
  };
}

export function getAAIIData(): { history: AAIIReading[]; stats: AAIIStats } {
  // Bundled at build time; refresh by running `npm run update-aaii`
  return aaiiData as { history: AAIIReading[]; stats: AAIIStats };
}

// ── Composite ────────────────────────────────────────────────────────────────

export function computeComposite(signals: SignalSpec[]): number {
  return signals.reduce((acc, s) => acc + s.score * s.weight, 0);
}

export interface BucketDef {
  label: string;
  range: [number, number];
  fwd3m: number;
  fwd6m: number;
  fwd12m: number;
  median12m: number;
  worst12m: number;
  pctNeg: number;
  n: number;
}

export const BUCKETS: BucketDef[] = [
  { label: 'Extreme caution (<30)', range: [0, 30], fwd3m: 1.76, fwd6m: 4.98, fwd12m: -8.93, median12m: -12.10, worst12m: -13.43, pctNeg: 100, n: 3 },
  { label: 'Caution (30–40)', range: [30, 40], fwd3m: 4.75, fwd6m: 5.84, fwd12m: 2.03, median12m: 4.75, worst12m: -18.05, pctNeg: 50, n: 10 },
  { label: 'Below avg (40–50)', range: [40, 50], fwd3m: 1.70, fwd6m: 3.32, fwd12m: 9.52, median12m: 12.33, worst12m: -19.48, pctNeg: 13.8, n: 29 },
  { label: 'Above avg (50–60)', range: [50, 60], fwd3m: 2.54, fwd6m: 5.70, fwd12m: 13.92, median12m: 14.24, worst12m: -9.61, pctNeg: 8.5, n: 82 },
  { label: 'Good (60–70)', range: [60, 70], fwd3m: 3.38, fwd6m: 7.57, fwd12m: 14.76, median12m: 15.75, worst12m: -12.14, pctNeg: 15.2, n: 46 },
  { label: 'Strong (>70)', range: [70, 100], fwd3m: 12.64, fwd6m: 14.26, fwd12m: 30.05, median12m: 22.70, worst12m: 13.39, pctNeg: 0, n: 4 },
];

export function bucketFor(score: number): BucketDef {
  return BUCKETS.find((b) => score >= b.range[0] && score < b.range[1]) ?? BUCKETS[BUCKETS.length - 1];
}

export interface Stance {
  label: string;
  exposure: string;
  action: string;
  tone: 'bear' | 'warn' | 'neutral' | 'bull' | 'strong';
}

export function stanceFor(score: number): Stance {
  if (score >= 70) return { label: 'Aggressive long', exposure: '110–130%', action: 'Add on dips, lever', tone: 'strong' };
  if (score >= 60) return { label: 'Bullish', exposure: '90–100%', action: 'Full long, no hedges', tone: 'bull' };
  if (score >= 50) return { label: 'Neutral+', exposure: '75–90%', action: 'Long bias, light hedges', tone: 'neutral' };
  if (score >= 40) return { label: 'Defensive', exposure: '50–70%', action: 'Trim, raise cash', tone: 'warn' };
  if (score >= 30) return { label: 'Defensive heavy', exposure: '30–50%', action: 'Reduce significantly', tone: 'warn' };
  return { label: 'Wait / buy panic', exposure: '20–40%', action: 'Hedged or buy >15% drawdown', tone: 'bear' };
}
