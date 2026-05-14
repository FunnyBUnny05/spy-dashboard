import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { readFileSync } from 'fs';
import { request as httpsRequest } from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

// In dev, projectRoot is the repo itself.
// In production (packaged .app), __dirname is deep inside the bundle, so we
// read the absolute source path that was stamped in at build time.
let projectRoot = join(__dirname, '..');
try {
  const stamped = JSON.parse(readFileSync(join(__dirname, 'source-path.json'), 'utf8'));
  if (stamped.path) projectRoot = stamped.path;
} catch {
  // dev mode or file missing — fall back to relative path
}

let win = null;

// ── helpers ───────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: projectRoot, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// ── update check ──────────────────────────────────────────────────────────────
// On startup (and on request) we do a silent `git fetch`, then compare
// HEAD to origin/main.  If we're behind we fire 'update-available'.

async function checkForUpdates() {
  try {
    await run('git fetch origin main --quiet');
    const behind = await run('git rev-list HEAD..origin/main --count');
    if (parseInt(behind, 10) > 0) {
      send('update-available', behind);
    }
  } catch (err) {
    // No internet, not a git repo, etc. — silently ignore.
    console.warn('Update check skipped:', err.message);
  }
}

// ── window ────────────────────────────────────────────────────────────────────

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

  // Check for remote updates ~3 s after launch (give the window time to load)
  setTimeout(checkForUpdates, 3000);
}

// ── IPC: apply update ─────────────────────────────────────────────────────────
// 1. git pull            → pull latest code
// 2. npm run build       → rebuild the React bundle (dist/)
// 3. reload the window   → pick up the new dist/

ipcMain.on('trigger-update', async () => {
  try {
    send('update-status', 'pulling');
    await run('git pull origin main --ff-only');

    send('update-status', 'building');
    await run('npm run build');

    send('update-status', 'done');
    // Small pause so the user sees "Done" before the reload
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.webContents.reload();
    }, 800);
  } catch (err) {
    send('update-status', 'error');
    send('build-error', err.message);
  }
});

// ── IPC: manual re-check ──────────────────────────────────────────────────────
ipcMain.on('check-updates', () => checkForUpdates());

// ── IPC: proxy fetch (bypasses renderer CORS) ─────────────────────────────────
ipcMain.handle('proxy-fetch', (_event, url) => {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });
});

// ── app lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
