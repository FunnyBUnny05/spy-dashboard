# v5.6 Post-Retrain Accuracy Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 10 drift/staleness issues introduced by the 45b5f44 retrain: stale comments, stale HANDOFF.md, unreliable CI display, stale rho12m values, missing DRIFT anchor label, AAII display/model transform mismatch, and three Python model improvements (regime-split analysis, MFI pruning decision, VIX-σ test).

**Architecture:** Two parallel tracks. Track 1 (background agent): pure text/code edits to `scoring.ts` and `HANDOFF.md`, no model changes. Track 2 (main session): new Python analysis script `scripts/regime_split.py`, then inline additions to `scripts/fit_ridge.py` for MFI pruning and VIX-σ testing. Track 2 has decision points — review printed output before proceeding to the next step.

**Tech Stack:** TypeScript (scoring.ts, StrategyPanel.tsx), Python 3.x, numpy, scipy, sklearn (all already installed), existing `fit_ridge.py` and `audit_v2.py` infrastructure.

---

## Track 1 — Background Agent (non-retrain fixes)

### Task 1: Fix `scoring.ts` header — stale active-signal description (#1, #6)

**Files:**
- Modify: `src/lib/scoring.ts:1-30`

- [ ] **Step 1: Replace the header docstring block**

Replace lines 1–30 of `src/lib/scoring.ts` with:

```typescript
/**
 * SPY Composite Scoring System v5.6
 *
 * Model: SIGN-CONSTRAINED Ridge regression on rank-Gauss-normalised signals.
 * VIX excluded from predictors (kept for σ_t and UI percentiles).
 *
 * Evolution:
 *   v5.2: Free Ridge + RG all 7. OOS ρ = 0.428.
 *   v5.3: Sign-constrained Ridge α=5 (auto-prunes MFI/EMA-dist/MDebt). ρ = 0.560.
 *   v5.4: Drop VIX from predictors (audit showed it harmed ρ).         ρ = 0.598.
 *   v5.5: Add yield curve (10Y−3m) + breadth (RSP/SPY 12m chg).        ρ = 0.641.
 *   v5.6: Retrain on fresh 2009–2026 FRED data (184 rows, was 168).    ρ = 0.480.
 *         RSI zeroed again by sign-constraint. MFI technically active
 *         but effectively zero (coef −0.00105, max contribution ±0.002
 *         vs resid_std 0.105 — within noise). mdebt zeroed (not re-activated).
 *
 * Active signals post-retrain (non-zero ridge coef):
 *   MFI (−0.00105, ~noise), PPI (−0.03336), AAII (−0.06789),
 *   Yield curve (−0.04609), Breadth (−0.01709).
 *   Effective predictors with meaningful contribution: PPI, AAII, YC, Breadth.
 *
 * OOS ρ drop (0.641 → 0.480): 25% degradation. Likely contributors:
 *   — 2022 inflation/rates regime now more heavily represented in sample.
 *   — v5.5 ρ=0.641 may have had mild specification mining on the same 168 rows.
 *   — 0.480 on a larger, more independent sample is probably the more honest number.
 *   Run scripts/regime_split.py to check if coefs are regime-specific.
 *
 * Quintile monotonicity: Q4 mean (15.5%) < Q3 mean (16.7%) after retrain.
 *   Likely sample noise given n_eff=3–4 in those buckets. Not a model failure.
 *
 * Pipeline:
 *   1. 9 input signals
 *   2. Rank-Gauss every signal against the full-sample sorted reference
 *   3. pred_fwd_12m = intercept + Σ ridge_coef_k * rg_k
 *      (4–5 of the 9 ridge_coefs are exactly 0 by sign-constraint)
 *   4. Composite score = norm.cdf((pred − drift) / σ(VIX)) × 100
 *      where drift = full-sample mean fwd_12m (≈15%/yr, 2009–2026 sample).
 *      score=50 ⇔ pred = drift.
 *   5. Empirical historical percentiles for all 9 signals.
 */
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/scoring.ts
git commit -m "fix(scoring): update header to match v5.6 post-retrain reality"
```

---

### Task 2: Add `ciReliable` flag to bucket definitions (#5)

**Files:**
- Modify: `src/lib/scoring.ts` — `BucketDef` interface and `BUCKETS` mapping

- [ ] **Step 1: Add `ciReliable` to `BucketDef` interface**

