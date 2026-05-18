import { TsRow } from './scoring';

function binaryExposure(score: number): number {
  return score >= 60 ? 1.0 : 0.0;
}

export function fiveTierExposure(score: number): number {
  if (score >= 80) return 1.2;
  if (score >= 60) return 1.0;
  if (score >= 40) return 0.7;
  if (score >= 20) return 0.4;
  return 0.2;
}

/** 10-month moving average filter — long when SPY price > SMA10, else cash.
 *  Approximates the classic 200-day MA strategy on monthly data. */
export function sma10Exposure(rows: TsRow[], i: number): number {
  if (i < 10) return 0;
  let sum = 0;
  for (let k = i - 10; k < i; k++) sum += rows[k].spy;
  const sma = sum / 10;
  return rows[i].spy > sma ? 1.0 : 0.0;
}

export function buildCurve(timeseries: TsRow[]): { labels: string[]; bh: number[]; ft: number[]; b60: number[]; sma: number[] } {
  // Use ALL consecutive monthly rows (not just scored ones) to avoid
  // multi-month return jumps across scoring gaps.
  // Score is carried forward from the most recent scored month.
  const rows = timeseries.filter(r => r.spy != null && r.spy > 0);
  const labels: string[] = [];
  const bh: number[] = [];
  const ft: number[] = [];
  const b60: number[] = [];
  const sma: number[] = [];

  let bhV = 100, ftV = 100, b60V = 100, smaV = 100;
  let lastScore: number | null = null;
  const firstScored = rows.findIndex(r => r.score !== null);
  if (firstScored < 0) return { labels, bh, ft, b60, sma };

  for (let i = firstScored; i < rows.length - 1; i++) {
    if (rows[i].score !== null) lastScore = rows[i].score;
    if (lastScore === null) continue;
    const ret = rows[i + 1].spy / rows[i].spy - 1;
    bhV  *= (1 + ret);
    ftV  *= (1 + fiveTierExposure(lastScore) * ret);
    b60V *= (1 + binaryExposure(lastScore) * ret);
    smaV *= (1 + sma10Exposure(rows, i) * ret);
    labels.push(rows[i + 1].date);
    bh.push(+bhV.toFixed(2));
    ft.push(+ftV.toFixed(2));
    b60.push(+b60V.toFixed(2));
    sma.push(+smaV.toFixed(2));
  }
  return { labels, bh, ft, b60, sma };
}

export function cagr(curve: number[], nMonths: number): number {
  if (curve.length < 2 || nMonths < 1) return 0;
  return (curve[curve.length - 1] / 100) ** (12 / nMonths) - 1;
}

export function maxDD(curve: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

export function sharpe(curve: number[]): number {
  if (curve.length < 13) return NaN;
  const rets: number[] = [];
  for (let i = 1; i < curve.length; i++) rets.push(curve[i] / curve[i - 1] - 1);
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1));
  return std < 1e-12 ? NaN : (mu / std) * Math.sqrt(12);
}
