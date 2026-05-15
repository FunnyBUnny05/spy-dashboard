import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { TsRow } from '../lib/scoring';
import { tickStyle, gridStyle } from '../lib/chartSetup';

interface Props {
  timeseries: TsRow[];
  compositeScore: number;
}

function fiveTierExposure(score: number): number {
  if (score >= 80) return 1.2;
  if (score >= 60) return 1.0;
  if (score >= 40) return 0.7;
  if (score >= 20) return 0.4;
  return 0.2;
}

function binaryExposure(score: number): number {
  return score >= 60 ? 1.0 : 0.0;
}

function buildCurve(timeseries: TsRow[]) {
  // Use ALL consecutive monthly rows (not just scored ones) to avoid
  // multi-month return jumps across scoring gaps.
  // Score is carried forward from the most recent scored month.
  const rows = timeseries.filter(r => r.spy != null && r.spy > 0);
  const labels: string[] = [];
  const bh: number[] = [];
  const ft: number[] = [];
  const b60: number[] = [];

  let bhV = 100, ftV = 100, b60V = 100;
  let lastScore: number | null = null;
  // Find first scored row index
  const firstScored = rows.findIndex(r => r.score !== null);
  if (firstScored < 0) return { labels, bh, ft, b60 };

  for (let i = firstScored; i < rows.length - 1; i++) {
    if (rows[i].score !== null) lastScore = rows[i].score;
    if (lastScore === null) continue;
    const ret = rows[i + 1].spy / rows[i].spy - 1;
    bhV  *= (1 + ret);
    ftV  *= (1 + fiveTierExposure(lastScore) * ret);
    b60V *= (1 + binaryExposure(lastScore) * ret);
    labels.push(rows[i + 1].date);
    bh.push(+bhV.toFixed(2));
    ft.push(+ftV.toFixed(2));
    b60.push(+b60V.toFixed(2));
  }
  return { labels, bh, ft, b60 };
}

function cagr(curve: number[], nMonths: number): number {
  if (curve.length < 2 || nMonths < 1) return 0;
  return (curve[curve.length - 1] / 100) ** (12 / nMonths) - 1;
}

function maxDD(curve: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

function sharpe(curve: number[]): number {
  if (curve.length < 13) return NaN;
  const rets: number[] = [];
  for (let i = 1; i < curve.length; i++) rets.push(curve[i] / curve[i - 1] - 1);
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1));
  return std < 1e-12 ? NaN : (mu / std) * Math.sqrt(12);
}

