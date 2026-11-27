import { realpathSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sameFile } from '../../utils/file-version';
import { childOf } from '../../utils/paths';
import { statIfExists, statIfExistsSync } from './file-reader';

const canonicalKey = (p: string) =>
  process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p);
/** Resolve an ordinary directory path, including any not-yet-created descendants. */
export async function resolveSafeDirectory(folder: string): Promise<string> {
  const current = path.resolve(folder);
  const parent = path.dirname(current);
  const canonicalParent = parent === current ? current : await resolveSafeDirectory(parent);
  const expected = parent === current ? current : path.join(canonicalParent, path.basename(current));
  const st = await statIfExists(current);
  if (!st) {
    return expected;
  }
  if (!st.isDirectory() || st.isSymbolicLink()) {
    throw new Error(`Directory redirected or not a directory: ${current}`);
  }
  const canonical = await realpath(current);
  if (canonicalKey(canonical) === canonicalKey(expected)) {
    return canonical;
  }
  // Windows may expand an 8.3 alias without redirecting the directory.
  if (
    process.platform === 'win32' &&
    /~[0-9]+(?:\.[^.]*)?$/.test(path.basename(current)) &&
    canonicalKey(path.dirname(canonical)) === canonicalKey(canonicalParent)
  ) {
    const resolved = await statIfExists(canonical);
    if (resolved?.isDirectory() && !resolved.isSymbolicLink() && sameFile(st, resolved)) {
      return canonical;
    }
  }
  throw new Error(`Directory redirected or not a directory: ${current}`);
}

/** Synchronous directory resolution for operations that must not yield. */
export function resolveSafeDirectorySync(folder: string): string {
  const current = path.resolve(folder);
  const parent = path.dirname(current);
  const canonicalParent = parent === current ? current : resolveSafeDirectorySync(parent);
  const expected = parent === current ? current : path.join(canonicalParent, path.basename(current));
  const st = statIfExistsSync(current);
  if (!st) {
    return expected;
  }
  if (!st.isDirectory() || st.isSymbolicLink()) {
    throw new Error(`Directory redirected or not a directory: ${current}`);
  }
  const canonical = realpathSync.native(current);
  if (canonicalKey(canonical) === canonicalKey(expected)) {
    return canonical;
  }
  // Windows may expand an 8.3 alias without redirecting the directory.
  if (
    process.platform === 'win32' &&
    /~[0-9]+(?:\.[^.]*)?$/.test(path.basename(current)) &&
    canonicalKey(path.dirname(canonical)) === canonicalKey(canonicalParent)
  ) {
    const resolved = statIfExistsSync(canonical);
    if (resolved?.isDirectory() && !resolved.isSymbolicLink() && sameFile(st, resolved)) {
      return canonical;
    }
  }
  throw new Error(`Directory redirected or not a directory: ${current}`);
}

export async function assertSafeDirectory(folder: string): Promise<void> {
  await resolveSafeDirectory(folder);
}

export async function ensureSafeDirectory(folder: string): Promise<void> {
  await assertSafeDirectory(folder);
  await mkdir(folder, { recursive: true });
  await assertSafeDirectory(folder);
}

/** Check a path under an already resolved root without accepting redirected children. */
export async function assertUnredirectedPath(root: string, filename: string): Promise<void> {
  const canonical = await realpath(filename);
  const contained = !path.relative(root, canonical) || childOf(root, canonical);
  if (!contained || path.relative(filename, canonical)) {
    throw new Error(`Path redirected or outside root: ${filename}`);
  }
}