Find the `BucketDef` interface (around line 296 after Task 1's edit) and add one field:

```typescript
export interface BucketDef {
  lo: number;
  hi: number;
  label: string;
  n: number;
  nEff?: number;
  mean: number;
  ciLo: number;
  ciHi: number;
  pctNeg: number;
  worst: number;
  ciReliable: boolean;   // false when n_eff < 3 (NW SE unstable at this sample size)
}
```

- [ ] **Step 2: Set `ciReliable` in the `BUCKETS` mapping**

Find the `BUCKETS` constant and add `ciReliable`:

```typescript
export const BUCKETS: BucketDef[] = (modelData as any).buckets.map((b: any) => ({
  lo: b.lo, hi: b.hi, label: b.label,
  n: b.n, nEff: b.n_eff,
  mean: b.mean, ciLo: b.ci_lo, ciHi: b.ci_hi,
  pctNeg: b.pct_neg, worst: b.worst,
  ciReliable: (b.n_eff ?? 0) >= 3,
}));
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `BucketDef`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scoring.ts
git commit -m "fix(scoring): add ciReliable flag to BucketDef (n_eff < 3 → unreliable)"
```

---

### Task 3: Mark stale `rho12m` values in `SIGNAL_META` (#7)

**Files:**
- Modify: `src/lib/scoring.ts` — comment above `SIGNAL_META`

- [ ] **Step 1: Add staleness comment above `SIGNAL_META`**

Find the line `const SIGNAL_META: Record<string, ...> = {` and insert two comment lines above it:

```typescript
// rho12m values below are from the pre-retrain training run (pre-45b5f44).
// They are used for display only and have not been recomputed on the 184-row 2009–2026 sample.
const SIGNAL_META: Record<string, { label: string; category: string; rho12m: number }> = {
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/scoring.ts
git commit -m "fix(scoring): note stale pre-retrain rho12m values in SIGNAL_META"
```

---

### Task 4: Expose `DRIFT` anchor explanation in UI (#8)

**Files:**
- Modify: `src/lib/scoring.ts` — add exported constant
- Modify: `src/components/StrategyPanel.tsx:150` — add footnote near score display

- [ ] **Step 1: Export `DRIFT_LABEL` from `scoring.ts`**

Find the line `const DRIFT = (modelData as any).drift as number;` and add one line after it:

```typescript
const DRIFT       = (modelData as any).drift as number;
export const DRIFT_LABEL = `score 50 = predicted return equal to ${(DRIFT * 100).toFixed(0)}%/yr (2009–2026 sample mean)`;
```

- [ ] **Step 2: Import and display in `StrategyPanel.tsx`**

At the top of `StrategyPanel.tsx`, add `DRIFT_LABEL` to the import from `scoring`:

```typescript
import { ..., DRIFT_LABEL } from '../lib/scoring';
```

(Replace `...` with whatever is already imported from `scoring`.)

Then find the score display block around line 150 where `Score {compositeScore.toFixed(1)}` appears and add a footnote line below it:

```tsx
Score {compositeScore.toFixed(1)} → {Math.round(ftStance * 100)}% equity exposure<br />
<span style={{ fontSize: '0.75em', opacity: 0.6 }}>{DRIFT_LABEL}</span>
```

- [ ] **Step 3: Check TypeScript compiles**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scoring.ts src/components/StrategyPanel.tsx
git commit -m "feat(ui): expose drift anchor label near composite score"
```

---

### Task 5: Add AAII z-score / rank-Gauss mismatch comment (#10)

**Files:**
- Modify: `src/lib/scoring.ts` — comment at line ~418

- [ ] **Step 1: Add clarifying comment in `scoreAAII()`**

Find the line:
```typescript
const zSpread = (currentSpread - MEANS['aaii_spread']) / STDS['aaii_spread'];
```

Replace with:

```typescript
// display-only z-score (mean/std normalization); the ridge model uses rank-Gauss
// for aaii_spread, not this value. The two transforms diverge at extremes.
const zSpread = (currentSpread - MEANS['aaii_spread']) / STDS['aaii_spread'];
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/scoring.ts
git commit -m "fix(scoring): note AAII z-score is display-only; model uses rank-Gauss"
```

---

### Task 6: Rewrite `HANDOFF.md` — current model section (#2)

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Replace "What to paste at the start" block and "Current Model" section**

Replace lines 18–98 (from the ` ``` ` before `I have a SPY composite...` through the end of the Quintile Buckets table) with:

````markdown
```
I have a SPY composite scoring dashboard. Here is the current model logic.
Do NOT write TypeScript. Give me logic, math, or Python pseudocode only.

PIPELINE:
1. Take 9 raw signal values (RSI, MFI, EMA-dist, PPI, mdebt, AAII, VIX, yield-curve, breadth)
2. Rank-Gauss transform every signal against the full-sample sorted reference array
   rg = normInv(rank / (n+1))  — clamped to (0.01, 0.99)
3. Predict 12m forward return:
   pred = intercept + sum(ridge_coef_k * rg_k)   [VIX coef = 0; 4–5 coefs = 0 by sign-constraint]
4. Composite score = normCDF((pred - drift) / sigma_t) * 100
   drift  = full-sample mean fwd_12m (0.1503 = ≈15%/yr, 2009–2026 sample)
   sigma_t = sqrt(max(floor, resid_var_a + resid_var_b * vix_z))  [heteroscedastic]
   score=50 ⟺ pred equals drift

OUTPUT:
- compositeScore (0–100)
- predFwd12m: raw predicted 12m return (e.g. +0.14 = +14%)
- bucket: which quintile, with empirical forward return stats
- stance: exposure recommendation based on score
```

---

## Current Model — v5.6 (as of May 2026, commit 45b5f44)