export function StrategyPanel({ timeseries, compositeScore }: Props) {
  const { labels, bh, ft, b60 } = useMemo(() => buildCurve(timeseries), [timeseries]);
  const n = labels.length;

  const metrics = useMemo(() => ({
    bh:  { cagr: cagr(bh, n),  mdd: maxDD(bh),  sharpe: sharpe(bh)  },
    ft:  { cagr: cagr(ft, n),  mdd: maxDD(ft),  sharpe: sharpe(ft)  },
    b60: { cagr: cagr(b60, n), mdd: maxDD(b60), sharpe: sharpe(b60) },
  }), [bh, ft, b60, n]);

  const ftStance = fiveTierExposure(compositeScore);
  const b60Stance = binaryExposure(compositeScore);

  const ftLabel =
    compositeScore >= 80 ? 'AGGRESSIVE LONG (120%)' :
    compositeScore >= 60 ? 'FULL LONG (100%)' :
    compositeScore >= 40 ? 'MODERATE (70%)' :
    compositeScore >= 20 ? 'DEFENSIVE (40%)' :
    'MINIMUM (20%)';

  const ftColor =
    compositeScore >= 60 ? 'var(--bull,#4ade80)' :
    compositeScore >= 40 ? 'var(--warn)' :
    'var(--bear)';

  const b60Color = b60Stance === 1.0 ? 'var(--bull,#4ade80)' : 'var(--text2)';

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Buy & Hold',
        data: bh,
        borderColor: '#565a61',
        borderWidth: 1.2,
        pointRadius: 0,
        fill: false,
        tension: 0.2,
        borderDash: [4, 3],
      },
      {
        label: '5-Tier',
        data: ft,
        borderColor: '#3d7fd4',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.2,
      },
      {
        label: 'Binary ≥60',
        data: b60,
        borderColor: '#1fa876',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.2,
      },
    ],
  };

  const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  const fmt2 = (v: number) => isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

  return (
    <div>
      {/* Current stance cards */}
      <div className="hero" style={{ marginBottom: 0 }}>
        <div className="card" style={{ flex: 1 }}>
          <div className="stat-label">5-Tier current stance</div>
          <div className="stat-val" style={{ color: ftColor, marginTop: 8 }}>{ftLabel}</div>
          <div className="stat-sub">
            Score {compositeScore.toFixed(1)} → {Math.round(ftStance * 100)}% equity exposure<br />
            Graduated exposure across 5 score buckets
          </div>
        </div>
        <div className="card" style={{ flex: 1 }}>
          <div className="stat-label">Binary ≥60 current stance</div>
          <div className="stat-val" style={{ color: b60Color, marginTop: 8 }}>
            {b60Stance === 1.0 ? 'LONG (100%)' : 'CASH (0%)'}
          </div>
          <div className="stat-sub">
            Score {compositeScore.toFixed(1)} {b60Stance === 1.0 ? '≥ 60 → fully invested' : '< 60 → all cash'}<br />
            Binary rule: invest 100% only when score ≥ 60
          </div>
        </div>
      </div>

      {/* Equity curve chart */}
      <div className="chart-box" style={{ marginTop: 16 }}>
        <div className="chart-title">
          <span>Paper-trade equity curve — $100 base, monthly rebalance ({labels[0]} → {labels[labels.length - 1]})</span>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text2)' }}>
            {[
              { color: '#565a61', label: 'Buy & Hold', dash: true },
              { color: '#3d7fd4', label: '5-Tier' },
              { color: '#1fa876', label: 'Binary ≥60' },
            ].map(({ color, label, dash }) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  display: 'inline-block', width: 18, height: 0,
                  borderTop: `2px ${dash ? 'dashed' : 'solid'} ${color}`,
                }} />
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="chart-wrap" style={{ height: 300 }}>
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
              x: { ticks: { ...tickStyle, maxTicksLimit: 14, maxRotation: 45 } as any, grid: gridStyle },
              y: {
                ticks: { ...tickStyle, callback: (v: any) => '$' + Math.round(v) } as any,
                grid: gridStyle,
                title: { display: true, text: 'Portfolio value ($100 start)', font: { size: 10, family: 'IBM Plex Mono' }, color: '#565a61' },
              },
            },
          }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, padding: '0 4px' }}>
          No transaction costs. Cash earns 0%. Score from month t sets exposure for t→t+1.
          All consecutive months used; score carried forward over unscored gaps.
          Includes in-sample periods (look-ahead) — verified OOS-only numbers in table below.
        </div>
      </div>

      {/* Live metrics table */}
      <div className="chart-box" style={{ marginTop: 12 }}>
        <div className="chart-title">
          <span>Live metrics — computed from timeseries above (all scored months)</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Strategy</th>
              <th>CAGR</th>
              <th>Max DD</th>
              <th>Sharpe</th>
              <th>Final $100</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Buy & Hold',   m: metrics.bh,  curve: bh,  color: '#565a61' },
              { label: '5-Tier',       m: metrics.ft,  curve: ft,  color: '#3d7fd4' },
              { label: 'Binary ≥60',   m: metrics.b60, curve: b60, color: '#1fa876' },
            ].map(({ label, m, curve, color }) => (
              <tr key={label}>
                <td style={{ color }}><strong>{label}</strong></td>
                <td className={m.cagr >= 0 ? 'bull' : 'bear'}>{pct(m.cagr)}</td>
                <td className="bear">{pct(m.mdd)}</td>
                <td className={m.sharpe >= 0.5 ? 'bull' : m.sharpe >= 0 ? 'warn' : 'bear'}>{fmt2(m.sharpe)}</td>
                <td style={{ color: 'var(--text)' }}>${curve[curve.length - 1]?.toFixed(0) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* OOS audit reference */}
      <div className="chart-box" style={{ marginTop: 12 }}>
        <div className="chart-title">
          <span>Audit v2 — OOS monthly rebalance, n=120 months (2011-02 → 2025-04), time-varying txn costs</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Strategy</th>
              <th>CAGR</th>
              <th>Vol</th>
              <th>Max DD</th>
              <th>Sharpe</th>
              <th>Sortino</th>
              <th>Lo-2002 t</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ color: '#565a61' }}>Buy &amp; Hold</td>
              <td className="bull">+10.29%</td>
              <td>16.38%</td>
              <td className="bear">−24.8%</td>
              <td>+0.57</td>
              <td>+0.48</td>
              <td style={{ color: 'var(--text2)' }}>+1.78</td>
              <td style={{ fontSize: 11, color: 'var(--text2)' }}>Benchmark</td>
            </tr>
            <tr>
              <td style={{ color: '#3d7fd4' }}>5-Tier</td>
              <td className="bull">+10.83%</td>
              <td>13.85%</td>
              <td className="bear">−16.5%</td>
              <td>+0.68</td>
              <td>+0.62</td>
              <td className="bull">+2.12</td>
              <td style={{ fontSize: 11, color: 'var(--text2)' }}>Boot CI [−0.13, +0.29], P&gt;0=84%</td>
            </tr>
            <tr style={{ background: 'rgba(31,168,118,0.07)' }}>
              <td style={{ color: '#1fa876' }}><strong>Binary ≥60</strong></td>
              <td className="bull"><strong>+11.14%</strong></td>
              <td><strong>10.95%</strong></td>
              <td className="bear"><strong>−13.2%</strong></td>
              <td><strong>+0.85</strong></td>
              <td><strong>+0.71</strong></td>
              <td className="bull"><strong>+2.65</strong></td>
              <td style={{ fontSize: 11, color: '#1fa876' }}>Best on all metrics</td>
            </tr>
          </tbody>
        </table>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          <div className="callout callout-info" style={{ margin: 0 }}>
            <strong>DM test vs drift baseline:</strong> p=0.013 — model forecast is statistically
            skilled (beats naïve drift at 5% significance level).
          </div>
          <div className="callout callout-info" style={{ margin: 0 }}>
            <strong>Rolling IC:</strong> ρ positive in 100% of 36m windows, mean +0.50,
            trend +0.086/yr — no evidence of decay.
          </div>
        </div>
        <div className="callout callout-info" style={{ marginTop: 8 }}>
          <strong>Takeaway:</strong> Binary ≥60 wins on every metric — Sharpe +0.85 vs +0.57 B&H (Lo t=+2.65),
          CAGR +11.1%, max drawdown halved (−13% vs −25%). Ladder search confirms the optimal rule
          is simply "invest only when score ≥ 60, otherwise cash." The 5-tier's graduated exposure
          adds complexity without improving risk-adjusted returns. DM p=0.013 confirms the underlying
          forecast has genuine skill vs a drift baseline.
        </div>
      </div>
    </div>
  );
}
