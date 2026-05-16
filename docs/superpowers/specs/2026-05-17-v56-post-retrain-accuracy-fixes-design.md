# Design: v5.6 Post-Retrain Accuracy Fixes

**Date:** 2026-05-17  
**Scope:** Fix 10 drift/staleness issues flagged after the 45b5f44 retrain on 2009–2026 FRED data (184 rows).  
**Strategy:** Parallel — background agent handles non-retrain fixes (Track 1); main session handles Python analysis and optional retrain (Track 2).

---

## Context

Commit `45b5f44` retrained the ridge model on fresh data. The model math is mostly clean, but source comments, HANDOFF.md, and some UI display logic still describe the pre-retrain state. Ten specific issues were identified and verified against `model.json`.

Verified facts from `model.json`:
- Active signals (non-zero ridge coef): `mfi_14m` (−0.00105), `ppi_yoy` (−0.03336), `aaii_spread` (−0.06789), `yield_curve_10y3m` (−0.04609), `breadth_12m_chg` (−0.01709) — **5 signals, not 6**
- RSI zeroed (sign-constraint); mdebt zeroed again (not re-activated); MFI barely active
- OOS ρ = 0.480 (was 0.641 pre-retrain)
- `drift` = 0.150286 (2009–2026 sample mean — anchors score=50 to ≈15%/yr)
- Q1: n=17, n_eff=1; Q2: n=16, n_eff=1 — NW CIs unreliable
- Q4 mean 15.49% < Q3 mean 16.66% — monotonicity broken
- `SIGNAL_META` rho12m values hardcoded from pre-retrain
- `scoreAAII()` uses z-score for display; model uses rank-Gauss — inconsistent transforms

---

## Track 1 — Background Agent (non-retrain fixes)

### #1 — Fix `scoring.ts` header docstring (lines 1–30)

**File:** `src/lib/scoring.ts`

Replace the v5.6 evolution block with post-retrain reality:
- Active signals: MFI, PPI, AAII, yield curve, breadth (5, not 6)
- RSI zeroed by sign-constraint; mdebt zeroed again (not re-activated)
- MFI technically active but effectively zero (−0.00105, contribution ≈ ±0.002)
- OOS ρ = 0.480 (25% drop from v5.5; see design notes on regime shift)
- Remove claim "Quintile monotonicity preserved" — Q4 < Q3 after retrain

### #2 — Rewrite `HANDOFF.md` "Current Model" section

**File:** `HANDOFF.md`

- Rename "Current Model — v4" → "Current Model — v5.6"
- Replace PCA+OLS description with: sign-constrained Ridge (α=5) on rank-Gauss-normalized signals
- Signal table: 9 inputs, ridge coefs from model.json, note which 5 are active
- Fix May 2026 snapshot: score = 26.34, Quintile 2 (file shows ~45 / Quintile 3 — wrong)
- Update quintile buckets table to match model.json values
- Update "Implemented History" table with v5.6 retrain entry
- Leave "Data Sources" and "Pending Changes" sections intact

### #5 — Flag unreliable CIs in `scoring.ts`

**File:** `src/lib/scoring.ts`

- Add `ciReliable: boolean` to `BucketDef` interface
- In `BUCKETS` mapping: set `ciReliable = (b.n_eff ?? 0) >= 3`
- Q1 (n_eff=1) and Q2 (n_eff=1) will have `ciReliable: false`
- Any UI component rendering bucket CIs should check this flag and append "(CI unreliable, n < 3 effective obs)" to the interval display

### #6 — Remove stale monotonicity claim

**File:** `src/lib/scoring.ts` (header, line 19)

Delete or replace: `"Quintile monotonicity preserved"` → note that Q4 mean (15.5%) < Q3 mean (16.7%) after retrain, likely sample noise given n_eff=3–4 in those buckets.

### #7 — Mark stale `rho12m` values in `SIGNAL_META`

**File:** `src/lib/scoring.ts` (lines 114–124)

Add inline comment above `SIGNAL_META`:
```
// rho12m values below are from the pre-retrain training run.
// They are used for display only and have not been recomputed against the 184-row 2009–2026 sample.
```
Do not change the values (no model.json field to read from yet). The next retrain should emit these.

### #8 — Expose DRIFT anchor in UI

