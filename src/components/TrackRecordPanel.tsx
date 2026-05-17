import { useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { TsRow } from '../lib/scoring';
import { buildCurve, cagr, maxDD, sharpe } from '../lib/backtest';
import { tickStyle, gridStyle } from '../lib/chartSetup';
import { YearByYearChart } from './YearByYearChart';

interface Props {
  timeseries: TsRow[];
}

function buildCurveWF(timeseries: TsRow[]): { labels: string[]; bh: number[]; stance: number[] } {
  const rows = timeseries.filter(r => r.spy != null && r.spy > 0);
  const labels: string[] = [];
  const bh: number[] = [];
  const stance: number[] = [];

  let bhV = 100, stanceV = 100;
  let lastScore: number | null = null;

  const firstScored = rows.findIndex(r => r.score_wf !== null && r.score_wf !== undefined);
  if (firstScored < 0) return { labels, bh, stance };

  for (let i = firstScored; i < rows.length - 1; i++) {
    if (rows[i].score_wf !== null && rows[i].score_wf !== undefined) lastScore = rows[i].score_wf as number;
    if (lastScore === null) continue;
    const exposure = lastScore >= 60 ? 1.0 : 0.0;
    const ret = rows[i + 1].spy / rows[i].spy - 1;
    bhV     *= (1 + ret);
    stanceV *= (1 + exposure * ret);
    labels.push(rows[i + 1].date);
    bh.push(+bhV.toFixed(2));
    stance.push(+stanceV.toFixed(2));
  }
  return { labels, bh, stance };
}

export function TrackRecordPanel({ timeseries }: Props) {
  const [showWF, setShowWF] = useState(false);

  const { labels, bh, ft } = useMemo(() => buildCurve(timeseries), [timeseries]);
  const wf = useMemo(() => buildCurveWF(timeseries), [timeseries]);

  const n = labels.length;
  const wfN = wf.labels.length;

  const hasWF = wf.stance.length > 12;

  const activeBH     = showWF && hasWF ? wf.bh : bh;
  const activeStance = showWF && hasWF ? wf.stance : ft;
  const activeLabels = showWF && hasWF ? wf.labels : labels;
  const activeN      = showWF && hasWF ? wfN : n;

  const stanceCAGR  = cagr(activeStance, activeN);
  const bhCAGR      = cagr(activeBH, activeN);
  const stanceMDD   = maxDD(activeStance);
  const bhMDD       = maxDD(activeBH);
  const stanceSharpe = sharpe(activeStance);
  const bhSharpe    = sharpe(activeBH);

  const finalStance = activeStance[activeStance.length - 1];
  const finalBH     = activeBH[activeBH.length - 1];

  const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  const fmt2 = (v: number) => isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  const fmtX = (v: number | undefined) => v === undefined ? '—' : `${(v / 100).toFixed(2)}×`;

  const chartData = {
    labels: activeLabels,
    datasets: [
      {
        label: 'Buy & Hold',
        data: activeBH,
        borderColor: '#6b7280',
        borderWidth: 1.2,
        pointRadius: 0,
        fill: false,
        tension: 0.2,
        borderDash: [4, 3],
      },
      {
        label: showWF && hasWF ? 'STANCE_WF (Binary ≥60, walk-forward)' : 'STANCE_NL (Binary ≥60)',
        data: activeStance,
        borderColor: '#60a5fa',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.2,
      },
    ],
  };

  return (
    <div>
      {/* Equity curves */}
      <div className="chart-box">
        <div className="chart-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Equity Curves · {activeLabels[0]} → {activeLabels[activeLabels.length - 1]}</span>
          <label style={{ fontSize: 11, color: '#60a5fa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <input
              type="checkbox"
              checked={showWF}
              onChange={e => setShowWF(e.target.checked)}
              disabled={!hasWF}
              style={{ cursor: hasWF ? 'pointer' : 'not-allowed' }}
            />
            Show walk-forward score{!hasWF ? ' (run scripts/walk_forward_score.py first)' : ''}
          </label>
        </div>
        <div className="chart-wrap" style={{ height: 260 }}>
          <Line data={chartData} options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                mode: 'index', intersect: false,
                callbacks: {
                  label: (c: any) => ` ${c.dataset.label}: $${c.parsed.y.toFixed(0)}`,
                },
              },
            },
            interaction: { mode: 'index', intersect: false },
            scales: {
              x: { ticks: { ...tickStyle, maxTicksLimit: 12, maxRotation: 45 } as any, grid: gridStyle },
              y: {
                ticks: { ...tickStyle, callback: (v: any) => '$' + Math.round(v) } as any,
                grid: gridStyle,
                title: { display: true, text: 'Portfolio value ($100 start)', font: { size: 10, family: 'IBM Plex Mono' }, color: '#565a61' },
              },
            },
          }} />
        </div>

        {/* Stats table */}
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th></th>
              <th>Buy &amp; Hold</th>
              <th style={{ color: '#60a5fa' }}>STANCE_NL</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ color: 'var(--text2)' }}>Final value</td>
              <td style={{ color: '#6b7280' }}>{fmtX(finalBH)}</td>
              <td style={{ color: '#60a5fa' }}>{fmtX(finalStance)}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text2)' }}>CAGR</td>
              <td style={{ color: '#6b7280' }}>{pct(bhCAGR)}</td>
              <td style={{ color: '#60a5fa' }}>{pct(stanceCAGR)}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text2)' }}>Sharpe</td>
              <td style={{ color: '#6b7280' }}>{fmt2(bhSharpe)}</td>
              <td style={{ color: '#60a5fa' }}>{fmt2(stanceSharpe)}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--text2)' }}>Max drawdown</td>
              <td className="bear">{pct(bhMDD)}</td>
              <td className="bull">{pct(stanceMDD)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, fontStyle: 'italic' }}>
          On a return basis STANCE matches buy-and-hold. The model's value is in risk: ~35% smaller worst-case drawdown, marginally better Sharpe (statistical significance: 92%, not 95%).
        </div>
      </div>

      {/* Year-by-year attribution */}
      <YearByYearChart />

      {/* Lookahead caveat */}
      <div style={{
        background: '#0f1a2e',
        border: '1px solid #1e3a5f',
        borderRadius: 6,
        padding: 10,
        fontSize: 11,
        color: '#93c5fd',
        marginTop: 10,
      }}>
        <strong>ⓘ Methodology note:</strong> Historical scores were computed using a model fit on the full 2009–2026 sample. A real-time score computed in 2015 would have been similar but noisier (no future signal distribution to reference). The walk-forward score toggle above shows temporally-honest scores refitted at each step.
      </div>
    </div>
  );
}
