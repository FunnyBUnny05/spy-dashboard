import { SignalSpec } from '../lib/scoring';

interface Props {
  signals: SignalSpec[];
}

// Color based on how extreme the percentile is (bearish direction depends on rho)
function pctileColor(pctile: number, rho: number): string {
  // rho < 0 means high value = bearish; rho > 0 means high value = bullish
  const bearPctile = rho < 0 ? pctile : 100 - pctile;
  if (bearPctile >= 85) return 'var(--bear)';
  if (bearPctile >= 70) return 'var(--warn)';
  if (bearPctile <= 25) return 'var(--bull, #4ade80)';
  return 'var(--text)';
}

function formatValue(sig: SignalSpec): string {
  if (sig.key === 'aaii')  return (sig.value * 100).toFixed(1) + '%';
  if (sig.key === 'ppi')   return sig.value.toFixed(2) + '% YoY';
  if (sig.key === 'mdebt') return (sig.value >= 0 ? '+' : '') + sig.value.toFixed(1) + '% YoY';
  if (sig.key === 'vix')   return sig.value.toFixed(2);
  if (sig.key === 'trend') return (sig.value >= 0 ? '+' : '') + sig.value.toFixed(2) + '%';
  return sig.value.toFixed(1);
}

export function SubScores({ signals }: Props) {
  return (
    <div className="subs">
      {signals.map((s) => {
        const color = pctileColor(s.pctile, s.rho12m);
        // Bearish direction bar fill
        const bearPctile = s.rho12m < 0 ? s.pctile : 100 - s.pctile;
        return (
          <div key={s.key} className="sub">
            <div className="sub-category">{s.category}</div>
            <div className="sub-name">{s.label}</div>
            <div className="sub-score" style={{ color }}>
              {formatValue(s)}
            </div>
            {/* Percentile bar */}
            <div className="sub-bar" title={`${s.pctile.toFixed(0)}th historical percentile`}>
              <div className="sub-fill" style={{ width: `${s.pctile}%`, background: color }} />
              <div className="sub-bar-mid" />
            </div>
            <div className="sub-raw" style={{ color: 'var(--text3)' }}>
              {s.pctile.toFixed(0)}th pct
              <span style={{ color: s.rho12m < 0 ? 'var(--text3)' : 'var(--text3)', marginLeft: 6 }}>
                ρ={s.rho12m >= 0 ? '+' : ''}{s.rho12m.toFixed(2)}
              </span>
            </div>
            {/* Bearish-direction fill (how concerning is this reading) */}
            <div className="sub-bear-bar" title={`${bearPctile.toFixed(0)}% bearish pressure`}>
              <div className="sub-bear-fill" style={{ width: `${bearPctile}%`, background: color, opacity: 0.4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
