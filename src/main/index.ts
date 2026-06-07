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
// ---------------------------------------------------------------------------
import('electron-store')
  .then(({ default: Store }) => {
    // Main settings store — plain JSON, never contains raw API keys.
    const store = new Store();

    // Secure store — physically separate file ("secure.json").
    // Encrypted blobs live here; the file itself is never logged.
    const secureStore = new Store({ name: 'secure' });
    initSecureStore(secureStore);

    registerIpcHandlers(store);
  })
  .catch((err: unknown) => {
    // Store failed to load — this is fatal: settings cannot be persisted.
    // Log clearly and continue (the app will still open, just without
    // persistence). The renderer will receive null from settings-get.
    console.error('[main] Failed to initialise electron-store:', err);
  });
  
      // Startup license validation
    const license = loadLicense();
    if (license) {
      console.log(`[main] License loaded: ${license.tier}`);
    } else {
      console.log('[main] No valid license — running in Free tier');
    }
// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});