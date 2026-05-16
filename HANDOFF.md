# SPY Dashboard — Logic Handoff Document

Use this file to pass logic changes between Claude chat (math/research) and Claude Code (implementation).

---

## How to use this file

1. **Claude chat** suggests a logic change → you paste it into "Pending Changes" below
2. **You tell Claude Code:** "Implement the pending changes in HANDOFF.md"
3. Claude Code implements, moves the change to "Implemented History"
4. Repeat

---

## What to paste at the start of a Claude chat session

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

## Current Model — v5.7 (as of May 2026)

v5.6 retrained on 2009–2026 FRED data (184 rows). v5.7 pruned MFI (collinear with RSI, ρ=0.777; OOS ρ improved). See `scripts/prune_mfi_test.py` and `scripts/regime_split.py` for analysis.

### 9 Input Signals — Ridge Coefficients

| Key | Label | Coef | Active? |
|-----|-------|------|---------|
| rsi_14m | RSI (14m) | 0.0 | ❌ zeroed by sign-constraint |
| mfi_14m | MFI (14m) | 0.0 | ❌ pruned (collinear with RSI, ρ=0.777) |
| ema_dist_pct | EMA-12m dist % | 0.0 | ❌ zeroed |
| ppi_yoy | PPI YoY % | −0.03361 | ✅ |
| mdebt_yoy | Margin debt YoY % | 0.0 | ❌ zeroed |
| aaii_spread | AAII stocks−cash | −0.06851 | ✅ strongest signal |
| vix_close | VIX | 0.0 | ❌ excluded a priori (kept for σ_t and UI) |
| yield_curve_10y3m | Yield curve 10Y−3m | −0.04656 | ✅ |
| breadth_12m_chg | Breadth (RSP/SPY 12m) | −0.01679 | ✅ |

Ridge intercept: 0.143506 | Alpha (fixed): 5.0 | OOS Spearman ρ: 0.488

**OOS ρ history:** 0.428 → 0.560 → 0.598 → 0.641 → 0.480 (v5.6 retrain) → 0.488 (v5.7 MFI prune)
**On ρ drop (v5.5→v5.6):** Regime-split test shows OOS ρ=0.702 (train 2009-16, eval 2017-25) — model generalises well. Drop was harder walk-forward test on larger data, not regime failure.

### Key Model Parameters

| Parameter | Value | Meaning |
|-----------|-------|---------|
| `drift` | 0.1503 | Sample mean fwd_12m (2009–2026). score=50 anchors to ≈15%/yr predicted return |
| `resid_std` | 0.1038 | Full-sample residual std |
| `resid_var_a` | 0.01060 | Unconditional residual variance |
| `resid_var_b` | 0.00370 | VIX-conditional slope (ΔlogL=+1.56 nats — justified, keeping) |

### Quintile Buckets — Empirical 12m Forward Returns (v5.7)

| Quintile | Score | n | n_eff | Mean 12m | CI lo | CI hi | CI reliable? | % Neg | Worst |
|----------|-------|---|-------|----------|-------|-------|-------------|-------|-------|
| Q1 | 0–20 | 18 | 1 | −3.8% | −10.8% | +3.2% | ❌ (NW unstable) | 61% | −18.3% |
| Q2 | 20–40 | 15 | 1 | +10.6% | +8.0% | +13.2% | ❌ (NW unstable) | 7% | −0.5% |
| Q3 | 40–60 | 35 | 3 | +16.2% | +12.5% | +19.9% | ✅ | 0% | +0.8% |
| Q4 | 60–80 | 42 | 4 | +15.5% | +10.4% | +20.6% | ✅ | 5% | −7.0% |
| Q5 | 80–100 | 26 | 2 | +25.0% | +16.5% | +33.5% | ❌ (NW unstable) | 4% | −0.9% |

**Note:** Q4 mean (15.5%) < Q3 mean (16.2%) — monotonicity still broken after retrain, likely sample noise (n_eff=3–4).

---

## Stance (exposure recommendation)

| Score | Label | Exposure | Action |
|-------|-------|----------|--------|
| 80–100 | Aggressive long | 110–130% | Add on dips, lever up |
| 60–80 | Bullish | 90–100% | Full long, no hedges |
| 40–60 | Neutral | 60–80% | Moderate long, light hedges |
| 20–40 | Defensive | 30–50% | Trim, raise cash |
| 0–20 | Wait / buy panic | 10–30% | Hedged or buy >15% drawdown |

---

## Current Snapshot Values (May 2026)

| Signal | Current Value | Source |
|--------|--------------|--------|
| RSI (14m) | 70.21 | TradingView CSV (auto) |
| MFI (14m) | 66.70 | TradingView CSV (auto) |
| EMA dist % | 9.05% | TradingView CSV (auto) |
| PPI YoY | 4.02% | Live (stock-sentinel) |
| Margin debt YoY | 38.7% | Live (stock-sentinel) |
| AAII spread | 0.526 | aaii.json |
| VIX | 16.99 | Manual (CBOE) |

**Current score: 26.34 / 100 (Quintile 2 — Defensive)**
Note: score=50 anchors to the 2009–2026 sample mean predicted return (≈15%/yr),
not the long-run 10% nominal SPY return. A score of 50 does not mean "neutral"
relative to long-run base rates.

---

## Data Sources

| Signal | Update frequency | How it enters the app |
|--------|-----------------|----------------------|
| RSI, MFI, EMA dist | Weekly | Drop TradingView SPY weekly CSV in "SPY Data" tab |
| PPI YoY | Monthly | Auto-fetched on startup from Vercel (stock-sentinel) |
| Margin debt YoY | Monthly | Auto-fetched on startup from Vercel (stock-sentinel) |
| AAII spread | Weekly | Run `npm run update-aaii` then rebuild |
| VIX | Monthly | Edit `src/lib/snapshot.ts` → `vixClose` manually |

---

## Pending Changes

_Nothing pending. Add new suggestions here._

```
## Change [date]
Suggested by: Claude chat / me
What to change: 
Why: 
Expected impact: 
```

---

## Implemented History

| Date | Change | Implemented |
|------|--------|-------------|
| May 2026 | v4: replaced hand-crafted weights with PCA+OLS model | ✅ |
| May 2026 | v5.6: retrain on fresh 2009–2026 FRED data (184 rows); OOS ρ = 0.480 | ✅ |
| May 2026 | v5.7: prune MFI (collinear with RSI ρ=0.777); OOS ρ improves to 0.488 | ✅ |
| May 2026 | Added live PPI + margin debt fetch from Vercel | ✅ |
| May 2026 | Added TradingView CSV drop zone for RSI/MFI/trend | ✅ |
| May 2026 | Added self-update mechanism (git pull + rebuild) | ✅ |

---

## Known Limitations / Open Questions for Claude Chat

1. **VIX is manual** — is there a free API we can auto-fetch it from?
2. **No injury signal** — applies to individual stocks but not SPY directly
3. **AAII requires manual script run** — could be automated
4. **Eigenvectors were approximated** from the dataset (not from sklearn directly) — ~8–15% approximation error on PC values. Does this meaningfully affect predictions?
5. **Buckets computed from timeseries** — are the forward returns calculated correctly (price 12m later / current price)?
6. **OLS uses only 3 PCs** — would adding PC4 (6% variance) improve OOS ρ?
