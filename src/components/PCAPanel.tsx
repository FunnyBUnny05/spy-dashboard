interface Props {
  pc1: number;
  pc2: number;
  pc3: number;
  regime: string;
}

const PC_META = [
  {
    name: 'PC1 — Momentum / Risk cluster',
    variance: '55%',
    desc: 'RSI · MFI · EMA distance · Margin debt · AAII spread all load here. These are not 5 independent signals — they are ONE underlying factor. High PC1 = broad risk-on excess.',
    signals: [
      { sig: 'RSI (14m)',       load: +0.472 },
      { sig: 'EMA dist %',      load: +0.441 },
      { sig: 'MFI (14m)',       load: +0.444 },
      { sig: 'Margin debt YoY', load: +0.436 },
      { sig: 'AAII spread',     load: +0.404 },
      { sig: 'VIX',             load: -0.242 },
    ],
  },
  {
    name: 'PC2 — Inflation vs Fear',
    variance: '19%',
    desc: 'High PPI + calm VIX = late-cycle stress without visible fear. The market tends to ignore inflation until it can\'t.',
    signals: [
      { sig: 'PPI YoY %',       load: +0.695 },
      { sig: 'VIX',             load: +0.545 },
      { sig: 'MFI (14m)',       load: +0.309 },
      { sig: 'AAII spread',     load: +0.199 },
      { sig: 'Margin debt YoY', load: +0.057 },
    ],
  },
  {
    name: 'PC3 — Cross-currents',
    variance: '11%',
    desc: 'Mixed inflation + leverage signals. Elevated VIX with diverging macro. Lower interpretive confidence.',
    signals: [
      { sig: 'VIX',             load: +0.676 },
      { sig: 'PPI YoY %',       load: -0.461 },
      { sig: 'Margin debt YoY', load: +0.430 },
      { sig: 'AAII spread',     load: -0.309 },
    ],
  },
];

function pcColor(v: number) {
  if (v > 1.5) return 'var(--bear)';
  if (v > 0.75) return 'var(--warn)';
  if (v < -1.5) return 'var(--bull, #4ade80)';
  if (v < -0.75) return '#60a5fa';
  return 'var(--text)';
}

export function PCAPanel({ pc1, pc2, pc3 }: Props) {
  const vals = [pc1, pc2, pc3];

  return (
    <div className="pca-panel">
      <div className="pca-intro">
        <p>
          PCA reduces the 7 raw signals into 3 orthogonal components.
          The walk-forward OLS model regresses these components against
          12-month forward returns to produce the composite score.
        </p>
        <p style={{ color: 'var(--text3)', fontSize: 11 }}>
          OOS Spearman ρ = 0.44 · n=145 walk-forward predictions · residual std = 11.5%
        </p>
      </div>

      <div className="pca-cards">
        {PC_META.map((meta, k) => {
          const v = vals[k];
          const col = pcColor(v);
          const interp = v > 1.5 ? 'Extreme — strong bearish pressure'
            : v > 0.75 ? 'Elevated'
            : v < -1.5 ? 'Extreme — strong bullish signal'
            : v < -0.75 ? 'Low — bullish lean'
            : 'Neutral range';

          return (
            <div key={k} className="pca-card">
              <div className="pca-card-header">
                <span className="pca-label">PC{k+1}</span>
                <span className="pca-variance">{meta.variance} of variance</span>
              </div>
              <div className="pca-name">{meta.name.split(' — ')[1]}</div>
              <div className="pca-value" style={{ color: col }}>
                {v >= 0 ? '+' : ''}{v.toFixed(2)}<span className="pca-unit">σ</span>
              </div>
              <div className="pca-interp" style={{ color: col }}>{interp}</div>
              <div className="pca-desc">{meta.desc}</div>

              <div className="pca-loadings">
                {meta.signals.map(({ sig, load }) => (
                  <div key={sig} className="pca-load-row">
                    <span className="pca-load-sig">{sig}</span>
                    <div className="pca-load-bar-wrap">
                      <div className="pca-load-bar"
                        style={{
                          left:  load >= 0 ? '50%' : `${50 + load*50}%`,
                          width: `${Math.abs(load)*50}%`,
                          background: load > 0 ? 'var(--accent, #3b82f6)' : 'var(--text3)',
                        }} />
                      <div className="pca-load-zero" />
                    </div>
                    <span className="pca-load-val">{load >= 0 ? '+' : ''}{load.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
