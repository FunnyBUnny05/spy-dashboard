# URGENT — Dashboard Is Showing Wrong Signal Values

**Status:** 6 of 9 signals on the live dashboard do NOT match the CSV data
the user actually dropped. The score 13.8 is **wrong**. Based on the user's
actual CSVs, the correct score is approximately **27**.

This file describes the bugs found and what Claude Code must fix.

---

## What the user dropped vs. what the dashboard shows

The user dropped 5 monthly TradingView CSVs (verified). I computed the signals
from these CSVs and compared to the displayed dashboard values:

| Signal | From CSV | Displayed | Match? |
|---|---|---|---|
| RSI (14m) | **73.86** | 21.8 | ❌ |
| MFI (14m) | **69.08** | 62.8 | ❌ |
| EMA-12m dist % | **+9.84%** | -13.82% | ❌ (wrong sign!) |
| Yield curve 10Y-3M | **+0.918** | 0.30 | ❌ |
| Breadth (RSP/SPY 12m) | **-8.84%** | +25.0 | ❌ |
| VIX | 18.43 | 18.43 | ✅ |
| PPI YoY (live feed) | 5.99% | 5.99% | ✅ |
| Margin debt YoY (live feed) | 53.3% | 53.3% | ✅ |
| AAII spread | 0.526 | 0.526 | ✅ |

The CSVs are valid monthly TradingView exports of:
- `SP_SPX, 1M_e5469.csv` — SPX index (1670 monthly bars 1871→2026, last close 7408.49)
- `BATS_RSP, 1M_c5ce7.csv` — RSP equal-weight ETF (278 monthly bars 2003→2026, last 201.56)
- `CBOE_DLY_VIX, 1M_5bfa3.csv` — VIX (437 monthly bars, last 18.43)
- `TVC_US10Y, 1M_535ec.csv` — 10Y yield (1268 monthly bars, last 4.597)
- `TVC_US03MY, 1M_20434.csv` — 3M yield (869 monthly bars, last 3.679)

I verified RSI=73.86 against TradingView's own RSI column in the SPX CSV — they
match exactly. So the *correct* monthly RSI of SPX is 73.86. The dashboard is
showing 21.8, which is impossible for monthly RSI of SPX in this market.

---

## Score impact

Recomputed using the v5.7 ridge with correct signals:

```
With CORRECT signals from CSVs:
  pred_fwd_12m = +8.70%   (drift = +15.03%)
  sigma_t      = 0.1030
  Score        = 26.96   [band 5-65]
  Zone         = DEFENSIVE (still <30, but at the top of the band)

With CURRENT (wrong) displayed signals:
  pred_fwd_12m = +3.90%
  sigma_t      = 0.1030
  Score        = 14.00   [band 2-47]
  Zone         = DEFENSIVE — "EXTREME CAUTION"
```

**Magnitude: 13-point error.** Same zone (DEFENSIVE), but the dashboard is
saying "extreme caution / wait for >15% drawdown" when the correct read is
"upper end of defensive / tighten stops". The user is being told to be
*more bearish than the data supports*.

---

## Confirmed bug — BreadthCsvDrop expects WEEKLY data but accepts MONTHLY silently

File: `src/components/BreadthCsvDrop.tsx`

Line 47:
```typescript
if (rows.length < 53) throw new Error(`Need at least 53 weekly bars (got ${rows.length}). Use weekly RSP data.`);
```

Line 73:
```typescript
const price52wAgo = rows[rows.length - 53]?.close ?? rows[0].close;
const rspReturn12m = ((latest.close - price52wAgo) / price52wAgo) * 100;
```

**The bug:** The component is hardcoded to use position `[n-53]` for the
"12 months ago" close, on the assumption that data is weekly (53 weeks ≈ 1 year).
The user dropped *monthly* RSP data (278 bars from 2003 to 2026). With monthly
data, position `[n-53]` is **53 months ago (January 2022)**, not 12 months ago.

What this produces with the user's data:

```
RSP latest:              $201.56 (2026-05)
RSP "12m ago" (n-53):    $155.64 (2022-01)  ← WRONG, picks 4.4 yrs ago
RSP true 12m ago (n-13): $176.43 (2025-05)  ← CORRECT
RSP "12m return" (bug):  +29.50%             (actually 53-month return)
RSP true 12m return:     +14.24%
```

