import { TsRow } from '../lib/scoring';
import { HistoryChart } from './HistoryChart';

interface Props { timeseries: TsRow[]; }

export function HistoryPanel({ timeseries }: Props) {
  return (
    <>
      <div className="chart-box">
        <div className="chart-title">
          <span>Composite score (left) vs SPY price (right) — 2014 to present</span>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text2)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--blue)' }} />
              Score
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--text3)' }} />
              SPY
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(217,79,61,0.5)' }} />
              20 threshold
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(31,168,118,0.5)' }} />
              60 bullish
            </span>
          </div>
        </div>
        <div className="chart-wrap" style={{ height: 360 }}>
          <HistoryChart timeseries={timeseries} />
        </div>
      </div>
      <div className="callout callout-info">
        <strong>v4 PCA+OLS model</strong> — scores derived from walk-forward OLS predictions,
        percentile-ranked against the historical prediction distribution (n=145). Gaps indicate
        the initial warm-up period before sufficient data for rolling estimation.
      </div>
    </>
  );
}
