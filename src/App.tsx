import { useState, useMemo, useEffect, useCallback } from 'react';
import './lib/chartSetup';

import { CURRENT } from './lib/snapshot';
import {
  computeV2,
  scoreAAII,
  getAAIIData,
  getTimeseries,
  type RawSignalValues,
} from './lib/scoring';
import { fetchLiveData, type LiveData } from './lib/liveData';
import { SpyCsvDrop, type SpySignals } from './components/SpyCsvDrop';
import { VixCsvDrop, type VixSignals } from './components/VixCsvDrop';
import { YieldCurveCsvDrop, type YieldCurveSignals } from './components/YieldCurveCsvDrop';
import { BreadthCsvDrop, type BreadthSignals } from './components/BreadthCsvDrop';

import { Gauge }         from './components/Gauge';
import { ForwardReturns } from './components/ForwardReturns';
import { AAIICard }      from './components/AAIICard';
import { ExposureCard }  from './components/ExposureCard';
import { SubScores }     from './components/SubScores';
import { BucketsPanel }  from './components/BucketsPanel';
import { HistoryPanel }  from './components/HistoryPanel';
import { BuffettPanel }  from './components/BuffettPanel';
import { AAIIPanel }     from './components/AAIIPanel';
import { PlaybookPanel }  from './components/PlaybookPanel';
import { MathPanel }      from './components/MathPanel';
import { UpdateBanner }   from './components/UpdateBanner';
import { StrategyPanel }  from './components/StrategyPanel';

type TabId = 'buckets' | 'history' | 'strategy' | 'buffett' | 'aaii' | 'playbook' | 'math' | 'data';

