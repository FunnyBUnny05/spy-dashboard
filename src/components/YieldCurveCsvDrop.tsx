/**
 * YieldCurveCsvDrop — drag-and-drop for yield curve (10Y−3m) spread data.
 *
 * TradingView: search ticker "US10Y-US03MY" → set to 1W → right-click → Export chart data
 * FRED: T10Y3M series → Download → CSV
 *
 * Extracts the latest weekly close as the 10Y−3m spread in percentage points.
 */

import { useState, useCallback, DragEvent, ChangeEvent } from 'react';

export interface YieldCurveSignals {
  yieldSpread: number;  // 10Y minus 3m in pct pts (positive = normal, negative = inverted)
  asOf: string;
  rows: number;
}

function normalizeDate(raw: string): string {
  if (/^\d{9,11}$/.test(raw.trim())) {
    return new Date(parseInt(raw) * 1000).toISOString().slice(0, 10);
  }
  return raw.trim();
}

function parseYieldCSV(text: string): YieldCurveSignals {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV too short');
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));

  const dateIdx  = header.findIndex(h => h === 'time' || h === 'date');
  const adjClose = header.findIndex(h => h.includes('adj'));
  const closeIdx = adjClose >= 0 ? adjClose : header.findIndex(h => h === 'close' || h === 'value');

  if (dateIdx < 0 || closeIdx < 0) throw new Error('Need Date/Time and Close/Value columns.');

  const rows: { date: string; close: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const close = parseFloat(cols[closeIdx]);
    if (isNaN(close)) continue;
    rows.push({ date: normalizeDate(cols[dateIdx]), close });
  }
  if (rows.length < 1) throw new Error('No valid rows found.');
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const latest = rows[rows.length - 1];
  return { yieldSpread: latest.close, asOf: latest.date, rows: rows.length };
}

function spreadLabel(v: number): { label: string; color: string } {
  if (v >= 2.0)  return { label: 'Steep — economy expanding',     color: 'var(--bull,#4ade80)' };
  if (v >= 0.5)  return { label: 'Normal',                        color: 'var(--text2)' };
  if (v >= -0.5) return { label: 'Flat — late-cycle warning',     color: 'var(--warn)' };
  return              { label: 'Inverted — recession signal',      color: 'var(--bear)' };
}

interface Props {
  onSignals: (sig: YieldCurveSignals | null) => void;
  initialSignals?: YieldCurveSignals | null;
}

export function YieldCurveCsvDrop({ onSignals, initialSignals }: Props) {
  const [status, setStatus]   = useState<'idle' | 'hover' | 'ok' | 'error'>(initialSignals ? 'ok' : 'idle');
  const [message, setMessage] = useState(initialSignals ? `Restored: ${initialSignals.rows} bars — spread ${initialSignals.yieldSpread.toFixed(2)}pp as of ${initialSignals.asOf}` : '');
  const [signals, setSignals] = useState<YieldCurveSignals | null>(initialSignals ?? null);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && !file.type.includes('csv') && !file.type.includes('text')) {
      setStatus('error'); setMessage('Please drop a .csv file'); return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const sig = parseYieldCSV(e.target?.result as string);
        setSignals(sig); onSignals(sig); setStatus('ok');
        setMessage(`Loaded ${sig.rows} bars — spread ${sig.yieldSpread.toFixed(2)}pp as of ${sig.asOf}`);
      } catch (err) {
        setStatus('error'); setMessage((err as Error).message); onSignals(null);
      }
    };
    reader.readAsText(file);
  }, [onSignals]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setStatus('idle');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const interp = signals ? spreadLabel(signals.yieldSpread) : null;

  return (
    <div className="csv-panel" style={{ marginTop: 24 }}>
      <div className="csv-intro">
        <h3>Yield Curve (10Y − 3m)</h3>
        <p>Drop a weekly yield spread CSV to keep the macro/rates signal live.</p>
        <p>
          <strong>TradingView:</strong> Search ticker <code>US10Y-US03MY</code> → set to{' '}
          <strong>1W</strong> → right-click → <em>Export chart data…</em>
        </p>
        <p>
          <strong>FRED:</strong> Series <code>T10Y3M</code> → Download as CSV (weekly or daily, either works)
        </p>
        <p>Expected columns: <code>time/date, close/value</code> in percentage points (e.g. 0.76 = 0.76pp)</p>
      </div>

      <div
        className={`csv-drop-zone ${status}`}
        onDragOver={(e) => { e.preventDefault(); setStatus('hover'); }}
        onDragLeave={() => setStatus(signals ? 'ok' : 'idle')}
        onDrop={onDrop}
      >
        <input type="file" accept=".csv,text/csv" onChange={onFileChange} style={{ display: 'none' }} id="yield-csv-input" />
        <label htmlFor="yield-csv-input" className="csv-drop-label">
          {status === 'ok' ? '✓ ' : status === 'error' ? '✗ ' : '↓ '}
          {status === 'idle' || status === 'hover' ? 'Drop yield curve CSV here or click to browse' : message}
        </label>
      </div>

      {signals && interp && (
        <div className="csv-results">
          <div className="csv-meta">
            {signals.rows} bars · 10Y−3m spread {signals.yieldSpread.toFixed(2)}pp · through {signals.asOf}
          </div>
          <div className="csv-signals">
            <div className="csv-signal-row">
              <span className="csv-sig-label">10Y − 3m spread</span>
              <span className="csv-sig-value" style={{ color: interp.color }}>
                {signals.yieldSpread >= 0 ? '+' : ''}{signals.yieldSpread.toFixed(2)}pp
              </span>
              <span className="csv-sig-score" style={{ color: interp.color }}>{interp.label}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
