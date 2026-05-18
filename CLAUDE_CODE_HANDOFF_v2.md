# Handoff v2 — Accuracy Audit of the Updated Dashboard

**Read first:** v1 handoff (`CLAUDE_CODE_HANDOFF.md`) was partially implemented.
This audit checks the new state against the actual model math and the input data.
It finds real accuracy issues and lists fixes in priority order.

Audit ran against the dashboard reading shown 2026-05-17, score 13.8 [2-46].

---

## Verification — does the score reconcile?

**Yes.** Recomputed from displayed signals using the v5.7 ridge model:

```
pred_fwd_12m  =  +3.90%
drift         = +15.03%
sigma_t       =   0.1030  (VIX z≈0)
(pred-drift)/sigma_t = -1.08
score         = normCDF(-1.08) × 100  =  14.00   [band 2-47]
dashboard     =  13.8                              [band 2-46]
```

Difference of 0.2 is rounding/display precision on the input values. Math is correct.

What pushes the score down: **PPI (-3.83pp), AAII (-5.71pp), Breadth (-3.91pp)**.
What pushes it up: **Yield curve (+2.99pp)**.
Everything else (RSI, MFI, trend, mdebt, VIX) has **zero ridge coefficient** and
contributes nothing to the score. They are display-only.

---

## Issue 1 — TWO of the input signals are outside the historical training range

This is the **most important accuracy finding** in this audit. If the inputs are
wrong, the model extrapolates and the score is unreliable.

| Signal | Displayed | Historical range (2009-2026, n=184) | Status |
|---|---|---|---|
| RSI 14m | **21.8** | min 43.54, max 85.31 | **OUTSIDE — never observed** |
| Breadth 12m | **25.0** | min -13.18, max 10.03 | **OUTSIDE — >2.5× historical max** |
| EMA dist 12m | -13.82% | min -11.62, max 16.35 | Marginal — slightly outside |
| Margin debt YoY | +53.3% | min -33.30, max 71.60 | Within range, 99th pct |
| PPI YoY | 5.99% | within range, 88th pct | OK |
| AAII spread | 0.526 | within range, 77th pct | OK |
| VIX | 18.43 | within range, 65th pct | OK |
| Yield curve | 0.30 | within range, 31st pct | OK |

**The RSI value of 21.8 has never happened on a monthly basis in the sample.**
Possible explanations, in decreasing likelihood:

1. **The CSV ingest is reading the wrong timeframe** — e.g., daily RSI (which can be 21) instead of monthly RSI. Check `scripts/` or wherever the TradingView drop parses; confirm period column is monthly.
2. **The CSV had truncated/bad data** — check the most recent ingest log.
3. **Real but unprecedented** — would be the worst monthly RSI in 17 years.

**The breadth value of 25 is 2.5× higher than anything in the sample.**
Breadth is `(RSP/SPY now) / (RSP/SPY 12m ago) − 1, in %`. Either:

1. **Wrong unit** — value passed as `25.0` when it should be `0.25` (already a fraction, not a percent), or vice versa. Check `src/lib/snapshot.ts` line 60: comment says `-7.80` in May 2026 → if someone overwrote without conversion, units could be swapped.
2. **Wrong data source** — using a different breadth measure (eg cumulative advance-decline) and forgetting to recalibrate.

**Action for Claude Code:**

- Add **input-range validation** to `computeV2` in `src/lib/scoring.ts`. For each signal, if `value < sorted[0] − 0.1 × range` OR `value > sorted[-1] + 0.1 × range`, set a `signal.outOfRange = true` flag on the SignalSpec.
- In the UI, when a signal is `outOfRange`, mark the percentile badge red and add a tooltip: *"Value is outside the historical training range. Model is extrapolating; score may not be reliable."*
- Add a top-level banner that fires if **any** active-coef signal (PPI, AAII, yield curve, breadth) is out-of-range: *"⚠️ Input X is outside training range. Score is extrapolated."*
- Specifically for the current state: verify breadth value of 25 manually. Compute RSP/SPY ratio today vs. 12 months ago. If the actual change is closer to -8% or +10%, this is a data pipeline bug, not a model bug.

---

## Issue 2 — Stance label is still the old 5-bucket version

Dashboard header shows **"Stance: Wait / buy panic"** with old labels and `20-40% (v5.1)` reference.

The 5-bucket bucket strip below (DEFENSIVE / NEUTRAL / INVESTED / INVESTED / OPPORTUNITY) is correctly updated, but the headline stance string still calls `stanceFor()` (the 5-bucket function) instead of `stanceZoneFor()` (the new 3-zone function).

**Action:** In whatever component renders the stance card on the top-right, swap `stanceFor(score)` for `stanceZoneFor(score)` and adjust the markup. The 3-zone object has `{label, tone, action, color}`. Keep the exposure% from the bucket-midpoint logic if you want, or drop it — the 3-zone framework doesn't prescribe a specific exposure number.

