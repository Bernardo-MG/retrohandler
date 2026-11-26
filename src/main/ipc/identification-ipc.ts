import { dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import path from 'node:path';
import type { IdentificationProgress } from '../../shared';
import type { IdentificationService } from '../identification';
import type { LibraryService } from '../services/library/library-service';

type ActiveJob = { id: string; controller: AbortController };

/** Renderer-scoped cancellation and progress; no fingerprint or persistence logic. */
export function registerIdentificationIpc(
  identification: IdentificationService,
  library: Pick<LibraryService, 'listCollections'>
): void {
  const jobs = new Map<number, ActiveJob>();

  async function importDat() {
    const selection = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Logiqx DAT XML', extensions: ['dat', 'xml'] }]
    });
    if (selection.canceled || !selection.filePaths[0]) {
      return null;
    }
    return identification.importDat(selection.filePaths[0]);
  }

  async function run(event: IpcMainInvokeEvent, source: unknown, jobId: unknown) {
    if (!isCollectionPath(source) || !isJobId(jobId)) {
      throw new Error('Invalid identification request.');
    }
    const collections = await library.listCollections();
    if (!collections.some(collection => collection.rootPath === source)) {
      throw new Error('Collection not found.');
    }
    return runForSender(event.sender, source, jobId);
  }

  async function runForSender(sender: WebContents, source: string, jobId: string) {
    if (sender.isDestroyed()) {
      throw new Error('Identification sender is no longer available.');
    }
    const senderId = sender.id;
    if (jobs.has(senderId)) {
      throw new Error('Identification is already running.');
    }
    const controller = new AbortController();
    jobs.set(senderId, { id: jobId, controller });
    const onDestroyed = () => controller.abort();
    sender.once('destroyed', onDestroyed);
    try {
      return await identification.identifyCollection(source, {
        signal: controller.signal,
        onProgress: progress => sendProgress(sender, jobId, progress)
      });
    } finally {
      sender.removeListener('destroyed', onDestroyed);
      jobs.delete(senderId);
    }
  }

  function cancel(event: IpcMainInvokeEvent, jobId: unknown): boolean {
    const active = jobs.get(event.sender.id);
    if (!active || active.id !== jobId) {
      return false;
    }
    active.controller.abort();
    return true;
  }

  ipcMain.handle('dat:import', importDat);
  ipcMain.handle('identity:run', run);
  ipcMain.handle('identity:cancel', cancel);
}

function isCollectionPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && path.isAbsolute(value);
}

function isJobId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

function sendProgress(sender: WebContents, jobId: string, progress: IdentificationProgress): void {
  if (!sender.isDestroyed()) {
    sender.send('identity:progress', { jobId, progress });
  }
}
