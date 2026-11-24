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
export interface ScanWarning { relativePath: string; message: string; }
export interface ScanProgress { filesVisited: number; gamesFound: number; directoriesVisited: number; ignored: number; warnings: number; currentPath: string; }
export interface ScanUpdate { jobId: string; progress: ScanProgress; }
export type IdentificationStatus = 'pending' | 'verified' | 'probable' | 'ambiguous' | 'unknown' | 'unsupported' | 'error';
export interface IdentificationProgress {
  processed: number; total: number; verified: number; probable: number;
  ambiguous: number; unknown: number; unsupported: number; errors: number; currentPath: string;
}
export interface IdentificationUpdate { jobId: string; progress: IdentificationProgress; }
export interface IdentificationResult {
  source: string; relativePath: string; status: IdentificationStatus;
  title: string | null; datName: string | null;
  fingerprint: { crc32: string; md5: string; sha1: string; size: number; modifiedMs: number } | null;
}
export interface DatImportReceipt { name: string; count: number; }
export interface IdentificationReceipt {
  processed: number; verified: number; probable: number; ambiguous: number;
  unknown: number; unsupported: number; errors: number;
}
export interface DesktopApi {
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

/** Domain types for future persistence and metadata matching. The existing Rom
 * and ScanResult IPC payloads stay unchanged in Patch 001. */
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
export interface LibraryEntry extends Rom { source: string; identificationStatus?: IdentificationStatus; identifiedTitle?: string | null; datName?: string | null; }
export interface LibraryPage { items: LibraryEntry[]; total: number; }
export interface SystemCount { system: string; count: number; }
export interface ScanReceipt { source: string; gameCount: number; warningCount: number; }
