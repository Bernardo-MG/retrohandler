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
export interface DesktopApi {
  chooseRomFolder(): Promise<string | null>;
  scanFolder(folder: string, jobId?: string): Promise<ScanResult>;
  cancelScan(jobId: string): Promise<boolean>;
  onScanProgress(listener: (update: ScanUpdate) => void): () => void;
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