### 9 Input Signals — Ridge Coefficients

| Key | Label | Coef | Active? |
|-----|-------|------|---------|
| rsi_14m | RSI (14m) | 0.0 | ❌ zeroed by sign-constraint |
| mfi_14m | MFI (14m) | −0.00105 | ⚠️ active but ~noise (contrib ≤ ±0.002) |
| ema_dist_pct | EMA-12m dist % | 0.0 | ❌ zeroed |
| ppi_yoy | PPI YoY % | −0.03336 | ✅ |
| mdebt_yoy | Margin debt YoY % | 0.0 | ❌ zeroed (not re-activated) |
| aaii_spread | AAII stocks−cash | −0.06789 | ✅ strongest signal |
| vix_close | VIX | 0.0 | ❌ excluded a priori (kept for σ_t and UI) |
| yield_curve_10y3m | Yield curve 10Y−3m | −0.04609 | ✅ |
| breadth_12m_chg | Breadth (RSP/SPY 12m) | −0.01709 | ✅ |

Ridge intercept: 0.143527 | Alpha (fixed): 5.0 | OOS Spearman ρ: 0.480

**Note on ρ drop (v5.5: 0.641 → v5.6: 0.480):** Likely reflects 2022 inflation/rates regime
now more prominent in data + possible mild spec mining on the old 168-row sample.
Run `scripts/regime_split.py` to check if coefs are regime-specific.

### Key Model Parameters

| Parameter | Value | Meaning |
|-----------|-------|---------|
| `drift` | 0.1503 | Sample mean fwd_12m (2009–2026). score=50 anchors to ≈15%/yr predicted return |
| `resid_std` | 0.1046 | Full-sample residual std |
| `resid_var_a` | 0.01077 | Unconditional residual variance |
| `resid_var_b` | 0.00361 | Slope of squared residuals on vix_z (conditional component ≈33% of base) |

### Quintile Buckets — Empirical 12m Forward Returns (post-retrain)

| Quintile | Score | n | n_eff | Mean 12m | CI lo | CI hi | CI reliable? | % Neg | Worst |
|----------|-------|---|-------|----------|-------|-------|-------------|-------|-------|
| Q1 | 0–20 | 17 | 1 | −4.3% | −11.0% | +2.4% | ❌ (NW unstable) | 64.7% | −18.3% |
| Q2 | 20–40 | 16 | 1 | +10.3% | +7.4% | +13.1% | ❌ (NW unstable) | 6.2% | −0.5% |
| Q3 | 40–60 | 34 | 3 | +16.7% | +13.3% | +20.0% | ✅ | 0.0% | +2.8% |
| Q4 | 60–80 | 42 | 4 | +15.5% | +10.2% | +20.8% | ✅ | 2.4% | −6.2% |
| Q5 | 80–100 | 27 | 2 | +24.2% | +16.3% | +32.0% | ❌ (NW unstable) | 7.4% | −7.0% |

**Note:** Q4 mean (15.5%) < Q3 mean (16.7%) — monotonicity is broken but likely sample noise (n_eff=3–4).
````

- [ ] **Step 2: Update "Current Snapshot Values" section (lines ~114–127)**

Replace the snapshot table and score line with:

```markdown
## Current Snapshot Values (May 2026)

| Signal | Current Value | Source |
|--------|--------------|--------|
| RSI (14m) | ~70 | TradingView CSV (auto) |
| MFI (14m) | ~67 | TradingView CSV (auto) |
| EMA dist % | ~9% | TradingView CSV (auto) |
| PPI YoY | 4.02% | Live (stock-sentinel) |
| Margin debt YoY | 38.7% | Live (stock-sentinel) |
| AAII spread | 0.526 | aaii.json |
| VIX | ~17 | Manual (CBOE) |

**Current score: 26.34 / 100 (Quintile 2 — Defensive)**
Note: score=50 anchors to the 2009–2026 sample mean predicted return (≈15%/yr),
not the long-run 10% nominal SPY return. A score of 50 does not mean "neutral"
relative to long-run base rates.
```

- [ ] **Step 3: Add v5.6 retrain entry to Implemented History table**

Find the `| May 2026 | v4: ...` row and add after it:

```markdown
| May 2026 | v5.6: retrain on fresh 2009–2026 FRED data (184 rows); OOS ρ = 0.480 | ✅ |
```

- [ ] **Step 4: Commit**

```bash
git add HANDOFF.md
git commit -m "docs(handoff): rewrite to match v5.6 post-retrain model state"
```

---

## Track 2 — Main Session (Python analysis, decision points)

### Task 7: Write and run regime-split analysis (#4)

**Files:**
- Create: `scripts/regime_split.py`

**Context:** The OOS ρ dropped from 0.641 → 0.480 after adding 17 months of 2022–2026 data. This script checks whether the model's coefficients are stable across regimes (pre- vs post-2017). If coefs change by >2× or flip sign, the model is fitting regime-specific behavior, not a structural relationship.

- [ ] **Step 1: Create `scripts/regime_split.py`**

