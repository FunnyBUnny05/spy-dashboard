/**
 * BreadthCsvDrop — drag-and-drop for RSP OHLCV data (daily, weekly, or monthly).
 *
 * TradingView: Search RSP → set to 1M (or 1W) → right-click → Export chart data
 *
 * Computes RSP 12-month return by finding the row closest to (latest − 365 days),
 * so the result is correct regardless of bar frequency.
 *
 * If SPX/SPY return12m is also provided (from the SPX CSV already dropped),
 * computes the RSP/SPY ratio change:
 *   breadth12mChg = ((1 + rsp12m/100) / (1 + spy12m/100) − 1) × 100
 *
 * This matches the snapshot definition: RSP/SPY 12m % change.
 */

import { useState, useCallback, DragEvent, ChangeEvent } from 'react';

export interface BreadthSignals {
  breadth12mChg: number;  // RSP/SPY ratio 12m % chg (or RSP standalone if no SPY data)
  rspReturn12m: number;
  spyReturn12m: number | null;  // null if SPX CSV not loaded
  asOf: string;
  rows: number;
  usedRatio: boolean;  // true = RSP/SPY ratio; false = RSP standalone
}

function normalizeDate(raw: string): string {
  // See SpyCsvDrop.tsx for full rationale. Accepts signed integers as unix
  // epoch (seconds or ms) plus ISO/Yahoo date strings; throws on unparseable.
  const t = raw.trim();
  if (/^-?\d+$/.test(t)) {
    const n = parseInt(t, 10);
    const secs = Math.abs(n) >= 1e12 ? n / 1000 : n;
    if (secs >= -5364662400 && secs <= 7258118400) {
      const d = new Date(secs * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    throw new Error(`Date out of plausible range: "${raw}"`);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const d = new Date(t);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw new Error(`Unparseable date value: "${raw}"`);
}

function parseRspCSV(text: string): { date: string; close: number }[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV too short');
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const dateIdx  = header.findIndex(h => h === 'time' || h === 'date');
  const adjClose = header.findIndex(h => h.includes('adj'));
  const closeIdx = adjClose >= 0 ? adjClose : header.findIndex(h => h === 'close');
  if (dateIdx < 0 || closeIdx < 0) throw new Error('Need Date/Time and Close columns.');

  const rows: { date: string; close: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const close = parseFloat(cols[closeIdx]);
    if (isNaN(close) || close <= 0) continue;
    rows.push({ date: normalizeDate(cols[dateIdx]), close });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  // Need at least ~12 months of history regardless of bar frequency.
  if (rows.length < 2) throw new Error('No valid rows found in CSV');
  const spanDays = (new Date(rows[rows.length - 1].date).getTime()
                  - new Date(rows[0].date).getTime()) / 86400000;
  if (spanDays < 360) {
    throw new Error(
      `Need at least 12 months of history (got ${spanDays.toFixed(0)} days across ${rows.length} bars).`
    );
  }
  return rows;
}

/** Find the row whose date is closest to (latestDate − 12 months), regardless
 *  of whether the CSV is daily, weekly, or monthly. Returns its close price.
 *  Falls back to rows[0] if the file doesn't reach back a full year (caller
 *  already validated 360-day span, so this is just a safety net). */
function priceTwelveMonthsAgo(rows: { date: string; close: number }[]): number {
  const latest = new Date(rows[rows.length - 1].date).getTime();
  const target = latest - 365 * 86400000;
  // Binary search for the row at or just before the target date.
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (new Date(rows[mid].date).getTime() <= target) lo = mid; else hi = mid - 1;
  }
  return rows[lo].close;
}

function breadthLabel(v: number): { label: string; color: string } {
  if (v >= 5)   return { label: 'Broad rally — healthy breadth',   color: 'var(--bull,#4ade80)' };
  if (v >= 0)   return { label: 'Slightly broad',                  color: 'var(--text2)' };
  if (v >= -5)  return { label: 'Slight large-cap leadership',     color: 'var(--warn)' };
  if (v >= -15) return { label: 'Narrow rally — concentration risk', color: 'var(--warn)' };
  return              { label: 'Very narrow — extreme concentration', color: 'var(--bear)' };
}

interface Props {
  onSignals: (sig: BreadthSignals | null) => void;
  initialSignals?: BreadthSignals | null;
  spyReturn12m?: number | null;  // from SpyCsvDrop when already loaded
}

export function BreadthCsvDrop({ onSignals, initialSignals, spyReturn12m }: Props) {
  const [status, setStatus]   = useState<'idle' | 'hover' | 'ok' | 'error'>(initialSignals ? 'ok' : 'idle');
  const [message, setMessage] = useState(initialSignals ? `Restored: ${initialSignals.rows} bars — breadth ${initialSignals.breadth12mChg.toFixed(1)}% as of ${initialSignals.asOf}` : '');
  const [signals, setSignals] = useState<BreadthSignals | null>(initialSignals ?? null);

  const computeAndEmit = useCallback((rows: { date: string; close: number }[], spyRet: number | null | undefined) => {
    const latest         = rows[rows.length - 1];
    const price12mAgo    = priceTwelveMonthsAgo(rows);
    const rspReturn12m   = ((latest.close - price12mAgo) / price12mAgo) * 100;

    let breadth12mChg: number;
    let usedRatio: boolean;
    if (spyRet != null) {
      breadth12mChg = ((1 + rspReturn12m / 100) / (1 + spyRet / 100) - 1) * 100;
      usedRatio = true;
    } else {
      breadth12mChg = rspReturn12m;
      usedRatio = false;
    }

    return {
      breadth12mChg,
      rspReturn12m,
      spyReturn12m: spyRet ?? null,
      asOf: latest.date,
      rows: rows.length,
      usedRatio,
    };
  }, []);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && !file.type.includes('csv') && !file.type.includes('text')) {
      setStatus('error'); setMessage('Please drop a .csv file'); return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseRspCSV(e.target?.result as string);
        const sig = computeAndEmit(rows, spyReturn12m);
        setSignals(sig); onSignals(sig); setStatus('ok');
        const breadthStr = sig.breadth12mChg >= 0 ? '+' + sig.breadth12mChg.toFixed(1) : sig.breadth12mChg.toFixed(1);
        setMessage(`Loaded ${sig.rows} bars — breadth ${breadthStr}% as of ${sig.asOf}`);
      } catch (err) {
        setStatus('error'); setMessage((err as Error).message); onSignals(null);
      }
    };
    reader.readAsText(file);
  }, [onSignals, spyReturn12m, computeAndEmit]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setStatus('idle');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const interp = signals ? breadthLabel(signals.breadth12mChg) : null;

  return (
    <div className="csv-panel" style={{ marginTop: 24 }}>
      <div className="csv-intro">
        <h3>Market Breadth (RSP / SPY 12m)</h3>
        <p>
          Drop an RSP (Invesco S&P 500 Equal Weight ETF) CSV — daily, weekly, or monthly is fine.
          Combined with the SPX CSV above, this computes the RSP/SPY 12-month ratio change
          (a measure of how narrow or broad the rally is).
        </p>
        <p>
          <strong>TradingView:</strong> Search <code>RSP</code> → set timeframe (<strong>1M</strong> recommended to match the SPX CSV) → right-click → <em>Export chart data…</em>
        </p>
        <p>Expected columns: <code>time, open, high, low, close, volume</code> (Yahoo Finance also accepted). Minimum 12 months of history.</p>
        {!spyReturn12m && (
          <p style={{ color: 'var(--warn)', fontSize: 12 }}>
            ⚠ Drop the SPX CSV first to get the full RSP/SPY ratio. Without it, RSP standalone 12m return is used.
          </p>
        )}
      </div>

      <div
        className={`csv-drop-zone ${status}`}
        onDragOver={(e) => { e.preventDefault(); setStatus('hover'); }}
        onDragLeave={() => setStatus(signals ? 'ok' : 'idle')}
        onDrop={onDrop}
      >
        <input type="file" accept=".csv,text/csv" onChange={onFileChange} style={{ display: 'none' }} id="rsp-csv-input" />
        <label htmlFor="rsp-csv-input" className="csv-drop-label">
          {status === 'ok' ? '✓ ' : status === 'error' ? '✗ ' : '↓ '}
          {status === 'idle' || status === 'hover' ? 'Drop RSP CSV here or click to browse' : message}
        </label>
      </div>

      {signals && interp && (
        <div className="csv-results">
          <div className="csv-meta">
            {signals.rows} bars · through {signals.asOf}
            {' · '}{signals.usedRatio ? 'RSP/SPY ratio' : 'RSP standalone (drop SPX CSV for ratio)'}
          </div>
          <div className="csv-signals">
            <div className="csv-signal-row">
              <span className="csv-sig-label">RSP/SPY 12m chg</span>
              <span className="csv-sig-value" style={{ color: interp.color }}>
                {signals.breadth12mChg >= 0 ? '+' : ''}{signals.breadth12mChg.toFixed(1)}%
              </span>
              <span className="csv-sig-score" style={{ color: interp.color }}>{interp.label}</span>
            </div>
            <div className="csv-signal-row">
              <span className="csv-sig-label">RSP 12m return</span>
              <span className="csv-sig-value">{signals.rspReturn12m >= 0 ? '+' : ''}{signals.rspReturn12m.toFixed(1)}%</span>
              {signals.spyReturn12m != null && (
                <span className="csv-sig-score" style={{ color: 'var(--text2)' }}>
                  SPX {signals.spyReturn12m >= 0 ? '+' : ''}{signals.spyReturn12m.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
