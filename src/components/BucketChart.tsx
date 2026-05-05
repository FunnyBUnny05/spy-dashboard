import { Bar } from 'react-chartjs-2';
import { BUCKETS } from '../lib/scoring';
import { tickStyle, gridStyle } from '../lib/chartSetup';

export function BucketChart() {
  const data = {
    labels: ['<30\nExtreme', '30-40\nCaution', '40-50\nBelow', '50-60\nAbove', '60-70\nGood', '>70\nStrong'],
    datasets: [
      {
        label: '12m mean',
        data: BUCKETS.map((b) => b.fwd12m),
        backgroundColor: BUCKETS.map((b) =>
          b.fwd12m < 0 ? '#d94f3d' : b.fwd12m < 5 ? '#e8933a' : b.fwd12m < 13 ? '#3d7fd4' : '#1fa876'
        ),
        borderWidth: 0,
        borderRadius: 4,
      },
      {
        label: '12m median',
        data: BUCKETS.map((b) => b.median12m),
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 0,
        borderRadius: 4,
      },
    ],
  };

  return (
    <Bar
      data={data}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (c: any) => `${c.dataset.label}: ${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y}%`,
            },
          },
        },
        scales: {
          x: { ticks: { ...tickStyle, maxRotation: 0 } as any, grid: { display: false } },
          y: { ticks: { ...tickStyle, callback: (v: any) => v + '%' } as any, grid: gridStyle },
        },
      }}
    />
  );
}
