import type { Stats } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { RegularFileIdentity } from '../../components/filesystem/regular-file-identity';
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
    readonly identity: RegularFileIdentity,
    private readonly canonicalRoot: string
  ) {}

  public get filename(): string {
    return this.identity.filename;
  }

  public get stats(): Stats {
    return this.identity.stats;
  }

  public static async resolve(target: RomTarget): Promise<RomSource> {
    const root = path.resolve(target.source);
    const filename = path.resolve(root, target.relativePath);
    if (!childOf(root, filename)) {
      throw new Error('File is outside collection root.');
    }
    const identity = await RegularFileIdentity.observe(filename, 'File changed during identification.');
    const canonicalRoot = await realpath(root);
    if (!childOf(canonicalRoot, identity.canonicalFilename)) {
      throw new Error('File escapes collection.');
    }
    const file = new RomSource(target, identity, canonicalRoot);
    await file.assertUnchanged();
    return file;
  }

  public async assertUnchanged(): Promise<void> {
    const root = await realpath(this.target.source);
    if (root !== this.canonicalRoot || !childOf(root, this.identity.canonicalFilename)) {
      throw new Error('File changed during identification.');
    }
    await this.identity.assertUnchanged('File changed during identification.');
  }
}
