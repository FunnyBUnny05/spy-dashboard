import { useState, useMemo, useEffect } from 'react';
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

import { Gauge }         from './components/Gauge';
import { ForwardReturns } from './components/ForwardReturns';
import { AAIICard }      from './components/AAIICard';
import { ExposureCard }  from './components/ExposureCard';
import { SubScores }     from './components/SubScores';
import { BucketsPanel }  from './components/BucketsPanel';
import { HistoryPanel }  from './components/HistoryPanel';
import { BuffettPanel }  from './components/BuffettPanel';
import { AAIIPanel }     from './components/AAIIPanel';
import { PlaybookPanel } from './components/PlaybookPanel';
import { MathPanel }     from './components/MathPanel';
import { PCAPanel }      from './components/PCAPanel';
import { UpdateBanner }  from './components/UpdateBanner';

type TabId = 'buckets' | 'pca' | 'history' | 'buffett' | 'aaii' | 'playbook' | 'math' | 'data';

export default function App() {
  const [tab, setTab] = useState<TabId>('buckets');

  // AAII (bundled JSON)
  const { history: aaiiHistory, stats: aaiiStats } = useMemo(() => getAAIIData(), []);
  const aaii = useMemo(() => scoreAAII(aaiiHistory, aaiiStats), [aaiiHistory, aaiiStats]);

  // Live data: PPI, margin debt, Buffett
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [liveStatus, setLiveStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    fetchLiveData()
      .then(d  => { if (!cancelled) { setLiveData(d);  setLiveStatus('ok');    }})
      .catch(() => { if (!cancelled) setLiveStatus('error'); });
    return () => { cancelled = true; };
  }, []);

  // SPY CSV → replace RSI/MFI/trend signals
  const [spySignals, setSpySignals] = useState<SpySignals | null>(null);

  // Build raw signal inputs — live/csv override snapshot
  const rawInputs: RawSignalValues = useMemo(() => ({
    rsi14m:     spySignals?.rsi14   ?? CURRENT.rsi14m,
    mfi14m:     spySignals?.mfi14   ?? CURRENT.mfi14m,
    emaDistPct: spySignals?.ema50w  ?? CURRENT.emaDistPct,
    ppiYoy:     liveData?.ppi.latest.yoy          ?? CURRENT.ppiYoy,
    mdebtYoy:   liveData?.margin.latest.yoy_growth ?? CURRENT.mdebtYoy,
    aaiiSpread: aaii.spread,
    vixClose:   CURRENT.vixClose,
  }), [spySignals, liveData, aaii]);

  const result     = useMemo(() => computeV2(rawInputs), [rawInputs]);
  const timeseries = useMemo(() => getTimeseries(), []);

  const asOfParts: string[] = [];
  if (liveData) {
    asOfParts.push(`PPI ${liveData.ppi.asOf}`, `Debt ${liveData.margin.asOf}`);
  } else {
    asOfParts.push(CURRENT.asOf);
  }
  if (spySignals) asOfParts.push(`CSV ${spySignals.asOf}`);
  const asOf = asOfParts.join(' · ');

  const liveLabel = liveStatus === 'loading' ? '⟳ fetching…'
    : liveStatus === 'error'   ? '⚠ using snapshot'
    : '● live';

  const s = Math.round(result.compositeScore);
  const scoreBadgeCls = s < 20 ? 'badge-bear' : s < 40 ? 'badge-warn' : s < 60 ? 'badge-warn' : 'badge-new';
  const scoreLabel    = s < 20 ? 'EXTREME CAUTION' : s < 40 ? 'CAUTIOUS' : s < 60 ? 'NEUTRAL' : s < 80 ? 'BULLISH' : 'STRONG BULL';

  return (
    <>
      <UpdateBanner />
      <div className="header">
        <div className="header-left">
          <h1>SPY COMPOSITE SCORING SYSTEM v4</h1>
          <p>
            PCA + walk-forward OLS · 7 signals · {asOf}
            {' · '}
            <span className={liveStatus === 'ok' ? 'live-dot-ok' : liveStatus === 'error' ? 'live-dot-err' : 'live-dot-loading'}>
              {liveLabel}
            </span>
          </p>
        </div>
        <div className="header-badges">
          <span className={`badge ${scoreBadgeCls}`}>{scoreLabel}</span>
          <span className={`badge ${s < 40 ? 'badge-bear' : 'badge-warn'}`}>
            SCORE {result.compositeScore.toFixed(1)} / 100
          </span>
          <span className="badge badge-warn">
            OLS {result.predFwd12m >= 0 ? '+' : ''}{(result.predFwd12m*100).toFixed(1)}% 12m
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
            delta={{ value: result.compositeScore - 29.1, vsLabel: 'vs v3 (29.1)' }}
          />
          <ForwardReturns bucket={result.bucket} />
          <AAIICard aaii={aaii} />
          <ExposureCard stance={result.stance} prevExposure="20-40% (v3)" composite={result.compositeScore} />
        </div>

        {/* 7-SIGNAL GRID */}
        <div className="section-hdr">
          Seven signals — value · historical percentile · correlation with 12m forward return
          {liveStatus === 'ok' && <span className="live-badge"> PPI &amp; Margin Debt live</span>}
          {spySignals          && <span className="live-badge"> RSI · MFI · Trend from CSV</span>}
        </div>
        <SubScores signals={result.signals} />

        {/* PC SUMMARY ROW */}
        <div className="pc-summary-row">
          {([
            ['PC1 Momentum/Risk',  result.pc1, '55%'],
            ['PC2 Inflation/Fear', result.pc2, '19%'],
            ['PC3 Cross-currents', result.pc3, '11%'],
          ] as [string, number, string][]).map(([label, value, pct]) => {
            const col = value > 1.5 ? 'var(--bear)' : value > 0.75 ? 'var(--warn)' : value < -1 ? 'var(--bull,#4ade80)' : 'var(--text2)';
            return (
              <div key={label} className="pc-summary-card" onClick={() => setTab('pca')} style={{ cursor: 'pointer' }}>
                <div className="pc-summary-label">{label} <span style={{ color: 'var(--text3)' }}>{pct}</span></div>
                <div className="pc-summary-value" style={{ color: col }}>
                  {value >= 0 ? '+' : ''}{value.toFixed(2)}σ
                </div>
              </div>
            );
          })}
          <div className="pc-summary-card">
            <div className="pc-summary-label">OLS predicted 12m</div>
            <div className="pc-summary-value" style={{ color: result.predFwd12m >= 0 ? 'var(--bull,#4ade80)' : 'var(--bear)' }}>
              {result.predFwd12m >= 0 ? '+' : ''}{(result.predFwd12m*100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="tab-bar">
          <button className={`tab-btn ${tab==='buckets'  ?'active':''}`} onClick={()=>setTab('buckets')}>Buckets → Returns</button>
          <button className={`tab-btn ${tab==='pca'      ?'active':''}`} onClick={()=>setTab('pca')}>PCA Detail</button>
          <button className={`tab-btn ${tab==='history'  ?'active':''}`} onClick={()=>setTab('history')}>Score History</button>
          <button className={`tab-btn ${tab==='aaii'     ?'active':''}`} onClick={()=>setTab('aaii')}
            style={{ color: tab==='aaii' ? 'var(--text)' : 'var(--aaii)' }}>★ AAII</button>
          <button className={`tab-btn ${tab==='buffett'  ?'active':''}`} onClick={()=>setTab('buffett')}>Buffett</button>
          <button className={`tab-btn ${tab==='playbook' ?'active':''}`} onClick={()=>setTab('playbook')}>Playbook</button>
          <button className={`tab-btn ${tab==='math'     ?'active':''}`} onClick={()=>setTab('math')}>Math</button>
          <button className={`tab-btn ${tab==='data'     ?'active':''}`} onClick={()=>setTab('data')}
            style={{ color: tab==='data' ? 'var(--text)' : spySignals ? 'var(--bull,#4ade80)' : 'var(--aaii)' }}>
            {spySignals ? '✓ SPY Data' : '↑ SPY Data'}
          </button>
        </div>

        {tab==='buckets'  && <BucketsPanel currentBucket={result.bucket} predFwd12m={result.predFwd12m} pi80Lo={result.pi80Lo} pi80Hi={result.pi80Hi} pi95Lo={result.pi95Lo} pi95Hi={result.pi95Hi} />}
        {tab==='pca'      && <PCAPanel pc1={result.pc1} pc2={result.pc2} pc3={result.pc3} regime={result.regime} />}
        {tab==='history'  && <HistoryPanel timeseries={timeseries} />}
        {tab==='aaii'     && <AAIIPanel aaii={aaii} history={aaiiHistory} />}
        {tab==='buffett'  && <BuffettPanel />}
        {tab==='playbook' && <PlaybookPanel stance={result.stance} />}
        {tab==='math'     && <MathPanel signals={result.signals} composite={result.compositeScore} />}
        {tab==='data'     && <SpyCsvDrop onSignals={setSpySignals} />}
      </div>

      <footer>
        SPY Composite v4 · PCA + walk-forward OLS · {asOf} ·
        Signals: RSI, MFI, EMA dist, PPI, Margin Debt, AAII, VIX ·
        OOS ρ=0.44 · n=145 predictions · Not a forecast
      </footer>
    </>
  );
}
