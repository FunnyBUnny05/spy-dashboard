/**
 * YieldCurveCsvDrop — two drop zones for 10Y and 3m Treasury yields.
 * Computes spread = 10Y_latest − 3m_latest, matched on the most recent
 * common date (or latest of each if dates don't align exactly).
 *
 * TradingView: search US10Y (or TNX) and US03MY (or IRX) → 1W → Export chart data
 * FRED: DGS10 (10Y) and DTB3 (3m) → Download CSV
 */

import { useState, useCallback, DragEvent, ChangeEvent, useId } from 'react';

export interface YieldCurveSignals {
  yieldSpread: number;  // 10Y minus 3m in pct pts
  yield10y: number;
  yield3m: number;
  asOf: string;
  rows10y: number;
  rows3m: number;
}

// ── CSV parser ─────────────────────────────────────────────────────────────────

function normalizeDate(raw: string): string {
  if (/^\d{9,11}$/.test(raw.trim()))
    return new Date(parseInt(raw) * 1000).toISOString().slice(0, 10);
  return raw.trim();
}

function parseYieldCSV(text: string): { date: string; value: number }[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV too short');
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const dateIdx  = header.findIndex(h => h === 'time' || h === 'date');
  const closeIdx = header.findIndex(h => h.includes('adj'))
    ?? header.findIndex(h => h === 'close' || h === 'value');
  const finalClose = header.findIndex(h => h.includes('adj')) >= 0
    ? header.findIndex(h => h.includes('adj'))
    : header.findIndex(h => h === 'close' || h === 'value');
  if (dateIdx < 0 || finalClose < 0) throw new Error('Need Date/Time and Close/Value columns.');

  const rows: { date: string; value: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const value = parseFloat(cols[finalClose]);
    if (isNaN(value)) continue;
    rows.push({ date: normalizeDate(cols[dateIdx]), value });
  }
  if (rows.length < 1) throw new Error('No valid rows found.');
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Find the latest value in a series — newest date wins */
function latestValue(rows: { date: string; value: number }[]): { date: string; value: number } {
  return rows[rows.length - 1];
}

/** Best common date: latest date present in both series */
function computeSpread(
  rows10y: { date: string; value: number }[],
  rows3m:  { date: string; value: number }[],
): YieldCurveSignals {
  // Try to find a matching date (latest common)
  const dates10y = new Set(rows10y.map(r => r.date));
  const common = rows3m.filter(r => dates10y.has(r.date));

  let yield10y: number, yield3m: number, asOf: string;
  if (common.length > 0) {
    // Use latest common date
    const latest3m = common[common.length - 1];
    const match10y = rows10y.find(r => r.date === latest3m.date)!;
    yield10y = match10y.value;
    yield3m  = latest3m.value;
    asOf     = latest3m.date;
  } else {
    // No common date — just use the latest from each (may differ by a week)
    const l10 = latestValue(rows10y);
    const l3m = latestValue(rows3m);
    yield10y = l10.value;
    yield3m  = l3m.value;
    asOf     = l10.date > l3m.date ? l10.date : l3m.date;
  }

  return {
    yieldSpread: yield10y - yield3m,
    yield10y,
    yield3m,
    asOf,
    rows10y: rows10y.length,
    rows3m:  rows3m.length,
  };
}

// ── Labels ─────────────────────────────────────────────────────────────────────

function spreadLabel(v: number): { label: string; color: string } {
  if (v >=  2.0) return { label: 'Steep — accommodative',          color: 'var(--bull,#4ade80)' };
  if (v >=  0.5) return { label: 'Normal',                         color: 'var(--text2)'        };
  if (v >= -0.5) return { label: 'Flat — late-cycle warning',      color: 'var(--warn)'         };
  return               { label: 'Inverted — recession signal',      color: 'var(--bear)'         };
}

// ── Single drop zone sub-component ────────────────────────────────────────────

interface SingleDropProps {
  label: string;
  hint: string;
  inputId: string;
  loaded: boolean;
  asOf?: string;
  value?: number;
  onFile: (file: File) => void;
}

function SingleDrop({ label, hint, inputId, loaded, asOf, value, onFile }: SingleDropProps) {
  const [hover, setHover] = useState(false);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setHover(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }, [onFile]);

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6, fontWeight: 600 }}>
        {label}
        {loaded && value !== undefined && (
          <span style={{ color: 'var(--bull,#4ade80)', marginLeft: 8 }}>
            {value.toFixed(2)}% · {asOf}
          </span>
        )}
      </div>
      <div
        className={`csv-drop-zone ${loaded ? 'ok' : hover ? 'hover' : 'idle'}`}
        style={{ padding: '14px 12px' }}
        onDragOver={(e) => { e.preventDefault(); setHover(true); }}
        onDragLeave={() => setHover(false)}
        onDrop={handleDrop}
      >
        <input type="file" accept=".csv,text/csv" onChange={handleChange} style={{ display: 'none' }} id={inputId} />
        <label htmlFor={inputId} className="csv-drop-label" style={{ fontSize: 12 }}>
          {loaded ? `✓ ${label} loaded` : `↓ Drop ${hint} CSV`}
        </label>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  onSignals: (sig: YieldCurveSignals | null) => void;
  initialSignals?: YieldCurveSignals | null;
}

