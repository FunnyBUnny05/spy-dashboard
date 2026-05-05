import { useState, useMemo } from 'react';
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

type TabId = 'buckets' | 'history' | 'buffett' | 'aaii' | 'playbook' | 'math';

export default function App() {
  const [tab, setTab] = useState<TabId>('buckets');

  const { history, stats } = useMemo(() => getAAIIData(), []);
  const aaii = useMemo(() => scoreAAII(history, stats), [history, stats]);

  const signals: SignalSpec[] = useMemo(
    () => [
      { key: 'mfi',     label: 'MFI',             weight: WEIGHTS.mfi,     ...CURRENT.signals.mfi },
      { key: 'ppi',     label: 'PPI',             weight: WEIGHTS.ppi,     ...CURRENT.signals.ppi },
      { key: 'mdebt',   label: 'Margin debt',     weight: WEIGHTS.mdebt,   ...CURRENT.signals.mdebt },
      { key: 'trend',   label: 'Trend / EMA50W',  weight: WEIGHTS.trend,   ...CURRENT.signals.trend },
      { key: 'obv',     label: 'OBV divergence',  weight: WEIGHTS.obv,     ...CURRENT.signals.obv },
      { key: 'rsi',     label: 'RSI',             weight: WEIGHTS.rsi,     ...CURRENT.signals.rsi },
      { key: 'buffett', label: 'Buffett',         weight: WEIGHTS.buffett, ...CURRENT.signals.buffett, isNew: false },
      {
        key: 'aaii',
        label: 'AAII',
        weight: WEIGHTS.aaii,
        score: aaii.score,
        raw: aaii.raw,
        desc: aaii.desc,
        isNew: true,
      },
    ],
    [aaii]
  );

  const composite = useMemo(() => computeComposite(signals), [signals]);
  const v2Composite = 29.1; // Anchor from the v2 dashboard for delta display
  const bucket = useMemo(() => bucketFor(composite), [composite]);
  const stance = useMemo(() => stanceFor(composite), [composite]);

  return (
    <>
      <UpdateBanner />
      <div className="header">
        <div className="header-left">
          <h1>SPY COMPOSITE SCORING SYSTEM v3</h1>
          <p>8-signal benchmark · AAII added · Verified math · {CURRENT.asOf}</p>
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
            asOf={CURRENT.asOf}
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
            Math & Weights
          </button>
        </div>

        {tab === 'buckets'  && <BucketsPanel currentBucket={bucket} />}
        {tab === 'history'  && <HistoryPanel />}
        {tab === 'aaii'     && <AAIIPanel aaii={aaii} history={history} />}
        {tab === 'buffett'  && <BuffettPanel />}
        {tab === 'playbook' && <PlaybookPanel stance={stance} />}
        {tab === 'math'     && <MathPanel signals={signals} composite={composite} />}
      </div>

      <footer>
        SPY Composite Scoring v3 · Generated {CURRENT.asOf} · Data: SPY weekly (1993-Apr 2026), PPI
        (2010-Mar 2026), Margin Debt (1998-Mar 2026), Buffett (1971-Q1 2025), AAII Asset Allocation
        ({aaii.stats.first_date} to {aaii.stats.last_date}) · All forward returns are historical -
        not a forecast
      </footer>
    </>
  );
}
