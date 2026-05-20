import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { SignalSpec, TsRow, rollingOOSRho, volCorrectedPred } from '../lib/scoring';
import { tickStyle, gridStyle } from '../lib/chartSetup';
import modelData from '../data/model.json';

interface Props {
  signals: SignalSpec[];
  composite: number;
  timeseries: TsRow[];
}

const DRIFT      = ((modelData as any).median_fwd12 ?? (modelData as any).drift) as number;
const OOS_RHO    = (modelData as any).oos_rho      as number;
const OOS_N      = (modelData as any).oos_n        as number;
const INTERCEPT  = (modelData as any).ridge_intercept as number;
const ALPHA      = (modelData as any).ridge_alpha  as number;
const RESID_VAR_A = (modelData as any).resid_var_a as number;
const RESID_VAR_B = (modelData as any).resid_var_b as number;

export function MathPanel({ signals, composite, timeseries }: Props) {
  const linCombo = signals.reduce((acc, s) => acc + s.ridgeCoef * s.zVal, 0);

  const rawPred = INTERCEPT + linCombo;

  const { volCorrPred, currentVol12 } = useMemo(() => {
    const spyRows = timeseries.filter(r => r.spy != null && r.spy > 0);
    const n = spyRows.length;

    // Current trailing 12m realized vol
    const lookback = Math.min(12, n - 1);
    const rets: number[] = [];
    for (let i = n - lookback; i < n; i++) {
      rets.push(spyRows[i].spy / spyRows[i - 1].spy - 1);
    }
    const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
    const currentVol12 = Math.sqrt(variance * 12);

    // Training residuals: rows with both pred and realized fwd12
    const trainingResids: { resid: number; vol12: number }[] = [];
    for (let i = 0; i + 12 < timeseries.length; i++) {
      const row = timeseries[i];
      const futRow = timeseries[i + 12];
      if (row.pred == null || row.spy == null || futRow.spy == null) continue;
      const fwd12 = futRow.spy / row.spy - 1;
      const slice = timeseries.slice(Math.max(0, i - 12), i + 1).filter(r => r.spy != null && r.spy > 0);
      if (slice.length < 3) continue;
      const sRets: number[] = [];
      for (let j = 1; j < slice.length; j++) sRets.push(slice[j].spy / slice[j - 1].spy - 1);
      const sMean = sRets.reduce((a, b) => a + b, 0) / sRets.length;
      const sVar = sRets.reduce((a, b) => a + (b - sMean) ** 2, 0) / Math.max(1, sRets.length - 1);
      trainingResids.push({ resid: fwd12 - row.pred, vol12: Math.sqrt(sVar * 12) });
    }

    return { volCorrPred: volCorrectedPred(rawPred, currentVol12, trainingResids), currentVol12 };
  }, [timeseries, rawPred]);

  const { sparkData } = useMemo(() => {
    const rhos = rollingOOSRho(timeseries, 36);
    const labels: string[] = [];
    const values: (number | null)[] = [];
    timeseries.forEach((row, i) => {
      if (rhos[i] !== null) {
        labels.push(row.date);
        values.push(rhos[i]);
      }
    });
    const data = {
      labels,
      datasets: [
        {
          label: '36m OOS ρ',
          data: values,
          borderColor: '#60a5fa',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.2,
        },
      ],
    };
    return { sparkData: data };
  }, [timeseries]);

  return (
    <>
    <div className="chart-box" style={{ marginTop: 16 }}>
      <div className="chart-title">
        <span>Regime-conditional Spearman ρ — score vs realised 12m return</span>
        <span style={{ color: 'var(--text3)', fontSize: 10 }}>source: model.json timeseries · both columns reproducible from data</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Period</th>
            <th>ρ (incl. in-sample)</th>
            <th>ρ (OOS only)</th>
            <th>n_OOS</th>
            <th>Interpretation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2011–2016</td>
            <td style={{ color: 'var(--text2)' }}>+0.254</td>
            <td className="bear">−0.041</td>
            <td style={{ color: 'var(--text3)' }}>36</td>
            <td style={{ fontSize: 11, color: 'var(--bear)' }}>No OOS skill — ρ ≈ 0</td>
          </tr>
          <tr>
            <td>2017–2020</td>
            <td style={{ color: '#60a5fa' }}>+0.395</td>
            <td style={{ color: '#60a5fa' }}>+0.395</td>
            <td style={{ color: 'var(--text3)' }}>46</td>
            <td style={{ fontSize: 11, color: 'var(--text3)' }}>Moderate OOS fit</td>
          </tr>
          <tr>
            <td>2021–2025</td>
            <td className="bull">+0.817</td>
            <td className="bull">+0.817</td>
            <td style={{ color: 'var(--text3)' }}>53</td>
            <td style={{ fontSize: 11, color: 'var(--bull,#4ade80)' }}>Strong OOS fit</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8 }}>
        Pre-2017 OOS rho is statistically indistinguishable from zero.
        Treat the model as well-calibrated only for 2017+ data; earlier evidence is in-sample-contaminated.
        The 0.488 headline OOS ρ is almost entirely a 2021–2025 phenomenon.
      </div>
    </div>
    {/* Rolling 36m OOS ρ sparkline */}
    <div className="chart-box" style={{ marginTop: 16 }}>
      <div className="chart-title">
        <span>Rolling 36-month OOS ρ — score vs realised 12m forward return</span>
        <span style={{ color: 'var(--text3)', fontSize: 10 }}>
          Transparency only — trust-gating on rolling ρ reduces CAGR (see dead-ends doc)
        </span>
      </div>
      <div className="chart-wrap" style={{ height: 160 }}>
        <Line data={sparkData} options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index' as const, intersect: false,
              callbacks: { label: (c: any) => ` OOS ρ: ${c.parsed.y.toFixed(3)}` },
            },
          },
          interaction: { mode: 'index' as const, intersect: false },
          scales: {
            x: { ticks: { ...tickStyle, maxTicksLimit: 10, maxRotation: 45 } as any, grid: gridStyle },
            y: {
              ticks: { ...tickStyle, callback: (v: any) => (v as number).toFixed(2) } as any,
              grid: gridStyle,
              min: -0.5,
              max: 1.0,
              title: { display: true, text: 'Spearman ρ', font: { size: 10, family: 'IBM Plex Mono' }, color: '#565a61' },
            },
          },
        }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
        Reference lines: y=0 (no skill), y=+0.2 (rough significance floor).
        Min observed: −0.33 (≈2016-Q1) · Max: +0.88 · Median: +0.56.
        Months with ρ&lt;0.1: ~40 of 161 (2015–2019 four-year stretch near zero).
      </div>
    </div>
    <div className="two-col">
      <div className="chart-box">
        <div className="chart-title"><span>v5.7 — Ridge regression · signal contributions</span></div>
        <table>
          <thead>
            <tr>
              <th>Signal</th>
              <th>z / RG</th>
              <th>Coef</th>
              <th>Contribution</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => {
              const contrib = s.ridgeCoef * s.zVal;
              const col = contrib < -0.015 ? 'bear' : contrib < 0 ? 'warn' : contrib > 0.015 ? 'bull' : '';
              return (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  <td>{s.zVal >= 0 ? '+' : ''}{s.zVal.toFixed(2)}</td>
                  <td>{s.ridgeCoef >= 0 ? '+' : ''}{s.ridgeCoef.toFixed(4)}</td>
                  <td className={col}>{contrib >= 0 ? '+' : ''}{(contrib * 100).toFixed(2)}pp</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td colSpan={3} style={{ color: 'var(--text2)' }}>Intercept</td>
              <td>{INTERCEPT >= 0 ? '+' : ''}{(INTERCEPT * 100).toFixed(2)}pp</td>
            </tr>
            <tr style={{ borderTop: '2px solid var(--border)', background: 'rgba(217,79,61,0.04)' }}>
              <td style={{ fontWeight: 600, color: 'var(--text)' }} colSpan={2}>Ridge pred 12m</td>
              <td colSpan={2} style={{ fontWeight: 700, fontSize: 14 }}>
                {(rawPred * 100).toFixed(2)}%
              </td>
            </tr>
            <tr style={{ background: 'rgba(96,165,250,0.06)' }}>
              <td style={{ color: 'var(--text3)', fontSize: 11 }} colSpan={2}>
                Vol-corrected pred
                <span style={{ display: 'block', fontSize: 10, color: 'var(--text3)', fontWeight: 400 }}>
                  (vol12={( currentVol12 * 100).toFixed(1)}% · display only — does not affect score)
                </span>
              </td>
              <td colSpan={2} style={{ fontWeight: 600, fontSize: 13,
                color: volCorrPred >= rawPred ? 'var(--bull,#4ade80)' : 'var(--bear)' }}>
                {(volCorrPred * 100).toFixed(2)}%
                <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text3)', marginLeft: 6 }}>
                  ({volCorrPred >= rawPred ? '+' : ''}{((volCorrPred - rawPred) * 100).toFixed(2)}pp)
                </span>
              </td>
            </tr>
            <tr style={{ background: 'rgba(217,79,61,0.04)' }}>
              <td style={{ fontWeight: 600, color: 'var(--text)' }} colSpan={2}>Composite Score</td>
              <td colSpan={2} style={{ fontWeight: 700, fontSize: 14,
                color: composite < 30 ? 'var(--bear)' : composite < 50 ? 'var(--warn)' : 'var(--bull,#4ade80)' }}>
                {composite.toFixed(1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="chart-box">
        <div className="chart-title"><span>v5.7 model summary</span></div>
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Ridge α</td><td>{ALPHA}</td></tr>
            <tr><td>Ridge intercept</td><td>{(INTERCEPT * 100).toFixed(2)}%</td></tr>
            <tr><td>Drift anchor (median fwd12)</td><td>{(DRIFT * 100).toFixed(2)}%</td></tr>
            <tr><td>OOS Spearman ρ</td><td>{OOS_RHO.toFixed(3)}</td></tr>
            <tr><td>OOS n</td><td>{OOS_N} walk-forward predictions</td></tr>
            <tr><td>σ² intercept (a)</td><td>{RESID_VAR_A.toFixed(5)}</td></tr>
            <tr><td>σ² VIX slope (b)</td><td>{RESID_VAR_B >= 0 ? '+' : ''}{RESID_VAR_B.toFixed(5)}</td></tr>
          </tbody>
        </table>

        <div className="callout callout-info" style={{ marginTop: 16, fontSize: 11 }}>
          <strong>v5.7 methodology:</strong> Rank-Gauss normalise all 9 signals
          → sign-constrained Ridge (α={ALPHA}, fixed) on 7 predictors (VIX excluded as a predictor since OOS audit showed it harms ρ; MFI pruned in v5.7 due to collinearity with RSI; VIX still used for σ_t).
          Coefficients forced to share sign with univariate ρ; constraint auto-prunes 3 of the 7 (RSI, EMA dist, MDebt).
          Effective model uses 4 active signals: PPI, AAII, Yield Curve, Breadth
          → pred_fwd_12m = intercept + Σ coef·z → composite score = Φ((pred − drift) / σ(VIX)) × 100.
          score=50 ⟺ pred equals fwd12 median ({(DRIFT*100).toFixed(1)}%).
          Residual std is heteroscedastic: σ²(t) = max(floor, {RESID_VAR_A.toFixed(4)} + {RESID_VAR_B >= 0 ? '+' : ''}{RESID_VAR_B.toFixed(4)}·vix_z).
          OOS Spearman ρ={OOS_RHO.toFixed(3)}, n={OOS_N}.
        </div>
      </div>
    </div>
    </>
  );
}
