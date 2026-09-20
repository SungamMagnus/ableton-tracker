#!/bin/bash
# Builds "Ableton Tracker.app" into dist/ — a self-contained macOS app bundle
# with the Node runtime embedded for both Apple Silicon and Intel, so
# recipients don't need Node installed. Ad-hoc signed (not notarized), per
# the README's install notes.
#
# Usage:
#   VERSION=2.1 scripts/build-mac-app.sh
#
# The bundled Node binaries are the expensive/networked part. Point
# NODE_ARM64_BIN / NODE_X64_BIN at existing binaries to reuse (e.g. from a
# prior build) — otherwise they're downloaded fresh from nodejs.org.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

VERSION="${VERSION:?Set VERSION, e.g. VERSION=2.1 scripts/build-mac-app.sh}"
NODE_VERSION="${NODE_VERSION:-24.20.0}"

APP_NAME="Ableton Tracker"
EXEC_NAME="AbletonTracker"
DIST="$HERE/dist"
APP="$DIST/$APP_NAME.app"
CONTENTS="$APP/Contents"
RES="$CONTENTS/Resources"
APP_DIR="$RES/app"

echo "Building $APP_NAME.app v$VERSION"

rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$RES/node/bin" "$APP_DIR"

# --- app resources ---------------------------------------------------------

cp server.js "$APP_DIR/server.js"
cp -R public "$APP_DIR/public"
cp -R lib "$APP_DIR/lib"

if [ -f "$HERE/assets/AppIcon.icns" ]; then
  cp "$HERE/assets/AppIcon.icns" "$RES/AppIcon.icns"
else
  echo "Warning: assets/AppIcon.icns not found — building without a custom icon." >&2
fi

# --- bundled Node runtime ---------------------------------------------------

fetch_node() {
  local arch="$1" out="$2" node_arch triple tmp
  case "$arch" in
    arm64) node_arch="arm64" ;;
    x64)   node_arch="x64" ;;
  esac
  triple="node-v${NODE_VERSION}-darwin-${node_arch}"
  tmp="$(mktemp -d)"
  echo "Downloading Node ${NODE_VERSION} (${node_arch})…"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${triple}.tar.gz" -o "$tmp/node.tar.gz"
  tar -xzf "$tmp/node.tar.gz" -C "$tmp"
  cp "$tmp/$triple/bin/node" "$out"
  chmod +x "$out"
  rm -rf "$tmp"
}

place_node() {
  local arch="$1" out="$2" env_var="$3"
  local env_val="${!env_var:-}"
  if [ -n "$env_val" ]; then
    cp "$env_val" "$out"
  else
    fetch_node "$arch" "$out"
  fi
  chmod +x "$out"
}

place_node arm64 "$RES/node/bin/node-arm64" NODE_ARM64_BIN
place_node x64   "$RES/node/bin/node-x64"   NODE_X64_BIN

# --- launcher ---------------------------------------------------------------

cat > "$CONTENTS/MacOS/$EXEC_NAME" <<'LAUNCHER'
#!/bin/bash
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
RES="$HERE/../Resources"
case "$(uname -m)" in
  arm64) NODE_BIN="$RES/node/bin/node-arm64" ;;
  *)     NODE_BIN="$RES/node/bin/node-x64" ;;
esac
APP_DIR="$RES/app"
PORT=4173
URL="http://localhost:${PORT}/"

if [ ! -x "$NODE_BIN" ]; then
  osascript -e 'display notification "This copy of the app is missing its bundled Node runtime." with title "Ableton Tracker"'
  exit 1
fi

if ! curl -sf "$URL" >/dev/null 2>&1; then
  cd "$APP_DIR" || {
    osascript -e 'display notification "App resources not found." with title "Ableton Tracker"'
    exit 1
  }

  nohup "$NODE_BIN" server.js > "$TMPDIR/ableton-tracker.log" 2>&1 &
  disown

  # Generous timeout: right after login/reboot, Google Drive's own sync
  # process may still be initializing, which can slow the very first
  # filesystem access. The server itself no longer blocks on that, but
  # this leaves headroom for a generally slow post-reboot machine.
  ready=0
  for _ in $(seq 1 90); do
    if curl -sf "$URL" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.5
  done

  if [ "$ready" -ne 1 ]; then
    osascript -e 'display notification "Taking longer than usual to start — opening anyway." with title "Ableton Tracker"'
  fi
fi

open "$URL"
LAUNCHER
chmod +x "$CONTENTS/MacOS/$EXEC_NAME"

# --- Info.plist --------------------------------------------------------------

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Ableton Tracker</string>
  <key>CFBundleDisplayName</key>
  <string>Ableton Tracker</string>
  <key>CFBundleIdentifier</key>
  <string>com.magnbir.abletontracker</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleExecutable</key>
  <string>$EXEC_NAME</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.15</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

# --- sign + zip --------------------------------------------------------------

codesign --force --deep -s - "$APP"
codesign --verify --deep --strict "$APP"

rm -f "$DIST/$APP_NAME.zip"
(cd "$DIST" && ditto -c -k --sequesterRsrc --keepParent "$APP_NAME.app" "$APP_NAME.zip")

echo "Built: $APP"
echo "Zipped: $DIST/$APP_NAME.zip"
