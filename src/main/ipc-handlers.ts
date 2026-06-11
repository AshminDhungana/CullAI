/**
 * ipc-handlers.ts
 *
 * All Electron IPC handlers in one place. Called once from index.ts after
 * electron-store has initialised, so `store` is guaranteed non-null — no
 * race condition, no null guards needed inside individual handlers.
 *
 * Registration is idempotent-safe: each handler is only registered once
 * because this module is only imported and called once (from app.whenReady).
 *
 * NOTE: We intentionally do NOT import anything from 'electron-store' here.
 * electron-store v9+ is pure ESM and contains `import.meta` in its source.
 * Importing it (even as `import type`) causes tsx/esbuild to attempt to
 * transform that ESM code inside a CJS pipeline ("type":"commonjs" in
 * package.json), which blows up with `Unexpected "."`.
 *
 */

import { dialog, ipcMain, safeStorage, shell, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import archiver from 'archiver';
import { storeApiKey, getApiKey, deleteApiKey } from './safe-storage';
import {
  getLicenseStatus,
  getLicenseTier,
  saveLicense,
  deleteLicense,
  clearLicenseCache,
} from './license-manager';
import { FEATURES, isAllowed } from '../shared/license';
import type { Feature } from '../shared/license';
import {
  initUsageTracker,
  getUsageStatus,
  preloadUsageForSession,
  incrementUsage,
} from './usage-tracker';
import { scanFolder, processFolder } from './image-processor';
import { detectFaces } from './face-detector';
import { getCacheStats, clearCache, setCacheConfig } from './raw-cache';
import { enforceCacheLimits } from './cache-cleaner';
import { groupDuplicates, DEFAULT_SIMILARITY_THRESHOLD } from './duplicate-detector';

import {
  createSession,
  saveScore,
  loadSession,
  hasExistingSession,
  getScoredIds,
  markSessionComplete,
  markSessionCancelled,
  markSessionCrashed,
  saveDiscoveryContext,
  saveShortfallReasons,
  clearSession,
  updateTier,
} from './session-manager';
import {
  runPipeline,
  resolvePipelineConfirmation,
  rejectPipelineConfirmation,
  fillShortfall,
  rescoreImages,
} from './orchestrator';
import { runAutoTagging } from './auto-tagging';
import { walkFolders } from './folder-walker';
import { writeAllSidecars } from './xmp-writer';

// ---------------------------------------------------------------------------
// Structural interface for the electron-store instance.
// Mirrors only the methods this file actually calls: get and set.
// electron-store's real class satisfies this interface exactly, so the
// call-site in index.ts needs no cast.
// ---------------------------------------------------------------------------
interface AppStore {
  get(key: string): unknown;
  get(key: string, defaultValue: string[]): string[];
  set(key: string, value: unknown): void;
}

// ---------------------------------------------------------------------------
// Glob matching — no extra npm dep, covers the four pattern types:
//   *   → any char sequence except path separator
//   ?   → single char except path separator
//   **  → any char sequence including path separators
//   [abc] / [a-z] → character class (passed straight through to RegExp)
// ---------------------------------------------------------------------------

/**
 * Converts a single glob pattern string to a RegExp that tests a filename
 * (or relative path, for ** patterns).
 */
function globToRegex(pattern: string): RegExp {
  // Normalise separators to forward-slash for cross-platform safety.
  const p = pattern.replace(/\\/g, '/').trim();

  let re = '';
  let i = 0;
  while (i < p.length) {
    const ch = p[i];

    if (ch === '*' && p[i + 1] === '*') {
      // `**` — matches anything, including slashes
      re += '.*';
      i += 2;
      // Consume a following `/` so `**/foo` works
      if (p[i] === '/') i++;
    } else if (ch === '*') {
      // `*` — matches anything except `/`
      re += '[^/]*';
      i++;
    } else if (ch === '?') {
      // `?` — matches one char except `/`
      re += '[^/]';
      i++;
    } else if (ch === '[') {
      // Character class — pass through verbatim until the closing `]`
      const end = p.indexOf(']', i + 1);
      if (end === -1) {
        re += '\\[';
        i++;
      } else {
        re += p.slice(i, end + 1); // e.g. [abc] or [a-z]
        i = end + 1;
      }
    } else {
      // Escape any regex metacharacters in the literal character
      re += ch.replace(/[.+^${}()|\\]/g, '\\$&');
      i++;
    }
  }

  // Anchor: the pattern should match the full filename (or last path segment).
  // If the pattern contained a `/` or `**`, match against the full relative
  // path; otherwise match against the basename only.
  const hasPathPart = p.includes('/');
  if (hasPathPart) {
    // Match the whole name (relative path from folder root)
    return new RegExp(`^${re}$`, 'i');
  } else {
    // Match just the filename — anchor to the end; allow any leading segment
    return new RegExp(`(?:^|/)${re}$`, 'i');
  }
}

/**
 * Filters a list of file names (relative paths from the folder root) against
 * an array of parsed ignore patterns. A file is excluded if it matches any
 * pattern. Returns only the files that should be kept.
 */
function applyIgnorePatterns(names: string[], patterns: string[]): string[] {
  if (!patterns || patterns.length === 0) return names;
  const regexes = patterns.map(globToRegex);
  return names.filter(name => !regexes.some(rx => rx.test(name)));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * AppSettings round-trips through JSON (electron-store serialises to disk).
 * A few fields need special attention:
 *   - `extensionFilter` is typed as string[] in the form; never store a Set.
 *   - `referenceImage.base64` is a ~50–150 KB base64 JPEG string — fine for
 *     electron-store's JSON backend, which has no practical size limit.
 */
type StoredSettings = Record<string, unknown>;

/** Maximum number of recent folder paths to retain per kind. */
const RECENT_FOLDERS_MAX = 10;

// ---------------------------------------------------------------------------
// Active process-images cancellation map
//
// Stores one AbortController per BrowserWindow webContents ID so that a
// second 'process-images' call or a window close can cancel the in-flight
// generator cleanly.
// ---------------------------------------------------------------------------
const activeProcessJobs = new Map<number, AbortController>();

// ---------------------------------------------------------------------------
// Active pipeline cancellation map
//
// Mirrors activeProcessJobs but for the Phase 10 pipeline generator.
// One AbortController per webContents ID. The pipeline generator checks
// signal.aborted at each major step.
// ---------------------------------------------------------------------------
const activePipelineJobs = new Map<number, AbortController>();

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function registerIpcHandlers(store: AppStore): void {
  initUsageTracker(store);

  // ── Phase 5b: Initialise RAW cache config from stored settings ──────────
  const storedSettings = store.get('settings') as Record<string, unknown> | undefined;
  setCacheConfig({ disabled: !!(storedSettings?.disableRawCache) });

  // -------------------------------------------------------------------------
  // Phase 3.2 — Safe-storage availability query
  //
  // The renderer uses this to show an inline status badge in the AI step of
  // Setup, giving visual confirmation of keychain availability on each
  // platform. Returns a plain boolean — never exposes keys or backend details.
  // -------------------------------------------------------------------------

  /**
   * Returns true if OS keychain encryption is available on this machine.
   * Safe to call from the renderer at any time after app ready.
   */
  ipcMain.handle('safe-storage-available', () => {
    return safeStorage.isEncryptionAvailable();
  });

  // -------------------------------------------------------------------------
  // Settings persistence
  // -------------------------------------------------------------------------

  /**
   * Returns the persisted settings object, or null if none have been saved.
   *
   * Dev note: logs a boolean presence flag (never the values themselves) so
   * you can confirm round-trip without leaking API keys to the console.
   */
  ipcMain.handle('settings-get', () => {
    const stored = store.get('settings') as StoredSettings | undefined;
    if (process.env.NODE_ENV === 'development') {
      console.log('[ipc] settings-get → stored?', !!stored);
    }
    return stored ?? null;
  });

  /**
   * Persists the full settings object. Throws if `settings` is not an object
   * so the renderer can catch and surface a warning instead of silently losing
   * data.
   */
  ipcMain.handle('settings-set', (_event, settings: unknown) => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('settings-set: expected a plain object');
    }
    store.set('settings', settings);
    // Keep in-memory cache config in sync so toggling "Disable RAW preview
    // caching" takes effect immediately without requiring an app restart.
    setCacheConfig({ disabled: !!(settings as any).disableRawCache });
    return true;
  });

  // -------------------------------------------------------------------------
  // Recent folders
  // -------------------------------------------------------------------------

  /**
   * Returns both recent-folder lists in a single round-trip.
   * Each list is ordered newest-first, capped at RECENT_FOLDERS_MAX entries.
   */
  ipcMain.handle('recent-folders-get', () => {
    const input  = store.get('recentInputFolders',  []) as string[];
    const output = store.get('recentOutputFolders', []) as string[];
    return { input, output };
  });

  /**
   * Prepends `path` to the appropriate recent list, removes any duplicate
   * occurrence of the same path, and trims to RECENT_FOLDERS_MAX entries.
   * Returns the updated list so the renderer can update local state without
   * a second round-trip.
   */
  ipcMain.handle(
    'recent-folders-update',
    (_event, payload: { kind: 'input' | 'output'; path: string }) => {
      if (!payload?.path || typeof payload.path !== 'string') {
        throw new Error('recent-folders-update: path must be a non-empty string');
      }
      if (payload.kind !== 'input' && payload.kind !== 'output') {
        throw new Error("recent-folders-update: kind must be 'input' or 'output'");
      }

      const key = payload.kind === 'input' ? 'recentInputFolders' : 'recentOutputFolders';
      const current = store.get(key, []) as string[];
      const updated = [payload.path, ...current.filter(p => p !== payload.path)]
        .slice(0, RECENT_FOLDERS_MAX);

      store.set(key, updated);
      return updated;
    },
  );

  // -------------------------------------------------------------------------
  // Folder helpers
  // -------------------------------------------------------------------------

  /**
   * Recursively discovers all subdirectories under `rootPath` that contain
   * at least one file. Hidden dirs and .cullai_cache are excluded.
   *
   * Returns an array of relative paths ('' for root, 'sub/dir' for children).
   * Used by the renderer to preview how many folders will be processed.
   *
   * Payload: rootPath: string
   * Returns: string[]
   */
  ipcMain.handle('walk-subfolders', async (_event, rootPath: string) => {
    if (!rootPath || typeof rootPath !== 'string') {
      throw new Error('walk-subfolders: rootPath must be a non-empty string');
    }
    return walkFolders(rootPath);
  });

  /** Opens a native folder-picker dialog. Returns the selected path or undefined. */
  ipcMain.handle('open-folder-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const opts = { properties: ['openDirectory'] as ('openDirectory')[] };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);

    if (result.canceled || result.filePaths.length === 0) return undefined;
    return result.filePaths[0];
  });

  // -------------------------------------------------------------------------
  // License system
  // -------------------------------------------------------------------------

  ipcMain.handle('license:activate', (_event, rawKey: string) => {
    if (!rawKey || typeof rawKey !== 'string') {
      return { success: false, error: 'Key required' };
    }
    const result = saveLicense(rawKey.trim());
    if (result.success) clearLicenseCache();
    return result;
  });

  ipcMain.handle('license:deactivate', () => {
    deleteLicense();
    return { success: true };
  });

  ipcMain.handle('license:get-status', async () => {
    const status = getLicenseStatus();
    const usage = await getUsageStatus();
    return { ...status, usage };
  });

  ipcMain.handle('license:get-tier', () => getLicenseTier());

  ipcMain.handle('license:check-feature', (_event, feature: string) => {
    if (!(FEATURES as readonly string[]).includes(feature)) {
      return { allowed: false, error: `Unknown feature: "${feature}"` };
    }
    const tier = getLicenseTier();
    return { allowed: isAllowed(feature as Feature, tier), tier };
  });

  ipcMain.handle('license:check-quota', async (_event, requestedCount: number) => {
    if (typeof requestedCount !== 'number' || requestedCount < 0) {
      return { allowed: false, remaining: 0, error: 'Invalid count' };
    }
    return preloadUsageForSession(requestedCount);
  });

  ipcMain.handle('license:increment-usage', async (_event, count: number) => {
    if (typeof count !== 'number' || count < 0) {
      return { success: false, remaining: 0, error: 'Invalid count' };
    }
    return incrementUsage(count);
  });

  /** Returns true if `folderPath` is an existing directory. */
  ipcMain.handle('folder-exists', async (_event, folderPath: string) => {
    if (!folderPath || typeof folderPath !== 'string') return false;
    try {
      const stats = await fs.promises.stat(path.resolve(folderPath));
      return stats.isDirectory();
    } catch {
      return false;
    }
  });

  /**
   * Reads `.cullaiignore` from the root of `folderPath`.
   *
   * Returns an array of active pattern strings (non-empty, non-comment lines),
   * or `null` if the file does not exist.
   *
   * The file format mirrors `.gitignore`:
   *   - Lines starting with `#` are comments and are skipped.
   *   - Blank / whitespace-only lines are skipped.
   *   - All other trimmed lines are returned as-is for glob matching.
   */
  ipcMain.handle('parse-cullaiignore', async (_event, folderPath: string) => {
    if (!folderPath || typeof folderPath !== 'string') {
      throw new Error('parse-cullaiignore: invalid folder path');
    }
    const filePath = path.join(path.resolve(folderPath), '.cullaiignore');
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const patterns = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
      return patterns; // string[] — may be empty if file only had comments
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null; // file not found — normal case
      throw err; // unexpected error (permissions, etc.) — surface to renderer
    }
  });

  /**
   * Counts files in a folder that match optional extension and prefix filters,
   * then excludes any names matched by `ignorePatterns` (glob strings from a
   * parsed `.cullaiignore` file).
   *
   * Delegates to scanFolder() in image-processor.ts — single authoritative
   * implementation. Returns `{ count: number, filePaths: string[] }`.
   *
   * Phase 5 change: now delegates to scanFolder() instead of inlining its own
   * readdir logic. The response shape adds `filePaths` so callers that need
   * the actual paths (e.g. process-images) can skip a second round-trip.
   */
  ipcMain.handle(
    'scan-folder',
    async (
      _event,
      folderPath: string,
      extensions?: string[],
      prefixes?: string[],
      ignorePatterns?: string[],
    ) => {
      if (!folderPath || typeof folderPath !== 'string') {
        throw new Error('scan-folder: invalid folder path');
      }

      const filePaths = await scanFolder(folderPath, {
        extensions,
        prefixes,
        ignorePatterns,
        // prefixCaseInsensitive defaults to true inside scanFolder
        recursive: false,
      });

      return { count: filePaths.length, filePaths };
    },
  );

  /**
   * Returns a `{ ext: count }` map for all files in a folder.
   * Keys are lowercase dot-prefixed extensions, e.g. `".jpg"`.
   */
  ipcMain.handle('scan-folder-extensions', async (_event, folderPath: string) => {
    if (!folderPath || typeof folderPath !== 'string') {
      throw new Error('scan-folder-extensions: invalid folder path');
    }
    const resolved = path.resolve(folderPath);
    const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
    const counts: Record<string, number> = {};
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext) counts[ext] = (counts[ext] ?? 0) + 1;
      }
    }
    return counts;
  });

  /**
   * Counts files whose names start with any of the given `prefixes`.
   * If `prefixes` is empty, returns total file count.
   */
  ipcMain.handle(
    'scan-folder-prefixes',
    async (
      _event,
      folderPath: string,
      prefixes: string[],
      caseInsensitive: boolean,
    ) => {
      if (!folderPath || typeof folderPath !== 'string') {
        throw new Error('scan-folder-prefixes: invalid folder path');
      }
      const resolved = path.resolve(folderPath);
      const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
      const names = entries
        .filter(e => e.isFile() && !e.name.startsWith('.'))
        .map(e => e.name);

      if (!prefixes || prefixes.length === 0) return names.length;

      return names.filter(name =>
        prefixes.some(p =>
          caseInsensitive
            ? name.toLowerCase().startsWith(p.toLowerCase())
            : name.startsWith(p),
        ),
      ).length;
    },
  );

  // -------------------------------------------------------------------------
  // Phase 5 — Image processing pipeline
  //
  // 'process-images' streams ImageRecord objects back to the renderer via
  // push events ('image-record') rather than a single invoke reply, because
  // a folder of 2000 images cannot be returned in one round-trip without
  // blocking the main process for seconds.
  //
  // Protocol:
  //   Renderer calls:  ipcRenderer.invoke('process-images', folderPath, options)
  //   Main pushes:     event.sender.send('image-record', ImageRecord)
  //   Main resolves:   { processed: number, skipped: number } when done
  //
  // Cancellation:
  //   Renderer calls:  ipcRenderer.invoke('process-images-cancel')
  //   Main aborts the generator for that webContents ID and resolves the
  //   original invoke with { processed, skipped, cancelled: true }.
  // -------------------------------------------------------------------------

  /**
   * Processes all images in `folderPath` and streams each resulting ImageRecord
   * back to the renderer via the 'image-record' push channel.
   *
   * Enforces the Free tier quota (500 images/month) before starting. If the
   * folder contains more images than the remaining quota allows, rejects with
   * error code FREE_LIMIT_EXCEEDED.
   *
   * @param folderPath  Absolute path to the folder to process.
   * @param options     Filter and processing options (extensions, prefixes,
   *                    ignorePatterns, recursive, useEmbeddedPreview).
   * @returns           { processed: number, skipped: number, cancelled?: true }
   */
  ipcMain.handle(
    'process-images',
    async (
      event,
      folderPath: string,
      options: {
        extensions?: string[];
        prefixes?: string[];
        prefixCaseInsensitive?: boolean;
        ignorePatterns?: string[];
        recursive?: boolean;
        useEmbeddedPreview?: boolean;
      } = {},
    ) => {
      if (!folderPath || typeof folderPath !== 'string') {
        throw new Error('process-images: invalid folder path');
      }

      const senderContentsId = event.sender.id;

      // ── Cancel any existing job for this window ────────────────────────────
      const existing = activeProcessJobs.get(senderContentsId);
      if (existing) {
        existing.abort();
        activeProcessJobs.delete(senderContentsId);
      }

      // ── Quota pre-check (Free tier: 500 images/month) ─────────────────────
      // First do a quick scan to get the file count so we can check quota
      // before doing any expensive decode work.
      const filePaths = await scanFolder(folderPath, {
        extensions: options.extensions,
        prefixes: options.prefixes,
        prefixCaseInsensitive: options.prefixCaseInsensitive,
        ignorePatterns: options.ignorePatterns,
        recursive: options.recursive ?? false,
      });

      const fileCount = filePaths.length;
      const quotaCheck = await preloadUsageForSession(fileCount);

      if (!quotaCheck.allowed) {
        const code = quotaCheck.error?.startsWith('QUOTA_PARTIAL')
          ? 'QUOTA_PARTIAL'
          : 'FREE_LIMIT_EXCEEDED';
        throw Object.assign(
          new Error(`process-images: quota exceeded — ${quotaCheck.error}`),
          { code, remaining: quotaCheck.remaining },
        );
      }

      // ── Set up cancellation ───────────────────────────────────────────────
      const controller = new AbortController();
      activeProcessJobs.set(senderContentsId, controller);

      let processed = 0;
      let skipped = 0;
      let cancelled = false;

      try {
        // processFolder re-uses the same scanFolder call internally, but we
        // pass the already-known filePaths indirectly via the same options.
        // The slight redundancy (two scanFolder calls) is acceptable in Phase 5;
        // Phase 10/11 will restructure this to pass filePaths directly.
        for await (const record of processFolder(folderPath, {
          extensions: options.extensions,
          prefixes: options.prefixes,
          prefixCaseInsensitive: options.prefixCaseInsensitive,
          ignorePatterns: options.ignorePatterns,
          recursive: options.recursive ?? false,
          useEmbeddedPreview: options.useEmbeddedPreview ?? true,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) {
            cancelled = true;
            break;
          }

          // Push the record to the renderer. If the webContents has been
          // destroyed (window closed mid-run), stop gracefully.
          if (event.sender.isDestroyed()) break;

          // ── Phase 6 — Attach face detection results ────────────────────────
          // detectFaces() never throws — failures return the safe empty result.
          // We decode from the already-produced base64 to avoid re-reading disk.
          const faceBuffer = Buffer.from(record.base64, 'base64');
          const maxFaces = ((store.get('settings') as any)?.maxFacesPerImage as number) ?? 0;
          record.faceMetadata = await detectFaces(faceBuffer, maxFaces);

          event.sender.send('image-record', record);
          processed++;
        }
      } catch (err) {
        // Unexpected fatal error from the generator — clean up and re-throw
        // so the renderer's invoke() promise rejects with the error.
        activeProcessJobs.delete(senderContentsId);
        throw err;
      }

      // Track the actual number of images processed against the quota.
      // We use processed (not fileCount) because skipped files don't consume quota.
      if (processed > 0) {
        await incrementUsage(processed);
      }

      // Phase 5b: non-blocking cache cleanup after processing completes.
      // We fire-and-forget so the invoke() response isn't delayed by cleanup I/O.
      const cacheLimits = store.get('rawCacheLimits') as { maxSizeGB: number; maxAgeDays: number } | undefined;
      if (cacheLimits) {
        enforceCacheLimits(folderPath, {
          maxSizeBytes: cacheLimits.maxSizeGB * 1024 * 1024 * 1024,
          maxAgeDays: cacheLimits.maxAgeDays,
        }).catch((err: unknown) => {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[ipc] Post-process cache cleanup failed:', err);
          }
        });
      }

      activeProcessJobs.delete(senderContentsId);

      return { processed, skipped, ...(cancelled ? { cancelled: true } : {}) };
    },
  );

  /**
   * Cancels an in-flight 'process-images' job for the calling window.
   * No-op if no job is running. The original invoke() will resolve with
   * `{ processed, skipped, cancelled: true }`.
   */
  ipcMain.handle('process-images-cancel', (event) => {
    const controller = activeProcessJobs.get(event.sender.id);
    if (controller) {
      controller.abort();
      activeProcessJobs.delete(event.sender.id);
    }
    return true;
  });

  // -------------------------------------------------------------------------
  // File helpers
  // -------------------------------------------------------------------------

  /**
   * Opens a native file picker. Returns `{ cancelled, filePath }`.
   * Defaults to JPEG/PNG filter.
   */
  ipcMain.handle(
    'open-file-dialog',
    async (
      _event,
      options?: {
        filters?: { name: string; extensions: string[] }[];
        properties?: string[];
      },
    ) => {
      const win = BrowserWindow.getFocusedWindow();
      const opts = {
        filters: options?.filters ?? [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png'] },
        ],
        properties: ['openFile'] as ('openFile')[],
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);

      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true, filePath: undefined };
      }
      return { cancelled: false, filePath: result.filePaths[0] };
    },
  );

  /**
   * Reads a file and returns its contents as a base64 string.
   * Rejects files larger than 50 MB.
   */
  ipcMain.handle('read-file-as-base64', async (_event, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('read-file-as-base64: invalid file path');
    }
    const resolved = path.resolve(filePath);
    const stats = await fs.promises.stat(resolved);

    const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
    if (stats.size > MAX_BYTES) {
      throw new Error(
        `File too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`,
      );
    }

    const buffer = await fs.promises.readFile(resolved);
    return buffer.toString('base64');
  });

  // -------------------------------------------------------------------------
  // Face detection
  // -------------------------------------------------------------------------

  /**
   * Runs face detection on a base64-encoded JPEG image.
   *
   * Phase 6 replaces the stub body below with real @vladmandic/human detection.
   * The IPC channel, payload shape, and return shape are locked here so the
   * renderer (ReferenceImageUpload "Test face detection" button) can call it
   * without any changes when Phase 6 lands.
   *
   * Payload:  { base64: string; maxFacesPerImage?: number }
   * Returns:  FaceMetadata (matches src/shared/types.ts exactly)
   */
  ipcMain.handle(
    'scan-faces',
    async (
      _event,
      payload: { base64: string; maxFacesPerImage?: number },
    ) => {
      if (!payload?.base64 || typeof payload.base64 !== 'string') {
        throw new Error('scan-faces: base64 image data is required');
      }

      // ── Phase 6 — Real face detection ─────────────────────────────────────
      const buffer = Buffer.from(payload.base64, 'base64');
      if (buffer.length === 0) {
        throw new Error('scan-faces: decoded buffer is empty');
      }
      return await detectFaces(buffer, payload.maxFacesPerImage ?? 0);
    },
  );

  // -------------------------------------------------------------------------
  // Phase 7 — Duplicate / Burst-Shot Detection
  // -------------------------------------------------------------------------

  /**
   * Groups a list of ImageRecords into duplicate/burst clusters using
   * perceptual hashing.
   *
   * Payload:
   *   images    — ImageRecord[]   The records to analyse. Must all have a
   *                               populated `base64` field.
   *   threshold — number?         Hamming-distance threshold (0–64).
   *                               Defaults to AppSettings.duplicateThreshold,
   *                               then falls back to DEFAULT_SIMILARITY_THRESHOLD.
   *
   * Returns: DuplicateGroup[]
   *
   * ── Disable path ──────────────────────────────────────────────────────────
   * If AppSettings.disableDuplicateGrouping is true the handler skips
   * groupDuplicates() entirely and returns each image as its own singleton
   * group. This is identical to running with threshold = 0 but avoids the
   * pHash computation cost entirely.
   */
  ipcMain.handle(
    'detect-duplicates',
    async (
      _event,
      payload: {
        images: import('../shared/types').ImageRecord[];
        threshold?: number;
      },
    ) => {
      const { images, threshold: payloadThreshold } = payload ?? {};

      if (!Array.isArray(images)) {
        throw new Error('detect-duplicates: images must be an array');
      }

      // ── Read settings for disable flag and per-session threshold ────────────
      const settings = store.get('settings') as Record<string, unknown> | undefined;
      const disabled = !!(settings?.disableDuplicateGrouping);

      if (disabled) {
        if (process.env.NODE_ENV === 'development') {
          console.log(
            '[ipc] detect-duplicates: duplicate grouping disabled — ' +
            'returning each image as its own group',
          );
        }
        // Return each image as a single-member group — no hashing needed.
        return images.map(
          (img): import('../shared/types').DuplicateGroup => ({
            representative: img,
            duplicates: [],
          }),
        );
      }

      // Threshold resolution order:
      //   1. payload.threshold (caller override, e.g. from orchestrator)
      //   2. settings.duplicateThreshold (user's persisted preference)
      //   3. DEFAULT_SIMILARITY_THRESHOLD (library constant = 10)
      const threshold =
        typeof payloadThreshold === 'number'
          ? payloadThreshold
          : typeof settings?.duplicateThreshold === 'number'
            ? (settings.duplicateThreshold as number)
            : DEFAULT_SIMILARITY_THRESHOLD;

      return groupDuplicates(images, threshold);
    },
  );

  // -------------------------------------------------------------------------
  // Misc
  // -------------------------------------------------------------------------

  /** Smoke-test handler — confirms IPC bridge is alive. */
  ipcMain.handle('test-connection', async () => {
    return { success: true };
  });

  // -------------------------------------------------------------------------
  // Shell helpers
  // -------------------------------------------------------------------------

  /**
   * Checks the relationship between an input and output folder.
   * Returns one of:
   *   'same'               — both paths resolve to the same directory
   *   'output-inside-input'— output is a subdirectory of input (risk of recursion)
   *   'input-inside-output'— input is a subdirectory of output (unusual but flagged)
   *   'ok'                 — no conflict
   */
  ipcMain.handle(
    'check-folder-relationship',
    (_event, payload: { input: string; output: string }) => {
      const { input, output } = payload ?? {};
      if (!input || !output) return 'ok';

      const norm = (p: string) => path.resolve(p).toLowerCase().replace(/[/\\]+$/, '');
      const a = norm(input);
      const b = norm(output);

      if (a === b) return 'same';

      const sep = path.sep;
      if (b.startsWith(a + sep)) return 'output-inside-input';
      if (a.startsWith(b + sep)) return 'input-inside-output';

      return 'ok';
    },
  );

  // -------------------------------------------------------------------------
  // Secure API key storage
  //
  // Keys are encrypted via the OS keychain (Electron safeStorage) and stored
  // in a separate "secure.json" store — never in the main settings file, never
  // logged. The renderer receives only a boolean "key exists" signal on mount;
  // the decrypted value is returned once on an explicit 'api-key-get' call and
  // is immediately masked to a sentinel in the form state so it is never
  // persisted back through 'settings-set'.
  // -------------------------------------------------------------------------

  /**
   * Encrypts and stores the API key for `provider`.
   * Throws (and the renderer surfaces a toast) if the OS keychain is
   * unavailable — this is an explicit, recoverable error, not a silent swallow.
   */
  ipcMain.handle(
    'api-key-store',
    (_event, provider: string, key: string) => {
      if (!provider || typeof provider !== 'string') {
        throw new Error('api-key-store: provider must be a non-empty string');
      }
      if (!key || typeof key !== 'string') {
        throw new Error('api-key-store: key must be a non-empty string');
      }
      // storeApiKey() never logs the raw key — it goes straight to safeStorage.
      storeApiKey(provider as any, key);
      return true;
    },
  );

  /**
   * Decrypts and returns the stored API key for `provider`, or null if none
   * is stored. The renderer immediately replaces the returned value with a
   * masked sentinel so it never re-enters any persisted state.
   *
   * Dev note: we intentionally do NOT log the return value here.
   */
  ipcMain.handle(
    'api-key-get',
    (_event, provider: string) => {
      if (!provider || typeof provider !== 'string') return null;
      return getApiKey(provider as any);
    },
  );

  /**
   * Permanently removes the stored key for `provider`. No-op if nothing is stored.
   */
  ipcMain.handle(
    'api-key-delete',
    (_event, provider: string) => {
      if (!provider || typeof provider !== 'string') return;
      deleteApiKey(provider as any);
      return true;
    },
  );

  /**
   * Reveals `folderPath` in the native file manager (Explorer / Finder /
   * Nautilus). Uses `shell.showItemInFolder` so the folder itself is selected
   * in its parent — more useful than just opening it.
   */
  ipcMain.handle('shell-show-item', async (_event, folderPath: string) => {
    if (!folderPath || typeof folderPath !== 'string' || !folderPath.trim()) {
      throw Object.assign(new Error('shell-show-item: path is empty'), { code: 'EMPTY_PATH' });
    }
    const resolved = path.resolve(folderPath.trim());
    try {
      await fs.promises.access(resolved);
    } catch {
      throw Object.assign(
        new Error(`shell-show-item: path does not exist — ${resolved}`),
        { code: 'NOT_FOUND' },
      );
    }
    shell.showItemInFolder(resolved);
    return true;
  });

  // -------------------------------------------------------------------------
  // Phase 5b — RAW Cache Management
  //
  // Three handlers for the CacheSettingsPanel UI in Setup:
  //   raw-cache-stats      → current cache size, file count, oldest entry
  //   raw-cache-clear      → delete all cached previews for an input folder
  //   raw-cache-set-limits → persist new limits and trigger async cleanup
  // -------------------------------------------------------------------------

  /**
   * Returns cache statistics for the given input folder.
   * If the folder has no cache, returns zeroed stats.
   */
  ipcMain.handle('raw-cache-stats', async (_event, inputFolder: string) => {
    if (!inputFolder || typeof inputFolder !== 'string') {
      return { sizeBytes: 0, fileCount: 0, oldestEntry: null };
    }
    return getCacheStats(path.resolve(inputFolder));
  });

  /**
   * Clears all cached RAW previews for the given input folder.
   * Deletes the entire .cullai_cache directory.
   */
  ipcMain.handle('raw-cache-clear', async (_event, inputFolder: string) => {
    if (!inputFolder || typeof inputFolder !== 'string') {
      throw new Error('raw-cache-clear: invalid input folder');
    }
    await clearCache(path.resolve(inputFolder));
    return { success: true };
  });

  /**
   * Updates cache size and age limits.
   * Persists to electron-store and triggers a non-blocking cleanup pass
   * across all recently used input folders.
   */
  ipcMain.handle(
    'raw-cache-set-limits',
    (_event, limits: { maxSizeGB: number; maxAgeDays: number }) => {
      if (
        !limits ||
        typeof limits.maxSizeGB !== 'number' ||
        typeof limits.maxAgeDays !== 'number'
      ) {
        throw new Error('raw-cache-set-limits: invalid limits object');
      }

      // Persist globally (not per-project)
      store.set('rawCacheLimits', limits);

      // Trigger non-blocking cleanup across all known input folders
      const knownFolders = (store.get('recentInputFolders') as string[]) || [];
      if (knownFolders.length > 0) {
        const cleanupLimits = {
          maxSizeBytes: limits.maxSizeGB * 1024 * 1024 * 1024,
          maxAgeDays: limits.maxAgeDays,
        };
        // Fire and forget — don't block the IPC response
        Promise.all(
          knownFolders.map((folder) =>
            enforceCacheLimits(folder, cleanupLimits).catch(() => {}),
          ),
        ).catch(() => {});
      }

      return { success: true };
    },
  );

  /**
   * Queries the LLM provider for available models.
   * This is used by the renderer when populating the provider-specific model dropdown
   * in the Setup screen. API keys are retrieved securely from the vault and never
   * exposed to the renderer.
   */
  ipcMain.handle(
    'fetch-models',
    async (
      _event,
      payload: { provider: string; baseUrl?: string },
    ) => {
      const { provider, baseUrl } = payload ?? {};

      if (!provider || typeof provider !== 'string') {
        return { models: [], error: 'Provider is required' };
      }

      try {
        // Retrieve the stored API key — never accept it from the renderer.
        const apiKey = getApiKey(provider as any) ?? '';

        switch (provider) {
          case 'claude': {
            const url = 'https://api.anthropic.com/v1/models';
            let res: Response;
            try {
              res = await fetch(url, {
                method: 'GET',
                headers: {
                  'x-api-key': apiKey,
                  'anthropic-version': '2023-06-01',
                },
                signal: AbortSignal.timeout(8000),
              });
            } catch (connErr: unknown) {
              return {
                models: [],
                error: 'Cannot reach Anthropic API — check your internet connection.',
              };
            }

            if (res.status === 401) {
              return { models: [], error: 'Invalid API key (401). Check your Anthropic key.' };
            }
            if (!res.ok) {
              return { models: [], error: `Anthropic API error ${res.status}.` };
            }

            const data = await res.json().catch(() => ({}));
            const list: unknown[] = (data as any)?.data ?? [];
            const models = list
              .map((m: any) => m?.id)
              .filter((id): id is string => typeof id === 'string' && id.includes('claude'))
              .sort()
              .reverse(); // newest first

            return { models, error: null };
          }

          case 'openai': {
            const url = 'https://api.openai.com/v1/models';
            let res: Response;
            try {
              res = await fetch(url, {
                method: 'GET',
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(8000),
              });
            } catch (connErr: unknown) {
              return {
                models: [],
                error: 'Cannot reach OpenAI API — check your internet connection.',
              };
            }

            if (res.status === 401) {
              return { models: [], error: 'Invalid API key (401). Check your OpenAI key.' };
            }
            if (!res.ok) {
              return { models: [], error: `OpenAI API error ${res.status}.` };
            }

            const data = await res.json().catch(() => ({}));
            const list: unknown[] = (data as any)?.data ?? [];
            const models = list
              .map((m: any) => m?.id)
              .filter((id): id is string => typeof id === 'string' && id.startsWith('gpt'))
              .sort()
              .reverse();

            return { models, error: null };
          }

          case 'gemini': {
            const geminiBase = 'https://generativelanguage.googleapis.com/v1beta/models';
            const geminiUrl = `${geminiBase}?key=${apiKey}`;
            let res: Response;
            try {
              res = await fetch(geminiUrl, {
                method: 'GET',
                signal: AbortSignal.timeout(8000),
              });
            } catch (connErr: unknown) {
              return {
                models: [],
                error: 'Cannot reach Gemini API — check your internet connection.',
              };
            }

            if (!res.ok) {
              return { models: [], error: `Gemini API error ${res.status}.` };
            }

            const data = await res.json().catch(() => ({}));
            const list: unknown[] = (data as any)?.models ?? [];
            const models = list
              .map((m: any) => m?.name?.replace('models/', '') ?? m?.id)
              .filter((id): id is string => typeof id === 'string' && id.includes('gemini'))
              .sort()
              .reverse();

            return { models, error: null };
          }

          case 'ollama': {
            const ollamaBase = baseUrl?.trim().replace(/\/+$/, '') || 'http://localhost:11434';
            const modelsUrl = `${ollamaBase}/api/tags`;
            let res: Response;
            try {
              res = await fetch(modelsUrl, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
              });
            } catch (connErr: unknown) {
              return {
                models: [],
                error: `Cannot reach Ollama at ${ollamaBase} — is Ollama running?`,
              };
            }

            if (!res.ok) {
              return { models: [], error: `Ollama error ${res.status}.` };
            }

            const data = await res.json().catch(() => ({}));
            const list: unknown[] = (data as any)?.models ?? [];
            const models = list
              .map((m: any) => m?.name)
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
              .sort();

            return { models, error: null };
          }

          case 'custom': {
            if (!baseUrl?.trim()) {
              return { models: [], error: 'Base URL is required for custom providers.' };
            }
            const normBase = baseUrl.trim().replace(/\/+$/, '');
            const modelsUrl = normBase.endsWith('/v1')
              ? `${normBase}/models`
              : `${normBase}/v1/models`;

            const headers: Record<string, string> = {};
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

            let res: Response;
            try {
              res = await fetch(modelsUrl, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(8000),
              });
            } catch (connErr: unknown) {
              return {
                models: [],
                error: `Cannot reach ${modelsUrl} — check your base URL.`,
              };
            }

            if (!res.ok) {
              // Many custom endpoints don't implement /models — return [] silently
              // so the user can still type their model name manually.
              return { models: [], error: null };
            }

            const data = await res.json().catch(() => ({}));
            const list: unknown[] = (data as any)?.data ?? [];
            const models = list
              .map((m: any) => m?.id ?? m?.name)
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
              .sort();

            return { models, error: null };
          }

          default:
            return { models: [], error: `Unknown provider: ${provider}` };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[fetch-models] Unexpected error:', msg);
        return { models: [], error: `Unexpected error: ${msg}` };
      }
    },
  );

  // =========================================================================
  // Phase 8 — Session Manager IPC Handlers
  // =========================================================================

  /**
   * Creates a new session for the given settings and total image count.
   * Overwrites any existing session.json in the output folder.
   *
   * Payload: { settings: AppSettings, totalImages: number }
   * Returns: Session
   */
  ipcMain.handle(
    'session-create',
    async (
      _event,
      payload: {
        settings: import('../shared/types').AppSettings;
        totalImages: number;
      },
    ) => {
      if (!payload?.settings || typeof payload.totalImages !== 'number') {
        throw new Error('session-create: invalid payload');
      }
      return createSession(payload.settings, payload.totalImages);
    },
  );

  /**
   * Loads the session from the output folder, or returns null if none exists.
   *
   * Payload: { outputFolder: string }
   * Returns: Session | null
   */
  ipcMain.handle(
    'session-load',
    async (_event, payload: { outputFolder: string }) => {
      if (!payload?.outputFolder) {
        throw new Error('session-load: outputFolder is required');
      }
      return loadSession(payload.outputFolder);
    },
  );

  /**
   * Saves a single ScoreRecord into the session and increments scoredCount.
   * Atomic — safe to call concurrently from a parallel scoring pool.
   *
   * Payload: { outputFolder: string, imageId: string, score: ScoreRecord }
   * Returns: true
   */
  ipcMain.handle(
    'session-save-score',
    async (
      _event,
      payload: {
        outputFolder: string;
        imageId: string;
        score: import('../shared/types').ScoreRecord;
      },
    ) => {
      if (!payload?.outputFolder || !payload?.imageId || !payload?.score) {
        throw new Error('session-save-score: invalid payload');
      }
      await saveScore(payload.outputFolder, payload.imageId, payload.score);
      return true;
    },
  );

  /**
   * Marks the session as completed.
   *
   * Payload: { outputFolder: string }
   * Returns: true
   */
  ipcMain.handle(
    'session-mark-complete',
    async (_event, payload: { outputFolder: string }) => {
      if (!payload?.outputFolder) {
        throw new Error('session-mark-complete: outputFolder is required');
      }
      await markSessionComplete(payload.outputFolder);
      return true;
    },
  );

  /**
   * Marks the session as cancelled.
   *
   * Payload: { outputFolder: string }
   * Returns: true
   */
  ipcMain.handle(
    'session-mark-cancelled',
    async (_event, payload: { outputFolder: string }) => {
      if (!payload?.outputFolder) {
        throw new Error('session-mark-cancelled: outputFolder is required');
      }
      await markSessionCancelled(payload.outputFolder);
      return true;
    },
  );

  /**
   * Saves the discovery-pass AI context string.
   *
   * Payload: { outputFolder: string, context: string }
   * Returns: true
   */
  ipcMain.handle(
    'session-save-discovery-context',
    async (_event, payload: { outputFolder: string; context: string }) => {
      if (!payload?.outputFolder || typeof payload?.context !== 'string') {
        throw new Error('session-save-discovery-context: invalid payload');
      }
      await saveDiscoveryContext(payload.outputFolder, payload.context);
      return true;
    },
  );

  /**
   * Saves the output shortfall reasons summary.
   *
   * Payload: { outputFolder: string, reasons: ShortfallReasons }
   * Returns: true
   */
  ipcMain.handle(
    'session-save-shortfall-reasons',
    async (
      _event,
      payload: {
        outputFolder: string;
        reasons: import('../shared/types').ShortfallReasons;
      },
    ) => {
      if (!payload?.outputFolder || !payload?.reasons) {
        throw new Error('session-save-shortfall-reasons: invalid payload');
      }
      await saveShortfallReasons(payload.outputFolder, payload.reasons);
      return true;
    },
  );

  /**
   * Deletes session.json (and .bak, .tmp if present) from the output folder.
   *
   * Payload: { outputFolder: string }
   * Returns: true
   */
  ipcMain.handle(
    'session-clear',
    async (_event, payload: { outputFolder: string }) => {
      if (!payload?.outputFolder) {
        throw new Error('session-clear: outputFolder is required');
      }
      await clearSession(payload.outputFolder);
      return true;
    },
  );

  /**
   * Returns true if a valid session.json exists in the output folder.
   * Used by the Processing screen to show the resume banner.
   *
   * Payload: { outputFolder: string }
   * Returns: boolean
   */
  ipcMain.handle(
    'session-has-existing',
    async (_event, payload: { outputFolder: string }) => {
      if (!payload?.outputFolder) return false;
      return hasExistingSession(payload.outputFolder);
    },
  );

  /**
   * Returns the Set of image IDs already scored in the session.
   * Used by the orchestrator to skip scored images on resume.
   *
   * Payload: { outputFolder: string }
   * Returns: string[]   (Array form of the Set — JSON-serialisable)
   */
  ipcMain.handle(
    'session-get-scored-ids',
    async (_event, payload: { outputFolder: string }) => {
      if (!payload?.outputFolder) return [];
      const session = await loadSession(payload.outputFolder);
      if (!session) return [];
      return Array.from(getScoredIds(session));
    },
  );

  // =========================================================================
  // Phase 10 — Full Pipeline IPC Handlers
  // =========================================================================

  /**
   * Starts the full culling pipeline for the given settings.
   *
   * Returns { started: true } immediately — the pipeline runs in the background
   * and pushes PipelineEvent objects to the renderer via:
   *   event.sender.send('pipeline-event', pipelineEvent)
   *
   * The API key is retrieved from the secure vault here — the renderer never
   * sends it. The returned settings object is augmented with the decrypted key
   * before being passed to runPipeline().
   *
   * Payload: AppSettings (apiKey field will be populated from vault)
   * Returns: { started: true }
   */
  ipcMain.handle(
    'pipeline-start',
    async (
      event,
      settings: import('../shared/types').AppSettings,
    ) => {
      if (!settings || typeof settings !== 'object') {
        throw new Error('pipeline-start: settings payload is required');
      }
      if (!settings.inputFolder || !settings.outputFolder) {
        throw new Error('pipeline-start: inputFolder and outputFolder are required');
      }

      const senderContentsId = event.sender.id;

      // ── Cancel any existing pipeline for this window ───────────────────────
      const existingPipeline = activePipelineJobs.get(senderContentsId);
      if (existingPipeline) {
        existingPipeline.abort();
        rejectPipelineConfirmation(senderContentsId);
        activePipelineJobs.delete(senderContentsId);
      }

      // ── Retrieve and inject API key from secure vault ──────────────────────
      // The renderer sends apiKey: '' (never persisted). We fetch it here.
      const apiKey = getApiKey(settings.provider as any) ?? '';
      const settingsWithKey: import('../shared/types').AppSettings = {
        ...settings,
        apiKey,
      };

      // ── Set up cancellation ────────────────────────────────────────────────
      const controller = new AbortController();
      activePipelineJobs.set(senderContentsId, controller);

      // ── Run the pipeline generator in the background ───────────────────────
      // Fire-and-forget IIFE — events are pushed as they arrive.
      (async () => {
        try {
          for await (const pipelineEvent of runPipeline(
            settingsWithKey,
            senderContentsId,
            controller.signal,
          )) {
            // Guard against destroyed webContents (window closed mid-run).
            if (event.sender.isDestroyed()) break;

            // Phase 14.3 — persist session history on successful completion
            if (pipelineEvent.type === 'pipeline-complete' && pipelineEvent.session) {
              try {
                const session = pipelineEvent.session;
                const scores  = Object.values(session.scores);
                const topScore = scores.length > 0
                  ? Math.max(...scores.map(s => s.total))
                  : 0;

                // Resolve profile name if one was active
                let profileName: string | null = null;
                if (settings.activeProfileId) {
                  const saved = (store.get('styleProfiles') as any[] | undefined) ?? [];
                  profileName = saved.find((p: any) => p.id === settings.activeProfileId)?.name ?? null;
                }

                const entry: import('../shared/types').SessionHistoryEntry = {
                  sessionId:      session.sessionId,
                  date:           session.createdAt,
                  inputFolder:    session.inputFolder,
                  imageCount:     session.totalImages,
                  profileUsed:    settings.activeProfileId ?? null,
                  profileName,
                  topScore:       Math.round(topScore * 100) / 100,
                  completedAt:    new Date().toISOString(),
                  genre:          settings.genre,
                  weights:        settings.weights,
                  preferenceText: settings.preferenceText ?? '',
                };

                const history = (store.get('sessionHistory') as any[] | undefined) ?? [];
                store.set('sessionHistory', [entry, ...history].slice(0, SESSION_HISTORY_MAX));
              } catch (histErr: unknown) {
                // Non-fatal — never block the pipeline-complete event for history I/O
                console.warn('[ipc] session-history write failed:', histErr);
              }
            }

            event.sender.send('pipeline-event', pipelineEvent);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[ipc] pipeline-start: unhandled pipeline error:', msg);
          if (!event.sender.isDestroyed()) {
            event.sender.send('pipeline-event', {
              type: 'pipeline-error',
              code: 'UNEXPECTED',
              message: msg,
              recoverable: false,
            });
          }
        } finally {
          activePipelineJobs.delete(senderContentsId);
        }
      })();

      // Return immediately — the renderer subscribes to 'pipeline-event' pushes.
      return { started: true };
    },
  );

  /**
   * Cancels an in-flight pipeline for the calling window.
   *
   * Aborts the generator via AbortController, resolves any pending §10.5
   * confirmation waiter with a rejection, and marks the session as cancelled.
   *
   * Payload: { outputFolder: string }
   * Returns: true
   */
  ipcMain.handle(
    'pipeline-cancel',
    async (
      event,
      payload: { outputFolder: string },
    ) => {
      const senderContentsId = event.sender.id;

      // Abort the running generator.
      const controller = activePipelineJobs.get(senderContentsId);
      if (controller) {
        controller.abort();
        activePipelineJobs.delete(senderContentsId);
      }

      // Resolve any pending §10.5 confirmation waiter so the generator can exit.
      rejectPipelineConfirmation(senderContentsId);

      // Mark the session cancelled if we have an output folder.
      if (payload?.outputFolder) {
        try {
          await markSessionCancelled(payload.outputFolder);
        } catch { /* non-fatal */ }
      }

      return true;
    },
  );

  /**
   * Signals the pipeline generator to proceed after the §10.5 input-count
   * confirmation dialog.
   *
   * The generator is paused at a Promise stored in pendingConfirmations (in
   * orchestrator.ts). Calling this handler resolves that Promise and resumes
   * the generator from where it left off.
   *
   * Payload: none
   * Returns: true
   */
  ipcMain.handle(
    'pipeline-confirm-continue',
    (_event) => {
      resolvePipelineConfirmation(_event.sender.id);
      return true;
    },
  );
  // ── Phase 10.7 – Fill shortfall by promoting lower-tier images ────────────

  /**
   * Promotes B-tier (or rejected, depending on shortfallStrategy) images
   * to A-tier until the session reaches the originally requested keeper count.
   *
   * Payload: { outputFolder: string, targetCount: number }
   * Returns: Session (updated)
   */
  ipcMain.handle(
    'pipeline-fill-shortfall',
    async (_event, payload: { outputFolder: string; targetCount: number }) => {
      if (!payload?.outputFolder || typeof payload.targetCount !== 'number') {
        throw new Error('pipeline-fill-shortfall: invalid payload');
      }
      const { outputFolder, targetCount } = payload;
      const updatedSession = await fillShortfall(outputFolder, targetCount);
      return updatedSession;
    },
  );

  // -------------------------------------------------------------------------
  // Phase 12 — Results Screen IPC
  // -------------------------------------------------------------------------

  /**
   * Updates the tier of a single image in the persisted session.
   * Used by the Results screen when the user manually overrides via keyboard
   * shortcuts (P/X/R) or other UI interactions.
   *
   * Payload: { outputFolder: string, imageId: string, newTier: 'S' | 'A' | 'B' | 'rejected' }
   * Returns: ScoreRecord | null
   */
  ipcMain.handle(
    'session-update-tier',
    async (
      _event,
      payload: { outputFolder: string; imageId: string; newTier: 'S' | 'A' | 'B' | 'rejected' },
    ) => {
      if (!payload?.outputFolder || !payload?.imageId || !payload?.newTier) {
        throw new Error('session-update-tier: missing required fields');
      }
      const validTiers = ['S', 'A', 'B', 'rejected'];
      if (!validTiers.includes(payload.newTier)) {
        throw new Error(`session-update-tier: invalid tier "${payload.newTier}"`);
      }
      return updateTier(payload.outputFolder, payload.imageId, payload.newTier);
    },
  );

  /**
   * Exports session results as a clean, user-facing JSON file.
   *
   * The export is a sidecar-style array of objects with only the fields that
   * matter to downstream tools (Lightroom, scripts, manual review). Internal
   * IDs, session metadata, and thumbnails are excluded.
   *
   * Payload: { outputFolder: string }
   * Returns: { filePath: string, imageCount: number }
   */
  ipcMain.handle(
    'export-results-json',
    async (_event, payload: { outputFolder: string }) => {
      if (!payload?.outputFolder) {
        throw new Error('export-results-json: outputFolder is required');
      }
      const session = await loadSession(payload.outputFolder);
      if (!session) {
        throw new Error('export-results-json: no session found in output folder');
      }

      // Build clean export array
      const results = Object.values(session.scores).map((score) => ({
        filename: score.filename,
        tier: score.tier,
        score: score.total,
        scores: {
          quality: score.scores.quality,
          aesthetic: score.scores.aesthetic,
          composition: score.scores.composition,
          sharpness: score.scores.sharpness,
          exposure: score.scores.exposure,
          faceEyes: score.scores.faceEyes,
        },
        reasoning: score.reasoning,
        keywords: score.keywords ?? [],
        faces: score.faceMetadata ? {
          detected: score.faceMetadata.hasFaces,
          count: score.faceMetadata.faceCount,
          eyesOpen: score.faceMetadata.eyesOpen,
          blinkDetected: score.faceMetadata.blinkDetected,
        } : null,
      }));

      // Sort: S first, then A, B, rejected; within each tier, by score desc
      const tierOrder: Record<string, number> = { S: 0, A: 1, B: 2, rejected: 3 };
      results.sort((a, b) => {
        const tierDiff = (tierOrder[a.tier] ?? 4) - (tierOrder[b.tier] ?? 4);
        if (tierDiff !== 0) return tierDiff;
        return b.score - a.score;
      });

      const exportPath = path.join(path.resolve(payload.outputFolder), 'results.json');
      await fs.promises.writeFile(exportPath, JSON.stringify(results, null, 2), 'utf8');

      if (process.env.NODE_ENV === 'development') {
        console.log(`[ipc] export-results-json → ${exportPath} (${results.length} images)`);
      }

      return { filePath: exportPath, imageCount: results.length };
    },
  );

  // ── 12b.5 — Export Scores as CSV ──────────────────────────────────────────

  /**
   * Exports all session scores as a UTF-8 BOM CSV (Excel-friendly).
   * Columns: Filename, Tier, Total Score, Quality, Aesthetic, Composition,
   *          Sharpness, Exposure, FaceEyes, Reasoning
   * Sorted by total score descending.
   *
   * Payload: { outputFolder: string }
   * Returns: { filePath: string, imageCount: number } | null (null if cancelled)
   */
  ipcMain.handle(
    'export-results-csv',
    async (_event, payload: { outputFolder: string }) => {
      if (!payload?.outputFolder) {
        throw new Error('export-results-csv: outputFolder is required');
      }
      const session = await loadSession(payload.outputFolder);
      if (!session) {
        throw new Error('export-results-csv: no session found in output folder');
      }

      // UTF-8 BOM so Windows Excel opens without encoding dialog
      const BOM = '\uFEFF';
      const HEADER = 'Filename,Tier,Total Score,Quality,Aesthetic,Composition,Sharpness,Exposure,FaceEyes,Keywords,Reasoning\n';

      const rows = Object.values(session.scores)
        .sort((a, b) => b.total - a.total)
        .map(r => {
          // Wrap multi-word fields in quotes; escape any internal double-quotes
          const reasoning = `"${(r.reasoning || '').replace(/"/g, '""')}"`;
          // Keywords joined with semicolons inside a quoted cell (Phase 13b)
          const keywords  = r.keywords && r.keywords.length > 0
            ? `"${r.keywords.join('; ').replace(/"/g, '""')}"`
            : '';
          return [
            r.filename,
            r.tier,
            r.total.toFixed(2),
            r.scores.quality,
            r.scores.aesthetic,
            r.scores.composition,
            r.scores.sharpness,
            r.scores.exposure,
            r.scores.faceEyes,
            keywords,
            reasoning,
          ].join(',');
        })
        .join('\n');

      const csvContent = BOM + HEADER + rows;

      const { filePath, canceled } = await dialog.showSaveDialog({
        defaultPath: path.join(payload.outputFolder, 'cullai_scores.csv'),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (canceled || !filePath) return null;

      await fs.promises.writeFile(filePath, csvContent, 'utf-8');

      if (process.env.NODE_ENV === 'development') {
        console.log(`[ipc] export-results-csv → ${filePath} (${Object.keys(session.scores).length} images)`);
      }

      return { filePath, imageCount: Object.keys(session.scores).length };
    },
  );

  // ── 12b.6 — Export Session as Portable Archive (.zip) ─────────────────────

  /**
   * Zips session.json, results.json, and all XMP sidecars into a user-chosen
   * .zip file. Emits 'zip-progress' events (0–100) during archiving.
   *
   * Payload: { outputFolder: string }
   * Returns: { filePath: string, fileCount: number } | null (null if cancelled)
   */
  ipcMain.handle(
    'export-session-zip',
    async (event, payload: { outputFolder: string }) => {
      if (!payload?.outputFolder) {
        throw new Error('export-session-zip: outputFolder is required');
      }

      const outputFolder = payload.outputFolder;

      // Choose save path
      const { filePath, canceled } = await dialog.showSaveDialog({
        defaultPath: path.join(outputFolder, `cullai_session_${Date.now()}.zip`),
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      });
      if (canceled || !filePath) return null;

      // Collect files to include
      const filesToZip: { disk: string; archive: string }[] = [];

      const candidates = [
        path.join(outputFolder, 'session.json'),
        path.join(outputFolder, 'results.json'),
      ];
      for (const f of candidates) {
        if (fs.existsSync(f)) {
          filesToZip.push({ disk: f, archive: path.basename(f) });
        }
      }

      // Collect XMP sidecars via recursive walk (no glob dep needed)
      const findXmpFiles = (dir: string, baseDir: string): void => {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            // Skip the thumbnail cache directory
            if (entry.name !== '.cullai_cache') {
              findXmpFiles(fullPath, baseDir);
            }
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xmp')) {
            filesToZip.push({
              disk: fullPath,
              archive: path.relative(baseDir, fullPath),
            });
          }
        }
      };
      findXmpFiles(outputFolder, outputFolder);

      // Create archive with progress events
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 6 } });

        archive.on('progress', (progressData) => {
          const pct = Math.round(
            (progressData.entries.processed / Math.max(1, progressData.entries.total)) * 100,
          );
          if (!event.sender.isDestroyed()) {
            event.sender.send('zip-progress', pct);
          }
        });

        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);

        for (const { disk, archive: archivePath } of filesToZip) {
          archive.file(disk, { name: archivePath });
        }

        archive.finalize();
      });

      if (process.env.NODE_ENV === 'development') {
        console.log(`[ipc] export-session-zip → ${filePath} (${filesToZip.length} files)`);
      }

      return { filePath, fileCount: filesToZip.length };
    },
  );

  // ── Phase 13 — Export XMP Sidecars ───────────────────────────────────────

  /**
   * Writes XMP sidecar files alongside original images so that Lightroom
   * Classic and Capture One can read star ratings, colour labels, AI
   * reasoning, and keyword tags without modifying the originals.
   *
   * The caller supplies an `imagePathMap` that maps each score's filename to
   * its absolute path on disk. The renderer builds this map from
   * session.settings.inputFolder + score.filename (with subfolder support
   * for processSubfolders sessions).
   *
   * Tier → Lightroom mapping:
   *   S        → 5 stars, Green label
   *   A        → 4 stars, Blue label
   *   B        → 3 stars, Yellow label
   *   rejected → 1 star,  Red label
   *
   * Payload:
   *   {
   *     outputFolder:       string,               // to load session scores
   *     imagePathMap:       Record<string,string>, // filename → absolutePath
   *     includeDescription: boolean,              // embed AI reasoning in dc:description
   *   }
   * Returns:
   *   { written: number; errors: string[] }
   *
   * Errors are per-file and collected rather than thrown, so one bad path
   * does not abort the entire batch. The renderer should surface the error
   * count as a warning toast if errors.length > 0.
   */
  ipcMain.handle(
    'export-xmp',
    async (
      _event,
      payload: {
        outputFolder: string;
        imagePathMap: Record<string, string>;
        includeDescription: boolean;
      },
    ) => {
      if (!payload?.outputFolder) {
        throw new Error('export-xmp: outputFolder is required');
      }
      if (!payload.imagePathMap || typeof payload.imagePathMap !== 'object') {
        throw new Error('export-xmp: imagePathMap must be a filename→path object');
      }

      const session = await loadSession(payload.outputFolder);
      if (!session) {
        throw new Error('export-xmp: no session found in output folder');
      }

      const scores = Object.values(session.scores);
      if (scores.length === 0) {
        return { written: 0, errors: [] };
      }

      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[ipc] export-xmp — ${scores.length} images, includeDescription=${payload.includeDescription}`,
        );
      }

      return writeAllSidecars(scores, payload.imagePathMap, payload.includeDescription);
    },
  );

  // ── 12b.4 — Re-score Selected Images with New Weights ─────────────────────

  /**
   * Re-scores a subset of already-processed images using the current
   * settings.weights without re-running folder scan or duplicate detection.
   * Emits 'pipeline-event' (pipeline-image-scored) for each scored image so
   * the renderer can update tiles in real time.
   *
   * Payload: { imageIds: string[], outputFolder: string, settings: AppSettings }
   * Returns: void
   */
  ipcMain.handle(
    're-score-images',
    async (_event, payload: {
      imageIds: string[];
      outputFolder: string;
      settings: import('../shared/types').AppSettings;
    }) => {
      if (!payload?.outputFolder || !Array.isArray(payload?.imageIds)) {
        throw new Error('re-score-images: invalid payload');
      }
      return rescoreImages(
        payload.imageIds,
        payload.outputFolder,
        payload.settings,
        _event.sender,
      );
    },
  );

  // ── Phase 13b — AI Auto-Tagging (on-demand from Results screen) ───────────

  /**
   * Generates AI keyword tags for the S and A-tier keepers of an already-
   * completed session. Called from the Results screen when the user clicks
   * "Generate AI Keywords". Reads thumbnails from the session's
   * `.cullai_cache/thumbnails/` directory as the image source.
   *
   * This handler enforces the Pro license gate — Free tier users receive an
   * error response instead of a thrown exception, so the renderer can display
   * a human-readable upgrade prompt.
   *
   * Payload: { outputFolder: string, settings: AppSettings }
   * Returns: { success: true, written: number }
   *        | { success: false, error: string }
   */
  ipcMain.handle(
    'run-auto-tagging',
    async (
      _event,
      payload: {
        outputFolder: string;
        settings: import('../shared/types').AppSettings;
      },
    ) => {
      if (!payload?.outputFolder) {
        throw new Error('run-auto-tagging: outputFolder is required');
      }
      if (!payload.settings || typeof payload.settings !== 'object') {
        throw new Error('run-auto-tagging: settings is required');
      }

      // ── License gate ──────────────────────────────────────────────────────
      const tier = getLicenseTier();
      if (!isAllowed('autoTagging' as Feature, tier)) {
        return {
          success: false,
          error: 'AI keyword tagging requires a Pro or Lifetime license. Upgrade to unlock this feature.',
        };
      }

      const session = await loadSession(payload.outputFolder);
      if (!session) {
        throw new Error('run-auto-tagging: no session found in output folder');
      }

      const devMode = process.env.NODE_ENV === 'development';
      const thumbDir = path.join(
        path.resolve(payload.outputFolder),
        '.cullai_cache',
        'thumbnails',
      );

      // ── Build TaggingEntry array from session thumbnails ──────────────────
      //
      // We read from the pre-generated ~200px thumbnails rather than the full
      // 1024px previews. This keeps the on-demand tagging call cheap and
      // consistent with the thumbnail quality the user sees in the gallery.
      const tagEntries: import('./auto-tagging').TaggingEntry[] = [];

      for (const [id, record] of Object.entries(session.scores)) {
        if (record.tier !== 'S' && record.tier !== 'A') continue;

        const thumbPath = path.join(thumbDir, `${id}.jpg`);
        try {
          const buf = await fs.promises.readFile(thumbPath);
          tagEntries.push({
            id,
            record,
            imageBase64: buf.toString('base64'),
          });
        } catch {
          if (devMode) {
            console.warn(
              `[ipc:run-auto-tagging] No thumbnail for ${record.filename} — skipping`,
            );
          }
        }
      }

      if (tagEntries.length === 0) {
        return { success: true, written: 0 };
      }

      if (devMode) {
        console.log(
          `[ipc:run-auto-tagging] Running on ${tagEntries.length} S/A-tier keepers`,
        );
      }

      // ── Run tagging and persist results ───────────────────────────────────
      const keywordMap = await runAutoTagging(tagEntries, payload.settings);

      let written = 0;
      for (const [id, keywords] of keywordMap) {
        const record = session.scores[id];
        if (!record) continue;
        record.keywords = keywords;
        try {
          await saveScore(payload.outputFolder, id, record);
          written++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[ipc:run-auto-tagging] saveScore failed for ${record.filename}: ${msg}`);
        }
      }

      if (devMode) {
        console.log(`[ipc:run-auto-tagging] Done — ${written} images tagged`);
      }

      return { success: true, written };
    },
  );

  // =========================================================================
  // Phase 14.2 — Style Profile Storage
  // =========================================================================

  /**
   * Returns all saved StyleProfile objects, newest-first.
   * Returns an empty array if no profiles have been saved yet.
   */
  ipcMain.handle('profiles-list', () => {
    const profiles = store.get('styleProfiles') as import('../shared/types').StyleProfile[] | undefined;
    return profiles ?? [];
  });

  /**
   * Saves (creates or updates) a single StyleProfile by its `id` field.
   * If a profile with the same id exists it is replaced; otherwise appended.
   *
   * Payload: StyleProfile  (must have a non-empty id string)
   * Returns: true
   */
  ipcMain.handle('profiles-save', (_event, profile: import('../shared/types').StyleProfile) => {
    if (!profile?.id || typeof profile.id !== 'string') {
      throw new Error('profiles-save: profile.id is required');
    }
    if (!profile.name || typeof profile.name !== 'string') {
      throw new Error('profiles-save: profile.name is required');
    }
    if (!profile.genre || !profile.weights) {
      throw new Error('profiles-save: profile.genre and profile.weights are required');
    }

    const current = (store.get('styleProfiles') as import('../shared/types').StyleProfile[] | undefined) ?? [];
    const exists = current.some(p => p.id === profile.id);
    const updated = exists
      ? current.map(p => p.id === profile.id ? profile : p)
      : [...current, profile];

    store.set('styleProfiles', updated);
    return true;
  });

  /**
   * Removes a StyleProfile by id. No-op if the id is not found.
   *
   * Payload: id string
   * Returns: true
   */
  ipcMain.handle('profiles-delete', (_event, id: string) => {
    if (!id || typeof id !== 'string') {
      throw new Error('profiles-delete: id is required');
    }
    const current = (store.get('styleProfiles') as import('../shared/types').StyleProfile[] | undefined) ?? [];
    store.set('styleProfiles', current.filter(p => p.id !== id));
    return true;
  });

  // =========================================================================
  // Phase 14.3 — Session History
  // =========================================================================

  const SESSION_HISTORY_MAX = 10;

  /**
   * Returns the last SESSION_HISTORY_MAX completed session summaries.
   * Newest entry first.
   *
   * Returns: SessionHistoryEntry[]
   */
  ipcMain.handle('session-history-get', () => {
    const history = store.get('sessionHistory') as import('../shared/types').SessionHistoryEntry[] | undefined;
    return history ?? [];
  });
}