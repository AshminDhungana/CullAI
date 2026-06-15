/**
 * main/index.ts
 *
 * Entry point for the Electron main process.
 *
 * Responsibilities:
 *   1. Create the BrowserWindow.
 *   2. Initialise electron-store (main settings) and the secure store
 *      (encrypted API keys — separate file, never logged).
 *   3. Verify OS keychain encryption is available; warn the user if not.
 *   4. Register all IPC handlers only after both stores are ready.
 *
 * All handler implementations live in ./ipc-handlers.ts.
 * Secure-storage helpers live in ./safe-storage.ts.
 */

import { app, BrowserWindow, dialog, safeStorage } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { initSecureStore } from './safe-storage';
import { loadLicense } from './license-manager';
import { disposeDetector } from './face-detector';
import { initAutoUpdater } from './auto-updater';
import { parseCLIArgs } from '../cli/args';
import { runCLI } from '../cli/runner';

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Preload scripts run outside the tsx/ts-node loader — always use the
  // compiled .js file so CommonJS require() works in the sandboxed context.
  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev =
    !app.isPackaged ||
    process.env.NODE_ENV === 'development' ||
    !!process.env.VITE_DEV_SERVER_URL;

  if (isDev) {
    mainWindow.loadURL(
      process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173',
    );
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// ---------------------------------------------------------------------------
// safeStorage availability check
//
// Must be called after app.whenReady() — safeStorage is only usable once the
// app is ready and Electron has had a chance to connect to the OS keychain.
//
// If encryption is unavailable we show a blocking native dialog so the user
// understands their API keys will NOT be persisted between sessions.
// We never fall back to plaintext storage — that would be a silent security
// regression. The user can choose to continue (keys held in memory only for
// this session) or quit and fix their OS keyring.
// ---------------------------------------------------------------------------
async function checkSafeStorageAvailability(): Promise<void> {
  const available = safeStorage.isEncryptionAvailable();

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[safe-storage] Encryption available: ${available}`,
      `| backend: ${(safeStorage as any).getSelectedStorageBackend?.() ?? 'unknown'}`,
    );
  }

  if (!available) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'OS Keychain Unavailable',
      message: 'Secure API key storage is not available on this system.',
      detail:
        'CullAI uses your OS keychain (Windows DPAPI, macOS Keychain, or ' +
        'Linux kwallet / gnome-libsecret) to encrypt API keys at rest.\n\n' +
        'The keychain could not be reached, so API keys entered this session ' +
        'will be held in memory only and will not persist between restarts.\n\n' +
        'On Linux, ensure a keyring daemon is running:\n' +
        '  • GNOME: gnome-keyring-daemon\n' +
        '  • KDE:   kwalletd5 or kwalletd6\n\n' +
        'You can continue without persistence or quit and resolve the issue first.',
      buttons: ['Continue Without Persistence', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 1) {
      app.quit();
    }
    // response === 0 → user chose to continue; app proceeds normally but
    // storeApiKey() will throw on any attempt to save a key, which the
    // renderer already handles gracefully (shows an inline amber warning).
  }
}

// ---------------------------------------------------------------------------
// Store initialisation → IPC registration
//
// electron-store is ESM-only (v9+), so we import() it dynamically.
//
// Both stores (main settings + secure API keys) are constructed here and
// passed to their respective modules. Handlers are registered only after
// both are ready so no handler can race against an uninitialised store.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Phase 19 — Headless CLI Mode
// ---------------------------------------------------------------------------
const isHeadless = app.commandLine.hasSwitch('headless');

app.whenReady().then(async () => {
  // In headless mode we skip the GUI window entirely and run the CLI pipeline.
  if (!isHeadless) {
    createWindow();

    // Phase 18: initialise auto-updater after window is ready
    // (only in packaged builds — dev mode skips update checks)
    initAutoUpdater(mainWindow!);
  }

  // Phase 3.2: verify OS keychain before registering any IPC handlers.
  // This is async (shows a native dialog if needed) and must complete before
  // we expose the 'api-key-store' IPC channel to the renderer.
  await checkSafeStorageAvailability();

  import('electron-store')
    .then(async ({ default: Store }) => {
      // Main settings store — plain JSON, never contains raw API keys.
      const store = new Store();

      // Secure store — physically separate file ("secure.json").
      // Encrypted blobs live here; the file itself is never logged.
      const secureStore = new Store({ name: 'secure' });
      initSecureStore(secureStore as any);

      // Register all IPC handlers. initUsageTracker is called inside
      // registerIpcHandlers (see ipc-handlers.ts) so it receives the
      // real store instance, not an undefined module-scope reference.
      registerIpcHandlers(store as any);

      // Startup license validation — app is guaranteed ready here,
      // store is initialised, app.getPath('userData') is safe.
      const license = loadLicense();
      if (license) {
        console.log(`[main] License loaded: ${license.tier}`);
      } else {
        console.log('[main] No valid license — running in Free tier');
      }

      // ── Phase 19: Headless CLI execution ───────────────────────────────────
      if (isHeadless) {
        try {
          const args = parseCLIArgs(process.argv);
          await runCLI(args);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[headless] CLI runner failed:', msg);
          app.exit(1);
        } finally {
          app.quit();
        }
        return; // stop execution — headless path is complete
      }

      // ── Phase 5b: Non-blocking startup cache cleanup ──────────────────────
      // Runs enforceCacheLimits across all recently used input folders so stale
      // or oversized cache entries are evicted before the user starts working.
      // Errors are logged but never block app startup.
      import('./cache-cleaner').then(({ enforceAllCacheLimits }) => {
        const knownFolders = ((store as any).get('recentInputFolders') as string[]) || [];
        const limits = (store as any).get('rawCacheLimits') as
          | { maxSizeGB: number; maxAgeDays: number }
          | undefined;

        if (limits && knownFolders.length > 0) {
          enforceAllCacheLimits(knownFolders, {
            maxSizeBytes: limits.maxSizeGB * 1024 * 1024 * 1024,
            maxAgeDays: limits.maxAgeDays,
          })
            .then((result) => {
              if (result.deletedFiles > 0) {
                console.log(
                  `[cache-cleaner] Startup cleanup: deleted ${result.deletedFiles} files, ` +
                    `freed ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB`,
                );
              }
            })
            .catch((err: unknown) =>
              console.warn('[cache-cleaner] Startup cleanup failed:', err),
            );
        }
      }).catch((err: unknown) => {
        // Module import failure — non-fatal
        console.warn('[main] cache-cleaner import failed:', err);
      });
    })
    .catch((err: unknown) => {
      // Store failed to load — this is fatal: settings cannot be persisted.
      // Log clearly and continue (the app will still open, just without
      // persistence). The renderer will receive null from settings-get.
      console.error('[main] Failed to initialise electron-store:', err);
    });
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Phase 6: release TensorFlow model memory on quit.
// disposeDetector() is a no-op if detection was never initialised.
app.on('before-quit', () => {
  disposeDetector();
});