/**
 * Live data fetcher — pulls PPI, margin debt, and Buffett indicator from
 * https://stock-sentinel-55b9j8kc2-funnybunny05s-projects.vercel.app
 * which updates monthly.
 */

const BASE = 'https://stock-sentinel-55b9j8kc2-funnybunny05s-projects.vercel.app';

// ── PPI ───────────────────────────────────────────────────────────────────────

export interface PpiPoint {
  date: string;  // "YYYY-MM"
  index: number;
  mom: number | null;
  yoy: number | null;
}

export interface PpiData {
  last_updated: string;
  series: { WPUFD4: { data: PpiPoint[] } };
}

export interface PpiSignal {
  score: number;
  raw: string;
  desc: string;
  latest: PpiPoint;
  asOf: string;
}

export function scorePpi(data: PpiData): PpiSignal {
  const pts = data.series.WPUFD4.data;
  const latest = pts[pts.length - 1];

  // Find the last point with a non-null yoy value
  let yoyPoint = latest;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].yoy !== null) { yoyPoint = pts[i]; break; }
  }
  const yoy = yoyPoint.yoy ?? 0;

  // 3-month annualized from last 3 MoM values
  const recentMom = pts.slice(-3).map(p => p.mom ?? 0);
  const ann3m = recentMom.reduce((a, b) => a + b, 0) / recentMom.length * 12;

  // Acceleration: compare last 3m avg to prior 3m avg
  const priorMom = pts.slice(-6, -3).map(p => p.mom ?? 0);
  const priorAvg = priorMom.reduce((a, b) => a + b, 0) / priorMom.length;
  const recentAvg = recentMom.reduce((a, b) => a + b, 0) / recentMom.length;
  const accel = recentAvg - priorAvg; // positive = accelerating

  // Score: lower inflation = more bullish
  // Calibrated so yoy=4.02 → ~32 (matches v2 snapshot)
  let score = Math.round(75 - yoy * 10.5);
  if (accel > 0.1) score -= 3;   // accelerating penalty
  if (accel < -0.1) score += 3;  // decelerating bonus
  score = Math.max(5, Math.min(95, score));

  const zone =
    yoy >= 5   ? 'Danger zone' :
    yoy >= 3.5 ? 'Hot zone' :
    yoy >= 2   ? 'Warm' :
    yoy >= 0   ? 'Target range' : 'Below target';

  const accelLabel = accel > 0.1 ? ` +${accel.toFixed(1)}pp accel` : accel < -0.1 ? ` ${accel.toFixed(1)}pp decel` : '';
  const raw = `${yoy.toFixed(2)}% YoY${accelLabel}`;
  const desc = `${zone} · 3m ann ${ann3m.toFixed(2)}%`;

  return { score, raw, desc, latest: yoyPoint, asOf: yoyPoint.date };
}

export async function fetchPpi(): Promise<PpiSignal> {
  const res = await fetch(`${BASE}/ppi_data.json`);
  if (!res.ok) throw new Error(`PPI fetch failed: ${res.status}`);
  const data: PpiData = await res.json();
  return scorePpi(data);
}

// ── Margin Debt ───────────────────────────────────────────────────────────────

export interface MarginPoint {
  date: string;
  margin_debt: number;
  yoy_growth: number | null;
}

export interface MarginData {
  last_updated: string;
  data: MarginPoint[];
}

export interface MarginSignal {
  score: number;
  raw: string;
  desc: string;
  latest: MarginPoint;
  asOf: string;
}

export function scoreMarginDebt(data: MarginData): MarginSignal {
  const pts = data.data;
  const latest = pts[pts.length - 1];

  // Use last point with non-null yoy_growth
  let yoyPoint = latest;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].yoy_growth !== null) { yoyPoint = pts[i]; break; }
  }
  const yoy = yoyPoint.yoy_growth ?? 0;

  // Score: high YoY margin debt growth = euphoria = bearish
  // Calibrated so yoy=38.7 → ~20 (matches v2 snapshot)
  let score = Math.round(60 - yoy * 1.03);
  score = Math.max(5, Math.min(95, score));

  const zone =
    yoy >= 35  ? 'Euphoric zone (>35%)' :
    yoy >= 20  ? 'Elevated' :
    yoy >= 0   ? 'Moderate growth' :
    yoy >= -20 ? 'Contracting' : 'Deep contraction';

  const raw = `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}% YoY`;
  const desc = `${zone} · 2000, 2007, 2021 comps`;

  return { score, raw, desc, latest: yoyPoint, asOf: yoyPoint.date };
}

