/**
 * SpyCsvDrop — drag-and-drop zone for SPY weekly OHLCV CSV data.
 *
 * Accepted formats:
 *   TradingView export:  time,open,high,low,close,volume
 *   Yahoo Finance:       Date,Open,High,Low,Close,Adj Close,Volume
 *
 * TradingView: Chart → right-click price history → Export chart data (CSV)
 *   Make sure the chart is set to Weekly timeframe before exporting.
 *
 * Computes: RSI-14, EMA-50W (Trend), OBV, MFI-14
 */

import { useState, useCallback, DragEvent, ChangeEvent } from 'react';

export interface SpyRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SpySignals {
  rsi14: number;
  ema50w: number;    // ratio: price / EMA50W
  obv3m: number;     // 3-month OBV % change vs price % change
  mfi14: number;
  asOf: string;
  priceLatest: number;
  return12m: number; // 12m price return % (used for RSP/SPY breadth ratio)
  rows: number;
}

// ── Signal math ───────────────────────────────────────────────────────────────

function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { ema.push(NaN); continue; }
    if (i === period - 1) {
      ema.push(values.slice(0, period).reduce((a, b) => a + b, 0) / period);
    } else {
      ema.push(values[i] * k + ema[i - 1] * (1 - k));
    }
  }
  return ema;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return NaN;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  // Wilder smoothing
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcMFI(rows: SpyRow[], period = 14): number {
  if (rows.length < period + 1) return NaN;
  const recent = rows.slice(-(period + 1));
  let posFlow = 0, negFlow = 0;
  for (let i = 1; i <= period; i++) {
    const tp = (recent[i].high + recent[i].low + recent[i].close) / 3;
    const tpPrev = (recent[i - 1].high + recent[i - 1].low + recent[i - 1].close) / 3;
    const mf = tp * recent[i].volume;
    if (tp > tpPrev) posFlow += mf;
    else negFlow += mf;
  }
  if (negFlow === 0) return 100;
  return 100 - 100 / (1 + posFlow / negFlow);
}

function calcOBVDivergence(rows: SpyRow[], lookback = 13): number {
  // Compare OBV % change to price % change over lookback weeks
  if (rows.length < lookback + 1) return 0;
  const window = rows.slice(-(lookback + 1));
  let obv = 0;
  const obvSeries: number[] = [0];
  for (let i = 1; i < window.length; i++) {
    obv += window[i].close > window[i - 1].close ? window[i].volume
         : window[i].close < window[i - 1].close ? -window[i].volume : 0;
    obvSeries.push(obv);
  }
  const avgVol = window.slice(1).reduce((s, r) => s + r.volume, 0) / lookback;
  if (avgVol === 0) return 0;
  const obvPctChange = (obvSeries[obvSeries.length - 1] / avgVol) * 100;
  const pricePctChange = ((window[window.length - 1].close - window[1].close) / window[1].close) * 100;
  return obvPctChange - pricePctChange; // negative = OBV lagging price = bearish
}

export function computeSpySignals(rows: SpyRow[]): SpySignals | null {
  if (rows.length < 52) return null;
  const closes = rows.map(r => r.close);
  const latest = rows[rows.length - 1];

  const ema50Series = calcEMA(closes, 50);
  const ema50 = ema50Series[ema50Series.length - 1];
  const ema50Ratio = ((latest.close - ema50) / ema50) * 100;

  const rsi14 = calcRSI(closes.slice(-30)); // use last 30 for speed, enough history
  const mfi14 = calcMFI(rows);
  const obvDiv = calcOBVDivergence(rows);

  // 12m return: compare latest close to close ~52 weekly bars ago
  const price52wAgo = rows[rows.length - 53]?.close ?? rows[0].close;
  const return12m = ((latest.close - price52wAgo) / price52wAgo) * 100;

  return {
    rsi14,
    ema50w: ema50Ratio,
    obv3m: obvDiv,
    mfi14,
    asOf: latest.date,
    priceLatest: latest.close,
    return12m,
    rows: rows.length,
  };
}

