import type { BulkSystemSelection, CollectionInfo, IdentificationProgress, IdentificationReceipt, LibraryPage, LibraryQuery, ScanProgress, ScanResult, SystemCount } from '../../../shared';
import { scanRoms } from '../../scanner';
import type {
  CollectionRepository,
  IdentificationRepository,
  RomRepository,
  ScanRepository,
  SystemOverrideRepository
} from '../../contracts/persistence';
import { readDat } from '../../identification/dat';
import { identifyCollection } from '../../identification/identify';

export interface LibraryService {
  scanFolder(folder: string, options?: { signal?: AbortSignal; onProgress?: (progress: ScanProgress) => void }): Promise<ScanResult>;
  loadLastScan(): Promise<ScanResult | null>;
  listCollections(): Promise<CollectionInfo[]>;
  queryLibrary(query: LibraryQuery): Promise<LibraryPage>;
  listSystems(source: string | null): Promise<SystemCount[]>;
  bulkAssignSystem(selection: BulkSystemSelection, systemOverride: string | null): Promise<number>;
  renameCollection(source: string, label: string): Promise<void>;
  removeCollection(source: string): Promise<void>;
  importDat(filePath: string): Promise<{ name: string; count: number }>;
  identifyCollection(source: string, options?: { signal?: AbortSignal; onProgress?: (progress: IdentificationProgress) => void }): Promise<IdentificationReceipt>;
}

export interface LibraryServiceRepositories {
  collections?: ScanRepository & Partial<CollectionRepository>;
  roms?: RomRepository;
  identification?: IdentificationRepository;
  systemOverrides?: SystemOverrideRepository;
}

/** A cancelled or failed scan never changes the persisted library. */
export class FileSystemLibraryService implements LibraryService {
  constructor(private readonly repositories: LibraryServiceRepositories = {}) {}

  async scanFolder(folder: string, options?: { signal?: AbortSignal; onProgress?: (progress: ScanProgress) => void }): Promise<ScanResult> {
    const result = await scanRoms(folder, options);
    if (options?.signal?.aborted) {
      const error = new Error('Scan cancelled.');
      error.name = 'AbortError';
      throw error;
    }
    this.repositories.collections?.saveScan(result);
    return result;
  }

  async listCollections(): Promise<CollectionInfo[]> {
    return this.repositories.collections?.listCollections?.() ?? [];
  }
  async queryLibrary(query: LibraryQuery): Promise<LibraryPage> {
    return this.repositories.roms?.queryLibrary(query) ?? { items: [], total: 0 };
  }
  async listSystems(source: string | null): Promise<SystemCount[]> {
    return this.repositories.roms?.listSystems(source) ?? [];
  }
  async bulkAssignSystem(selection: BulkSystemSelection, systemOverride: string | null): Promise<number> {
    if (!this.repositories.systemOverrides) throw new Error('Bulk system assignment unavailable.');
    return this.repositories.systemOverrides.bulkAssignSystem(selection, systemOverride);
  }
  async renameCollection(source: string, label: string): Promise<void> {
    if (!this.repositories.collections?.renameCollection) throw new Error('Collection storage unavailable.');
    this.repositories.collections.renameCollection(source, label);
  }
  async removeCollection(source: string): Promise<void> {
    if (!this.repositories.collections?.removeCollection) throw new Error('Collection storage unavailable.');
    this.repositories.collections.removeCollection(source);
  }

  async importDat(filePath: string): Promise<{ name: string; count: number }> {
    if (!this.repositories.identification) throw new Error('DAT storage unavailable.');
    return this.repositories.identification.importDat(await readDat(filePath));
  }
  async identifyCollection(source: string, options?: { signal?: AbortSignal; onProgress?: (progress: IdentificationProgress) => void }): Promise<IdentificationReceipt> {
    const repository = this.repositories.identification;
    if (!repository) {
      throw new Error('Identification storage unavailable.');
    }
    return identifyCollection(source, repository, options);
  }

  async loadLastScan(): Promise<ScanResult | null> {
    return this.repositories.collections?.loadLastScan() ?? null;
  }
}
