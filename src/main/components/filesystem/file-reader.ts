import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

// Only a missing file counts as absent. Permission errors, links and other
// file types must never be mistaken for a free destination path.
export async function statIfExists(file: string) {
  try {
    return await lstat(file);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function readRegular(file: string, maxBytes: number): Promise<Buffer | null> {
  const before = await statIfExists(file);
  if (!before) {
    return null;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw new Error(`Unsafe or oversized file: ${file}`);
  }
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.dev !== before.dev || st.ino !== before.ino || st.size > maxBytes) {
      throw new Error(`File changed: ${file}`);
    }
    // Read at most the approved file size plus one byte, even if it grows.
    const buffer = Buffer.alloc(st.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) {
        break;
      }
      count += bytesRead;
    }
    const after = await handle.stat();
    const named = await statIfExists(file);
    if (count !== st.size || after.size !== st.size || after.mtimeMs !== st.mtimeMs ||
      !named?.isFile() || named.dev !== st.dev || named.ino !== st.ino || named.mtimeMs !== st.mtimeMs || named.size !== st.size) {
      throw new Error(`File changed: ${file}`);
    }
    return buffer.subarray(0, count);
  } finally {
    await handle.close();
  }
}
