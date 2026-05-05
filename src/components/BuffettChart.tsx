import { Line } from 'react-chartjs-2';
import { BUFFETT_HISTORY } from '../lib/snapshot';
import { tickStyle, gridStyle } from '../lib/chartSetup';

export function BuffettChart() {
  const { dates, ratio, trend, upper, lower } = BUFFETT_HISTORY;
  const data = {
    labels: dates,
    datasets: [
      {
        label: '+2σ band',
        data: upper,
        borderColor: 'rgba(217,79,61,0.4)',
        borderWidth: 1,
        pointRadius: 0,
        borderDash: [4, 4],
        fill: false,
        tension: 0.3,
      },
      {
        label: 'Trend',
        data: trend,
        borderColor: 'rgba(232,147,58,0.6)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
      },
      {
        label: '−2σ band',
        data: lower,
        borderColor: 'rgba(31,168,118,0.4)',
        borderWidth: 1,
        pointRadius: 0,
        borderDash: [4, 4],
        fill: false,
        tension: 0.3,
      },
      {
        label: 'Buffett Ratio',
        data: ratio,
        borderColor: '#7f5af0',
        borderWidth: 2,
        pointRadius: ratio.map((v, i) => (v > upper[i] ? 4 : 2)),
        fill: false,
        tension: 0.3,
        pointBackgroundColor: ratio.map((v, i) => (v > upper[i] ? '#d94f3d' : '#7f5af0')),
      },
    ],
  };

  return (
    <Line
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { ticks: { ...tickStyle, maxTicksLimit: 10, maxRotation: 45 } as any, grid: gridStyle },
          y: { ticks: { ...tickStyle, callback: (v: any) => v + '%' } as any, grid: gridStyle, min: 40 },
        },
      }}
    />
  );
}
