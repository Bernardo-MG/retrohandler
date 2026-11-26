import { dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import path from 'node:path';
import type { ScanProgress, ScanReceipt, ScanResult } from '../../shared';
import type { LibraryService } from '../services/library/library-service';

type ActiveScan = { id: string; controller: AbortController };

/** Owns renderer-scoped scan cancellation and forwards progress. */
export function registerScanIpc(library: Pick<LibraryService, 'scanFolder'>): void {
  const jobs = new Map<number, ActiveScan>();

  async function chooseFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  async function scan(event: IpcMainInvokeEvent, folder: unknown, jobId?: unknown): Promise<ScanResult> {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) {
      throw new Error('Invalid folder.');
    }
    if (jobId !== undefined && !isJobId(jobId)) {
      throw new Error('Invalid scan ID.');
    }
    const sender = event.sender;
    if (sender.isDestroyed()) {
      throw new Error('Scan sender is no longer available.');
    }
    const senderId = sender.id;
    if (jobs.has(senderId)) {
      throw new Error('A scan is already running.');
    }
    const id = typeof jobId === 'string' ? jobId : 'legacy';
    const controller = new AbortController();
    jobs.set(senderId, { id, controller });
    const onDestroyed = () => controller.abort();
    sender.once('destroyed', onDestroyed);
    try {
      return await library.scanFolder(folder, {
        signal: controller.signal,
        onProgress: progress => sendProgress(sender, id, progress)
      });
    } finally {
      sender.removeListener('destroyed', onDestroyed);
      jobs.delete(senderId);
    }
  }

  async function scanIndexed(event: IpcMainInvokeEvent, folder: unknown, jobId: unknown): Promise<ScanReceipt> {
    const result = await scan(event, folder, jobId);
    return { source: result.source, gameCount: result.games.length, warningCount: result.warnings?.length ?? 0 };
  }

  function cancel(event: IpcMainInvokeEvent, jobId: unknown): boolean {
    const active = jobs.get(event.sender.id);
    if (!active || active.id !== jobId) {
      return false;
    }
    active.controller.abort();
    return true;
  }

  ipcMain.handle('roms:choose-folder', chooseFolder);
  ipcMain.handle('roms:scan', scan);
  ipcMain.handle('roms:scan-indexed', scanIndexed);
  ipcMain.handle('roms:cancel', cancel);
}

function isJobId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

function sendProgress(sender: WebContents, jobId: string, progress: ScanProgress): void {
  if (!sender.isDestroyed()) {
    sender.send('roms:progress', { jobId, progress });
  }
}
