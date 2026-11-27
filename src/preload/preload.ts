import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, IdentificationUpdate, ScanUpdate, LaunchBoxDownloadProgress } from '../shared';
const api: DesktopApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  getStorageInfo: () => ipcRenderer.invoke('settings:storage'),
  cleanupArtworkCache: () => ipcRenderer.invoke('settings:cleanup-artwork'),
  bulkAssignSystem: (selection, systemOverride) =>
    ipcRenderer.invoke('library:bulk-system', selection, systemOverride),
  chooseExportFolder: () => ipcRenderer.invoke('export:choose'),
  previewRetroPieExport: (options) => ipcRenderer.invoke('export:preview', options),
  runRetroPieExport: (options, fingerprint) => ipcRenderer.invoke('export:run', options, fingerprint),
  importLaunchBox: () => ipcRenderer.invoke('launchbox:import'),
  downloadLaunchBox: () => ipcRenderer.invoke('launchbox:download'),
  cancelLaunchBoxDownload: () => ipcRenderer.invoke('launchbox:cancel'),
  onLaunchBoxProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, update: LaunchBoxDownloadProgress) =>
      listener(update);
    ipcRenderer.on('launchbox:progress', handler);
    return () => ipcRenderer.removeListener('launchbox:progress', handler);
  },
  launchBoxSearch: (query, system) => ipcRenderer.invoke('launchbox:search', query, system),
  launchBoxApply: (target, id) => ipcRenderer.invoke('launchbox:apply', target, id),
  findLibretroArtwork: (system, names) => ipcRenderer.invoke('libretro:artwork', system, names),
  searchLibretroCovers: (system, query, regionHint, refresh) =>
    ipcRenderer.invoke('libretro:search-covers', system, query, regionHint, refresh),
  metadataSave: (target, data) => ipcRenderer.invoke('metadata:save', target, data),
  importDat: () => ipcRenderer.invoke('dat:import'),
  identifyCollection: (source, jobId) => ipcRenderer.invoke('identity:run', source, jobId),
  cancelIdentification: (jobId) => ipcRenderer.invoke('identity:cancel', jobId),
  onIdentificationProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, update: IdentificationUpdate) => listener(update);
    ipcRenderer.on('identity:progress', handler);
    return () => ipcRenderer.removeListener('identity:progress', handler);
  },
  chooseRomFolder: () => ipcRenderer.invoke('roms:choose-folder'),
  loadSavedLibrary: () => ipcRenderer.invoke('roms:load-saved'),
  scanFolder: (folder, jobId) => ipcRenderer.invoke('roms:scan', folder, jobId),
  scanIndexedFolder: (folder, jobId) => ipcRenderer.invoke('roms:scan-indexed', folder, jobId),
  listCollections: () => ipcRenderer.invoke('library:collections'),
  queryLibrary: (query) => ipcRenderer.invoke('library:query', query),
  listSystems: (source) => ipcRenderer.invoke('library:systems', source),
  renameCollection: (source, label) => ipcRenderer.invoke('library:rename', source, label),
  removeCollection: (source) => ipcRenderer.invoke('library:remove', source),
  cancelScan: (jobId) => ipcRenderer.invoke('roms:cancel', jobId),
  onScanProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, update: ScanUpdate) => listener(update);
    ipcRenderer.on('roms:progress', handler);
    return () => ipcRenderer.removeListener('roms:progress', handler);
  }
};
contextBridge.exposeInMainWorld('retrohandler', api);