```python
"""
regime_split.py — Test whether v5.6 ridge coefs are stable across regimes.

Fits sign-constrained ridge on 2009–2016 only, evaluates on 2017–2025.
Compares coefs between halves. If any coef changes >2x or flips sign,
the model is regime-specific.

Requires: /tmp/velv/master_dataset.csv (same file as fit_ridge.py)
"""
import json
import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path
from scripts_utils import fit_ridge_with_sign  # see Step 2 for inline version

REPO  = Path(__file__).parent.parent
CSV   = Path("/tmp/velv/master_dataset.csv")

SIGNALS = ['rsi_14m', 'mfi_14m', 'ema_dist_pct', 'ppi_yoy', 'mdebt_yoy',
           'aaii_spread', 'vix_close', 'yield_curve_10y3m', 'breadth_12m_chg']
PREDICTORS = [s for s in SIGNALS if s != 'vix_close']
UNIVARIATE_SIGN = {
    'rsi_14m': -1, 'mfi_14m': -1, 'ema_dist_pct': -1,
    'ppi_yoy': -1, 'mdebt_yoy': -1, 'aaii_spread': -1,
    'yield_curve_10y3m': -1, 'breadth_12m_chg': -1,
}
MACRO_LAGS = {'ppi_yoy': 1, 'mdebt_yoy': 2}
FIXED_ALPHA = 5.0
SPLIT_DATE  = '2017-01-01'


def fit_ridge_with_sign(X, y, alpha, signs):
    Xc = X - X.mean(axis=0)
    yc = y - y.mean()
    p = Xc.shape[1]
    XTy = Xc.T @ yc
    XTX = Xc.T @ Xc + alpha * np.eye(p)
    diag = np.diag(XTX).copy()
    beta = np.linalg.solve(XTX, XTy)
    for _ in range(500):
        prev = beta.copy()
        for j in range(p):
            r_j = XTy[j] - XTX[j].dot(beta) + diag[j] * beta[j]
            b = r_j / diag[j]
            if signs[j] == -1 and b > 0: b = 0.0
            if signs[j] == +1 and b < 0: b = 0.0
            beta[j] = b
        if np.max(np.abs(beta - prev)) < 1e-10:
            break
    intercept = float(y.mean() - X.mean(axis=0) @ beta)
    return beta, intercept


def rank_gauss_series(vals, ref_sorted):
    n = len(ref_sorted)
    ranks = np.searchsorted(ref_sorted, vals, side='left')
    p = np.clip(ranks / (n + 1), 0.01, 0.99)
    return stats.norm.ppf(p)


def prepare(df_slice):
    X = df_slice[PREDICTORS].values.astype(float)
    y = df_slice['fwd_12m'].values.astype(float)
    means = X.mean(axis=0)
    stds  = X.std(axis=0, ddof=1); stds[stds == 0] = 1.0
    X_rg = X.copy()
    for c in range(X.shape[1]):
        X_rg[:, c] = rank_gauss_series(X[:, c], np.sort(X[:, c]))
    return X_rg, y, means, stds


def main():
    df = pd.read_csv(CSV, parse_dates=['date'])
    df = df[['date'] + SIGNALS + ['fwd_12m']].copy()
    for col, lag in MACRO_LAGS.items():
        if col in df.columns:
            df[col] = df[col].shift(lag)
    df = df.dropna(subset=SIGNALS + ['fwd_12m']).reset_index(drop=True)
    print(f"Total rows with all signals + fwd_12m: {len(df)}")

    split = pd.Timestamp(SPLIT_DATE)
    early = df[df['date'] < split].copy()
    late  = df[df['date'] >= split].copy()
    print(f"Pre-{SPLIT_DATE[:7]}:  {len(early)} rows")
    print(f"Post-{SPLIT_DATE[:7]}: {len(late)} rows")

    signs = np.array([UNIVARIATE_SIGN[s] for s in PREDICTORS])

    # Fit on early half
    X_e, y_e, _, _ = prepare(early)
    beta_e, int_e = fit_ridge_with_sign(X_e, y_e, FIXED_ALPHA, signs)

    # Fit on late half
    X_l, y_l, _, _ = prepare(late)
    beta_l, int_l = fit_ridge_with_sign(X_l, y_l, FIXED_ALPHA, signs)

    # Fit on full sample (reference)
    X_f, y_f, _, _ = prepare(df)
    beta_f, int_f = fit_ridge_with_sign(X_f, y_f, FIXED_ALPHA, signs)

    # Evaluate: fit on early, predict on late
    X_l_rg, _, _, _ = prepare(late)  # rank-gauss within late (conservative)
    preds_late = int_e + X_l_rg @ beta_e
    rho_late, p_late = stats.spearmanr(preds_late, y_l)

    print(f"\n{'Signal':<22} {'Full':>9} {'Pre-2017':>9} {'Post-2017':>10} {'Ratio':>7} {'Flag'}")
    print("-" * 70)
    flags = []
    for i, sig in enumerate(PREDICTORS):
        bf, be, bl = beta_f[i], beta_e[i], beta_l[i]
        if abs(be) < 1e-9 and abs(bl) < 1e-9:
            ratio_str = "  both=0"
            flag = ""
        elif abs(be) < 1e-9:
            ratio_str = "  e=0   "
            flag = "⚠️  zero in early" if abs(bl) > 0.01 else ""
        elif abs(bl) < 1e-9:
            ratio_str = "  l=0   "
            flag = "⚠️  zero in late" if abs(be) > 0.01 else ""
        else:
            ratio = abs(bl / be)
            ratio_str = f"{ratio:7.2f}x"
            sign_flip = (be * bl) < 0
            flag = "🚨 SIGN FLIP" if sign_flip else ("⚠️  >2x change" if ratio > 2.0 else "")
        if flag:
            flags.append(f"  {sig}: {flag}")
        print(f"  {sig:<20} {bf:+9.5f} {be:+9.5f} {bl:+10.5f} {ratio_str}  {flag}")

    print(f"\nOOS ρ (train pre-2017, eval post-2017): {rho_late:.4f}  (p={p_late:.4f})")
    print(f"Full-sample intercept: {int_f:+.6f} | Pre-split: {int_e:+.6f} | Post-split: {int_l:+.6f}")

    if flags:
        print(f"\n⚠️  Regime instability detected:")
        for f in flags:
            print(f)
        print("\nInterpretation: model may be fitting regime-specific behavior.")
        print("Consider: rolling-window fit, regime-conditional model, or ELO fallback.")
    else:
        print("\n✅ Coefs broadly stable across regimes. OOS ρ drop likely reflects")
        print("   harder data (2022 inflation), not specification mining.")


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Run the regime-split script**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && python scripts/regime_split.py
```