**Files:** `src/lib/scoring.ts` and `src/components/StrategyPanel.tsx`

- Add exported constant to `scoring.ts`: `export const DRIFT_LABEL = "score 50 = predicted return equal to 2009–2026 sample mean (≈15%/yr)"`
- In `StrategyPanel.tsx` near the score display (around line 150 where `Score {compositeScore.toFixed(1)}` is rendered), add a small footnote or tooltip importing `DRIFT_LABEL`

### #10 — Note AAII z-score/rank-Gauss mismatch

**File:** `src/lib/scoring.ts` (line 418)

Add comment above the `zSpread` calculation:
```
// display-only z-score (mean/std); the ridge model uses rank-Gauss for aaii_spread, not this value
```
No math change.

---

## Track 2 — Main Session Python Analysis

### Step 1: Regime-split test (#4) — run first

**Goal:** Determine whether the OOS ρ drop (0.641→0.480) reflects a genuine structural shift or specification mining on the pre-retrain sample.

**Method:** In `fit_ridge.py` or a new script (`scripts/regime_split.py`):
1. Load the same 184-row dataset
2. Fit sign-constrained ridge (α=5) on 2009–2016 rows only (~96 obs)
3. Predict on 2017–2025 rows (~88 obs); compute OOS ρ
4. Compare coefs between the two halves
5. Flag if any coef changes sign or changes by >2× in magnitude

**Decision point:** Review results before proceeding to #3. If the model is clearly regime-specific, the team should consider a structural response (e.g., rolling window, ELO fallback) rather than just pruning MFI.

### Step 2: MFI collinearity / pruning decision (#3)

**Goal:** Decide whether to prune `mfi_14m` (coef −0.00105, contribution ≤ ±0.002 vs resid_std 0.1046).

**Method:**
1. Compute ρ(RSI, MFI) on the full 184-row sample (expect > 0.7 given both are momentum)
2. Refit 4-predictor model (drop MFI): ppi, aaii, yield_curve, breadth
3. Compare OOS ρ: 4-predictor vs 5-predictor
4. If OOS ρ drops < 0.01: prune MFI, update `model.json`, update scoring.ts header
5. If OOS ρ drops ≥ 0.01: keep MFI, add collinearity warning comment

**Decision point:** Review ρ change before updating model.json.

### Step 3: VIX-conditional σ test (#9)

**Goal:** Determine if `resid_var_b · vix_z` (conditional σ component) improves OOS log-likelihood enough to justify keeping VIX as a moving piece in the residual model, despite VIX being dropped as a predictor.

**Method:** Using `audit_v2.py` infrastructure:
1. Compute OOS log-likelihood under constant σ (`resid_var_a` only)
2. Compute OOS log-likelihood under current VIX-conditional model
3. Report: ΔlogL, and conditional contribution as % of total variance (`resid_var_b / resid_var_a`)

**Decision point:** If ΔlogL < 1 nats total, simplify to constant σ — remove `resid_var_b` and `vix_z_mean/std` from model.json, simplify `condResidStd()` in scoring.ts.

---

## Out of Scope

- Elastic Net / Group Lasso (mentioned in review) — valid long-term, but requires evaluating a new regularization path; leave for a separate session
- ELO ratings fallback — valid for games with no sharp odds, not relevant here
- Stationarity test (ADF on individual signals) — useful context but doesn't change immediate fixes

---

## Sequence

1. Spawn background agent → Track 1 fixes (runs in parallel)
2. Main session → Track 2 Step 1 (regime-split), review results
3. Main session → Track 2 Step 2 (MFI pruning), decide, possibly update model.json
4. Main session → Track 2 Step 3 (VIX-σ test), decide, possibly simplify scoring.ts
5. If model.json changed: update scoring.ts header to reflect final active signal set
6. Commit all changes together

---

## Files Touched

| File | Track | Change type |
|------|-------|-------------|
| `src/lib/scoring.ts` | 1 | Comment/interface/constant changes |
| `HANDOFF.md` | 1 | Full section rewrite |
| `scripts/regime_split.py` | 2 | New analysis script |
| `scripts/fit_ridge.py` | 2 | Possibly: add 4-predictor fit, VIX-σ test |
| `src/data/model.json` | 2 | Possibly: updated coefs if MFI pruned or σ simplified |
