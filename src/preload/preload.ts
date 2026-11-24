import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, ScanUpdate } from '../shared';
const api: DesktopApi = {
  chooseRomFolder: () => ipcRenderer.invoke('roms:choose-folder'),
  loadSavedLibrary: () => ipcRenderer.invoke('roms:load-saved'),
  scanFolder: (folder, jobId) => ipcRenderer.invoke('roms:scan', folder, jobId),
  scanIndexedFolder: (folder, jobId) => ipcRenderer.invoke('roms:scan-indexed', folder, jobId),
  listCollections: () => ipcRenderer.invoke('library:collections'),
  queryLibrary: query => ipcRenderer.invoke('library:query', query),
  listSystems: source => ipcRenderer.invoke('library:systems', source),
  renameCollection: (source, label) => ipcRenderer.invoke('library:rename', source, label),
  removeCollection: source => ipcRenderer.invoke('library:remove', source),
  cancelScan: jobId => ipcRenderer.invoke('roms:cancel', jobId),
  onScanProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, update: ScanUpdate) => listener(update);
    ipcRenderer.on('roms:progress', handler);
    return () => ipcRenderer.removeListener('roms:progress', handler);
  }
};
contextBridge.exposeInMainWorld('retrohandler', api);
