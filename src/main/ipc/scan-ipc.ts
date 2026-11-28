import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { channels } from '../../ipc-channels';
import type { ScanReceipt } from '../../shared';
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

  async function scanIndexed(
    event: IpcMainInvokeEvent,
    folder: unknown,
    jobId: unknown
  ): Promise<ScanReceipt> {
    if (!isCollectionPath(folder)) {
      throw new Error('Invalid folder.');
    }
    if (!isJobId(jobId)) {
      throw new Error('Invalid scan ID.');
    }
    const sender = event.sender;
    const result = await jobs.run(sender, jobId, (signal) =>
      library.scanFolder(folder, {
        signal,
        onProgress: (progress) => sendProgress(sender, channels.onScanProgress, { jobId, progress })
      })
    );
    return {
      source: result.source,
      gameCount: result.games.length,
      warningCount: result.warnings?.length ?? 0
    };
  }

  function cancel(event: IpcMainInvokeEvent, jobId: unknown): boolean {
    return jobs.cancel(event.sender.id, jobId);
  }

  ipcMain.handle(channels.chooseRomFolder, chooseFolder);
  ipcMain.handle(channels.scanIndexedFolder, scanIndexed);
  ipcMain.handle(channels.cancelScan, cancel);
}
