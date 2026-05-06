import { useEffect, useState } from 'react';

type State = 'idle' | 'available' | 'pulling' | 'building' | 'done' | 'error';

export function UpdateBanner() {
  const [state, setState]               = useState<State>('idle');
  const [commitsBehind, setCommitsBehind] = useState(0);
  const [errorMsg, setErrorMsg]         = useState('');

  useEffect(() => {
    const bridge = (window as any).electronBridge;
    if (!bridge) return;

    bridge.onUpdateAvailable((n: number) => {
      setCommitsBehind(n);
      setState('available');
    });

    bridge.onUpdateStatus((status: string) => {
      if (status === 'pulling')  setState('pulling');
      if (status === 'building') setState('building');
      if (status === 'done')     setState('done');
      if (status === 'error')    setState('error');
    });

    bridge.onBuildError((msg: string) => {
      setErrorMsg(msg);
      setState('error');
    });
  }, []);

  function applyUpdate() {
    const bridge = (window as any).electronBridge;
    if (!bridge) return;
    setState('pulling');
    bridge.triggerUpdate();
  }

  function dismiss() {
    setState('idle');
  }

  if (state === 'idle') return null;

  const busy    = state === 'pulling' || state === 'building';
  const isError = state === 'error';
  const isDone  = state === 'done';

  const statusText =
    state === 'available' ? `Update available — ${commitsBehind} new commit${commitsBehind !== 1 ? 's' : ''}` :
    state === 'pulling'   ? 'Pulling latest code…' :
    state === 'building'  ? 'Building… (~15 s)' :
    state === 'done'      ? '✓ Done — reloading' :
    `Update failed: ${errorMsg.slice(0, 100)}`;

  return (
    <div style={{
      position: 'fixed',
      top: 12,
      left: 12,
      zIndex: 9999,
      background: isError ? '#7f1d1d' : isDone ? '#14532d' : '#1e3a5f',
      color: '#fff',
      borderRadius: 6,
      padding: '8px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13,
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      maxWidth: 440,
    }}>
      {busy && <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>}
      <span style={{ flex: 1 }}>{statusText}</span>

      {state === 'available' && (
        <button onClick={applyUpdate} style={btn('#3b82f6')}>Update now</button>
      )}
      {isError && (
        <>
          <button onClick={applyUpdate} style={btn('#ef4444')}>Retry</button>
          <button onClick={dismiss}     style={btn('#6b7280')}>Dismiss</button>
        </>
      )}
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none', borderRadius: 4,
    padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    whiteSpace: 'nowrap',
  };
}
