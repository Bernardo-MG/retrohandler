import { constants, lstatSync, type Stats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { sameFile, sameVersion } from './file-version';

// Only a missing file counts as absent. Permission errors, links and other
// file types must never be mistaken for a free destination path.
export async function statIfExists(file: string): Promise<Stats | null> {
  try {
    return await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Windows can report ENOENT for a child of a regular file.
      if (process.platform === 'win32') {
        const parent = path.dirname(path.resolve(file));
        if (parent !== path.resolve(file)) {
          const info = await statIfExists(parent);
          if (info && !info.isDirectory()) {
            throw new Error(`ENOTDIR: not a directory: ${parent}`);
          }
        }
      }
      return null;
    }
    throw error;
  }
}

/** Synchronous counterpart for operations that must not yield between checking and acting. */
export function statIfExistsSync(file: string): Stats | null {
  try {
    return lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (process.platform === 'win32') {
        const parent = path.dirname(path.resolve(file));
        if (parent !== path.resolve(file)) {
          const info = statIfExistsSync(parent);
          if (info && !info.isDirectory()) {
            throw new Error(`ENOTDIR: not a directory: ${parent}`);
          }
        }
      }
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
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(opened, before) || opened.size > maxBytes) {
      throw new Error(`File changed: ${file}`);
    }
    const bytes = await readObservedBytes(handle, opened.size);
    const after = await handle.stat();
    const named = await statIfExists(file);
    if (bytes.length !== opened.size || !sameVersion(after, opened) || !matchesNamedFile(named, opened)) {
      throw new Error(`File changed: ${file}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function matchesNamedFile(named: Stats | null, opened: Stats): boolean {
  return named !== null && named.isFile() && sameFile(named, opened) && sameVersion(named, opened);
}

async function readObservedBytes(handle: FileHandle, observedSize: number): Promise<Buffer> {
  // Read at most the approved file size plus one byte, even if it grows.
  const buffer = Buffer.alloc(observedSize + 1);
  let count = 0;
  while (count < buffer.length) {
    const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
    if (!bytesRead) {
      break;
    }
    count += bytesRead;
  }
  return buffer.subarray(0, count);
}
