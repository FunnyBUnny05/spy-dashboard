# Benchmark Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 10 changes from `CLAUDE_CODE_HANDOFF.md` — restructuring the SPY dashboard around the user's primary workflow: exit/tighten when things get hot, re-enter when the bottom is in.

**Architecture:** New components for banner, sparkline, thresholds card, and a Track Record tab; scoring.ts gains `stanceZoneFor()` and `scoreUncertainty()`; backtest helpers extracted to `src/lib/backtest.ts`; a Python script produces walk-forward scores patched into `model.json`.

**Tech Stack:** React 18, TypeScript, Vite, chart.js 4 / react-chartjs-2 5, Electron 30, vitest (added here), Python 3 + numpy/pandas/scipy/sklearn (walk-forward script).

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/lib/backtest.ts` | Shared equity-curve helpers (extracted from StrategyPanel) |
| Create | `src/components/AlertBanner.tsx` | Exit/entry alert banner (Change 2) |
| Create | `src/components/ThresholdsCard.tsx` | Historical reference card (Change 10) |
| Create | `src/components/ScoreSparkline.tsx` | 12-month score sparkline (Change 5) |
| Create | `src/components/TrackRecordPanel.tsx` | Track Record tab (Changes 3, 6, 8) |
| Create | `src/components/YearByYearChart.tsx` | Attribution bar chart (Change 3) |
| Create | `scripts/walk_forward_score.py` | Walk-forward score computation (Change 9) |
| Modify | `src/lib/scoring.ts` | Add `stanceZoneFor()`, `scoreUncertainty()`, update types (Changes 1, 4, 9) |
| Modify | `src/components/StrategyPanel.tsx` | Import helpers from backtest.ts |
| Modify | `src/components/Gauge.tsx` | Add sparkline + uncertainty band + drift tooltip (Changes 4, 5, 7) |
| Modify | `src/App.tsx` | Wire banner, ref card, traffic light, new tab (Changes 1, 2, 6, 10) |
| Modify | `src/data/model.json` | Patch `score_wf` field (Change 9 — after Python script) |
| Modify | `vite.config.ts` | Add vitest config |
| Modify | `package.json` | Add vitest dev dep + test scripts |

---

## Task 1: Vitest setup

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/lib/__tests__/scoring.test.ts`

- [ ] **Step 1: Install vitest**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
npm install -D vitest
```

Expected: vitest appears in package.json devDependencies.

- [ ] **Step 2: Add test scripts to package.json**

Open `package.json`. In the `"scripts"` section add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Add vitest config to vite.config.ts**

Replace the entire content of `vite.config.ts` with:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, open: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create test placeholder and verify vitest runs**

Create `src/lib/__tests__/scoring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('placeholder', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2);
  });
});
```

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm test
```

Expected output includes: `✓ src/lib/__tests__/scoring.test.ts (1)`

- [ ] **Step 5: Commit**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add package.json vite.config.ts src/lib/__tests__/scoring.test.ts
git commit -m "chore: add vitest"
```

---

## Task 2: Add scoring functions to `scoring.ts`

**Files:**
- Modify: `src/lib/scoring.ts`
- Modify: `src/lib/__tests__/scoring.test.ts`

- [ ] **Step 1: Write failing tests for stanceZoneFor and scoreUncertainty**

Replace the content of `src/lib/__tests__/scoring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stanceZoneFor, scoreUncertainty } from '../scoring';

describe('stanceZoneFor', () => {
  it('returns DEFENSIVE for score < 30', () => {
    expect(stanceZoneFor(0).label).toBe('DEFENSIVE');
    expect(stanceZoneFor(15).label).toBe('DEFENSIVE');
    expect(stanceZoneFor(29.9).label).toBe('DEFENSIVE');
    expect(stanceZoneFor(0).color).toBe('red');
    expect(stanceZoneFor(0).tone).toBe('bear');
  });

  it('returns NORMAL for 30 <= score < 80', () => {
    expect(stanceZoneFor(30).label).toBe('NORMAL');
    expect(stanceZoneFor(50).label).toBe('NORMAL');
    expect(stanceZoneFor(79.9).label).toBe('NORMAL');
    expect(stanceZoneFor(50).color).toBe('amber');
    expect(stanceZoneFor(50).tone).toBe('neutral');
  });

  it('returns OPPORTUNITY for score >= 80', () => {
    expect(stanceZoneFor(80).label).toBe('OPPORTUNITY');
    expect(stanceZoneFor(100).label).toBe('OPPORTUNITY');
    expect(stanceZoneFor(80).color).toBe('green');
    expect(stanceZoneFor(80).tone).toBe('bull');
  });
});

describe('scoreUncertainty', () => {
  it('returns lo < score < hi for mid-range pred', () => {
    // pred=0.15, sigmaT=0.10, drift=0.15 → compositeScore=50
    const { lo, hi } = scoreUncertainty(0.15, 0.10, 0.15);
    expect(lo).toBeLessThan(50);
    expect(hi).toBeGreaterThan(50);
  });

  it('lo and hi are integers', () => {
    const { lo, hi } = scoreUncertainty(0.08, 0.10, 0.15);
    expect(Number.isInteger(lo)).toBe(true);
    expect(Number.isInteger(hi)).toBe(true);
  });

  it('hi > lo always', () => {
    const { lo, hi } = scoreUncertainty(0.20, 0.12, 0.15);
    expect(hi).toBeGreaterThan(lo);
  });
});
```

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm test
```

Expected: FAIL — `stanceZoneFor` and `scoreUncertainty` are not exported yet.

- [ ] **Step 2: Add types and functions to scoring.ts**

In `src/lib/scoring.ts`, after the `Stance` interface block (around line 372), add:

```ts
// ── 3-zone stance (TWO(30,80) walk-forward stable) ───────────────────────────

export type ZoneLabel = 'DEFENSIVE' | 'NORMAL' | 'OPPORTUNITY';

export interface StanceZone {
  label: ZoneLabel;
  tone: 'bear' | 'neutral' | 'bull';
  action: string;
  color: 'red' | 'amber' | 'green';
}

export function stanceZoneFor(score: number): StanceZone {
  if (score < 30) return { label: 'DEFENSIVE',   tone: 'bear',    action: 'Reduce exposure · tighten stops · no new buys', color: 'red'   };
  if (score < 80) return { label: 'NORMAL',       tone: 'neutral', action: 'Hold target exposure',                         color: 'amber' };
  return                  { label: 'OPPORTUNITY', tone: 'bull',    action: 'Add on weakness',                              color: 'green' };
}

// ── Score uncertainty band (±1σ_t shift on pred) ────────────────────────────

export function scoreUncertainty(pred: number, sigmaT: number, drift: number): { lo: number; hi: number } {
  return {
    lo: Math.round(normCdf((pred - drift - sigmaT) / sigmaT) * 100),
    hi: Math.round(normCdf((pred - drift + sigmaT) / sigmaT) * 100),
  };
}
```

- [ ] **Step 3: Update V5Result interface to include new fields**

In `src/lib/scoring.ts`, update the `V5Result` interface (around line 63) to add:

```ts
export interface V5Result {
  signals: SignalSpec[];
  predFwd12m: number;
  pi80Lo: number;
  pi80Hi: number;
  pi95Lo: number;
  pi95Hi: number;
  compositeScore: number;
  regime: string;
  vixRegime: string;
  ppiRegime: string;
  bucket: BucketDef;
  stance: Stance;
  stanceZone: StanceZone;   // new
  scoreLo: number;           // new — 1σ low
  scoreHi: number;           // new — 1σ high
}
```

- [ ] **Step 4: Update computeV2 to populate new fields**

In `src/lib/scoring.ts`, update the `return` statement in `computeV2` (around line 299):

```ts
  const sigmaT = condResidStd(raw.vixClose);
  // (sigmaT is already computed above — add these lines right before the return)
  const uncertainty = scoreUncertainty(predFwd12m, sigmaT, DRIFT);

  return {
    signals, predFwd12m, pi80Lo, pi80Hi, pi95Lo, pi95Hi,
    compositeScore, regime, vixRegime, ppiRegime,
    bucket: bucketFor(compositeScore),
    stance: stanceFor(compositeScore),
    stanceZone: stanceZoneFor(compositeScore),
    scoreLo: uncertainty.lo,
    scoreHi: uncertainty.hi,
  };
```