Expected output structure:
```
Total rows with all signals + fwd_12m: 136
Pre-2017-01:  ~84 rows
Post-2017-01: ~52 rows

Signal                 Full  Pre-2017 Post-2017   Ratio  Flag
----------------------------------------------------------------------
  rsi_14m          +0.00000  ...       ...         ...
  mfi_14m          -0.00105  ...       ...         ...
  ppi_yoy          -0.03336  ...       ...         ...
  ...

OOS ρ (train pre-2017, eval post-2017): X.XXX
```

> **DECISION POINT — review before proceeding to Task 8:**
> - If OOS ρ < 0.25 or >2 coef flags: regime instability is real. Note it, proceed with MFI pruning anyway (Task 8 is still valid), but consider flagging in HANDOFF.md.
> - If OOS ρ ≥ 0.25 and ≤1 flag: model is reasonably stable. OOS ρ drop is likely data-driven, not spec mining.

- [ ] **Step 3: Commit regime-split script**

```bash
git add scripts/regime_split.py
git commit -m "feat(scripts): add regime_split.py to test coef stability across 2009-2016 vs 2017-2025"
```

---

### Task 8: MFI pruning decision (#3)

**Files:**
- Create: `scripts/prune_mfi_test.py`
- Possibly modify: `src/data/model.json` and `scripts/fit_ridge.py` (if pruning wins)

**Context:** `mfi_14m` has ridge coef −0.00105. On the rank-Gauss range of ±2.3, its max contribution to `predFwd12m` is ±0.0024 — smaller than 1/40th of resid_std (0.1046). RSI and MFI are momentum signals with likely ρ > 0.7. The reviewer suspects the model is picking one over the other arbitrarily at a corner solution.

- [ ] **Step 1: Create `scripts/prune_mfi_test.py`**

