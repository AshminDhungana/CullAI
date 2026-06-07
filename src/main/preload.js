const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings:  ()           => ipcRenderer.invoke('settings-get'),
  saveSettings: (settings)   => ipcRenderer.invoke('settings-set', settings),

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
   * Counts files in a folder that match optional extension, prefix, and ignore
   * pattern filters. All arguments after `folder` are optional.
   *
   * @param {string}   folder          Absolute folder path.
   * @param {string[]} [extensions]    Lowercase dot-prefixed extensions, e.g. ['.jpg', '.cr3'].
   * @param {string[]} [prefixes]      Filename prefixes; empty = no prefix filter.
   * @param {string[]} [ignorePatterns] Parsed `.cullaiignore` glob patterns; empty = no exclusions.
   * @returns {Promise<{ count: number }>}
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

  // ── Misc ──────────────────────────────────────────────────────────────────
  testConnection: (params) => ipcRenderer.invoke('test-connection', params),
});