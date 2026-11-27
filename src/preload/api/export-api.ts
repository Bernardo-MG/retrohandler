import type { DesktopApi } from '../../shared';
import type { IpcClient } from '../ipc/ipc-client';

type ExportApi = Pick<DesktopApi, 'chooseExportFolder' | 'previewRetroPieExport' | 'runRetroPieExport'>;

export function createExportApi(client: IpcClient): ExportApi {
  return {
    chooseExportFolder: () => client.invoke('chooseExportFolder'),
    previewRetroPieExport: (options) => client.invoke('previewRetroPieExport', options),
    runRetroPieExport: (options, fingerprint) => client.invoke('runRetroPieExport', options, fingerprint)
  };
}
