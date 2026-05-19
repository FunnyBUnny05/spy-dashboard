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
