/**
 * main/auto-updater.ts
 *
 * Handles automatic update checks and notifications using electron-updater.
 * Integrates with GitHub Releases for distribution.
 *
 * Responsibilities:
 *   1. Check for updates on app startup (once per day).
 *   2. Show non-modal notification when an update is available.
 *   3. Download updates in the background.
 *   4. Install on user confirmation or on app quit.
 *   5. Allow user to disable auto-check in settings.
 */

import { app, BrowserWindow, dialog, ipcMain, IpcMainEvent } from 'electron';
import { autoUpdater, UpdateInfo } from 'electron-updater';
import * as path from 'path';

// Console-friendly logger that doesn't spam the renderer
const log = (msg: string) => console.log(`[auto-updater] ${msg}`);

let updateCheckEnabled = true;
let mainWindow: BrowserWindow | null = null;

/**
 * Initialise the auto-updater.
 *   - Configures electron-updater to check GitHub Releases.
 *   - Attaches listeners for update-available, update-downloaded, etc.
 *   - Must be called from the main process after app is ready.
 */
export function initAutoUpdater(window: BrowserWindow): void {
  mainWindow = window;

  // If running in development, skip auto-check (unless forced)
  if (isDev()) {
    log('Development mode — update checks skipped');
    return;
  }

  // Configure electron-updater logging
  autoUpdater.logger = console as any;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Listeners
  autoUpdater.on('update-available', onUpdateAvailable);
  autoUpdater.on('update-not-available', onUpdateNotAvailable);
  autoUpdater.on('error', onUpdateError);
  autoUpdater.on('download-progress', onDownloadProgress);
  autoUpdater.on('update-downloaded', onUpdateDownloaded);

  // IPC: allow renderer to trigger a manual check or toggle auto-check
  ipcMain.on('updater-check', () => {
    log('Manual update check triggered');
    checkForUpdates();
  });

  ipcMain.on('updater-set-enabled', (_: IpcMainEvent, enabled: boolean) => {
    updateCheckEnabled = enabled;
    log(`Auto-check ${enabled ? 'enabled' : 'disabled'}`);
  });

  // Initial check on startup
  checkForUpdates();

  // Daily recurring check (once per 24h)
  setInterval(() => {
    checkForUpdates();
  }, 24 * 60 * 60 * 1000);
}

/**
 * Check for updates if enabled.
 */
export function checkForUpdates(): void {
  if (!updateCheckEnabled) {
    log('Update check skipped (disabled by user)');
    return;
  }

  log('Checking for updates...');
  autoUpdater.checkForUpdatesAndNotify().catch((err: Error) => {
    log(`Update check failed: ${err.message}`);
  });
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onUpdateAvailable(info: UpdateInfo): void {
  log(`Update available: ${info.version}`);
  // Notify the renderer so it can show a non-modal banner
  mainWindow?.webContents.send('updater-update-available', {
    version: info.version,
    releaseDate: info.releaseDate,
  });
}

function onUpdateNotAvailable(info: UpdateInfo): void {
  log(`No update available (current: ${info.version})`);
}

function onUpdateError(err: Error): void {
  log(`Error: ${err.message}`);
  // Don't spam the user with error dialogs on every check failure
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-error', { message: err.message });
  }
}

function onDownloadProgress(progress: { percent: number; transferred: number; total: number }): void {
  log(`Download progress: ${Math.round(progress.percent)}%`);
  mainWindow?.webContents.send('updater-download-progress', progress);
}

function onUpdateDownloaded(info: UpdateInfo): void {
  log(`Update downloaded: ${info.version}`);
  mainWindow?.webContents.send('updater-update-downloaded', {
    version: info.version,
  });

  // Show a native dialog asking the user to restart
  dialog
    .showMessageBox(mainWindow!, {
      type: 'info',
      title: 'Update Ready',
      message: `CullAI ${info.version} has been downloaded.`,
      detail: 'The update will be installed when you restart the application.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    })
    .then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    })
    .catch(() => {
      // Dialog cancelled — wait for next quit
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDev(): boolean {
  return (
    !app.isPackaged ||
    process.env.NODE_ENV === 'development' ||
    !!process.env.VITE_DEV_SERVER_URL
  );
}
