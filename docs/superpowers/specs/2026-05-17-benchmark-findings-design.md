# Design: Benchmark Findings Implementation

**Date:** 2026-05-17  
**Source:** `CLAUDE_CODE_HANDOFF.md` + `scripts/BENCHMARK_REPORT.md`  
**Scope:** All 10 changes from the handoff, including Change 9 (walk-forward recomputation)

---

## What the benchmark proved (do not oversell)

- The score does **not** add return vs. buy-and-hold (BH 12.41% CAGR vs STANCE 11.76%)
- The score **does** add risk-adjusted value: walk-forward TWO(30,80) Sharpe 0.95 vs BH 0.72, max drawdown −11.7% vs −24.8%
- Sharpe improvement **not statistically significant at 5%** (block-bootstrap 95% CI: [−0.055, +0.298], P=92.1%)
- Most stable walk-forward threshold: TWO(30, 80) — same in all 10 folds

---

## Navigation change

Add one new tab: **"Track Record"** inserted after the existing "Strategy A/B" tab.

`TabId` grows from `'buckets' | 'history' | 'strategy' | 'buffett' | 'aaii' | 'playbook' | 'math' | 'data'`  
to add `'trackrecord'`.

---

## Change 1 — 3-zone stance (replaces 5-zone in `scoring.ts`)

**New export in `scoring.ts`:**

```ts
export type ZoneLabel = 'DEFENSIVE' | 'NORMAL' | 'OPPORTUNITY';
export interface StanceZone {
  label: ZoneLabel;
  tone: 'bear' | 'neutral' | 'bull';
  action: string;
  color: 'red' | 'amber' | 'green';
}
export function stanceZoneFor(score: number): StanceZone {
  if (score < 30)  return { label: 'DEFENSIVE',   tone: 'bear',    action: 'Reduce exposure · tighten stops · no new buys', color: 'red'   };
  if (score < 80)  return { label: 'NORMAL',       tone: 'neutral', action: 'Hold target exposure',                         color: 'amber' };
  return                   { label: 'OPPORTUNITY', tone: 'bull',    action: 'Add on weakness',                              color: 'green' };
}
```

**Keep** the existing `stanceFor()` (5-zone) and `ExposureCard` intact — the 5-zone data is still used for the ExposureCard and PlaybookPanel.

**Add to `V5Result`:**
```ts
stanceZone: StanceZone;
```

**UI:** Replace the current score label badges in `App.tsx` with a traffic-light indicator: colored dot (red/amber/green) + zone label + score range. The existing score badge becomes `SCORE 25 [20–31]` (see Change 4).

---

## Change 2 — Exit alert banner

**New component:** `src/components/AlertBanner.tsx`

**Props:**
```ts
interface AlertBannerProps {
  score: number;
  timeseries: TsRow[];  // last 3 months used for crossing detection
}
```

**Crossing detection** (computed from last 3 timeseries rows):
- `prevScore` = score from 1 month ago (last scored row before current)
- `prevLow`   = minimum score in last 6 months

**Three banner states** (evaluated in priority order — only the highest shows):

| Priority | Condition | Color | Message |
|----------|-----------|-------|---------|
| 1 | `score < 20` | Red | "Q1 zone. Historical 12m return at this score: −3.8%, 61% chance of being negative (n=18). Consider tightening stops or reducing exposure." |
| 2 | `prevScore >= 30 && score < 30` (crossed down this month) | Amber | "Score dropped into defensive zone this month. This signal preceded the 2022 bear (Dec 2021, score=2.2) and 2011 summer drawdown (Apr 2011, score=13.1)." |
| 3 | `score >= 60 && prevScore < 60 && prevLow < 30` (recovery from defensive) | Green | "Recovery from defensive zone. Historical Q4/Q5 forward returns: +15–25% mean." |

**Dismissal:** `sessionStorage` key `alert_banner_dismissed`. Storing the dismissed banner type + score rounded to nearest integer. On next render, if the banner type or score (rounded) differs from the stored value, the banner re-shows automatically. This means a new crossing always surfaces, and the user never has to dismiss the same alert twice in a single session.

**Placement:** Very top of the page, above the header, full width.

---

## Change 3 — Year-by-year attribution chart

**New component:** `src/components/YearByYearChart.tsx`

Data is **inlined** (from `scripts/BENCHMARK_REPORT.md` — does not change without retraining):

