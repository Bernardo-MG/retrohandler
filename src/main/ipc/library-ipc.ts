import { ipcMain } from 'electron';
import { channels } from '../../ipc-channels';
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
  ipcMain.handle(channels.loadSavedLibrary, () => library.loadLastScan());
  ipcMain.handle(channels.bulkAssignSystem, (_event, selection: unknown, systemOverride: unknown) =>
    library.bulkAssignSystem(parseBulkSelection(selection), parseSystemOverride(systemOverride))
  );
  ipcMain.handle(channels.listCollections, () => library.listCollections());
  ipcMain.handle(channels.listSystems, (_event, source: unknown) =>
    library.listSystems(source === null ? null : parseCollection(source))
  );
  ipcMain.handle(channels.queryLibrary, (_event, query: unknown) =>
    library.queryLibrary(parseLibraryQuery(query))
  );
  ipcMain.handle(channels.renameCollection, (_event, source: unknown, label: unknown) => {
    if (!isText(source, 4096) || !isText(label, 120)) {
      throw new Error('Invalid collection rename.');
    }
    return library.renameCollection(source, label);
  });
  ipcMain.handle(channels.removeCollection, (_event, source: unknown) =>
    library.removeCollection(parseCollection(source))
  );
}
