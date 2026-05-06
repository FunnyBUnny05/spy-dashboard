import { BucketDef } from '../lib/scoring';

interface Props {
  bucket: BucketDef;
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

export function ForwardReturns({ bucket }: Props) {
  return (
    <div className="card">
      <div className="stat-label">Fwd returns — this bucket (n={bucket.n})</div>
      <div style={{ marginTop: 12 }}>
        <FwdRow label="12m mean" value={bucket.mean} />
        <FwdRow label="CI lo"    value={bucket.ciLo} />
        <FwdRow label="CI hi"    value={bucket.ciHi} />
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border2)', fontSize: 11, color: 'var(--text3)', lineHeight: 1.8 }}>
        % negative 12m: <span className={bucket.pctNeg > 30 ? 'bear' : bucket.pctNeg > 15 ? 'warn' : 'bull'} style={{ fontWeight: 600 }}>
          {bucket.pctNeg.toFixed(0)}%
        </span>
        <br />
        Worst case: <span className="bear">{(bucket.worst * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}
