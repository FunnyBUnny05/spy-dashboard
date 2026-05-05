import { HistoryChart } from './HistoryChart';

export function HistoryPanel() {
  return (
    <>
      <div className="chart-box">
        <div className="chart-title">
          <span>Composite score (left) vs SPY price (right) — 2014 to Apr 2026</span>
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
              30 threshold
            </span>
          </div>
        </div>
        <div className="chart-wrap" style={{ height: 360 }}>
          <HistoryChart />
        </div>
      </div>
      <div className="callout callout-bear">
        <strong>The only comparable readings in 12 years:</strong> Jul 2021 (24.7) and Sep 2021
        (29.7) — both immediately before the 2022 bear market (SPY −25%). Current 29.1 sits in that
        exact zone, pinned there by Buffett's +2σ reading. The critical difference: those 2021
        readings occurred at relative highs. The current reading is at an absolute ATH of $720.65.
      </div>
    </>
  );
}
