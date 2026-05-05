# SPY Composite Scoring Dashboard v3

8-signal composite valuation/sentiment dashboard for SPY. v3 adds the AAII
Asset Allocation Survey as a contrarian sentiment signal.

## Quick start

```bash
npm install
npm run dev
```

Opens at http://localhost:5173

## What's new in v3

| Version | Signals | Composite (Apr 2026) |
|---------|---------|----------------------|
| v1      | 6 (technical + macro)             | 32.9 |
| v2      | 7 (+ Buffett Indicator)           | 29.1 |
| v3      | **8 (+ AAII Asset Allocation)**   | computed at runtime |

### AAII signal logic

AAII surveys ~600 retail investors monthly. The signal is **contrarian**:
- Retail piles into stocks at tops (1999, 2007, 2021)
- Retail flees to cash at bottoms (2009, 2020, 2022)

We standardize the **(stocks − cash) spread** as a Z-score against the full
1987-present history, then map inversely to a 0-100 sub-score:
- Z = +2 → score 0   (extreme greed, bearish)
- Z = 0  → score 50  (neutral)
- Z = -2 → score 100 (extreme fear, bullish)

Hard contrarian flags fire at |Z| ≥ 1.5.

### Weight rebalance (v2 → v3)

To accommodate AAII (10%), v2 weights shrink proportionally:

```
v2: MFI 13 · PPI 17 · MDebt 17 · Trend 13 · OBV 13 · RSI 13 · Buffett 14 = 100
v3: MFI 12 · PPI 15 · MDebt 15 · Trend 12 · OBV 12 · RSI 12 · Buffett 12 · AAII 10 = 100
```

AAII gets the smallest weight because:
1. It's the noisiest of the four sentiment/valuation signals
2. It overlaps thematically with Margin Debt (both euphoria gauges)
3. AAII data lags by ~1 month vs Margin Debt's quarterly publication

## Project structure

```
spy-dashboard/
├── data/
│   └── raw/asset.xls          ← drop new AAII file here, then run update-aaii
├── scripts/
│   └── update_aaii.py         ← regenerates src/data/aaii.json
├── src/
│   ├── data/aaii.json         ← bundled AAII history (412 months)
│   ├── lib/
│   │   ├── scoring.ts         ← scoring logic + AAII Z-score math
│   │   ├── snapshot.ts        ← monthly editable signal values
│   │   ├── format.ts          ← color/label helpers
│   │   └── chartSetup.ts      ← Chart.js registration
│   ├── components/
│   │   ├── Gauge.tsx          ← composite score gauge (SVG)
│   │   ├── ForwardReturns.tsx ← bucket-based fwd returns card
│   │   ├── AAIICard.tsx       ← hero AAII card with contrarian spectrum
│   │   ├── ExposureCard.tsx   ← recommended SPY exposure
│   │   ├── SubScores.tsx      ← 8 signal cards
│   │   ├── BucketChart.tsx    ← bar chart of fwd returns by bucket
│   │   ├── HistoryChart.tsx   ← composite vs SPY price line chart
│   │   ├── BuffettChart.tsx   ← Buffett ratio with bands
│   │   ├── AAIIChart.tsx      ← AAII allocation history
│   │   ├── BucketsPanel.tsx   ← buckets tab content
│   │   ├── HistoryPanel.tsx   ← history tab content
│   │   ├── BuffettPanel.tsx   ← Buffett tab content
│   │   ├── AAIIPanel.tsx      ← AAII deep-dive tab (NEW)
│   │   ├── PlaybookPanel.tsx  ← action playbook tab
│   │   └── MathPanel.tsx      ← math/weights audit tab
│   ├── App.tsx                ← composition root + tab state
│   ├── main.tsx               ← React entry
│   └── index.css              ← global theme (matches v2 dashboard)
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Updating data

### AAII (monthly)

1. Download the latest Asset Allocation Survey xls from
   [aaii.com](https://www.aaii.com/) (look for "Asset Allocation Survey").
2. Save it to `data/raw/asset.xls` (overwrite the existing file).
3. Run:
   ```bash
   npm run update-aaii
   ```
4. Refresh the dev server.

The script regenerates `src/data/aaii.json` and prints the new latest reading
plus Z-scores to the terminal.

### Other signals (monthly snapshot)

Edit `src/lib/snapshot.ts`:

```typescript
export const CURRENT: Snapshot = {
  asOf: 'May 2026',          // ← bump this
  spyPrice: 720.65,           // ← latest close
  signals: {
    mfi:     { score: 35, raw: '...', desc: '...' },
    ppi:     { score: 32, raw: '...', desc: '...' },
    // ...
  },
  // ...
};
```

Score history (the 12-year line chart on the History tab) is in
`SCORE_HISTORY` in the same file — append a new row each month.

## Scoring math (audit-able)

All scoring lives in `src/lib/scoring.ts` as **pure functions**. You can write
unit tests against them without touching the UI:

```typescript
import { scoreAAII, computeComposite, bucketFor } from './lib/scoring';

const aaii = scoreAAII(history, stats);
expect(aaii.zSpread).toBeCloseTo(0.94, 2);
expect(aaii.flag).toBe('greed');
```

## Roadmap / ideas

- [ ] Persistence: save weight tweaks to localStorage so you can experiment
      with different weight schemes without editing code
- [ ] Backtest the v3 composite vs v2 over 2014-2026 to validate AAII's
      marginal contribution
- [ ] Add a "weight sensitivity" panel: ±5% on each weight, see how the
      composite shifts
- [ ] Auto-fetch AAII via cron (the published URL is stable)
- [ ] Replace the magic SCORE_HISTORY array with a CSV in /data + loader

## Honest caveats

1. **The bucket calibration table** (forward returns by score bucket) is
   based on the v2 system's history, not v3. After enough v3 readings
   accumulate, this should be re-fit.
2. **AAII as contrarian indicator** has historical support but is not a
   precise timer. The 1999-2000 bull lasted multiple quarters past the
   first extreme greed reading.
3. **Pre-2007 AAII data has gaps.** The full file has only ~423 monthly
   observations from Nov 1987 to Apr 2026 — there are gaps in 2007-2008
   and 2010-2012 where the survey was published less frequently. Stats
   are computed only on present months, so this doesn't bias the Z-score
   but does mean the historical sample is slightly less than 39 × 12.