// ── Scores from signals ───────────────────────────────────────────────────────

export function scoreFromSpySignals(sig: SpySignals) {
  // RSI: 0→100 score; >70 overbought (bearish), <30 oversold (bullish)
  const rsiScore = sig.rsi14 > 80 ? 10 : sig.rsi14 > 70 ? 30 : sig.rsi14 > 60 ? 50
    : sig.rsi14 > 50 ? 60 : sig.rsi14 > 40 ? 70 : sig.rsi14 > 30 ? 80 : 90;

  // Trend (EMA50W ratio %): very extended = bearish
  const t = sig.ema50w;
  const trendScore = t > 30 ? 10 : t > 20 ? 20 : t > 15 ? 35 : t > 10 ? 45
    : t > 5 ? 60 : t > 0 ? 70 : t > -10 ? 75 : 85;

  // OBV divergence: negative = distribution = bearish
  const o = sig.obv3m;
  const obvScore = o < -15 ? 10 : o < -8 ? 20 : o < -3 ? 40 : o < 3 ? 55 : o < 10 ? 70 : 80;

  // MFI: <20 oversold (bullish), >80 overbought (bearish)
  const mfiScore = sig.mfi14 > 80 ? 15 : sig.mfi14 > 70 ? 30 : sig.mfi14 > 60 ? 45
    : sig.mfi14 > 40 ? 55 : sig.mfi14 > 30 ? 70 : 85;

  return { rsiScore, trendScore, obvScore, mfiScore };
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function normalizeDate(raw: string): string {
  // Unix timestamp (TradingView sometimes exports these)
  if (/^\d{9,11}$/.test(raw.trim())) {
    return new Date(parseInt(raw) * 1000).toISOString().slice(0, 10);
  }
  // Already YYYY-MM-DD or similar — return as-is
  return raw.trim();
}

function parseCSV(text: string): SpyRow[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV too short');
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));

  const idx = {
    // TradingView uses "time"; Yahoo uses "date"
    date:     header.findIndex(h => h === 'time' || h === 'date'),
    open:     header.findIndex(h => h === 'open'),
    high:     header.findIndex(h => h === 'high'),
    low:      header.findIndex(h => h === 'low'),
    // prefer "adj close" (Yahoo) over plain "close"; TradingView has only "close"
    adjClose: header.findIndex(h => h.includes('adj')),
    close:    header.findIndex(h => h === 'close'),
    volume:   header.findIndex(h => h.includes('vol')),
  };

  const closeCol = idx.adjClose >= 0 ? idx.adjClose : idx.close;
  if (idx.date < 0 || closeCol < 0) {
    throw new Error('Could not find Date/Time and Close columns. Make sure the CSV has a header row.');
  }

  const rows: SpyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const close = parseFloat(cols[closeCol]);
    if (isNaN(close) || close <= 0) continue;
    rows.push({
      date:   normalizeDate(cols[idx.date]),
      open:   idx.open   >= 0 ? parseFloat(cols[idx.open])   : close,
      high:   idx.high   >= 0 ? parseFloat(cols[idx.high])   : close,
      low:    idx.low    >= 0 ? parseFloat(cols[idx.low])     : close,
      close,
      volume: idx.volume >= 0 ? parseFloat(cols[idx.volume])  : 0,
    });
  }
  if (rows.length < 2) throw new Error('No valid rows found in CSV');
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onSignals: (sig: SpySignals | null) => void;
  initialSignals?: SpySignals | null;
}

