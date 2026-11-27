import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { addAbortSignal, type Readable } from 'node:stream';
import { throwIfCancelled } from '../async/cancellation';
import { sameRegularFileVersion } from '../filesystem/file-version';
import { RegularFileIdentity } from '../filesystem/regular-file-identity';
import { StreamSizeVerifier } from '../streams/stream-size-verifier';
import { ContentFingerprint, type FileFingerprint, type StreamFingerprint } from './content-fingerprint';

const CHUNK_BYTES = 256 * 1024;

/** Verify byte counts and file identity while calculating streaming fingerprints. */
export class FingerprintReader {
  public async readFile(filename: string, signal?: AbortSignal): Promise<FileFingerprint> {
    throwIfCancelled(signal);
    const identity = await RegularFileIdentity.observe(filename, 'File changed during hashing.');
    throwIfCancelled(signal);
    const handle = await open(identity.filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!sameRegularFileVersion(identity.stats, opened)) {
        throw new Error('File changed during hashing.');
      }
      const stream = handle.createReadStream({ highWaterMark: CHUNK_BYTES, autoClose: false });
      const fingerprint = await this.readStream(stream, opened.size, signal);
      const after = await handle.stat();
      if (!sameRegularFileVersion(after, opened)) {
        throw new Error('File changed during hashing.');
      }
      await identity.assertUnchanged('File changed during hashing.');
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
      const size = new StreamSizeVerifier(expectedSize, {
        invalidSize: 'Invalid advertised size.',
        invalidChunk: 'Fingerprint stream must contain bytes.',
        oversized: 'Stream exceeds advertised size.',
        truncated: 'Truncated stream data.'
      });
      // Abort a stalled stream as well as a stream that is producing chunks.
      if (signal) {
        addAbortSignal(signal, stream);
      }
      for await (const chunk of stream) {
        throwIfCancelled(signal);
        fingerprint.update(size.accept(chunk));
      }
      throwIfCancelled(signal);
      size.assertComplete();
      return fingerprint.digest();
    } catch (error) {
      stream.destroy();
      throwIfCancelled(signal);
      throw error;
    }
  }
}
