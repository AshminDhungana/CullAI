import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('settings-get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings-set', settings),
  folderExists: (folder: string) => ipcRenderer.invoke('folder-exists', folder),
  scanFolder: (folder: string, extensions?: string[], prefixes?: string[]) =>
    ipcRenderer.invoke('scan-folder', folder, extensions, prefixes),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  testConnection: (params: any) => ipcRenderer.invoke('test-connection', params),
  readFileAsBase64: (filePath: string) => ipcRenderer.invoke('read-file-as-base64', filePath),
  openFileDialog: (options?: any) => ipcRenderer.invoke('open-file-dialog', options),
  scanFolderPrefixes: (folder: string, prefixes: string[], caseInsensitive: boolean) =>
    ipcRenderer.invoke('scan-folder-prefixes', folder, prefixes, caseInsensitive),
  scanFolderExtensions: (folder: string) => ipcRenderer.invoke('scan-folder-extensions', folder),
});