When combined with the (correct) SPX 12m return of +25.32%, the breadth ratio
calc gives:
```
breadth = ((1 + 29.50/100) / (1 + 25.32/100) - 1) × 100 = +3.34%
```

That's still not the +25.0 the dashboard shows (which suggests stale
localStorage from an older RSP CSV drop), but it's wrong either way.

### Fix

The drop component must either:

**Option A (simpler — match TradingView CSV defaults):** Accept *monthly* RSP
data. Change the constant and the lookback:

```typescript
// Before
if (rows.length < 53) throw new Error(`Need at least 53 weekly bars ...`);
const price52wAgo = rows[rows.length - 53]?.close ?? rows[0].close;

// After — detect bar frequency from average bar spacing (same trick as SpyCsvDrop)
const avgDays = (new Date(rows[rows.length-1].date).getTime() - new Date(rows[0].date).getTime())
                / 86400000 / (rows.length - 1);
const isMonthly = avgDays > 20;
const lookback  = isMonthly ? 12 : 53;          // 12 monthly bars OR 53 weekly bars = 1 year
const minBars   = isMonthly ? 24 : 53;
if (rows.length < minBars) throw new Error(`Need at least ${minBars} ${isMonthly ? 'monthly' : 'weekly'} bars (got ${rows.length}).`);
const price12mAgo = rows[rows.length - lookback - 1]?.close ?? rows[0].close;
```

Note the off-by-one: with `n` bars, "12 months ago" relative to the latest bar
is `rows[n - 13]` (skip 12 bars). Verify with `SpyCsvDrop` which already uses
`rows[rows.length - 13]` for monthly correctly.

**Option B (stricter):** Reject monthly data, force weekly. But then update
the UI copy to say "MONTHLY data not supported, use 1W" since the user is
clearly dropping monthly. Worse UX.

Go with Option A.

---

## Likely bug — RSI/EMA/MFI not actually updating from the SPX CSV

The math in `SpyCsvDrop.tsx` is correct (I tested it). If a monthly SPX CSV
with 1670 bars is dropped, `computeSpySignals` should output:
```
rsi14    = 73.86
ema12m   = +9.84% (EMA-dist)
mfi14    = 69.08
return12m = +25.32%
```

But the dashboard shows RSI 21.8, EMA-dist -13.82%, MFI 62.8. These values
cannot come from this CSV under any correct code path.

Three possible explanations, in decreasing likelihood:

### Possible cause 1 — Stale localStorage from a previous CSV drop

In `App.tsx` line 60:
```typescript
const [spySignals, setSpySignals] = useState<SpySignals | null>(() => {
  try {
    const s = localStorage.getItem('spy_csv_signals');
    ...
  }
});
```

The user may have dropped a *different* CSV at some earlier point — possibly an
inverse ETF (SH, SDS) which would give RSI ~21.8, or a sector ETF that's been
crashing. That value is in `localStorage` under `spy_csv_signals` and never
gets replaced because the new drop is silently failing.

The migration check on line 66 (`if (parsed.return12m == null || parsed.ema12m == null) ...`)
only catches *old format* values. It doesn't catch *stale format-correct* values.

**Fix:** Add a Reset/Clear button on each CSV drop zone that wipes localStorage
for that signal. Already partly addressed in the existing UI? Verify and surface
it more prominently.

Also, add a console log on every CSV drop that prints the resulting signals.
This way the user can verify the drop actually worked by opening dev tools.

### Possible cause 2 — User dropped the SPX CSV into the wrong zone

The labels on the drop zones look correct (SPX/SPY zone, RSP zone, yield zone),
but if the user dragged 5 CSVs and they auto-distributed somehow, or the user
dropped them in a wrong order, the SPX file might have ended up in the breadth
zone and vice versa.

The filenames are unambiguous though (`SP_SPX, 1M_e5469.csv` etc.). The drop
zones should validate the ticker by reading column data or filename hints.

**Fix:** Add filename-hint validation in each CSV drop component:

