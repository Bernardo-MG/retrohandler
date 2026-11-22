import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared';
const api: DesktopApi = {
  chooseRomFolder: () => ipcRenderer.invoke('roms:choose-folder'),
  scanFolder: (folder) => ipcRenderer.invoke('roms:scan', folder)
};
contextBridge.exposeInMainWorld('retrohandler', api);
