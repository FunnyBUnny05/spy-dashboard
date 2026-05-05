const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronBridge', {
  onSourceChanged: (cb) => {
    ipcRenderer.on('source-changed', () => cb());
  },
  onBuildComplete: (cb) => {
    ipcRenderer.on('build-complete', () => cb());
  },
  onBuildError: (cb) => {
    ipcRenderer.on('build-error', (_event, msg) => cb(msg));
  },
  triggerUpdate: () => {
    ipcRenderer.send('trigger-update');
  },
});