export default function App() {
  const [tab, setTab] = useState<TabId>('buckets');

  // AAII (bundled JSON)
  const { history: aaiiHistory, stats: aaiiStats } = useMemo(() => getAAIIData(), []);
  const aaii = useMemo(() => scoreAAII(aaiiHistory, aaiiStats), [aaiiHistory, aaiiStats]);

  // Live data: PPI, margin debt, Buffett
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [liveStatus, setLiveStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLiveStatus('loading');
    fetchLiveData()
      .then(d  => { if (!cancelled) { setLiveData(d);  setLiveStatus('ok');    }})
      .catch(() => { if (!cancelled) setLiveStatus('error'); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  // SPY CSV → replace RSI/MFI/trend signals (persisted across sessions)
  const [spySignals, setSpySignals] = useState<SpySignals | null>(() => {
    try { const s = localStorage.getItem('spy_csv_signals'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const handleSpySignals = useCallback((sig: SpySignals | null) => {
    setSpySignals(sig);
    if (sig) localStorage.setItem('spy_csv_signals', JSON.stringify(sig));
    else localStorage.removeItem('spy_csv_signals');
  }, []);

  // VIX CSV → replace VIX close value (persisted across sessions)
  const [vixSignals, setVixSignals] = useState<VixSignals | null>(() => {
    try { const s = localStorage.getItem('vix_csv_signals'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const handleVixSignals = useCallback((sig: VixSignals | null) => {
    setVixSignals(sig);
    if (sig) localStorage.setItem('vix_csv_signals', JSON.stringify(sig));
    else localStorage.removeItem('vix_csv_signals');
  }, []);

  // Yield curve CSV → replace yieldCurve10y3m (persisted)
  const [yieldSignals, setYieldSignals] = useState<YieldCurveSignals | null>(() => {
    try { const s = localStorage.getItem('yield_csv_signals'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const handleYieldSignals = useCallback((sig: YieldCurveSignals | null) => {
    setYieldSignals(sig);
    if (sig) localStorage.setItem('yield_csv_signals', JSON.stringify(sig));
    else localStorage.removeItem('yield_csv_signals');
  }, []);

  // RSP/breadth CSV → replace breadth12mChg (persisted)
  const [breadthSignals, setBreadthSignals] = useState<BreadthSignals | null>(() => {
    try { const s = localStorage.getItem('breadth_csv_signals'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const handleBreadthSignals = useCallback((sig: BreadthSignals | null) => {
    setBreadthSignals(sig);
    if (sig) localStorage.setItem('breadth_csv_signals', JSON.stringify(sig));
    else localStorage.removeItem('breadth_csv_signals');
  }, []);

  // Build raw signal inputs — live/csv override snapshot
  const rawInputs: RawSignalValues = useMemo(() => ({
    rsi14m:          spySignals?.rsi14   ?? CURRENT.rsi14m,
    mfi14m:          spySignals?.mfi14   ?? CURRENT.mfi14m,
    emaDistPct:      spySignals?.ema50w  ?? CURRENT.emaDistPct,
    ppiYoy:          liveData?.ppi.latest.yoy          ?? CURRENT.ppiYoy,
    mdebtYoy:        liveData?.margin.latest.yoy_growth ?? CURRENT.mdebtYoy,
    aaiiSpread:      aaii.spread,
    vixClose:        vixSignals?.vixClose ?? liveData?.vix?.value ?? CURRENT.vixClose,
    yieldCurve10y3m: yieldSignals?.yieldSpread   ?? CURRENT.yieldCurve10y3m,
    breadth12mChg:   breadthSignals?.breadth12mChg ?? CURRENT.breadth12mChg,
  }), [spySignals, liveData, aaii, yieldSignals, breadthSignals]);

  const result     = useMemo(() => computeV2(rawInputs), [rawInputs]);

  // Append the current live score to the end of the historical timeseries so the
  // chart always shows a line up to today, not just the last walk-forward point (~12m ago).
  const timeseries = useMemo(() => {
    const base = getTimeseries();
    const now  = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // Replace or append current month
    const filtered = base.filter(r => r.date !== currentMonth);
    // Normalize SPX→SPY scale: historical data is in SPY price (~100-800).
    // If the uploaded CSV is SPX (price >999), divide by 10 to match chart scale.
    const rawPrice = spySignals?.priceLatest ?? CURRENT.spyPrice;
    const chartPrice = rawPrice > 999 ? rawPrice / 10 : rawPrice;
    filtered.push({
      date:  currentMonth,
      spy:   chartPrice,
      score: result.compositeScore,
      pred:  result.predFwd12m,
      regime: result.regime,
      inSample: true,   // live point uses the full-sample model
    });
    return filtered;
  }, [result, spySignals]);

  const asOfParts: string[] = [];
  if (liveData) {
    asOfParts.push(`PPI ${liveData.ppi.asOf}`, `Debt ${liveData.margin.asOf}`);
  } else {
    asOfParts.push(CURRENT.asOf);
  }
  if (spySignals)     asOfParts.push(`SPX CSV ${spySignals.asOf}`);
  if (vixSignals)     asOfParts.push(`VIX CSV ${vixSignals.asOf}`);
  if (yieldSignals)   asOfParts.push(`Yield CSV ${yieldSignals.asOf}`);
  if (breadthSignals) asOfParts.push(`Breadth CSV ${breadthSignals.asOf}`);
  const asOf = asOfParts.join(' · ');

  const liveLabel = liveStatus === 'loading' ? '⟳ fetching…'
    : liveStatus === 'error'   ? '⚠ using snapshot'
    : '● live';

  const s = Math.round(result.compositeScore);
  const scoreBadgeCls = s < 20 ? 'badge-bear' : s < 40 ? 'badge-warn' : s < 60 ? 'badge-warn' : 'badge-new';
  const scorePillCls  = s < 40 ? 'badge-bear' : s < 60 ? 'badge-warn' : 'badge-new';
  const scoreLabel    = s < 20 ? 'EXTREME CAUTION' : s < 40 ? 'CAUTIOUS' : s < 60 ? 'NEUTRAL' : s < 80 ? 'BULLISH' : 'STRONG BULL';

  return (
    <>
      <UpdateBanner />
      <div className="header">
        <div className="header-left">
          <h1>SPY COMPOSITE SCORING SYSTEM v5.4</h1>
          <p>
            Sign-constrained Ridge · 3 active signals (RSI, PPI, AAII) · {asOf}
            {' · '}
            <span className={liveStatus === 'ok' ? 'live-dot-ok' : liveStatus === 'error' ? 'live-dot-err' : 'live-dot-loading'}>
              {liveLabel}
            </span>
            {' · '}
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={liveStatus === 'loading'}
              style={{ background: 'none', border: '1px solid var(--text2)', borderRadius: 4, color: 'var(--text2)', cursor: liveStatus === 'loading' ? 'default' : 'pointer', fontSize: '0.75rem', padding: '1px 7px' }}
            >
              {liveStatus === 'loading' ? '⟳' : '↺ refresh'}
            </button>
          </p>
        </div>
        <div className="header-badges">
          <span className={`badge ${scoreBadgeCls}`}>{scoreLabel}</span>
          <span className={`badge ${scorePillCls}`}>
            SCORE {result.compositeScore.toFixed(1)} / 100
          </span>
          <span className="badge badge-warn">
            Ridge {result.predFwd12m >= 0 ? '+' : ''}{(result.predFwd12m*100).toFixed(1)}% 12m
          </span>
          <span className={`badge ${result.vixRegime === 'high_vol' ? 'badge-bear' : 'badge-aaii'}`}>
            {result.regime}
          </span>
        </div>
      </div>

      <div className="main">
        {/* HERO */}
        <div className="hero">
          <Gauge
            score={result.compositeScore}
            asOf={asOf}
            signalCount={7}
          />
          <ForwardReturns bucket={result.bucket} score={result.compositeScore} />
          <AAIICard aaii={aaii} />
          <ExposureCard stance={result.stance} prevExposure="20-40% (v5.1)" composite={result.compositeScore} />
        </div>

        {/* 7-SIGNAL GRID */}
        <div className="section-hdr">
          Seven signals — value · historical percentile · correlation with 12m forward return
          {liveStatus === 'ok' && <span className="live-badge"> PPI · Margin Debt{liveData?.vix ? ' · VIX' : ''} live</span>}
          {spySignals     && <span className="live-badge"> RSI · MFI · Trend from SPX CSV</span>}
          {vixSignals     && <span className="live-badge"> VIX from CSV</span>}
          {yieldSignals   && <span className="live-badge"> Yield curve from CSV</span>}
          {breadthSignals && <span className="live-badge"> Breadth from RSP CSV</span>}
        </div>
        <SubScores signals={result.signals} />

        {/* RIDGE SUMMARY ROW */}
        <div className="pc-summary-row">
          {result.signals.map(s => {
            const contrib = s.ridgeCoef * s.zVal;
            const col = contrib < -0.015 ? 'var(--bear)' : contrib < 0 ? 'var(--warn)' : contrib > 0.015 ? 'var(--bull,#4ade80)' : 'var(--text2)';
            return (
              <div key={s.key} className="pc-summary-card" onClick={() => setTab('math')} style={{ cursor: 'pointer' }}>
                <div className="pc-summary-label">{s.label}</div>
                <div className="pc-summary-value" style={{ color: col }}>
                  {contrib >= 0 ? '+' : ''}{(contrib * 100).toFixed(2)}pp
                </div>
              </div>
            );
          })}
          <div className="pc-summary-card">
            <div className="pc-summary-label">Ridge pred 12m</div>
            <div className="pc-summary-value" style={{ color: result.predFwd12m >= 0 ? 'var(--bull,#4ade80)' : 'var(--bear)' }}>
              {result.predFwd12m >= 0 ? '+' : ''}{(result.predFwd12m * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="tab-bar">
          <button className={`tab-btn ${tab==='buckets'  ?'active':''}`} onClick={()=>setTab('buckets')}>Buckets → Returns</button>
          <button className={`tab-btn ${tab==='history'  ?'active':''}`} onClick={()=>setTab('history')}>Score History</button>
          <button className={`tab-btn ${tab==='strategy' ?'active':''}`} onClick={()=>setTab('strategy')}
            style={{ color: tab==='strategy' ? 'var(--text)' : 'var(--bull,#4ade80)' }}>Strategy A/B</button>
          <button className={`tab-btn ${tab==='aaii'     ?'active':''}`} onClick={()=>setTab('aaii')}
            style={{ color: tab==='aaii' ? 'var(--text)' : 'var(--aaii)' }}>★ AAII</button>
          <button className={`tab-btn ${tab==='buffett'  ?'active':''}`} onClick={()=>setTab('buffett')}>Buffett</button>
          <button className={`tab-btn ${tab==='playbook' ?'active':''}`} onClick={()=>setTab('playbook')}>Playbook</button>
          <button className={`tab-btn ${tab==='math'     ?'active':''}`} onClick={()=>setTab('math')}>Math</button>
          <button className={`tab-btn ${tab==='data'     ?'active':''}`} onClick={()=>setTab('data')}
            style={{ color: tab==='data' ? 'var(--text)' : (spySignals || vixSignals || yieldSignals || breadthSignals) ? 'var(--bull,#4ade80)' : 'var(--aaii)' }}>
            {(spySignals || vixSignals || yieldSignals || breadthSignals) ? '✓ Market Data' : '↑ Market Data'}
          </button>
        </div>

        {tab==='buckets'  && <BucketsPanel currentBucket={result.bucket} predFwd12m={result.predFwd12m} pi80Lo={result.pi80Lo} pi80Hi={result.pi80Hi} pi95Lo={result.pi95Lo} pi95Hi={result.pi95Hi} />}
        {tab==='history'  && <HistoryPanel timeseries={timeseries} />}
        {tab==='strategy' && <StrategyPanel timeseries={timeseries} compositeScore={result.compositeScore} />}
        {tab==='aaii'     && <AAIIPanel aaii={aaii} history={aaiiHistory} />}
        {tab==='buffett'  && <BuffettPanel />}
        {tab==='playbook' && <PlaybookPanel stance={result.stance} />}
        {tab==='math'     && <MathPanel signals={result.signals} composite={result.compositeScore} />}
        {tab==='data'     && (
          <>
            <SpyCsvDrop onSignals={handleSpySignals} initialSignals={spySignals} />
            <VixCsvDrop onSignals={handleVixSignals} initialSignals={vixSignals} />
            <YieldCurveCsvDrop onSignals={handleYieldSignals} initialSignals={yieldSignals} />
            <BreadthCsvDrop
              onSignals={handleBreadthSignals}
              initialSignals={breadthSignals}
              spyReturn12m={spySignals?.return12m ?? null}
            />
          </>
        )}
      </div>

      <footer>
        SPY Composite v5.4 · Sign-constrained Ridge · {asOf} ·
        Active: RSI, PPI, AAII (VIX excluded; MFI/EMA-dist/MDebt auto-pruned) ·
        OOS ρ=0.598 · n=120 predictions · Not a forecast
      </footer>
    </>
  );
}
