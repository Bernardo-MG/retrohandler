import { dialog, ipcMain } from 'electron';
import type { ExportService } from '../export';
import { parseExportOptions, parsePreviewFingerprint } from './export-validation';

export function registerExportIpc(service: Pick<ExportService, 'preview' | 'execute'>): void {
  async function chooseDestination(): Promise<string | null> {
    const chosen = await dialog.showOpenDialog({
      title: 'Choose RetroPie export folder',
      properties: ['openDirectory', 'createDirectory']
    });
    return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
  }

  ipcMain.handle('export:choose', chooseDestination);
  ipcMain.handle('export:preview', (_event, raw: unknown) => service.preview(parseExportOptions(raw)));
  ipcMain.handle('export:run', (_event, raw: unknown, fingerprint: unknown) => {
    const approved = parsePreviewFingerprint(fingerprint);
    return service.execute(parseExportOptions(raw), approved);
  });
}
