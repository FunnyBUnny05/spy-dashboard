import { useState, useMemo, useEffect } from 'react';
import './lib/chartSetup'; // Register Chart.js once

import { CURRENT } from './lib/snapshot';
import {
  WEIGHTS,
  computeComposite,
  scoreAAII,
  getAAIIData,
  bucketFor,
  stanceFor,
  type SignalSpec,
} from './lib/scoring';
import { fetchLiveData, type LiveData } from './lib/liveData';
import { SpyCsvDrop, scoreFromSpySignals, type SpySignals } from './components/SpyCsvDrop';

import { Gauge } from './components/Gauge';
import { ForwardReturns } from './components/ForwardReturns';
import { AAIICard } from './components/AAIICard';
import { ExposureCard } from './components/ExposureCard';
import { SubScores } from './components/SubScores';
import { BucketsPanel } from './components/BucketsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { BuffettPanel } from './components/BuffettPanel';
import { AAIIPanel } from './components/AAIIPanel';
import { PlaybookPanel } from './components/PlaybookPanel';
import { MathPanel } from './components/MathPanel';
import { UpdateBanner } from './components/UpdateBanner';

type TabId = 'buckets' | 'history' | 'buffett' | 'aaii' | 'playbook' | 'math' | 'data';

export default function App() {
  const [tab, setTab] = useState<TabId>('buckets');

  // ── AAII (bundled JSON, updated at build time) ────────────────────────────
  const { history, stats } = useMemo(() => getAAIIData(), []);
  const aaii = useMemo(() => scoreAAII(history, stats), [history, stats]);

  // ── Live data: PPI, margin debt, Buffett ─────────────────────────────────
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [liveStatus, setLiveStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetchLiveData()
      .then((d) => { if (!cancelled) { setLiveData(d); setLiveStatus('ok'); } })
      .catch(() => { if (!cancelled) setLiveStatus('error'); });
    return () => { cancelled = true; };
  }, []);

  // ── SPY CSV signals ───────────────────────────────────────────────────────
  const [spySignals, setSpySignals] = useState<SpySignals | null>(null);
  const csvScores = useMemo(() => spySignals ? scoreFromSpySignals(spySignals) : null, [spySignals]);

  // ── Build signal specs (live data overrides snapshot when available) ──────
  const ppi = liveData?.ppi ?? { score: CURRENT.signals.ppi.score, raw: CURRENT.signals.ppi.raw, desc: CURRENT.signals.ppi.desc };
  const mdebt = liveData?.margin ?? { score: CURRENT.signals.mdebt.score, raw: CURRENT.signals.mdebt.raw, desc: CURRENT.signals.mdebt.desc };
  const buffett = liveData?.buffett ?? { score: CURRENT.signals.buffett.score, raw: CURRENT.signals.buffett.raw, desc: CURRENT.signals.buffett.desc };

  // Snapshot "as of" date
  const asOf = liveData
    ? `PPI ${liveData.ppi.asOf} · Debt ${liveData.margin.asOf}`
    : CURRENT.asOf;

  const signals: SignalSpec[] = useMemo(
    () => [
      {
        key: 'mfi', label: 'MFI', weight: WEIGHTS.mfi,
        score: csvScores?.mfiScore   ?? CURRENT.signals.mfi.score,
        raw:   spySignals ? `${spySignals.mfi14.toFixed(1)} MFI` : CURRENT.signals.mfi.raw,
        desc:  spySignals ? (spySignals.mfi14 > 70 ? 'Overbought' : spySignals.mfi14 < 30 ? 'Oversold' : 'Neutral') : CURRENT.signals.mfi.desc,
      },
      {
        key: 'ppi', label: 'PPI', weight: WEIGHTS.ppi,
        score: ppi.score, raw: ppi.raw, desc: ppi.desc,
      },
      {
        key: 'mdebt', label: 'Margin debt', weight: WEIGHTS.mdebt,
        score: mdebt.score, raw: mdebt.raw, desc: mdebt.desc,
      },
      {
        key: 'trend', label: 'Trend / EMA50W', weight: WEIGHTS.trend,
        score: csvScores?.trendScore  ?? CURRENT.signals.trend.score,
        raw:   spySignals ? `${spySignals.ema50w >= 0 ? '+' : ''}${spySignals.ema50w.toFixed(2)}% above EMA50W` : CURRENT.signals.trend.raw,
        desc:  spySignals ? (Math.abs(spySignals.ema50w) < 5 ? 'Near trend' : spySignals.ema50w > 0 ? 'Extended above trend' : 'Below trend') : CURRENT.signals.trend.desc,
      },
      {
        key: 'obv', label: 'OBV divergence', weight: WEIGHTS.obv,
        score: csvScores?.obvScore    ?? CURRENT.signals.obv.score,
        raw:   spySignals ? `${spySignals.obv3m >= 0 ? '+' : ''}${spySignals.obv3m.toFixed(1)}% 3m` : CURRENT.signals.obv.raw,
        desc:  spySignals ? (spySignals.obv3m < -5 ? 'Distribution detected' : spySignals.obv3m > 5 ? 'Accumulation' : 'Neutral') : CURRENT.signals.obv.desc,
      },
      {
        key: 'rsi', label: 'RSI', weight: WEIGHTS.rsi,
        score: csvScores?.rsiScore    ?? CURRENT.signals.rsi.score,
        raw:   spySignals ? `${spySignals.rsi14.toFixed(1)} RSI` : CURRENT.signals.rsi.raw,
        desc:  spySignals ? (spySignals.rsi14 > 70 ? 'Overbought' : spySignals.rsi14 < 30 ? 'Oversold' : 'Neutral range') : CURRENT.signals.rsi.desc,
      },
      {
        key: 'buffett', label: 'Buffett', weight: WEIGHTS.buffett,
        score: buffett.score, raw: buffett.raw, desc: buffett.desc,
      },
      {
        key: 'aaii', label: 'AAII', weight: WEIGHTS.aaii,
        score: aaii.score, raw: aaii.raw, desc: aaii.desc,
        isNew: true,
      },
    ],
    [ppi, mdebt, buffett, aaii, csvScores, spySignals]
  );

  const composite = useMemo(() => computeComposite(signals), [signals]);
  const v2Composite = 29.1;
  const bucket = useMemo(() => bucketFor(composite), [composite]);
  const stance = useMemo(() => stanceFor(composite), [composite]);

  const liveLabel = liveStatus === 'loading' ? '⟳ fetching live data…'
    : liveStatus === 'error' ? '⚠ live fetch failed — using snapshot'
    : '● live';

  return (
    <>
      <UpdateBanner />
      <div className="header">
        <div className="header-left">
          <h1>SPY COMPOSITE SCORING SYSTEM v3</h1>
          <p>
            8-signal benchmark · AAII added · {asOf}
            {' · '}
            <span className={liveStatus === 'ok' ? 'live-dot-ok' : liveStatus === 'error' ? 'live-dot-err' : 'live-dot-loading'}>
              {liveLabel}
            </span>
            {spySignals && <span className="live-dot-ok"> · CSV {spySignals.asOf}</span>}
          </p>
        </div>
        <div className="header-badges">
          <span className={`badge ${composite < 30 ? 'badge-bear' : composite < 50 ? 'badge-warn' : 'badge-new'}`}>
            {composite < 30 ? 'EXTREME CAUTION' : composite < 40 ? 'CAUTION' : composite < 50 ? 'BELOW AVG' : composite < 60 ? 'ABOVE AVG' : composite < 70 ? 'GOOD' : 'STRONG'}
          </span>
          <span className={`badge ${composite < 30 ? 'badge-bear' : 'badge-warn'}`}>
            SCORE {composite.toFixed(1)} / 100
          </span>
          <span className={`badge ${aaii.flag.startsWith('extreme') ? 'badge-bear' : 'badge-warn'}`}>
            AAII Z {aaii.zSpread >= 0 ? '+' : ''}{aaii.zSpread.toFixed(2)}σ
          </span>
          <span className="badge badge-aaii">v3 · AAII added</span>
        </div>
      </div>

      <div className="main">
        {/* HERO ROW */}
        <div className="hero">
          <Gauge
            score={composite}
            asOf={asOf}
            signalCount={8}
            delta={{ value: composite - v2Composite, vsLabel: 'vs v2 (29.1)' }}
          />
          <ForwardReturns bucket={bucket} />
          <AAIICard aaii={aaii} />
          <ExposureCard stance={stance} prevExposure="20-40% (v2)" composite={composite} />
        </div>

        {/* SUB-SCORES */}
        <div className="section-hdr">
          Eight sub-scores (0-100, higher = more bullish)
          {liveStatus === 'ok' && <span className="live-badge"> PPI &amp; Margin Debt live</span>}
          {spySignals && <span className="live-badge"> MFI · Trend · OBV · RSI from CSV</span>}
        </div>
        <SubScores signals={signals} />

        {/* TABS */}
        <div className="tab-bar">
          <button className={`tab-btn ${tab === 'buckets' ? 'active' : ''}`} onClick={() => setTab('buckets')}>
            Buckets → Returns
          </button>
          <button className={`tab-btn ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
            Score History
          </button>
          <button className={`tab-btn ${tab === 'aaii' ? 'active' : ''}`} onClick={() => setTab('aaii')} style={{ color: tab === 'aaii' ? 'var(--text)' : 'var(--aaii)' }}>
            ★ AAII Detail
          </button>
          <button className={`tab-btn ${tab === 'buffett' ? 'active' : ''}`} onClick={() => setTab('buffett')}>
            Buffett Detail
          </button>
          <button className={`tab-btn ${tab === 'playbook' ? 'active' : ''}`} onClick={() => setTab('playbook')}>
            Action Playbook
          </button>
          <button className={`tab-btn ${tab === 'math' ? 'active' : ''}`} onClick={() => setTab('math')}>
            Math &amp; Weights
          </button>
          <button
            className={`tab-btn ${tab === 'data' ? 'active' : ''}`}
            onClick={() => setTab('data')}
            style={{ color: tab === 'data' ? 'var(--text)' : spySignals ? 'var(--bull, #4ade80)' : 'var(--aaii)' }}
          >
            {spySignals ? '✓ SPY Data' : '↑ SPY Data'}
          </button>
        </div>

        {tab === 'buckets'  && <BucketsPanel currentBucket={bucket} />}
        {tab === 'history'  && <HistoryPanel />}
        {tab === 'aaii'     && <AAIIPanel aaii={aaii} history={history} />}
        {tab === 'buffett'  && <BuffettPanel />}
        {tab === 'playbook' && <PlaybookPanel stance={stance} />}
        {tab === 'math'     && <MathPanel signals={signals} composite={composite} />}
        {tab === 'data'     && <SpyCsvDrop onSignals={setSpySignals} />}
      </div>

      <footer>
        SPY Composite Scoring v3 · {asOf} · Data: SPY weekly (CSV), PPI &amp; Margin Debt (live from
        stock-sentinel), Buffett (live), AAII Asset Allocation ({aaii.stats.first_date} to {aaii.stats.last_date}) · All forward returns are historical — not a forecast
      </footer>
    </>
  );
}
