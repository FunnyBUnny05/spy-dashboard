# Update Banner — Design Spec

**Date:** 2026-05-06  
**Status:** Approved

## Overview

When source files in `src/` change, the packaged Electron app detects them via a file watcher and shows a small "Update available" banner at the top-left. Clicking Update triggers a rebuild (`npm run build`) and reloads the window. The banner shows a loading state during the build and disappears on success. On build error, it shows a red error state.

## Architecture

Three components interact via Electron's IPC:

```
src/ file saved
  → chokidar in main detects → sends 'source-changed' IPC
  → preload bridges to renderer → UpdateBanner shows
  → user clicks Update → triggerUpdate() via preload
  → main runs npm run build → sends 'build-complete' or 'build-error'
  → main reloads window (on success) → banner gone
```

## Components

### `electron/main.js` (modified)

After the BrowserWindow is created:

1. Start a `chokidar` watcher on the project's `src/` directory. The project root is resolved relative to `electron/main.js` using `__dirname` — one level up. Watch for `change`, `add`, and `unlink` events.
2. On any event, send `ipcMain`-style webContents message `'source-changed'` to the renderer (via `win.webContents.send`).
3. Listen for `'trigger-update'` from renderer via `ipcMain.on`. When received, run `npm run build` using `child_process.exec` with `cwd` set to the project root.
   - On success: send `'build-complete'`, then call `win.webContents.reload()`.
   - On error: send `'build-error'` with the stderr string.
4. Wrap watcher startup in try/catch — if `src/` doesn't exist, log a warning and skip. No crash.
5. On `app` quit, call `watcher.close()` to clean up.

Debounce source-changed events by 500ms to avoid spamming on rapid saves.

### `electron/preload.js` (modified)

Expose `window.electronBridge` via `contextBridge.exposeInMainWorld`:

```typescript
window.electronBridge = {
  onSourceChanged: (cb: () => void) => void,
  onBuildComplete: (cb: () => void) => void,
  onBuildError: (cb: (err: string) => void) => void,
  triggerUpdate: () => void,
}
```

Uses `ipcRenderer.on` for the three incoming events and `ipcRenderer.send('trigger-update')` for the outgoing action.

### `src/components/UpdateBanner.tsx` (new)

A fixed-position banner at top-left. Manages its own state:

| State | Display |
|-------|---------|
| `idle` | Hidden (renders nothing) |
| `available` | Blue banner: "Update available" + "Update" button |
| `building` | Same banner: "Building…" + spinner, button disabled |
| `error` | Red banner: "Build failed" + error message + "Retry" button |

On mount, registers listeners via `window.electronBridge` (if it exists — guard for browser dev mode where bridge is absent).

On `onSourceChanged` → state: `available`  
On Update click → calls `triggerUpdate()` → state: `building`  
On `onBuildComplete` → window reloads automatically (banner disappears)  
On `onBuildError` → state: `error` with message  

Clicking Retry re-calls `triggerUpdate()` and returns to `building` state.

### `src/App.tsx` (modified)

Add `<UpdateBanner />` as the first child inside the root element. One import, one JSX line.

## Dependencies

- `chokidar` — file watcher (add as devDependency, bundled via electron-builder `files` glob)

## Error Handling

- Watcher can't find `src/`: caught in try/catch, warning logged, no banner ever shown
- `npm run build` fails: `build-error` IPC sent, banner shows red error state with stderr
- `window.electronBridge` absent (browser dev mode): `UpdateBanner` skips all listener registration, renders nothing

## Out of Scope

- Auto-rebuild without clicking Update
- Showing which files changed
- Build progress percentage
- Persisting "update available" state across window reloads
