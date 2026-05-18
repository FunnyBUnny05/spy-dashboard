import { BUCKETS, BucketDef } from '../lib/scoring';

interface Props {
  currentBucket: BucketDef;
  predFwd12m: number;
  pi80Lo: number;
  pi80Hi: number;
  pi95Lo: number;
  pi95Hi: number;
}

const pct = (v: number, d = 1) => (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
const bMin = -0.10, bMax = 0.35;
const bs = (v: number) => Math.max(0, Math.min(100, ((v - bMin) / (bMax - bMin)) * 100));

export function BucketsPanel({ currentBucket, predFwd12m, pi80Lo, pi80Hi, pi95Lo, pi95Hi }: Props) {
  return (
    <div className="two-col">
      {/* LEFT: table + forecast */}
      <div>
        <div className="chart-box">
          <div className="chart-title">
            <span>Walk-forward sign-constrained Ridge forecast (v5.7, n=120)</span>
            <span style={{ color: 'var(--text3)', fontSize: 10 }}>quintile buckets · Newey-West HAC CI · 80/95% PI scaled by VIX</span>
          </div>

          {/* Forecast bar */}
          <div className="forecast-bar-wrap">
            <div className="forecast-bar">
              <div className="pi-95-fill"
                style={{ left: `${bs(pi95Lo)}%`, right: `${100-bs(pi95Hi)}%` }} />
              <div className="pi-80-fill"
                style={{ left: `${bs(pi80Lo)}%`, right: `${100-bs(pi80Hi)}%` }} />
              <div className="pi-zero" style={{ left: `${bs(0)}%` }} />
              <div className="pi-point" style={{ left: `${bs(predFwd12m)}%` }} />
            </div>
            <div className="forecast-labels">
              <span style={{ color: 'var(--text3)', fontSize: 10 }}>{(bMin*100).toFixed(0)}%</span>
              <div style={{ textAlign: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: predFwd12m >= 0 ? 'var(--bull, #4ade80)' : 'var(--bear)' }}>
                  {pct(predFwd12m)} predicted 12m
                </span>
                <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 8 }}>
                  80% CI [{pct(pi80Lo, 0)}, {pct(pi80Hi, 0)}]
                </span>
              </div>
              <span style={{ color: 'var(--text3)', fontSize: 10 }}>{(bMax*100).toFixed(0)}%</span>
            </div>
          </div>

          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Score bucket</th>
                <th>n</th>
                <th>12m mean</th>
                <th>CI 95%</th>
                <th>% neg</th>
                <th>Worst</th>
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map((b) => {
                const isCurrent = b.lo === currentBucket.lo;
                const sparse = b.n < 5;
                const empty  = b.n === 0;
                const cls = b.mean < 0 ? 'bear' : b.mean < 0.07 ? 'warn' : b.mean < 0.15 ? 'neut' : 'bull';
                return (
                  <tr key={b.lo} className={isCurrent ? 'current-row' : ''} style={empty ? { opacity: 0.45 } : undefined}>
                    <td>
                      {isCurrent && '★ '}{b.label}
                      {sparse && !empty && (
                        <span title="Sparse sample — CI is wide" style={{ color: 'var(--warn)', marginLeft: 4 }}>*</span>
                      )}
                      {empty && (
                        <span title="No OOS predictions ever fell in this bucket" style={{ color: 'var(--text3)', marginLeft: 4 }}>—</span>
                      )}
                    </td>
                    <td style={{ color: sparse ? 'var(--warn)' : 'var(--text3)' }}>{b.n}</td>
                    <td className={empty ? '' : cls} style={{ fontWeight: 600 }}>{empty ? '—' : pct(b.mean)}</td>
                    <td style={{ color: 'var(--text3)', fontSize: 10 }}>
                      {empty ? '—' : `[${pct(b.ciLo, 0)}, ${pct(b.ciHi, 0)}]`}
                    </td>
                    <td className={empty ? '' : (b.pctNeg > 30 ? 'bear' : b.pctNeg > 15 ? 'warn' : 'bull')}>
                      {empty ? '—' : `${b.pctNeg.toFixed(0)}%`}
                    </td>
                    <td className={empty ? '' : 'bear'}>{empty ? '—' : pct(b.worst)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="callout callout-bear" style={{ marginTop: 12 }}>
          Currently in <strong>{currentBucket.label}</strong> — n={currentBucket.n} historical samples
          {currentBucket.n < 5 && currentBucket.n > 0 && (
            <span style={{ color: 'var(--warn)' }}> (sparse — wide CI)</span>
          )}.
          {currentBucket.n > 0 && <>
            {' '}12m mean {pct(currentBucket.mean)}, worst case {pct(currentBucket.worst)},{' '}
            {currentBucket.pctNeg.toFixed(0)}% ended negative.
          </>}
          {' '}Ridge model predicts <strong>{pct(predFwd12m)}</strong> with VIX-conditional
          95% interval [{pct(pi95Lo, 0)}, {pct(pi95Hi, 0)}].
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, lineHeight: 1.45 }}>
          <strong>*</strong> Sparse buckets (n &lt; 5): the model rarely emits scores at the extremes
          under the v5.7 sign-constrained ridge (α=5), so Q1 and Q5 may be thinly populated.
          This is a property of the prediction distribution, not a fixable defect.
        </div>
      </div>

      {/* RIGHT: CI visualisation per bucket */}
      <div className="chart-box">
        <div className="chart-title">
          <span>12m mean return by score quintile</span>
          <span style={{ color: 'var(--text3)' }}>with 95% confidence intervals</span>
        </div>
        <div className="bucket-bars">
          {BUCKETS.map((b) => {
            const isCurrent = b.lo === currentBucket.lo;
            const barW = Math.max(2, bs(b.mean) - bs(0));
            const barL = b.mean >= 0 ? bs(0) : bs(b.mean);
            return (
              <div key={b.lo} className={`bucket-row${isCurrent ? ' current-bucket-row' : ''}`}>
                <div className="bucket-row-label">{b.label}</div>
                <div className="bucket-row-bar-wrap">
                  <div className="bucket-row-ci"
                    style={{ left: `${bs(b.ciLo)}%`, right: `${100-bs(b.ciHi)}%` }} />
                  <div className="bucket-row-zero" style={{ left: `${bs(0)}%` }} />
                  <div className="bucket-row-mean"
                    style={{ left: `${barL}%`, width: `${barW}%`,
                      background: b.mean >= 0.10 ? 'var(--bull, #4ade80)' : b.mean >= 0 ? 'var(--warn)' : 'var(--bear)' }} />
                </div>
                <div className="bucket-row-val" style={{ color: b.mean >= 0 ? 'var(--bull, #4ade80)' : 'var(--bear)' }}>
                  {pct(b.mean)}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 12 }}>
          v5.7 sign-constrained Ridge · OOS Spearman ρ = 0.488 · α=5 · 4 active signals (PPI, AAII, Yield, Breadth)
        </div>
      </div>
    </div>
  );
}
