import { TsRow } from '../lib/scoring';

interface Props {
  timeseries: TsRow[];
}

export function ScoreSparkline({ timeseries }: Props) {
  const scored = timeseries.filter(r => r.score !== null).slice(-12);
  if (scored.length < 2) return null;

  const W = 160, H = 36;
  const pad = 2;
  const scores = scored.map(r => r.score as number);
  const minS = 0, maxS = 100;

  const toX = (i: number) => pad + (i / (scores.length - 1)) * (W - 2 * pad);
  const toY = (s: number) => pad + ((maxS - s) / (maxS - minS)) * (H - 2 * pad);

  const pts = scores.map((s, i) => `${toX(i)},${toY(s)}`).join(' ');
  const lastX = toX(scores.length - 1);
  const lastY = toY(scores[scores.length - 1]);

  const y30 = toY(30);
  const y80 = toY(80);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block', margin: '4px auto 0' }}>
      <line x1={pad} y1={y30} x2={W - pad} y2={y30} stroke="rgba(239,68,68,0.4)" strokeWidth="0.8" strokeDasharray="3,2" />
      <line x1={pad} y1={y80} x2={W - pad} y2={y80} stroke="rgba(74,222,128,0.4)" strokeWidth="0.8" strokeDasharray="3,2" />
      <polyline points={pts} fill="none" stroke="rgba(96,165,250,0.7)" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="#60a5fa" />
    </svg>
  );
}
