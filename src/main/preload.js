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
  folderExists:         (folder)                          => ipcRenderer.invoke('folder-exists', folder),
  scanFolder:           (folder, extensions, prefixes)    => ipcRenderer.invoke('scan-folder', folder, extensions, prefixes),
  openFolderDialog:     ()                                => ipcRenderer.invoke('open-folder-dialog'),
  scanFolderPrefixes:   (folder, prefixes, caseInsens)    => ipcRenderer.invoke('scan-folder-prefixes', folder, prefixes, caseInsens),
  scanFolderExtensions: (folder)                          => ipcRenderer.invoke('scan-folder-extensions', folder),

  // ── File helpers ──────────────────────────────────────────────────────────
  readFileAsBase64: (filePath)  => ipcRenderer.invoke('read-file-as-base64', filePath),
  openFileDialog:   (options)   => ipcRenderer.invoke('open-file-dialog', options),

  // ── Misc ──────────────────────────────────────────────────────────────────
  testConnection: (params) => ipcRenderer.invoke('test-connection', params),
});