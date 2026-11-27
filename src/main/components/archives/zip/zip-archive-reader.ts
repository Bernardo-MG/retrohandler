import { open } from 'node:fs/promises';
import { readExactly } from '../../filesystem/binary-reader';
import { readDirectoryLocation, selectEntry } from './zip-central-directory';
import type { ArchiveLimits, ExtractOptions, ZipEntry } from './zip-entry';
import { extractEntry } from './zip-extraction';
import { readLocalHeader } from './zip-local-header';

/** Restricted classic ZIP reader. Never uses an archive name as an output path. */
export class ZipArchiveReader {
  constructor(
    private readonly filename: string,
    private readonly limits: ArchiveLimits
  ) {}

  /** Select exactly one file by basename, optionally inside an archive directory. */
  public async findEntry(basename: string): Promise<ZipEntry> {
    const handle = await open(this.filename, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 22 || info.size > this.limits.maxArchiveBytes) {
        throw new Error('Invalid ZIP size.');
      }
      const directory = await readDirectoryLocation(handle, info.size);
      const bytes = await readExactly(handle, directory.size, directory.offset, 'Truncated ZIP directory.');
      const selected = selectEntry(bytes, directory.entries, basename, this.limits);
      return await readLocalHeader(handle, selected, directory.offset);
    } finally {
      await handle.close();
    }
  }

  public async extract(basename: string, destination: string, options: ExtractOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const entry = await this.findEntry(basename);
    await extractEntry(this.filename, entry, destination, options);
  }
}
