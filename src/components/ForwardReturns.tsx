import { BucketDef } from '../lib/scoring';

interface Props {
  bucket: BucketDef;
}

function FwdRow({ label, value }: { label: string; value: number }) {
  const isPos = value >= 0;
  const width = Math.min(50, Math.abs(value) * 4); // cap at 50% bar width
  return (
    <div className="fwd-row">
      <div className="fwd-lbl">{label}</div>
      <div className="fwd-bar">
        <div
          className="fwd-fill"
          style={{
            left: isPos ? '50%' : `${50 - width}%`,
            width: `${width}%`,
            background: isPos ? 'var(--bull)' : 'var(--bear)',
          }}
        />
        <div style={{ position: 'absolute', left: '50%', top: -4, width: 1, height: 13, background: 'rgba(255,255,255,0.15)' }} />
      </div>
      <div className={`fwd-val ${isPos ? 'bull' : 'bear'}`}>
        {isPos ? '+' : ''}{value.toFixed(2)}%
      </div>
    </div>
  );
}

export function ForwardReturns({ bucket }: Props) {
  return (
    <div className="card">
      <div className="stat-label">Fwd returns — this bucket (n={bucket.n})</div>
      <div style={{ marginTop: 12 }}>
        <FwdRow label="3-month" value={bucket.fwd3m} />
        <FwdRow label="6-month" value={bucket.fwd6m} />
        <FwdRow label="12-month" value={bucket.fwd12m} />
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border2)', fontSize: 11, color: 'var(--text3)', lineHeight: 1.8 }}>
        Median 12m: <span className={bucket.median12m >= 0 ? 'bull' : 'bear'}>
          {bucket.median12m >= 0 ? '+' : ''}{bucket.median12m.toFixed(2)}%
        </span>
        <br />
        % negative 12m: <span className={bucket.pctNeg > 50 ? 'bear' : bucket.pctNeg > 25 ? 'warn' : 'bull'} style={{ fontWeight: 600 }}>
          {bucket.pctNeg}%
        </span>
        <br />
        Worst case: <span className="bear">{bucket.worst12m.toFixed(2)}%</span>
      </div>
    </div>
  );
}