```ts
const YEAR_DATA = [
  { year: 2011, bh:  0.00, stance:  5.25 },
  { year: 2012, bh: 13.40, stance: 12.10 },
  { year: 2013, bh: 29.60, stance: 24.30 },
  { year: 2014, bh: 12.40, stance:  6.90 },
  { year: 2015, bh:  1.40, stance:  1.10 },
  { year: 2016, bh:  9.50, stance:  7.20 },
  { year: 2017, bh: 20.20, stance: 11.00 },
  { year: 2018, bh: -6.20, stance: -4.10 },
  { year: 2019, bh: 28.90, stance: 23.50 },
  { year: 2020, bh: 29.00, stance: 31.20 },
  { year: 2021, bh: 13.60, stance:  7.10 },
  { year: 2022, bh: -6.54, stance:  1.57 },
  { year: 2023, bh: 24.20, stance: 20.80 },
  { year: 2024, bh: 15.90, stance: 10.10 },
  { year: 2025, bh: 15.50, stance: 19.10 },
];
```

*Note: years 2012–2019, 2023 values above are approximate fills — exact values should be extracted from `scripts/verify_backtest.py` output before finalizing. The 4 "best" and 4 "worst" years from the benchmark report are exact.*

**Chart:** Grouped bar chart (recharts `BarChart`) — gray bar for BH, blue for STANCE, red fill when STANCE < BH. Caption: *"The score helped most in 2011, 2020, 2022, and 2025. It hurt most in 2014, 2017, 2021, 2024 — strong bull years where it was over-cautious."*

**Placed in:** Track Record tab, below the equity curves section.

---

## Change 4 — Score uncertainty band

**New function in `scoring.ts`:**

```ts
export function scoreUncertainty(pred: number, sigmaT: number, drift: number): { lo: number; hi: number } {
  return {
    lo: Math.round(normCdf((pred - drift - sigmaT) / sigmaT) * 100),
    hi: Math.round(normCdf((pred - drift + sigmaT) / sigmaT) * 100),
  };
}
```

**Add to `V5Result`:**
```ts
scoreLo: number;  // 1σ low
scoreHi: number;  // 1σ high
```

**UI:** In `App.tsx` header badge: `SCORE 25 [20–31]` where `[lo–hi]` is styled in a muted color. Same display in the Gauge component score label.

---

## Change 5 — 12-month score history sparkline

**New component:** `src/components/ScoreSparkline.tsx`

**Props:**
```ts
interface Props { timeseries: TsRow[]; }
```

Takes the last 12 scored rows from timeseries. Renders an inline SVG (no chart library needed — 12 points, simple polyline). Reference lines at score=30 (red dashed) and score=80 (green dashed). Dot on the current point.

**Placed in:** Inside the score card in the hero row (below the score number, above the drift tooltip).

---

## Change 6 — Backtest panel

**New component:** `src/components/TrackRecordPanel.tsx`

Extract `buildCurve()`, `cagr()`, `maxDD()`, and `sharpe()` from `StrategyPanel.tsx` into a new `src/lib/backtest.ts` module shared by both `StrategyPanel` and `TrackRecordPanel`. Renders:

1. Recharts `LineChart` — two series: BH (gray) and STANCE_NL (blue), using the 5-zone exposure tiers from `fiveTierExposure()`.
2. Stats table (hardcoded from benchmark, updated if model retrains):

| | BH | STANCE_NL |
|--|--|--|
| Final value | 5.96× | 5.45× |
| CAGR | 12.41% | 11.76% |
| Sharpe | 0.72 | 0.84 |
| Max drawdown | −24.8% | −16.4% |

3. Honest caption (verbatim from handoff).
4. Walk-forward toggle (see Change 9).

---

## Change 7 — Drift anchor tooltip

**In `App.tsx` or `Gauge.tsx`:** Add a `ⓘ` icon next to the score display. Tooltip text:

> "Score 50 = predicted return matches the 2009–2026 sample mean (~15%/yr). This is above the long-run SPY average (~10%). A score of ~40 corresponds to a neutral expectation vs. long-run base rates."

Implementation: simple `title` attribute or a small CSS tooltip — no new dependency.

---

## Change 8 — Lookahead caveat

**In `TrackRecordPanel.tsx`:** Static blue info box at the bottom of the tab:

> "Historical scores were computed using a model fit on the full 2009–2026 sample. A real-time score computed in 2015 would have been similar but noisier (no future signal distribution to reference). The walk-forward score toggle above shows temporally-honest scores refitted at each step."

---

## Change 9 — Walk-forward score recomputation (Python + UI)

