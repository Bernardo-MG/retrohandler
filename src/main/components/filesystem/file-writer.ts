import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readRegular } from './file-reader';
import { assertSafeDirectory } from './paths';

// Open exclusively so even a name collision cannot overwrite another file.
// Flush the contents before considering a backup or replacement ready.
export async function writeExclusive(file: string, content: Buffer): Promise<void> {
  const handle = await open(file, 'wx');
  try {
    try {
      await handle.writeFile(content);
      await handle.sync();
    }
    finally {
      await handle.close();
    }
  } catch (error) {
    await rm(file, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Back up the approved bytes before replacing a file. Report the backup even if replacement fails. */
export async function replaceWithBackup(
  file: string,
  content: Buffer,
  previous: Buffer,
  maxBytes: number,
  backupTag: string,
  onBackup: (file: string) => void
): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(backupTag)) {
    throw new Error('Invalid backup tag.');
  }
  const folder = path.dirname(file);
  await assertSafeDirectory(folder);
  const suffix = randomUUID();
  const backup = `${file}.${backupTag}-${suffix}.bak`;
  const temp = path.join(folder, `.replacement-${suffix}.tmp`);
  await writeExclusive(temp, content);
  try {
    await writeExclusive(backup, previous);
    onBackup(backup);
    await assertSafeDirectory(folder);
    const current = await readRegular(file, maxBytes);
    if (current === null || !current.equals(previous)) {
      throw new Error(`File changed before replacement: ${file}`);
    }
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
