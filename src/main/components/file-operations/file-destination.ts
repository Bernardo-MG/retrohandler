import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { childOf } from '../../utils/paths';
import { readRegular } from '../filesystem/file-reader';
import { assertSafeDirectory, ensureSafeDirectory, resolveSafeDirectory } from '../filesystem/paths';

const overlaps = (a: string, b: string) => a === b || childOf(a, b) || childOf(b, a);

/** A root-scoped filesystem destination. Resolve and recheck paths on every access. */
export class FileDestination {
  public readonly root: string;

  constructor(root: string) {
    if (!path.isAbsolute(root)) {
      throw new Error('Choose an absolute destination folder.');
    }
    this.root = path.resolve(root);
  }

  public async validateAgainst(
    protectedRoots: readonly string[],
    overlapMessage = 'Destination overlaps a protected directory.'
  ): Promise<void> {
    const destinationKey = (await resolveSafeDirectory(this.root)).toLowerCase();
    const roots = new Set(protectedRoots.map((root) => path.resolve(root)));
    for (const root of roots) {
      if (overlaps(root.toLowerCase(), this.root.toLowerCase())) {
        throw new Error(overlapMessage);
      }
    }
    // Also protect canonical source roots, even if the destination does not exist yet.
    for (const root of roots) {
      const realRoot = await realpath(root).catch(() => root);
      if (overlaps(realRoot.toLowerCase(), destinationKey)) {
        throw new Error(overlapMessage);
      }
    }
  }

  public resolvePath(relativePath: string): string {
    const target = path.join(this.root, ...relativePath.split('/'));
    if (!childOf(this.root, target)) {
      throw new Error('Invalid export destination path.');
    }
    return target;
  }

  public async assertSafeParent(relativePath: string): Promise<string> {
    const target = this.resolvePath(relativePath);
    await assertSafeDirectory(path.dirname(target));
    return target;
  }

  public async readFile(relativePath: string, maxBytes: number): Promise<Buffer | null> {
    return readRegular(await this.assertSafeParent(relativePath), maxBytes);
  }

  public async ensureParentDirectory(relativePath: string): Promise<string> {
    const target = this.resolvePath(relativePath);
    await ensureSafeDirectory(path.dirname(target));
    return target;
  }

  public relativePathOf(file: string): string {
    if (!childOf(this.root, file)) {
      throw new Error('Invalid export destination path.');
    }
    return path.relative(this.root, file).split(path.sep).join('/');
  }
}