### Python script: `scripts/walk_forward_score.py`

Algorithm:
1. Load the master dataset (same source as `fit_ridge.py`).
2. Start at month index 60 (need ≥60 months training data).
3. For each month `t` from 60 to end:
   - Training rows: `[0, t−12)` — exclude last 12 months (their 12m forward returns are not yet realized).
   - Fit ridge on those rows (same sign-constraint, same α=5).
   - Compute rank-Gauss for month `t` using only the sorted reference array from training rows.
   - Predict score for month `t` with this temporally-honest model.
4. Output: for each month, both `score` (existing full-sample) and `score_wf` (walk-forward).
5. Patch `src/data/model.json` timeseries rows to add `score_wf` field where available.

### `scoring.ts` change:
Update `TsRow` type:
```ts
export interface TsRow {
  date: string;
  spy: number;
  score: number | null;
  score_wf: number | null;  // new
  pred: number | null;
  regime: string;
  inSample: boolean;
}
```

Update `getTimeseries()` to map `r.score_wf ?? null`.

### UI: walk-forward toggle in `TrackRecordPanel.tsx`

A checkbox "Show walk-forward score" controls which score series is used for the equity curve in that tab only. The main page and all other tabs always use the full-sample score.

---

## Change 10 — Actionable thresholds reference card

**New component:** `src/components/ThresholdsCard.tsx`

Five color-coded cells, data inlined from the handoff (matches `BUCKETS` in `model.json`):

| Score | n | Mean 12m | % Neg | Zone |
|-------|---|----------|-------|------|
| 0–20  | 18 | −3.8%   | 61%   | DEFENSIVE |
| 20–40 | 15 | +10.6%  | 7%    | NEUTRAL |
| 40–60 | 35 | +16.2%  | 0%    | INVESTED |
| 60–80 | 42 | +15.5%  | 5%    | INVESTED |
| 80–100| 26 | +25.0%  | 4%    | OPPORTUNITY |

Caveat tooltip: "n_eff for Q1, Q2, Q5 is 1–2 (non-overlapping months). Point estimates are informative; confidence intervals are wide. Not a forecast."

**Placed in:** `App.tsx`, full-width row below the hero cards, above the tab bar.

---

## Files to create

| File | Purpose |
|------|---------|
| `src/components/AlertBanner.tsx` | Exit/entry alert banner (Change 2) |
| `src/components/ScoreSparkline.tsx` | 12m sparkline (Change 5) |
| `src/components/ThresholdsCard.tsx` | Reference card (Change 10) |
| `src/components/TrackRecordPanel.tsx` | Track Record tab (Changes 3, 6, 7, 8, 9) |
| `src/components/YearByYearChart.tsx` | Attribution bar chart (Change 3) |
| `scripts/walk_forward_score.py` | Walk-forward score computation (Change 9) |
| `src/lib/backtest.ts` | Shared `buildCurve()`, `cagr()`, `maxDD()`, `sharpe()` extracted from StrategyPanel |

## Files to modify

| File | Changes |
|------|---------|
| `src/lib/scoring.ts` | Add `stanceZoneFor()`, `scoreUncertainty()`, update `V5Result` and `TsRow` types |
| `src/App.tsx` | Add tab, wire banner, reference card, traffic light, uncertainty band display |
| `src/components/Gauge.tsx` | Add drift tooltip, show uncertainty band |
| `src/data/model.json` | Patch `score_wf` into timeseries rows after running Change 9 script — run `scripts/walk_forward_score.py` first |

---

## What NOT to implement

- No buy/sell button or auto-execution
- No "beats the market" claim
- Do not replace the 5-bucket reference table (keep both 3-zone and 5-bucket)
- Do not optimize thresholds dynamically (keep 30/80 fixed)
- No transaction-cost simulation as a headline feature

---

## Implementation order

1. Change 2 (AlertBanner) — serves the primary user workflow
2. Change 10 (ThresholdsCard) — high density, low effort
3. Change 5 (ScoreSparkline) — low effort, big interpretability gain
4. Change 6 + 8 (TrackRecordPanel skeleton + lookahead note) — new tab frame
5. Change 1 (stanceZoneFor in scoring.ts + traffic light in App.tsx)
6. Change 4 (scoreUncertainty in scoring.ts + display)
7. Change 3 + YearByYearChart (run verify_backtest.py first to confirm all years)
8. Change 7 (drift tooltip — one-liner)
9. Change 9 (walk_forward_score.py + model.json patch + UI toggle)
