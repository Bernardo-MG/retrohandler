import type { ExportOptions } from '../../shared';
import { isCollectionPath, isRecord } from './validation';

export function parseExportOptions(value: unknown): ExportOptions {
  if (!isRecord(value)) {
    throw new Error('Invalid export request.');
  }
  if (!isCollectionPath(value.destination) ||
    (value.source !== null && !isCollectionPath(value.source)) ||
    typeof value.includeArtwork !== 'boolean' || !isRecord(value.overrides)) {
    throw new Error('Invalid export options.');
  }
  return {
    source: value.source,
    destination: value.destination,
    includeArtwork: value.includeArtwork,
    overrides: parseOverrides(value.overrides)
  };
}

function parseOverrides(input: Record<string, unknown>): Record<string, string> {
  const overrides: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || key.length > 256 ||
      typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,49}$/.test(value)) {
      throw new Error('Invalid system mapping.');
    }
    overrides[key] = value;
  }
  return overrides;
}

export function parsePreviewFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('Invalid preview confirmation.');
  }
  return value;
}
