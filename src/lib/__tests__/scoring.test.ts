import { describe, it, expect } from 'vitest';
import { stanceZoneFor, scoreUncertainty } from '../scoring';

describe('stanceZoneFor', () => {
  it('returns DEFENSIVE for score < 30', () => {
    expect(stanceZoneFor(0).label).toBe('DEFENSIVE');
    expect(stanceZoneFor(15).label).toBe('DEFENSIVE');
    expect(stanceZoneFor(29.9).label).toBe('DEFENSIVE');
    expect(stanceZoneFor(0).color).toBe('red');
    expect(stanceZoneFor(0).tone).toBe('bear');
  });

  it('returns NORMAL for 30 <= score < 80', () => {
    expect(stanceZoneFor(30).label).toBe('NORMAL');
    expect(stanceZoneFor(50).label).toBe('NORMAL');
    expect(stanceZoneFor(79.9).label).toBe('NORMAL');
    expect(stanceZoneFor(50).color).toBe('amber');
    expect(stanceZoneFor(50).tone).toBe('neutral');
  });

  it('returns OPPORTUNITY for score >= 80', () => {
    expect(stanceZoneFor(80).label).toBe('OPPORTUNITY');
    expect(stanceZoneFor(100).label).toBe('OPPORTUNITY');
    expect(stanceZoneFor(80).color).toBe('green');
    expect(stanceZoneFor(80).tone).toBe('bull');
  });
});

describe('scoreUncertainty', () => {
  it('returns lo < score < hi for mid-range pred', () => {
    // pred=0.15, sigmaT=0.10, drift=0.15 → compositeScore=50
    const { lo, hi } = scoreUncertainty(0.15, 0.10, 0.15);
    expect(lo).toBeLessThan(50);
    expect(hi).toBeGreaterThan(50);
  });

  it('lo and hi are integers', () => {
    const { lo, hi } = scoreUncertainty(0.08, 0.10, 0.15);
    expect(Number.isInteger(lo)).toBe(true);
    expect(Number.isInteger(hi)).toBe(true);
  });

  it('hi > lo always', () => {
    const { lo, hi } = scoreUncertainty(0.20, 0.12, 0.15);
    expect(hi).toBeGreaterThan(lo);
  });
});
