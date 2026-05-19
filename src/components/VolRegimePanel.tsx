import { useMemo } from 'react';
import { TsRow, VolRegimeStats, computeVolRegimeStats } from '../lib/scoring';

interface Props {
  timeseries: TsRow[];
}

const REGIME_LABELS: Record<string, string> = {
  low:      'Low Volatility (<10%)',
  mid_low:  'Mid-Low (10–13.5%)',
  mid_high: 'Mid-High (13.5–18.5%)',
  high:     'High (≥18.5%)',
};

const RHO_LABELS: Record<string, { rho: number; interpretation: string; color: string }> = {
  low:      { rho: -0.272, interpretation: 'Anti-predictive — model historically wrong-signed in this regime', color: 'var(--bear)' },
  mid_low:  { rho:  0.535, interpretation: 'Moderate positive skill',  color: 'var(--text2)' },
  mid_high: { rho:  0.770, interpretation: 'Strong positive skill',    color: 'var(--bull,#4ade80)' },
  high:     { rho:  0.267, interpretation: 'Modest positive skill',    color: 'var(--text2)' },
};

export function VolRegimePanel({ timeseries }: Props) {
  const stats: VolRegimeStats = useMemo(() => computeVolRegimeStats(timeseries), [timeseries]);

  const currentRho = RHO_LABELS[stats.current];
  const isAntiPredictive = stats.current === 'low';

  return (
    <div className="chart-box" style={{ marginTop: 16 }}>
      <div className="chart-title">
        <span>Vol-regime confidence — score reliability by realized-vol quartile</span>
        <span style={{ color: 'var(--text3)', fontSize: 10 }}>
          OOS-derived (n≈34/bucket) · point estimates only · wide CIs
        </span>
      </div>

      {/* Current regime callout */}
      <div className={`callout ${isAntiPredictive ? 'callout-warn' : 'callout-info'}`} style={{ marginBottom: 12 }}>
        <strong>Current regime: {REGIME_LABELS[stats.current]}</strong>
        {' '}(12m realized vol: {isNaN(stats.currentVol) ? '—' : `${(stats.currentVol * 100).toFixed(1)}%`})
        <br />
        OOS ρ in this regime: <span style={{ color: currentRho.color, fontWeight: 700 }}>
          {currentRho.rho >= 0 ? '+' : ''}{currentRho.rho.toFixed(3)}
        </span>
        {' — '}{currentRho.interpretation}
        {isAntiPredictive && (
          <><br /><strong style={{ color: 'var(--bear)' }}>
            In low-vol regimes this model has been anti-predictive on the OOS sample.
            Treat the score's direction with skepticism.
          </strong></>
        )}
      </div>

      {/* OOS ρ by regime table */}
      <table>
        <thead>
          <tr>
            <th>Realized-vol quartile</th>
            <th>Vol range</th>
            <th>Mean vol</th>
            <th>OOS ρ (score vs fwd_12m)</th>
            <th>n</th>
            <th>Interpretation</th>
          </tr>
        </thead>
        <tbody>
          {[
            { key: 'low',      range: '<10%',        meanVol: '8.2%',  rho: -0.272, n: 34 },
            { key: 'mid_low',  range: '10–13.5%',    meanVol: '11.6%', rho: +0.535, n: 34 },
            { key: 'mid_high', range: '13.5–18.5%',  meanVol: '15.2%', rho: +0.770, n: 33 },
            { key: 'high',     range: '≥18.5%',      meanVol: '22.5%', rho: +0.267, n: 34 },
          ].map(row => {
            const isCurrent = row.key === stats.current;
            return (
              <tr key={row.key} style={isCurrent ? { background: 'rgba(255,255,255,0.04)' } : {}}>
                <td>
                  {isCurrent ? <strong>{REGIME_LABELS[row.key]} ◄ current</strong> : REGIME_LABELS[row.key]}
                </td>
                <td style={{ color: 'var(--text2)' }}>{row.range}</td>
                <td style={{ color: 'var(--text2)' }}>{row.meanVol}</td>
                <td style={{ color: RHO_LABELS[row.key].color, fontWeight: isCurrent ? 700 : 400 }}>
                  {row.rho >= 0 ? '+' : ''}{row.rho.toFixed(3)}
                </td>
                <td style={{ color: 'var(--text3)' }}>{row.n}</td>
                <td style={{ fontSize: 11, color: RHO_LABELS[row.key].color }}>
                  {RHO_LABELS[row.key].interpretation}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Caveats */}
      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8 }}>
        n≈34 per bucket — CIs are wide; treat point estimates as suggestive, not precise.
        "Anti-predictive" is the observed historical pattern (2014/2017/2024 low-vol years dominated the negative ρ), not a mechanical guarantee.
        Boundaries: low &lt;10%, mid-low 10–13.5%, mid-high 13.5–18.5%, high ≥18.5%.
        Reproducible from model.json timeseries via scripts/BENCHMARK_REPORT.md.
      </div>
    </div>
  );
}
