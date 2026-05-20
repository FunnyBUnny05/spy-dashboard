# Dead ends — do not reintroduce without new evidence

Append to this file (do not rewrite) each time a new dead end is identified.
Future Claudes: check here before re-running an experiment.

---

## 1. Isotonic recalibration of `pred` (E2 original proposal)

- Forward-walk test (init=36m, refit yearly, 96 OOS months):
  - Raw pred: RMSE 9.91%, MAE 7.46%
  - Isotonic: RMSE 12.58%, MAE 9.40% ← worse
- Decile 6–9 over-optimism is sample noise, not a recalibratable bias.
- See `docs/v3_audit/E2_calibration_proposal.md` (marked REJECTED).

## 2. Trust-gating with rolling 36m OOS ρ (proposed in v6 prep work)

- fiveTier ungated: 12.41% CAGR
- fiveTier gated (only deploy when rolling ρ > 0.2): 11.95% CAGR
- By the time rolling ρ has dropped, the model is about to recover. Gating gives up the recovery period.
- The rolling ρ sparkline (F3) is a transparency feature only — do not add it as a trading gate.

## 3. Shrinkage toward drift (`pred_blend = α·pred + (1−α)·drift`)

- Spearman invariant to α (linear blend with constant).
- RMSE on holdout half: monotonically worse as α drops from 1.0.
- Pred is well-calibrated; shrinkage only adds bias.

## 4. Adding a new signal from the same family (RSI variants, more momentum)

- Ridge sign-constraint already zeroes RSI/MFI/EMA-dist.
- Adding more trend/momentum signals would just get pruned.
- Useful additions must bring orthogonal information (credit spreads, real yields, breadth beyond RSP/SPY).

## 5. Vol-conditional exposure rules in backtest

- Vol-gated TWO(30,80) at threshold 12%: 13.85% CAGR vs ungated 14.00%.
- Slightly worse, and the threshold is data-mined on the same sample. Not a robust addition.

## 6. Smooth exposure functions (logistic, linear ramp)

- Tested: logistic (center=50, slope=0.10), logistic (center=40), linear ramp 20→80, linear ramp 30→80, empirical-bucket-sized exposure.
- All variants worse than TWO(30,80) on CAGR and Sharpe; all have HIGHER turnover.
- Best alternative: logistic center=40 slope=0.10 at 12.76% CAGR vs TWO 14.00%.
- Root cause: score quintile bucket means are non-monotone (Q3 ≈ Q4 on OOS). Step function captures this better.
- Do not propose smooth exposure functions again without new OOS evidence.

## 7. Vol-conditional bias correction as drop-in score replacement (M1 Option B/C)

- Vol-corrected pred improves OOS Spearman ρ: 0.460 → 0.516 and lowers RMSE: 11.28% → 10.62%.
- BUT: using corrected pred as score input shifts score distribution left (median 57 → 39).
  fiveTier CAGR drops 12.42% → 10.35%; TWO(30,80) drops 13.85% → 10.00%.
- Root cause: tier breakpoints (20/40/60/80) were calibrated for the uncorrected distribution.
- Recalibrated breakpoints (20→15.2, 40→23.9, 60→40.0, 80→79.2) still gave 11.54% CAGR vs 12.42% — worse.
- Safe use: display corrected pred as transparency figure only (M1 Option A, implemented in v5.9.0).
- Do not use vol-corrected pred as a drop-in score input.

## 8. Empirical-quantile PI bands (last 60m residuals)

- Empirical 2.5/97.5 quantiles from trailing 60m residuals gave 74%/81% coverage vs 80%/95% target.
- Worse than the constant-σ approach because residual distribution is non-stationary.
- Fix for the narrow 95% band is a z-factor adjustment (z=2.20 instead of 1.96), not quantile PIs.

## 9. Lag-12 residual correction alone

- Applying only the lag-12 residual correction (no vol term) gives Spearman 0.456 vs vol-correction 0.516.
- Not worth the complexity; vol-based correction dominates.

## 10. Combined vol + lag-12 residual correction

- Marginal improvement over vol-only: Spearman 0.518 vs 0.516.
- Two parameters vs one; more variance on short windows. Not worth it.
