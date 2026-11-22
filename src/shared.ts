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
};
export interface DesktopApi {
  chooseRomFolder(): Promise<string | null>;
  scanFolder(folder: string): Promise<ScanResult>;
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
