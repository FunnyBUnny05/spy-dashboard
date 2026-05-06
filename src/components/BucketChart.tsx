import { Bar } from 'react-chartjs-2';
import { BUCKETS } from '../lib/scoring';
import { tickStyle, gridStyle } from '../lib/chartSetup';

export function BucketChart() {
  const data = {
    labels: BUCKETS.map(b => b.label.split(' ')[0]),
    datasets: [
      {
        label: '12m mean %',
        data: BUCKETS.map(b => +(b.mean * 100).toFixed(1)),
        backgroundColor: BUCKETS.map(b =>
          b.mean < 0 ? '#d94f3d' : b.mean < 0.08 ? '#e8933a' : b.mean < 0.15 ? '#3d7fd4' : '#1fa876'
        ),
        borderWidth: 0,
        borderRadius: 4,
      },
    ],
  };

  return (
    <Bar data={data} options={{
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c: any) => `${c.dataset.label}: ${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y}%`,
          },
        },
      },
      scales: {
        x: { ticks: { ...tickStyle, maxRotation: 0 } as any, grid: { display: false } },
        y: { ticks: { ...tickStyle, callback: (v: any) => v + '%' } as any, grid: gridStyle },
      },
    }} />
  );
}
