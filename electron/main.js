import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { readFileSync, watch as fsWatch } from 'fs';
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
    // Load from the source tree's dist, not the asar's internal copy, so a
    // fresh `npm run build` in the source repo updates the app live.
    win.loadFile(join(projectRoot, 'dist/index.html'));
  }

  // Watch the source-tree dist/ for rebuilds and auto-reload the window.
  try {
    const distDir = join(projectRoot, 'dist');
    let reloadTimer = null;
    fsWatch(distDir, { recursive: false }, (_event, filename) => {
      if (!filename || !/index\.html$/.test(filename)) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (win && !win.isDestroyed()) win.webContents.reload();
      }, 300);
    });
  } catch (err) {
    console.warn('dist watcher failed:', err.message);
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

// ── IPC: margin debt from FINRA xlsx ──────────────────────────────────────────
// Downloads the xlsx (a ZIP of XML) and parses it via Python, which is always
// available on macOS. Returns JSON array [{date, margin_debt}] newest-first.
ipcMain.handle('fetch-margin-data', () => {
  const python = `
import urllib.request, zipfile, io, re, json, sys
url = 'https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
data = urllib.request.urlopen(req, timeout=15).read()
with zipfile.ZipFile(io.BytesIO(data)) as z:
    sheet = z.read('xl/worksheets/sheet1.xml').decode()
rows = re.findall(r'<row[^>]*r="(\\d+)"[^>]*>(.*?)</row>', sheet, re.DOTALL)
result = []
for rnum, row in rows[1:]:  # skip header
    cells = re.findall(r'<c r="([^"]+)"[^>]*(?:t="([^"]*)")?>[^<]*(?:<v>([^<]*)</v>)?(?:<is><t>([^<]*)</t>)?', row)
    rd = {}
    for ref, t, v, iv in cells:
        rd[re.sub(r'\\d','',ref)] = v or iv
    if 'A' in rd and 'B' in rd:
        result.append({'date': rd['A'], 'margin_debt': int(float(rd['B']))})
print(json.dumps(result))
`;
  return new Promise((resolve, reject) => {
    exec(`python3 << 'PYEOF'\n${python}\nPYEOF`, { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
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
