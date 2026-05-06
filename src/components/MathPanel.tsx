import { SignalSpec } from '../lib/scoring';

interface Props {
  signals: SignalSpec[];
  composite: number;
}

// PC loadings (for display)
const PC_LOADINGS: Record<string, [number, number, number]> = {
  rsi:   [-0.52, -0.07, -0.07],
  mfi:   [-0.50, -0.12, -0.17],
  trend: [-0.44,  0.00, -0.38],
  ppi:   [ 0.12, -0.64,  0.52],
  mdebt: [-0.39,  0.14,  0.57],
  aaii:  [-0.34, -0.31, -0.48],
  vix:   [ 0.05,  0.68,  0.08],
};

export function MathPanel({ signals, composite }: Props) {
  return (
    <div className="two-col">
      <div className="chart-box">
        <div className="chart-title"><span>v4 — PCA + walk-forward OLS audit</span></div>
        <table>
          <thead>
            <tr>
              <th>Signal</th>
              <th>Value</th>
              <th>Pctile</th>
              <th>ρ 12m</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td>{s.value.toFixed(2)}</td>
                <td className={s.rho12m < 0
                  ? (s.pctile > 70 ? 'bear' : s.pctile > 50 ? 'warn' : 'bull')
                  : (s.pctile < 30 ? 'bear' : s.pctile < 50 ? 'warn' : 'bull')}>
                  {s.pctile.toFixed(0)}th
                </td>
                <td className={s.rho12m >= 0 ? 'bull' : 'bear'}>
                  {s.rho12m >= 0 ? '+' : ''}{s.rho12m.toFixed(3)}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)', background: 'rgba(217,79,61,0.04)' }}>
              <td style={{ fontWeight: 600, color: 'var(--text)' }} colSpan={3}>Composite Score</td>
              <td style={{ fontWeight: 700, fontSize: 14, color: composite < 30 ? 'var(--bear)' : composite < 50 ? 'var(--warn)' : 'var(--bull,#4ade80)' }}>
                {composite.toFixed(1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="chart-box">
        <div className="chart-title"><span>PCA loadings — how signals combine into PCs</span></div>
        <table>
          <thead>
            <tr>
              <th>Signal</th>
              <th>PC1 (55%)</th>
              <th>PC2 (19%)</th>
              <th>PC3 (11%)</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => {
              const [p1, p2, p3] = PC_LOADINGS[s.key] ?? [0, 0, 0];
              return (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  <td style={{ color: Math.abs(p1) > 0.35 ? 'var(--text)' : 'var(--text3)' }}>{p1 >= 0 ? '+' : ''}{p1.toFixed(2)}</td>
                  <td style={{ color: Math.abs(p2) > 0.35 ? 'var(--text)' : 'var(--text3)' }}>{p2 >= 0 ? '+' : ''}{p2.toFixed(2)}</td>
                  <td style={{ color: Math.abs(p3) > 0.35 ? 'var(--text)' : 'var(--text3)' }}>{p3 >= 0 ? '+' : ''}{p3.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="callout callout-info" style={{ marginTop: 16, fontSize: 11 }}>
          <strong>v4 methodology:</strong> Z-score 7 signals → PCA (3 components, 85% variance) →
          walk-forward OLS → percentile rank of predicted 12m return. OOS Spearman ρ=0.44, n=145 predictions.
          OLS: pred = 0.119 − 0.032·PC1 − 0.029·PC2 − 0.067·PC3
        </div>
      </div>
    </div>
  );
}