---

## Issue 3 — UI version label is stale ("v5.4")

Title bar says **"SPY Composite Scoring Dashboard v5.4"**. The actual model in
`scoring.ts` is v5.7 (4 active signals, MFI pruned). Find the version string
(likely in `index.html` or a header component) and update to v5.7.

This matters because a user comparing two screenshots could think the model
changed when it didn't.

---

## Issue 4 — The 9-signal grid implies all signals affect the score; they don't

Five of the nine displayed signals (**RSI, MFI, EMA dist, Margin debt, VIX**)
have ridge coefficient exactly 0. They do not affect the score. The grid shows
them with the same prominence as the active ones, which is misleading.

**Action:** In the signal grid (`src/lib/scoring.ts` returns `signal.ridgeCoef`):

- Visually distinguish active vs. inactive signals. Active = the 4 with nonzero
  coef. Inactive = the other 5.
- One simple approach: dim the inactive cards to 60% opacity, or move them under
  a collapsed "Reference signals (not in score)" heading.
- Keep them visible because users want to see RSI/VIX context, but make clear
  they're informational.
- Add a tooltip or footer note: *"Active model signals: PPI, AAII, Yield curve, Breadth. RSI, MFI, EMA dist, Margin debt, VIX are shown for context but have zero ridge coefficient in v5.7."*

---

## Issue 5 — Prediction intervals are computed but not displayed

`computeV2` returns `pi80Lo, pi80Hi, pi95Lo, pi95Hi` (80% and 95% prediction
intervals on the forward-12m return). These would be more useful to a user than
the score-band [2-46], which is the same information at a coarser resolution.

The screenshot shows "CI lo / CI hi: -10.8% / +3.3%". Verify which interval that
is (probably PI80 = ±1.282σ ≈ ±13.2pp on pred 3.9% → -9.3 / +17.1 ... doesn't
match). Check what's actually rendered.

If "CI lo/hi" is meant to be the 80% PI on forward-return, it should be `[pi80Lo, pi80Hi]`. Worth a quick check that the right values are being shown.

---

## Issue 6 — Bucket reference vs. score uncertainty mismatch

Current score 13.8 with band [2-46]. The band spans **three quintile buckets**:
Q1 (0-20, -3.8% mean), Q2 (20-40, +10.6% mean), Q3 (40-60, +16.2% mean).

The 1σ band on the score implies the "true" bucket could be Q1, Q2, OR Q3 — i.e.,
historical 12m forward return could range from -3.8% to +16.2%. The displayed
"-3.8% / 12m fwd return / 61% neg" only reflects Q1 because that's where the
point estimate sits.

**Action:** Either:

- **A (simpler):** Add a note under the bucket: *"1σ uncertainty on score: bucket could be Q1 (most likely), Q2, or Q3. Realized 12m fwd return is highly uncertain."*
- **B (more honest):** Show a weighted average of bucket means using the score's posterior over buckets. Approximate: weight each bucket by `normCDF((hi-score)/sigma) - normCDF((lo-score)/sigma)` where sigma is derived from `scoreLo/scoreHi`. This gives a "blended" expected 12m return that respects uncertainty.

A is fine for now.

---

## Issue 7 — Time-to-event panel says "Median months until next −5%: 4m" with score 13.8

That number assumes you're entering at a *typical* Q1 score (~10), but the
historical median is computed only on n=18 observations. With n_eff=1
(non-overlapping monthly observations), this median is not meaningful.

The displayed lookahead is 36m, which is reasonable, but the user doesn't see
the n. Add the n to the panel: *"Historical median (lookahead 36m, n=18, n_eff=1 — wide uncertainty)"*.

Already partly there per the screenshot. Just emphasize the n_eff caveat more
clearly so the user knows "4 months until -5%" is one observation out of one
non-overlapping window in this bucket.

---

## Issue 8 — Sparkline below the score has no axis or threshold lines

The 12-month sparkline below "13.8" is good (Change 5 from v1 handoff was
implemented). But it has no reference lines at 30 and 80, so the user can't
visually tell when the score crossed into DEFENSIVE.

**Action:** Add two horizontal reference lines on the sparkline at y=30 and y=80
(matching the 3-zone thresholds). Make them subtle — dashed, 30% opacity.

---

## Issue 9 — No exit-alert banner (Change 2 from v1 NOT implemented)

The user's stated workflow is: *"tell me when to exit / tighten stops."* That
requires a banner that fires when the score crosses below 30 within the last
month (or two). It's not in the current screenshot.

This is the **highest-value change for the user's actual use case** and remains
unimplemented.

**Action:** Implement Change 2 from `CLAUDE_CODE_HANDOFF.md` v1. Recap:

