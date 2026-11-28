import type { DesktopApi } from '../../shared';
import type { IpcClient } from '../ipc/ipc-client';

type SettingsApi = Pick<
  DesktopApi,
  'getSettings' | 'saveSettings' | 'resetSettings' | 'getStorageInfo' | 'cleanupArtworkCache'
>;

export function createSettingsApi(client: IpcClient): SettingsApi {
  return {
    getSettings: () => client.invoke('getSettings'),
    saveSettings: (patch) => client.invoke('saveSettings', patch),
    resetSettings: () => client.invoke('resetSettings'),
    getStorageInfo: () => client.invoke('getStorageInfo'),
    cleanupArtworkCache: () => client.invoke('cleanupArtworkCache')
  };
}
