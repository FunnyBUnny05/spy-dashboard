# Handoff to Claude Code — Implement Benchmark Findings

**Read this first:** This is a list of concrete UI/logic changes for the SPY dashboard
based on a benchmark of the v5.7 composite score against historical data
(2010-12 → 2026-05, 183 monthly returns). Full benchmark in `scripts/BENCHMARK_REPORT.md`.

The benchmark answered the question: **does the score actually help?**

Answer: **yes, but only as a risk/exit signal, not as a return-enhancing signal.**

The dashboard currently presents the score as a single 0-100 number with a stance
label. That's fine, but it underuses what the data actually supports. The user's
real workflow is:

> "Tell me when to exit or tighten stops when things get hot,
>  and when the bottom is in so I can re-enter."

The changes below restructure the dashboard around that workflow.

---

## Priority 0 — What the benchmark proved

Before implementing, understand these facts so the UI doesn't oversell:

1. **The score does NOT add return vs. buy-and-hold.** Full-sample STANCE: 11.76% CAGR vs BH 12.41%. Walk-forward BIN_opt: 10.75% vs BH 12.90%. **Do not put a "this strategy beat the market" claim anywhere.**
2. **The score DOES add risk-adjusted value.** Walk-forward TWO(30,80) had OOS Sharpe 0.95 vs BH 0.72, max drawdown -11.7% vs -24.8%.
3. **The Sharpe improvement is not statistically significant at 5%.** Block-bootstrap 95% CI on Sharpe diff (STANCE−BH) was [-0.055, +0.298]. Mean +0.127, P(positive)=92.1%. Don't lie about significance.
4. **The most stable threshold in walk-forward is TWO(30, 80).** All 10 folds picked the same low=30, high=80 thresholds. This is the most defensible point system.
5. **The most actionable signal is the Q1 veto.** Score < 20 had 61% probability of negative 12m return, mean −3.8%. This is what flagged Dec 2021 (score 2.2) before the 2022 bear and 2011-04 (score 13.1) before the summer drawdown.

---

## Change 1 — Replace single "stance" with three zones based on TWO(30, 80)

**Why:** Walk-forward stability. Every single fold (10/10) picked low=30, high=80. The 5-zone HANDOFF stance is not wrong, but it's not what the data actually supports.

**What to change:**

In `src/lib/scoring.ts`, replace the 5-bucket stance mapping with 3 zones:

```
score < 30          → DEFENSIVE   ("reduce exposure, tighten stops, no new buys")
30 ≤ score < 80     → NORMAL      ("hold target exposure")
score ≥ 80          → OPPORTUNITY ("add on weakness")
```

Keep the underlying 5-quintile bucket data for the "historical reference" panel
(the buckets table), but the headline stance should be these 3 zones.

**UI:** A traffic-light style indicator (red < 30, amber 30-80, green ≥ 80) is
probably clearer than the current stance label.

---

## Change 2 — Add an "exit / tighten stops" alert

**Why:** This is the user's primary use case. When score crosses below 30 (or
when score < 20 specifically), they want a clear flag, not a number to interpret.

**What to add:**

A persistent banner at the top of the dashboard that triggers on three conditions:

1. **Hard warning (red banner):** `score < 20` — show "Q1 zone. Historical 12m return at this score: −3.8%, 61% chance of being negative (n=18). Consider tightening stops or reducing exposure."
2. **Soft warning (amber banner):** `score crossed from ≥30 to <30 this month` — show "Score dropped into defensive zone this month. Recent history: this signal preceded the 2022 bear (Dec 2021, score=2.2) and 2011 summer drawdown (Apr 2011, score=13.1)."
3. **Entry signal (green banner):** `score crossed from <60 to ≥60 this month` AND `previous low was <30` — show "Recovery from defensive zone. Historical Q4/Q5 forward returns: +15-25% mean."

Banner state should be computed from `model.json` timeseries history, not just
current score. Look at the prior 3 months to detect crossings.

---

## Change 3 — Add year-by-year attribution chart

**Why:** The benchmark broke down where STANCE_NL beat or lagged BH year by year.
This is honest about when the score helps and when it hurts. Hiding this would
be dishonest.

