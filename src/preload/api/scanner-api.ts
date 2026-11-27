import type { DesktopApi } from '../../shared';
import type { IpcClient } from '../ipc/ipc-client';

type ScannerApi = Pick<
  DesktopApi,
  'chooseRomFolder' | 'scanFolder' | 'scanIndexedFolder' | 'cancelScan' | 'onScanProgress'
>;

export function createScannerApi(client: IpcClient): ScannerApi {
  return {
    chooseRomFolder: () => client.invoke('chooseRomFolder'),
    scanFolder: (folder, jobId) => client.invoke('scanFolder', folder, jobId),
    scanIndexedFolder: (folder, jobId) => client.invoke('scanIndexedFolder', folder, jobId),
    cancelScan: (jobId) => client.invoke('cancelScan', jobId),
    onScanProgress: (listener) => client.subscribe('onScanProgress', listener)
  };
}
