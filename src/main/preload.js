const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('settings-get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings-set', settings),
  folderExists: (folder) => ipcRenderer.invoke('folder-exists', folder),
  scanFolder: (folder, extensions, prefixes) =>
    ipcRenderer.invoke('scan-folder', folder, extensions, prefixes),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  testConnection: (params) => ipcRenderer.invoke('test-connection', params),
  readFileAsBase64: (filePath) => ipcRenderer.invoke('read-file-as-base64', filePath),
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  scanFolderPrefixes: (folder, prefixes, caseInsensitive) =>
    ipcRenderer.invoke('scan-folder-prefixes', folder, prefixes, caseInsensitive),
  scanFolderExtensions: (folder) => ipcRenderer.invoke('scan-folder-extensions', folder),
});