- [ ] **Step 5: Update TsRow to include score_wf**

In `src/lib/scoring.ts`, update the `TsRow` interface (around line 391):

```ts
export interface TsRow {
  date: string;
  spy: number;
  score: number | null;
  score_wf: number | null;   // new — walk-forward score (Change 9)
  pred: number | null;
  regime: string;
  inSample: boolean;
}
```

Update `getTimeseries()` to map the new field (around line 400):

```ts
export function getTimeseries(): TsRow[] {
  return ((modelData as any).timeseries as any[]).map((r: any) => ({
    date: r.d, spy: r.spy,
    score: r.score ?? null,
    score_wf: r.score_wf ?? null,   // new
    pred: r.pred ?? null,
    regime: r.regime ?? '',
    inSample: r.in_sample === true,
  }));
}
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Build check**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors. Fix any type errors (e.g. in App.tsx if it still uses the old result shape — ignore for now, they'll be fixed in Task 8).

- [ ] **Step 8: Commit**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add src/lib/scoring.ts src/lib/__tests__/scoring.test.ts
git commit -m "feat(scoring): add stanceZoneFor, scoreUncertainty, TsRow.score_wf"
```

---

## Task 3: Extract backtest helpers to `src/lib/backtest.ts`

**Files:**
- Create: `src/lib/backtest.ts`
- Modify: `src/components/StrategyPanel.tsx`

- [ ] **Step 1: Create `src/lib/backtest.ts`**

```ts
import { TsRow } from './scoring';

export function fiveTierExposure(score: number): number {
  if (score >= 80) return 1.2;
  if (score >= 60) return 1.0;
  if (score >= 40) return 0.7;
  if (score >= 20) return 0.4;
  return 0.2;
}

export function buildCurve(timeseries: TsRow[], scoreKey: 'score' | 'score_wf' = 'score') {
  const rows = timeseries.filter(r => r.spy != null && r.spy > 0);
  const labels: string[] = [];
  const bh: number[] = [];
  const ft: number[] = [];
  const b60: number[] = [];

  let bhV = 100, ftV = 100, b60V = 100;
  let lastScore: number | null = null;
  const firstScored = rows.findIndex(r => r[scoreKey] !== null);
  if (firstScored < 0) return { labels, bh, ft, b60 };

  for (let i = firstScored; i < rows.length - 1; i++) {
    const s = rows[i][scoreKey];
    if (s !== null) lastScore = s;
    if (lastScore === null) continue;
    const ret = rows[i + 1].spy / rows[i].spy - 1;
    bhV  *= (1 + ret);
    ftV  *= (1 + fiveTierExposure(lastScore) * ret);
    b60V *= (1 + (lastScore >= 60 ? 1.0 : 0.0) * ret);
    labels.push(rows[i + 1].date);
    bh.push(+bhV.toFixed(2));
    ft.push(+ftV.toFixed(2));
    b60.push(+b60V.toFixed(2));
  }
  return { labels, bh, ft, b60 };
}

export function cagr(curve: number[], nMonths: number): number {
  if (curve.length < 2 || nMonths < 1) return 0;
  return (curve[curve.length - 1] / 100) ** (12 / nMonths) - 1;
}

export function maxDD(curve: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

export function sharpe(curve: number[]): number {
  if (curve.length < 13) return NaN;
  const rets: number[] = [];
  for (let i = 1; i < curve.length; i++) rets.push(curve[i] / curve[i - 1] - 1);
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1));
  return std < 1e-12 ? NaN : (mu / std) * Math.sqrt(12);
}
```

- [ ] **Step 2: Update StrategyPanel.tsx to import from backtest.ts**

