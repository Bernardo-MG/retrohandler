import type { DesktopApi } from '../../shared';
import type { IpcClient } from '../ipc/ipc-client';

type LibraryApi = Pick<
  DesktopApi,
  | 'loadSavedLibrary'
  | 'listCollections'
  | 'queryLibrary'
  | 'listSystems'
  | 'renameCollection'
  | 'removeCollection'
  | 'bulkAssignSystem'
>;

export function createLibraryApi(client: IpcClient): LibraryApi {
  return {
    loadSavedLibrary: () => client.invoke('loadSavedLibrary'),
    listCollections: () => client.invoke('listCollections'),
    queryLibrary: (query) => client.invoke('queryLibrary', query),
    listSystems: (source) => client.invoke('listSystems', source),
    renameCollection: (source, label) => client.invoke('renameCollection', source, label),
    removeCollection: (source) => client.invoke('removeCollection', source),
    bulkAssignSystem: (selection, systemOverride) =>
      client.invoke('bulkAssignSystem', selection, systemOverride)
  };
}
