import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { readRegular } from '../filesystem/file-reader';
import { assertSafeDirectory, childOf, ensureSafeDirectory, overlaps } from '../filesystem/paths';

/** A root-scoped filesystem destination. Resolve and recheck paths on every access. */
export class FileDestination {
  readonly root: string;

  constructor(root: string) {
    if (!path.isAbsolute(root)) {
      throw new Error('Choose an absolute destination folder.');
    }
    this.root = path.resolve(root);
  }

  async validate(protectedRoots: readonly string[], overlapMessage = 'Destination overlaps a protected directory.'): Promise<void> {
    await assertSafeDirectory(this.root);
    const destinationKey = this.root.toLowerCase();
    const roots = new Set(protectedRoots.map(root => path.resolve(root)));
    for (const root of roots) {
      if (overlaps(root.toLowerCase(), destinationKey)) {
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

  resolve(relative: string): string {
    const target = path.join(this.root, ...relative.split('/'));
    if (!childOf(this.root, target)) {
      throw new Error('Invalid export destination path.');
    }
    return target;
  }

  async checkParent(relative: string): Promise<string> {
    const target = this.resolve(relative);
    await assertSafeDirectory(path.dirname(target));
    return target;
  }

  async read(relative: string, maxBytes: number): Promise<Buffer | null> {
    return readRegular(await this.checkParent(relative), maxBytes);
  }

  async ensureParent(relative: string): Promise<string> {
    const target = this.resolve(relative);
    await ensureSafeDirectory(path.dirname(target));
    return target;
  }

  relative(file: string): string {
    if (!childOf(this.root, file)) {
      throw new Error('Invalid export destination path.');
    }
    return path.relative(this.root, file).split(path.sep).join('/');
  }
}
