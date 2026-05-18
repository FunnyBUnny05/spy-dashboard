import { BucketDef, tteForScore } from '../lib/scoring';

interface Props {
  bucket: BucketDef;
  score: number;
}

function FwdRow({ label, value }: { label: string; value: number }) {
  const isPos = value >= 0;
  const width = Math.min(50, Math.abs(value * 100) * 2);
  return (
    <div className="fwd-row">
      <div className="fwd-lbl">{label}</div>
      <div className="fwd-bar">
        <div className="fwd-fill" style={{
          left: isPos ? '50%' : `${50 - width}%`,
          width: `${width}%`,
          background: isPos ? 'var(--bull)' : 'var(--bear)',
        }} />
        <div style={{ position: 'absolute', left: '50%', top: -4, width: 1, height: 13, background: 'rgba(255,255,255,0.15)' }} />
      </div>
      <div className={`fwd-val ${isPos ? 'bull' : 'bear'}`}>
        {isPos ? '+' : ''}{(value * 100).toFixed(1)}%
      </div>
    </div>
  );
}

function fmtMonths(stat: { median: number | null; pctNever: number | null }) {
  if (stat.median === null) return <span style={{ color: 'var(--text3)' }}>n/a</span>;
  const m = Math.round(stat.median);
  const tag = stat.pctNever && stat.pctNever >= 15
    ? <span style={{ color: 'var(--text3)', fontWeight: 400 }}> ({Math.round(stat.pctNever)}% never)</span>
    : null;
  return <>{m}<span style={{ color: 'var(--text3)', fontSize: 10 }}>m</span>{tag}</>;
}

export function ForwardReturns({ bucket, score }: Props) {
  const tte = tteForScore(score);
  return (
    <div className="card">
      <div className="stat-label">Fwd returns — this bucket (n={bucket.n})</div>
      <div style={{ marginTop: 12 }}>
        <FwdRow label="12m mean" value={bucket.mean} />
        <div style={bucket.ciReliable ? undefined : { opacity: 0.5 }}>
          <FwdRow label={bucket.ciReliable ? 'CI lo' : 'CI lo*'} value={bucket.ciLo} />
          <FwdRow label={bucket.ciReliable ? 'CI hi' : 'CI hi*'} value={bucket.ciHi} />
        </div>
        {!bucket.ciReliable && (
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
            * CI based on n_eff &lt; 3 effective independent observations; treat as indicative only.
          </div>
        )}
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border2)', fontSize: 11, color: 'var(--text3)', lineHeight: 1.8 }}>
        % negative 12m: <span className={bucket.pctNeg > 30 ? 'bear' : bucket.pctNeg > 15 ? 'warn' : 'bull'} style={{ fontWeight: 600 }}>
          {bucket.pctNeg.toFixed(0)}%
        </span>
        <br />
        Worst case: <span className="bear">{(bucket.worst * 100).toFixed(1)}%</span>
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border2)', fontSize: 11, lineHeight: 1.55 }}>
        <div style={{ color: 'var(--text2)', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase', fontSize: 10 }}>
          Median months until next…
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 4, rowGap: 2, fontSize: 11 }}>
          <div style={{ color: 'var(--text3)' }}>−5%</div>
          <div style={{ color: 'var(--text3)' }}>−10%</div>
          <div style={{ color: 'var(--text3)' }}>−15%</div>
          <div className="bear" style={{ fontWeight: 600 }}>{fmtMonths(tte.dd['5'])}</div>
          <div className="bear" style={{ fontWeight: 600 }}>{fmtMonths(tte.dd['10'])}</div>
          <div className="bear" style={{ fontWeight: 600 }}>{fmtMonths(tte.dd['15'])}</div>
          <div style={{ color: 'var(--text3)', marginTop: 4 }}>+5%</div>
          <div style={{ color: 'var(--text3)', marginTop: 4 }}>+10%</div>
          <div style={{ color: 'var(--text3)', marginTop: 4 }}>+20%</div>
          <div className="bull" style={{ fontWeight: 600 }}>{fmtMonths(tte.rally['5'])}</div>
          <div className="bull" style={{ fontWeight: 600 }}>{fmtMonths(tte.rally['10'])}</div>
          <div className="bull" style={{ fontWeight: 600 }}>{fmtMonths(tte.rally['20'])}</div>
        </div>
        <div style={{ color: 'var(--text3)', marginTop: 6, fontSize: 10 }}>
          Historical median (lookahead 36m, n={tte.n}). Drawdown measured from running peak.
        </div>
      </div>
    </div>
  );
}
