/**
 * SpyCsvDrop — drag-and-drop zone for SPY monthly OHLCV CSV data.
 *
 * Accepted formats:
 *   TradingView export:  time,open,high,low,close,volume
 *   Yahoo Finance:       Date,Open,High,Low,Close,Adj Close,Volume
 *
 * TradingView: Chart → set timeframe to 1M → right-click any candle → Export chart data (CSV)
 * Yahoo Finance: Historical Data → set frequency to Monthly → Download
 *
 * Monthly bars match the training data: RSI(14) = 14-month RSI, EMA(12) = 12-month EMA.
 * Computes: RSI-14m, EMA-12m (Trend), OBV-3m, MFI-14m
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
  ema12m: number;    // (price − EMA12m) / EMA12m × 100
  obv3m: number;     // 3-month OBV divergence: net signed volume % minus price %
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
  // Wilder smoothing — needs full history for seed washout
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

function calcOBVDivergence(rows: SpyRow[], lookback = 3): number {
  // OBV divergence over lookback months: net signed volume as % of total volume,
  // minus price % change. Negative = volume lagging price = distribution = bearish.
  if (rows.length < lookback + 1) return 0;
  const window = rows.slice(-(lookback + 1));
  let netObv = 0;
  let totalVol = 0;
  for (let i = 1; i < window.length; i++) {
    const vol = window[i].volume;
    netObv += window[i].close > window[i - 1].close ? vol
            : window[i].close < window[i - 1].close ? -vol : 0;
    totalVol += vol;
  }
  if (totalVol === 0) return 0;
  const obvPct = (netObv / totalVol) * 100; // -100 to +100
  const pricePct = ((window[window.length - 1].close - window[0].close) / window[0].close) * 100;
  return obvPct - pricePct;
}

const MIN_MONTHS = 24; // need at least 2 years for meaningful EMA-12 and RSI-14

export function computeSpySignals(rows: SpyRow[]): SpySignals | null {
  if (rows.length < MIN_MONTHS) return null;
  const closes = rows.map(r => r.close);
  const latest = rows[rows.length - 1];

  const ema12Series = calcEMA(closes, 12);
  const ema12 = ema12Series[ema12Series.length - 1];
  const ema12Ratio = ((latest.close - ema12) / ema12) * 100;

  const rsi14 = calcRSI(closes);
  const mfi14 = calcMFI(rows);
  const obvDiv = calcOBVDivergence(rows);

  // 12m return: compare latest close to close 12 monthly bars ago
  const price12mAgo = rows[rows.length - 13]?.close ?? rows[0].close;
  const return12m = ((latest.close - price12mAgo) / price12mAgo) * 100;

  return {
    rsi14,
    ema12m: ema12Ratio,
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
  // RSI-14m: >70 overbought (bearish), <30 oversold (bullish)
  const rsiScore = sig.rsi14 > 80 ? 10 : sig.rsi14 > 70 ? 30 : sig.rsi14 > 60 ? 50
    : sig.rsi14 > 50 ? 60 : sig.rsi14 > 40 ? 70 : sig.rsi14 > 30 ? 80 : 90;

  // EMA-12m dist %: very extended above 12m EMA = bearish
  const t = sig.ema12m;
  const trendScore = t > 30 ? 10 : t > 20 ? 20 : t > 15 ? 35 : t > 10 ? 45
    : t > 5 ? 60 : t > 0 ? 70 : t > -10 ? 75 : 85;

  // OBV divergence: negative = distribution = bearish
  const o = sig.obv3m;
  const obvScore = o < -15 ? 10 : o < -8 ? 20 : o < -3 ? 40 : o < 3 ? 55 : o < 10 ? 70 : 80;

  // MFI-14m: >80 overbought (bearish), <20 oversold (bullish)
  const mfiScore = sig.mfi14 > 80 ? 15 : sig.mfi14 > 70 ? 30 : sig.mfi14 > 60 ? 45
    : sig.mfi14 > 40 ? 55 : sig.mfi14 > 30 ? 70 : 85;

  return { rsiScore, trendScore, obvScore, mfiScore };
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function normalizeDate(raw: string): string {
  // TradingView writes the `time` column as a signed unix epoch in seconds.
  // History can go back to the 1800s, so this must accept:
  //   - negative integers (pre-1970, e.g. SPX from 1871: `-3121407238`)
  //   - any positive length (Jan 1970–Sept 1973 are 8 digits or fewer)
  //   - 13-digit millisecond timestamps (some exports use ms)
  // We then return ISO YYYY-MM-DD so lexicographic sort works correctly.
  const t = raw.trim();
  if (/^-?\d+$/.test(t)) {
    const n = parseInt(t, 10);
    const secs = Math.abs(n) >= 1e12 ? n / 1000 : n;
    // Sanity-bound: 1800-01-01 .. 2200-01-01. Outside this range, treat as
    // garbage rather than silently passing it through (which is what produced
    // the "asOf 99844200" bug — the literal string sorted to the end).
    if (secs >= -5364662400 && secs <= 7258118400) {
      const d = new Date(secs * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    throw new Error(`Date out of plausible range: "${raw}"`);
  }
  // ISO YYYY-MM-DD (Yahoo, FRED) — trim any trailing time portion.
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // Last-ditch parse for other date formats (e.g. "Jan 1, 2024").
  const d = new Date(t);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw new Error(`Unparseable date value: "${raw}"`);
}

function parseCSV(text: string): SpyRow[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV too short');
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));

  const idx = {
    date:     header.findIndex(h => h === 'time' || h === 'date'),
    open:     header.findIndex(h => h === 'open'),
    high:     header.findIndex(h => h === 'high'),
    low:      header.findIndex(h => h === 'low'),
    adjClose: header.findIndex(h => h.includes('adj')),
    close:    header.findIndex(h => h === 'close'),
    volume:   header.findIndex(h => h.includes('vol')),
  };

  const useAdj = idx.adjClose >= 0;
  const closeCol = useAdj ? idx.adjClose : idx.close;
  if (idx.date < 0 || closeCol < 0) {
    throw new Error('Could not find Date/Time and Close columns. Make sure the CSV has a header row.');
  }

  const rows: SpyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const close = parseFloat(cols[closeCol]);
    if (isNaN(close) || close <= 0) continue;
    // Scale H/L/O by the adj factor so typical price used in MFI is internally consistent
    let adjFactor = 1;
    if (useAdj && idx.close >= 0) {
      const rawClose = parseFloat(cols[idx.close]);
      if (!isNaN(rawClose) && rawClose > 0) adjFactor = close / rawClose;
    }
    rows.push({
      date:   normalizeDate(cols[idx.date]),
      open:   idx.open   >= 0 ? parseFloat(cols[idx.open])   * adjFactor : close,
      high:   idx.high   >= 0 ? parseFloat(cols[idx.high])   * adjFactor : close,
      low:    idx.low    >= 0 ? parseFloat(cols[idx.low])     * adjFactor : close,
      close,
      volume: idx.volume >= 0 ? parseFloat(cols[idx.volume]) : 0,
    });
  }
  if (rows.length < 2) throw new Error('No valid rows found in CSV');
  rows.sort((a, b) => a.date.localeCompare(b.date));

  // Reject daily or weekly data — monthly bars should average ~28–31 days apart
  if (rows.length >= 4) {
    const spanDays = (new Date(rows[rows.length - 1].date).getTime() - new Date(rows[0].date).getTime()) / 86400000;
    const avgDaysPerBar = spanDays / (rows.length - 1);
    if (avgDaysPerBar < 20) {
      const granularity = avgDaysPerBar < 3 ? 'daily' : 'weekly';
      throw new Error(
        `This looks like ${granularity} data (avg ${avgDaysPerBar.toFixed(0)} days/bar). ` +
        `Please set the chart timeframe to 1M (monthly) before exporting.`
      );
    }
  }

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
        if (rows.length < MIN_MONTHS) {
          throw new Error(`Need at least ${MIN_MONTHS} monthly bars (got ${rows.length}). Export more history.`);
        }
        const sig = computeSpySignals(rows);
        if (!sig) throw new Error('Could not compute signals');
        setSignals(sig);
        onSignals(sig);
        setStatus('ok');
        setMessage(`Loaded ${rows.length} monthly bars — signals computed through ${sig.asOf}`);
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
        <h3>SPY Monthly Data</h3>
        <p>
          Drop a <strong>monthly</strong> SPY CSV to compute RSI-14m, EMA-12m, MFI-14m, and OBV live.
          Monthly bars match the training data — RSI(14) here means 14 months, same as the model.
        </p>
        <p>
          <strong>TradingView:</strong> Open SPY chart → set timeframe to <strong>1M</strong> →
          right-click any candle → <em>Export chart data…</em> → Save as CSV.
        </p>
        <p>
          <strong>Yahoo Finance:</strong> SPY Historical Data → Frequency: <strong>Monthly</strong> → Download.
        </p>
        <p>
          Expected columns: <code>time, open, high, low, close, volume</code>
          &nbsp;(Yahoo Finance "Adj Close" format also accepted)
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
            ? 'Drop SPY monthly CSV here or click to browse'
            : message}
        </label>
      </div>

      {signals && scores && (
        <div className="csv-results">
          <div className="csv-meta">
            {signals.rows} monthly bars · SPY ${signals.priceLatest.toFixed(2)} · through {signals.asOf}
          </div>
          <div className="csv-signals">
            <div className="csv-signal-row">
              <span className="csv-sig-label">MFI (14m)</span>
              <span className="csv-sig-value">{signals.mfi14.toFixed(1)}</span>
              <span className="csv-sig-score" style={{ color: scores.mfiScore < 40 ? 'var(--bear)' : scores.mfiScore > 65 ? 'var(--bull)' : 'var(--text)' }}>
                score {scores.mfiScore}
              </span>
            </div>
            <div className="csv-signal-row">
              <span className="csv-sig-label">Trend / EMA-12m</span>
              <span className="csv-sig-value">{signals.ema12m >= 0 ? '+' : ''}{signals.ema12m.toFixed(2)}%</span>
              <span className="csv-sig-score" style={{ color: scores.trendScore < 40 ? 'var(--bear)' : scores.trendScore > 65 ? 'var(--bull)' : 'var(--text)' }}>
                score {scores.trendScore}
              </span>
            </div>
            <div className="csv-signal-row">
              <span className="csv-sig-label">OBV divergence (3m)</span>
              <span className="csv-sig-value">{signals.obv3m >= 0 ? '+' : ''}{signals.obv3m.toFixed(1)}%</span>
              <span className="csv-sig-score" style={{ color: scores.obvScore < 40 ? 'var(--bear)' : scores.obvScore > 65 ? 'var(--bull)' : 'var(--text)' }}>
                score {scores.obvScore}
              </span>
            </div>
            <div className="csv-signal-row">
              <span className="csv-sig-label">RSI (14m)</span>
              <span className="csv-sig-value">{signals.rsi14.toFixed(1)}</span>
              <span className="csv-sig-score" style={{ color: scores.rsiScore < 40 ? 'var(--bear)' : scores.rsiScore > 65 ? 'var(--bull)' : 'var(--text)' }}>
                score {scores.rsiScore}
              </span>
            </div>
          </div>
          <p className="csv-note">
            These signals override the static snapshot values in the composite when a CSV is loaded.
          </p>
        </div>
      )}
    </div>
  );
}
