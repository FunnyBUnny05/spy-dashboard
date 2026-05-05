import { Stance } from '../lib/scoring';

interface Props {
  stance: Stance;
}

export function PlaybookPanel({ stance }: Props) {
  return (
    <div className="two-col">
      <div>
        <div className="chart-box">
          <div className="chart-title">
            <span>Score → position framework</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Score</th>
                <th>Stance</th>
                <th>SPY exposure</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="bull">&gt;70 Strong</td><td>Aggressive long</td><td>110-130%</td><td>Add on dips, lever</td></tr>
              <tr><td className="bull">60-70 Good</td><td>Bullish</td><td>90-100%</td><td>Full long, no hedges</td></tr>
              <tr><td style={{ color: 'var(--text2)' }}>50-60 Above avg</td><td>Neutral+</td><td>75-90%</td><td>Long bias, light hedges</td></tr>
              <tr><td className="warn">40-50 Below avg</td><td>Defensive</td><td>50-70%</td><td>Trim, raise cash</td></tr>
              <tr className={stance.label === 'Defensive heavy' ? 'current-row' : ''}>
                <td className="bear">30-40 Caution</td>
                <td>Defensive heavy</td>
                <td>30-50%</td>
                <td>Reduce significantly</td>
              </tr>
              <tr className={stance.label === 'Wait / buy panic' ? 'current-row' : ''}>
                <td>{stance.label === 'Wait / buy panic' && '★ '}&lt;30 Extreme</td>
                <td>Wait / buy panic</td>
                <td>20-40%</td>
                <td>Hedged or buy after &gt;15% drawdown</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="chart-box" style={{ marginTop: 0 }}>
          <div className="chart-title">
            <span>Upgrade triggers — what lifts the score from here</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Trigger</th>
                <th>Signal affected</th>
                <th>Score impact</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>PPI MoM &lt; +0.2%</td><td>PPI: 32→50</td><td className="bull">+2.7 pts</td></tr>
              <tr><td>Margin debt YoY &lt; 30%</td><td>MDebt: 20→35</td><td className="bull">+2.3 pts</td></tr>
              <tr><td>OBV higher low on pullback</td><td>OBV: 15→50</td><td className="bull">+4.2 pts</td></tr>
              <tr><td>SPY -10% to ~$648 (Buffett Z→+2.0)</td><td>Buffett: 15→25</td><td className="bull">+1.2 pts</td></tr>
              <tr><td>AAII cash &gt; 25% (retail capitulation)</td><td>AAII: 38→65</td><td className="bull">+2.7 pts</td></tr>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td>All 5 triggers fire</td>
                <td>All</td>
                <td className="bull">~+13 pts → low 40s</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="chart-box">
          <div className="chart-title">
            <span>Why momentum alone won't escape this bucket</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.9, marginBottom: 14 }}>
            Even if MFI, Trend, OBV, RSI all recovered to 90 — the structural signals
            (PPI, Margin Debt, Buffett, AAII) combined are 52% of the weight and currently average
            ~25. The composite ceiling is mechanically capped:
          </div>
          <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: 14, fontSize: 12, color: 'var(--text2)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, textAlign: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>PPI (15%)</div>
                <div className="bear" style={{ fontSize: 18, fontWeight: 600 }}>32</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>MDebt (15%)</div>
                <div className="bear" style={{ fontSize: 18, fontWeight: 600 }}>20</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--purple)' }}>Buffett (12%)</div>
                <div className="bear" style={{ fontSize: 18, fontWeight: 600 }}>15</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--aaii)' }}>AAII (10%)</div>
                <div className="bear" style={{ fontSize: 18, fontWeight: 600 }}>38</div>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              Max composite if MFI/Trend/OBV/RSI all → 90:
              <br />
              <span style={{ color: 'var(--text)' }}>
                (90×0.48 + 32×0.15 + 20×0.15 + 15×0.12 + 38×0.10) ={' '}
                <strong style={{ fontSize: 16 }}>59.7</strong>
              </span>
              <br />
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                Assumes perfect tech signals — unrealistic
              </span>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
              Realistic ceiling next 6 months: <strong className="warn">~45-52</strong>
            </div>
          </div>
          <div className="callout callout-bear" style={{ marginTop: 12 }}>
            <strong>The cleanest path back above 40:</strong> SPY -8% → Buffett Z falls to ~+2.0,
            score 15→25. Plus PPI cooling, OBV stabilizing, and AAII cash rising. Without a price
            correction, structural signals anchor you below 40 indefinitely.
          </div>
        </div>
      </div>
    </div>
  );
}
