import type { Readable } from 'node:stream';

export interface ArchiveMember {
  name: string;
  size: number;
  directory: boolean;
}

/** Read archive contents without extracting files into the collection. */
export interface ArchiveReader {
  list(filename: string, signal?: AbortSignal): Promise<ArchiveMember[]>;
  open(filename: string, member: string, signal?: AbortSignal): Readable;
}

export const MAX_ARCHIVE_MEMBERS = 10000;
