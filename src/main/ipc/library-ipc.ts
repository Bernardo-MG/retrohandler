import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import type { LibraryQuery } from '../../shared';
import type { LibraryService } from '../services/library/library-service';

/** Only one active scan per renderer. Cancellation is scoped to its sender. */
export function registerLibraryIpc(library: LibraryService): void {
  const jobs = new Map<number, { id: string; controller: AbortController }>();
  ipcMain.handle('roms:choose-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  const scan = async (event: Electron.IpcMainInvokeEvent, folder: unknown, jobId?: unknown, indexed = false) => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Invalid folder.');
    if (jobId !== undefined && (typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(jobId))) throw new Error('Invalid scan ID.');
    const sender = event.sender;
    if (jobs.has(sender.id)) throw new Error('A scan is already running.');
    const id = typeof jobId === 'string' ? jobId : 'legacy';
    const controller = new AbortController();
    jobs.set(sender.id, { id, controller });
    const onDestroyed = () => controller.abort();
    sender.once('destroyed', onDestroyed);
    try {
      const result = await library.scanFolder(folder, {
        signal: controller.signal,
        onProgress: progress => {
          if (!sender.isDestroyed()) sender.send('roms:progress', { jobId: id, progress });
        }
      });
      return indexed ? { source: result.source, gameCount: result.games.length, warningCount: result.warnings?.length ?? 0 } : result;
    } finally {
      sender.removeListener('destroyed', onDestroyed);
      jobs.delete(sender.id);
    }
  };
  ipcMain.handle('roms:scan', (event, folder: unknown, jobId?: unknown) => scan(event, folder, jobId));
  ipcMain.handle('roms:scan-indexed', (event, folder: unknown, jobId: unknown) => scan(event, folder, jobId, true));
  ipcMain.handle('roms:load-saved', () => library.loadLastScan());
  ipcMain.handle('library:collections', () => library.listCollections());
  ipcMain.handle('library:systems', (_event, source: unknown) => {
    if (source !== null && (typeof source !== 'string' || source.length > 4096)) throw new Error('Invalid collection.');
    return library.listSystems(source);
  });
  ipcMain.handle('library:query', (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid query.');
    const q = raw as Record<string, unknown>;
    if ((q.source !== null && (typeof q.source !== 'string' || q.source.length > 4096)) ||
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
  ipcMain.handle('roms:cancel', async (event, jobId: unknown) => {
    const active = jobs.get(event.sender.id);
    if (!active || active.id !== jobId) return false;
    active.controller.abort();
    return true;
  });
}
