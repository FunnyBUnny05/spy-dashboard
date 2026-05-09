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
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 14, height: 0, borderTop: '1.5px dashed rgba(61,127,212,0.6)',
              }} />
              in-sample (fit)
            </span>
          </div>
        </div>
        <div className="chart-wrap" style={{ height: 360 }}>
          <HistoryChart timeseries={timeseries} />
        </div>
      </div>
      <div className="callout callout-info">
        <strong>v5.4 sign-constrained Ridge model</strong> — solid line is walk-forward out-of-sample
        (n=120, ρ=0.598). Dashed segments are <em>in-sample</em> scores from the final
        full-data model: the most recent ~12 months can't have realised 12m forward
        returns, so those points include the look-ahead they'd normally avoid. Treat
        the dashed tail with caution.
      </div>
    </>
  );
}
