import type { StreamFingerprint } from '../hashing/content-fingerprint';
import type { FingerprintReader } from '../hashing/fingerprint-reader';
import type { ArchiveEntry } from './archive-entry';
import type { ArchiveSource } from './archive-source';

/** Fingerprint uncompressed entry data, not the containing archive. */
export class ArchiveFingerprintReader {
  constructor(private readonly reader: FingerprintReader) {}

  public read(source: ArchiveSource, entry: ArchiveEntry, signal?: AbortSignal): Promise<StreamFingerprint> {
    return source.readEntry(entry, (stream) => this.reader.readStream(stream, entry.size, signal), signal);
  }
}
