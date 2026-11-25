import type {
  MetadataCandidate,
  BulkSystemSelection,
  CollectionInfo,
  GameMetadata,
  GameMetadataInput,
  IdentificationResult,
  IdentificationStatus,
  LibraryEntry,
  LibraryPage,
  LibraryQuery,
  ScanResult,
  SystemCount
} from '../../shared';
import type { ParsedDat } from '../identification/dat';
import type { RomHashes } from '../identification/hashes';

/** The native module is loaded in Electron's main process, never in the renderer.
 * Kept behind a small structural interface to avoid leaking SQLite into services. */
export interface Statement {
  run(...params: unknown[]): {
    changes: number
  };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface DatabaseHandle {
  pragma(sql: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): Statement;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

export interface LaunchBoxGame {
  id: number;
  title: string;
  platform: string;
  released: string;
  description: string;
  developer: string;
  publisher: string;
  genre: string;
}

export type DatabaseFactory = (filename: string) => DatabaseHandle;

export interface LibraryStore {
  saveScan(result: ScanResult): void;
  loadLastScan(): ScanResult | null;
  listCollections?(): CollectionInfo[];
  queryLibrary?(query: LibraryQuery): LibraryPage;
  listSystems?(source: string | null): SystemCount[];
  renameCollection?(source: string, label: string): void;
  removeCollection?(source: string): void;
  importDat?(dat: ParsedDat): {
    name: string;
    count: number
  };
  entriesForIdentification?(source: string): LibraryEntry[];
  cachedFingerprint?(source: string, relativePath: string, size: number, modifiedMs: number): RomHashes | null;
  matchFingerprint?(hashes: RomHashes): {
    status: IdentificationStatus;
    title: string | null;
    datName: string | null
  };
  saveIdentification?(source: string, results: IdentificationResult[]): void;
  saveMetadata?(source: string, relativePath: string, metadata: GameMetadataInput): GameMetadata;
  bulkAssignSystem?(selection: BulkSystemSelection, systemOverride: string | null): number;
  beginLaunchBoxImport?(): void;
  addLaunchBoxGame?(game: LaunchBoxGame): void;
  finishLaunchBoxImport?(): number;
  abortLaunchBoxImport?(): void;
  searchLaunchBox?(query: string, system: string): MetadataCandidate[];
  getLaunchBoxGame?(id: number): LaunchBoxGame | null;
  getArtworkId?(source: string, relativePath: string): string | null;
}

export type CollectionRow = {
  root_path: string;
  scanned_at: string;
  ignored: number;
  warnings_json: string
};
export type RomRow = {
  id: string;
  name: string;
  system: string;
  relative_path: string;
  extension: string;
  bytes: number
};

export type LibraryRow = {
  source: string;
  id: string;
  name: string;
  system: string;
  relativePath: string;
  extension: string;
  bytes: number;
  identificationStatus: IdentificationStatus | null;
  identifiedTitle: string | null;
  datName: string | null;
  metadataTitle: string | null;
  metadataDescription: string | null;
  metadataReleased: string | null;
  metadataDeveloper: string | null;
  metadataPublisher: string | null;
  metadataGenre: string | null;
  metadataProvider: 'manual' | 'launchbox' | null;
  metadataProviderId: string | null;
  metadataProviderSlug: string | null;
  metadataArtworkId: string | null;
  metadataSystemOverride: string | null;
};

export type CollectionListRow = Omit<CollectionInfo, 'warningCount'> & {
  warningsJson: string
};
export type FingerprintRow = Omit<RomHashes, 'size'> & {
  bytes: number
};
export type FingerprintMatchRow = {
  game: string;
  datName: string;
  evidence: string
};
export type BulkTargetRow = {
  source: string;
  relativePath: string;
  name: string
};
export type LaunchBoxCandidateRow = Pick<LaunchBoxGame, 'id' | 'title' | 'platform' | 'released'>;
export type ArtworkRow = {
  artworkId: string | null
};
