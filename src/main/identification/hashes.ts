import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

export interface RomHashes { crc32: string; md5: string; sha1: string; size: number; modifiedMs: number; }
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let n = 0; n < 8; n++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

/** Streaming hashes: no ROM content is held in memory. Does not mutate source files. */
export async function hashRom(filename: string, signal?: AbortSignal): Promise<RomHashes> {
  if (signal?.aborted) throw Object.assign(new Error('Identification cancelled.'), { name: 'AbortError' });
  const before = await stat(filename);
  if (!before.isFile()) throw new Error('Not a regular file.');
  const computed = await hashReadable(createReadStream(filename, { highWaterMark: 256 * 1024, signal }), before.size, signal);
  const after = await stat(filename);
  if (computed.size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error('File changed during hashing.');
  }
  return { ...computed, modifiedMs: after.mtimeMs };
}

/** Hash a streamed decompressed ROM; reject over-sized or truncated archive members. */
export async function hashReadable(stream: Readable, expectedSize: number, signal?: AbortSignal): Promise<Omit<RomHashes, 'modifiedMs'>> {
  let crc = 0xffffffff, bytes = 0;
  const md5 = createHash('md5'), sha1 = createHash('sha1');
  try {
    for await (const value of stream) {
      if (signal?.aborted) throw Object.assign(new Error('Identification cancelled.'), { name: 'AbortError' });
      const buffer = value as Buffer;
      bytes += buffer.length;
      if (bytes > expectedSize) throw new Error('Archive member exceeds advertised size.');
      md5.update(buffer); sha1.update(buffer);
      for (const octet of buffer) crc = table[(crc ^ octet) & 255] ^ (crc >>> 8);
    }
  } catch (error) {
    stream.destroy();
    if (signal?.aborted) throw Object.assign(new Error('Identification cancelled.'), { name: 'AbortError' });
    throw error;
  }
  if (bytes !== expectedSize) throw new Error('Truncated ROM data.');
  return { crc32: ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'), md5: md5.digest('hex'), sha1: sha1.digest('hex'), size: bytes };
}
