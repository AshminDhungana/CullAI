const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Phase 3.2 — Secure storage availability ───────────────────────────────
  /**
   * Returns true if the OS keychain (DPAPI / Keychain / kwallet) is available
   * and safeStorage encryption is usable on this machine.
   * Used by EncryptionStatusBadge in the AI setup step.
   *
   * @returns {Promise<boolean>}
   */
  isSafeStorageAvailable: () => ipcRenderer.invoke('safe-storage-available'),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings:  ()           => ipcRenderer.invoke('settings-get'),
  saveSettings: (settings)   => ipcRenderer.invoke('settings-set', settings),

  // ── License ───────────────────────────────────────────────────────────────
  licenseActivate:    (key)      => ipcRenderer.invoke('license:activate', key),
  licenseDeactivate:  ()         => ipcRenderer.invoke('license:deactivate'),
  licenseGetStatus:   ()         => ipcRenderer.invoke('license:get-status'),
  licenseGetTier:     ()         => ipcRenderer.invoke('license:get-tier'),
  licenseCheckFeature: (feature) => ipcRenderer.invoke('license:check-feature', feature),
  licenseCheckQuota:  (count)    => ipcRenderer.invoke('license:check-quota', count),
  licenseIncrementUsage: (count) => ipcRenderer.invoke('license:increment-usage', count),

  // ── Recent folders ────────────────────────────────────────────────────────
  /** Returns { input: string[], output: string[] } — both lists, newest-first. */
  getRecentFolders: () =>
    ipcRenderer.invoke('recent-folders-get'),

  /**
   * Prepends `path` to the named list, de-dupes, caps at 10.
   * Returns the updated string[] so callers don't need a second round-trip.
   * @param {{ kind: 'input' | 'output', path: string }} payload
   */
  updateRecentFolder: (payload) =>
    ipcRenderer.invoke('recent-folders-update', payload),

  // ── Folder helpers ────────────────────────────────────────────────────────
  folderExists:         (folder)                                    => ipcRenderer.invoke('folder-exists', folder),
  /**
   * Counts (and returns paths of) files in a folder matching optional filters.
   * All arguments after `folder` are optional.
   *
   * @param {string}   folder          Absolute folder path.
   * @param {string[]} [extensions]    Lowercase dot-prefixed extensions, e.g. ['.jpg', '.cr3'].
   * @param {string[]} [prefixes]      Filename prefixes; empty = no prefix filter.
   * @param {string[]} [ignorePatterns] Parsed `.cullaiignore` glob patterns; empty = no exclusions.
   * @returns {Promise<{ count: number, filePaths: string[] }>}
   */
  scanFolder:           (folder, extensions, prefixes, ignorePatterns) => ipcRenderer.invoke('scan-folder', folder, extensions, prefixes, ignorePatterns),
  openFolderDialog:     ()                                          => ipcRenderer.invoke('open-folder-dialog'),
  scanFolderPrefixes:   (folder, prefixes, caseInsens)              => ipcRenderer.invoke('scan-folder-prefixes', folder, prefixes, caseInsens),
  scanFolderExtensions: (folder)                                    => ipcRenderer.invoke('scan-folder-extensions', folder),

  /**
   * Reads `.cullaiignore` from the root of `folderPath` and returns parsed
   * pattern strings (non-empty, non-comment lines), or `null` if the file
   * does not exist.
   *
   * @param {string} folderPath  Absolute path to the input folder.
   * @returns {Promise<string[] | null>}
   */
  parseCullaiIgnore: (folderPath) =>
    ipcRenderer.invoke('parse-cullaiignore', folderPath),

  // ── Phase 5 — Image processing pipeline ──────────────────────────────────

  /**
   * Processes all images in `folderPath` and streams each ImageRecord back to
   * the renderer via the 'image-record' push event (see onImageRecord below).
   *
   * Call onImageRecord() BEFORE calling processImages() to ensure no records
   * are missed.
   *
   * Rejects with { code: 'FREE_LIMIT_EXCEEDED' | 'QUOTA_PARTIAL', remaining }
   * if the Free tier monthly quota would be exceeded.
   *
   * @param {string} folderPath  Absolute path to the input folder.
   * @param {object} [options]   Filter and processing options:
   *   extensions?          {string[]}  Dot-prefixed extensions to include.
   *   prefixes?            {string[]}  Filename prefixes to include.
   *   prefixCaseInsensitive? {boolean} Case-insensitive prefix match (default true).
   *   ignorePatterns?      {string[]}  Parsed .cullaiignore patterns.
   *   recursive?           {boolean}   Recurse into subfolders (default false).
   *   useEmbeddedPreview?  {boolean}   Use embedded RAW preview (default true).
   * @returns {Promise<{ processed: number, skipped: number, cancelled?: true }>}
   */
  processImages: (folderPath, options) =>
    ipcRenderer.invoke('process-images', folderPath, options),

  /**
   * Registers a callback to receive ImageRecord objects streamed from the main
   * process during a processImages() run.
   *
   * Returns an unsubscribe function — call it when the Processing screen
   * unmounts (or when processing completes) to avoid listener leaks.
   *
   * Usage:
   *   const unsub = window.electronAPI.onImageRecord((record) => {
   *     // record: ImageRecord from src/shared/types.ts
   *   });
   *   // later:
   *   unsub();
   *
   * @param {(record: ImageRecord) => void} callback
   * @returns {() => void} Unsubscribe function.
   */
  onImageRecord: (callback) => {
    const handler = (_event, record) => callback(record);
    ipcRenderer.on('image-record', handler);
    // Return an explicit unsubscribe so callers can clean up without knowing
    // the internal channel name.
    return () => ipcRenderer.removeListener('image-record', handler);
  },

  /**
   * Cancels an in-flight processImages() run for this window.
   * No-op if no run is active. The original processImages() promise will
   * resolve (not reject) with { processed, skipped, cancelled: true }.
   *
   * @returns {Promise<true>}
   */
  processImagesCancel: () =>
    ipcRenderer.invoke('process-images-cancel'),

  // ── File helpers ──────────────────────────────────────────────────────────
  readFileAsBase64: (filePath)  => ipcRenderer.invoke('read-file-as-base64', filePath),
  openFileDialog:   (options)   => ipcRenderer.invoke('open-file-dialog', options),

  // ── Face detection ────────────────────────────────────────────────────────
  /**
   * Runs face detection on a base64-encoded JPEG and returns a FaceMetadata
   * object. Phase 6 replaces the main-process stub with real detection;
   * this preload binding requires no changes when that happens.
   *
   * @param {string}  base64           Plain base64 JPEG (no data-URI prefix).
   * @param {number}  [maxFacesPerImage=0]  0 = no limit check.
   * @returns {Promise<FaceMetadata>}
   */
  scanFaces: (base64, maxFacesPerImage = 0) =>
    ipcRenderer.invoke('scan-faces', { base64, maxFacesPerImage }),

  // ── Folder safety ─────────────────────────────────────────────────────────
  /**
   * Returns 'same' | 'output-inside-input' | 'input-inside-output' | 'ok'.
   * Session-only use — not persisted.
   */
  checkFolderRelationship: (input, output) =>
    ipcRenderer.invoke('check-folder-relationship', { input, output }),

  // ── Shell ─────────────────────────────────────────────────────────────────
  /**
   * Reveals `folderPath` in the native file manager (Explorer / Finder).
   * Throws with `{ code: 'EMPTY_PATH' }` or `{ code: 'NOT_FOUND' }` so the
   * renderer can show an appropriate inline warning without a modal.
   */
  shellShowItem: (folderPath) => ipcRenderer.invoke('shell-show-item', folderPath),

  // ── Secure API key storage ────────────────────────────────────────────────
  /**
   * Encrypts and persists the API key for `provider` in the OS keychain.
   * The raw key is never written to any settings file or log.
   *
   * @param {string} provider  AIProvider string ('claude', 'openai', etc.)
   * @param {string} key       The raw API key entered by the user.
   * @returns {Promise<true>}
   */
  storeApiKey: (provider, key) =>
    ipcRenderer.invoke('api-key-store', provider, key),

  /**
   * Decrypts and returns the stored key for `provider`, or null if none
   * is stored. The renderer must immediately mask this value — it should
   * never be persisted back to the settings store or logged.
   *
   * @param {string} provider  AIProvider string.
   * @returns {Promise<string | null>}
   */
  getApiKey: (provider) =>
    ipcRenderer.invoke('api-key-get', provider),

  /**
   * Permanently removes the stored key for `provider`.
   *
   * @param {string} provider  AIProvider string.
   * @returns {Promise<true | undefined>}
   */
  deleteApiKey: (provider) =>
    ipcRenderer.invoke('api-key-delete', provider),

  // ── Phase 5b — RAW Cache Management ────────────────────────────────────

  /**
   * Returns cache statistics for the given input folder.
   * @param {string} inputFolder  Absolute path to the input folder.
   * @returns {Promise<{ sizeBytes: number, fileCount: number, oldestEntry: string|null }>}
   */
  getRawCacheStats: (inputFolder) =>
    ipcRenderer.invoke('raw-cache-stats', inputFolder),

  /**
   * Clears all cached RAW previews for the given input folder.
   * Deletes the entire .cullai_cache directory for that folder.
   * @param {string} inputFolder  Absolute path to the input folder.
   * @returns {Promise<{ success: true }>}
   */
  clearRawCache: (inputFolder) =>
    ipcRenderer.invoke('raw-cache-clear', inputFolder),

  /**
   * Updates cache size and age limits globally (not per-folder).
   * Triggers a non-blocking cleanup pass across all known input folders.
   * @param {{ maxSizeGB: number, maxAgeDays: number }} limits
   * @returns {Promise<{ success: true }>}
   */
  setRawCacheLimits: (limits) =>
    ipcRenderer.invoke('raw-cache-set-limits', limits),

  // ── Misc ──────────────────────────────────────────────────────────────────
  testConnection: (params) => ipcRenderer.invoke('test-connection', params),
  fetchModels: (payload) => ipcRenderer.invoke('fetch-models', payload),
});