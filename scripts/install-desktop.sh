#!/bin/bash
set -e

APP_NAME="SPY Dashboard.app"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"

# electron-builder uses mac-arm64 on Apple Silicon, mac on Intel
if [ -d "$PROJ/dist-app/mac-arm64/$APP_NAME" ]; then
  SRC="$PROJ/dist-app/mac-arm64/$APP_NAME"
elif [ -d "$PROJ/dist-app/mac/$APP_NAME" ]; then
  SRC="$PROJ/dist-app/mac/$APP_NAME"
else
  echo "Error: built app not found. Run 'npm run build:app' first."
  exit 1
fi

DEST="$HOME/Desktop/$APP_NAME"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
echo "Installed: $DEST"
echo "Double-click 'SPY Dashboard' on your Desktop to open."
