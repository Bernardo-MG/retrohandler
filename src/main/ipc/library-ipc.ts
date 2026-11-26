import { ipcMain } from 'electron';
import { registerScanIpc } from './scan-ipc';
import type { BulkSystemSelection, LibraryQuery } from '../../shared';
import type { LibraryService } from '../services/library/library-service';

/** Only one active scan per renderer. Cancellation is scoped to its sender. */
export function registerLibraryIpc(library: LibraryService): void {
  registerScanIpc(library);
  ipcMain.handle('roms:load-saved', () => library.loadLastScan());
  ipcMain.handle('library:bulk-system', (_event, selection: unknown, systemOverride: unknown) => {
    if (systemOverride !== null && (typeof systemOverride !== 'string' || !systemOverride.trim() ||
        systemOverride.length > 120 || /[\x00-\x1f]/.test(systemOverride))) throw new Error('Invalid system.');
    if (!selection || typeof selection !== 'object' || !['selected','filtered'].includes(String((selection as {scope?: unknown}).scope)))
      throw new Error('Invalid bulk selection.');
    return library.bulkAssignSystem(selection as BulkSystemSelection, systemOverride as string | null);
  });
  ipcMain.handle('library:collections', () => library.listCollections());
  ipcMain.handle('library:systems', (_event, source: unknown) => {
    if (source !== null && (typeof source !== 'string' || source.length > 4096)) throw new Error('Invalid collection.');
    return library.listSystems(source);
  });
  ipcMain.handle('library:query', (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid query.');
    const q = raw as Record<string, unknown>;
    if ((q.source !== null && (typeof q.source !== 'string' || q.source.length > 4096)) ||
        (q.identification !== undefined && q.identification !== null && !['pending','verified','probable','ambiguous','unknown','unsupported','error'].includes(String(q.identification))) ||
        typeof q.search !== 'string' || q.search.length > 256 ||
        (q.system !== null && (typeof q.system !== 'string' || q.system.length > 256)) ||
        !['name', 'system', 'bytes'].includes(String(q.sort)) ||
        typeof q.descending !== 'boolean' ||
        !Number.isSafeInteger(q.offset) || !Number.isSafeInteger(q.limit) ||
        Number(q.offset) < 0 || Number(q.limit) < 1 || Number(q.limit) > 200) {
      throw new Error('Invalid library query.');
    }
    return library.queryLibrary(q as unknown as LibraryQuery);
  });
  ipcMain.handle('library:rename', (_event, source: unknown, label: unknown) => {
    if (typeof source !== 'string' || source.length > 4096 ||
        typeof label !== 'string' || label.length > 120) throw new Error('Invalid collection rename.');
    return library.renameCollection(source, label);
  });
  ipcMain.handle('library:remove', (_event, source: unknown) => {
    if (typeof source !== 'string' || source.length > 4096) throw new Error('Invalid collection.');
    return library.removeCollection(source);
  });
}
