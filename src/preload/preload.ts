import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, ScanUpdate } from '../shared';
const api: DesktopApi = {
  chooseRomFolder: () => ipcRenderer.invoke('roms:choose-folder'),
  scanFolder: (folder, jobId) => ipcRenderer.invoke('roms:scan', folder, jobId),
  cancelScan: jobId => ipcRenderer.invoke('roms:cancel', jobId),
  onScanProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, update: ScanUpdate) => listener(update);
    ipcRenderer.on('roms:progress', handler);
    return () => ipcRenderer.removeListener('roms:progress', handler);
  }
};
contextBridge.exposeInMainWorld('retrohandler', api);
