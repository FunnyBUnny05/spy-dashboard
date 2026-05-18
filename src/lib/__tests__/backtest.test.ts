import { describe, it, expect } from 'vitest';
import { fiveTierExposure, cagr, maxDD, sharpe, sma10Exposure } from '../backtest';
import type { TsRow } from '../scoring';

describe('fiveTierExposure', () => {
  it('returns correct tier for each zone', () => {
    expect(fiveTierExposure(0)).toBe(0.2);
    expect(fiveTierExposure(20)).toBe(0.4);
    expect(fiveTierExposure(40)).toBe(0.7);
    expect(fiveTierExposure(60)).toBe(1.0);
    expect(fiveTierExposure(80)).toBe(1.2);
    expect(fiveTierExposure(100)).toBe(1.2);
  });

  it('boundary edges: 19 stays in lower tier, 59 stays in lower tier', () => {
    expect(fiveTierExposure(19)).toBe(0.2);   // not yet 20
    expect(fiveTierExposure(59)).toBe(0.7);   // not yet 60
  });
});

describe('cagr', () => {
  it('returns 0 for empty curve', () => {
    expect(cagr([], 12)).toBe(0);
  });
  it('computes annualized return', () => {
    // $100 → $121 over 24 months → sqrt(1.21)-1 ≈ 0.1 = 10%
    expect(cagr([100, 121], 24)).toBeCloseTo(0.1, 2);
  });
  it('known 12% CAGR over exactly 12 months', () => {
    // final value = 100 * 1.12 over 12 months → CAGR should be exactly 0.12
    const finalValue = 100 * 1.12;
    expect(cagr([100, finalValue], 12)).toBeCloseTo(0.12, 2);
  });
});

describe('maxDD', () => {
  it('returns 0 for monotone rising curve', () => {
    expect(maxDD([100, 110, 120, 130])).toBe(0);
  });
  it('computes correct drawdown', () => {
    // Peak 120, trough 90 → DD = (90-120)/120 = -0.25
    expect(maxDD([100, 120, 90, 110])).toBeCloseTo(-0.25, 4);
  });
  it('known sequence [100, 120, 90, 100]: maxDD = -0.25', () => {
    // Peak=120, trough=90 → (90-120)/120 = -0.25
    expect(maxDD([100, 120, 90, 100])).toBeCloseTo(-0.25, 4);
  });
});

describe('sharpe', () => {
  it('returns NaN for fewer than 13 points', () => {
    expect(sharpe([100, 110])).toBeNaN();
  });
});

describe('sma10Exposure', () => {
  it('returns 0 when i < 10 (not enough history)', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      date: `2020-${String(i + 1).padStart(2, '0')}`,
      spy: 100,
      score: 50,
      pred: 0.1,
      regime: '',
      inSample: false,
    })) as TsRow[];
    expect(sma10Exposure(rows, 0)).toBe(0);
    expect(sma10Exposure(rows, 9)).toBe(0);
  });

  it('returns 0 when current price equals SMA (not strictly above)', () => {
    // All spy=100 → SMA10=100, rows[i].spy > sma is false → exposure=0
    const rows = Array.from({ length: 15 }, (_, i) => ({
      date: `2020-${String(i + 1).padStart(2, '0')}`,
      spy: 100,
      score: 50,
      pred: 0.1,
      regime: '',
      inSample: false,
    })) as TsRow[];
    for (let i = 10; i < rows.length; i++) {
      expect(sma10Exposure(rows, i)).toBe(0);
    }
  });
});
