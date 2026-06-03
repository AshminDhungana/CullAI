/**
 * main/index.ts
 *
 * Entry point for the Electron main process.
 *
 * Responsibilities:
 *   1. Create the BrowserWindow.
 *   2. Initialise electron-store.
 *   3. Register all IPC handlers (only after the store is ready, so handlers
 *      receive a fully-initialised store — no null checks, no race condition).
 *
 * All handler implementations live in ./ipc-handlers.ts.
 */

import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers';

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
// Handlers are registered inside the .then() callback, which means:
//   • The store object passed to registerIpcHandlers is always initialised.
//   • No handler can be called before the store is ready (Electron queues
//     renderer IPC calls until the window is ready, and window creation
//     happens in app.whenReady which fires after this chain begins).
// ---------------------------------------------------------------------------
import('electron-store')
  .then(({ default: Store }) => {
    const store = new Store();
    registerIpcHandlers(store);
  })
  .catch((err: unknown) => {
    // Store failed to load — this is fatal: settings cannot be persisted.
    // Log clearly and continue (the app will still open, just without
    // persistence). The renderer will receive null from settings-get.
    console.error('[main] Failed to initialise electron-store:', err);
  });

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