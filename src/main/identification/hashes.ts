import { createReadStream } from 'node:fs';
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
  let crc = 0xffffffff;
  let bytes = 0;
  const md5 = createHash('md5');
  const sha1 = createHash('sha1');
  const stream = createReadStream(filename, { highWaterMark: 256 * 1024, signal });
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      md5.update(buffer);
      sha1.update(buffer);
      for (const value of buffer) crc = table[(crc ^ value) & 255] ^ (crc >>> 8);
    }
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('Identification cancelled.'), { name: 'AbortError' });
    throw error;
  }
  const after = await stat(filename);
  if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error('File changed during hashing.');
  }
  return { crc32: ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'),
    md5: md5.digest('hex'), sha1: sha1.digest('hex'), size: bytes, modifiedMs: after.mtimeMs };
}
