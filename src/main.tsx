import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './index.css';

function showFatalError(msg: string) {
  document.getElementById('root')!.innerHTML =
    `<pre style="color:red;padding:20px;white-space:pre-wrap;font-family:monospace;font-size:12px;background:#111">${msg}</pre>`;
}

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
} catch (e: any) {
  showFatalError('FATAL (mount): ' + (e?.stack ?? e));
}

window.addEventListener('error', (e) => {
  showFatalError('UNCAUGHT: ' + (e.error?.stack ?? e.message));
});
window.addEventListener('unhandledrejection', (e) => {
  showFatalError('UNHANDLED PROMISE: ' + (e.reason?.stack ?? e.reason));
});
