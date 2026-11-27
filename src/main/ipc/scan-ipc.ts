import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ScanReceipt, ScanResult } from '../../shared';
import type { LibraryService } from '../services/library';
import { RendererJobs, sendProgress } from './renderer-jobs';
import { isCollectionPath, isJobId } from './validation';

export function registerScanIpc(library: Pick<LibraryService, 'scanFolder'>): void {
  const jobs = new RendererJobs({
    busy: 'A scan is already running.',
    destroyed: 'Scan sender is no longer available.'
  });

  async function chooseFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async function scan(event: IpcMainInvokeEvent, folder: unknown, jobId?: unknown): Promise<ScanResult> {
    if (!isCollectionPath(folder)) {
      throw new Error('Invalid folder.');
    }
    if (jobId !== undefined && !isJobId(jobId)) {
      throw new Error('Invalid scan ID.');
    }
    const sender = event.sender;
    const id = typeof jobId === 'string' ? jobId : 'legacy';
    return jobs.run(sender, id, (signal) =>
      library.scanFolder(folder, {
        signal,
        onProgress: (progress) => sendProgress(sender, 'roms:progress', { jobId: id, progress })
      })
    );
  }

  async function scanIndexed(
    event: IpcMainInvokeEvent,
    folder: unknown,
    jobId: unknown
  ): Promise<ScanReceipt> {
    const result = await scan(event, folder, jobId);
    return {
      source: result.source,
      gameCount: result.games.length,
      warningCount: result.warnings?.length ?? 0
    };
  }

  function cancel(event: IpcMainInvokeEvent, jobId: unknown): boolean {
    return jobs.cancel(event.sender.id, jobId);
  }

  ipcMain.handle('roms:choose-folder', chooseFolder);
  ipcMain.handle('roms:scan', scan);
  ipcMain.handle('roms:scan-indexed', scanIndexed);
  ipcMain.handle('roms:cancel', cancel);
}
