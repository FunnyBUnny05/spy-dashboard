import { regimeLabel, toneColor, toneForScore } from '../lib/format';

interface Props {
  score: number;
  asOf: string;
  delta?: { value: number; vsLabel: string };
  signalCount: number;
}

export function Gauge({ score, asOf, delta, signalCount }: Props) {
  const tone = toneForScore(score);
  const color = toneColor(tone);
  // Map 0-100 to -90 to +90 degrees on a half-circle
  const angle = -90 + (score / 100) * 180;

  return (
    <div className="gauge-card">
      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Composite score
      </div>
      <svg viewBox="0 0 200 120" style={{ width: '100%', maxWidth: 220 }}>
        <defs>
          <linearGradient id="grd" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#d94f3d" />
            <stop offset="33%" stopColor="#e8933a" />
            <stop offset="60%" stopColor="#565a61" />
            <stop offset="100%" stopColor="#1fa876" />
          </linearGradient>
        </defs>
        <path d="M 18 100 A 82 82 0 0 1 182 100" fill="none" stroke="#1a1e23" strokeWidth="14" />
        <path d="M 18 100 A 82 82 0 0 1 182 100" fill="none" stroke="url(#grd)" strokeWidth="10" strokeLinecap="round" />
        <line x1="18" y1="100" x2="26" y2="100" stroke="#565a61" strokeWidth="1.5" />
        <line x1="100" y1="18" x2="100" y2="26" stroke="#565a61" strokeWidth="1.5" />
        <line x1="182" y1="100" x2="174" y2="100" stroke="#565a61" strokeWidth="1.5" />
        <text x="18" y="115" fontSize="9" fill="#565a61" textAnchor="middle">0</text>
        <text x="100" y="14" fontSize="9" fill="#565a61" textAnchor="middle">50</text>
        <text x="182" y="115" fontSize="9" fill="#565a61" textAnchor="middle">100</text>
        <g transform={`translate(100,100) rotate(${angle})`}>
          <line x1="0" y1="0" x2="0" y2="-74" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
          <circle cx="0" cy="0" r="5" fill="white" opacity="0.9" />
          <circle cx="0" cy="-74" r="3" fill={color} />
        </g>
      </svg>
      <div className="gauge-num" style={{ color }}>{score.toFixed(1)}</div>
      <div className="gauge-label" style={{ color }}>{regimeLabel(score)}</div>
      <div className="gauge-sub">{asOf} · {signalCount} signals</div>
      {delta && (
        <div
          className="gauge-delta"
          style={{
            color,
            background: tone === 'bear' ? 'rgba(217,79,61,0.12)' : tone === 'warn' ? 'rgba(232,147,58,0.12)' : 'rgba(31,168,118,0.12)',
            border: `1px solid ${tone === 'bear' ? 'rgba(217,79,61,0.2)' : tone === 'warn' ? 'rgba(232,147,58,0.2)' : 'rgba(31,168,118,0.2)'}`,
          }}
        >
          {delta.value >= 0 ? '↑' : '↓'} {Math.abs(delta.value).toFixed(1)} pts {delta.vsLabel}
        </div>
      )}
    </div>
  );
}
