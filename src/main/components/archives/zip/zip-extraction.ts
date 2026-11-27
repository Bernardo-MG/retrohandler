import { createReadStream, createWriteStream } from 'node:fs';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { Crc32 } from '../../hashing/crc32';
import { StreamSizeVerifier } from '../../streams/stream-size-verifier';
import type { ExtractOptions, ZipEntry } from './zip-entry';

export async function extractEntry(
  filename: string,
  entry: ZipEntry,
  destination: string,
  options: ExtractOptions
): Promise<void> {
  const verifier = new EntryVerifier(entry, options.onProgress);
  const source = createReadStream(filename, {
    start: entry.start,
    end: entry.start + entry.compressed - 1,
    signal: options.signal
  });
  const target = createWriteStream(destination, { flags: 'wx' });
  if (entry.method === 8) {
    await pipeline(source, createInflateRaw(), verifier, target, { signal: options.signal });
  } else {
    await pipeline(source, verifier, target, { signal: options.signal });
  }
}

class EntryVerifier extends Transform {
  private readonly size: StreamSizeVerifier;
  private readonly checksum = new Crc32();

  constructor(
    private readonly entry: ZipEntry,
    private readonly onProgress?: ExtractOptions['onProgress']
  ) {
    super();
    this.size = new StreamSizeVerifier(entry.size, {
      invalidSize: 'ZIP integrity check failed.',
      invalidChunk: 'ZIP integrity check failed.',
      oversized: 'ZIP entry exceeds declared size.',
      truncated: 'ZIP integrity check failed.'
    });
  }

  public override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.checksum.update(this.size.accept(chunk));
      this.onProgress?.(this.size.size, this.entry.size);
      callback(null, chunk);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public override _flush(callback: TransformCallback): void {
    try {
      this.size.assertComplete();
      if (this.checksum.digest() !== this.entry.crc) {
        throw new Error('ZIP integrity check failed.');
      }
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