```typescript
// In SpyCsvDrop processFile
if (!/(\bSPX\b|\bSPY\b|^SP_|^BATS_SPY|^CBOE_SPX)/i.test(file.name)) {
  console.warn(`Filename "${file.name}" doesn't look like SPX/SPY. Continuing anyway.`);
}
```

Same pattern for BreadthCsvDrop (warn if not RSP), YieldCurveCsvDrop (warn if
not TNX/IRX/US10Y/US03MY).

### Possible cause 3 — A parsing bug we haven't found

Less likely given the SpyCsvDrop math reads cleanly when I test it on the same
CSV. But possible. Suggested debugging:

Add to SpyCsvDrop after `computeSpySignals` is called:
```typescript
const sig = computeSpySignals(rows);
console.log('[SpyCsvDrop] computed signals:', sig);
```

Have the user reload the dashboard with dev tools open, re-drop the CSV, and
report what the console shows. That will tell us conclusively whether the CSV
is being parsed correctly.

---

## Confirmed: yield curve also shows wrong value

The dashboard shows 0.30 for yield curve. From the CSVs:
- US10Y last: 4.597
- US3M last: 3.679
- Curve: **+0.918**

`YieldCurveCsvDrop.tsx` looks at the latest common date between the two CSVs
and subtracts. With these two CSVs (both ending 2026-04 with matching last
date), it should compute +0.918.

Almost certainly the same localStorage staleness issue from a previous drop.
Same fix applies (clear button + logging).

---

## Recommended fix order

1. **Fix BreadthCsvDrop monthly handling** (Option A above). This is a hard
   bug — same code path that the user is on now would still be wrong even
   after a clean reload.

2. **Add Reset/Clear All button** to wipe all CSV-related localStorage keys
   in one click:
   ```typescript
   const clearAllCsvCache = () => {
     ['spy_csv_signals', 'vix_csv_signals', 'yield_csv_signals', 'breadth_csv_signals'].forEach(k => localStorage.removeItem(k));
     window.location.reload();
   };
   ```
   Surface this button on the SPY Data tab next to the drop zones.

3. **Add visible "loaded values" display** under each drop zone showing
   exactly what got computed. Already partially exists in `SpyCsvDrop`
   (status message). Make sure RSI, EMA-dist, MFI, and 12m return are all
   shown after a successful drop so the user can sanity-check immediately:

   ```
   ✓ Loaded 1670 monthly bars through 2026-05-01
       RSI(14m):     73.86
       EMA-dist:     +9.84%
       MFI(14m):     69.08
       12m return:   +25.32%
   ```

   Repeat for all four CSV components.

4. **Add input-range validation in computeV2** (Issue 1 from v2 handoff).
   Even after the CSV bugs are fixed, this is the only safety net against
   future bad data. When a signal value is outside its historical training
   range, flag it red and warn the user. This would have caught the current
   bug immediately because RSI=21.8 is far below the historical min of 43.54.

5. **Have the user drop all 5 CSVs again** after the fix is shipped and
   verify the score updates to ~27.

---

## What the user should see after the fix

With CORRECT signals from the user's actual CSVs:

```
Composite score:  27    [band 5-65]
Zone:             DEFENSIVE (upper end)
pred fwd 12m:     +8.7%
12m fwd return at this score range:  Q2 mean +10.6%, n=15

Driver decomposition:
  PPI YoY 5.99% (88th pct)        →  -3.83pp drag
  AAII spread 0.526 (77th pct)    →  -5.71pp drag (strongest)
  Yield curve +0.92 (41st pct)    →  +1.55pp
  Breadth -8.84% (9th pct)        →  +2.35pp (narrow breadth is actually BULLISH here)

Inactive signals (zero coef, display only):
  RSI 73.86 (75th pct) — overbought but doesn't move score
  MFI 69.08 (66th pct)
  EMA-dist +9.84% (80th pct) — extended above 12m EMA
  Mdebt YoY 53.3% (99th pct) — extreme but excluded by sign constraint
  VIX 18.43 (65th pct) — normal vol
```

The story this tells is different from "extreme caution":
**high inflation + crowded retail long are dragging the score below the drift,
but the market is not actually crashing (RSI 74, EMA-dist +10%). Defensive
positioning is justified by the macro inputs, but this is not a panic
buy-the-drawdown moment.**

That's a much more accurate picture for the user's "tighten stops vs. exit"
decision than the current 13.8 EXTREME CAUTION reading.

---

## Files referenced

- `src/components/BreadthCsvDrop.tsx` — needs monthly support (Option A)
- `src/components/SpyCsvDrop.tsx` — add console logging on drop
- `src/components/YieldCurveCsvDrop.tsx` — likely same caching issue
- `src/App.tsx` — needs clear-cache button
- `src/lib/scoring.ts` — add input-range validation (per CLAUDE_CODE_HANDOFF_v2.md Issue 1)