- Banner at top of dashboard.
- Red banner if `score < 20`: *"Q1 zone. Historical 12m return at this score: -3.8%, 61% negative (n=18). Tighten stops / reduce exposure."*
- Amber banner if score crossed below 30 in the last 1-2 months: *"Score dropped into defensive zone. Recent precedents: 2.2 in Dec 2021 → 2022 bear, 13.1 in Apr 2011 → -17% summer drawdown."*
- Green banner if score crossed above 60 from below 30 in the last 1-2 months: *"Recovery from defensive zone. Historical Q4/Q5 forward returns +15-25% mean."*

For the **current state (score 13.8, band [2-46])**, the red banner should fire.

---

## Issue 10 — No walk-forward score stored

`getTimeseries()` reads `r.score_wf` from each timeseries row in `model.json`,
but no row has that field populated. So the dashboard cannot show a
walk-forward-only score history.

This is Change 9 from v1, deferred as a bigger lift. Still unimplemented.

**Action (when ready):** Write `scripts/walk_forward_score.py` per v1 spec. The
key change: for each month t starting at month 60, refit the ridge using only
rows [0, t-12) and recompute the rank-Gauss reference array using only those
rows. Predict for month t. Write back to `model.json` as `score_wf`.

This will likely reduce historical scores in the early sample (because the
rank-Gauss reference is narrower and the ridge less informed). That's the
honest version.

Until done, add a note on the methodology page: *"Historical scores in this
dashboard were computed with full-sample model parameters. A real-time score in
2015 would have been similar but noisier."*

---

## Issue 11 — Backtest panel not visible (Change 6 from v1 NOT implemented)

No equity-curve comparison vs. buy-and-hold. The user has no way to see the
strategy track record from the UI.

**Action:** Implement Change 6 — overlay BH vs STANCE_NL equity curves from
`scripts/backtest_v1.py` output, with a small metrics table. Honest caption:
*"Score's value is risk reduction, not return enhancement. Sharpe 0.84 vs 0.72 BH, max drawdown -16.4% vs -24.8% BH. Statistical significance: 92%, not 95%."*

---

## Priority order

If pressed for time:

1. **Issue 1 (input-range validation)** — model is currently extrapolating on multiple inputs. This is the only change that could materially affect score accuracy *today*. Verify the breadth=25 and RSI=21 values are not data pipeline bugs.
2. **Issue 9 (exit alert banner)** — directly serves user's stated workflow. Score 13.8 should trigger a red banner; it doesn't.
3. **Issue 4 (mark inactive signals)** — fixes a real interpretive error. Users probably think RSI matters; it doesn't in v5.7.
4. **Issue 2 (3-zone stance label)** — small fix, completes Change 1 from v1.
5. **Issue 8 (sparkline reference lines)** — small UI win.
6. **Issue 7 (time-to-event n_eff caveat)** — small honesty fix.
7. **Issue 5 (verify PI display)** — sanity check.
8. **Issue 6 (bucket vs uncertainty)** — moderate effort, real honesty win.
9. **Issue 3 (version label)** — cosmetic.
10. **Issue 10 (walk-forward score)** — bigger lift, can wait.
11. **Issue 11 (backtest panel)** — bigger lift, can wait.

---

## Quick spec for Issue 1 (input-range validation)

In `src/lib/scoring.ts`, modify the SignalSpec type and the `computeV2` loop:

```typescript
export interface SignalSpec {
  // ...existing fields
  outOfRange: boolean;
  rangeMin: number;
  rangeMax: number;
}

// inside computeV2, for each signal:
const sortedRef = getSorted(sk);
const rangeMin = sortedRef[0];
const rangeMax = sortedRef[sortedRef.length - 1];
const span = rangeMax - rangeMin;
const outOfRange = value < rangeMin - 0.1 * span || value > rangeMax + 0.1 * span;
```

Then in the signal grid component, render `outOfRange` as a red badge on the
percentile chip. And add a top-level check:

```typescript
const activeSignals = result.signals.filter(s => Math.abs(s.ridgeCoef) > 1e-9);
const anyExtrap = activeSignals.some(s => s.outOfRange);
// Render warning banner if anyExtrap
```

---

## What was implemented correctly from v1

For credit where due:

- **Change 4 (score uncertainty band)** — visible as `[2-46]` next to 13.8.
- **Change 5 (12m sparkline)** — visible under the score.
- **Change 10 (actionable thresholds card)** — the 5-bucket strip shows -3.8% / +10.6% / +16.2% / +15.5% / +25.0% with n and % negative. Good.
- **Change 1 (zone labels)** partially — bucket strip uses new labels (DEFENSIVE/NEUTRAL/INVESTED/INVESTED/OPPORTUNITY); stance card still old.
- **`stanceZoneFor` function added to `scoring.ts`** — correct logic, just not wired into the stance card yet.

The model math itself is sound and the displayed score reconciles to within
rounding. The biggest open accuracy risk is the **input data**, not the model.
