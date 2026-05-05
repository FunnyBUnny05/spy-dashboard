import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

ChartJS.defaults.font.family = "'IBM Plex Mono', monospace";
ChartJS.defaults.font.size = 10;
ChartJS.defaults.color = 'rgba(140,147,153,0.7)';

export const tickStyle = { color: 'rgba(140,147,153,0.7)', font: { size: 10, family: 'IBM Plex Mono' } };
export const gridStyle = { color: 'rgba(255,255,255,0.04)' };
