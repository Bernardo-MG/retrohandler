import type {
  BulkSystemSelection,
  CollectionInfo,
  GameMetadata,
  GameMetadataInput,
  IdentificationResult,
  LibraryEntry,
  LibraryPage,
  LibraryQuery,
  MetadataCandidate,
  ScanResult,
  SystemCount
} from '../../shared';
import type { ParsedDat, FingerprintMatch } from './identification';
import type { FileFingerprint } from '../components/hashing/content-fingerprint';

export interface ScanRepository {
  saveScan(result: ScanResult): void;
}

export interface CollectionRepository extends ScanRepository {
  listCollections(): CollectionInfo[];
  renameCollection(source: string, label: string): void;
  removeCollection(source: string): void;
}

export interface RomRepository {
  queryLibrary(query: LibraryQuery): LibraryPage;
  listSystems(source: string | null): SystemCount[];
}

export interface IdentificationRepository {
  importDat(dat: ParsedDat): { name: string; count: number };
  entriesForIdentification(source: string): LibraryEntry[];
  cachedFingerprint(
    source: string,
    relativePath: string,
    size: number,
    modifiedMs: number
  ): FileFingerprint | null;
  matchFingerprint(hashes: FileFingerprint): FingerprintMatch;
  saveIdentification(source: string, results: readonly IdentificationResult[]): void;
}

export interface SystemOverrideRepository {
  bulkAssignSystem(selection: BulkSystemSelection, systemOverride: string | null): number;
}

export interface MetadataRepository {
  saveMetadata(source: string, relativePath: string, metadata: GameMetadataInput): GameMetadata;
  getArtworkId(source: string, relativePath: string): string | null;
}

export interface ArtworkReferences {
  getReferencedArtworkIds(): Set<string>;
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

export interface LaunchBoxImportRepository {
  beginLaunchBoxImport(): void;
  addLaunchBoxGame(game: LaunchBoxGame): void;
  finishLaunchBoxImport(): number;
  abortLaunchBoxImport(): void;
}

export interface LaunchBoxRepository extends LaunchBoxImportRepository {
  searchLaunchBox(query: string, system: string): MetadataCandidate[];
  getLaunchBoxGame(id: number): LaunchBoxGame | null;
}
