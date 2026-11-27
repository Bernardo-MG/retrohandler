import { createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Write a verified entry stream to an explicitly chosen, new destination. */
export async function writeArchiveEntry(
  source: Readable,
  destination: string,
  signal?: AbortSignal
): Promise<void> {
  await pipeline(source, createWriteStream(destination, { flags: 'wx' }), { signal });
}
