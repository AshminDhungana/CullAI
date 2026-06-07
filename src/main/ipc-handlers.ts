/**
 * ipc-handlers.ts
 *
 * All Electron IPC handlers in one place. Called once from index.ts after
 * electron-store has initialised, so `store` is guaranteed non-null — no
 * race condition, no null guards needed inside individual handlers.
 *
 * Registration is idempotent-safe: each handler is only registered once
 * because this module is only imported and called once (from app.whenReady).
 */

import { dialog, ipcMain, shell, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type Store from 'electron-store';

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
 *
 * Rules:
 *  - Leading `**/` is treated as "in any subdirectory" — matches from the
 *    start of the filename or any slash-preceded position.
 *  - A bare `*.ext` or `name.*` pattern matches the filename only (no `/`).
 *  - Patterns with no special chars are treated as exact-name matches.
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
// Main export
// ---------------------------------------------------------------------------

export function registerIpcHandlers(store: InstanceType<typeof Store>): void {

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
   * Returns `{ count: number }`.
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
      const resolved = path.resolve(folderPath);
      const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
      let names = entries
        .filter(e => e.isFile() && !e.name.startsWith('.'))
        .map(e => e.name);

      if (extensions && extensions.length > 0) {
        const extSet = new Set(extensions.map(e => e.toLowerCase()));
        names = names.filter(n => extSet.has(path.extname(n).toLowerCase()));
      }

      if (prefixes && prefixes.length > 0) {
        names = names.filter(n => prefixes.some(p => n.startsWith(p)));
      }

      // Apply .cullaiignore patterns last, after extension and prefix filters.
      if (ignorePatterns && ignorePatterns.length > 0) {
        names = applyIgnorePatterns(names, ignorePatterns);
      }

      return { count: names.length };
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
}