export type Rom = {
  id: string;
  name: string;
  system: string;
  relativePath: string;
  extension: string;
  bytes: number;
};
export type ScanResult = {
  source: string;
  games: Rom[];
  ignored: number;
  scannedAt: string;
  warnings?: ScanWarning[];
};
export interface ScanWarning {
  relativePath: string;
  message: string;
}
export interface ScanProgress {
  filesVisited: number;
  gamesFound: number;
  directoriesVisited: number;
  ignored: number;
  warnings: number;
  currentPath: string;
}
export interface ScanUpdate {
  jobId: string;
  progress: ScanProgress;
}
export type IdentificationStatus =
  | 'pending'
  | 'verified'
  | 'probable'
  | 'ambiguous'
  | 'unknown'
  | 'unsupported'
  | 'error';
export interface IdentificationProgress {
  processed: number;
  total: number;
  verified: number;
  probable: number;
  ambiguous: number;
  unknown: number;
  unsupported: number;
  errors: number;
  currentPath: string;
}
export interface IdentificationUpdate {
  jobId: string;
  progress: IdentificationProgress;
}
export interface IdentificationResult {
  source: string;
  relativePath: string;
  status: IdentificationStatus;
  title: string | null;
  datName: string | null;
  fingerprint: {
    crc32: string;
    md5: string;
    sha1: string;
    size: number;
    modifiedMs: number;
  } | null;
}
export interface DatImportReceipt {
  name: string;
  count: number;
}
export interface IdentificationReceipt {
  processed: number;
  verified: number;
  probable: number;
  ambiguous: number;
  unknown: number;
  unsupported: number;
  errors: number;
}
/** Metadata is optional, explicitly selected, and independent from DAT identification. */
export interface GameMetadataInput {
  title: string;
  description: string;
  released: string;
  developer: string;
  publisher: string;
  genre: string;
  provider: 'manual' | 'launchbox';
  providerId: string | null;
  providerSlug: string | null;
  artworkId: string | null;
  /** Optional manual platform override; null restores scanner detection. */
  systemOverride?: string | null;
}
export interface GameMetadata extends GameMetadataInput {
  source: string;
  relativePath: string;
}
export interface MetadataCandidate {
  id: number;
  title: string;
  released: string;
  slug: string | null;
  platform?: string;
}
export interface MetadataTarget {
  source: string;
  relativePath: string;
}
export interface LaunchBoxDownloadProgress {
  phase: 'download' | 'extract' | 'import';
  processed: number;
  total: number | null;
}
/** Bulk edits operate on explicit games or the whole filtered result, not the current page. */
export type BulkSystemSelection =
  | {
      scope: 'selected';
      targets: MetadataTarget[];
    }
  | {
      scope: 'filtered';
      filter: Pick<LibraryQuery, 'source' | 'search' | 'system' | 'identification'>;
    };

export const RETROPIE_SYSTEM_MAP: Readonly<Record<string, string>> = {
  'Nintendo Entertainment System': 'nes',
  'Super Nintendo': 'snes',
  'Game Boy': 'gb',
  'Game Boy Color': 'gbc',
  'Game Boy Advance': 'gba',
  'Nintendo 64': 'n64',
  'Nintendo DS': 'nds',
  'Mega Drive / Genesis': 'megadrive',
  'Master System': 'mastersystem',
  'Game Gear': 'gamegear',
  PlayStation: 'psx',
  'PlayStation 2': 'ps2',
  'PlayStation Portable': 'psp',
  Dreamcast: 'dreamcast',
  'Sega Saturn': 'saturn',
  Arcade: 'arcade',
  'Neo Geo': 'neogeo',
  'PC Engine / TurboGrafx-16': 'pcengine',
  'Atari 2600': 'atari2600',
  'Atari 7800': 'atari7800',
  Ports: 'ports',
  DOS: 'pc',
  ScummVM: 'scummvm'
};

/** Local export is preview-first; no export writes to source collections. */
export interface ExportOptions {
  source: string | null;
  destination: string;
  includeArtwork: boolean;
  overrides: Record<string, string>;
}
export interface ExportFile {
  source: string;
  relativeDestination: string;
  size: number;
  kind: 'rom' | 'artwork' | 'gamelist';
  action?: 'create' | 'update' | 'reuse';
}
export interface ExportPlan {
  destination: string;
  files: ExportFile[];
  systems: string[];
  warnings: string[];
  conflicts: string[];
  bytes: number;
  fingerprint: string;
  skippedRoms: number;
}
export interface ExportReceipt {
  copied: number;
  backups?: string[];
}
export interface LibretroCoverChoice {
  title: string;
  artworkId: string;
}

