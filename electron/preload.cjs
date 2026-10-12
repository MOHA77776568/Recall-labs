const { contextBridge, ipcRenderer } = require('electron');

const invoke = (operation, value) => ipcRenderer.invoke(`recall:${operation}`, value);

contextBridge.exposeInMainWorld('recall', Object.freeze({
  getState: () => invoke('getState'),
  getWorkspace: () => invoke('getWorkspace'),
  saveWorkspace: (value) => invoke('saveWorkspace', value),
  getWorkspaceBackups: () => invoke('getWorkspaceBackups'),
  getWorkspaceBackup: (id) => invoke('getWorkspaceBackup', id),
  restoreWorkspaceBackup: (id) => invoke('restoreWorkspaceBackup', id),
  storeSourceFile: (value) => invoke('storeSourceFile', value),
  readSourceFile: (id) => invoke('readSourceFile', id),
  syncWorkspace: () => invoke('syncWorkspace'),
  resolveWorkspaceConflict: (value) => invoke('resolveWorkspaceConflict', value),
  importWorkspace: (value) => invoke('importWorkspace', value),
  exportWorkspace: () => invoke('exportWorkspace'),
  saveSettings: (value) => invoke('saveSettings', value),
  checkForUpdates: () => invoke('checkForUpdates'),
  downloadUpdate: () => invoke('downloadUpdate'),
  installUpdate: () => invoke('installUpdate'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('An update listener must be a function.');
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('recall:updateStatus', listener);
    return () => ipcRenderer.removeListener('recall:updateStatus', listener);
  },
}));
