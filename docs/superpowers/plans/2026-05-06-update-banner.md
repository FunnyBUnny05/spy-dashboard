# Update Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an "Update available" button in the top-left of the Electron app whenever source files in `src/` change, and rebuild + reload the app when the user clicks it.

**Architecture:** `chokidar` in `electron/main.js` watches `src/`, debounced 500ms, sends `source-changed` IPC to renderer. `electron/preload.js` bridges IPC events and actions to `window.electronBridge`. `src/components/UpdateBanner.tsx` listens via the bridge and renders the banner UI (idle → available → building → error). `App.tsx` mounts `<UpdateBanner />` as first child.

**Tech Stack:** chokidar 3, Electron IPC (ipcMain / ipcRenderer / contextBridge), React 18, TypeScript

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `electron/main.js` | chokidar watcher, IPC send/receive, spawn build, reload |
| Modify | `electron/preload.js` | contextBridge — expose `window.electronBridge` |
| Create | `src/components/UpdateBanner.tsx` | Banner UI — idle/available/building/error states |
| Modify | `src/App.tsx` | Mount `<UpdateBanner />` as first child |

---

## Task 1: Install chokidar

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install chokidar**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
npm install --save-dev chokidar@3
```

Expected: `chokidar` appears in `devDependencies` in `package.json`.

- [ ] **Step 2: Verify**

```bash
node -e "import('chokidar').then(m => console.log('chokidar ok', m.default.watch))"
```

Expected: prints `chokidar ok [Function: watch]`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add chokidar for source file watching"
```

---

## Task 2: Update preload.js to expose electronBridge

**Files:**
- Modify: `electron/preload.js`

The preload script runs in a privileged context and bridges IPC to the renderer via `contextBridge`. The renderer can only call what is explicitly exposed here — `nodeIntegration` is off.

- [ ] **Step 1: Replace `electron/preload.js` with the full bridge**

```javascript
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
```

Note: preload.js uses CommonJS `require` even though the project uses `"type": "module"` — Electron preload scripts always run in CommonJS context regardless of package type.

- [ ] **Step 2: Verify syntax**

```bash
node --check /Users/adamariel/Downloads/spy-dashboard/electron/preload.js 2>&1 || echo "syntax error"
```

Expected: no output (no syntax errors). If you see "require is not defined", the file is being parsed as ESM — confirm the file uses `require`, not `import`.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.js
git commit -m "feat: expose electronBridge via contextBridge in preload"
```

---

## Task 3: Update electron/main.js with watcher + IPC handler

**Files:**
- Modify: `electron/main.js`

The watcher starts after the window is created. It watches `src/` relative to the project root (one level above `electron/`). A 500ms debounce prevents rapid-fire events from multiple saves. The build runs with `child_process.exec` using the project root as `cwd`.

- [ ] **Step 1: Replace `electron/main.js` with the full updated version**

```javascript
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
```

- [ ] **Step 2: Verify syntax**

```bash
node --input-type=module --check < /Users/adamariel/Downloads/spy-dashboard/electron/main.js 2>&1 || echo "syntax error above"
```

Expected: no output (clean). If there's an error, fix before proceeding.

- [ ] **Step 3: Commit**

```bash
git add electron/main.js
git commit -m "feat: add chokidar watcher and IPC build trigger in main process"
```

---

## Task 4: Create UpdateBanner component

**Files:**
- Create: `src/components/UpdateBanner.tsx`

The component guards against the absence of `window.electronBridge` (browser dev mode has no bridge). States: `idle` → renders nothing. `available` → blue banner + Update button. `building` → same banner, spinner text, button disabled. `error` → red banner with message + Retry button.

- [ ] **Step 1: Create `src/components/UpdateBanner.tsx`**

```tsx
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
```

- [ ] **Step 2: Check TypeScript compiles**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors. If errors appear, fix them before committing.

- [ ] **Step 3: Commit**

```bash
git add src/components/UpdateBanner.tsx
git commit -m "feat: add UpdateBanner component"
```

---

## Task 5: Mount UpdateBanner in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add import at the top of `src/App.tsx`**

After the existing imports (around line 26), add:

```tsx
import { UpdateBanner } from './components/UpdateBanner';
```

- [ ] **Step 2: Mount the banner as the first child inside the fragment**

The return in `App.tsx` currently starts with `<>`. Add `<UpdateBanner />` as the very first line inside it, before the `<div className="header">`:

```tsx
  return (
    <>
      <UpdateBanner />
      <div className="header">
```

- [ ] **Step 3: Verify TypeScript still compiles**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Run the Vite build to confirm no bundling errors**

```bash
npm run build 2>&1 | tail -10
```

Expected: `✓ built in` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: mount UpdateBanner in App"
```

---

## Task 6: Rebuild the Electron app and install to Desktop

**Files:**
- No source changes — packaging step

- [ ] **Step 1: Run the full Electron build**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
npm run build:app 2>&1 | tail -15
```

Expected: `dist-app/mac-arm64/SPY Dashboard.app` created with no errors.

- [ ] **Step 2: Install to Desktop**

```bash
bash scripts/install-desktop.sh
```

Expected:
```
Installed: /Users/adamariel/Desktop/SPY Dashboard.app
Double-click 'SPY Dashboard' on your Desktop to open.
```

- [ ] **Step 3: Launch the app**

```bash
open ~/Desktop/"SPY Dashboard.app"
```

- [ ] **Step 4: Trigger a source change to verify the banner appears**

Edit any file in `src/` — for example, add and immediately remove a space in `src/App.tsx`, then save. Within 1 second, the "Update available" banner should appear at top-left of the Electron window.

- [ ] **Step 5: Click Update and verify the app rebuilds and reloads**

Click the Update button. The banner changes to "Building…" for ~5-10 seconds, then the window reloads and the banner disappears.

- [ ] **Step 6: Final commit**

```bash
git add -A
git status
git commit -m "feat: update banner — detects src changes and rebuilds in-app"
```
