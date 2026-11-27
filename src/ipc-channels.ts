import type { DesktopApi } from './shared';

/** IPC names are a shared transport contract; the renderer never receives this object. */
export const channels = {
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  resetSettings: 'settings:reset',
  getStorageInfo: 'settings:storage',
  cleanupArtworkCache: 'settings:cleanup-artwork',

  loadSavedLibrary: 'roms:load-saved',
  listCollections: 'library:collections',
  queryLibrary: 'library:query',
  listSystems: 'library:systems',
  renameCollection: 'library:rename',
  removeCollection: 'library:remove',
  bulkAssignSystem: 'library:bulk-system',

  chooseRomFolder: 'roms:choose-folder',
  scanFolder: 'roms:scan',
  scanIndexedFolder: 'roms:scan-indexed',
  cancelScan: 'roms:cancel',
  onScanProgress: 'roms:progress',

  importLaunchBox: 'launchbox:import',
  downloadLaunchBox: 'launchbox:download',
  cancelLaunchBoxDownload: 'launchbox:cancel',
  onLaunchBoxProgress: 'launchbox:progress',
  launchBoxSearch: 'launchbox:search',
  launchBoxApply: 'launchbox:apply',
  findLibretroArtwork: 'libretro:artwork',
  searchLibretroCovers: 'libretro:search-covers',
  metadataSave: 'metadata:save',

  importDat: 'dat:import',
  identifyCollection: 'identity:run',
  cancelIdentification: 'identity:cancel',
  onIdentificationProgress: 'identity:progress',

  chooseExportFolder: 'export:choose',
  previewRetroPieExport: 'export:preview',
  runRetroPieExport: 'export:run'
} as const satisfies Record<keyof DesktopApi, string>;

export type ProgressMethod = 'onLaunchBoxProgress' | 'onIdentificationProgress' | 'onScanProgress';
export type RequestMethod = Exclude<keyof DesktopApi, ProgressMethod>;
