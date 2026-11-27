import path from 'node:path';
import type { Readable } from 'node:stream';
import { throwIfCancelled } from '../async/cancellation';
import type { ArchiveEntry } from './archive-entry';
import type { ArchiveFormatReader, ArchiveReader } from './archive-reader';

/** Select an archive backend in configured priority order. Never retry a failed operation. */
export class CompositeArchiveReader implements ArchiveReader {
  private readonly readers: readonly ArchiveFormatReader[];

  constructor(readers: readonly ArchiveFormatReader[]) {
    this.readers = [...readers];
  }

  public async list(filename: string, signal?: AbortSignal): Promise<ArchiveEntry[]> {
    const reader = await this.readerFor(filename, signal);
    throwIfCancelled(signal);
    return reader.list(filename, signal);
  }

  public async open(filename: string, entryName: string, signal?: AbortSignal): Promise<Readable> {
    const reader = await this.readerFor(filename, signal);
    throwIfCancelled(signal);
    return reader.open(filename, entryName, signal);
  }

  private async readerFor(filename: string, signal?: AbortSignal): Promise<ArchiveFormatReader> {
    throwIfCancelled(signal);
    const extension = path.extname(filename).toLowerCase();
    for (const reader of this.readers) {
      if (!reader.supports(extension)) {
        continue;
      }
      const supported = !reader.supportsArchive || (await reader.supportsArchive(filename, signal));
      throwIfCancelled(signal);
      if (supported) {
        return reader;
      }
    }
    throw new Error(`Unsupported archive format: ${extension || '(no extension)'}.`);
  }
}
