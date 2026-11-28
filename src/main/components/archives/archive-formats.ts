import path from 'node:path';

export const ARCHIVE_EXTENSIONS = {
  zip: '.zip',
  rar: '.rar',
  sevenZip: '.7z'
} as const;

const recognizedExtensions = new Set<string>(Object.values(ARCHIVE_EXTENSIONS));

function normalizeArchiveExtension(extension: string): string {
  return extension.toLowerCase();
}

export function archiveExtension(filename: string): string {
  return normalizeArchiveExtension(path.extname(filename));
}

/** Recognize a container extension, independently of configured reader capabilities. */
export function isArchiveExtension(extension: string): boolean {
  return recognizedExtensions.has(normalizeArchiveExtension(extension));
}
