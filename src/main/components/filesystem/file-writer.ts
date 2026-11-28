import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readRegular } from './file-reader';
import { assertSafeDirectory } from './paths';

type FileReplacement = {
  targetPath: string;
  newContent: Buffer;
  approvedContent: Buffer;
  maxBytes: number;
  onBackup: (file: string) => void;
};

/** Exclusive creation and backed-up replacement with one naming policy. */
export class FileWriter {
  constructor(private readonly backupTag: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(backupTag)) {
      throw new Error('Invalid backup tag.');
    }
  }

  // Open exclusively so even a name collision cannot overwrite another file.
  // Flush the contents before considering a backup or replacement ready.
  public async createExclusive(file: string, content: Buffer): Promise<void> {
    const handle = await open(file, 'wx');
    try {
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      await rm(file, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Back up the approved bytes before replacing a file. Report the backup even if replacement fails. */
  public async replaceWithBackup(replacement: FileReplacement): Promise<void> {
    const { targetPath, newContent, approvedContent, maxBytes, onBackup } = replacement;
    const folder = path.dirname(targetPath);
    await assertSafeDirectory(folder);
    const suffix = randomUUID();
    const backup = `${targetPath}.${this.backupTag}-${suffix}.bak`;
    const temp = path.join(folder, `.replacement-${suffix}.tmp`);
    await this.createExclusive(temp, newContent);
    try {
      await this.createExclusive(backup, approvedContent);
      onBackup(backup);
      await assertSafeDirectory(folder);
      const current = await readRegular(targetPath, maxBytes);
      if (current === null || !current.equals(approvedContent)) {
        throw new Error(`File changed before replacement: ${targetPath}`);
      }
      await rename(temp, targetPath);
    } finally {
      await rm(temp, { force: true });
    }
  }
}