**What to add:**

A bar chart on the "About the Model" page or a new "Track Record" tab showing,
for each calendar year:
- BH return (gray bar)
- STANCE_NL return (blue bar)
- Difference label (+pp or −pp)

Data source: replicate the year-by-year output from `scripts/verify_backtest.py`
section 3 (or just inline the values — they don't change unless the model retrains).

Add a one-line interpretation: "The score helped most in 2011, 2020, 2022, and 2025.
It hurt most in 2014, 2017, 2021, 2024 — strong bull years where it was over-cautious."

---

## Change 4 — Replace the score number with a score + uncertainty

**Why:** A single number "26.34" implies precision the model does not have.
Residual std is 0.1038 — that's a ±10pp band on the predicted return, which
translates to a wide CI on the score itself.

**What to change:**

Display the score as `26 [22–31]` where the brackets are the 1σ band derived from
`sigma_t` (already computed in scoring.ts for the heteroscedastic σ). The
conversion is:
```
score_low  = normCDF((pred - drift - sigma_t) / sigma_t) * 100
score_high = normCDF((pred - drift + sigma_t) / sigma_t) * 100
```
i.e. shift `pred` by ±1σ_t before re-running normCDF, holding the denominator fixed.

This makes it visually obvious that a "score of 50" vs "score of 55" is meaningless.

---

## Change 5 — Add a 12-month score history sparkline

**Why:** Crossings matter more than current level. The user's workflow is "watch
for the score to drop." A 12m sparkline on the main page makes that immediate.

**What to add:**

A small sparkline next to the headline score showing the last 12 months of score
values. Horizontal reference lines at 30 and 80. Dot on the current point.

Data source: `model.json` timeseries last 12 rows.

---

## Change 6 — Backtest panel (the actual proof)

**Why:** Users should be able to see for themselves that the score works as
claimed. Don't make them trust the numbers in this file.

**What to add:**

A new tab or section showing two equity curves overlaid (2010-12 → today):
- Buy-and-hold SPY
- STANCE_NL strategy (or TWO(30,80) — your choice; STANCE_NL is what the dashboard's stance bins implement, so use that for consistency)

Underneath the chart, a small table:
```
                  BH        STANCE_NL
Final value      5.96x      5.45x
CAGR            12.41%     11.76%
Sharpe           0.72       0.84
Max drawdown   -24.8%     -16.4%
```

And a single-sentence honest caption: *"On a return basis STANCE matches buy-and-hold. The model's value is in risk: ~35% smaller worst-case drawdown, marginally better Sharpe (statistical significance: 92%, not 95%)."*

Numbers come from `scripts/backtest_v1.py` output — they're already computed.

---

## Change 7 — Replace the current "drift = 0.1503" anchor

**Why:** The score=50 anchor at "≈15%/yr expected return" is a quirk of the
sample period. It makes 50 NOT mean "neutral" in any meaningful long-run sense,
which is confusing. The HANDOFF.md already notes this.

**What to change:**

This is a model-level change, not just UI. Two options:

**Option A (lighter):** Keep `drift = 0.1503` but add a clarifying tooltip on the
score gauge: "Score 50 = predicted return matches the 2009-2026 sample mean (~15%/yr). This is above the long-run SPY average (~10%). A score of ~40 corresponds to a neutral expectation vs. long-run base rates."

**Option B (heavier):** Re-anchor `drift` to the long-run SPY nominal return (~0.10
for 10%/yr). This shifts all historical scores upward and changes bucket boundaries.
DO NOT do this without re-running the full bucket/backtest analysis.

Recommend A unless the user explicitly asks for a re-anchor.

---

## Change 8 — Honest about the lookahead caveat

**Why:** The model.json was fit on the full 2009-2026 sample. Even 2011's score
implicitly knows the 2025 signal distribution (via the rank-Gauss reference array).
Real-time scores will be slightly noisier than historical ones. The dashboard
currently shows historical scores without flagging this.

**What to add:**

In the methodology / "About" page, add a note:
*"Historical scores were computed using a model fit on the full 2009-2026 sample. A real-time score computed in 2015 would have been similar but noisier (no future signal distribution to reference). For a truly walk-forward score history, see `scripts/walk_forward_score.py` (not yet implemented — see Change 9)."*

---

## Change 9 — (Bigger lift) True walk-forward score recomputation

**Why:** The single biggest honesty improvement. Currently every score in
`model.json.timeseries` was computed with full-sample model parameters. A real
walk-forward would refit the ridge in each fold using only data available at
that point in time.

**What to do:**

Create `scripts/walk_forward_score.py` that:
1. Starts at month 60 (need enough training data).
2. For each subsequent month t, fits ridge on rows [0, t-12) — exclude the most
   recent 12 months from training because their 12m forward returns are not yet
   realised.
3. Computes rank-Gauss for month t using only the sorted reference array of months
   [0, t-12).
4. Predicts the score for month t with this temporally-honest model.
5. Stores both `score_wf` (walk-forward) and existing `score` in model.json
   timeseries.

UI then has the option to show either. Probably default to the full-sample score
(more accurate for current display) but show the walk-forward score in the
backtest panel for honesty.

This will likely shift the early sample scores by 5-15 points and degrade the
backtest performance somewhat. That's expected and correct — the current numbers
are an upper bound.

---

## Change 10 — Document the actionable thresholds prominently

**Why:** Right now a user has to read HANDOFF.md to know what score ranges mean.
The user's workflow is: see score → decide action. Make that one click.

**What to add:**

On the main dashboard, directly under the score, a static reference card:

```
What this score means historically (12m forward returns, 2010-2026 sample):

  Score 0-20    n=18   mean -3.8%    61% negative   → DEFENSIVE
  Score 20-40   n=15   mean +10.6%    7% negative   → NEUTRAL
  Score 40-60   n=35   mean +16.2%    0% negative   → INVESTED
  Score 60-80   n=42   mean +15.5%    5% negative   → INVESTED
  Score 80-100  n=26   mean +25.0%    4% negative   → OPPORTUNITY
```

Be careful: the n_eff for Q1, Q2, Q5 is 1-2, meaning the CIs are wide. The point
estimates are still informative. Mention this caveat in a tooltip but don't bury
it in fine print.

---

## What NOT to do

1. **Don't add a "buy/sell" button or auto-execution.** This is a research tool, not a trading bot.
2. **Don't claim the score "beats the market."** It doesn't, on a return basis. It reduces risk.
3. **Don't replace the 5-bucket reference table with the 3-zone version.** Keep both — the 5-bucket data is informative, the 3-zone version is for action.
4. **Don't optimize the thresholds dynamically.** Walk-forward showed BIN_opt was unstable (threshold drifted from 30 to 70 across folds — overfit). The fixed (30, 80) thresholds from TWO_opt are robust because they were the same in every fold. Keep them fixed.
5. **Don't add transaction-cost simulation as a headline feature.** Monthly rebalancing at ~6bp/yr drag is immaterial relative to the noise in the Sharpe estimate. Mention in methodology only.

---

## Order of implementation

If pressed for time, do them in this order:

1. **Change 2** (exit alert banner) — directly serves the user's stated workflow.
2. **Change 10** (actionable thresholds card) — high information density, low effort.
3. **Change 5** (12m sparkline) — small effort, big interpretability gain.
4. **Change 6** (backtest panel) — gives the user evidence.
5. **Change 1** (three-zone stance) — small refactor.
6. **Change 4** (score uncertainty band) — small refactor.
7. **Change 3** (year-by-year chart).
8. **Change 7** (clarifying tooltip on drift).
9. **Change 8** (lookahead note in methodology).
10. **Change 9** (walk-forward score recomputation) — biggest lift, do last.

---

## Files referenced

- `scripts/backtest_v1.py` — full-sample strategy backtests
- `scripts/threshold_opt.py` — walk-forward threshold optimization
- `scripts/verify_backtest.py` — sanity checks, year-by-year attribution, bootstrap CI
- `scripts/BENCHMARK_REPORT.md` — full report

When implementing, run those scripts first to confirm the numbers in this file
still match what the model currently produces. If `model.json` has been retrained
since 2026-05-17 the specific numbers (CAGR, Sharpe, drawdown) will have shifted.
The qualitative conclusions should not.
