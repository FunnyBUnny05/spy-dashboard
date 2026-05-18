import { describe, it, expect } from 'vitest';
import { detectBannerState } from '../AlertBanner';
import { TsRow } from '../../lib/scoring';

function makeRow(score: number | null, date = '2024-01'): TsRow {
  return { date, spy: 400, score, pred: null, regime: 'normal', inSample: true };
}

describe('detectBannerState', () => {
  it('returns null when timeseries has fewer than 2 scored rows', () => {
    expect(detectBannerState(15, [makeRow(null), makeRow(15)])).toBeNull();
    expect(detectBannerState(15, [])).toBeNull();
  });

  it('returns q1_extreme when score < 20', () => {
    const ts = [makeRow(50), makeRow(15)];
    const result = detectBannerState(15, ts);
    expect(result?.type).toBe('q1_extreme');
    expect(result?.color).toBe('red');
  });

  it('returns crossed_defensive when score crosses below 30 from above (score=20)', () => {
    // score=20 is NOT < 20, so q1_extreme does not fire; crossed_defensive fires instead
    const ts = [makeRow(40), makeRow(20)];
    const result = detectBannerState(20, ts);
    expect(result?.type).toBe('crossed_defensive');
  });

  it('returns q1_extreme (priority 1) when score < 20 even if crossing also happened', () => {
    const ts = [makeRow(40), makeRow(19)];
    const result = detectBannerState(19, ts);
    expect(result?.type).toBe('q1_extreme');
  });

  it('returns crossed_defensive for score in 20–30 range crossing down', () => {
    const ts = [makeRow(40), makeRow(25)];
    const result = detectBannerState(25, ts);
    expect(result?.type).toBe('crossed_defensive');
    expect(result?.color).toBe('amber');
  });

  it('returns recovery when score crosses above 60 from below with prior defensive low', () => {
    const ts = [makeRow(10), makeRow(20), makeRow(30), makeRow(45), makeRow(55), makeRow(62)];
    const result = detectBannerState(62, ts);
    expect(result?.type).toBe('recovery');
    expect(result?.color).toBe('green');
  });

  it('returns null for normal mid-range score with no crossing', () => {
    const ts = [makeRow(55), makeRow(58)];
    expect(detectBannerState(58, ts)).toBeNull();
  });
});
