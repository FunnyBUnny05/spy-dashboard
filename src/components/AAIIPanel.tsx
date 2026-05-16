import { AAIIResult, AAIIReading } from '../lib/scoring';
import { AAIIChart } from './AAIIChart';

interface Props {
  aaii: AAIIResult;
  history: AAIIReading[];
}

/**
 * Find historical episodes where the spread Z-score crossed extreme bounds.
 * Returns recent extremes for the contextual table.
 */
function findHistoricalExtremes(history: AAIIReading[], threshold: number) {
  // Compute spread series and its z-score in-line
  const spreads = history.map((r) => r.stocks - r.cash);
  const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const variance = spreads.reduce((a, b) => a + (b - mean) ** 2, 0) / (spreads.length - 1);
  const std = Math.sqrt(variance);
  const zs = spreads.map((s) => (s - mean) / std);

  const extremes: { date: string; z: number; stocks: number; cash: number; type: 'greed' | 'fear' }[] = [];
  for (let i = 0; i < history.length; i++) {
    if (Math.abs(zs[i]) >= threshold) {
      // Only mark turning points (local extreme): z is more extreme than all ±3-month neighbours.
      // A 1-month window misses plateaus where neither point strictly exceeds the other.
      const WINDOW = 3;
      const neighbours = zs.slice(Math.max(0, i - WINDOW), i).concat(zs.slice(i + 1, i + WINDOW + 1));
      const isLocalMax = zs[i] > 0 && neighbours.every(n => zs[i] >= n);
      const isLocalMin = zs[i] < 0 && neighbours.every(n => zs[i] <= n);
      if (isLocalMax || isLocalMin) {
        extremes.push({
          date: history[i].date,
          z: zs[i],
          stocks: history[i].stocks,
          cash: history[i].cash,
          type: zs[i] > 0 ? 'greed' : 'fear',
        });
      }
    }
  }
  return extremes;
}

// Annotated context for famous AAII extremes - what followed the reading
const HISTORICAL_NOTES: Record<string, string> = {
  '1999-12': 'Dot-com top within 3 months',
  '2000-03': 'Dot-com peak month - SPY -49% over 30m',
  '2007-06': 'Pre-GFC peak - SPY -55% over 17m',
  '2009-03': 'GFC bottom - SPY +70% over 12m',
  '2011-09': 'EU crisis low - SPY +30% over 12m',
  '2020-03': 'COVID crash low - SPY +75% over 12m',
  '2022-09': 'Bear market low - SPY +27% over 12m',
};

