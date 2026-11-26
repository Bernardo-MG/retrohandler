import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import type { ExportOptions } from '../../shared';
import type { ExportService } from '../export';

function parse(value: unknown): ExportOptions {
  if (!value || typeof value !== 'object') throw new Error('Invalid export request.');
  const o = value as Record<string, unknown>;
  if (typeof o.destination !== 'string' || !path.isAbsolute(o.destination) || o.destination.length > 4096 ||
      (o.source !== null && (typeof o.source !== 'string' || !path.isAbsolute(o.source) || o.source.length > 4096)) ||
      typeof o.includeArtwork !== 'boolean' || !o.overrides || typeof o.overrides !== 'object' || Array.isArray(o.overrides)) {
    throw new Error('Invalid export options.');
  }
  const overrides: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, val] of Object.entries(o.overrides as Record<string, unknown>)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || key.length > 256 || typeof val !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,49}$/.test(val)) throw new Error('Invalid system mapping.');
    overrides[key] = val;
  }
  return { source: o.source as string | null, destination: o.destination, includeArtwork: o.includeArtwork, overrides };
}

export function registerExportIpc(service: ExportService): void {
  ipcMain.handle('export:choose', async () => {
    const chosen = await dialog.showOpenDialog({ title: 'Choose RetroPie export folder', properties: ['openDirectory', 'createDirectory'] });
    return chosen.canceled ? null : chosen.filePaths[0] ?? null;
  });
  ipcMain.handle('export:preview', (_event, raw: unknown) => service.preview(parse(raw)));
  ipcMain.handle('export:run', (_event, raw: unknown, fingerprint: unknown) => {
    if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid preview confirmation.');
    return service.execute(parse(raw), fingerprint);
  });
}
