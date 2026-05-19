# SPY Dashboard — Changelog

This file records every meaningful change, why it was made, and what bug it fixed.
Use it to avoid repeating the same mistakes.

---

## [v5.7.4] — 2026-05-19

### Accuracy fixes X1/X2 — walk_forward_score.py VIX divisor and pred/score consistency

- **X1 `scripts/walk_forward_score.py`** — Fixed `score_one()` VIX standardization bug: was dividing by `vix_z_mean` (18.38) instead of `vix_z_std` (6.63), compressing `vix_z` by ~2.77× and systematically under-estimating heteroscedasticity in high-VIX periods. Corrected to `(vix_raw - vix_z_mean) / vix_z_std`. Added `vix_z_std` parameter to both `score_one()` signature and `main()` call site. **Note:** Re-emission of corrected OOS scores requires the master dataset CSV at `/tmp/velv/master_dataset.csv` — current `model.json` timeseries data reflects the old (buggy) values until the script is re-run.
- **X2 `scripts/walk_forward_score.py`** — Implemented Option 1 (pred/score consistency): script now emits `pred` (walk-forward fit) alongside `score` into timeseries rows, so `pred` and `score` are always consistent for OOS rows. In-sample rows keep full-sample `pred` from `fit_ridge.py`. Same CSV dependency as X1.

---

## [v5.7.3] — 2026-05-18

### Audit findings Groups C, E, F — dashboard panels, proposals, test coverage

- **C1 `src/components/StrategyPanel.tsx`, `src/lib/backtest.ts`** — Added live-computed risk comparison table above the equity curve. New helpers `timeDDPct()` and `annualVol()` in backtest.ts. Table shows CAGR (tied), Max DD (composite better), Sharpe (better), Vol (lower), Time DD>5% (less time underwater) — the actual case for the composite over B&H.
- **C2 `src/components/BucketsPanel.tsx`** — Added PI coverage honesty badges: 95% PI labeled "(95% PI runs ~10pp narrow)" in amber (84.9% empirical vs 95% target); 80% CI labeled "(calibrated)" in muted (77.3% vs 80% target). Gauge.tsx unchanged — no PI display.
- **C3 `src/components/MathPanel.tsx`** — Added regime-conditional Spearman ρ table at top of MathPanel: 2010-15 ρ=0.19, 2016-20 ρ=0.38, 2021-26 ρ=0.82 (warned as partly in-sample).
- **E1 `docs/v3_audit/E1_threshold_proposal.md`** — Proposal: `stanceZoneFor` 3-zone system should be canonical; `scoreLabel` demoted to subtitle.
- **E2 `docs/v3_audit/E2_calibration_proposal.md`** — Proposal: apply post-hoc isotonic recalibration to `pred` in `scoring.ts` to fix 3-7pp over-optimism in deciles 6-9.
- **E3 `docs/v3_audit/E3_data_source_alignment.md`** — Proposal: add UI annotation near history chart explaining FRED vs TradingView/Yahoo ~4pt divergence.
- **F `src/lib/__tests__/scoring.test.ts`, `src/lib/__tests__/backtest.test.ts`** — Broadened test coverage from 20 to 29 tests. New: `computeV2` smoke test, `bucketFor` boundary edges, `scoreAAII` integration, `fiveTierExposure` boundaries, `cagr` known series, `maxDD` known sequence, `sma10Exposure` behavior.

---

## [v5.7.2] — 2026-05-18

### Audit findings Group A — code quality and honesty fixes

