import { Line } from 'react-chartjs-2';
import { AAIIReading, AAIIStats } from '../lib/scoring';
import { tickStyle, gridStyle } from '../lib/chartSetup';

interface Props {
  history: AAIIReading[];
  stats: AAIIStats;
}

export function AAIIChart({ history, stats }: Props) {
  // Sample monthly data — show every 3rd month for readability
  const stride = Math.max(1, Math.floor(history.length / 200));
  const sampled = history.filter((_, i) => i % stride === 0);
  const labels = sampled.map((r) => r.date);
  const stocks = sampled.map((r) => r.stocks * 100);
  const cash = sampled.map((r) => r.cash * 100);
  const bonds = sampled.map((r) => r.bonds * 100);

  const data = {
    labels,
    datasets: [
      {
        label: 'Stocks %',
        data: stocks,
        borderColor: '#1fa876',
        backgroundColor: 'rgba(31,168,118,0.05)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
      },
      {
        label: 'Cash %',
        data: cash,
        borderColor: '#d4a017',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
      },
      {
        label: 'Bonds %',
        data: bonds,
        borderColor: '#3d7fd4',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
      },
      {
        label: 'Stocks mean',
        data: labels.map(() => stats.stocks.mean * 100),
        borderColor: 'rgba(31,168,118,0.4)',
        borderWidth: 1,
        pointRadius: 0,
        borderDash: [4, 4],
      },
      {
        label: 'Cash mean',
        data: labels.map(() => stats.cash.mean * 100),
        borderColor: 'rgba(212,160,23,0.4)',
        borderWidth: 1,
        pointRadius: 0,
        borderDash: [4, 4],
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
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { ...tickStyle, maxTicksLimit: 10, maxRotation: 45 } as any, grid: gridStyle },
          y: { ticks: { ...tickStyle, callback: (v: any) => v + '%' } as any, grid: gridStyle, min: 0, max: 80 },
        },
      }}
    />
  );
}
