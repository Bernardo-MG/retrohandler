import type { CollectionInfo, LibraryPage, LibraryQuery, ScanProgress, ScanResult, SystemCount } from '../../../shared';
import { scanRoms } from '../../scanner';
import type { LibraryStore } from '../../database/library-store';

export interface LibraryService {
  scanFolder(folder: string, options?: { signal?: AbortSignal; onProgress?: (progress: ScanProgress) => void }): Promise<ScanResult>;
  loadLastScan(): Promise<ScanResult | null>;
  listCollections(): Promise<CollectionInfo[]>;
  queryLibrary(query: LibraryQuery): Promise<LibraryPage>;
  listSystems(source: string | null): Promise<SystemCount[]>;
  renameCollection(source: string, label: string): Promise<void>;
  removeCollection(source: string): Promise<void>;
}

/** A cancelled or failed scan never changes the persisted library. */
export class FileSystemLibraryService implements LibraryService {
  constructor(private readonly store?: LibraryStore) {}

  async scanFolder(folder: string, options?: { signal?: AbortSignal; onProgress?: (progress: ScanProgress) => void }): Promise<ScanResult> {
    const result = await scanRoms(folder, options);
    if (options?.signal?.aborted) {
      const error = new Error('Scan cancelled.');
      error.name = 'AbortError';
      throw error;
    }
    this.store?.saveScan(result);
    return result;
  }

  async listCollections(): Promise<CollectionInfo[]> {
    return this.store?.listCollections?.() ?? [];
  }
  async queryLibrary(query: LibraryQuery): Promise<LibraryPage> {
    return this.store?.queryLibrary?.(query) ?? { items: [], total: 0 };
  }
  async listSystems(source: string | null): Promise<SystemCount[]> {
    return this.store?.listSystems?.(source) ?? [];
  }
  async renameCollection(source: string, label: string): Promise<void> {
    if (!this.store?.renameCollection) throw new Error('Collection storage unavailable.');
    this.store.renameCollection(source, label);
  }
  async removeCollection(source: string): Promise<void> {
    if (!this.store?.removeCollection) throw new Error('Collection storage unavailable.');
    this.store.removeCollection(source);
  }

  async loadLastScan(): Promise<ScanResult | null> {
    return this.store?.loadLastScan() ?? null;
  }
}
