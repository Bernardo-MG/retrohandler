import type { DesktopApi } from '../../shared';
import type { IpcClient } from '../ipc/ipc-client';

type MetadataApi = Pick<
  DesktopApi,
  | 'importLaunchBox'
  | 'downloadLaunchBox'
  | 'cancelLaunchBoxDownload'
  | 'onLaunchBoxProgress'
  | 'launchBoxSearch'
  | 'launchBoxApply'
  | 'findLibretroArtwork'
  | 'searchLibretroCovers'
  | 'metadataSave'
>;

export function createMetadataApi(client: IpcClient): MetadataApi {
  return {
    importLaunchBox: () => client.invoke('importLaunchBox'),
    downloadLaunchBox: () => client.invoke('downloadLaunchBox'),
    cancelLaunchBoxDownload: () => client.invoke('cancelLaunchBoxDownload'),
    onLaunchBoxProgress: (listener) => client.subscribe('onLaunchBoxProgress', listener),
    launchBoxSearch: (query, system) => client.invoke('launchBoxSearch', query, system),
    launchBoxApply: (target, id) => client.invoke('launchBoxApply', target, id),
    findLibretroArtwork: (system, names) => client.invoke('findLibretroArtwork', system, names),
    searchLibretroCovers: (system, query, regionHint, refresh) =>
      client.invoke('searchLibretroCovers', system, query, regionHint, refresh),
    metadataSave: (target, data) => client.invoke('metadataSave', target, data)
  };
}
