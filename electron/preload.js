const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronBridge', {
  // Called when main detects commits available on origin/main
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('update-available', (_event, commitsBehind) => cb(commitsBehind));
  },
  // Step-by-step status during apply: 'pulling' | 'building' | 'done' | 'error'
  onUpdateStatus: (cb) => {
    ipcRenderer.on('update-status', (_event, status) => cb(status));
  },
  onBuildError: (cb) => {
    ipcRenderer.on('build-error', (_event, msg) => cb(msg));
  },
  // Kick off git pull + npm run build
  triggerUpdate: () => {
    ipcRenderer.send('trigger-update');
  },
  // Ask main to re-run git fetch right now
  checkForUpdates: () => {
    ipcRenderer.send('check-updates');
  },
});