```python
"""
prune_mfi_test.py — Compare 4-predictor model (drop MFI) vs 5-predictor (current).

Reports:
  1. ρ(RSI, MFI) — confirms collinearity hypothesis
  2. OOS Spearman ρ: 4-predictor vs 5-predictor
  3. Decision: prune if OOS ρ delta < 0.01

Requires: /tmp/velv/master_dataset.csv
"""
import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path

CSV = Path("/tmp/velv/master_dataset.csv")

SIGNALS = ['rsi_14m', 'mfi_14m', 'ema_dist_pct', 'ppi_yoy', 'mdebt_yoy',
           'aaii_spread', 'vix_close', 'yield_curve_10y3m', 'breadth_12m_chg']
PREDICTORS_5 = [s for s in SIGNALS if s != 'vix_close']   # current
PREDICTORS_4 = [s for s in PREDICTORS_5 if s != 'mfi_14m']  # pruned

UNIVARIATE_SIGN = {
    'rsi_14m': -1, 'mfi_14m': -1, 'ema_dist_pct': -1,
    'ppi_yoy': -1, 'mdebt_yoy': -1, 'aaii_spread': -1,
    'yield_curve_10y3m': -1, 'breadth_12m_chg': -1,
}
MACRO_LAGS = {'ppi_yoy': 1, 'mdebt_yoy': 2}
FIXED_ALPHA = 5.0
MIN_TRAIN = 36
HORIZON = 12


def fit_ridge_with_sign(X, y, alpha, signs):
    Xc = X - X.mean(axis=0)
    yc = y - y.mean()
    p = Xc.shape[1]
    XTy = Xc.T @ yc
    XTX = Xc.T @ Xc + alpha * np.eye(p)
    diag = np.diag(XTX).copy()
    beta = np.linalg.solve(XTX, XTy)
    for _ in range(500):
        prev = beta.copy()
        for j in range(p):
            r_j = XTy[j] - XTX[j].dot(beta) + diag[j] * beta[j]
            b = r_j / diag[j]
            if signs[j] == -1 and b > 0: b = 0.0
            if signs[j] == +1 and b < 0: b = 0.0
            beta[j] = b
        if np.max(np.abs(beta - prev)) < 1e-10:
            break
    return beta, float(y.mean() - X.mean(axis=0) @ beta)


def rank_gauss_series(vals, ref_sorted):
    n = len(ref_sorted)
    ranks = np.searchsorted(ref_sorted, vals, side='left')
    p = np.clip(ranks / (n + 1), 0.01, 0.99)
    return stats.norm.ppf(p)


def walk_forward_oos(df, predictors):
    preds, actuals = [], []
    signs = np.array([UNIVARIATE_SIGN[s] for s in predictors])
    for idx in range(len(df)):
        row = df.iloc[idx]
        if pd.isna(row['fwd_12m']):
            continue
        train_cutoff = idx - HORIZON + 1
        train = df.iloc[:train_cutoff].dropna(subset=['fwd_12m'])
        if len(train) < MIN_TRAIN:
            continue
        X_tr = train[predictors].values.astype(float)
        y_tr = train['fwd_12m'].values.astype(float)
        means = X_tr.mean(axis=0)
        stds  = X_tr.std(axis=0, ddof=1); stds[stds == 0] = 1.0
        X_rg = X_tr.copy()
        for c in range(X_tr.shape[1]):
            X_rg[:, c] = rank_gauss_series(X_tr[:, c], np.sort(X_tr[:, c]))
        beta, intercept = fit_ridge_with_sign(X_rg, y_tr, FIXED_ALPHA, signs)
        x_test = row[predictors].values.astype(float)
        x_rg = np.array([rank_gauss_series(np.array([x_test[c]]), np.sort(X_tr[:, c]))[0]
                         for c in range(len(predictors))])
        preds.append(float(intercept + x_rg @ beta))
        actuals.append(float(row['fwd_12m']))
    return np.array(preds), np.array(actuals)


def main():
    df = pd.read_csv(CSV, parse_dates=['date'])
    df = df[['date'] + SIGNALS + ['fwd_12m']].copy()
    for col, lag in MACRO_LAGS.items():
        if col in df.columns:
            df[col] = df[col].shift(lag)
    df = df.dropna(subset=SIGNALS).reset_index(drop=True)

    # 1. RSI/MFI collinearity
    valid = df.dropna(subset=['rsi_14m', 'mfi_14m'])
    rho_rsi_mfi, p_rsi_mfi = stats.spearmanr(valid['rsi_14m'], valid['mfi_14m'])
    print(f"ρ(RSI, MFI) = {rho_rsi_mfi:.3f}  (p={p_rsi_mfi:.4f})")
    print(f"  → {'Collinear (ρ > 0.6)' if abs(rho_rsi_mfi) > 0.6 else 'Not strongly collinear'}")

    # 2. Walk-forward OOS for both models
    print("\nRunning 5-predictor walk-forward OOS (current)...")
    p5, a5 = walk_forward_oos(df, PREDICTORS_5)
    rho5, _ = stats.spearmanr(p5, a5)

    print("Running 4-predictor walk-forward OOS (MFI dropped)...")
    p4, a4 = walk_forward_oos(df, PREDICTORS_4)
    rho4, _ = stats.spearmanr(p4, a4)

    delta = rho4 - rho5
    print(f"\n5-predictor OOS ρ: {rho5:.4f}")
    print(f"4-predictor OOS ρ: {rho4:.4f}")
    print(f"Delta (4 - 5):     {delta:+.4f}")

    print("\n" + "=" * 50)
    if abs(delta) < 0.01:
        print("✅ RECOMMENDATION: PRUNE MFI")
        print("   OOS ρ change is negligible (<0.01).")
        print("   Drop mfi_14m from PREDICTORS in fit_ridge.py and retrain.")
    else:
        print(f"⚠️  RECOMMENDATION: KEEP MFI")
        print(f"   OOS ρ change {delta:+.4f} exceeds threshold.")
        print("   Add collinearity warning comment instead of pruning.")


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Run the pruning test**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && python scripts/prune_mfi_test.py
```

Expected output (approximate):
```
ρ(RSI, MFI) = 0.7XX  (p=0.0000)
  → Collinear (ρ > 0.6)

Running 5-predictor walk-forward OOS (current)...
Running 4-predictor walk-forward OOS (MFI dropped)...

5-predictor OOS ρ: 0.4800
4-predictor OOS ρ: 0.47XX–0.48XX
Delta (4 - 5):     -0.00XX

✅ RECOMMENDATION: PRUNE MFI   (or ⚠️ KEEP MFI if delta ≥ 0.01)
```

