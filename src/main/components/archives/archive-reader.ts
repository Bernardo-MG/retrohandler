import type { Readable } from 'node:stream';

export interface ArchiveEntry {
  name: string;
  size: number;
  directory: boolean;
}

/** Read archive contents without extracting files into the collection. */
export interface ArchiveReader {
  list(filename: string, signal?: AbortSignal): Promise<ArchiveEntry[]>;
  open(filename: string, entryName: string, signal?: AbortSignal): Readable;
}

export const MAX_ARCHIVE_ENTRIES = 10000;