- **A1 `src/lib/scoring.ts`** — Removed dead `score_wf` field from `TsRow` interface and `getTimeseries` mapping. Every row in `model.json` has this field absent; it was advertised in the type but carried no data. `TrackRecordPanel` WF toggle now uses `inSample=false` rows as the fallback (shows "run scripts first" until `walk_forward_score.py` embeds real OOS scores).
- **A2 `src/lib/backtest.ts`, `src/components/StrategyPanel.tsx`** — Added `sma10Exposure()` function (10-month moving average benchmark) to `buildCurve`. Chart now shows a red dashed SMA10 line; metrics table includes SMA10 CAGR/DD/Sharpe. Audit found SMA CAGR=6.19% vs composite 12.46% — strongest evidence the composite isn't just a trend filter.
- **A3 `src/components/ForwardReturns.tsx`, `src/components/BucketsPanel.tsx`** — Surfaced `ciReliable` flag. CI values are dimmed (opacity 0.5) and marked `*` for buckets with n_eff < 3 (Q1 n_eff=2, Q2 n_eff=1, Q5 n_eff=2). Footnote added explaining the flag.
- **A4 `src/App.tsx`** — Simplified `scoreBadgeCls` dead branch: intentional 3-state design (bear/amber/bull), simplified to `s < 20 ? 'badge-bear' : s < 60 ? 'badge-warn' : 'badge-new'` with explanatory comment.
- **A5 `src/components/AlertBanner.tsx`** — Fixed dismissal key to be month-anchored (`{type}_{YYYY-MM}`) instead of score-based. Previous key re-fired when score drifted by 1 point across refreshes.
- **A6 `src/App.tsx`, `src/components/ExposureCard.tsx`** — Removed stale `prevExposure="20-40% (v5.1)"` prop (3 versions stale, no current meaning).
- **A7 `src/lib/scoring.ts`** — Updated rank-Gauss comment to accurately describe v5.7 (all 9 signals transformed) vs legacy v5.1 fallback (only ppi_yoy/mdebt_yoy).

---

## [v5.7.1] — 2026-05-18

### Label fixes (UI was lying about the deployed model)
- **`index.html`** — `<title>` updated v5.6 → v5.7
- **`src/App.tsx`** — header h1, subtitle, "Seven signals" section, footer, signal counts
- **`src/lib/snapshot.ts`** — docstring + field-group comment
- **`src/lib/scoring.ts`** — top-of-file version-history block
- **`src/components/HistoryPanel.tsx`** — callout text
- **`src/components/BucketsPanel.tsx`** — chart title, caveat, footer
- **`src/components/MathPanel.tsx`** — chart titles, methodology callout

**Why:** `model.json` had been v5.7 (MFI pruned, 4 active predictors, OOS ρ=0.488) since the last
retrain. The UI still showed v5.6 / "5 active signals (MFI, PPI, AAII, Yield, Breadth)" / "ρ=0.480".
Pure misdescription — the model itself was correct, only the labels were wrong.

### Bug fix — pre-1970 unix timestamps in CSV parsers
**Files:** `SpyCsvDrop.tsx`, `VixCsvDrop.tsx`, `YieldCurveCsvDrop.tsx`, `BreadthCsvDrop.tsx`

**Root cause:** `normalizeDate` used the regex `/^\d{9,11}$/` which only matched positive 9–11 digit
timestamps. TradingView's 1M (monthly) exports of SPX go back to 1871 (negative epoch values) and
include 1970–Sept 1973 bars (8-digit positives). Both patterns leaked through `normalizeDate` as
literal strings. After `Array.sort()`, `"99844200"` (a Mar-1973 bar) sorted to the END of the
array lexicographically (strings sort digit-by-digit), so `rows[rows.length - 1]` was a 1973 bar,
`latest` was `"99844200"`, and `asOf` showed that raw string instead of a date. All derived
12-month returns were garbage.

**Fix:** Replaced regex with a numeric range check that accepts signed integers in a plausible
epoch range (years 1800–2200), handles 13-digit millisecond timestamps, and throws on unparseable
values instead of silently passing them through.