> **DECISION POINT — review output:**
> - If "PRUNE MFI": proceed to Step 3 (retrain without MFI).
> - If "KEEP MFI": skip to Step 4 (add collinearity comment, no retrain).

- [ ] **Step 3 (conditional on PRUNE): Retrain without MFI**

Edit `scripts/fit_ridge.py` line 67:
```python
# Before:
PREDICTORS = [s for s in SIGNALS if s != 'vix_close']
# After:
PREDICTORS = [s for s in SIGNALS if s not in ('vix_close', 'mfi_14m')]
```

Also remove `'mfi_14m': -1` from `UNIVARIATE_SIGN`.

Then retrain:
```bash
cd /Users/adamariel/Downloads/spy-dashboard && python scripts/fit_ridge.py
```

Verify the output shows `mfi_14m` absent from coefs and OOS ρ is within 0.01 of 0.480.

- [ ] **Step 3 (conditional on KEEP): Add collinearity comment**

In `scripts/fit_ridge.py`, above the `UNIVARIATE_SIGN` block, add:
```python
# NOTE: mfi_14m and rsi_14m are collinear (ρ > 0.6, both momentum signals).
# Sign-constrained ridge can arbitrarily pick one over the other at the corner
# solution. On this sample mfi_14m carries the active coef (~-0.00105, ~noise).
# On a different sample window RSI may win instead. See scripts/prune_mfi_test.py.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/prune_mfi_test.py scripts/fit_ridge.py
# If retrained:
git add src/data/model.json
git commit -m "fix(model): prune MFI — collinear with RSI, OOS rho unchanged"
# OR if keeping:
git commit -m "fix(scripts): document RSI/MFI collinearity; OOS rho justifies keeping MFI"
```

---

### Task 9: VIX-conditional σ test (#9)

**Files:**
- Create: `scripts/vix_sigma_test.py`
- Possibly modify: `src/data/model.json` and `src/lib/scoring.ts` (if constant σ wins)

**Context:** VIX was dropped as a ridge predictor (coef=0). But `condResidStd()` in `scoring.ts` still uses `resid_var_a + resid_var_b · vix_z`. With `resid_var_b=0.00361` vs `resid_var_a=0.01077`, VIX contributes ~33% of the conditional variance. This test checks whether that contribution improves OOS log-likelihood.

- [ ] **Step 1: Create `scripts/vix_sigma_test.py`**

```python
"""
vix_sigma_test.py — Compare OOS log-likelihood: constant sigma vs VIX-conditional.

Uses the walk-forward OOS predictions already in model.json timeseries.
Reports delta log-likelihood and makes a recommendation.

Requires: src/data/model.json, /tmp/velv/master_dataset.csv
"""
import json
import numpy as np
import pandas as pd
from pathlib import Path
from scipy import stats

REPO = Path(__file__).parent.parent
m = json.loads((REPO / 'src/data/model.json').read_text())
df_raw = pd.read_csv('/tmp/velv/master_dataset.csv', parse_dates=['date'])
df_raw['ym'] = df_raw['date'].dt.strftime('%Y-%m')
df_raw = df_raw.set_index('ym')

# Pull OOS rows from timeseries
oos = [r for r in m['timeseries'] if r.get('in_sample') is False
       and r['pred'] is not None and r['score'] is not None]

# Align with raw data for actual fwd_12m and vix_close
rows = []
for r in oos:
    ym = r['d']
    if ym not in df_raw.index:
        continue
    raw_row = df_raw.loc[ym]
    fwd = raw_row['fwd_12m'] if 'fwd_12m' in raw_row.index else np.nan
    vix = raw_row['vix_close'] if 'vix_close' in raw_row.index else np.nan
    if pd.isna(fwd) or pd.isna(vix):
        continue
    rows.append({'pred': r['pred'], 'actual': float(fwd), 'vix': float(vix)})

preds   = np.array([r['pred']   for r in rows])
actuals = np.array([r['actual'] for r in rows])
vix_raw = np.array([r['vix']    for r in rows])

resid = actuals - preds
N = len(resid)

# Model parameters from model.json
var_a  = m['resid_var_a']
var_b  = m['resid_var_b']
var_fl = m['resid_var_floor']
vz_mean = m['vix_z_mean']
vz_std  = m['vix_z_std']

vix_z = (vix_raw - vz_mean) / vz_std

# Constant-sigma model: use mean of resid^2 as variance estimate
const_var  = float(np.mean(resid ** 2))
const_std  = float(np.sqrt(const_var))

# VIX-conditional model
cond_vars  = np.maximum(var_fl, var_a + var_b * vix_z)
cond_stds  = np.sqrt(cond_vars)

# OOS log-likelihood under each model
# log p(r | sigma) = -0.5*log(2pi) - log(sigma) - 0.5*(r/sigma)^2
def loglik(resid_arr, sigma_arr):
    return float(np.sum(-0.5 * np.log(2 * np.pi) - np.log(sigma_arr) - 0.5 * (resid_arr / sigma_arr) ** 2))

ll_const = loglik(resid, np.full(N, const_std))
ll_cond  = loglik(resid, cond_stds)
delta_ll = ll_cond - ll_const

# Conditional component as % of unconditional variance
cond_pct = (var_b / var_a) * 100

print(f"N OOS rows matched: {N}")
print(f"\nConstant-σ model:        σ = {const_std:.4f},  log-lik = {ll_const:.2f}")
print(f"VIX-conditional model:   σ varies {cond_stds.min():.4f}–{cond_stds.max():.4f},  log-lik = {ll_cond:.2f}")
print(f"ΔlogL (conditional - constant): {delta_ll:+.2f} nats")
print(f"Conditional component (var_b/var_a): {cond_pct:.1f}% of base variance")

print("\n" + "=" * 50)
if delta_ll < 1.0:
    print("✅ RECOMMENDATION: SIMPLIFY to constant sigma")
    print(f"   ΔlogL = {delta_ll:.2f} nats — conditional model adds negligible benefit.")
    print("   To simplify: set resid_var_b = 0.0 in model.json,")
    print("   simplify condResidStd() in scoring.ts to return sqrt(resid_var_a).")
else:
    print(f"✅ RECOMMENDATION: KEEP VIX-conditional sigma")
    print(f"   ΔlogL = {delta_ll:.2f} nats — conditional model is meaningfully better.")
```

