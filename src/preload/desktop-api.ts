import type { DesktopApi } from '../shared';
import { IpcClient, type IpcTransport } from './ipc/ipc-client';
import { createSettingsApi } from './api/settings-api';
import { createLibraryApi } from './api/library-api';
import { createScannerApi } from './api/scanner-api';
import { createMetadataApi } from './api/metadata-api';
import { createIdentificationApi } from './api/identification-api';
import { createExportApi } from './api/export-api';

export function createDesktopApi(transport: IpcTransport): DesktopApi {
  const client = new IpcClient(transport);
  return {
    ...createSettingsApi(client),
    ...createLibraryApi(client),
    ...createScannerApi(client),
    ...createMetadataApi(client),
    ...createIdentificationApi(client),
    ...createExportApi(client)
  };
}
