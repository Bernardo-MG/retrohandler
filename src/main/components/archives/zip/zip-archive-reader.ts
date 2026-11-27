import { open, type FileHandle } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { readExactly } from '../../filesystem/binary-reader';
import type { ArchiveEntry, ArchiveReader } from '../archive-reader';
import { directoryEntries, readDirectoryLocation, selectEntry } from './zip-central-directory';
import type { ArchiveLimits, ExtractOptions, ZipEntry } from './zip-entry';
import { extractEntry, openEntry } from './zip-extraction';
import { readLocalHeader } from './zip-local-header';

/** Restricted classic ZIP reader. Never uses an archive name as an output path. */
export class ZipArchiveReader implements ArchiveReader {
  constructor(
    private readonly filename: string,
    private readonly limits: ArchiveLimits
  ) {}

  /** Select exactly one file by basename, optionally inside an archive directory. */
  public async findEntry(basename: string): Promise<ZipEntry> {
    return this.findNamedEntry(this.filename, basename, false);
  }

  public async list(filename: string, signal?: AbortSignal): Promise<ArchiveEntry[]> {
    signal?.throwIfAborted();
    const handle = await open(filename, 'r');
    try {
      const { directory, bytes } = await this.readDirectory(handle);
      signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    if (entryName.endsWith('/')) {
      throw new Error('Cannot open a ZIP directory.');
    }
    const entry = await this.findNamedEntry(filename, entryName, true);
    signal?.throwIfAborted();
    return openEntry(filename, entry, { signal });
  }

  public async extract(basename: string, destination: string, options: ExtractOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const entry = await this.findEntry(basename);
    await extractEntry(this.filename, entry, destination, options);
  }

  private async findNamedEntry(filename: string, name: string, exact: boolean): Promise<ZipEntry> {
    const handle = await open(filename, 'r');
    try {
      const { directory, bytes } = await this.readDirectory(handle);
      const selected = selectEntry(bytes, directory.entries, name, this.limits, exact);
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