export async function fetchMarginDebt(): Promise<MarginSignal> {
  const res = await fetch(`${BASE}/margin_data.json`);
  if (!res.ok) throw new Error(`Margin debt fetch failed: ${res.status}`);
  const data: MarginData = await res.json();
  return scoreMarginDebt(data);
}

// ── Buffett Indicator ─────────────────────────────────────────────────────────

export interface BuffettCurrent {
  ratio_pct: number;
  market_cap_billions: number;
  gdp_billions: number;
  trend_pct: number;
  deviation_pct: number;
  std_devs: number;
  valuation: string;
}

export interface BuffettHistoryPoint {
  date: string;
  ratio_pct: number;
  trend_pct: number;
  band_plus1: number;
  band_plus2: number;
  band_minus1: number;
  band_minus2: number;
}

export interface BuffettApiData {
  last_updated: string;
  current: BuffettCurrent;
  data: BuffettHistoryPoint[];
}

export interface BuffettSignal {
  score: number;
  raw: string;
  desc: string;
  detail: {
    ratio: number;
    trend: number;
    upper2sigma: number;
    lower2sigma: number;
    zScore: number;
  };
  asOf: string;
  history: BuffettHistoryPoint[];
}

export function scoreBuffett(data: BuffettApiData): BuffettSignal {
  const c = data.current;
  const pts = data.data;
  const lastPt = pts[pts.length - 1];

  // Score: higher z-score above trend = more bearish
  // Calibrated so std_devs=2.43 → ~15 (matches v2 snapshot)
  const score = Math.max(5, Math.min(95, Math.round(50 - c.std_devs * 15)));

  const raw = `${c.ratio_pct.toFixed(0)}%, Z ${c.std_devs >= 0 ? '+' : ''}${c.std_devs.toFixed(2)}`;
  const episodes = c.std_devs >= 2 ? '· Above +2σ' : c.std_devs >= 1 ? '· Above +1σ' : c.std_devs <= -1 ? '· Below −1σ' : '· Near trend';
  const desc = `${episodes} (${c.valuation})`;

  const detail = {
    ratio: c.ratio_pct,
    trend: c.trend_pct,
    upper2sigma: lastPt.band_plus2,
    lower2sigma: lastPt.band_minus2,
    zScore: c.std_devs,
  };

  return { score, raw, desc, detail, asOf: lastPt.date, history: pts };
}

export async function fetchBuffett(): Promise<BuffettSignal> {
  const res = await fetch(`${BASE}/buffett_indicator_data.json`);
  if (!res.ok) throw new Error(`Buffett fetch failed: ${res.status}`);
  const data: BuffettApiData = await res.json();
  return scoreBuffett(data);
}

// ── VIX from FRED ─────────────────────────────────────────────────────────────
// Series: VIXCLS (daily close). Free API key at fred.stlouisfed.org
// Store key in .env as VITE_FRED_API_KEY

export interface VixSignal {
  value: number;
  asOf: string;
}

export async function fetchVix(): Promise<VixSignal> {
  const key = (import.meta as any).env?.VITE_FRED_API_KEY as string | undefined;
  if (!key) throw new Error('VITE_FRED_API_KEY not set');

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&sort_order=desc&limit=10&api_key=${key}&file_type=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED VIX fetch failed: ${res.status}`);
  const json = await res.json();

  // Find the first observation with a real value (not ".")
  const obs = (json.observations as Array<{ date: string; value: string }>)
    .find(o => o.value !== '.');
  if (!obs) throw new Error('No valid VIX observation from FRED');

  return { value: parseFloat(obs.value), asOf: obs.date };
}

// ── Combined ──────────────────────────────────────────────────────────────────

export interface LiveData {
  ppi: PpiSignal;
  margin: MarginSignal;
  buffett: BuffettSignal;
  vix: VixSignal | null;   // null if FRED key not set
  fetchedAt: Date;
}

export async function fetchLiveData(): Promise<LiveData> {
  const [ppi, margin, buffett, vix] = await Promise.allSettled([
    fetchPpi(),
    fetchMarginDebt(),
    fetchBuffett(),
    fetchVix(),
  ]);

  if (ppi.status === 'rejected')    throw ppi.reason;
  if (margin.status === 'rejected') throw margin.reason;
  if (buffett.status === 'rejected') throw buffett.reason;

  return {
    ppi:     (ppi     as PromiseFulfilledResult<PpiSignal>).value,
    margin:  (margin  as PromiseFulfilledResult<MarginSignal>).value,
    buffett: (buffett as PromiseFulfilledResult<BuffettSignal>).value,
    vix:     vix.status === 'fulfilled' ? vix.value : null,
    fetchedAt: new Date(),
  };
}
