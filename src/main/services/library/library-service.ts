import type {
  BulkSystemSelection,
  CollectionInfo,
  LibraryPage,
  LibraryQuery,
  ScanResult,
  SystemCount
} from '../../../shared';
import { RomScanner, type ScanOptions } from '../../scanner';
import { throwIfCancelled } from '../../components/async/cancellation';
import type {
  CollectionRepository,
  RomRepository,
  ScanRepository,
  SystemOverrideRepository
} from '../../contracts/persistence';

export interface LibraryService {
  scanFolder(folder: string, options?: ScanOptions): Promise<ScanResult>;
  loadLastScan(): Promise<ScanResult | null>;
  listCollections(): Promise<CollectionInfo[]>;
  queryLibrary(query: LibraryQuery): Promise<LibraryPage>;
  listSystems(source: string | null): Promise<SystemCount[]>;
  bulkAssignSystem(selection: BulkSystemSelection, systemOverride: string | null): Promise<number>;
  renameCollection(source: string, label: string): Promise<void>;
  removeCollection(source: string): Promise<void>;
}

export interface LibraryServiceRepositories {
  collections?: ScanRepository & Partial<CollectionRepository>;
  roms?: RomRepository;
  systemOverrides?: SystemOverrideRepository;
}

/** A cancelled or failed scan never changes the persisted library. */
export class FileSystemLibraryService implements LibraryService {
  constructor(
    private readonly repositories: LibraryServiceRepositories = {},
    private readonly scanner: Pick<RomScanner, 'scan'> = new RomScanner()
  ) {}

  public async scanFolder(folder: string, options?: ScanOptions): Promise<ScanResult> {
    const result = await this.scanner.scan(folder, options);
    throwIfCancelled(options?.signal, 'Scan cancelled.');
    this.repositories.collections?.saveScan(result);
    return result;
  }

  public async listCollections(): Promise<CollectionInfo[]> {
    return this.repositories.collections?.listCollections?.() ?? [];
  }

  public async queryLibrary(query: LibraryQuery): Promise<LibraryPage> {
    return this.repositories.roms?.queryLibrary(query) ?? { items: [], total: 0 };
  }

  public async listSystems(source: string | null): Promise<SystemCount[]> {
    return this.repositories.roms?.listSystems(source) ?? [];
  }

  public async bulkAssignSystem(selection: BulkSystemSelection, systemOverride: string | null): Promise<number> {
    if (!this.repositories.systemOverrides) {
      throw new Error('Bulk system assignment unavailable.');
    }
    return this.repositories.systemOverrides.bulkAssignSystem(selection, systemOverride);
  }

  public async renameCollection(source: string, label: string): Promise<void> {
    if (!this.repositories.collections?.renameCollection) {
      throw new Error('Collection storage unavailable.');
    }
    this.repositories.collections.renameCollection(source, label);
  }

  public async removeCollection(source: string): Promise<void> {
    if (!this.repositories.collections?.removeCollection) {
      throw new Error('Collection storage unavailable.');
    }
    this.repositories.collections.removeCollection(source);
  }

  public async loadLastScan(): Promise<ScanResult | null> {
    return this.repositories.collections?.loadLastScan() ?? null;
  }
}