export function SpyCsvDrop({ onSignals, initialSignals }: Props) {
  const [status, setStatus] = useState<'idle' | 'hover' | 'ok' | 'error'>(initialSignals ? 'ok' : 'idle');
  const [message, setMessage] = useState(initialSignals ? `Restored: ${initialSignals.rows} bars through ${initialSignals.asOf}` : '');
  const [signals, setSignals] = useState<SpySignals | null>(initialSignals ?? null);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && !file.type.includes('csv') && !file.type.includes('text')) {
      setStatus('error');
      setMessage('Please drop a .csv file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseCSV(e.target?.result as string);
        if (rows.length < 52) throw new Error(`Need at least 52 rows (got ${rows.length}). Use weekly SPY data.`);
        const sig = computeSpySignals(rows);
        if (!sig) throw new Error('Could not compute signals');
        setSignals(sig);
        onSignals(sig);
        setStatus('ok');
        setMessage(`Loaded ${rows.length} weekly bars — signals computed through ${sig.asOf}`);
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

  const scores = signals ? scoreFromSpySignals(signals) : null;

  return (
    <div className="csv-panel">
      <div className="csv-intro">
        <h3>SPY Weekly Data</h3>
        <p>
          Drop a weekly SPY CSV below to compute MFI, Trend/EMA50W, OBV, and RSI live.
        </p>
        <p>
          <strong>TradingView:</strong> Open SPY chart → set timeframe to <strong>1W</strong> →
          right-click on any candle → <em>Export chart data…</em> → Save as CSV.
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
          id="spy-csv-input"
        />
        <label htmlFor="spy-csv-input" className="csv-drop-label">
          {status === 'ok' ? '✓ ' : status === 'error' ? '✗ ' : '↓ '}
          {status === 'idle' || status === 'hover'
            ? 'Drop SPY weekly CSV here or click to browse'
            : message}
        </label>
      </div>

      {signals && scores && (
        <div className="csv-results">
          <div className="csv-meta">
            {signals.rows} weekly bars · SPY ${signals.priceLatest.toFixed(2)} · through {signals.asOf}
          </div>
          <div className="csv-signals">
            <div className="csv-signal-row">
              <span className="csv-sig-label">MFI (14w)</span>
              <span className="csv-sig-value">{signals.mfi14.toFixed(1)}</span>
              <span className="csv-sig-score" style={{ color: scores.mfiScore < 40 ? 'var(--bear)' : scores.mfiScore > 65 ? 'var(--bull)' : 'var(--text)' }}>
                score {scores.mfiScore}
              </span>
            </div>
            <div className="csv-signal-row">
              <span className="csv-sig-label">Trend / EMA50W</span>
              <span className="csv-sig-value">{signals.ema50w >= 0 ? '+' : ''}{signals.ema50w.toFixed(2)}%</span>
              <span className="csv-sig-score" style={{ color: scores.trendScore < 40 ? 'var(--bear)' : scores.trendScore > 65 ? 'var(--bull)' : 'var(--text)' }}>
                score {scores.trendScore}
              </span>
            </div>
            <div className="csv-signal-row">
              <span className="csv-sig-label">OBV divergence</span>
              <span className="csv-sig-value">{signals.obv3m >= 0 ? '+' : ''}{signals.obv3m.toFixed(1)}%</span>
              <span className="csv-sig-score" style={{ color: scores.obvScore < 40 ? 'var(--bear)' : scores.obvScore > 65 ? 'var(--bull)' : 'var(--text)' }}>
                score {scores.obvScore}
              </span>
            </div>
            <div className="csv-signal-row">
              <span className="csv-sig-label">RSI (14w)</span>
              <span className="csv-sig-value">{signals.rsi14.toFixed(1)}</span>
              <span className="csv-sig-score" style={{ color: scores.rsiScore < 40 ? 'var(--bear)' : scores.rsiScore > 65 ? 'var(--bull)' : 'var(--text)' }}>
                score {scores.rsiScore}
              </span>
            </div>
          </div>
          <p className="csv-note">
            These scores override the static snapshot values in the composite when a CSV is loaded.
          </p>
        </div>
      )}
    </div>
  );
}
