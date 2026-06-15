/**
 * scripts/build-cli.js
 *
 * Post-build script that creates CLI wrapper scripts for all platforms.
 * Run after `npm run build:all` so the compiled JS already exists in dist/.
 */

const fs = require('fs');
const path = require('path');

const binDir = path.join(__dirname, '..', 'bin');

// Ensure bin directory exists
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// ── Windows wrapper (batch file) ───────────────────────────────────────────
const winWrapper = `@echo off
REM CullAI Headless CLI Wrapper
REM Usage: cullai-cli.bat [options]
REM Forwards to Electron with --headless

setlocal
set "ELECTRON_PATH=%~dp0..\\node_modules\\.bin\\electron.cmd"
if not exist "%ELECTRON_PATH%" (
    set "ELECTRON_PATH derecho=%~dp0..\\..\\electron\\cmd.js"
)

"%ELECTRON_PATH%" --headless %*
endlocal
`;

fs.writeFileSync(path.join(binDir, 'cullai-cli.bat'), winWrapper, 'utf8');

// ── POSIX wrapper (shell script) ───────────────────────────────────────────
const posixWrapper = `#!/usr/bin/env sh
# CullAI Headless CLI Wrapper
# Usage: ./cullai-cli [options]
# Forwards to Electron with --headless

set -e

# Try to find the project root (where the electron binary exists)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$SCRIPT_DIR/../node_modules/.bin/electron"

if [ ! -x "$ELECTRON" ]; then
    ELECTRON="$(which electron 2>/dev/null || true)"
fi

if [ -z "$ELECTRON" ] || [ ! -x "$ELECTRON" ]; then
    echo "Error: electron not found. Run 'npm install' first." >&2
    exit 1
fi

exec "$ELECTRON" --headless "$@"
`;

fs.writeFileSync(path.join(binDir, 'cullai-cli'), posixWrapper, 'utf8');

// ── Make POSIX script executable (chmod 755) ───────────────────────────────
if (process.platform !== 'win32') {
  fs.chmodSync(path.join(binDir, 'cullai-cli'), 0o755);
}

console.log('[build-cli] Created CLI wrappers:');
console.log('  bin/cullai-cli.bat  (Windows)');
console.log('  bin/cullai-cli      (macOS / Linux)');
