/**
 * Live data fetcher — pulls PPI, margin debt, and Buffett indicator from
 * https://stock-sentinel-7n2zayq4n-funnybunny05s-projects.vercel.app
 * which updates monthly.
 */

const BASE = 'https://stock-sentinel-7n2zayq4n-funnybunny05s-projects.vercel.app';

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

// Fetch PPI directly from BLS public API (CORS-open, always current).
// Pulls 3 years so we have enough history for 3m/6m momentum calcs.
export async function fetchPpi(): Promise<PpiSignal> {
  const now = new Date();
  const thisYear = now.getFullYear();
  const url = `https://api.bls.gov/publicAPI/v1/timeseries/data/WPUFD4?startyear=${thisYear - 2}&endyear=${thisYear}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`BLS PPI fetch failed: ${res.status}`);
  const json = await res.json();
  if (json.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS PPI: ${json.message}`);

  // BLS returns newest-first; sort oldest-first and skip annual (M13)
  const obs: Array<{ year: string; period: string; value: string }> = json.Results.series[0].data;
  const pts: PpiPoint[] = obs
    .filter(o => o.period !== 'M13')
    .map(o => ({
      date:  `${o.year}-${o.period.replace('M', '').padStart(2, '0')}`,
      index: parseFloat(o.value),
      mom:   null as number | null,
      yoy:   null as number | null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Compute MoM and YoY from raw index values
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) pts[i].mom = ((pts[i].index - pts[i - 1].index) / pts[i - 1].index) * 100;
    const yAgo = pts.find(p => p.date === `${parseInt(pts[i].date.slice(0, 4)) - 1}-${pts[i].date.slice(5)}`);
    if (yAgo) pts[i].yoy = ((pts[i].index - yAgo.index) / yAgo.index) * 100;
  }

  return scorePpi({ last_updated: now.toISOString(), series: { WPUFD4: { data: pts } } });
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

// Fetch margin debt directly from FINRA xlsx via Electron main-process proxy.
// Falls back to the Vercel backend if not running in Electron.
export async function fetchMarginDebt(): Promise<MarginSignal> {
  const bridge = (window as any).electronBridge as { fetchMarginData?: () => Promise<string> } | undefined;
  if (bridge?.fetchMarginData) {
    const jsonStr = await bridge.fetchMarginData();
    // jsonStr: [{date: "YYYY-MM", margin_debt: number}, ...] newest-first, in $thousands
    const rows: Array<{ date: string; margin_debt: number }> = JSON.parse(jsonStr);

    // Sort oldest-first, compute YoY
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const pts: MarginPoint[] = sorted.map((r) => {
      const yAgo = sorted.find(p => p.date === `${parseInt(r.date.slice(0, 4)) - 1}-${r.date.slice(5)}`);
      return {
        date:       r.date,
        margin_debt: r.margin_debt,
        yoy_growth: yAgo ? ((r.margin_debt - yAgo.margin_debt) / yAgo.margin_debt) * 100 : null,
      };
    });

    return scoreMarginDebt({ last_updated: new Date().toISOString(), data: pts });
  }

  // Fallback: Vercel backend
  const res = await fetch(`${BASE}/margin_data.json`, { cache: 'no-store' });
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

function scrapeBuffettCMV(html: string): BuffettSignal | null {
  // Ratio e.g. "230%"
  const ratioM = html.match(/current ratio of (\d+(?:\.\d+)?)%/i)
    ?? html.match(/Buffett Indicator(?:\s+value)? of (\d+(?:\.\d+)?)%/i);
  // Std devs e.g. "2.4 standard deviations"
  const sigmaM = html.match(/(\d+(?:\.\d+)?)\s+standard deviations? above/i);
  // Deviation % e.g. "75.15%"
  const devM   = html.match(/approximately (\d+(?:\.\d+)?)%.*?above the historical trend/i);
  // Valuation label
  const valM   = html.match(/market is ([\w\s]+?Overvalued|Fairly Valued|[\w\s]+?Undervalued)\b/i);
  // As-of date e.g. "December 31, 2025"
  const dateM  = html.match(/As of (\w+ \d+,?\s*\d{4})/i);

  if (!ratioM || !sigmaM) return null;

  const ratio   = parseFloat(ratioM[1]);
  const stdDevs = parseFloat(sigmaM[1]);
  const devPct  = devM ? parseFloat(devM[1]) : stdDevs * 30; // rough fallback
  const valuation = valM ? valM[1].trim().toUpperCase() : 'OVERVALUED';
  const asOf = dateM ? dateM[1] : 'unknown';

  const score = Math.max(5, Math.min(95, Math.round(50 - stdDevs * 15)));
  const raw  = `${ratio.toFixed(0)}%, Z +${stdDevs.toFixed(2)}`;
  const desc = `Above +${stdDevs >= 2 ? '2' : '1'}σ (${valuation})`;

  return {
    score, raw, desc,
    detail: { ratio, trend: ratio - devPct, upper2sigma: 0, lower2sigma: 0, zScore: stdDevs },
    asOf,
    history: [],   // CMV page doesn't expose chart data; keep using backend for history
  };
}

export async function fetchBuffett(): Promise<BuffettSignal> {
  // Try currentmarketvaluation.com via Electron proxy (no CORS) for freshest data
  const bridge = (window as any).electronBridge as { proxyFetch?: (url: string) => Promise<string> } | undefined;
  if (bridge?.proxyFetch) {
    try {
      const html = await bridge.proxyFetch('https://www.currentmarketvaluation.com/models/buffett-indicator.php');
      const scraped = scrapeBuffettCMV(html);
      if (scraped) {
        // Still fetch backend for history data, but overlay current values
        try {
          const res2 = await fetch(`${BASE}/buffett_indicator_data.json`, { cache: 'no-store' });
          if (res2.ok) {
            const legacy: BuffettApiData = await res2.json();
            scraped.history = legacy.data;
            scraped.detail.upper2sigma = legacy.data.at(-1)?.band_plus2 ?? 0;
            scraped.detail.lower2sigma = legacy.data.at(-1)?.band_minus2 ?? 0;
          }
        } catch { /* ignore */ }
        return scraped;
      }
    } catch { /* fall through to backend */ }
  }

  // Fallback: original Vercel backend
  const res = await fetch(`${BASE}/buffett_indicator_data.json`, { cache: 'no-store' });
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
