/**
 * VixCsvDrop — drag-and-drop zone for VIX weekly CSV data.
 *
 * Accepted formats:
 *   TradingView export:  time,open,high,low,close,volume
 *   Yahoo Finance:       Date,Open,High,Low,Close,Adj Close,Volume
 *
 * TradingView: Open VIX chart (ticker: VIX) → set to 1W → right-click → Export chart data
 *
 * Extracts the latest weekly close and passes it back so the model can
 * use a fresh VIX reading for the heteroscedastic σ_t (uncertainty band)
 * and the VIX historical percentile display.
 */

import { useState, useCallback, DragEvent, ChangeEvent } from 'react';

export interface VixSignals {
  vixClose: number;
  asOf: string;
  rows: number;
}

function normalizeDate(raw: string): string {
  if (/^\d{9,11}$/.test(raw.trim())) {
    return new Date(parseInt(raw) * 1000).toISOString().slice(0, 10);
  }
  return raw.trim();
}

function parseVixCSV(text: string): VixSignals {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV too short');
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));

  const dateIdx  = header.findIndex(h => h === 'time' || h === 'date');
  const adjClose = header.findIndex(h => h.includes('adj'));
  const closeIdx = adjClose >= 0 ? adjClose : header.findIndex(h => h === 'close');

  if (dateIdx < 0 || closeIdx < 0) {
    throw new Error('Could not find Date/Time and Close columns in CSV header.');
  }

  const rows: { date: string; close: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const close = parseFloat(cols[closeIdx]);
    if (isNaN(close) || close <= 0) continue;
    rows.push({ date: normalizeDate(cols[dateIdx]), close });
  }
  if (rows.length < 2) throw new Error('No valid rows found in CSV');
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const latest = rows[rows.length - 1];
  return { vixClose: latest.close, asOf: latest.date, rows: rows.length };
}

function vixLabel(v: number): { label: string; color: string } {
  if (v >= 40) return { label: 'Extreme fear / crisis',   color: 'var(--bear)' };
  if (v >= 30) return { label: 'High fear',               color: 'var(--bear)' };
  if (v >= 20) return { label: 'Elevated uncertainty',    color: 'var(--warn)' };
  if (v >= 15) return { label: 'Normal',                  color: 'var(--text2)' };
  return               { label: 'Low volatility / complacent', color: 'var(--bull,#4ade80)' };
}

interface Props {
  onSignals: (sig: VixSignals | null) => void;
  initialSignals?: VixSignals | null;
}

export function VixCsvDrop({ onSignals, initialSignals }: Props) {
  const [status, setStatus] = useState<'idle' | 'hover' | 'ok' | 'error'>(initialSignals ? 'ok' : 'idle');
  const [message, setMessage] = useState(initialSignals ? `Restored: ${initialSignals.rows} bars — VIX ${initialSignals.vixClose.toFixed(2)} as of ${initialSignals.asOf}` : '');
  const [signals, setSignals] = useState<VixSignals | null>(initialSignals ?? null);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && !file.type.includes('csv') && !file.type.includes('text')) {
      setStatus('error');
      setMessage('Please drop a .csv file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const sig = parseVixCSV(e.target?.result as string);
        setSignals(sig);
        onSignals(sig);
        setStatus('ok');
        setMessage(`Loaded ${sig.rows} bars — VIX ${sig.vixClose.toFixed(2)} as of ${sig.asOf}`);
      } catch (err) {
        setStatus('error');
        setMessage((err as Error).message);
        onSignals(null);
      }
    };
    reader.readAsText(file);
  }, [onSignals]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setStatus('idle');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const interp = signals ? vixLabel(signals.vixClose) : null;

  return (
    <div className="csv-panel" style={{ marginTop: 24 }}>
      <div className="csv-intro">
        <h3>VIX Weekly Data</h3>
        <p>
          Drop a weekly VIX CSV to update the volatility reading used for the model's
          uncertainty band (σ_t) and the VIX historical percentile.
        </p>
        <p>
          <strong>TradingView:</strong> Open VIX chart (ticker <code>VIX</code>) → set to{' '}
          <strong>1W</strong> → right-click any candle → <em>Export chart data…</em> → Save CSV.
        </p>
        <p>
          Expected columns: <code>time, open, high, low, close, volume</code>
          &nbsp;(Yahoo Finance format also accepted)
        </p>
      </div>

      <div
        className={`csv-drop-zone ${status}`}
        onDragOver={(e) => { e.preventDefault(); setStatus('hover'); }}
        onDragLeave={() => setStatus(signals ? 'ok' : 'idle')}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFileChange}
          style={{ display: 'none' }}
          id="vix-csv-input"
        />
        <label htmlFor="vix-csv-input" className="csv-drop-label">
          {status === 'ok' ? '✓ ' : status === 'error' ? '✗ ' : '↓ '}
          {status === 'idle' || status === 'hover'
            ? 'Drop VIX weekly CSV here or click to browse'
            : message}
        </label>
      </div>

      {signals && interp && (
        <div className="csv-results">
          <div className="csv-meta">
            {signals.rows} weekly bars · VIX {signals.vixClose.toFixed(2)} · through {signals.asOf}
          </div>
          <div className="csv-signals">
            <div className="csv-signal-row">
              <span className="csv-sig-label">VIX close</span>
              <span className="csv-sig-value" style={{ color: interp.color }}>
                {signals.vixClose.toFixed(2)}
              </span>
              <span className="csv-sig-score" style={{ color: interp.color }}>
                {interp.label}
              </span>
            </div>
            <div className="csv-signal-row">
              <span className="csv-sig-label">σ_t effect</span>
              <span className="csv-sig-value" style={{ fontSize: 11, color: 'var(--text2)' }}>
                {signals.vixClose >= 25
                  ? 'Wide uncertainty band — score is more conservative'
                  : signals.vixClose <= 15
                  ? 'Tight uncertainty band — score is more decisive'
                  : 'Normal uncertainty band'}
              </span>
            </div>
          </div>
          <p className="csv-note">
            VIX overrides the live-fetched and snapshot values. Higher VIX widens the
            prediction interval, pushing scores toward 50 (neutral).
          </p>
        </div>
      )}
    </div>
  );
}
