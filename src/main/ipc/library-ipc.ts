import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import type { LibraryService } from '../services/library/library-service';

/** Only one active scan per renderer. Cancellation is scoped to its sender. */
export function registerLibraryIpc(library: LibraryService): void {
  const jobs = new Map<number, { id: string; controller: AbortController }>();
  ipcMain.handle('roms:choose-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('roms:scan', async (event, folder: unknown, jobId?: unknown) => {
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
      return await library.scanFolder(folder, {
        signal: controller.signal,
        onProgress: progress => {
          if (!sender.isDestroyed()) sender.send('roms:progress', { jobId: id, progress });
        }
      });
    } finally {
      sender.removeListener('destroyed', onDestroyed);
      jobs.delete(sender.id);
    }
  });
  ipcMain.handle('roms:cancel', async (event, jobId: unknown) => {
    const active = jobs.get(event.sender.id);
    if (!active || active.id !== jobId) return false;
    active.controller.abort();
    return true;
  });
}
