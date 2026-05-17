import { describe, it, expect } from 'vitest';
import { fiveTierExposure, cagr, maxDD, sharpe } from '../backtest';

describe('fiveTierExposure', () => {
  it('returns correct tier for each zone', () => {
    expect(fiveTierExposure(0)).toBe(0.2);
    expect(fiveTierExposure(20)).toBe(0.4);
    expect(fiveTierExposure(40)).toBe(0.7);
    expect(fiveTierExposure(60)).toBe(1.0);
    expect(fiveTierExposure(80)).toBe(1.2);
    expect(fiveTierExposure(100)).toBe(1.2);
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
});

describe('maxDD', () => {
  it('returns 0 for monotone rising curve', () => {
    expect(maxDD([100, 110, 120, 130])).toBe(0);
  });
  it('computes correct drawdown', () => {
    // Peak 120, trough 90 → DD = (90-120)/120 = -0.25
    expect(maxDD([100, 120, 90, 110])).toBeCloseTo(-0.25, 4);
  });
});

describe('sharpe', () => {
  it('returns NaN for fewer than 13 points', () => {
    expect(sharpe([100, 110])).toBeNaN();
  });
});
