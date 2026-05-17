import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js';
import { tickStyle, gridStyle } from '../lib/chartSetup';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const YEAR_DATA = [
  { year: 2011, bh:  0.00, stance:  5.25 },
  { year: 2012, bh: 13.40, stance: 12.10 },
  { year: 2013, bh: 29.60, stance: 24.30 },
  { year: 2014, bh: 12.40, stance:  6.90 },
  { year: 2015, bh:  1.40, stance:  1.10 },
  { year: 2016, bh:  9.50, stance:  7.20 },
  { year: 2017, bh: 20.20, stance: 11.00 },
  { year: 2018, bh: -6.20, stance: -4.10 },
  { year: 2019, bh: 28.90, stance: 23.50 },
  { year: 2020, bh: 29.00, stance: 31.20 },
  { year: 2021, bh: 13.60, stance:  7.10 },
  { year: 2022, bh: -6.54, stance:  1.57 },
  { year: 2023, bh: 24.20, stance: 20.80 },
  { year: 2024, bh: 15.90, stance: 10.10 },
  { year: 2025, bh: 15.50, stance: 19.10 },
];

export function YearByYearChart() {
  const labels = YEAR_DATA.map(d => String(d.year));
  const bhData = YEAR_DATA.map(d => d.bh);
  const stanceColors = YEAR_DATA.map(d =>
    d.stance >= d.bh ? 'rgba(96,165,250,0.75)' : 'rgba(239,68,68,0.65)'
  );

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Buy & Hold',
        data: bhData,
        backgroundColor: 'rgba(107,114,128,0.55)',
        borderColor: 'rgba(107,114,128,0.8)',
        borderWidth: 1,
        barPercentage: 0.8,
        categoryPercentage: 0.55,
      },
      {
        label: 'STANCE_NL',
        data: YEAR_DATA.map(d => d.stance),
        backgroundColor: stanceColors,
        borderColor: stanceColors.map(c => c.replace('0.75', '1').replace('0.65', '1')),
        borderWidth: 1,
        barPercentage: 0.8,
        categoryPercentage: 0.55,
      },
    ],
  };

  return (
    <div className="chart-box" style={{ marginTop: 12 }}>
      <div className="chart-title">Year-by-Year Attribution · BH vs STANCE_NL</div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8 }}>
        The score helped most in 2011, 2020, 2022, and 2025. It hurt most in 2014, 2017, 2021, 2024 — strong bull years where it was over-cautious.
      </div>
      <div className="chart-wrap" style={{ height: 240 }}>
        <Bar data={chartData} options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (c: any) => ` ${c.dataset.label}: ${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y.toFixed(2)}%`,
              },
            },
          },
          scales: {
            x: { ticks: { ...tickStyle } as any, grid: gridStyle },
            y: {
              ticks: { ...tickStyle, callback: (v: any) => `${v}%` } as any,
              grid: gridStyle,
              title: { display: true, text: 'Annual return (%)', font: { size: 10, family: 'IBM Plex Mono' }, color: '#565a61' },
            },
          },
        }} />
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text2)', marginTop: 6 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(107,114,128,0.7)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />Buy &amp; Hold</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(96,165,250,0.75)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />STANCE outperformed</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(239,68,68,0.65)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />STANCE underperformed</span>
      </div>
    </div>
  );
}
