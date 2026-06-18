const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
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

  startPipeline: (settings) => ipcRenderer.invoke('pipeline-start', settings),
  pipelineValidateSetup: (settings) => ipcRenderer.invoke('pipeline-validate-setup', settings),
  cancelPipeline: (payload) => ipcRenderer.invoke('pipeline-cancel', payload),
  confirmPipelineContinue: () => ipcRenderer.invoke('pipeline-confirm-continue'),
  onPipelineEvent: (callback) => {
    const handler = (_event, pipelineEvent) => callback(pipelineEvent);
    ipcRenderer.on('pipeline-event', handler);
    return () => ipcRenderer.removeListener('pipeline-event', handler);
  },
  // ── Phase 10.7 – Fill shortfall ─────────────────────────────────────────
    /**
     * Promotes additional images (B or rejected) to reach the target keeper count.
     *
     * @param {{ outputFolder: string, targetCount: number }} payload
     * @returns {Promise<Session>}
     */
  fillPipelineShortfall: (payload) =>
    ipcRenderer.invoke('pipeline-fill-shortfall', payload),
    
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
   * Recursively discovers all subdirectories under `rootPath` that contain
   * at least one file. Hidden dirs and .cullai_cache are excluded.
   *
   * Returns an array of relative subfolder paths ('' = root).
   *
   * @param {string} rootPath  Absolute path to the input root folder.
   * @returns {Promise<string[]>}
   */
  walkSubfolders: (rootPath) =>
    ipcRenderer.invoke('walk-subfolders', rootPath),
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

  // ── Phase 7 — Duplicate Detection ─────────────────────────────────────────

  /**
   * Groups an array of ImageRecords into burst/duplicate clusters using
   * perceptual hashing (DCT pHash via imghash).
   *
   * Respects AppSettings.disableDuplicateGrouping: if true, returns each image
   * as its own single-member group with no hashing overhead.
   *
   * Threshold resolution (highest priority first):
   *   1. threshold argument passed here
   *   2. AppSettings.duplicateThreshold (user's persisted preference)
   *   3. DEFAULT_SIMILARITY_THRESHOLD = 10
   *
   * @param {ImageRecord[]} images     Array of ImageRecords (must have base64 populated).
   * @param {number}        [threshold] Optional Hamming-distance override (0–64).
   * @returns {Promise<DuplicateGroup[]>}
   */
  detectDuplicates: (images, threshold) =>
    ipcRenderer.invoke('detect-duplicates', { images, threshold }),

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

  // ── Phase 20.3 — Quick Action Buttons ─────────────────────────────────────
  /**
   * Opens the folder containing the given file path and selects the file.
   * @param {string} filePath Absolute path to a file.
   */
  openContainingFolder: (filePath) => ipcRenderer.invoke('open-containing-folder', filePath),

  /**
   * Copies the given text to the system clipboard.
   * @param {string} text The text to copy.
   */
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),

  /**
   * Returns a reminder string about Lightroom integration (no direct API).
   * @returns {Promise<{ message: string }>}
   */
  viewInLightroomReminder: () => ipcRenderer.invoke('view-in-lightroom-reminder'),

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

  // ── Phase 8 — Session Manager ─────────────────────────────────────────────

  /**
   * Creates a new session for the given settings and total image count.
   * Overwrites any existing session.json in the output folder.
   *
   * @param {{ settings: AppSettings, totalImages: number }} payload
   * @returns {Promise<Session>}
   */
  sessionCreate: (payload) =>
    ipcRenderer.invoke('session-create', payload),

  /**
   * Loads the session from the output folder, or returns null if none exists.
   *
   * @param {{ outputFolder: string }} payload
   * @returns {Promise<Session | null>}
   */
  sessionLoad: (payload) =>
    ipcRenderer.invoke('session-load', payload),

  /**
   * Saves a single ScoreRecord into the session and increments scoredCount.
   * Atomic — safe to call concurrently from a parallel scoring pool.
   *
   * @param {{ outputFolder: string, imageId: string, score: ScoreRecord }} payload
   * @returns {Promise<true>}
   */
  sessionSaveScore: (payload) =>
    ipcRenderer.invoke('session-save-score', payload),

  /**
   * Marks the session as completed.
   *
   * @param {{ outputFolder: string }} payload
   * @returns {Promise<true>}
   */
  sessionMarkComplete: (payload) =>
    ipcRenderer.invoke('session-mark-complete', payload),

  /**
   * Marks the session as cancelled.
   *
   * @param {{ outputFolder: string }} payload
   * @returns {Promise<true>}
   */
  sessionMarkCancelled: (payload) =>
    ipcRenderer.invoke('session-mark-cancelled', payload),

  /**
   * Saves the discovery-pass AI context string into the session.
   *
   * @param {{ outputFolder: string, context: string }} payload
   * @returns {Promise<true>}
   */
  sessionSaveDiscoveryContext: (payload) =>
    ipcRenderer.invoke('session-save-discovery-context', payload),

  /**
   * Saves the output shortfall reasons summary into the session.
   *
   * @param {{ outputFolder: string, reasons: ShortfallReasons }} payload
   * @returns {Promise<true>}
   */
  sessionSaveShortfallReasons: (payload) =>
    ipcRenderer.invoke('session-save-shortfall-reasons', payload),

  /**
   * Deletes session.json (and .bak, .tmp if present) from the output folder.
   *
   * @param {{ outputFolder: string }} payload
   * @returns {Promise<true>}
   */
  sessionClear: (payload) =>
    ipcRenderer.invoke('session-clear', payload),

  /**
   * Returns true if a valid session.json exists in the output folder.
   * Used by the Processing screen to decide whether to show a resume banner.
   *
   * @param {{ outputFolder: string }} payload
   * @returns {Promise<boolean>}
   */
  sessionHasExisting: (payload) =>
    ipcRenderer.invoke('session-has-existing', payload),

  /**
   * Returns the array of image IDs already scored in the session.
   * The orchestrator uses this to skip already-scored images on resume.
   *
   * @param {{ outputFolder: string }} payload
   * @returns {Promise<string[]>}
   */
  sessionGetScoredIds: (payload) =>
    ipcRenderer.invoke('session-get-scored-ids', payload),

  // ── Phase 12 — Results Screen ─────────────────────────────────────────────

  /**
   * Updates the tier of a single image in the persisted session.
   * Used by the Results screen for manual tier overrides (P/X/R shortcuts).
   *
   * @param {{ outputFolder: string, imageId: string, newTier: 'S'|'A'|'B'|'rejected' }} payload
   * @returns {Promise<import('../shared/types').ScoreRecord | null>}
   */
  sessionUpdateTier: (payload) =>
    ipcRenderer.invoke('session-update-tier', payload),

  /**
   * Exports session results as a clean, user-facing JSON file to the output
   * folder. The export contains only filename, tier, score, reasoning, and
   * keywords — no internal IDs, thumbnails, or session metadata.
   *
   * @param {{ outputFolder: string }} payload
   * @returns {Promise<{ filePath: string, imageCount: number }>}
   */
  exportResultsJson: (payload) =>
    ipcRenderer.invoke('export-results-json', payload),

  // ── Phase 12b — Results Performance & UX ─────────────────────────────────

  /**
   * Exports all session scores as a UTF-8 BOM CSV file (Excel-friendly).
   * Opens a native save dialog. Returns null if the user cancels.
   *
   * @param {{ outputFolder: string }} payload
   * @returns {Promise<{ filePath: string, imageCount: number } | null>}
   */
  exportResultsCsv: (payload) =>
    ipcRenderer.invoke('export-results-csv', payload),

  /**
   * Zips session.json, results.json, and all XMP sidecars into a user-chosen
   * .zip file. Opens a native save dialog. Returns null if cancelled.
   * Pushes 'zip-progress' events (0–100) during archiving — subscribe via
   * onZipProgress() before calling this.
   *
   * @param {{ outputFolder: string }} payload
   * @returns {Promise<{ filePath: string, fileCount: number } | null>}
   */
  exportSessionZip: (payload) =>
    ipcRenderer.invoke('export-session-zip', payload),

  /**
   * Subscribes to 'zip-progress' events emitted during exportSessionZip().
   * Returns an unsubscribe function — call it after the export completes.
   *
   * @param {(pct: number) => void} callback
   * @returns {() => void} Unsubscribe function.
   */
  onZipProgress: (callback) => {
    const handler = (_e, pct) => callback(pct);
    ipcRenderer.on('zip-progress', handler);
    return () => ipcRenderer.removeListener('zip-progress', handler);
  },

  /**
   * Re-scores a subset of already-processed images using the current
   * settings.weights. Emits 'pipeline-event' (pipeline-image-scored) for each
   * image — subscribe via onPipelineEvent() before calling.
   *
   * @param {{ imageIds: string[], outputFolder: string, settings: AppSettings }} payload
   * @returns {Promise<void>}
   */
  rescoreImages: (payload) =>
    ipcRenderer.invoke('re-score-images', payload),

  // ── Phase 13 — XMP Sidecar Export ────────────────────────────────────────

  /**
   * Writes XMP sidecar files (.xmp) alongside the original images for every
   * scored result in the session.
   *
   * @param {{
   *   outputFolder:      string,
   *   imagePathMap:      Record<string, string>,
   *   includeDescription: boolean,
   * }} payload
   *   - outputFolder:       Absolute path to the session output folder.
   *   - imagePathMap:       Maps score.filename → absolute path to the original
   *                         image on disk (used to derive the sidecar path).
   *   - includeDescription: When true, AI reasoning is embedded in the XMP
   *                         dc:description field.
   * @returns {Promise<{ written: number; errors: string[] } | null>}
   *   Returns null if the user cancels the operation (e.g. via a native dialog).
   */
  exportXmp: (payload) =>
    ipcRenderer.invoke('export-xmp', payload),

  // ── Phase 13b — AI Auto-Tagging ──────────────────────────────────────────

  /**
   * Generates AI keyword tags for the S and A-tier keepers of a completed
   * session and persists them to session.json. Pro feature — returns
   * { success: false, error: string } for Free tier users instead of throwing.
   *
   * Call this from the Results screen. The handler reads thumbnails from
   * `.cullai_cache/thumbnails/` so no re-processing is needed.
   *
   * @param {{ outputFolder: string, settings: AppSettings }} payload
   * @returns {Promise<{ success: true, written: number } | { success: false, error: string }>}
   */
  runAutoTagging: (payload) =>
    ipcRenderer.invoke('run-auto-tagging', payload),

  // ── Phase 14 — Style Profile System ─────────────────────────────────────

  /**
   * Returns all saved StyleProfile objects, newest-first.
   *
   * @returns {Promise<StyleProfile[]>}
   */
  profilesList: () =>
    ipcRenderer.invoke('profiles-list'),

  /**
   * Saves (creates or updates) a StyleProfile by its `id` field.
   * Upserts: if a profile with the same id exists it is replaced; otherwise
   * a new entry is appended.
   *
   * @param {StyleProfile} profile
   * @returns {Promise<true>}
   */
  profilesSave: (profile) =>
    ipcRenderer.invoke('profiles-save', profile),

  /**
   * Permanently deletes the profile with the given id. No-op if not found.
   *
   * @param {string} id  UUID of the profile to delete.
   * @returns {Promise<true>}
   */
  profilesDelete: (id) =>
    ipcRenderer.invoke('profiles-delete', id),

  /**
   * Returns the last 10 completed session summaries, newest-first.
   * Used by RecentSessionsPanel to let users reload prior settings.
   *
   * @returns {Promise<SessionHistoryEntry[]>}
   */
  sessionHistoryGet: () =>
    ipcRenderer.invoke('session-history-get'),

  // ── Phase 18 — Auto Updater ──────────────────────────────────────────────

  /**
   * Triggers a manual check for app updates (electron-updater).
   * @returns {Promise<void>}
   */
  checkForUpdates: () => ipcRenderer.invoke('updater-check'),

  /**
   * Enables or disables automatic update checks on startup.
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke('updater-set-enabled', enabled),

  /**
   * Subscribes to 'updater-update-available' events.
   * @param {(info: { version: string, releaseDate: string }) => void} callback
   * @returns {() => void} Unsubscribe function.
   */
  onUpdateAvailable: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('updater-update-available', handler);
    return () => ipcRenderer.removeListener('updater-update-available', handler);
  },

  /**
   * Subscribes to 'updater-update-downloaded' events.
   * @param {(info: { version: string }) => void} callback
   * @returns {() => void} Unsubscribe function.
   */
  onUpdateDownloaded: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('updater-update-downloaded', handler);
    return () => ipcRenderer.removeListener('updater-update-downloaded', handler);
  },

  /**
   * Subscribes to 'updater-download-progress' events.
   * @param {(progress: { percent: number, transferred: number, total: number }) => void} callback
   * @returns {() => void} Unsubscribe function.
   */
  onDownloadProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('updater-download-progress', handler);
    return () => ipcRenderer.removeListener('updater-download-progress', handler);
  },

  /**
   * Subscribes to 'updater-error' events.
   * @param {(error: { message: string }) => void} callback
   * @returns {() => void} Unsubscribe function.
   */
  onUpdateError: (callback) => {
    const handler = (_event, error) => callback(error);
    ipcRenderer.on('updater-error', handler);
    return () => ipcRenderer.removeListener('updater-error', handler);
  },
});