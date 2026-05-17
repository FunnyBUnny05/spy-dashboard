const BUCKETS = [
  { range: '0–20',   n: 18, mean: '−3.8%',  pctNeg: '61%', zone: 'DEFENSIVE',   bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.35)',   color: '#fca5a5' },
  { range: '20–40',  n: 15, mean: '+10.6%', pctNeg:  '7%', zone: 'NEUTRAL',     bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.35)',  color: '#fde68a' },
  { range: '40–60',  n: 35, mean: '+16.2%', pctNeg:  '0%', zone: 'INVESTED',    bg: 'rgba(74,222,128,0.07)', border: 'rgba(74,222,128,0.25)', color: '#86efac' },
  { range: '60–80',  n: 42, mean: '+15.5%', pctNeg:  '5%', zone: 'INVESTED',    bg: 'rgba(74,222,128,0.07)', border: 'rgba(74,222,128,0.25)', color: '#86efac' },
  { range: '80–100', n: 26, mean: '+25.0%', pctNeg:  '4%', zone: 'OPPORTUNITY', bg: 'rgba(96,165,250,0.10)', border: 'rgba(96,165,250,0.35)',  color: '#93c5fd' },
];

const CAVEAT = 'n_eff for Q1, Q2, Q5 is 1–2 (non-overlapping months). Point estimates are informative; confidence intervals are wide. Not a forecast.';

export function ThresholdsCard() {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 1, borderRadius: 6, overflow: 'hidden', border: '1px solid #333' }}>
        {BUCKETS.map(b => (
          <div key={b.range} style={{
            flex: 1,
            background: b.bg,
            borderRight: `1px solid ${b.border}`,
            padding: '8px 10px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: b.color, fontWeight: 700, marginBottom: 2 }}>{b.range}</div>
            <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 4 }}>{b.zone}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: b.color }}>{b.mean}</div>
            <div style={{ fontSize: 10, color: 'var(--text2)' }}>12m fwd return</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{b.pctNeg} neg · n={b.n}</div>
          </div>
        ))}
      </div>
      <div
        style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, paddingLeft: 2 }}
        title={CAVEAT}
      >
        ⓘ {CAVEAT}
      </div>
    </div>
  );
}
