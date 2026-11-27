import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { addAbortSignal, type Readable } from 'node:stream';
import { throwIfCancelled } from '../async/cancellation';
import { sameRegularFileVersion } from '../filesystem/file-version';
import { ContentFingerprint, type FileFingerprint, type StreamFingerprint } from './content-fingerprint';

const CHUNK_BYTES = 256 * 1024;

/** Verify byte counts and file identity while calculating streaming fingerprints. */
export class FingerprintReader {
  public async readFile(filename: string, signal?: AbortSignal): Promise<FileFingerprint> {
    throwIfCancelled(signal);
    const before = await lstat(filename);
    if (!before.isFile()) {
      throw new Error('Not a regular file.');
    }
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!sameRegularFileVersion(before, opened)) {
        throw new Error('File changed during hashing.');
      }
      const stream = handle.createReadStream({ highWaterMark: CHUNK_BYTES, autoClose: false });
      const fingerprint = await this.readStream(stream, opened.size, signal);
      const after = await handle.stat();
      const named = await lstat(filename);
      if (!sameRegularFileVersion(after, opened) || !sameRegularFileVersion(named, opened)) {
        throw new Error('File changed during hashing.');
      }
      throwIfCancelled(signal);
      return { ...fingerprint, modifiedMs: after.mtimeMs };
    } finally {
      await handle.close();
    }
  }

  public async readStream(
    stream: Readable,
    expectedSize: number,
    signal?: AbortSignal
  ): Promise<StreamFingerprint> {
    const fingerprint = new ContentFingerprint();
    try {
      throwIfCancelled(signal);
      if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
        throw new Error('Invalid advertised size.');
      }
      // Abort a stalled stream as well as a stream that is producing chunks.
      if (signal) {
        addAbortSignal(signal, stream);
      }
      for await (const chunk of stream) {
        throwIfCancelled(signal);
        this.addChunk(fingerprint, chunk, expectedSize);
      }
      throwIfCancelled(signal);
      if (fingerprint.size !== expectedSize) {
        throw new Error('Truncated ROM data.');
      }
      return fingerprint.digest();
    } catch (error) {
      stream.destroy();
      throwIfCancelled(signal);
      throw error;
    }
  }

  private addChunk(fingerprint: ContentFingerprint, chunk: unknown, expectedSize: number): void {
    if (!(chunk instanceof Uint8Array)) {
      throw new Error('Fingerprint stream must contain bytes.');
    }
    if (fingerprint.size + chunk.length > expectedSize) {
      throw new Error('Archive member exceeds advertised size.');
    }
    fingerprint.update(chunk);
  }
}
