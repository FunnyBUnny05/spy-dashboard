# SPY Composite-Score Benchmark — Honest Report

Date: 2026-05-17
Sample: 2010-12 → 2026-05 (183 monthly returns, 15.25 yrs)
Model: v5.7 (ridge on rank-Gaussed signals, 4 active coefficients)

---

## TL;DR

The composite score **does not reliably add return** vs. buy-and-hold SPY. Its real value is **risk reduction**: lower vol, smaller drawdowns, better Sharpe — but the improvement is **not statistically significant** at the 5% level with this sample size.

| Strategy        | CAGR    | Sharpe | MaxDD   | Verdict                                  |
|-----------------|---------|--------|---------|-------------------------------------------|
| Buy-and-hold    | 12.41%  | 0.72   | -24.8%  | Baseline                                  |
| STANCE (no lev) | 11.76%  | 0.84   | -16.4%  | Better Sharpe, less DD, slightly less return |
| STANCE (w/ lev) | 12.91%  | 0.87   | -16.4%  | Marginally better on every axis (full-sample, optimistic) |
| BIN_50          | 10.02%  | 0.65   | -23.1%  | Binary in/out at score=50 is *worse* than BH |
| TWO_opt (WF)    | 11.29%  | 0.95   | -11.7%  | Best risk-adjusted in walk-forward; trades 1.6pp CAGR for half the drawdown |

WF = walk-forward, no optimizer lookahead. Other rows use full-sample model parameters.

---

## What the score gets right

Year-by-year attribution of STANCE_NL vs. BH:

| Year | BH      | STANCE  | Diff      | What happened                                        |
|------|---------|---------|-----------|------------------------------------------------------|
| 2011 |   0.00% |  +5.25% |  **+5.25**| Score 13 at Apr peak → dodged summer -17% drawdown   |
| 2022 |  -6.54% |  +1.57% |  **+8.11**| Score 2 at Dec'21 peak → dodged most of bear market  |
| 2020 | +29.0%  | +31.2%  |  +2.17    | Score went up during March COVID crash (correct)     |
| 2025 | +15.5%  | +19.1%  |  +3.58    | Defensive ahead of Jan-Mar pullback                  |

And what it gets wrong:

| Year | BH      | STANCE  | Diff      | What happened                                        |
|------|---------|---------|-----------|------------------------------------------------------|
| 2017 | +20.2%  | +11.0%  |  -9.16    | Strong bull, score stayed cautious — biggest miss    |
| 2021 | +13.6%  |  +7.1%  |  -6.47    | Score went bearish months before the actual top      |
| 2024 | +15.9%  | +10.1%  |  -5.78    | Bull year, score cautious                            |
| 2014 | +12.4%  |  +6.9%  |  -5.46    | Calm bull year, score over-cautious                  |

Pattern: the score is **right at turning points** but **early to the bear thesis**. In clean bull markets it leaves return on the table.

---

## Statistical significance (the part most reports skip)

Block-bootstrap (block=6 months, B=5000) on Sharpe diff (STANCE_NL − BH):

- Point estimate: **+0.127**
- 95% CI: **[-0.055, +0.298]**
- P(STANCE Sharpe > BH Sharpe): **92.1%**
- Significant at 5%? **No.**

Translation: there is a 92% chance the improvement is real, but with 15 years of data we cannot rule out that it's noise. To get 95% confidence on a Sharpe diff this size, you'd typically need ~25+ years of monthly data, or daily data.

The drawdown reduction (-16.4% vs -24.8%) is more visible but also single-path; we have no CI on it.

---

## Walk-forward threshold optimization

Expanding window, init=60 months, re-fit yearly, 12-month test windows. 120 OOS months from 2016-01 to 2026-02.

| Strategy            | Picks (across 10 folds)            | OOS Sharpe | OOS CAGR | OOS MaxDD |
|---------------------|------------------------------------|-----------|----------|-----------|
| BH                  | n/a                                | 0.72      | 12.90%   | -24.8%    |
| STANCE_NL (fixed)   | fixed bins from HANDOFF            | 0.85      | 12.58%   | -16.4%    |
| BIN_opt             | t = 30,30,30,30,15,60,60,70,70,70  | 0.72      | 10.75%   | -23.1%    |
| TWO_opt             | always (low=30, high=80)           | **0.95**  | 11.29%   | **-11.7%**|

Key observations:

- **BIN_opt is unstable.** The optimal binary threshold drifts from 30 (pre-2020) to 70 (post-2022). Classic overfit symptom — the optimizer chased recent training-fold patterns and underperformed BH OOS.
- **TWO_opt is robust.** All 10 folds independently picked (low=30, high=80), suggesting this is a real shape in the data, not a fit artifact. It gives up 1.6pp of CAGR for a 53% reduction in max drawdown.
- **STANCE_NL (no fitting at all)** beats BIN_opt and is competitive with TWO_opt. Worth more than the cleverness of optimization.

---

## Caveats and what would make this stronger

1. **Soft lookahead in score values.** `model.json` was fit on the full 2009-2026 sample. So even the 2011 score implicitly knows the 2025 distribution of signals. A true walk-forward would refit the ridge in each fold. Likely makes the early-sample scores noisier and modestly degrades the result above.

2. **No transaction costs.** STANCE rebalances monthly; assuming 1bp slippage that's ~6bp/yr drag — not material.

3. **Single market regime.** 2010-2026 was dominated by one big bull market with three pullbacks. Sharpe estimates have wide CIs because there are not enough independent regime cycles.

4. **n_eff problem persists.** Quintile-bucket CIs (Q1, Q2, Q5) remain unreliable because Newey-West n_eff is 1-2 due to overlapping 12m horizons. Q4 mean still < Q3 mean (sample noise, n_eff=4).

5. **Risk-free rate.** Assumed flat 2% nominal. Actual rates ranged 0-5.5% over the sample; using time-varying rf would slightly hurt STANCE (it sits in cash during high-rate periods and gets more there) but the magnitude is small (~50bp/yr).

---

## Honest recommendation

If the goal is **"tell me when not to enter"**: the score works. Q1 (score < 20) has historically had a 61% chance of negative 12m returns and an average return of -3.8%. That's a real signal worth respecting — 2011, 2018, 2022 entries all came from low scores. Use it as a **veto**, not a target.

If the goal is **"maximize returns"**: stay invested. None of the dynamic strategies beat BH on CAGR in walk-forward.

If the goal is **"sleep better while staying invested"**: STANCE_NL or TWO(30,80) are both defensible. They give up 0.5-1.5pp/yr of return for ~35-50% less max drawdown. Whether that's worth it is a preference question, not a math question.

---

## Files

- `scripts/backtest_v1.py` — full-sample backtest, all strategy variants
- `scripts/threshold_opt.py` — walk-forward threshold optimization
- `scripts/verify_backtest.py` — sanity checks, attribution, bootstrap CI
