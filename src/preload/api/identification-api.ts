import type { DesktopApi } from '../../shared';
import type { IpcClient } from '../ipc/ipc-client';

type IdentificationApi = Pick<
  DesktopApi,
  'importDat' | 'identifyCollection' | 'cancelIdentification' | 'onIdentificationProgress'
>;

export function createIdentificationApi(client: IpcClient): IdentificationApi {
  return {
    importDat: () => client.invoke('importDat'),
    identifyCollection: (source, jobId) => client.invoke('identifyCollection', source, jobId),
    cancelIdentification: (jobId) => client.invoke('cancelIdentification', jobId),
    onIdentificationProgress: (listener) => client.subscribe('onIdentificationProgress', listener)
  };
}
