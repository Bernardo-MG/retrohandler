import { createReadStream } from 'node:fs';
import { addAbortSignal, compose, Transform, type Readable, type TransformCallback } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { Crc32 } from '../../hashing/crc32';
import { StreamSizeVerifier } from '../../streams/stream-size-verifier';
import type { ZipEntry } from './zip-entry';

export function openEntry(filename: string, entry: ZipEntry, signal?: AbortSignal): Readable {
  const verifier = new EntryVerifier(entry);
  const source = createReadStream(filename, {
    start: entry.start,
    end: entry.start + entry.compressed - 1,
    signal
  });
  const output =
    entry.method === 8 ? compose(source, createInflateRaw(), verifier) : compose(source, verifier);
  // Awaiting callers may attach their consumer after an early stream error.
  output.on('error', () => undefined);
  return signal ? addAbortSignal(signal, output) : output;
}

class EntryVerifier extends Transform {
  private readonly size: StreamSizeVerifier;
  private readonly checksum = new Crc32();

  constructor(private readonly entry: ZipEntry) {
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
