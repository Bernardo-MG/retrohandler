import type { FileHandle } from 'node:fs/promises';

/** Read a caller-bounded region at an explicit offset, rejecting premature EOF. */
export async function readExactly(
  handle: FileHandle,
  length: number,
  offset: number,
  errorMessage: string
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let received = 0;
  while (received < length) {
    const { bytesRead } = await handle.read(buffer, received, length - received, offset + received);
    if (!bytesRead) {
      throw new Error(errorMessage);
    }
    received += bytesRead;
  }
  return buffer;
}
