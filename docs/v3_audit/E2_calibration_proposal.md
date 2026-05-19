# E2: Decile 6–9 Over-Optimism Calibration Proposal

## Problem

The walk-forward audit found the composite model is 3–7 percentage points too optimistic in deciles 6–9 (raw scores approximately 60–90, the "bullish" range). This means that when the model signals `BULLISH` or `STRONG BULL`, the empirically realized forward return distributions are materially worse than implied. The over-optimism is concentrated at the top end and is not symmetric — lower deciles are well-calibrated — which suggests the issue is a specific property of the ridge model's behavior near the upper tail, not a global scale error.

## Options Considered

1. **Retrain with stronger ridge shrinkage (α > 5):** Correct at the source, but requires running the full Python pipeline, regenerating `model.json`, and re-validating the walk-forward scores. Risk of over-correcting mid-range deciles that are currently well-calibrated.
2. **Post-hoc isotonic recalibration of `pred` in `scoring.ts`:** Apply a monotone step function (derived from the calibration curve) to the raw `pred` value before it enters the composite score calculation. Mathematically sound — isotonic regression is the canonical tool for this — and can be implemented entirely in TypeScript without touching the Python pipeline.
3. **Raise the BULLISH threshold from 60 to 65:** Simple, but treats the symptom rather than the cause. The underlying `pred` value and composite score remain miscalibrated; only the label boundary shifts, which papers over the problem without fixing it.

## Recommendation

**Option 2 — post-hoc isotonic recalibration of `pred` in `scoring.ts`** is the right path. It is mathematically principled: isotonic regression is specifically designed to fix monotonicity-preserving probability miscalibration, and the 3–7pp over-optimism pattern in deciles 6–9 is exactly the shape of problem it corrects. The calibration lookup table (a short array of breakpoints derived from the audit's reliability diagram) can be embedded directly in `scoring.ts` as a small constant, keeping the fix visible and auditable in the TypeScript layer without requiring a Python environment. Option 3 should be explicitly rejected — adjusting thresholds without fixing the underlying `pred` miscalibration means the exposure recommendations attached to `stanceFor` will still be wrong even if the badge label looks better. Option 1 remains the long-term correct solution and should be scheduled as a model refresh, but it is not a blocker for the immediate calibration fix.

---

## REJECTED 2026-05-19

Forward-walk test (36m initial, refit yearly, 96 OOS months) showed isotonic
regression increases RMSE from 9.91% to 12.58% and adds a −3.71% bias. The
in-sample deciles 6–9 over-optimism is sample noise (n_eff = 3–4 per bucket)
not a recalibratable bias. Do not ship.

| Method   | RMSE   | MAE   | Bias   |
|----------|--------|-------|--------|
| Raw pred | 9.91%  | 7.46% | +0.98% |
| Isotonic | 12.58% | 9.40% | −3.71% |

Do **not** add any isotonic code to `src/lib/scoring.ts`.
