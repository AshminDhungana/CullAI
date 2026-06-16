/**
 * main/index.ts
 *
 * Entry point for the Electron main process.
 *
 * Responsibilities:
 *   1. Initialise electron-store (main settings) and the secure store
 *      (encrypted API keys — separate file, never logged).
 *   2. Verify OS keychain encryption is available; warn the user if not.
 *   3. Register all IPC handlers only after both stores are ready.
 *   4. Create the BrowserWindow — always last, so IPC is ready before
 *      the renderer mounts and fires its first ipcRenderer.invoke() calls.
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

  // app.isPackaged is false in dev (electron -r tsx ...) and true in all
  // packaged builds — the single reliable signal, no env-var leakage risk.
  if (!app.isPackaged) {
    mainWindow.loadURL(
      process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173',
    );
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

  if (!app.isPackaged) {
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
// Phase 19 — Headless CLI Mode
// ---------------------------------------------------------------------------
const isHeadless = app.commandLine.hasSwitch('headless');

app.whenReady().then(async () => {
  // ── Step 1: verify OS keychain ────────────────────────────────────────────
  // Must complete before IPC handlers are registered so the 'api-key-store'
  // channel is never exposed before encryption availability is confirmed.
  await checkSafeStorageAvailability();

  // ── Step 2: initialise stores and register IPC handlers ──────────────────
  // electron-store is ESM-only (v9+), so we await the dynamic import once
  // here. IPC handlers are fully registered before the window is created,
  // so the renderer can never beat its first ipcRenderer.invoke() call.
  let store: any;
  try {
    const { default: Store } = await import('electron-store');

    // Main settings store — plain JSON, never contains raw API keys.
    store = new Store();

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
  } catch (err: unknown) {
    // Store failed to load — settings cannot be persisted.
    // Log clearly and continue; the renderer will receive null from settings-get.
    console.error('[main] Failed to initialise electron-store:', err);
  }

  // ── Phase 19: Headless CLI execution ──────────────────────────────────────
  // Runs the CLI pipeline and exits — no window is ever created.
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

  // ── Step 3: create the window ─────────────────────────────────────────────
  // IPC handlers are fully registered above, so there is no race between
  // the renderer mounting and ipcRenderer.invoke() calls arriving in main.
  createWindow();

  // Phase 18: initialise auto-updater after window is ready
  // (only in packaged builds — dev mode skips update checks)
  initAutoUpdater(mainWindow!);

  // ── Phase 5b: Non-blocking startup cache cleanup ──────────────────────────
  // Runs enforceCacheLimits across all recently used input folders so stale
  // or oversized cache entries are evicted before the user starts working.
  // Errors are logged but never block app startup.
  if (store) {
    import('./cache-cleaner').then(({ enforceAllCacheLimits }) => {
      const knownFolders = (store.get('recentInputFolders') as string[]) || [];
      const limits = store.get('rawCacheLimits') as
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
      console.warn('[main] cache-cleaner import failed:', err);
    });

    // ── Phase 20.2: Background Maintenance ──────────────────────────────────
    import('./maintenance').then(({ runBackgroundMaintenance }) => {
      runBackgroundMaintenance(store)
        .then((result) => {
          if (result.orphanedCacheCount > 0) {
            console.log(
              `[maintenance] Cleaned ${result.orphanedCacheCount} orphaned cache(s), ` +
                `freed ${(result.orphanedCacheFreedBytes / 1024 / 1024).toFixed(1)} MB`,
            );
          }
          if (result.sessionLogEntriesRemoved > 0) {
            console.log(
              `[maintenance] Trimmed ${result.sessionLogEntriesRemoved} old session log entries`,
            );
          }
          if (result.skippedBecause === 'too-soon') {
            if (!app.isPackaged) {
              console.log('[maintenance] Skipped — ran too recently (<7 days)');
            }
          }
        })
        .catch((err: unknown) =>
          console.warn('[maintenance] Background maintenance failed:', err),
        );
    }).catch((err: unknown) => {
      console.warn('[main] maintenance import failed:', err);
    });
  }
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