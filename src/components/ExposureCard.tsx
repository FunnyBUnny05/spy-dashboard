import { Stance } from '../lib/scoring';
import { toneColor } from '../lib/format';

interface Props {
  stance: Stance;
  composite: number;
}

export function ExposureCard({ stance, composite }: Props) {
  // Pull a midpoint from the exposure range for the bar
  const m = stance.exposure.match(/(\d+)[–-](\d+)/);
  const mid = m ? (parseInt(m[1]) + parseInt(m[2])) / 2 : 50;
  const barWidth = Math.min(100, mid);

  const toneCls = stance.tone === 'bear' ? 'bear' : stance.tone === 'warn' ? 'warn' : stance.tone === 'bull' || stance.tone === 'strong' ? 'bull' : 'neut';
  const color = toneColor(stance.tone === 'strong' ? 'bull' : stance.tone === 'neutral' ? 'neut' : stance.tone);

  const fillBg = stance.tone === 'bear'
    ? 'linear-gradient(to right, var(--bear), #b03020)'
    : stance.tone === 'warn'
    ? 'linear-gradient(to right, var(--warn), #c97520)'
    : 'linear-gradient(to right, var(--bull), #18895f)';

  return (
    <div className="card">
      <div className="stat-label">Recommended exposure</div>
      <div className={`stat-val ${toneCls}`} style={{ marginTop: 8 }}>{stance.exposure}</div>
      <div className="stat-sub">
        Stance: <strong style={{ color }}>{stance.label}</strong>
        <br />
        Action: {stance.action}
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 5 }}>Long equity exposure</div>
        <div className="exposure-bar">
          <div className="exposure-fill" style={{ width: `${barWidth}%`, background: fillBg }}>
            {Math.round(mid)}%
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>
          Score {composite.toFixed(1)} → bucket midpoint
        </div>
      </div>
    </div>
  );
}