/** Preferences are stored independently of library data. */
export interface LibraryPreferences {
  selected: string | null;
  search: string;
  system: string | null;
  sort: LibrarySort;
  descending: boolean;
  identification: IdentificationStatus | null;
  view: 'list' | 'grid';
}
export type ExportPreferences = Pick<ExportOptions, 'destination' | 'includeArtwork' | 'overrides'>;
export interface MetadataPreferences {
  startWith: 'manual' | 'launchbox';
  artwork: 'libretro' | 'saved-only';
}
export interface AppearancePreferences {
  theme: 'dark' | 'light' | 'system';
}
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowPreferences {
  bounds: WindowBounds | null;
  maximized: boolean;
}
export interface AppSettings {
  version: 1;
  library: LibraryPreferences;
  export: ExportPreferences;
  metadata: MetadataPreferences;
  appearance: AppearancePreferences;
  window: WindowPreferences;
}
export type SettingsPatch = Partial<Pick<AppSettings, 'library' | 'export' | 'metadata' | 'appearance'>>;
export interface SettingsSnapshot {
  settings: AppSettings;
  warning: string | null;
}
export interface StorageInfo {
  databasePath: string;
  settingsPath: string;
  artworkPath: string;
  artworkFiles: number;
  artworkBytes: number;
  reclaimableFiles: number;
  reclaimableBytes: number;
}
export interface CacheCleanupReceipt {
  removedFiles: number;
  removedBytes: number;
  failedFiles: number;
}

export function defaultSettings(): AppSettings {
  return {
    version: 1,
    library: {
      selected: null,
      search: '',
      system: null,
      sort: 'name',
      descending: false,
      identification: null,
      view: 'list'
    },
    export: { destination: '', includeArtwork: true, overrides: {} },
    metadata: { startWith: 'manual', artwork: 'libretro' },
    appearance: { theme: 'dark' },
    window: { bounds: null, maximized: false }
  };
}

export interface DesktopApi {
  getSettings(): Promise<SettingsSnapshot>;
  saveSettings(patch: SettingsPatch): Promise<AppSettings>;
  resetSettings(): Promise<AppSettings>;
  getStorageInfo(): Promise<StorageInfo>;
  cleanupArtworkCache(): Promise<CacheCleanupReceipt>;
  bulkAssignSystem(selection: BulkSystemSelection, systemOverride: string | null): Promise<number>;
  chooseExportFolder(): Promise<string | null>;
  previewRetroPieExport(options: ExportOptions): Promise<ExportPlan>;
  runRetroPieExport(options: ExportOptions, fingerprint: string): Promise<ExportReceipt>;

  importLaunchBox(): Promise<{
    count: number;
  } | null>;
  downloadLaunchBox(): Promise<{
    count: number;
  }>;
  cancelLaunchBoxDownload(): Promise<boolean>;
  onLaunchBoxProgress(listener: (update: LaunchBoxDownloadProgress) => void): () => void;
  launchBoxSearch(query: string, system: string): Promise<MetadataCandidate[]>;
  launchBoxApply(target: MetadataTarget, id: number): Promise<GameMetadata>;
  findLibretroArtwork(system: string, names: string[]): Promise<string | null>;
  searchLibretroCovers(
    system: string,
    query: string,
    regionHint: string,
    refresh?: boolean
  ): Promise<LibretroCoverChoice[]>;
  metadataSave(target: MetadataTarget, data: GameMetadataInput): Promise<GameMetadata>;
  importDat(): Promise<DatImportReceipt | null>;
  identifyCollection(source: string, jobId: string): Promise<IdentificationReceipt>;
  cancelIdentification(jobId: string): Promise<boolean>;
  onIdentificationProgress(listener: (update: IdentificationUpdate) => void): () => void;
  chooseRomFolder(): Promise<string | null>;
  loadSavedLibrary(): Promise<ScanResult | null>;
  scanFolder(folder: string, jobId?: string): Promise<ScanResult>;
  cancelScan(jobId: string): Promise<boolean>;
  onScanProgress(listener: (update: ScanUpdate) => void): () => void;
  scanIndexedFolder(folder: string, jobId: string): Promise<ScanReceipt>;
  listCollections(): Promise<CollectionInfo[]>;
  queryLibrary(query: LibraryQuery): Promise<LibraryPage>;
  listSystems(source: string | null): Promise<SystemCount[]>;
  renameCollection(source: string, label: string): Promise<void>;
  removeCollection(source: string): Promise<void>;
}

export type PlatformId = string;

export interface CollectionSource {
  id: string;
  rootPath: string;
  label: string;
}

export interface RomFile {
  id: string;
  sourceId: string;
  relativePath: string;
  bytes: number;
  modifiedAt: string | null;
  sha256?: string;
}

export interface Game {
  id: string;
  platformId: PlatformId | null;
  title: string;
}

/** SQLite-backed collection browser; values are serialized across Electron IPC. */
export interface CollectionInfo {
  rootPath: string;
  label: string;
  scannedAt: string;
  gameCount: number;
  ignored: number;
  warningCount: number;
}
export type LibrarySort = 'name' | 'system' | 'bytes';
export interface LibraryQuery {
  identification?: IdentificationStatus | null;
  source: string | null;
  search: string;
  system: string | null;
  sort: LibrarySort;
  descending: boolean;
  offset: number;
  limit: number;
}
export interface LibraryEntry extends Rom {
  source: string;
  identificationStatus?: IdentificationStatus;
  identifiedTitle?: string | null;
  datName?: string | null;
  metadata?: GameMetadata | null;
}
export interface LibraryPage {
  items: LibraryEntry[];
  total: number;
}
export interface SystemCount {
  system: string;
  count: number;
}
export interface ScanReceipt {
  source: string;
  gameCount: number;
  warningCount: number;
}
