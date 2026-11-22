import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import type { LibraryService } from '../services/library/library-service';

/** Keep the public IPC names/arguments unchanged for v0.1 compatibility. */
export function registerLibraryIpc(library: LibraryService): void {
  ipcMain.handle('roms:choose-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('roms:scan', async (_event, folder: unknown) => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Invalid folder.');
    return library.scanFolder(folder);
  });
}
