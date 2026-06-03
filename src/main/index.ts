import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev mode, load from Vite dev server; in prod, load the built index.html
  if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
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
