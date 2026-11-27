import { createReadStream } from 'node:fs';
import { addAbortSignal, compose, Transform, type Readable, type TransformCallback } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { Crc32 } from '../../hashing/crc32';
import { StreamSizeVerifier } from '../../streams/stream-size-verifier';
import { writeArchiveEntry } from '../archive-extractor';
import type { ExtractOptions, ZipEntry } from './zip-entry';

export async function extractEntry(
  filename: string,
  entry: ZipEntry,
  destination: string,
  options: ExtractOptions
): Promise<void> {
  await writeArchiveEntry(openEntry(filename, entry, options), destination, options.signal);
}

export function openEntry(filename: string, entry: ZipEntry, options: ExtractOptions): Readable {
  const verifier = new EntryVerifier(entry, options.onProgress);
  const source = createReadStream(filename, {
    start: entry.start,
    end: entry.start + entry.compressed - 1,
    signal: options.signal
  });
  const output = entry.method === 8 ? compose(source, createInflateRaw(), verifier) : compose(source, verifier);
  return options.signal ? addAbortSignal(options.signal, output) : output;
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
