import type { Stats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sameRegularFileVersion } from '../../components/filesystem/file-version';
import { childOf } from '../../components/filesystem/paths';

export interface RomTarget {
  source: string;
  relativePath: string;
  extension: string;
}

/** A regular collection file and its observed identity, for one identification attempt. */
export class RomSource {
  private constructor(
    readonly target: RomTarget,
    readonly filename: string,
    readonly stats: Stats,
    private readonly canonicalRoot: string,
    private readonly canonicalFile: string
  ) {}

  public static async resolve(target: RomTarget): Promise<RomSource> {
    const root = path.resolve(target.source);
    const filename = path.resolve(root, target.relativePath);
    if (!childOf(root, filename)) {
      throw new Error('File is outside collection root.');
    }
    const stats = await lstat(filename);
    if (!stats.isFile()) {
      throw new Error('Not a regular file.');
    }
    const canonicalRoot = await realpath(root);
    const canonicalFile = await realpath(filename);
    if (!childOf(canonicalRoot, canonicalFile)) {
      throw new Error('File escapes collection.');
    }
    const file = new RomSource(target, filename, stats, canonicalRoot, canonicalFile);
    await file.assertUnchanged();
    return file;
  }

  public async assertUnchanged(): Promise<void> {
    const root = await realpath(this.target.source);
    const file = await realpath(this.filename);
    const current = await lstat(this.filename);
    if (
      root !== this.canonicalRoot ||
      file !== this.canonicalFile ||
      !childOf(root, file) ||
      !sameRegularFileVersion(this.stats, current)
    ) {
      throw new Error('File changed during identification.');
    }
  }
}
