import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IdentificationService } from '../identification';
import type { LibraryService } from '../services/library';
import { RendererJobs, sendProgress } from './renderer-jobs';
import { isCollectionPath, isJobId } from './validation';

export function registerIdentificationIpc(
  identification: Pick<IdentificationService, 'importDat' | 'identifyCollection'>,
  library: Pick<LibraryService, 'listCollections'>
): void {
  const jobs = new RendererJobs({
    busy: 'Identification is already running.',
    destroyed: 'Identification sender is no longer available.'
  });

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
    if (!collections.some((collection) => collection.rootPath === source)) {
      throw new Error('Collection not found.');
    }
    const sender = event.sender;
    return jobs.run(sender, jobId, (signal) =>
      identification.identifyCollection(source, {
        signal,
        onProgress: (progress) => sendProgress(sender, 'identity:progress', { jobId, progress })
      })
    );
  }

  function cancel(event: IpcMainInvokeEvent, jobId: unknown): boolean {
    return jobs.cancel(event.sender.id, jobId);
  }

  ipcMain.handle('dat:import', importDat);
  ipcMain.handle('identity:run', run);
  ipcMain.handle('identity:cancel', cancel);
}
