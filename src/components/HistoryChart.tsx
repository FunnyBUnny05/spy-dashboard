import { Line } from 'react-chartjs-2';
import { TsRow } from '../lib/scoring';
import { tickStyle, gridStyle } from '../lib/chartSetup';

interface Props { timeseries: TsRow[]; }

export function HistoryChart({ timeseries }: Props) {
  const rows  = timeseries.filter(r => r.score !== null);
  const dates  = rows.map(r => r.date);
  const scores = rows.map(r => r.score);
  const prices = rows.map(r => r.spy);

  const data = {
    labels: dates,
    datasets: [
      {
        label: 'Composite Score',
        data: scores,
        borderColor: '#3d7fd4',
        backgroundColor: 'rgba(61,127,212,0.07)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
        yAxisID: 'yL',
      },
      {
        label: 'SPY Price',
        data: prices,
        borderColor: '#565a61',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
        yAxisID: 'yR',
        borderDash: [3, 3],
      },
      {
        label: '20 threshold',
        data: dates.map(() => 20),
        borderColor: 'rgba(217,79,61,0.5)',
        borderWidth: 1,
        pointRadius: 0,
        borderDash: [5, 4],
        yAxisID: 'yL',
      },
      {
        label: '60 bullish',
        data: dates.map(() => 60),
        borderColor: 'rgba(31,168,118,0.35)',
        borderWidth: 1,
        pointRadius: 0,
        borderDash: [5, 4],
        yAxisID: 'yL',
      },
    ],
  };

  return (
    <Line data={data} options={{
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { ...tickStyle, maxTicksLimit: 16, maxRotation: 45 } as any, grid: gridStyle },
        yL: {
          position: 'left', min: 0, max: 100,
          ticks: tickStyle as any, grid: gridStyle,
          title: { display: true, text: 'Score', font: { size: 10, family: 'IBM Plex Mono' }, color: '#565a61' },
        },
        yR: {
          position: 'right',
          ticks: { ...tickStyle, callback: (v: any) => '$' + v } as any,
          grid: { display: false },
          title: { display: true, text: 'SPY $', font: { size: 10, family: 'IBM Plex Mono' }, color: '#565a61' },
        },
      },
    }} />
  );
}
