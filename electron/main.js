import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const chokidar = require('chokidar');

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const isDev = process.env.NODE_ENV === 'development';

let win = null;
let debounceTimer = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'));
  }

  startWatcher();
}

function startWatcher() {
  const srcDir = join(projectRoot, 'src');
  let watcher;

  try {
    watcher = chokidar.watch(srcDir, { ignoreInitial: true });
  } catch (err) {
    console.warn('Could not start file watcher:', err.message);
    return;
  }

  watcher.on('all', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('source-changed');
      }
    }, 500);
  });

  app.on('before-quit', () => watcher.close());
}

ipcMain.on('trigger-update', () => {
  exec('npm run build', { cwd: projectRoot }, (err, _stdout, stderr) => {
    if (err) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('build-error', stderr || err.message);
      }
      return;
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send('build-complete');
      win.webContents.reload();
    }
  });
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
