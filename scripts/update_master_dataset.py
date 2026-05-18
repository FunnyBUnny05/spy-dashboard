#!/usr/bin/env python3
"""
update_master_dataset.py
Rebuilds /tmp/velv/master_dataset.csv with all 9 model signals,
then runs fit_ridge.py to regenerate model.json with fresh
signal_sorted, rank_gauss_sorted, and updated OOS stats.

Usage:
    python3 scripts/update_master_dataset.py

Requirements:
    pip install yfinance pandas numpy requests scipy scikit-learn
"""

import json
import sys
import subprocess
import numpy as np
import pandas as pd
import requests
from pathlib import Path
from datetime import datetime

REPO      = Path(__file__).parent.parent
AAII_JSON = REPO / "src/data/aaii.json"
OUT_CSV   = Path("/tmp/velv/master_dataset.csv")
FETCH_START = "2007-01-01"   # extra history so RSI/EMA seed is fully washed out

# ── yfinance helper ────────────────────────────────────────────────────────────

def yf_monthly(ticker: str) -> pd.DataFrame:
    import yfinance as yf
    raw = yf.download(ticker, start=FETCH_START, interval="1mo",
                      auto_adjust=True, progress=False)
    # yfinance sometimes returns a MultiIndex columns (ticker, field)
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.droplevel(1)
    # Normalise index to month-start so all series align
    raw.index = raw.index.to_period("M").to_timestamp("D", how="start")
    return raw

# ── signal math ────────────────────────────────────────────────────────────────

def calc_rsi(closes: pd.Series, period: int = 14) -> pd.Series:
    """Wilder-smoothed RSI.  Needs full history for seed wash-out."""
    delta = closes.diff()
    gains  = delta.clip(lower=0)
    losses = (-delta).clip(lower=0)
    # ewm with alpha = 1/period and adjust=False replicates Wilder smoothing
    avg_g = gains.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_l = losses.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    rs = avg_g / avg_l.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).rename("rsi_14m")

def calc_ema_dist(closes: pd.Series, period: int = 12) -> pd.Series:
    """(close - EMA_period) / EMA_period × 100."""
    ema = closes.ewm(span=period, adjust=False, min_periods=period).mean()
    return ((closes - ema) / ema * 100).rename("ema_dist_pct")

