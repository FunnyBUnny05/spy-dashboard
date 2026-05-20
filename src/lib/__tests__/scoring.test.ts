import { describe, it, expect } from 'vitest';
import { stanceZoneFor, scoreUncertainty, computeV2, bucketFor, BUCKETS, scoreAAII, getAAIIData, classifyVolRegime, rollingOOSRho, getTimeseries, DRIFT_LABEL, volCorrectedPred } from '../scoring';
import { CURRENT } from '../snapshot';

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

describe('computeV2 smoke test', () => {
  it('returns compositeScore in [0,100], finite predFwd12m, and stance with exposure string', () => {
    const result = computeV2(CURRENT);
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
    expect(Number.isFinite(result.predFwd12m)).toBe(true);
    expect(typeof result.stance.exposure).toBe('string');
    expect(result.stance.exposure.length).toBeGreaterThan(0);
  });
});

describe('bucketFor edge cases', () => {
  it('returns a non-null bucket with a truthy label for boundary scores', () => {
    for (const score of [0, 20, 40, 60, 80, 100]) {
      const bucket = bucketFor(score);
      expect(bucket).not.toBeNull();
      expect(bucket.label).toBeTruthy();
    }
  });

  it('score=0 returns the lowest bucket and score=100 returns the highest', () => {
    const lowest  = BUCKETS[0];
    const highest = BUCKETS[BUCKETS.length - 1];
    expect(bucketFor(0).label).toBe(lowest.label);
    expect(bucketFor(100).label).toBe(highest.label);
  });
});

describe('scoreAAII integration', () => {
  it('returns score in [0,100] and a valid flag string', () => {
    const { history, stats } = getAAIIData();
    const result = scoreAAII(history, stats);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    const validFlags = ['extreme-greed', 'greed', 'neutral', 'fear', 'extreme-fear'];
    expect(validFlags).toContain(result.flag);
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

  it('returns {lo:50, hi:50} when sigmaT is 0', () => {
    const { lo, hi } = scoreUncertainty(0.15, 0, 0.15);
    expect(lo).toBe(50);
    expect(hi).toBe(50);
  });
});

describe('classifyVolRegime', () => {
  it('returns low for vol below 0.10', () => {
    expect(classifyVolRegime(0.05)).toBe('low');
    expect(classifyVolRegime(0.099)).toBe('low');
  });
  it('returns mid_low for vol [0.10, 0.135)', () => {
    expect(classifyVolRegime(0.10)).toBe('mid_low');
    expect(classifyVolRegime(0.134)).toBe('mid_low');
  });
  it('returns mid_high for vol [0.135, 0.185)', () => {
    expect(classifyVolRegime(0.135)).toBe('mid_high');
    expect(classifyVolRegime(0.184)).toBe('mid_high');
  });
  it('returns high for vol >= 0.185', () => {
    expect(classifyVolRegime(0.185)).toBe('high');
    expect(classifyVolRegime(0.30)).toBe('high');
  });
});

describe('pi95 band width (M3)', () => {
  it('pi95 half-width exceeds pi80 half-width by the ratio 2.20/1.282', () => {
    const result = computeV2(CURRENT);
    const hw80 = result.pi80Hi - result.predFwd12m;
    const hw95 = result.pi95Hi - result.predFwd12m;
    // 2.20 / 1.282 ≈ 1.716; allow ±0.1 tolerance
    expect(hw95 / hw80).toBeCloseTo(2.20 / 1.282, 1);
  });
});

describe('M4 median anchor', () => {
  it('DRIFT_LABEL mentions median', () => {
    expect(DRIFT_LABEL.toLowerCase()).toContain('median');
  });

  it('DRIFT_LABEL contains 14 (median ~13.8% rounds to 14%)', () => {
    expect(DRIFT_LABEL).toContain('14');
  });
});

describe('volCorrectedPred (M1)', () => {
  it('returns pred unchanged when fewer than 24 training residuals', () => {
    const shortResids = Array.from({ length: 10 }, (_, i) => ({ resid: 0.01 * i, vol12: 0.10 + 0.005 * i }));
    expect(volCorrectedPred(0.12, 0.13, shortResids)).toBe(0.12);
  });

  it('returns a finite number with sufficient training data', () => {
    const resids = Array.from({ length: 36 }, (_, i) => ({ resid: (i % 3 - 1) * 0.02, vol12: 0.10 + 0.005 * (i % 5) }));
    const result = volCorrectedPred(0.12, 0.13, resids);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('returns a finite number when all vol12 values are identical (zero denominator guard)', () => {
    const resids = Array.from({ length: 30 }, () => ({ resid: 0.01, vol12: 0.12 }));
    const result = volCorrectedPred(0.10, 0.12, resids);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('applies positive correction when high-vol rows have systematically positive residuals', () => {
    // vol12 above mean (0.15) paired with positive residuals → b > 0
    // When current vol12 > training xMean, correction should be positive (volCorrPred > pred)
    const resids = Array.from({ length: 30 }, (_, i) => ({
      resid:  i % 2 === 0 ?  0.05 : -0.05,   // alternating, mean ≈ 0
      vol12:  i % 2 === 0 ?  0.20 :  0.10,   // correlated: high vol ↔ positive resid
    }));
    // current vol12 = 0.20 (above xMean=0.15) → correction should be positive
    const result = volCorrectedPred(0.10, 0.20, resids);
    expect(result).toBeGreaterThan(0.10);
  });
});

describe('rollingOOSRho', () => {
  it('returns all nulls when fewer than 12+12 rows', () => {
    const ts = getTimeseries().slice(0, 20);
    const result = rollingOOSRho(ts, 36);
    expect(result.every(v => v === null)).toBe(true);
  });

  it('returns a non-null value for the full timeseries at a late row', () => {
    const ts = getTimeseries();
    const result = rollingOOSRho(ts, 36);
    const nonNull = result.filter(v => v !== null);
    expect(nonNull.length).toBeGreaterThan(0);
    nonNull.forEach(v => {
      expect(v!).toBeGreaterThanOrEqual(-1);
      expect(v!).toBeLessThanOrEqual(1);
    });
  });
});
