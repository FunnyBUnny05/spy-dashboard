import { useEffect, useState } from 'react';

type State = 'idle' | 'available' | 'building' | 'error';

export function UpdateBanner() {
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const bridge = (window as any).electronBridge;
    if (!bridge) return;

    bridge.onSourceChanged(() => setState(s => s === 'building' ? s : 'available'));
    bridge.onBuildComplete(() => setState('idle'));
    bridge.onBuildError((msg: string) => {
      setErrorMsg(msg);
      setState('error');
    });
  }, []);

  function triggerUpdate() {
    const bridge = (window as any).electronBridge;
    if (!bridge) return;
    setState('building');
    bridge.triggerUpdate();
  }

  if (state === 'idle') return null;

  const isError = state === 'error';

  return (
    <div style={{
      position: 'fixed',
      top: 12,
      left: 12,
      zIndex: 9999,
      background: isError ? '#7f1d1d' : '#1e3a5f',
      color: '#fff',
      borderRadius: 6,
      padding: '8px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13,
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    }}>
      <span>
        {state === 'available' && 'Update available'}
        {state === 'building' && 'Building…'}
        {state === 'error' && `Build failed: ${errorMsg.slice(0, 80)}`}
      </span>
      <button
        onClick={triggerUpdate}
        disabled={state === 'building'}
        style={{
          background: isError ? '#ef4444' : '#3b82f6',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '4px 10px',
          cursor: state === 'building' ? 'not-allowed' : 'pointer',
          opacity: state === 'building' ? 0.6 : 1,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {state === 'error' ? 'Retry' : 'Update'}
      </button>
    </div>
  );
}
