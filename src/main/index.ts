import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Initialize electron-store dynamically since it's ESM
let store: any = null;
const storePromise = import('electron-store').then(({ default: Store }) => {
  store = new Store();
}).catch(err => {
  console.error('Failed to load electron-store:', err);
});

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
function createWindow() {
  const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
  const preloadPath = isDev
    ? path.join(__dirname, 'preload.ts')
    : path.join(__dirname, 'preload.js');

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev mode, load from Vite dev server; in prod, load the built index.html
  if (isDev || process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

/**
 * Opens a native file dialog filtered to image files (JPEG/PNG).
 * Returns { filePath, cancelled } — filePath is the absolute path to the
 * selected file, or undefined if the dialog was cancelled.
 */
ipcMain.handle('open-file-dialog', async (_event, options?: {
  filters?: { name: string; extensions: string[] }[];
  properties?: string[];
}) => {
  const result = await dialog.showOpenDialog({
    filters: options?.filters ?? [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true, filePath: undefined };
  }

  return { cancelled: false, filePath: result.filePaths[0] };
});

/**
 * Reads a file from an absolute path and returns its contents as a base64
 * string. Rejects files larger than 50 MB to prevent memory issues.
 */
ipcMain.handle('read-file-as-base64', async (_event, filePath: string) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }

  // Resolve to absolute and verify it exists
  const resolved = path.resolve(filePath);
  const stats = await fs.promises.stat(resolved);

  // Guard: reject files larger than 50 MB
  const MAX_SIZE = 50 * 1024 * 1024;
  if (stats.size > MAX_SIZE) {
    throw new Error(`File is too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed is 50 MB.`);
  }

  const buffer = await fs.promises.readFile(resolved);
  return buffer.toString('base64');
});

/**
 * Scans a folder to count occurrences of each file extension.
 * Returns a mapping of lowercase extension (with dot) to file count.
 */
ipcMain.handle('scan-folder-extensions', async (_event, folderPath: string) => {
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('Invalid folder path');
  }
  const resolved = path.resolve(folderPath);
  const files = await fs.promises.readdir(resolved, { withFileTypes: true });
  const counts: Record<string, number> = {};
  for (const file of files) {
    if (file.isFile() && !file.name.startsWith('.')) {
      const ext = path.extname(file.name).toLowerCase();
      if (ext) {
        counts[ext] = (counts[ext] || 0) + 1;
      }
    }
  }
  return counts;
});

/**
 * Scans a folder and returns the count of files matching a set of prefixes.
 */
ipcMain.handle('scan-folder-prefixes', async (_event, folderPath: string, prefixes: string[], caseInsensitive: boolean) => {
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('Invalid folder path');
  }
  const resolved = path.resolve(folderPath);
  const files = await fs.promises.readdir(resolved, { withFileTypes: true });
  const fileNames = files.filter(f => f.isFile() && !f.name.startsWith('.')).map(f => f.name);
  if (!prefixes || prefixes.length === 0) {
    return fileNames.length;
  }
  let count = 0;
  for (const name of fileNames) {
    const match = prefixes.some(p => {
      if (caseInsensitive) {
        return name.toLowerCase().startsWith(p.toLowerCase());
      } else {
        return name.startsWith(p);
      }
    });
    if (match) {
      count++;
    }
  }
  return count;
});

/**
 * Persists app settings via electron-store.
 */
ipcMain.handle('settings-get', async () => {
  await storePromise;
  return store ? store.get('settings') : null;
});

ipcMain.handle('settings-set', async (_event, settings) => {
  await storePromise;
  if (store) {
    store.set('settings', settings);
  }
  return true;
});

/**
 * Checks if a folder path exists.
 */
ipcMain.handle('folder-exists', async (_event, folderPath: string) => {
  if (!folderPath || typeof folderPath !== 'string') return false;
  try {
    const resolved = path.resolve(folderPath);
    const stats = await fs.promises.stat(resolved);
    return stats.isDirectory();
  } catch {
    return false;
  }
});

/**
 * Scans a folder to count matching files based on extensions and prefixes.
 */
ipcMain.handle('scan-folder', async (_event, folderPath: string, extensions?: string[], prefixes?: string[]) => {
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('Invalid folder path');
  }
  const resolved = path.resolve(folderPath);
  const files = await fs.promises.readdir(resolved, { withFileTypes: true });
  const fileNames = files.filter(f => f.isFile() && !f.name.startsWith('.')).map(f => f.name);

  let filtered = fileNames;
  if (extensions && extensions.length > 0) {
    const extSet = new Set(extensions.map(e => e.toLowerCase()));
    filtered = filtered.filter(name => extSet.has(path.extname(name).toLowerCase()));
  }

  if (prefixes && prefixes.length > 0) {
    filtered = filtered.filter(name => prefixes.some(p => name.startsWith(p)));
  }

  return { count: filtered.length };
});

/**
 * Opens a native folder selection dialog.
 */
ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }

  return result.filePaths[0];
});

/**
 * Stub handler to test connection status.
 */
ipcMain.handle('test-connection', async () => {
  return { success: true };
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
