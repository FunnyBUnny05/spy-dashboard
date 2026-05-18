# E1: Threshold System Consolidation Proposal

## Problem

Three overlapping stance/label systems currently coexist in the codebase, producing contradictory UI output at the same score value:

1. **`stanceFor`** (`src/lib/scoring.ts`, line 361) — five-band system with 20/40/60/80 breakpoints, yielding labels: `Wait / buy panic` / `Defensive` / `Neutral` / `Bullish` / `Aggressive long`.
2. **`stanceZoneFor`** (proposed) — three-zone system with 30/80 breakpoints, yielding: `DEFENSIVE` / `NORMAL` / `AGGRESSIVE`.
3. **`scoreLabel`** (`src/App.tsx`, line 166) — five-label system with identical 20/40/60/80 breakpoints, yielding: `EXTREME CAUTION` / `CAUTIOUS` / `NEUTRAL` / `BULLISH` / `STRONG BULL`.

At score=35, the header badge simultaneously reads "NORMAL" (three-zone) and "CAUTIOUS" (scoreLabel), signaling contradictory posture to the user. This is not a display bug — it reflects a deeper ambiguity about which system is authoritative for portfolio action.

## Recommendation

The **three-zone system (`stanceZoneFor`)** should be the canonical, action-driving classification, because: (a) the walk-forward audit found it to be stable across the OOS window — the 30 and 80 breakpoints align well with historically meaningful regime transitions; and (b) three zones map cleanly to actionable portfolio postures (reduce / hold / add) without the false precision of five bands. `stanceFor` should be retained as a subordinate detail function that populates the recommended-exposure tooltip and action text, but it should no longer drive the primary badge. `scoreLabel` in `App.tsx` should be replaced by the three-zone label (`DEFENSIVE` / `NORMAL` / `AGGRESSIVE`) as the primary badge text; the existing five-label `scoreLabel` string can be kept as a subtitle or tooltip if granularity is desired, but it must not appear at the same visual weight as the zone label, to eliminate the current side-by-side contradiction.