**Verified fix output (vs user's actual CSVs):**
| Signal | Before | After |
|--------|--------|-------|
| `asOf` | `99844200 / 99792000` | `2026-05-01` |
| SPX 12m return | garbage | +25.32% |
| Yield spread | +0.30pp (10Y CSV starts 1912, old bug) | +0.92pp |

### Bug fix — BreadthCsvDrop hard-coded weekly bar count for 12m lookback
**File:** `src/components/BreadthCsvDrop.tsx`

**Root cause:** `rows[rows.length - 53]` assumed weekly RSP bars (52 weeks + 1). User uploaded
monthly RSP data, so this returned the close from **53 months ago** instead of 12 months ago.
`breadth_12m_chg` was therefore a ~4.4-year return (+29.50% instead of +14.24%), and the breadth
ratio was +25.0% (was actually −8.84%).

**Fix:** Replaced the hard-coded index with a date-based binary search for the row closest to
`(latest − 365 days)`. Works for daily, weekly, and monthly uploads.

**Verified fix output:**
| Signal | Before | After |
|--------|--------|-------|
| RSP 12m return | +29.50% | +14.24% |
| Breadth ratio | +25.0% | −8.84% |
| Composite score | ~13.8 → EXTREME CAUTION | ~27 → DEFENSIVE |

**Commit:** `689f30d`

---

## [v5.7.0] — 2026-05-17

### Model retrain — MFI pruned, 4 active predictors
- MFI signal removed from model (low OOS predictive power)
- Active predictors: PPI, AAII, Yield Curve, Breadth
- OOS Spearman ρ: 0.488 (was 0.480)
- `model.json` updated with new coefficients and walk-forward scores

**Commit:** `d21e83d` (sync), `988564b` (WF scores)

### Fix — SPY price chart showing stale CSV price
**File:** `src/App.tsx`

**Root cause:** `priceLatest` from the uploaded SPY CSV was used for the sparkline. If the CSV was
a few days old the chart showed a sharp drop at the end (CSV last close → current price jump).

**Fix:** Switched to `CURRENT.spyPrice` (live fetched) so the chart endpoint always matches live.

**Commit:** `9ce258c`

---

## [v5.6] — 2026-05-14

### Feature — TrackRecord panel, AlertBanner, ThresholdsCard, traffic-light gauge
- `TrackRecordPanel`: equity curves, stats table, walk-forward toggle, lookahead caveat
- `AlertBanner`: exit/entry signals with sessionStorage dismissal
- `ThresholdsCard`: 5-bucket score reference card with forward return stats
- `ScoreSparkline`: 12-month score sparkline + gauge uncertainty band + drift tooltip
- Traffic-light class applied to gauge badge

**Commits:** `3275d39`, `3ce8381`, `3f1b523`, `49d5e51`, `ce23e29`

### Feature — YearByYearChart with grouped bar attribution
**Commit:** `caf91d9`

### Feature — scoring helpers: stanceZoneFor, scoreUncertainty, TsRow.score_wf
**Commit:** `b8a4f7a`

---

## Known Issues (logged but NOT fixed — needs design decision before touching)

| Issue | File | Notes |
|-------|------|-------|
| Three coexisting threshold systems | `scoring.ts`, `App.tsx` | `stanceFor` (20/40/60/80), `stanceZoneFor` (30/80), `scoreLabel` (20/40/60/80) — at score=35 UI says "NORMAL" zone and "CAUTIOUS" label simultaneously |
| Dead branch in `scoreBadgeCls` | `App.tsx:173` | Two consecutive `'badge-warn'` returns — copy-paste error or intentional collapse |
| Stale `prevExposure` reference | `App.tsx:236` | `prevExposure="20-40% (v5.1)"` — may be intentional historical comparison |
| `BucketDef.ciReliable` not surfaced | `ForwardReturns.tsx` | Q1/Q2/Q5 render statistically unreliable CIs with no UI indication |
| Embedded May-2026 score in model.json differs from live score | `model.json`, `App.tsx` | `timeseries[].score` (from FRED) vs snapshot.ts (from TradingView/Yahoo) — cosmetic but track-record panel uses slightly different number |
| `AlertBanner` dismissalKey includes rounded score | `AlertBanner.tsx:50` | Dismissing at 19 re-fires when score drifts to 18 — should key on month |
| Misleading legacy comment about rank-Gauss defaults | `scoring.ts:109` | Comment says "defaults" but all 9 signals are RG-transformed now |
| AAII `staleDays` anchors to day 1 of month | `snapshot.ts` | Weekly survey precision lost |
| Missing test coverage | `src/lib/__tests__/scoring.test.ts` | Only `stanceZoneFor` and `scoreUncertainty` covered — `computeV2`, `bucketFor`, `rankGauss`, `scoreAAII` untested |

**Do not fix any of these without asking the user first.**
