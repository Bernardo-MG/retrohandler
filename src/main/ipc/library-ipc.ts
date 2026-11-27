import { ipcMain } from 'electron';
import { registerScanIpc } from './scan-ipc';
import type { LibraryService } from '../services/library';
import {
  parseBulkSelection,
  parseCollection,
  parseLibraryQuery,
  parseSystemOverride
} from './library-validation';
import { isText } from './validation';

export function registerLibraryIpc(library: LibraryService): void {
  registerScanIpc(library);
  ipcMain.handle('roms:load-saved', () => library.loadLastScan());
  ipcMain.handle('library:bulk-system', (_event, selection: unknown, systemOverride: unknown) =>
    library.bulkAssignSystem(parseBulkSelection(selection), parseSystemOverride(systemOverride))
  );
  ipcMain.handle('library:collections', () => library.listCollections());
  ipcMain.handle('library:systems', (_event, source: unknown) =>
    library.listSystems(source === null ? null : parseCollection(source))
  );
  ipcMain.handle('library:query', (_event, query: unknown) => library.queryLibrary(parseLibraryQuery(query)));
  ipcMain.handle('library:rename', (_event, source: unknown, label: unknown) => {
    if (!isText(source, 4096) || !isText(label, 120)) {
      throw new Error('Invalid collection rename.');
    }
    return library.renameCollection(source, label);
  });
  ipcMain.handle('library:remove', (_event, source: unknown) =>
    library.removeCollection(parseCollection(source))
  );
}
