import { AAIIResult } from '../lib/scoring';
import { toneColor, toneForScore } from '../lib/format';

interface Props {
  aaii: AAIIResult;
}

export function AAIICard({ aaii }: Props) {
  const tone = toneForScore(aaii.score);
  const color = toneColor(tone);
  const stocksPct = aaii.reading.stocks * 100;
  const cashPct = aaii.reading.cash * 100;
  const isStale = aaii.staleDays > 60;

  // Position on Z-spread spectrum (-2 to +2)
  const zClamped = Math.max(-2, Math.min(2, aaii.zSpread));
  const needlePos = ((zClamped + 2) / 4) * 100;

  return (
    <div className="card" style={{ borderColor: 'rgba(212,160,23,0.25)' }}>
      <div className="stat-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>AAII Asset Allocation <span className="aaii-color" style={{ marginLeft: 4 }}>★ NEW</span></span>
        {isStale && (
          <span className="stale-warn" title={`Last reading: ${aaii.reading.date}`}>
            ⚠ {aaii.staleDays}d old
          </span>
        )}
      </div>
      <div className="stat-val" style={{ color, marginTop: 8 }}>
        Z {aaii.zSpread >= 0 ? '+' : ''}{aaii.zSpread.toFixed(2)}σ
      </div>
      <div className="stat-sub">
        Stocks: <strong style={{ color: 'var(--text)' }}>{stocksPct.toFixed(1)}%</strong> ({aaii.pctStocks.toFixed(0)}th pct)
        <br />
        Cash: <strong style={{ color: 'var(--text)' }}>{cashPct.toFixed(1)}%</strong> ({aaii.pctCash.toFixed(0)}th pct)
        <br />
        Hist mean: 62% / 16% / 22% (S/B/C)
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 4 }}>Contrarian spectrum (Z-spread)</div>
        <div style={{ height: 10, background: 'var(--bg3)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
          {/* Extreme fear (bullish contrarian) */}
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '15%', background: 'rgba(31,168,118,0.4)' }} />
          <div style={{ position: 'absolute', left: '15%', top: 0, height: '100%', width: '20%', background: 'rgba(31,168,118,0.2)' }} />
          {/* Neutral */}
          <div style={{ position: 'absolute', left: '35%', top: 0, height: '100%', width: '30%', background: 'rgba(140,147,153,0.15)' }} />
          {/* Greed */}
          <div style={{ position: 'absolute', left: '65%', top: 0, height: '100%', width: '20%', background: 'rgba(232,147,58,0.3)' }} />
          {/* Extreme greed */}
          <div style={{ position: 'absolute', left: '85%', top: 0, height: '100%', width: '15%', background: 'rgba(217,79,61,0.4)' }} />
          {/* Needle */}
          <div
            style={{
              position: 'absolute',
              left: `${needlePos}%`,
              top: -2,
              width: 3,
              height: 14,
              background: 'white',
              borderRadius: 1,
              transform: 'translateX(-50%)',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text3)', marginTop: 3 }}>
          <span>−2σ Fear</span>
          <span>0</span>
          <span>+2σ Greed</span>
        </div>
      </div>

      <div className="callout callout-aaii" style={{ marginTop: 10, padding: '8px 10px', fontSize: 10 }}>
        <strong style={{ color }}>{aaii.flagLabel}</strong>
      </div>
    </div>
  );
}
