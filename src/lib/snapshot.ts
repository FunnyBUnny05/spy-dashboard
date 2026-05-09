/**
 * Current snapshot — raw signal values for the v5.5 model.
 *
 * UPDATE MONTHLY:
 *   rsi14m          — from TradingView SPY weekly CSV (auto-computed when you drop CSV)
 *   mfi14m          — from TradingView SPY weekly CSV (auto-computed)
 *   emaDistPct      — from TradingView SPY weekly CSV (auto-computed)
 *   ppiYoy          — live from stock-sentinel Vercel app (auto-fetched)
 *   mdebtYoy        — live from stock-sentinel Vercel app (auto-fetched)
 *   aaiiSpread      — from aaii.json (run `npm run update-aaii`)
 *   vixClose        — MANUAL: check finance.yahoo.com/quote/^VIX or cboe.com
 *   yieldCurve10y3m — MANUAL: ^TNX minus ^IRX (Yahoo Finance, month-end close)
 *   breadth12mChg   — MANUAL: (RSP/SPY now) / (RSP/SPY 12m ago) − 1, in %
 *
 * Last updated: May 2026
 */

export interface RawSnapshot {
  asOf: string;
  spyPrice: number;
  // v5.5 model inputs
  rsi14m:          number;
  mfi14m:          number;
  emaDistPct:      number;
  ppiYoy:          number;
  mdebtYoy:        number;
  aaiiSpread:      number;  // stocks% - cash% (e.g. 0.685 - 0.159 = 0.526)
  vixClose:        number;  // ← MANUAL update each month
  yieldCurve10y3m: number;  // ← MANUAL: 10Y Treasury yield − 3m Treasury yield (pct pts)
  breadth12mChg:   number;  // ← MANUAL: RSP/SPY ratio 12m % change
  // Buffett kept for context (not in composite)
  buffettDetail: {
    ratio: number;
    trend: number;
    upper2sigma: number;
    lower2sigma: number;
    zScore: number;
  };
}

export const CURRENT: RawSnapshot = {
  asOf: 'May 2026',
  spyPrice: 720.65,

  // SPY-derived (auto-replaced when user drops TradingView CSV)
  rsi14m:     70.21,
  mfi14m:     66.70,
  emaDistPct:  9.05,

  // Live-fetched (auto-replaced on startup from stock-sentinel Vercel app)
  ppiYoy:    4.023,
  mdebtYoy: 38.7,
  aaiiSpread: 0.526,   // 68.5% stocks - 15.9% cash

  // ← UPDATE MANUALLY each month (CBOE: cboe.com/tradable_products/vix)
  vixClose: 16.99,

  // ← UPDATE MANUALLY each month
  yieldCurve10y3m: 0.805,  // Apr 2026: ~4.41% (^TNX) − ~3.61% (^IRX)
  breadth12mChg:  -6.70,   // Apr 2026: RSP/SPY 12m % change (cap-weight leading)

  buffettDetail: {
    ratio: 228,
    trend: 131,
    upper2sigma: 211,
    lower2sigma: 81,
    zScore: 2.43,
  },
};

// Historical score+price timeseries now lives in src/data/model.json (getTimeseries())

// Buffett history for the detail chart (static, updates quarterly)
export const BUFFETT_HISTORY = {
  dates:  ["1971-Q1","1975-Q1","1980-Q1","1985-Q1","1990-Q1","1995-Q1","1997-Q3","1998-Q1","1999-Q1","2000-Q1","2002-Q1","2003-Q1","2005-Q1","2007-Q1","2009-Q1","2010-Q1","2012-Q1","2014-Q1","2015-Q1","2016-Q1","2017-Q1","2018-Q1","2019-Q1","2020-Q1","2020-Q3","2021-Q1","2022-Q1","2023-Q1","2024-Q1","2024-Q2","2024-Q3","2024-Q4","2025-Q1"],
  ratio:  [57,57,53,61,65,92,141.5,150,153,175,120,93,130,151,57,109,108,143,136,133,146,136,138,138,200,210,176,164,202,208.5,215,221.5,228],
  trend:  [57,60,65,70,78,88,101,107,113,117,119,120,123,128,124,126,127,129,130,131,133,134,135,135,128,127,126,128,130,129,130,130.5,131],
  upper:  [91.75,96,103,110,120,140,165,172,181,186,189,191,196,204,199,201,204,207.6,209,210,212,213.5,215,215,209,209,202,204,207.6,208.4,209.2,210.1,210.9],
  lower:  [35.4,37,40,43,49,57,66,71,75,78,79,80,80,81,80,80,80,80.1,80.5,81,82,83,83,83,81,81,80,81,80.1,80.5,80.8,81.1,81.4],
};
