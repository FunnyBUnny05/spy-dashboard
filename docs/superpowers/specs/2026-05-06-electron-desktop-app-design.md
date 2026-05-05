# SPY Dashboard — Electron Desktop App Design

**Date:** 2026-05-06  
**Status:** Approved

## Overview

Wrap the existing Vite/React SPY Dashboard web app in an Electron shell and package it as a macOS `.app` bundle. A launcher alias is placed on the Desktop so the user can double-click to open the app with no terminal or browser required.

## Architecture

The existing Vite/React source code is unchanged. Electron is layered on top as the desktop runtime.

```
spy-dashboard/
├── electron/
│   ├── main.js        # Electron main process — creates BrowserWindow, loads dist/index.html
│   └── preload.js     # Minimal preload script (security boundary, no node integration in renderer)
├── src/               # Existing React source — unchanged
├── dist/              # Vite build output — loaded by Electron
├── dist-app/          # electron-builder output
│   └── mac/
│       └── SPY Dashboard.app
└── package.json       # Updated with electron deps, main entry, build scripts
```

## Components

### `electron/main.js`
- Creates a `BrowserWindow` (1280×800, no frame customization needed)
- In production: loads `dist/index.html` via `file://` protocol
- In dev: loads `http://localhost:5173` (Vite dev server) so hot reload works
- Handles `app.whenReady`, `window-all-closed`, and `activate` lifecycle events

### `electron/preload.js`
- Empty or minimal — `contextIsolation: true`, `nodeIntegration: false`
- No IPC needed since the app is purely a UI with no native OS calls

### `package.json` changes
- Add `"main": "electron/main.js"` field
- Add devDependencies: `electron`, `electron-builder`
- Add scripts:
  - `"dev:electron"` — starts Vite dev server + Electron concurrently (for development)
  - `"build:app"` — runs `vite build` then `electron-builder`
- Add `"build"` config block for electron-builder (see below)

### electron-builder config (in `package.json`)
```json
{
  "build": {
    "appId": "com.user.spy-dashboard",
    "productName": "SPY Dashboard",
    "directories": { "output": "dist-app" },
    "files": ["dist/**/*", "electron/**/*", "package.json"],
    "mac": { "target": "dir" }
  }
}
```

Target is `dir` (not `dmg`) — produces a `.app` folder directly, faster and sufficient for personal use.

## Build Flow

1. `npm run build:app`
   - Vite builds React app → `dist/`
   - electron-builder packages Electron + `dist/` → `dist-app/mac/SPY Dashboard.app`
2. User (or script) copies/aliases `SPY Dashboard.app` to `~/Desktop`

## Desktop Launcher

A shell script (`scripts/install-desktop.sh`) handles the one-time Desktop setup:
- Removes any existing Desktop alias
- Copies the `.app` to `~/Desktop/SPY Dashboard.app`

Run once after `npm run build:app`. No need to re-run unless rebuilding.

## Error Handling

- If `dist/index.html` is missing at launch, Electron shows a blank window. Mitigation: the `build:app` script always runs Vite build first.
- No network calls in the app itself — fully offline after build.

## Development Workflow

```bash
# One-time setup
npm install

# Dev mode (hot reload)
npm run dev:electron   # starts Vite + Electron together

# Production build + desktop install
npm run build:app
bash scripts/install-desktop.sh
```

## Out of Scope

- Code signing / notarization (not needed for personal use on own machine)
- Auto-updater
- DMG installer
- Windows/Linux packaging
