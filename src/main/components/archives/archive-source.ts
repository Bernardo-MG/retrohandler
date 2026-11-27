import { addAbortSignal, type Readable } from 'node:stream';
import { throwIfCancelled } from '../../utils/cancellation';
import { RegularFileIdentity } from '../filesystem/regular-file-identity';
import type { ArchiveEntry } from './archive-entry';
import { assertArchiveEntrySize } from './archive-entry-validation';
import type { ArchiveReader } from './archive-reader';

const CHANGED = 'Archive changed during reading.';

/** One observed archive, used for both listing and complete consumption of its entries. */
export class ArchiveSource {
  constructor(
    private readonly reader: ArchiveReader,
    private readonly identity: RegularFileIdentity
  ) {}

  public static async resolve(
    reader: ArchiveReader,
    filename: string,
    signal?: AbortSignal
  ): Promise<ArchiveSource> {
    throwIfCancelled(signal);
    const identity = await RegularFileIdentity.observe(filename, CHANGED);
    throwIfCancelled(signal);
    return new ArchiveSource(reader, identity);
  }

  public async list(signal?: AbortSignal): Promise<ArchiveEntry[]> {
    await this.assertUnchanged(signal);
    const entries = await this.reader.list(this.identity.filename, signal);
    await this.assertUnchanged(signal);
    return entries;
  }

  /** A consumer must exhaust the stream; a result is valid only after the final identity check. */
  public async readEntry<T>(
    entry: ArchiveEntry,
    consume: (stream: Readable) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    throwIfCancelled(signal);
    if (entry.directory) {
      throw new Error('Cannot open an archive directory.');
    }
    assertArchiveEntrySize(entry.size);
    await this.assertUnchanged(signal);
    const stream = await this.reader.open(this.identity.filename, entry.name, signal);
    // Keep early errors observable while awaiting file identity checks.
    stream.on('error', () => undefined);
    try {
      if (signal) {
        addAbortSignal(signal, stream);
      }
      await this.assertUnchanged(signal);
      if (stream.errored) {
        throw stream.errored;
      }
      const result = await consume(stream);
      throwIfCancelled(signal);
      if (stream.errored) {
        throw stream.errored;
      }
      if (!stream.readableEnded) {
        throw new Error('Archive entry was not fully consumed.');
      }
      await this.assertUnchanged(signal);
      return result;
    } catch (error) {
      throwIfCancelled(signal);
      throw error;
    } finally {
      stream.destroy();
    }
  }

  private async assertUnchanged(signal?: AbortSignal): Promise<void> {
    throwIfCancelled(signal);
    await this.identity.assertUnchanged(CHANGED);
    throwIfCancelled(signal);
  }
}
