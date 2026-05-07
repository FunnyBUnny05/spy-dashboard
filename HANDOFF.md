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
1. Take 7 raw signal values
2. Z-score each signal using historical mean/std
3. Project onto 3 PCA components using fixed eigenvectors
4. Predict 12m forward return using walk-forward OLS
5. Convert to 0–100 score via percentile rank against historical pred distribution

OUTPUT:
- compositeScore (0–100): where we sit in the historical distribution
- predFwd12m: raw predicted 12m return (e.g. +0.14 = +14%)
- bucket: which quintile we're in, with empirical forward return stats
- stance: exposure recommendation based on score
```

---

## Current Model — v4 (as of May 2026)

### 7 Input Signals

| Key | Label | Category | ρ with 12m fwd return | Historical Mean | Std |
|-----|-------|----------|-----------------------|-----------------|-----|
| rsi_14m | RSI (14m) | Momentum | −0.523 | 65.48 | 8.62 |
| mfi_14m | MFI (14m) | Volume momentum | −0.341 | 65.69 | 13.45 |
| ema_dist_pct | EMA-12m dist % | Trend | −0.213 | 5.31 | 5.16 |
| ppi_yoy | PPI YoY % | Inflation | −0.318 | 2.67 | 2.82 |
| mdebt_yoy | Margin debt YoY % | Leverage | −0.226 | 12.01 | 19.29 |
| aaii_spread | AAII stocks−cash | Retail sentiment | −0.607 | 0.489 | 0.052 |
| vix_close | VIX | Volatility/fear | +0.267 | 17.88 | 6.66 |

**Note:** All ρ values are negative except VIX — high RSI/MFI/etc. = bearish. High VIX = bullish.

### Step 1: Z-score each signal
```
z_i = (value_i - mean_i) / std_i
```

### Step 2: PCA — 3 components (85% of variance)

**Eigenvectors** (rows = PC1, PC2, PC3 | cols = rsi, mfi, ema_dist, ppi, mdebt, aaii, vix):
```
PC1 = [ 0.472,  0.444,  0.441,  0.024,  0.436,  0.404, -0.242]   ← 55% variance, Momentum/Risk cluster
PC2 = [-0.087,  0.309, -0.166,  0.694,  0.057,  0.199,  0.545]   ← 19% variance, Inflation vs Fear
PC3 = [-0.038,  0.187,  0.106, -0.461,  0.430, -0.309,  0.676]   ← 11% variance, Cross-currents

PC_k = dot(eigvec_k, z_scores)
```

### Step 3: Walk-forward OLS prediction
```
pred_fwd_12m = 0.1191 + (-0.0318 × PC1) + (-0.0294 × PC2) + (-0.0674 × PC3)
```
OOS Spearman ρ = 0.435 | Residual std = 11.5% | n = 155 training obs

### Step 4: Prediction intervals
```
PI_80 = pred ± 1.282 × 0.1155
PI_95 = pred ± 1.960 × 0.1155
```

### Step 5: Composite score (0–100)
```
score = percentile_rank(pred_fwd_12m, historical_pred_distribution)
```
Historical distribution = 145 sorted walk-forward predictions from 2014–2026.

---

## Quintile Buckets — Empirical 12m Forward Returns

| Quintile | Score Range | n | Mean 12m | CI lo | CI hi | % Negative | Worst |
|----------|-------------|---|----------|-------|-------|------------|-------|
| 1 | 0–20 | 29 | +5.7% | +1.1% | +10.3% | 34.5% | −19.5% |
| 2 | 20–40 | 26 | +8.5% | +4.7% | +12.2% | 19.2% | −17.8% |
| 3 | 40–60 | 23 | +10.1% | +6.3% | +13.9% | 13.0% | −10.3% |
| 4 | 60–80 | 30 | +14.2% | +10.2% | +18.3% | 13.3% | −12.1% |
| 5 | 80–100 | 25 | +23.1% | +16.4% | +29.8% | 8.0% | −2.1% |

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

**Current score: ~45 / 100 (Quintile 3 — Neutral)**

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
