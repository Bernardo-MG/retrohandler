import { createWriteStream } from 'node:fs';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { throwIfCancelled } from '../async/cancellation';
import { StreamSizeVerifier } from '../streams/stream-size-verifier';
import type { ArchiveEntry } from './archive-entry';
import type { ArchiveSource } from './archive-source';

export interface ExtractOptions {
  signal?: AbortSignal;
  onProgress?: (processed: number, total: number) => void;
}

/** Extract an entry to an explicit, new destination without trusting its archive path. */
export async function extractArchiveEntry(
  source: ArchiveSource,
  entry: ArchiveEntry,
  destination: string,
  options: ExtractOptions = {}
): Promise<void> {
  throwIfCancelled(options.signal);
  if (entry.directory) {
    throw new Error('Cannot extract an archive directory.');
  }
  const verifier = new ExtractionVerifier(entry.size, options.onProgress);
  await source.readEntry(
    entry,
    (stream) =>
      pipeline(stream, verifier, createWriteStream(destination, { flags: 'wx' }), { signal: options.signal }),
    options.signal
  );
}

class ExtractionVerifier extends Transform {
  private readonly verifier: StreamSizeVerifier;

  constructor(
    private readonly expectedSize: number,
    private readonly onProgress?: ExtractOptions['onProgress']
  ) {
    super();
    this.verifier = new StreamSizeVerifier(expectedSize, {
      invalidSize: 'Invalid archive entry size.',
      invalidChunk: 'Archive entry stream must contain bytes.',
      oversized: 'Archive entry exceeds declared size.',
      truncated: 'Truncated archive entry.'
    });
  }

  public override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.verifier.accept(chunk);
      this.onProgress?.(this.verifier.size, this.expectedSize);
      callback(null, chunk);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public override _flush(callback: TransformCallback): void {
    try {
      this.verifier.assertComplete();
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
