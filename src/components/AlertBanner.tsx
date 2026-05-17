import { useState } from 'react';
import { TsRow } from '../lib/scoring';

interface AlertBannerProps {
  score: number;
  timeseries: TsRow[];
}

type BannerType = 'q1_extreme' | 'crossed_defensive' | 'recovery';

interface BannerState {
  type: BannerType;
  color: 'red' | 'amber' | 'green';
  message: string;
}

export function detectBannerState(score: number, timeseries: TsRow[]): BannerState | null {
  const scored = timeseries.filter(r => r.score !== null && r.score !== undefined);
  if (scored.length < 2) return null;

  const prevScore = scored[scored.length - 2].score as number;
  const last6 = scored.slice(-6);
  const prevLow = Math.min(...last6.slice(0, -1).map(r => r.score as number));

  if (score < 20) {
    return {
      type: 'q1_extreme',
      color: 'red',
      message: 'Q1 zone. Historical 12m return at this score: −3.8%, 61% chance of being negative (n=18). Consider tightening stops or reducing exposure.',
    };
  }
  if (prevScore >= 30 && score < 30) {
    return {
      type: 'crossed_defensive',
      color: 'amber',
      message: 'Score dropped into defensive zone this month. This signal preceded the 2022 bear (Dec 2021, score=2.2) and 2011 summer drawdown (Apr 2011, score=13.1).',
    };
  }
  if (score >= 60 && prevScore < 60 && prevLow < 30) {
    return {
      type: 'recovery',
      color: 'green',
      message: 'Recovery from defensive zone. Historical Q4/Q5 forward returns: +15–25% mean.',
    };
  }
  return null;
}

function dismissalKey(type: BannerType, score: number): string {
  return `${type}_${Math.round(score)}`;
}

const colorStyle: Record<'red' | 'amber' | 'green', React.CSSProperties> = {
  red:   { background: 'rgba(239,68,68,0.12)',  borderBottom: '1px solid rgba(239,68,68,0.4)',  color: '#fca5a5' },
  amber: { background: 'rgba(251,191,36,0.10)', borderBottom: '1px solid rgba(251,191,36,0.4)', color: '#fde68a' },
  green: { background: 'rgba(74,222,128,0.10)', borderBottom: '1px solid rgba(74,222,128,0.4)', color: '#bbf7d0' },
};

export function AlertBanner({ score, timeseries }: AlertBannerProps) {
  const banner = detectBannerState(score, timeseries);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return sessionStorage.getItem('alert_banner_dismissed'); } catch { return null; }
  });

  if (!banner) return null;
  const key = dismissalKey(banner.type, score);
  if (dismissed === key) return null;

  const dismiss = () => {
    try { sessionStorage.setItem('alert_banner_dismissed', key); } catch { /* ignore */ }
    setDismissed(key);
  };

  return (
    <div style={{
      ...colorStyle[banner.color],
      padding: '9px 16px',
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      boxSizing: 'border-box',
    }}>
      <span style={{ flex: 1 }}>{banner.message}</span>
      <button
        onClick={dismiss}
        aria-label="Dismiss alert"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'inherit', opacity: 0.6, fontSize: 16, lineHeight: 1, padding: '0 4px',
        }}
      >×</button>
    </div>
  );
}
