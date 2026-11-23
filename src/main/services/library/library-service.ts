import type { ScanProgress, ScanResult } from '../../../shared';
import { scanRoms } from '../../scanner';
import type { LibraryStore } from '../../database/library-store';

export interface LibraryService {
  scanFolder(folder: string, options?: { signal?: AbortSignal; onProgress?: (progress: ScanProgress) => void }): Promise<ScanResult>;
  loadLastScan(): Promise<ScanResult | null>;
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

  async loadLastScan(): Promise<ScanResult | null> {
    return this.store?.loadLastScan() ?? null;
  }
}
