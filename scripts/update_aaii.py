#!/usr/bin/env python3
"""
Refresh AAII Asset Allocation data from data/raw/asset.xls

Usage:
    1. Download the latest sentiment/asset allocation xls from
       https://www.aaii.com (look for "Asset Allocation Survey")
    2. Save it as data/raw/asset.xls
    3. Run: npm run update-aaii   (or: python3 scripts/update_aaii.py)

The script regenerates src/data/aaii.json with the full history and
recomputed full-sample stats. Idempotent - safe to run any time.

NOTE on date parsing: the AAII file mixes formats. Older rows are real
Excel datetimes (e.g. 1987-11-30), but rows from ~2007 onward are stored
as strings like "Jan '24:" or "Apr' 26". We parse those explicitly via
regex; do NOT rely on pd.to_datetime since it misinterprets "Apr' 26"
as 0001-04-26.
"""

import json
import re
import statistics
import sys
from datetime import datetime
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    print("ERROR: pandas not installed. Run: pip install pandas xlrd")
    sys.exit(1)

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw" / "asset.xls"
OUT = ROOT / "src" / "data" / "aaii.json"

if not RAW.exists():
    print(f"ERROR: {RAW} does not exist.")
    print("Download the AAII asset allocation xls from aaii.com and place it there.")
    sys.exit(1)

print(f"Reading {RAW}...")

try:
    df = pd.read_excel(RAW, engine="xlrd", header=None)
except Exception as e:
    print(f"ERROR reading xls: {e}")
    sys.exit(1)

MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "june": 6,
    "jul": 7, "july": 7, "aug": 8, "sep": 9, "sept": 9,
    "oct": 10, "nov": 11, "dec": 12,
}


def parse_date(v):
    """Parse a date cell. Real datetimes pass through; strings like "Apr' 26"
    are matched via regex. Year is inferred (00-79 to 2000s, 80-99 to 1900s)."""
    if isinstance(v, (pd.Timestamp, datetime)):
        ts = pd.Timestamp(v)
        if 1987 <= ts.year <= 2030:
            return ts
        return None
    if not isinstance(v, str):
        return None
    s = v.strip().lower()
    m = re.search(r"([a-z]+)\D+(\d{2})\b", s)
    if m and m.group(1) in MONTH_MAP:
        mon = MONTH_MAP[m.group(1)]
        yr = int(m.group(2))
        full_yr = 2000 + yr if yr < 80 else 1900 + yr
        return pd.Timestamp(year=full_yr, month=mon, day=1)
    return None


# Columns 8/9/10 hold the consolidated Stocks/Bonds/Cash percentages
data_rows = []
for i in range(3, len(df)):
    parsed = parse_date(df.iloc[i, 0])
    if parsed is None:
        continue
    s, b, c = df.iloc[i, 8], df.iloc[i, 9], df.iloc[i, 10]
    if pd.isna(s) or pd.isna(b) or pd.isna(c):
        continue
    s, b, c = float(s), float(b), float(c)
    if not (0 < s < 1 and 0 < b < 1 and 0 < c < 1):
        continue
    data_rows.append((parsed, s, b, c))

data_rows.sort(key=lambda r: r[0])

# Dedupe in case both formats match for the same month
seen = {}
for d, s, b, c in data_rows:
    key = d.strftime("%Y-%m")
    if key not in seen:
        seen[key] = (d, s, b, c)
data_rows = sorted(seen.values(), key=lambda r: r[0])

print(f"Parsed {len(data_rows)} valid monthly observations")
print(f"Date range: {data_rows[0][0].strftime('%Y-%m')} to {data_rows[-1][0].strftime('%Y-%m')}")

stocks = [r[1] for r in data_rows]
bonds = [r[2] for r in data_rows]
cash = [r[3] for r in data_rows]

print(f"\nValidation: full-sample mean stocks={statistics.mean(stocks)*100:.1f}%, "
      f"bonds={statistics.mean(bonds)*100:.1f}%, cash={statistics.mean(cash)*100:.1f}%")
print("(File reports averages of approximately 62%/16%/22% - this should match)")

records = [
    {"date": d.strftime("%Y-%m"),
     "stocks": round(s, 4), "bonds": round(b, 4), "cash": round(c, 4)}
    for d, s, b, c in data_rows
]

stats = {
    "n": len(records),
    "first_date": records[0]["date"],
    "last_date": records[-1]["date"],
}
for label, series in [("stocks", stocks), ("bonds", bonds), ("cash", cash)]:
    stats[label] = {
        "mean": round(statistics.mean(series), 4),
        "std": round(statistics.stdev(series), 4),
        "min": round(min(series), 4),
        "max": round(max(series), 4),
        "median": round(statistics.median(series), 4),
    }

OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w") as f:
    json.dump({"stats": stats, "history": records}, f, indent=2)

print(f"\nWrote {OUT}")

latest = records[-1]
spreads = [s - c for _, s, _, c in data_rows]
sp_mean = statistics.mean(spreads)
sp_std = statistics.stdev(spreads)
current_spread = latest["stocks"] - latest["cash"]
z_spread = (current_spread - sp_mean) / sp_std
z_stocks = (latest["stocks"] - stats["stocks"]["mean"]) / stats["stocks"]["std"]
z_cash = (latest["cash"] - stats["cash"]["mean"]) / stats["cash"]["std"]

print(f"\nLatest: {latest['date']}")
print(f"  Stocks: {latest['stocks']*100:.1f}%  (Z {z_stocks:+.2f})")
print(f"  Cash:   {latest['cash']*100:.1f}%  (Z {z_cash:+.2f})")
print(f"  Z-spread: {z_spread:+.2f}")
print("\nDone. Refresh your dev server.")
