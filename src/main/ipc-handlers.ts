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
import { getCacheStats, clearCache, setCacheConfig } from './raw-cache';
import { enforceCacheLimits } from './cache-cleaner';

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

      // ── Phase 6 TODO ───────────────────────────────────────────────────────
      // Replace everything below this comment with real detection logic:
      //
      //   import { detectFaces } from './face-detector';
      //   const buffer = Buffer.from(payload.base64, 'base64');
      //   return await detectFaces(buffer, payload.maxFacesPerImage ?? 0);
      //
      // The stub deliberately decodes the buffer to validate it is a real
      // base64 string (throws on garbage input) without importing libraw or
      // @vladmandic/human, which are not available until Phase 6.
      // ──────────────────────────────────────────────────────────────────────

      // Validate: must be a decodeable base64 string.
      const buffer = Buffer.from(payload.base64, 'base64');
      if (buffer.length === 0) {
        throw new Error('scan-faces: decoded buffer is empty');
      }

      // Stub response — shape matches FaceMetadata from src/shared/types.ts.
      return {
        hasFaces: false,
        faceCount: 0,
        eyesOpen: true,
        blinkDetected: false,
        expressionNeutral: true,
        boundingBoxes: [],
        exceedsFaceLimit: false,
      };
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
   * Deletes the stored key for `provider`. No-op if nothing is stored.
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
    ): Promise<{ models: string[]; error: string | null }> => {
      const { provider, baseUrl } = payload ?? {};
  
      // Retrieve the stored key from the secure vault — never from the renderer.
      const apiKey = getApiKey(provider as any);
  
      try {
        switch (provider) {
          // ── Claude (Anthropic) ─────────────────────────────────────────────
          case 'claude': {
            if (!apiKey) {
              return { models: [], error: 'No API key stored for Claude. Enter your key above.' };
            }
  
            const res = await fetch('https://api.anthropic.com/v1/models', {
              method: 'GET',
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
            });
  
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              const msg = (body as any)?.error?.message ?? res.statusText;
              return { models: [], error: `Anthropic API error ${res.status}: ${msg}` };
            }
  
            const data = await res.json() as { data: Array<{ id: string }> };
            const models = (data.data ?? [])
              .map((m) => m.id)
              .filter((id) => typeof id === 'string' && id.startsWith('claude-'))
              .sort();
            return { models, error: null };
          }
  
          // ── OpenAI ─────────────────────────────────────────────────────────
          case 'openai': {
            if (!apiKey) {
              return { models: [], error: 'No API key stored for OpenAI. Enter your key above.' };
            }
  
            const res = await fetch('https://api.openai.com/v1/models', {
              method: 'GET',
              headers: { Authorization: `Bearer ${apiKey}` },
            });
  
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              const msg = (body as any)?.error?.message ?? res.statusText;
              return { models: [], error: `OpenAI API error ${res.status}: ${msg}` };
            }
  
            const data = await res.json() as {
              data: Array<{ id: string; owned_by: string; created: number }>;
            };
  
            // Keep only chat-capable models published by OpenAI.
            // The id prefix heuristic covers gpt-*, o1-*, o3-*, o4-*, etc.
            // We intentionally exclude fine-tuned, embedding, TTS and image models.
            const CHAT_PREFIXES = ['gpt-', 'o1', 'o3', 'o4', 'chatgpt-'];
            const EXCLUDE = ['instruct', 'embed', 'tts', 'dall-e', 'whisper', 'moderation'];
  
            const models = (data.data ?? [])
              .filter((m) => {
                const id = m.id.toLowerCase();
                const owned = m.owned_by?.toLowerCase() ?? '';
                return (
                  (owned === 'openai' || owned === 'system') &&
                  CHAT_PREFIXES.some((p) => id.startsWith(p)) &&
                  !EXCLUDE.some((e) => id.includes(e))
                );
              })
              // Newest first
              .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
              .map((m) => m.id);
  
            return { models, error: null };
          }
  
          // ── Gemini (Google AI) ─────────────────────────────────────────────
          case 'gemini': {
            if (!apiKey) {
              return { models: [], error: 'No API key stored for Gemini. Enter your key above.' };
            }
  
            // Key goes in the query string; the endpoint does NOT use a Bearer header.
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`;
            const res = await fetch(url, { method: 'GET' });
  
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              const msg = (body as any)?.error?.message ?? res.statusText;
              return { models: [], error: `Gemini API error ${res.status}: ${msg}` };
            }
  
            const data = await res.json() as {
              models: Array<{
                name: string;
                supportedGenerationMethods?: string[];
              }>;
            };
  
            const models = (data.models ?? [])
              .filter(
                (m) =>
                  Array.isArray(m.supportedGenerationMethods) &&
                  m.supportedGenerationMethods.includes('generateContent'),
              )
              // name is "models/gemini-2.5-flash" → strip the prefix
              .map((m) => m.name.replace(/^models\//, ''))
              .filter((id) => id.startsWith('gemini-'))
              .sort();
  
            return { models, error: null };
          }
  
          // ── Ollama (local) ─────────────────────────────────────────────────
          case 'ollama': {
            // Resolve the tags endpoint from the configured baseUrl.
            // The renderer stores http://localhost:11434/v1 (OpenAI-compat path)
            // but the tags endpoint lives at http://localhost:11434/api/tags.
            let host = (baseUrl ?? 'http://localhost:11434').trim();
            // Strip any /v1 or /openai/v1 suffix to get the bare host
            host = host.replace(/\/(v\d+|openai\/v\d+)\/?$/, '').replace(/\/+$/, '');
            const tagsUrl = `${host}/api/tags`;
  
            let res: Response;
            try {
              res = await fetch(tagsUrl, {
                method: 'GET',
                // 5 s timeout — Ollama may not be running
                signal: AbortSignal.timeout(5000),
              });
            } catch (connErr: unknown) {
              const msg =
                connErr instanceof Error && connErr.name === 'TimeoutError'
                  ? 'Ollama did not respond within 5 s — is it running?'
                  : `Cannot reach Ollama at ${host} — is it running?`;
              return { models: [], error: msg };
            }
  
            if (!res.ok) {
              return { models: [], error: `Ollama error ${res.status}: ${res.statusText}` };
            }
  
            const data = await res.json() as {
              models: Array<{ name: string; model: string }>;
            };
  
            const models = (data.models ?? [])
              .map((m) => m.name ?? m.model)
              .filter((n): n is string => typeof n === 'string' && n.length > 0)
              .sort();
  
            return { models, error: null };
          }
  
          // ── Custom (OpenAI-compatible) ─────────────────────────────────────
          case 'custom': {
            if (!baseUrl) {
              return { models: [], error: 'No base URL configured for custom provider.' };
            }
  
            const modelsUrl = `${baseUrl.replace(/\/+$/, '')}/models`;
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
}