In `src/components/StrategyPanel.tsx`, replace the four private function definitions (`fiveTierExposure`, `binaryExposure`, `buildCurve`, `cagr`, `maxDD`, `sharpe`) with imports. Remove the local definitions of `fiveTierExposure`, `buildCurve`, `cagr`, `maxDD`, `sharpe`. Keep `binaryExposure` as a local private function (it's only used in StrategyPanel). Change the top of the file to:

```ts
import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { TsRow, DRIFT_LABEL } from '../lib/scoring';
import { tickStyle, gridStyle } from '../lib/chartSetup';
import { fiveTierExposure, buildCurve, cagr, maxDD, sharpe } from '../lib/backtest';

function binaryExposure(score: number): number {
  return score >= 60 ? 1.0 : 0.0;
}
```

- [ ] **Step 3: Build check**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add src/lib/backtest.ts src/components/StrategyPanel.tsx
git commit -m "refactor: extract buildCurve/cagr/maxDD/sharpe to src/lib/backtest.ts"
```

---

## Task 4: AlertBanner component

**Files:**
- Create: `src/components/AlertBanner.tsx`
- Modify: `src/lib/__tests__/scoring.test.ts`

The banner detects three conditions from the scored timeseries (last ~6 months) and the current score.

- [ ] **Step 1: Write failing tests for detectBannerState**

Append to `src/lib/__tests__/scoring.test.ts`:

```ts
import { detectBannerState } from '../../components/AlertBanner';
import type { TsRow } from '../scoring';

function makeRow(date: string, score: number | null): TsRow {
  return { date, spy: 500, score, score_wf: null, pred: null, regime: '', inSample: true };
}

describe('detectBannerState', () => {
  it('returns q1 when score < 20', () => {
    const ts = [makeRow('2026-01', 45), makeRow('2026-02', 40), makeRow('2026-03', 25)];
    expect(detectBannerState(18, ts)).toBe('q1');
  });

  it('returns crossed-down when prev >= 30 and current < 30', () => {
    const ts = [makeRow('2026-01', 55), makeRow('2026-02', 50), makeRow('2026-03', 32)];
    expect(detectBannerState(27, ts)).toBe('crossed-down');
  });

  it('returns recovered when score >= 60 and prev < 60 and recent low < 30', () => {
    const ts = [
      makeRow('2025-10', 50), makeRow('2025-11', 25), makeRow('2025-12', 35),
      makeRow('2026-01', 40), makeRow('2026-02', 52), makeRow('2026-03', 58),
    ];
    expect(detectBannerState(62, ts)).toBe('recovered');
  });

  it('returns null when no condition is triggered', () => {
    const ts = [makeRow('2026-01', 55), makeRow('2026-02', 58), makeRow('2026-03', 60)];
    expect(detectBannerState(62, ts)).toBeNull();
  });

  it('q1 takes priority over crossed-down', () => {
    const ts = [makeRow('2026-01', 55), makeRow('2026-02', 35), makeRow('2026-03', 22)];
    expect(detectBannerState(18, ts)).toBe('q1');
  });
});
```

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm test 2>&1 | tail -20
```

Expected: FAIL — `detectBannerState` not found yet.

- [ ] **Step 2: Create `src/components/AlertBanner.tsx`**

```tsx
import { useState } from 'react';
import type { TsRow } from '../lib/scoring';

export type BannerState = 'q1' | 'crossed-down' | 'recovered' | null;

/** Pure function: detects which alert condition applies (highest priority wins).
 *  timeseries must include the current month as the last scored entry. */
export function detectBannerState(score: number, timeseries: TsRow[]): BannerState {
  const scored = timeseries.filter(r => r.score !== null);
  if (scored.length < 2) return null;

  const prev = scored[scored.length - 2].score!;
  // up to 6 months before current for prevLow
  const recent = scored.slice(Math.max(0, scored.length - 7), scored.length - 1).map(r => r.score!);
  const prevLow = recent.length > 0 ? Math.min(...recent) : 100;

  if (score < 20) return 'q1';
  if (prev >= 30 && score < 30) return 'crossed-down';
  if (score >= 60 && prev < 60 && prevLow < 30) return 'recovered';
  return null;
}

function dismissKey(state: BannerState, score: number): string {
  return `alert_banner_dismissed:${state}:${Math.round(score)}`;
}

interface Props {
  score: number;
  timeseries: TsRow[];
}

export function AlertBanner({ score, timeseries }: Props) {
  const state = detectBannerState(score, timeseries);
  const key = dismissKey(state, score);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(key) === '1');

  if (!state || dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem(key, '1');
    setDismissed(true);
  };

  if (state === 'q1') {
    return (
      <div style={{ background: '#7f1d1d', borderBottom: '2px solid var(--bear)', padding: '10px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <span style={{ color: '#f87171', fontWeight: 700, fontSize: 13 }}>⚠ Q1 ZONE — DEFENSIVE</span>
          <span style={{ marginLeft: 10, color: '#fca5a5', fontSize: 12 }}>
            Score {score.toFixed(1)} is in Q1 ({'<'}20). Historical 12m return: −3.8%, 61% chance of being negative (n=18). Consider tightening stops or reducing exposure.
          </span>
        </div>
        <button onClick={dismiss} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
      </div>
    );
  }

  if (state === 'crossed-down') {
    return (
      <div style={{ background: '#431407', borderBottom: '2px solid var(--warn)', padding: '10px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <span style={{ color: '#fb923c', fontWeight: 700, fontSize: 13 }}>↓ CROSSED INTO DEFENSIVE ZONE</span>
          <span style={{ marginLeft: 10, color: '#fdba74', fontSize: 12 }}>
            Score dropped below 30 this month. This signal preceded the 2022 bear market (Dec 2021, score=2.2) and 2011 summer drawdown (Apr 2011, score=13.1).
          </span>
        </div>
        <button onClick={dismiss} style={{ background: 'none', border: 'none', color: '#fb923c', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
      </div>
    );
  }

  // recovered
  return (
    <div style={{ background: '#052e16', borderBottom: '2px solid var(--bull)', padding: '10px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
      <div>
        <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 13 }}>↑ RECOVERY FROM DEFENSIVE ZONE</span>
        <span style={{ marginLeft: 10, color: '#86efac', fontSize: 12 }}>
          Score crossed back above 60 after being in the defensive zone. Historical Q4/Q5 forward returns: +15–25% mean.
        </span>
      </div>
      <button onClick={dismiss} style={{ background: 'none', border: 'none', color: '#4ade80', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Build check**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add src/components/AlertBanner.tsx src/lib/__tests__/scoring.test.ts
git commit -m "feat: add AlertBanner with Q1/crossed-down/recovery detection"
```

---

## Task 5: ThresholdsCard component

**Files:**
- Create: `src/components/ThresholdsCard.tsx`

Data is inlined from `scripts/verify_backtest.py` output (exact figures, 2010-12 → 2026-05 sample). These values match `model.json` buckets.

- [ ] **Step 1: Create `src/components/ThresholdsCard.tsx`**

```tsx
const THRESHOLDS = [
  { lo: 0,  hi: 20,  n: 18, mean: -3.8,  pctNeg: 61, zone: 'DEFENSIVE',   nEff: 2 },
  { lo: 20, hi: 40,  n: 15, mean: 10.6,  pctNeg:  7, zone: 'NEUTRAL',     nEff: 1 },
  { lo: 40, hi: 60,  n: 35, mean: 16.2,  pctNeg:  0, zone: 'INVESTED',    nEff: 4 },
  { lo: 60, hi: 80,  n: 42, mean: 15.5,  pctNeg:  5, zone: 'INVESTED',    nEff: 5 },
  { lo: 80, hi: 100, n: 26, mean: 25.0,  pctNeg:  4, zone: 'OPPORTUNITY', nEff: 3 },
] as const;

const ZONE_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  DEFENSIVE:   { bg: '#2d0f0f', border: '#7f1d1d', text: '#f87171', label: '#ef4444' },
  NEUTRAL:     { bg: '#1c1c10', border: '#3f3f00', text: '#fbbf24', label: '#fbbf24' },
  INVESTED:    { bg: '#0f1c0f', border: '#14532d', text: '#4ade80', label: '#4ade80' },
  OPPORTUNITY: { bg: '#0a1f0a', border: '#166534', text: '#86efac', label: '#86efac' },
};

export function ThresholdsCard() {
  return (
    <div style={{ margin: '0 0 10px', background: '#0f1923', border: '1px solid #1e3a5f', borderRadius: 6, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Historical Reference · 12m forward returns by score range (2010–2026, n=136 months)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
        {THRESHOLDS.map(t => {
          const c = ZONE_COLORS[t.zone];
          const narrowCI = t.nEff < 3;
          return (
            <div
              key={t.lo}
              title={narrowCI ? `n_eff=${t.nEff} (non-overlapping obs). CI is wide — treat point estimate as directional only.` : `n_eff=${t.nEff}`}
              style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4, padding: '6px 4px', textAlign: 'center', cursor: 'help' }}
            >
              <div style={{ color: c.text, fontWeight: 700, fontSize: 11 }}>{t.lo}–{t.hi}</div>
              <div style={{ color: 'var(--text3)', fontSize: 10 }}>n={t.n}{narrowCI ? ' ⚠' : ''}</div>
              <div style={{ color: t.mean < 0 ? 'var(--bear)' : c.text, fontWeight: 700, fontSize: 12, marginTop: 2 }}>
                {t.mean >= 0 ? '+' : ''}{t.mean.toFixed(1)}%
              </div>
              <div style={{ color: 'var(--text3)', fontSize: 10 }}>{t.pctNeg}% neg</div>
              <div style={{ color: c.label, fontSize: 9, marginTop: 3, fontWeight: 600 }}>{t.zone}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 6 }}>
        ⚠ n_eff for Q1, Q2, Q5 is 1–2 (non-overlapping obs). Point estimates are directional; CIs are wide. Not a forecast.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add src/components/ThresholdsCard.tsx
git commit -m "feat: add ThresholdsCard with 5-bucket historical reference"
```

---

## Task 6: ScoreSparkline + update Gauge.tsx

**Files:**
- Create: `src/components/ScoreSparkline.tsx`
- Modify: `src/components/Gauge.tsx`

- [ ] **Step 1: Create `src/components/ScoreSparkline.tsx`**

```tsx
import type { TsRow } from '../lib/scoring';

interface Props {
  timeseries: TsRow[];
}

export function ScoreSparkline({ timeseries }: Props) {
  const scored = timeseries.filter(r => r.score !== null).slice(-12);
  if (scored.length < 2) return null;

  const scores = scored.map(r => r.score!);
  const minS = 0, maxS = 100;
  const W = 120, H = 36;
  const pad = 2;

  const toX = (i: number) => pad + (i / (scores.length - 1)) * (W - 2 * pad);
  const toY = (s: number) => H - pad - ((s - minS) / (maxS - minS)) * (H - 2 * pad);

  const points = scores.map((s, i) => `${toX(i).toFixed(1)},${toY(s).toFixed(1)}`).join(' ');
  const lastX = toX(scores.length - 1);
  const lastY = toY(scores[scores.length - 1]);

  const y30 = toY(30);
  const y80 = toY(80);

  return (
    <div style={{ position: 'relative', width: '100%', marginTop: 6 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
        <line x1={pad} y1={y30} x2={W - pad} y2={y30} stroke="var(--bear)" strokeWidth={0.6} strokeDasharray="2,2" opacity={0.6} />
        <line x1={pad} y1={y80} x2={W - pad} y2={y80} stroke="var(--bull)" strokeWidth={0.6} strokeDasharray="2,2" opacity={0.5} />
        <polyline points={points} fill="none" stroke="var(--blue)" strokeWidth={1.5} />
        <circle cx={lastX} cy={lastY} r={2.5} fill={scores[scores.length - 1] < 30 ? 'var(--bear)' : scores[scores.length - 1] >= 80 ? 'var(--bull)' : 'var(--blue)'} />
        <text x={pad + 1} y={y30 - 1} fontSize={7} fill="var(--bear)" opacity={0.7}>30</text>
        <text x={pad + 1} y={y80 - 1} fontSize={7} fill="var(--bull)" opacity={0.6}>80</text>
        <text x={W - pad} y={H - 1} fontSize={7} fill="var(--text3)" textAnchor="end">12m</text>
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Update Gauge.tsx to accept new props and render sparkline + uncertainty + drift tooltip**

Replace the full content of `src/components/Gauge.tsx` with:

```tsx
import { regimeLabel, toneColor, toneForScore } from '../lib/format';
import { ScoreSparkline } from './ScoreSparkline';
import type { TsRow } from '../lib/scoring';

interface Props {
  score: number;
  scoreLo: number;
  scoreHi: number;
  asOf: string;
  delta?: { value: number; vsLabel: string };
  signalCount: number;
  timeseries: TsRow[];
}

const DRIFT_TOOLTIP = 'Score 50 = predicted return matches the 2009–2026 sample mean (~15%/yr). This is above the long-run SPY average (~10%). A score of ~40 corresponds to a neutral expectation vs. long-run base rates.';

export function Gauge({ score, scoreLo, scoreHi, asOf, delta, signalCount, timeseries }: Props) {
  const tone = toneForScore(score);
  const color = toneColor(tone);
  const angle = -90 + (score / 100) * 180;

  return (
    <div className="gauge-card">
      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Composite score
      </div>
      <svg viewBox="0 0 200 120" style={{ width: '100%', maxWidth: 220 }}>
        <defs>
          <linearGradient id="grd" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#d94f3d" />
            <stop offset="33%" stopColor="#e8933a" />
            <stop offset="60%" stopColor="#565a61" />
            <stop offset="100%" stopColor="#1fa876" />
          </linearGradient>
        </defs>
        <path d="M 18 100 A 82 82 0 0 1 182 100" fill="none" stroke="#1a1e23" strokeWidth="14" />
        <path d="M 18 100 A 82 82 0 0 1 182 100" fill="none" stroke="url(#grd)" strokeWidth="10" strokeLinecap="round" />
        <line x1="18" y1="100" x2="26" y2="100" stroke="#565a61" strokeWidth="1.5" />
        <line x1="100" y1="18" x2="100" y2="26" stroke="#565a61" strokeWidth="1.5" />
        <line x1="182" y1="100" x2="174" y2="100" stroke="#565a61" strokeWidth="1.5" />
        <text x="18" y="115" fontSize="9" fill="#565a61" textAnchor="middle">0</text>
        <text x="100" y="14" fontSize="9" fill="#565a61" textAnchor="middle">50</text>
        <text x="182" y="115" fontSize="9" fill="#565a61" textAnchor="middle">100</text>
        <g transform={`translate(100,100) rotate(${angle})`}>
          <line x1="0" y1="0" x2="0" y2="-74" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
          <circle cx="0" cy="0" r="5" fill="white" opacity="0.9" />
          <circle cx="0" cy="-74" r="3" fill={color} />
        </g>
      </svg>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
        <div className="gauge-num" style={{ color }}>{score.toFixed(0)}</div>
        <span style={{ fontSize: 13, color: 'var(--text3)', fontWeight: 400 }}>[{scoreLo}–{scoreHi}]</span>
        <span
          title={DRIFT_TOOLTIP}
          style={{ fontSize: 10, color: 'var(--blue)', cursor: 'help', lineHeight: 1 }}
        >ⓘ</span>
      </div>
      <div className="gauge-label" style={{ color }}>{regimeLabel(score)}</div>
      <ScoreSparkline timeseries={timeseries} />
      <div className="gauge-sub" style={{ marginTop: 4 }}>{asOf} · {signalCount} signals</div>
      {delta && (
        <div
          className="gauge-delta"
          style={{
            color,
            background: tone === 'bear' ? 'rgba(217,79,61,0.12)' : tone === 'warn' ? 'rgba(232,147,58,0.12)' : 'rgba(31,168,118,0.12)',
            border: `1px solid ${tone === 'bear' ? 'rgba(217,79,61,0.2)' : tone === 'warn' ? 'rgba(232,147,58,0.2)' : 'rgba(31,168,118,0.2)'}`,
          }}
        >
          {delta.value >= 0 ? '↑' : '↓'} {Math.abs(delta.value).toFixed(1)} pts {delta.vsLabel}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build check**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run build 2>&1 | tail -20
```

Expected: TypeScript will flag the `Gauge` call in `App.tsx` for missing props (`scoreLo`, `scoreHi`, `timeseries`). Note the errors — they will be fixed in Task 8.

- [ ] **Step 4: Commit**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add src/components/ScoreSparkline.tsx src/components/Gauge.tsx
git commit -m "feat: ScoreSparkline + update Gauge with uncertainty band and drift tooltip"
```

---

## Task 7: TrackRecordPanel skeleton

**Files:**
- Create: `src/components/TrackRecordPanel.tsx`

This task builds the panel with equity curves, hardcoded stats table, and lookahead caveat. The walk-forward toggle and YearByYearChart are added in later tasks.

- [ ] **Step 1: Create `src/components/TrackRecordPanel.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import type { TsRow } from '../lib/scoring';
import { buildCurve, cagr, maxDD, sharpe } from '../lib/backtest';
import { tickStyle, gridStyle } from '../lib/chartSetup';

interface Props {
  timeseries: TsRow[];
}

const pct = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
const fmt2 = (v: number) => isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

// Benchmark stats from scripts/verify_backtest.py + scripts/BENCHMARK_REPORT.md
// (full-sample 2010-12 → 2026-02, STANCE_NL = 5-tier exposure tiers)
const BENCHMARK = {
  bh:     { finalX: 5.96, cagr: 0.1241, sharpe: 0.72, maxdd: -0.248 },
  stance: { finalX: 5.45, cagr: 0.1176, sharpe: 0.84, maxdd: -0.164 },
};

export function TrackRecordPanel({ timeseries }: Props) {
  const [useWf, setUseWf] = useState(false);
  const scoreKey = useWf ? 'score_wf' : 'score';
  const hasWf = timeseries.some(r => r.score_wf !== null);

  const { labels, bh, ft } = useMemo(() => buildCurve(timeseries, scoreKey), [timeseries, scoreKey]);
  const n = labels.length;

  const liveBh     = useMemo(() => ({ cagr: cagr(bh, n), mdd: maxDD(bh), sharpe: sharpe(bh) }), [bh, n]);
  const liveStance = useMemo(() => ({ cagr: cagr(ft, n), mdd: maxDD(ft), sharpe: sharpe(ft) }), [ft, n]);

  const chartData = {
    labels,
    datasets: [
      { label: 'Buy & Hold', data: bh, borderColor: '#565a61', borderWidth: 1.2, pointRadius: 0, fill: false, tension: 0.2, borderDash: [4, 3] },
      { label: 'STANCE_NL',  data: ft, borderColor: '#3d7fd4', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.2 },
    ],
  };

  return (
    <div>
      {/* Equity curves */}
      <div className="chart-box">
        <div className="chart-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>Equity curves — $100 base, monthly rebalance ({labels[0]} → {labels[labels.length - 1]})</span>
          <label style={{ fontSize: 11, color: hasWf ? 'var(--blue)' : 'var(--text3)', cursor: hasWf ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 5 }}>
            <input
              type="checkbox"
              checked={useWf}
              disabled={!hasWf}
              onChange={e => setUseWf(e.target.checked)}
            />
            {hasWf ? 'Walk-forward score (Change 9)' : 'Walk-forward score (run scripts/walk_forward_score.py)'}
          </label>
        </div>
        <div className="chart-wrap" style={{ height: 260 }}>
          <Line data={chartData} options={{
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { mode: 'index', intersect: false, callbacks: { label: (c: any) => ` ${c.dataset.label}: $${c.parsed.y.toFixed(0)}` } },
            },
            interaction: { mode: 'index', intersect: false },
            scales: {
              x: { ticks: { ...tickStyle, maxTicksLimit: 14, maxRotation: 45 } as any, grid: gridStyle },
              y: { ticks: { ...tickStyle, callback: (v: any) => '$' + Math.round(v) } as any, grid: gridStyle },
            },
          }} />
        </div>

        {/* Benchmark stats table (hardcoded OOS numbers) */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Benchmark stats (full-sample 2010-12→2026-02, STANCE_NL = 5-tier exposure)</div>
          <table>
            <thead>
              <tr><th></th><th>Buy &amp; Hold</th><th>STANCE_NL</th></tr>
            </thead>
            <tbody>
              <tr><td style={{ color: 'var(--text2)' }}>Final value</td><td style={{ color: '#565a61' }}>{BENCHMARK.bh.finalX.toFixed(2)}×</td><td style={{ color: 'var(--blue)' }}>{BENCHMARK.stance.finalX.toFixed(2)}×</td></tr>
              <tr><td style={{ color: 'var(--text2)' }}>CAGR</td><td style={{ color: '#565a61' }}>{pct(BENCHMARK.bh.cagr)}</td><td style={{ color: 'var(--blue)' }}>{pct(BENCHMARK.stance.cagr)}</td></tr>
              <tr><td style={{ color: 'var(--text2)' }}>Sharpe</td><td style={{ color: '#565a61' }}>{BENCHMARK.bh.sharpe.toFixed(2)}</td><td style={{ color: 'var(--blue)' }}>{BENCHMARK.stance.sharpe.toFixed(2)}</td></tr>
              <tr><td style={{ color: 'var(--text2)' }}>Max drawdown</td><td className="bear">{pct(BENCHMARK.bh.maxdd)}</td><td className="bull">{pct(BENCHMARK.stance.maxdd)}</td></tr>
            </tbody>
          </table>
          <div style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic', marginTop: 6 }}>
            On a return basis STANCE matches buy-and-hold. The model's value is in risk: ~35% smaller worst-case drawdown, marginally better Sharpe (statistical significance: 92%, not 95%).
          </div>
        </div>

        {/* Live-computed table */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Live-computed from chart above (includes in-sample look-ahead)</div>
          <table>
            <thead><tr><th>Strategy</th><th>CAGR</th><th>Max DD</th><th>Sharpe</th></tr></thead>
            <tbody>
              <tr><td style={{ color: '#565a61' }}>Buy &amp; Hold</td><td className={liveBh.cagr >= 0 ? 'bull' : 'bear'}>{pct(liveBh.cagr)}</td><td className="bear">{pct(liveBh.mdd)}</td><td>{fmt2(liveBh.sharpe)}</td></tr>
              <tr><td style={{ color: 'var(--blue)' }}>STANCE_NL</td><td className={liveStance.cagr >= 0 ? 'bull' : 'bear'}>{pct(liveStance.cagr)}</td><td className="bear">{pct(liveStance.mdd)}</td><td>{fmt2(liveStance.sharpe)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Lookahead caveat */}
      <div style={{ background: '#1a1a2e', border: '1px solid #1e3a5f', borderRadius: 6, padding: 12, marginTop: 12, fontSize: 11, color: '#93c5fd' }}>
        <strong>ⓘ Methodology note:</strong> Historical scores were computed using a model fit on the full 2009–2026 sample. A real-time score computed in 2015 would have been similar but noisier (no future signal distribution to reference). The walk-forward score checkbox above shows temporally-honest scores refitted at each step — run <code>scripts/walk_forward_score.py</code> to populate it.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add src/components/TrackRecordPanel.tsx
git commit -m "feat: add TrackRecordPanel skeleton with equity curves and lookahead caveat"
```

---

## Task 8: Wire App.tsx

Wire the banner, reference card, traffic light, score uncertainty band, sparkline in Gauge, and new Track Record tab.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update App.tsx**

Replace the full content of `src/App.tsx` with the following. The changes vs. current:
- `TabId` adds `'trackrecord'`
- New imports for `AlertBanner`, `ThresholdsCard`, `TrackRecordPanel`
- `Gauge` receives `scoreLo`, `scoreHi`, `timeseries`
- Header badges show 3-zone traffic light instead of 5-zone label
- `AlertBanner` rendered above the header div
- `ThresholdsCard` rendered between hero and tab bar
- `TrackRecordPanel` rendered in new tab

```tsx
import { useState, useMemo, useEffect, useCallback } from 'react';
import './lib/chartSetup';

import { CURRENT } from './lib/snapshot';
import {
  computeV2,
  scoreAAII,
  getAAIIData,
  getTimeseries,
  type RawSignalValues,
} from './lib/scoring';
import { fetchLiveData, type LiveData } from './lib/liveData';
import { SpyCsvDrop, type SpySignals } from './components/SpyCsvDrop';
import { VixCsvDrop, type VixSignals } from './components/VixCsvDrop';
import { YieldCurveCsvDrop, type YieldCurveSignals } from './components/YieldCurveCsvDrop';
import { BreadthCsvDrop, type BreadthSignals } from './components/BreadthCsvDrop';

import { Gauge }             from './components/Gauge';
import { ForwardReturns }     from './components/ForwardReturns';
import { AAIICard }           from './components/AAIICard';
import { ExposureCard }       from './components/ExposureCard';
import { SubScores }          from './components/SubScores';
import { BucketsPanel }       from './components/BucketsPanel';
import { HistoryPanel }       from './components/HistoryPanel';
import { BuffettPanel }       from './components/BuffettPanel';
import { AAIIPanel }          from './components/AAIIPanel';
import { PlaybookPanel }      from './components/PlaybookPanel';
import { MathPanel }          from './components/MathPanel';
import { UpdateBanner }       from './components/UpdateBanner';
import { StrategyPanel }      from './components/StrategyPanel';
import { AlertBanner }        from './components/AlertBanner';
import { ThresholdsCard }     from './components/ThresholdsCard';
import { TrackRecordPanel }   from './components/TrackRecordPanel';

type TabId = 'buckets' | 'history' | 'strategy' | 'trackrecord' | 'buffett' | 'aaii' | 'playbook' | 'math' | 'data';

export default function App() {
  const [tab, setTab] = useState<TabId>('buckets');

  const { history: aaiiHistory, stats: aaiiStats } = useMemo(() => getAAIIData(), []);
  const aaii = useMemo(() => scoreAAII(aaiiHistory, aaiiStats), [aaiiHistory, aaiiStats]);

  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [liveStatus, setLiveStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLiveStatus('loading');
    fetchLiveData()
      .then(d  => { if (!cancelled) { setLiveData(d);  setLiveStatus('ok');    }})
      .catch(() => { if (!cancelled) setLiveStatus('error'); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const [spySignals, setSpySignals] = useState<SpySignals | null>(() => {
    try {
      const s = localStorage.getItem('spy_csv_signals');
      if (!s) return null;
      const parsed: SpySignals = JSON.parse(s);
      if (parsed.return12m == null || parsed.ema12m == null) { localStorage.removeItem('spy_csv_signals'); return null; }
      return parsed;
    } catch { return null; }
  });
  const handleSpySignals = useCallback((sig: SpySignals | null) => {
    setSpySignals(sig);
    if (sig) localStorage.setItem('spy_csv_signals', JSON.stringify(sig));
    else localStorage.removeItem('spy_csv_signals');
  }, []);

  const [vixSignals, setVixSignals] = useState<VixSignals | null>(() => {
    try { const s = localStorage.getItem('vix_csv_signals'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const handleVixSignals = useCallback((sig: VixSignals | null) => {
    setVixSignals(sig);
    if (sig) localStorage.setItem('vix_csv_signals', JSON.stringify(sig));
    else localStorage.removeItem('vix_csv_signals');
  }, []);

  const [yieldSignals, setYieldSignals] = useState<YieldCurveSignals | null>(() => {
    try { const s = localStorage.getItem('yield_csv_signals'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const handleYieldSignals = useCallback((sig: YieldCurveSignals | null) => {
    setYieldSignals(sig);
    if (sig) localStorage.setItem('yield_csv_signals', JSON.stringify(sig));
    else localStorage.removeItem('yield_csv_signals');
  }, []);

  const [breadthSignals, setBreadthSignals] = useState<BreadthSignals | null>(() => {
    try {
      const s = localStorage.getItem('breadth_csv_signals');
      if (!s) return null;
      const parsed: BreadthSignals = JSON.parse(s);
      if (!parsed.usedRatio) { localStorage.removeItem('breadth_csv_signals'); return null; }
      return parsed;
    } catch { return null; }
  });
  const handleBreadthSignals = useCallback((sig: BreadthSignals | null) => {
    setBreadthSignals(sig);
    if (sig) localStorage.setItem('breadth_csv_signals', JSON.stringify(sig));
    else localStorage.removeItem('breadth_csv_signals');
  }, []);

  const rawInputs: RawSignalValues = useMemo(() => ({
    rsi14m:          spySignals?.rsi14   ?? CURRENT.rsi14m,
    mfi14m:          spySignals?.mfi14   ?? CURRENT.mfi14m,
    emaDistPct:      spySignals?.ema12m  ?? CURRENT.emaDistPct,
    ppiYoy:          liveData?.ppi.latest.yoy          ?? CURRENT.ppiYoy,
    mdebtYoy:        liveData?.margin.latest.yoy_growth ?? CURRENT.mdebtYoy,
    aaiiSpread:      aaii.spread,
    vixClose:        vixSignals?.vixClose ?? liveData?.vix?.value ?? CURRENT.vixClose,
    yieldCurve10y3m: yieldSignals?.yieldSpread   ?? CURRENT.yieldCurve10y3m,
    breadth12mChg: (breadthSignals?.usedRatio ? breadthSignals.breadth12mChg : null) ?? CURRENT.breadth12mChg,
  }), [spySignals, liveData, aaii, yieldSignals, breadthSignals]);

  const result = useMemo(() => computeV2(rawInputs), [rawInputs]);

  const timeseries = useMemo(() => {
    const base = getTimeseries();
    const now  = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const filtered = base.filter(r => r.date !== currentMonth);
    const rawPrice = spySignals?.priceLatest ?? CURRENT.spyPrice;
    const chartPrice = rawPrice > 999 ? rawPrice / 10 : rawPrice;
    filtered.push({
      date: currentMonth, spy: chartPrice,
      score: result.compositeScore, score_wf: null,
      pred: result.predFwd12m, regime: result.regime, inSample: true,
    });
    return filtered;
  }, [result, spySignals]);

  const asOfParts: string[] = [];
  if (liveData) {
    asOfParts.push(`PPI ${liveData.ppi.asOf}`, `Debt ${liveData.margin.asOf}`);
  } else {
    asOfParts.push(CURRENT.asOf);
  }
  if (spySignals)     asOfParts.push(`SPX CSV ${spySignals.asOf}`);
  if (vixSignals)     asOfParts.push(`VIX CSV ${vixSignals.asOf}`);
  if (yieldSignals)   asOfParts.push(`Yield CSV ${yieldSignals.asOf}`);
  if (breadthSignals) asOfParts.push(`Breadth CSV ${breadthSignals.asOf}`);
  const asOf = asOfParts.join(' · ');

  const liveLabel = liveStatus === 'loading' ? '⟳ fetching…'
    : liveStatus === 'error'   ? '⚠ using snapshot'
    : '● live';

  const zone = result.stanceZone;
  const dotColor = zone.color === 'red' ? 'var(--bear)' : zone.color === 'amber' ? 'var(--warn)' : 'var(--bull)';

  return (
    <>
      <UpdateBanner />
      <AlertBanner score={result.compositeScore} timeseries={timeseries} />
      <div className="header">
        <div className="header-left">
          <h1>SPY COMPOSITE SCORING SYSTEM v5.7</h1>
          <p>
            Sign-constrained Ridge · 4 active signals (PPI, AAII, Yield, Breadth) · {asOf}
            {' · '}
            <span className={liveStatus === 'ok' ? 'live-dot-ok' : liveStatus === 'error' ? 'live-dot-err' : 'live-dot-loading'}>
              {liveLabel}
            </span>
            {' · '}
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={liveStatus === 'loading'}
              style={{ background: 'none', border: '1px solid var(--text2)', borderRadius: 4, color: 'var(--text2)', cursor: liveStatus === 'loading' ? 'default' : 'pointer', fontSize: '0.75rem', padding: '1px 7px' }}
            >
              {liveStatus === 'loading' ? '⟳' : '↺ refresh'}
            </button>
          </p>
        </div>
        <div className="header-badges">
          <span className="badge" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: dotColor, fontWeight: 700 }}>{zone.label}</span>
          </span>
          <span className="badge badge-warn">
            SCORE {Math.round(result.compositeScore)} [{result.scoreLo}–{result.scoreHi}]
          </span>
          <span className="badge badge-warn">
            Ridge {result.predFwd12m >= 0 ? '+' : ''}{(result.predFwd12m*100).toFixed(1)}% 12m
          </span>
          <span className={`badge ${result.vixRegime === 'high_vol' ? 'badge-bear' : 'badge-aaii'}`}>
            {result.regime}
          </span>
        </div>
      </div>

      <div className="main">
        {/* HERO */}
        <div className="hero">
          <Gauge
            score={result.compositeScore}
            scoreLo={result.scoreLo}
            scoreHi={result.scoreHi}
            asOf={asOf}
            signalCount={9}
            timeseries={timeseries}
          />
          <ForwardReturns bucket={result.bucket} score={result.compositeScore} />
          <AAIICard aaii={aaii} />
          <ExposureCard stance={result.stance} prevExposure="20-40% (v5.1)" composite={result.compositeScore} />
        </div>

        {/* THRESHOLDS REFERENCE CARD */}
        <ThresholdsCard />

        {/* 7-SIGNAL GRID */}
        <div className="section-hdr">
          Seven signals — value · historical percentile · correlation with 12m forward return
          {liveStatus === 'ok' && <span className="live-badge"> PPI · Margin Debt{liveData?.vix ? ' · VIX' : ''} live</span>}
          {spySignals     && <span className="live-badge"> RSI · MFI · Trend from monthly SPY CSV</span>}
          {vixSignals     && <span className="live-badge"> VIX from CSV</span>}
          {yieldSignals   && <span className="live-badge"> Yield curve from CSV</span>}
          {breadthSignals && <span className="live-badge"> Breadth from RSP CSV</span>}
        </div>
        <SubScores signals={result.signals} />

        {/* RIDGE SUMMARY ROW */}
        <div className="pc-summary-row">
          {result.signals.map(s => {
            const contrib = s.ridgeCoef * s.zVal;
            const col = contrib < -0.015 ? 'var(--bear)' : contrib < 0 ? 'var(--warn)' : contrib > 0.015 ? 'var(--bull,#4ade80)' : 'var(--text2)';
            return (
              <div key={s.key} className="pc-summary-card" onClick={() => setTab('math')} style={{ cursor: 'pointer' }}>
                <div className="pc-summary-label">{s.label}</div>
                <div className="pc-summary-value" style={{ color: col }}>
                  {contrib >= 0 ? '+' : ''}{(contrib * 100).toFixed(2)}pp
                </div>
              </div>
            );
          })}
          <div className="pc-summary-card">
            <div className="pc-summary-label">Ridge pred 12m</div>
            <div className="pc-summary-value" style={{ color: result.predFwd12m >= 0 ? 'var(--bull,#4ade80)' : 'var(--bear)' }}>
              {result.predFwd12m >= 0 ? '+' : ''}{(result.predFwd12m * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="tab-bar">
          <button className={`tab-btn ${tab==='buckets'     ?'active':''}`} onClick={()=>setTab('buckets')}>Buckets → Returns</button>
          <button className={`tab-btn ${tab==='history'     ?'active':''}`} onClick={()=>setTab('history')}>Score History</button>
          <button className={`tab-btn ${tab==='strategy'    ?'active':''}`} onClick={()=>setTab('strategy')}
            style={{ color: tab==='strategy' ? 'var(--text)' : 'var(--bull,#4ade80)' }}>Strategy A/B</button>
          <button className={`tab-btn ${tab==='trackrecord' ?'active':''}`} onClick={()=>setTab('trackrecord')}
            style={{ color: tab==='trackrecord' ? 'var(--text)' : 'var(--blue)' }}>Track Record</button>
          <button className={`tab-btn ${tab==='aaii'        ?'active':''}`} onClick={()=>setTab('aaii')}
            style={{ color: tab==='aaii' ? 'var(--text)' : 'var(--aaii)' }}>★ AAII</button>
          <button className={`tab-btn ${tab==='buffett'     ?'active':''}`} onClick={()=>setTab('buffett')}>Buffett</button>
          <button className={`tab-btn ${tab==='playbook'    ?'active':''}`} onClick={()=>setTab('playbook')}>Playbook</button>
          <button className={`tab-btn ${tab==='math'        ?'active':''}`} onClick={()=>setTab('math')}>Math</button>
          <button className={`tab-btn ${tab==='data'        ?'active':''}`} onClick={()=>setTab('data')}
            style={{ color: tab==='data' ? 'var(--text)' : (spySignals || vixSignals || yieldSignals || breadthSignals) ? 'var(--bull,#4ade80)' : 'var(--aaii)' }}>
            {(spySignals || vixSignals || yieldSignals || breadthSignals) ? '✓ Market Data' : '↑ Market Data'}
          </button>
        </div>

        {tab==='buckets'     && <BucketsPanel currentBucket={result.bucket} predFwd12m={result.predFwd12m} pi80Lo={result.pi80Lo} pi80Hi={result.pi80Hi} pi95Lo={result.pi95Lo} pi95Hi={result.pi95Hi} />}
        {tab==='history'     && <HistoryPanel timeseries={timeseries} />}
        {tab==='strategy'    && <StrategyPanel timeseries={timeseries} compositeScore={result.compositeScore} />}
        {tab==='trackrecord' && <TrackRecordPanel timeseries={timeseries} />}
        {tab==='aaii'        && <AAIIPanel aaii={aaii} history={aaiiHistory} />}
        {tab==='buffett'     && <BuffettPanel />}
        {tab==='playbook'    && <PlaybookPanel stance={result.stance} />}
        {tab==='math'        && <MathPanel signals={result.signals} composite={result.compositeScore} />}
        {tab==='data'        && (
          <>
            <SpyCsvDrop onSignals={handleSpySignals} initialSignals={spySignals} />
            <VixCsvDrop onSignals={handleVixSignals} initialSignals={vixSignals} />
            <YieldCurveCsvDrop onSignals={handleYieldSignals} initialSignals={yieldSignals} />
            <BreadthCsvDrop
              onSignals={handleBreadthSignals}
              initialSignals={breadthSignals}
              spyReturn12m={spySignals?.return12m ?? null}
            />
          </>
        )}
      </div>

      <footer>
        SPY Composite v5.7 · Sign-constrained Ridge · {asOf} ·
        Active: PPI, AAII, Yield, Breadth (VIX excluded; RSI/MFI/EMA-dist/MDebt auto-pruned) ·
        OOS ρ=0.488 · Not a forecast
      </footer>
    </>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run build 2>&1 | tail -20
```

Expected: clean build. Fix any remaining TypeScript errors.

- [ ] **Step 3: Start dev server and verify visually**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run dev
```

Open http://localhost:5173 and verify:
- Alert banner appears (or not) depending on current score
- Traffic light dot shows in header
- Score shows with `[lo–hi]` range
- ThresholdsCard shows 5 color-coded buckets below the hero
- Gauge shows sparkline and ⓘ tooltip
- Track Record tab opens and shows equity curves

- [ ] **Step 4: Commit**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add src/App.tsx
git commit -m "feat: wire AlertBanner, ThresholdsCard, TrackRecord tab, 3-zone traffic light, score uncertainty"
```

---

## Task 9: YearByYearChart

**Files:**
- Create: `src/components/YearByYearChart.tsx`
- Modify: `src/components/TrackRecordPanel.tsx`

All year data is from `scripts/verify_backtest.py` output (run 2026-05-17, model v5.7).

- [ ] **Step 1: Create `src/components/YearByYearChart.tsx`**

```tsx
import { Bar } from 'react-chartjs-2';
import { tickStyle, gridStyle } from '../lib/chartSetup';

const YEAR_DATA = [
  { year: 2011, bh:  0.00, stance:  5.25 },
  { year: 2012, bh: 16.61, stance: 16.43 },
  { year: 2013, bh: 24.88, stance: 21.15 },
  { year: 2014, bh: 12.38, stance:  6.92 },
  { year: 2015, bh: -0.69, stance:  0.02 },
  { year: 2016, bh:  9.54, stance:  9.17 },
  { year: 2017, bh: 20.21, stance: 11.05 },
  { year: 2018, bh:  4.18, stance:  5.30 },
  { year: 2019, bh:  5.37, stance:  7.91 },
  { year: 2020, bh: 29.01, stance: 31.18 },
  { year: 2021, bh: 13.58, stance:  7.11 },
  { year: 2022, bh: -6.54, stance:  1.57 },
  { year: 2023, bh: 26.98, stance: 26.81 },
  { year: 2024, bh: 15.91, stance: 10.13 },
  { year: 2025, bh: 15.52, stance: 19.11 },
];

export function YearByYearChart() {
  const labels = YEAR_DATA.map(d => String(d.year));
  const stanceColors = YEAR_DATA.map(d =>
    d.stance >= d.bh ? 'rgba(61,127,212,0.8)' : 'rgba(217,79,61,0.75)'
  );

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Buy & Hold',
        data: YEAR_DATA.map(d => d.bh),
        backgroundColor: 'rgba(86,90,97,0.5)',
        borderColor: '#565a61',
        borderWidth: 1,
      },
      {
        label: 'STANCE_NL',
        data: YEAR_DATA.map(d => d.stance),
        backgroundColor: stanceColors,
        borderColor: stanceColors.map(c => c.replace('0.8', '1').replace('0.75', '1')),
        borderWidth: 1,
      },
    ],
  };

  return (
    <div className="chart-box" style={{ marginTop: 12 }}>
      <div className="chart-title">
        <span>Year-by-Year Attribution · BH vs STANCE_NL</span>
        <span style={{ color: 'var(--text3)', fontSize: 10 }}>Blue = STANCE outperformed · Red = STANCE underperformed</span>
      </div>
      <div className="chart-wrap" style={{ height: 220 }}>
        <Bar data={chartData} options={{
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (c: any) => ` ${c.dataset.label}: ${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y.toFixed(2)}%`,
                afterBody: (items: any[]) => {
                  const idx = items[0]?.dataIndex;
                  if (idx == null) return [];
                  const d = YEAR_DATA[idx];
                  const diff = d.stance - d.bh;
                  return [`Diff: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}pp`];
                },
              },
            },
          },
          scales: {
            x: { ticks: { ...tickStyle } as any, grid: gridStyle },
            y: {
              ticks: { ...tickStyle, callback: (v: any) => `${v}%` } as any,
              grid: gridStyle,
              title: { display: true, text: 'Annual return (%)', font: { size: 10, family: 'IBM Plex Mono' }, color: '#565a61' },
            },
          },
        }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, fontStyle: 'italic' }}>
        The score helped most in 2011, 2020, 2022, and 2025. It hurt most in 2014, 2017, 2021, 2024 — strong bull years where it was over-cautious. Data from scripts/verify_backtest.py (v5.7, 2026-05-17).
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add YearByYearChart to TrackRecordPanel.tsx**

In `src/components/TrackRecordPanel.tsx`, add the import at the top:

```ts
import { YearByYearChart } from './YearByYearChart';
```

Then add `<YearByYearChart />` between the equity curves `chart-box` div and the lookahead caveat div:

```tsx
      </div>  {/* end equity curves chart-box */}

      <YearByYearChart />

      {/* Lookahead caveat */}
      <div style={{ ... }}>
```

- [ ] **Step 3: Build check**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Visual check — open Track Record tab in dev server and confirm bar chart renders with correct colors (blue when STANCE ≥ BH, red when STANCE < BH).**

- [ ] **Step 5: Commit**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add src/components/YearByYearChart.tsx src/components/TrackRecordPanel.tsx
git commit -m "feat: add YearByYearChart to Track Record tab"
```

---

## Task 10: `scripts/walk_forward_score.py`

**Files:**
- Create: `scripts/walk_forward_score.py`

This script refits the ridge model for each month using only historically-available data, producing `score_wf` values that are free of full-sample look-ahead. It patches `src/data/model.json` in-place.

- [ ] **Step 1: Create `scripts/walk_forward_score.py`**

```python
"""
walk_forward_score.py  —  produce temporally-honest walk-forward scores

For each month t, fits the ridge on training data [0, t-12) (rows where fwd_12m
is already realised). Rank-Gauss reference built from training rows only.
Outputs score_wf into model.json timeseries rows.

Run: python3 scripts/walk_forward_score.py
Prerequisite: /tmp/velv/master_dataset.csv must exist (same source as fit_ridge.py).
"""
import json
import math
import numpy as np
import pandas as pd
from scipy import stats
from pathlib import Path
from sklearn.linear_model import Ridge

REPO   = Path(__file__).resolve().parent.parent
CSV    = Path("/tmp/velv/master_dataset.csv")
MFILE  = REPO / "src/data/model.json"

SIGNALS = [
    'rsi_14m', 'mfi_14m', 'ema_dist_pct', 'ppi_yoy', 'mdebt_yoy',
    'aaii_spread', 'vix_close', 'yield_curve_10y3m', 'breadth_12m_chg',
]
PREDICTORS = [s for s in SIGNALS if s not in ('vix_close', 'mfi_14m')]
UNIVARIATE_SIGN = {
    'rsi_14m': -1, 'ema_dist_pct': -1, 'ppi_yoy': -1,
    'mdebt_yoy': -1, 'aaii_spread': -1,
    'yield_curve_10y3m': -1, 'breadth_12m_chg': -1,
}
FIXED_ALPHA = 5.0
MIN_TRAIN   = 36
HORIZON     = 12
MACRO_LAGS  = {'ppi_yoy': 1, 'mdebt_yoy': 2}


def fit_ridge_sign(X: np.ndarray, y: np.ndarray, alpha: float, signs: np.ndarray):
    """Coordinate-descent ridge with sign constraints. Mirrors fit_ridge.py."""
    n, p = X.shape
    XTX = X.T @ X
    XTy = X.T @ y
    diag = np.diag(XTX) + alpha
    beta = np.zeros(p)
    for _ in range(2000):
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


def rank_gauss_one(value: float, ref_sorted: np.ndarray) -> float:
    n = len(ref_sorted)
    rank = np.searchsorted(ref_sorted, value, side='left')
    p = float(np.clip(rank / (n + 1), 0.01, 0.99))
    return float(stats.norm.ppf(p))


def standardize_one(x_raw: np.ndarray, means: np.ndarray, stds: np.ndarray,
                    sorted_arrs: list) -> np.ndarray:
    x_z = (x_raw - means) / stds
    for c in range(len(PREDICTORS)):
        x_z[c] = rank_gauss_one(x_raw[c], sorted_arrs[c])
    return x_z


def standardize(X: np.ndarray, means: np.ndarray, stds: np.ndarray,
                sorted_arrs: list) -> np.ndarray:
    X_z = (X - means) / stds
    for c in range(len(PREDICTORS)):
        X_z[:, c] = np.array([rank_gauss_one(v, sorted_arrs[c]) for v in X[:, c]])
    return X_z


def cond_resid_std(vix_raw: float, model: dict) -> float:
    """Use full-sample heteroscedastic σ_t params from model.json."""
    vix_z_mean = model['vix_z_mean']
    vix_z_std  = model['vix_z_std']
    a = model['resid_var_a']
    b = model['resid_var_b']
    floor = model['resid_var_floor']
    vz = (vix_raw - vix_z_mean) / vix_z_std
    v = max(floor, a + b * vz)
    return math.sqrt(v)


def main():
    assert CSV.exists(), f"Master dataset not found: {CSV}\nRun scripts/update_master_dataset.py first."

    df = pd.read_csv(CSV, parse_dates=['date'])
    df = df[['date', 'spy_close'] + SIGNALS + ['fwd_12m']].copy()

    for col, lag in MACRO_LAGS.items():
        if col in df.columns:
            df[col] = df[col].shift(lag)

    df = df.dropna(subset=SIGNALS).reset_index(drop=True)
    print(f"Loaded {len(df)} rows")

    model = json.loads(MFILE.read_text())
    signs = np.array([UNIVARIATE_SIGN[s] for s in PREDICTORS])

    wf_scores: dict[str, float] = {}

    for idx in range(len(df)):
        row = df.iloc[idx]
        date_str = row['date'].strftime('%Y-%m')

        train_cutoff = idx - HORIZON + 1
        train = df.iloc[:train_cutoff].dropna(subset=['fwd_12m']) if train_cutoff > 0 else pd.DataFrame()

        if len(train) < MIN_TRAIN:
            print(f"  {date_str}: skip (train={len(train)} < {MIN_TRAIN})")
            continue

        x_raw = row[PREDICTORS].values.astype(float)
        if np.any(np.isnan(x_raw)):
            continue

        X_train = train[PREDICTORS].values.astype(float)
        y_train = train['fwd_12m'].values.astype(float)
        means = X_train.mean(axis=0)
        stds  = np.maximum(X_train.std(axis=0), 1e-12)
        sorted_arrs = [np.sort(X_train[:, c]) for c in range(len(PREDICTORS))]

        X_z = standardize(X_train, means, stds, sorted_arrs)
        beta, intercept = fit_ridge_sign(X_z, y_train, FIXED_ALPHA, signs)

        x_z  = standardize_one(x_raw, means, stds, sorted_arrs)
        pred = intercept + float(beta @ x_z)
        drift = float(y_train.mean())

        vix_raw = float(row['vix_close'])
        sigma_t = cond_resid_std(vix_raw, model)

        score_wf = float(stats.norm.cdf((pred - drift) / sigma_t) * 100)
        wf_scores[date_str] = round(score_wf, 4)
        print(f"  {date_str}: score_wf={score_wf:.2f}")

    # Patch model.json timeseries
    for row in model['timeseries']:
        row['score_wf'] = wf_scores.get(row['d'], None)

    MFILE.write_text(json.dumps(model, indent=2))
    n_scored = sum(1 for r in model['timeseries'] if r['score_wf'] is not None)
    print(f"\nPatched model.json: {n_scored} rows with score_wf.")
    print(f"Saved to {MFILE}")


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Verify the script runs (requires master_dataset.csv)**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && python3 scripts/walk_forward_score.py 2>&1 | tail -20
```

If `/tmp/velv/master_dataset.csv` does not exist, run `python3 scripts/update_master_dataset.py` first.

Expected output: lines like `2011-01: score_wf=38.45`, ending with `Patched model.json: N rows with score_wf.`

- [ ] **Step 3: Verify model.json has score_wf fields**

```bash
python3 -c "
import json
m = json.load(open('src/data/model.json'))
wf = [r for r in m['timeseries'] if r.get('score_wf') is not None]
print(f'{len(wf)} rows have score_wf')
print('Sample:', wf[0])
print('Last:', wf[-1])
"
```

Expected: 100+ rows with score_wf, values in roughly the 20–70 range.

- [ ] **Step 4: Commit**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add scripts/walk_forward_score.py src/data/model.json
git commit -m "feat(scripts): add walk_forward_score.py and patch model.json with score_wf"
```

---

## Task 11: Wire walk-forward toggle in TrackRecordPanel

The `TrackRecordPanel` already has the `useWf` checkbox and `scoreKey` prop wired to `buildCurve`. Now that `model.json` has `score_wf` data, this task verifies everything works end-to-end and the toggle actually switches the equity curve.

**Files:**
- Modify: `src/components/TrackRecordPanel.tsx` (minor: verify `hasWf` detection works)

- [ ] **Step 1: Start dev server and test the toggle**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run dev
```

Open http://localhost:5173 → Track Record tab. The "Walk-forward score" checkbox should now be enabled (not grayed out). Toggle it and verify the equity curve changes slightly (walk-forward scores are noisier, performance slightly lower — expected).

- [ ] **Step 2: Build final production bundle**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm run build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/adamariel/Downloads/spy-dashboard && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Final commit + Electron push**

Per project memory: after every change, merge + `npm run build` in main repo so the Desktop app updates.

```bash
cd /Users/adamariel/Downloads/spy-dashboard
git add -p   # stage any remaining unstaged changes
git commit -m "feat: complete benchmark findings implementation (Changes 1-10)"
npm run build
```

---

## Self-Review Against Spec

| Spec requirement | Task |
|-----------------|------|
| Change 1: 3-zone stance (30/80) in scoring.ts + traffic light UI | Tasks 2, 8 |
| Change 2: Exit alert banner (Q1/crossed-down/recovered) | Tasks 4, 8 |
| Change 3: Year-by-year attribution chart | Task 9 |
| Change 4: Score uncertainty band `[lo–hi]` | Tasks 2, 6, 8 |
| Change 5: 12m sparkline with 30/80 reference lines | Tasks 6 (Gauge update) |
| Change 6: Backtest equity curves + stats table + honest caption | Task 7 |
| Change 7: Drift tooltip ⓘ on score | Task 6 (Gauge update) |
| Change 8: Lookahead caveat note in Track Record | Task 7 |
| Change 9: walk_forward_score.py + score_wf in model.json + UI toggle | Tasks 2 (type), 10, 11 |
| Change 10: Actionable thresholds reference card | Tasks 5, 8 |
| New Track Record tab | Tasks 7, 8 |
| Extract backtest.ts (shared by Strategy + Track Record) | Task 3 |
| No "beats the market" claim | Stats table caption in Task 7 ✓ |
| Keep 5-bucket table (BucketsPanel untouched) | Not modified ✓ |
| Keep fixed (30, 80) thresholds | Hard-coded in stanceZoneFor ✓ |
