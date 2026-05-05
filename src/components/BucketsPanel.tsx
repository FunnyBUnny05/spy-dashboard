import { BUCKETS, BucketDef } from '../lib/scoring';
import { BucketChart } from './BucketChart';

interface Props {
  currentBucket: BucketDef;
}

export function BucketsPanel({ currentBucket }: Props) {
  return (
    <div className="two-col">
      <div>
        <div className="chart-box">
          <div className="chart-title">
            <span>Calibration table — fwd returns by score bucket (2010–2025)</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Bucket</th>
                <th>n</th>
                <th>3m</th>
                <th>6m</th>
                <th>12m</th>
                <th>median</th>
                <th>worst</th>
                <th>%neg</th>
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map((b) => {
                const isCurrent = b.label === currentBucket.label;
                const cls12 = b.fwd12m < 0 ? 'bear' : b.fwd12m < 5 ? 'warn' : b.fwd12m < 13 ? 'neut' : 'bull';
                return (
                  <tr key={b.label} className={isCurrent ? 'current-row' : ''}>
                    <td>{isCurrent && '★ '}{b.label}</td>
                    <td style={{ color: 'var(--text3)' }}>{b.n}</td>
                    <td className={b.fwd3m >= 0 ? 'bull' : 'bear'}>
                      {b.fwd3m >= 0 ? '+' : ''}{b.fwd3m.toFixed(2)}%
                    </td>
                    <td className={b.fwd6m >= 0 ? 'bull' : 'bear'}>
                      {b.fwd6m >= 0 ? '+' : ''}{b.fwd6m.toFixed(2)}%
                    </td>
                    <td className={cls12} style={{ fontWeight: 600 }}>
                      {b.fwd12m >= 0 ? '+' : ''}{b.fwd12m.toFixed(2)}%
                    </td>
                    <td className={b.median12m >= 0 ? 'bull' : 'bear'}>
                      {b.median12m >= 0 ? '+' : ''}{b.median12m.toFixed(2)}%
                    </td>
                    <td className="bear">{b.worst12m.toFixed(2)}%</td>
                    <td className={b.pctNeg > 50 ? 'bear' : b.pctNeg > 25 ? 'warn' : 'bull'}>
                      {b.pctNeg}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="callout callout-bear">
          <strong>The key threshold is composite ≥ 50.</strong> Above 50: 8–15% chance of negative
          12m, double-digit mean returns. Below 50: 50–100% chance of negative. Current bucket is{' '}
          <strong>{currentBucket.label}</strong> — historically n={currentBucket.n} samples, 12m
          mean {currentBucket.fwd12m >= 0 ? '+' : ''}{currentBucket.fwd12m.toFixed(2)}%.
        </div>
      </div>
      <div className="chart-box">
        <div className="chart-title">
          <span>12-month forward returns by bucket</span>
          <span style={{ color: 'var(--text3)' }}>mean (dark) · median (light)</span>
        </div>
        <div className="chart-wrap" style={{ height: 320 }}>
          <BucketChart />
        </div>
      </div>
    </div>
  );
}
