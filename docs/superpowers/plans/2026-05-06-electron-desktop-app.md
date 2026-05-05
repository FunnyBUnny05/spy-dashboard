# Electron Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing Vite/React SPY Dashboard in Electron and package it as a macOS `.app` with a double-clickable Desktop launcher.

**Architecture:** Electron's main process creates a BrowserWindow that loads the Vite-built `dist/index.html` via `file://`. electron-builder packages Electron + the built assets into `dist-app/mac/SPY Dashboard.app`. A shell script copies the `.app` to `~/Desktop`.

**Tech Stack:** Electron 30, electron-builder 24, concurrently (dev), existing Vite 5 + React 18

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `electron/main.js` | BrowserWindow lifecycle, load dist/index.html |
| Create | `electron/preload.js` | Empty preload (security boundary) |
| Create | `scripts/install-desktop.sh` | Copy .app to ~/Desktop |
| Modify | `package.json` | Add main, deps, scripts, build config |
| Modify | `vite.config.ts` | Set `base: './'` so file:// paths resolve |

---

## Task 1: Install Electron dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install devDependencies**

```bash
cd /Users/adamariel/Downloads/spy-dashboard
npm install --save-dev electron@30 electron-builder@24 concurrently@8
```

Expected output: added packages, no errors. `package-lock.json` updated.

- [ ] **Step 2: Verify install**

```bash
npx electron --version
```

Expected output: `v30.x.x`

- [ ] **Step 3: Commit**

```bash
git init  # only if not already a git repo
git add package.json package-lock.json
git commit -m "chore: add electron and electron-builder deps"
```

---

## Task 2: Fix Vite base path for file:// loading

**Files:**
- Modify: `vite.config.ts`

Electron loads `dist/index.html` via `file://` URL. Vite's default `base: '/'` produces absolute paths that break under `file://`. Setting `base: './'` makes all asset paths relative.

- [ ] **Step 1: Update vite.config.ts**

Replace the full contents of `vite.config.ts` with:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, open: true }
});
```

- [ ] **Step 2: Verify the build still works**

```bash
npm run build
```

Expected: `dist/index.html` exists and asset paths inside it start with `./assets/` not `/assets/`.

```bash
grep 'src=' dist/index.html | head -3
```

Expected: paths like `./assets/index-abc123.js`

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "fix: set vite base to ./ for electron file:// compatibility"
```

---

## Task 3: Create Electron main process

**Files:**
- Create: `electron/main.js`
- Create: `electron/preload.js`

- [ ] **Step 1: Create `electron/preload.js`**

```javascript
// intentionally empty — contextIsolation boundary
```

- [ ] **Step 2: Create `electron/main.js`**

```javascript
import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  const win = new BrowserWindow({
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
}

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

- [ ] **Step 3: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat: add electron main process"
```

---

## Task 4: Wire up package.json scripts and electron-builder config

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json**

Replace the full contents of `package.json` with:

```json
{
  "name": "spy-dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "electron/main.js",
  "scripts": {
    "dev": "vite",
    "dev:electron": "concurrently \"vite\" \"cross-env NODE_ENV=development electron .\"",
    "build": "tsc -b && vite build",
    "build:app": "npm run build && electron-builder",
    "preview": "vite preview",
    "update-aaii": "python3 scripts/update_aaii.py",
    "lint": "eslint ."
  },
  "dependencies": {
    "chart.js": "^4.4.1",
    "react": "^18.3.1",
    "react-chartjs-2": "^5.2.0",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "concurrently": "^8.0.0",
    "electron": "^30.0.0",
    "electron-builder": "^24.0.0",
    "typescript": "^5.5.3",
    "vite": "^5.3.4"
  },
  "build": {
    "appId": "com.user.spy-dashboard",
    "productName": "SPY Dashboard",
    "directories": {
      "output": "dist-app"
    },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "package.json"
    ],
    "mac": {
      "target": "dir"
    }
  }
}
```

- [ ] **Step 2: Install cross-env (needed for NODE_ENV on mac)**

```bash
npm install --save-dev cross-env
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: wire electron-builder config and npm scripts"
```

---

## Task 5: Build and verify the packaged app

**Files:**
- No new files — validates Tasks 1-4

- [ ] **Step 1: Run the full build**

```bash
npm run build:app
```

Expected: 
- `dist/` populated with built React app
- `dist-app/mac/SPY Dashboard.app` directory created

```bash
ls dist-app/mac/
```

Expected: `SPY Dashboard.app`

- [ ] **Step 2: Launch the app to verify it works**

```bash
open "dist-app/mac/SPY Dashboard.app"
```

Expected: SPY Dashboard window opens, chart data loads, no blank screen.

- [ ] **Step 3: Quit the app, then commit**

```bash
git add dist-app/.gitignore  # we'll create this below to exclude build output
git commit -m "chore: confirm electron build works"
```

---

## Task 6: Exclude build output from git and create Desktop install script

**Files:**
- Create: `scripts/install-desktop.sh`
- Create: `dist-app/.gitignore`

- [ ] **Step 1: Add .gitignore for dist-app**

Create `dist-app/.gitignore` with:

```
*
!.gitignore
```

- [ ] **Step 2: Create `scripts/install-desktop.sh`**

```bash
#!/bin/bash
set -e

APP_NAME="SPY Dashboard.app"
SRC="$(cd "$(dirname "$0")/.." && pwd)/dist-app/mac/$APP_NAME"
DEST="$HOME/Desktop/$APP_NAME"

if [ ! -d "$SRC" ]; then
  echo "Error: $SRC not found. Run 'npm run build:app' first."
  exit 1
fi

rm -rf "$DEST"
cp -R "$SRC" "$DEST"
echo "Installed: $DEST"
echo "Double-click 'SPY Dashboard' on your Desktop to open."
```

- [ ] **Step 3: Make the script executable**

```bash
chmod +x scripts/install-desktop.sh
```

- [ ] **Step 4: Run the install script**

```bash
bash scripts/install-desktop.sh
```

Expected output:
```
Installed: /Users/<you>/Desktop/SPY Dashboard.app
Double-click 'SPY Dashboard' on your Desktop to open.
```

- [ ] **Step 5: Verify the Desktop launcher**

Open Finder and confirm `SPY Dashboard.app` appears on the Desktop. Double-click it — the app should open.

- [ ] **Step 6: Commit**

```bash
git add scripts/install-desktop.sh dist-app/.gitignore
git commit -m "feat: add desktop install script and exclude build output from git"
```

---

## Task 7: Smoke test and final verification

- [ ] **Step 1: Close any open instance of the app**

- [ ] **Step 2: Double-click `SPY Dashboard` on the Desktop**

Expected: app launches within 2-3 seconds, SPY Dashboard UI is fully visible and interactive.

- [ ] **Step 3: Verify no browser or terminal is required**

Kill any open terminals. Double-click the Desktop icon again. App should open independently.

- [ ] **Step 4: Final commit**

```bash
git add -A
git status  # confirm nothing unexpected is staged
git commit -m "feat: SPY Dashboard packaged as Electron desktop app"
```

---

## Rebuild workflow (for future updates)

When you update the React source and want to refresh the Desktop app:

```bash
npm run build:app
bash scripts/install-desktop.sh
```
