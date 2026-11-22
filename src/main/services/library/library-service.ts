import type { ScanResult } from '../../../shared';
import { scanRoms } from '../../scanner';

/** Application use-case boundary. A database-backed implementation can replace
 * this without changing the Electron preload or React renderer contracts. */
export interface LibraryService {
  scanFolder(folder: string): Promise<ScanResult>;
}

export class FileSystemLibraryService implements LibraryService {
  scanFolder(folder: string): Promise<ScanResult> {
    return scanRoms(folder);
  }
}
