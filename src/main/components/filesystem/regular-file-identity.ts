import type { Stats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sameRegularFileVersion } from './file-version';

/** Observe a regular file and recheck its name, canonical path and version around an operation. */
export class RegularFileIdentity {
  private constructor(
    readonly filename: string,
    readonly canonicalFilename: string,
    readonly stats: Stats
  ) {}

  public static async observe(
    filename: string,
    message = 'File changed during reading.'
  ): Promise<RegularFileIdentity> {
    const absolute = path.resolve(filename);
    const stats = await lstat(absolute);
    if (!stats.isFile()) {
      throw new Error('Not a regular file.');
    }
    const canonical = await realpath(absolute);
    const identity = new RegularFileIdentity(absolute, canonical, stats);
    await identity.assertUnchanged(message);
    return identity;
  }

  public async assertUnchanged(message = 'File changed during reading.'): Promise<void> {
    const canonical = await realpath(this.filename);
    const current = await lstat(this.filename);
    if (canonical !== this.canonicalFilename || !sameRegularFileVersion(this.stats, current)) {
      throw new Error(message);
    }
  }
}