export function YieldCurveCsvDrop({ onSignals, initialSignals }: Props) {
  const uid = useId();
  const [rows10y, setRows10y] = useState<{ date: string; value: number }[] | null>(null);
  const [rows3m,  setRows3m]  = useState<{ date: string; value: number }[] | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [signals, setSignals] = useState<YieldCurveSignals | null>(initialSignals ?? null);

  const tryCompute = useCallback((r10: typeof rows10y, r3: typeof rows3m) => {
    if (!r10 || !r3) return;
    try {
      const sig = computeSpread(r10, r3);
      setSignals(sig);
      onSignals(sig);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [onSignals]);

  const loadFile = useCallback((text: string, kind: '10y' | '3m') => {
    try {
      const rows = parseYieldCSV(text);
      if (kind === '10y') {
        setRows10y(rows);
        tryCompute(rows, rows3m);
      } else {
        setRows3m(rows);
        tryCompute(rows10y, rows);
      }
      setError(null);
    } catch (e) {
      setError(`${kind === '10y' ? '10Y' : '3m'}: ${(e as Error).message}`);
    }
  }, [rows10y, rows3m, tryCompute]);

  const makeFileHandler = (kind: '10y' | '3m') => (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => loadFile(e.target?.result as string, kind);
    reader.readAsText(file);
  };

  const interp = signals ? spreadLabel(signals.yieldSpread) : null;

  return (
    <div className="csv-panel" style={{ marginTop: 24 }}>
      <div className="csv-intro">
        <h3>Yield Curve (10Y − 3m)</h3>
        <p>Drop the 10Y and 3m Treasury yield CSVs separately — the spread is computed automatically.</p>
        <p>
          <strong>TradingView:</strong> search <code>US10Y</code> and <code>US03MY</code> → 1W → right-click → Export chart data
        </p>
        <p>
          <strong>FRED:</strong> series <code>DGS10</code> (10Y) and <code>DTB3</code> (3m) → Download CSV
        </p>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <SingleDrop
          label="10-Year Treasury"
          hint="US10Y / DGS10"
          inputId={`${uid}-10y`}
          loaded={!!rows10y}
          asOf={rows10y ? latestValue(rows10y).date : undefined}
          value={rows10y ? latestValue(rows10y).value : undefined}
          onFile={makeFileHandler('10y')}
        />
        <SingleDrop
          label="3-Month Treasury"
          hint="US03MY / DTB3"
          inputId={`${uid}-3m`}
          loaded={!!rows3m}
          asOf={rows3m ? latestValue(rows3m).date : undefined}
          value={rows3m ? latestValue(rows3m).value : undefined}
          onFile={makeFileHandler('3m')}
        />
      </div>

      {error && (
        <div style={{ marginTop: 8, color: 'var(--bear)', fontSize: 12 }}>✗ {error}</div>
      )}

      {!rows10y && !rows3m && initialSignals && (
        <div className="csv-results" style={{ marginTop: 12 }}>
          <div className="csv-meta">
            Restored: spread {initialSignals.yieldSpread >= 0 ? '+' : ''}{initialSignals.yieldSpread.toFixed(2)}pp
            · 10Y {initialSignals.yield10y.toFixed(2)}% − 3m {initialSignals.yield3m.toFixed(2)}%
            · as of {initialSignals.asOf}
          </div>
        </div>
      )}

      {signals && interp && (
        <div className="csv-results" style={{ marginTop: 12 }}>
          <div className="csv-meta">
            Spread = {signals.yield10y.toFixed(2)}% − {signals.yield3m.toFixed(2)}% = {signals.yieldSpread >= 0 ? '+' : ''}{signals.yieldSpread.toFixed(2)}pp · as of {signals.asOf}
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

      {(rows10y || rows3m) && !signals && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2)' }}>
          {!rows10y ? '← Drop the 10Y CSV to complete the spread' : '← Drop the 3m CSV to complete the spread'}
        </div>
      )}
    </div>
  );
}
