import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { statIfExists } from './file-reader';

export const childOf = (parent: string, child: string) => {
  const rel = path.relative(parent, child);
  return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
export const overlaps = (a: string, b: string) => a === b || childOf(a, b) || childOf(b, a);

const canonicalKey = (p: string) => process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p);
export async function assertSafeDirectory(folder: string): Promise<void> {
  // Check every ancestor, including those above a not-yet-created folder.
  for (let current = folder; ; current = path.dirname(current)) {
    const st = await statIfExists(current);
    if (st && (!st.isDirectory() || st.isSymbolicLink() ||
      canonicalKey(await realpath(current)) !== canonicalKey(current))) {
      throw new Error(`Directory redirected or not a directory: ${current}`);
    }
    if (path.dirname(current) === current) {
      break;
    }
  }
}

export async function ensureSafeDirectory(folder: string): Promise<void> {
  await assertSafeDirectory(folder);
  await mkdir(folder, { recursive: true });
  await assertSafeDirectory(folder);
}
