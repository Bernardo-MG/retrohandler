import { open, type FileHandle } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { throwIfCancelled } from '../../async/cancellation';
import { readExactly } from '../../filesystem/binary-reader';
import type { ArchiveEntry } from '../archive-entry';
import type { ArchiveLimits } from '../archive-limits';
import type { ArchiveReader } from '../archive-reader';
import { directoryEntries, readDirectoryLocation, selectEntry } from './zip-central-directory';
import type { ZipEntry } from './zip-entry';
import { openEntry } from './zip-entry-stream';
import { readLocalHeader } from './zip-local-header';

/** Restricted classic ZIP reader. Never uses an archive name as an output path. */
export class ZipArchiveReader implements ArchiveReader {
  constructor(private readonly limits: ArchiveLimits) {}

  public async list(filename: string, signal?: AbortSignal): Promise<ArchiveEntry[]> {
    throwIfCancelled(signal);
    const handle = await open(filename, 'r');
    try {
      const { directory, bytes } = await this.readDirectory(handle);
      throwIfCancelled(signal);
      return Array.from(directoryEntries(bytes, directory.entries), (entry) => ({
        name: entry.name,
        size: entry.size,
        directory: entry.name.endsWith('/')
      }));
    } finally {
      await handle.close();
    }
  }

  public async open(filename: string, entryName: string, signal?: AbortSignal): Promise<Readable> {
    throwIfCancelled(signal);
    if (entryName.endsWith('/')) {
      throw new Error('Cannot open a ZIP directory.');
    }
    const entry = await this.findNamedEntry(filename, entryName);
    throwIfCancelled(signal);
    return openEntry(filename, entry, signal);
  }

  private async findNamedEntry(filename: string, name: string): Promise<ZipEntry> {
    const handle = await open(filename, 'r');
    try {
      const { directory, bytes } = await this.readDirectory(handle);
      const selected = selectEntry(bytes, directory.entries, name, this.limits);
      return await readLocalHeader(handle, selected, directory.offset);
    } finally {
      await handle.close();
    }
  }

  private async readDirectory(handle: FileHandle) {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 22 || info.size > this.limits.maxArchiveBytes) {
      throw new Error('Invalid ZIP size.');
    }
    const directory = await readDirectoryLocation(handle, info.size);
    const bytes = await readExactly(handle, directory.size, directory.offset, 'Truncated ZIP directory.');
    return { directory, bytes };
  }
}
