import { WEIGHTS, SignalSpec } from '../lib/scoring';

interface Props {
  signals: SignalSpec[];
  composite: number;
}

const SIGNAL_COLORS: Record<string, string> = {
  mfi: '#7f5af0',
  ppi: '#d94f3d',
  mdebt: '#534ab7',
  trend: '#1fa876',
  obv: '#185fa5',
  rsi: '#565a61',
  buffett: '#9333ea',
  aaii: '#d4a017',
};

export function MathPanel({ signals, composite }: Props) {
  const v1Weights = { mfi: 0.15, ppi: 0.20, mdebt: 0.20, trend: 0.15, obv: 0.15, rsi: 0.15 };
  const v2Weights = { mfi: 0.13, ppi: 0.17, mdebt: 0.17, trend: 0.13, obv: 0.13, rsi: 0.13, buffett: 0.14 };

  return (
    <div className="two-col">
      <div className="chart-box">
        <div className="chart-title"><span>Composite computation - audit trail</span></div>
        <table>
          <thead>
            <tr>
              <th>Signal</th>
              <th>Score</th>
              <th>Weight</th>
              <th>Contribution</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td className={s.score < 30 ? 'bear' : s.score < 50 ? 'warn' : s.score < 65 ? 'neut' : 'bull'}>
                  {s.score.toFixed(1)}
                </td>
                <td>{(s.weight * 100).toFixed(0)}%</td>
                <td style={{ fontWeight: 500 }}>{(s.score * s.weight).toFixed(2)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)', background: 'rgba(217,79,61,0.04)' }}>
              <td style={{ fontWeight: 600, color: 'var(--text)' }}>Composite</td>
              <td colSpan={2} style={{ color: 'var(--text3)', textAlign: 'right' }}>weighted sum</td>
              <td style={{ fontWeight: 700, fontSize: 14, color: composite < 30 ? 'var(--bear)' : composite < 50 ? 'var(--warn)' : 'var(--bull)' }}>
                {composite.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="chart-box">
        <div className="chart-title"><span>Signal weights - v1 vs v2 vs v3</span></div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 5 }}>v1 (6 signals)</div>
          <div className="weight-bar">
            {Object.entries(v1Weights).map(([k, w]) => (
              <div key={k} className="weight-seg" style={{ width: `${w * 100}%`, background: SIGNAL_COLORS[k] }}>
                {k.toUpperCase()} {(w * 100).toFixed(0)}%
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 5, marginTop: 12 }}>
            v2 (7 signals - Buffett added)
          </div>
          <div className="weight-bar">
            {Object.entries(v2Weights).map(([k, w]) => (
              <div key={k} className="weight-seg" style={{ width: `${w * 100}%`, background: SIGNAL_COLORS[k] }}>
                {(w * 100).toFixed(0)}%
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10, color: 'var(--aaii)', marginBottom: 5, marginTop: 12 }}>
            v3 (8 signals - AAII added) ★ current
          </div>
          <div className="weight-bar" style={{ borderColor: 'rgba(212,160,23,0.4)' }}>
            {Object.entries(WEIGHTS).map(([k, w]) => (
              <div key={k} className="weight-seg" style={{ width: `${w * 100}%`, background: SIGNAL_COLORS[k] }}>
                {(w * 100).toFixed(0)}%
              </div>
            ))}
          </div>
        </div>

        <div className="callout callout-info" style={{ marginTop: 16, fontSize: 11 }}>
          <strong>Why these weights?</strong> Structural signals (PPI, MDebt, Buffett, AAII) get
          52% combined - they capture the slow-moving regime. Technical signals (MFI, Trend, OBV,
          RSI) get 48% - they capture the fast-moving tape. AAII is given 10% (lowest of the new
          additions) because it's the noisiest of the four sentiment/valuation signals and
          partially overlaps with Margin Debt.
        </div>
      </div>
    </div>
  );
}
