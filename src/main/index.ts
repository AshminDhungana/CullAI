/**
 * main/index.ts
 *
 * Entry point for the Electron main process.
 *
 * Responsibilities:
 *   1. Create the BrowserWindow.
 *   2. Initialise electron-store (main settings) and the secure store
 *      (encrypted API keys — separate file, never logged).
 *   3. Register all IPC handlers only after both stores are ready.
 *
 * All handler implementations live in ./ipc-handlers.ts.
 * Secure-storage helpers live in ./safe-storage.ts.
 */

import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { initSecureStore } from './safe-storage';
import { loadLicense } from './license-manager';

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
// Store initialisation → IPC registration
//
// electron-store is ESM-only (v9+), so we import() it dynamically.
//
// Both stores (main settings + secure API keys) are constructed here and
// passed to their respective modules. Handlers are registered only after
// both are ready so no handler can race against an uninitialised store.
//
// FIX #2: loadLicense() is now called INSIDE this .then() callback, after
// app.whenReady() has already resolved (createWindow runs first) and after
// the store is initialised. Calling app.getPath('userData') before app is
// ready throws — moving it here guarantees safety.
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Create the window first so the user sees something immediately while
  // the store initialises in the background.
  createWindow();

  import('electron-store')
    .then(({ default: Store }) => {
      // Main settings store — plain JSON, never contains raw API keys.
      const store = new Store();

      // Secure store — physically separate file ("secure.json").
      // Encrypted blobs live here; the file itself is never logged.
      const secureStore = new Store({ name: 'secure' });
      initSecureStore(secureStore);

      // Register all IPC handlers. initUsageTracker is called inside
      // registerIpcHandlers (see ipc-handlers.ts) so it receives the
      // real store instance, not an undefined module-scope reference.
      registerIpcHandlers(store);

      // FIX #2: Startup license validation moved here — app is guaranteed
      // ready, store is initialised, app.getPath('userData') is safe.
      const license = loadLicense();
      if (license) {
        console.log(`[main] License loaded: ${license.tier}`);
      } else {
        console.log('[main] No valid license — running in Free tier');
      }
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