import { BuffettChart } from './BuffettChart';

export function BuffettPanel() {
  return (
    <div className="two-col">
      <div>
        <div className="chart-box">
          <div className="chart-title">
            <span>Buffett Indicator — quarters with Z &gt; +2.0 (1971-2025)</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Ratio</th>
                <th>Z</th>
                <th>What followed</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>1997-Q3</td><td>141.5%</td><td className="warn">+2.13</td><td style={{ color: 'var(--text2)' }}>Bubble extended 2+ yrs</td></tr>
              <tr><td>1998-Q1</td><td>150.0%</td><td className="bear">+2.41</td><td style={{ color: 'var(--text2)' }}>LTCM crash -19%</td></tr>
              <tr><td>1999 Q1-Q2</td><td>147-153%</td><td className="bear">+2.21 to +2.44</td><td style={{ color: 'var(--text2)' }}>Melt-up to Q1 2000 top</td></tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td colSpan={4} style={{ color: 'var(--text3)', textAlign: 'left', padding: '4px 10px', fontSize: 11 }}>
                  Then 2000-2002 bear: SPY -49%
                </td>
              </tr>
              <tr><td>2020-Q3</td><td>200.0%</td><td className="bear">+2.09</td><td style={{ color: 'var(--text2)' }}>COVID melt-up</td></tr>
              <tr><td>2021-Q1</td><td>210.0%</td><td className="bear">+2.31</td><td className="bear">2022 bear: SPY -25%</td></tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td colSpan={4} style={{ color: 'var(--text3)', textAlign: 'left', padding: '4px 10px', fontSize: 11 }}>
                  Then 2022 bear: SPY -25%
                </td>
              </tr>
              <tr><td>2024-Q2</td><td>208.5%</td><td className="bear">+2.00</td><td style={{ color: 'var(--text2)' }}>SPY +24% in next 9m</td></tr>
              <tr><td>2024-Q4</td><td>221.5%</td><td className="bear">+2.29</td><td style={{ color: 'var(--text2)' }}>ATH in Q1 2025</td></tr>
              <tr className="current-row"><td>2025-Q1</td><td>228.0%</td><td className="bear">+2.43</td><td className="bear">Highest in dataset</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div className="chart-box">
          <div className="chart-title"><span>Buffett ratio over time vs trend and bands</span></div>
          <div className="chart-wrap" style={{ height: 260 }}>
            <BuffettChart />
          </div>
        </div>
        <div className="callout callout-warn">
          <strong>Buffett above +2 sigma: only 15 of 217 quarters in 54 years (6.9 percent).</strong>
          {' '}This is NOT a precise top-timer. The 1997-1999 episode lasted 7 quarters before the
          crash. The 2020-2021 episode lasted 3 quarters. Current is on its 4th quarter.
          {' '}<strong>The signal means valuation at historical extreme - not sell tomorrow.</strong>
        </div>
      </div>
    </div>
  );
}