export function AAIIPanel({ aaii, history }: Props) {
  const greedExtremes = findHistoricalExtremes(history, 1.5)
    .filter((e) => e.type === 'greed')
    .slice(-8);
  const fearExtremes = findHistoricalExtremes(history, 1.5)
    .filter((e) => e.type === 'fear')
    .slice(-8);

  return (
    <>
      <div className="two-col">
        <div className="chart-box">
          <div className="chart-title">
            <span>AAII allocation history (1987-{aaii.reading.date})</span>
            <span style={{ color: 'var(--text3)' }}>
              Stocks · Cash · Bonds · dashed = full-sample mean
            </span>
          </div>
          <div className="chart-wrap" style={{ height: 320 }}>
            <AAIIChart history={history} stats={aaii.stats} />
          </div>
        </div>

        <div>
          <div className="chart-box">
            <div className="chart-title">
              <span>How the contrarian read works</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
              <p style={{ marginBottom: 10 }}>
                AAII surveys ~600 retail investors monthly on portfolio allocation. Historically:
              </p>
              <ul style={{ paddingLeft: 18, marginBottom: 12 }}>
                <li>Stock weight peaks <em>before</em> bear markets (1999, 2007, 2021)</li>
                <li>Cash weight peaks <em>at</em> or near bottoms (2009, 2020, 2022)</li>
                <li>The signal is a <strong>contrarian indicator</strong> — fade extremes</li>
              </ul>
              <p style={{ marginBottom: 10 }}>
                The composite uses the <strong>Z-score of the (stocks − cash) spread</strong>. This
                avoids double-counting when both extremes move together, and produces one clean
                contrarian metric.
              </p>
              <div style={{ background: 'var(--bg3)', borderRadius: 6, padding: 12, fontSize: 11, marginTop: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ color: 'var(--text3)', fontSize: 10 }}>Current spread</div>
                    <div style={{ color: 'var(--text)', fontSize: 14 }}>
                      {((aaii.reading.stocks - aaii.reading.cash) * 100).toFixed(1)} pp
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text3)', fontSize: 10 }}>Z-score</div>
                    <div style={{ color: aaii.zSpread > 0 ? 'var(--bear)' : 'var(--bull)', fontSize: 14 }}>
                      {aaii.zSpread >= 0 ? '+' : ''}{aaii.zSpread.toFixed(2)}σ
                    </div>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  Score mapping: Z=−2 → 100 (max bullish). Z=0 → 50. Z=+2 → 0 (max bearish).
                  Linear, clamped at ±2.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="chart-box">
          <div className="chart-title">
            <span>Historical extreme greed (Z ≥ +1.5) — recent local peaks</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Stocks %</th>
                <th>Cash %</th>
                <th>Z</th>
                <th>What followed</th>
              </tr>
            </thead>
            <tbody>
              {greedExtremes.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--text3)', textAlign: 'center' }}>None in dataset</td></tr>
              )}
              {greedExtremes.map((e) => (
                <tr key={e.date}>
                  <td>{e.date}</td>
                  <td>{(e.stocks * 100).toFixed(1)}%</td>
                  <td>{(e.cash * 100).toFixed(1)}%</td>
                  <td className="bear">+{e.z.toFixed(2)}</td>
                  <td style={{ color: 'var(--text2)', fontSize: 11 }}>
                    {HISTORICAL_NOTES[e.date] || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="chart-box">
          <div className="chart-title">
            <span>Historical extreme fear (Z ≤ −1.5) — recent local troughs</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Stocks %</th>
                <th>Cash %</th>
                <th>Z</th>
                <th>What followed</th>
              </tr>
            </thead>
            <tbody>
              {fearExtremes.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--text3)', textAlign: 'center' }}>None in dataset</td></tr>
              )}
              {fearExtremes.map((e) => (
                <tr key={e.date}>
                  <td>{e.date}</td>
                  <td>{(e.stocks * 100).toFixed(1)}%</td>
                  <td>{(e.cash * 100).toFixed(1)}%</td>
                  <td className="bull">{e.z.toFixed(2)}</td>
                  <td style={{ color: 'var(--text2)', fontSize: 11 }}>
                    {HISTORICAL_NOTES[e.date] || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {aaii.staleDays > 60 && (
        <div className="callout callout-warn">
          <strong>⚠ Data is {aaii.staleDays} days old.</strong> AAII publishes this survey monthly.
          The latest reading in the dataset is <strong>{aaii.reading.date}</strong>. To refresh,
          download the latest .xls from{' '}
          <a href="https://www.aaii.com/files/surveys/sentiment.xls" style={{ color: 'var(--blue)' }}>
            aaii.com
          </a>
          {' '}(asset allocation file: <code>asset.xls</code>), drop it in <code>data/raw/</code>,
          and run <code>npm run update-aaii</code>.
        </div>
      )}

      <div className="callout callout-aaii">
        <strong>Current read.</strong> Stocks {(aaii.reading.stocks * 100).toFixed(1)}% (
        {aaii.pctStocks.toFixed(0)}th percentile), Cash {(aaii.reading.cash * 100).toFixed(1)}% (
        {aaii.pctCash.toFixed(0)}th percentile), Z-spread {aaii.zSpread >= 0 ? '+' : ''}
        {aaii.zSpread.toFixed(2)}σ. {aaii.flagLabel}.
        {' '}Sub-score: <strong>{aaii.score.toFixed(0)}/100</strong> (display gauge only — the composite
        uses the rank-Gauss-normalised spread directly via the Ridge, not a weighted sub-score).
        {' '}<em>Important caveat:</em> AAII is one of the noisier sentiment signals. Use it as
        confirmation alongside Margin Debt and Buffett — not as a standalone trigger.
      </div>
    </>
  );
}