def calc_mfi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Money Flow Index on monthly OHLCV."""
    tp   = (df["High"] + df["Low"] + df["Close"]) / 3
    mf   = tp * df["Volume"]
    up   = tp > tp.shift(1)
    dn   = tp < tp.shift(1)
    pos  = mf.where(up, 0.0).rolling(period).sum()
    neg  = mf.where(dn, 0.0).rolling(period).sum()
    mfr  = pos / neg.replace(0, np.nan)
    return (100 - 100 / (1 + mfr)).rename("mfi_14m")

# ── align helper ───────────────────────────────────────────────────────────────

def align(series: pd.Series, idx: pd.DatetimeIndex,
          method: str = "ffill") -> pd.Series:
    s = series.copy()
    s.index = pd.DatetimeIndex(s.index).to_period("M").to_timestamp("D", how="start")
    return s.reindex(idx, method=method)

# ── 1. SPY monthly OHLCV ──────────────────────────────────────────────────────

print("Downloading SPY monthly…")
spy = yf_monthly("SPY")
spy_close    = spy["Close"].rename("spy_close")
rsi_14m      = calc_rsi(spy_close)
ema_dist_pct = calc_ema_dist(spy_close)
mfi_14m      = calc_mfi(spy)
fwd_12m      = spy_close.pct_change(12).shift(-12).rename("fwd_12m")
print(f"  SPY: {spy.index[0].strftime('%Y-%m')} → {spy.index[-1].strftime('%Y-%m')}"
      f"  ({len(spy)} bars)")

# ── 2. VIX ────────────────────────────────────────────────────────────────────

print("Downloading VIX monthly…")
vix       = yf_monthly("^VIX")
vix_close = vix["Close"].rename("vix_close")

# ── 3. Yield curve (^TNX 10Y − ^IRX 3m) ──────────────────────────────────────

print("Downloading yield curve (^TNX, ^IRX)…")
tnx = yf_monthly("^TNX")
irx = yf_monthly("^IRX")
yield_curve = (tnx["Close"] - irx["Close"]).rename("yield_curve_10y3m")
print(f"  Yield curve last: {yield_curve.dropna().index[-1].strftime('%Y-%m')}"
      f"  = {yield_curve.dropna().iloc[-1]:.2f}pp")

# ── 4. Breadth: RSP/SPY 12m change ───────────────────────────────────────────

print("Downloading RSP monthly for breadth…")
rsp     = yf_monthly("RSP")
ratio   = (rsp["Close"] / spy["Close"].reindex(rsp.index)).rename("rsp_spy")
breadth = ratio.pct_change(12).mul(100).rename("breadth_12m_chg")

# ── 5. PPI YoY from user-hosted endpoint (BLS WPUFD4, updated monthly) ───────

print("Fetching PPI from hosted endpoint…")
PPI_URL = "https://funnybunny05.github.io/margin-Debtt/ppi_data.json"
try:
    r = requests.get(PPI_URL, timeout=20)
    ppi_json = r.json()
    # Use the non-seasonally-adjusted series (WPUFD4)
    ppi_obs = ppi_json["series"]["WPUFD4"]["data"]
    ppi_rows = []
    for obs in ppi_obs:
        ppi_rows.append({
            "date": pd.Timestamp(obs["date"] + "-01"),
            "ppi_yoy": float(obs["yoy"]) if obs["yoy"] is not None else float("nan"),
        })
    ppi_df = (pd.DataFrame(ppi_rows)
                .drop_duplicates("date")
                .sort_values("date")
                .set_index("date"))
    ppi_df.index = ppi_df.index.to_period("M").to_timestamp("D", how="start")
    ppi_yoy = ppi_df["ppi_yoy"]
    last = ppi_yoy.dropna()
    print(f"  PPI last: {last.index[-1].strftime('%Y-%m')}"
          f"  YoY = {last.iloc[-1]:.2f}%")
except Exception as e:
    print(f"  ⚠ PPI endpoint failed: {e}, falling back to FRED…")
    try:
        FRED_URL = ("https://fred.stlouisfed.org/graph/fredgraph.csv"
                    "?id=PPIFID&cosd=2005-01-01")
        ppi_raw = pd.read_csv(FRED_URL, parse_dates=["observation_date"])
        ppi_raw = ppi_raw.rename(columns={"observation_date": "date", "PPIFID": "ppi_index"})
        ppi_raw["ppi_index"] = pd.to_numeric(ppi_raw["ppi_index"], errors="coerce")
        ppi_raw = ppi_raw.dropna(subset=["ppi_index"])
        ppi_raw["date"] = ppi_raw["date"].dt.to_period("M").dt.to_timestamp("D", how="start")
        ppi_df2 = ppi_raw.set_index("date").sort_index()
        ppi_df2["ppi_yoy"] = ppi_df2["ppi_index"].pct_change(12).mul(100)
        ppi_yoy = ppi_df2["ppi_yoy"]
        last = ppi_yoy.dropna()
        print(f"  PPI (FRED fallback) last: {last.index[-1].strftime('%Y-%m')}"
              f"  YoY = {last.iloc[-1]:.2f}%")
    except Exception as e2:
        print(f"  ⚠ FRED fallback also failed: {e2}")
        ppi_yoy = pd.Series(dtype=float, name="ppi_yoy")

# ── 6. Margin debt YoY from Vercel backend ────────────────────────────────────

print("Fetching margin debt…")
VERCEL = "https://stock-sentinel-7n2zayq4n-funnybunny05s-projects.vercel.app"
try:
    r = requests.get(f"{VERCEL}/margin_data.json", timeout=20)
    mdebt_raw = r.json()["data"]
    mdebt_df  = (pd.DataFrame(mdebt_raw)
                   .assign(date=lambda d: pd.to_datetime(d["date"]))
                   .sort_values("date")
                   .set_index("date"))
    mdebt_df.index = mdebt_df.index.to_period("M").to_timestamp("D", how="start")
    mdebt_yoy = mdebt_df["yoy_growth"].rename("mdebt_yoy")
    last_mdebt = mdebt_yoy.dropna()
    print(f"  Margin debt last: {last_mdebt.index[-1].strftime('%Y-%m')}"
          f"  YoY = {last_mdebt.iloc[-1]:.1f}%")
except Exception as e:
    print(f"  ⚠ margin debt fetch failed: {e}")
    print("    Using NaN — rows will be dropped by fit_ridge.py if no history")
    mdebt_yoy = pd.Series(dtype=float, name="mdebt_yoy")

# ── 7. AAII spread from aaii.json ─────────────────────────────────────────────

print("Loading AAII from aaii.json…")
with open(AAII_JSON) as f:
    aaii_data = json.load(f)["history"]
aaii_df = (pd.DataFrame(aaii_data)
             .assign(date=lambda d: pd.to_datetime(d["date"] + "-01"))
             .set_index("date")
             .sort_index())
aaii_df.index = aaii_df.index.to_period("M").to_timestamp("D", how="start")
aaii_spread = (aaii_df["stocks"] - aaii_df["cash"]).rename("aaii_spread")
print(f"  AAII last: {aaii_spread.index[-1].strftime('%Y-%m')}"
      f"  spread = {aaii_spread.iloc[-1]:.3f}")

# ── 8. Merge all signals ──────────────────────────────────────────────────────

print("\nMerging…")
# Base index = SPY months from 2009-01 onward (enough warmup for RSI/EMA)
idx = spy_close.index[spy_close.index >= "2009-01-01"]

df = pd.DataFrame(index=idx)
df["spy_close"]        = align(spy_close,    idx)
df["fwd_12m"]          = align(fwd_12m,      idx, method=None)   # do NOT ffill future
df["rsi_14m"]          = align(rsi_14m,      idx)
df["mfi_14m"]          = align(mfi_14m,      idx)
df["ema_dist_pct"]     = align(ema_dist_pct, idx)
df["ppi_yoy"]          = align(ppi_yoy,      idx)
df["mdebt_yoy"]        = align(mdebt_yoy,    idx)
df["aaii_spread"]      = align(aaii_spread,  idx)
df["vix_close"]        = align(vix_close,    idx)
df["yield_curve_10y3m"]= align(yield_curve,  idx)
df["breadth_12m_chg"]  = align(breadth,      idx)

df.index.name = "date"
df = df.reset_index()
df["date"] = df["date"].dt.strftime("%Y-%m-%d")

OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
df.to_csv(OUT_CSV, index=False)

# Print coverage summary
print(f"\n✅ Saved {len(df)} rows → {OUT_CSV}")
print(f"   Date range: {df['date'].iloc[0]} → {df['date'].iloc[-1]}")
print("\nSignal coverage (non-null count):")
sig_cols = ["rsi_14m","mfi_14m","ema_dist_pct","ppi_yoy","mdebt_yoy",
            "aaii_spread","vix_close","yield_curve_10y3m","breadth_12m_chg"]
for col in sig_cols:
    n    = df[col].notna().sum()
    last = df.loc[df[col].notna(), "date"].iloc[-1] if n > 0 else "—"
    val  = df.loc[df[col].notna(), col].iloc[-1]   if n > 0 else float("nan")
    print(f"  {col:22s}  n={n:3d}  last={last}  val={val:.3f}")

# ── 9. Run fit_ridge.py ────────────────────────────────────────────────────────

print("\n" + "─"*60)
print("Running fit_ridge.py…")
print("─"*60)
result = subprocess.run(
    ["python3", str(REPO / "scripts/fit_ridge.py")],
    cwd=str(REPO),
)
sys.exit(result.returncode)