- [ ] **Step 2: Run the VIX-σ test**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && python scripts/vix_sigma_test.py
```

Expected output (approximate):
```
N OOS rows matched: 130+

Constant-σ model:        σ = 0.1046,  log-lik = XX.XX
VIX-conditional model:   σ varies 0.09XX–0.15XX,  log-lik = XX.XX
ΔlogL (conditional - constant): +X.XX nats
Conditional component (var_b/var_a): 33.5% of base variance

✅ RECOMMENDATION: SIMPLIFY to constant sigma (or KEEP — depending on result)
```

> **DECISION POINT — review output:**
> - If "SIMPLIFY": proceed to Step 3.
> - If "KEEP": skip to Step 4 (just commit the script, no model change).

- [ ] **Step 3 (conditional on SIMPLIFY): Update model.json and scoring.ts**

In `src/data/model.json`, set:
```json
"resid_var_b": 0.0
```
(Leave `resid_var_a`, `resid_var_floor`, `vix_z_mean`, `vix_z_std` in place for backward compatibility — `scoring.ts` gracefully handles `var_b=0`.)

In `src/lib/scoring.ts`, update the `condResidStd` function comment to note it degenerates to constant σ when `resid_var_b=0`:
```typescript
// resid_var_b=0 → constant sigma (VIX-conditional component not statistically justified)
function condResidStd(vixClose: number): number {
```

- [ ] **Step 4: Commit**

```bash
git add scripts/vix_sigma_test.py
# If simplified:
git add src/data/model.json src/lib/scoring.ts
git commit -m "fix(model): simplify to constant sigma — VIX-conditional adds <1 nat OOS loglik"
# OR if keeping:
git commit -m "feat(scripts): add vix_sigma_test.py — VIX-conditional sigma justified, keeping"
```

---

### Task 10: Final sync — update scoring.ts header if model.json changed

**Condition:** Only needed if Task 8 resulted in a retrain (MFI pruned) or Task 9 simplified σ.

- [ ] **Step 1: If MFI was pruned in Task 8**

Update the "Active signals post-retrain" lines in the scoring.ts header (added in Task 1) to remove MFI and change the active count:

```typescript
 * Active signals post-retrain (non-zero ridge coef):
 *   PPI (−0.0XXX), AAII (−0.0XXX), Yield curve (−0.0XXX), Breadth (−0.0XXX).
 *   MFI pruned (collinear with RSI; OOS ρ unchanged — see scripts/prune_mfi_test.py).
```

- [ ] **Step 2: If σ was simplified in Task 9**

Update the σ formula line in the header:
```typescript
 *   4. Composite score = norm.cdf((pred − drift) / σ) × 100
 *      where σ = sqrt(resid_var_a) = constant (VIX-conditional term not justified by OOS loglik).
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/scoring.ts
git commit -m "fix(scoring): sync header with final model state after MFI/sigma decisions"
```

---

## Self-Review

**Spec coverage check:**
- #1 → Task 1 ✅
- #2 → Task 6 ✅
- #3 → Task 8 ✅
- #4 → Task 7 ✅
- #5 → Task 2 ✅
- #6 → Task 1 (header includes monotonicity note) ✅
- #7 → Task 3 ✅
- #8 → Task 4 ✅
- #9 → Task 9 ✅
- #10 → Task 5 ✅

**Sequence:**
Track 1 (Tasks 1–6) runs independently in a background agent.
Track 2 (Tasks 7–10) runs in the main session with decision-point pauses.
Task 10 is conditional — only needed if Track 2 produces a model change.
