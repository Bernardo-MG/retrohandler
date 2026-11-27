import { readdirSync, unlinkSync, type Stats } from 'node:fs';
import path from 'node:path';
import { statIfExistsSync } from '../filesystem/file-reader';
import { sameRegularFileVersion } from '../filesystem/file-version';
import { resolveSafeDirectorySync } from '../filesystem/paths';
import { isTemporaryImageName } from './image-cache-files';
import { isImageId } from './image-identifier';

interface CachedFile {
  name: string;
  stats: Stats;
  reclaimable: boolean;
}

export interface ImageCacheStatistics {
  cacheFiles: number;
  cacheBytes: number;
  reclaimableFiles: number;
  reclaimableBytes: number;
}

export interface ImageCacheCleanup {
  removedFiles: number;
  removedBytes: number;
  failedFiles: number;
}

/** Account for recognized image files and abandoned temporary writes. */
export class ImageCacheMaintenance {
  constructor(
    private readonly root: string,
    private readonly retentionMs: number,
    private readonly temporaryRetentionMs: number
  ) {}

  public inspect(referenced: ReadonlySet<string>, now: number): ImageCacheStatistics {
    const statistics = { cacheFiles: 0, cacheBytes: 0, reclaimableFiles: 0, reclaimableBytes: 0 };
    for (const file of this.listFiles(referenced, now)) {
      statistics.cacheFiles++;
      statistics.cacheBytes += file.stats.size;
      if (file.reclaimable) {
        statistics.reclaimableFiles++;
        statistics.reclaimableBytes += file.stats.size;
      }
    }
    return statistics;
  }

  /** Keep selection and deletion synchronous so the caller can supply fresh references. */
  public cleanup(referenced: ReadonlySet<string>, now: number): ImageCacheCleanup {
    const receipt = { removedFiles: 0, removedBytes: 0, failedFiles: 0 };
    for (const file of this.listFiles(referenced, now)) {
      if (!file.reclaimable) {
        continue;
      }
      try {
        const directory = resolveSafeDirectorySync(this.root);
        const filename = path.join(directory, file.name);
        const current = statIfExistsSync(filename);
        if (!current || !sameRegularFileVersion(file.stats, current)) {
          throw new Error('Cached file changed before cleanup.');
        }
        unlinkSync(filename);
        receipt.removedFiles++;
        receipt.removedBytes += file.stats.size;
      } catch {
        receipt.failedFiles++;
      }
    }
    return receipt;
  }

  private listFiles(referenced: ReadonlySet<string>, now: number): CachedFile[] {
    const root = resolveSafeDirectorySync(this.root);
    const directory = statIfExistsSync(root);
    if (!directory) {
      return [];
    }
    if (!directory.isDirectory()) {
      throw new Error('Image cache is not a regular directory.');
    }
    const result: CachedFile[] = [];
    for (const name of readdirSync(root)) {
      const file = this.inspectFile(root, name, referenced, now);
      if (file) {
        result.push(file);
      }
    }
    return result;
  }

  private inspectFile(
    root: string,
    name: string,
    referenced: ReadonlySet<string>,
    now: number
  ): CachedFile | null {
    const image = isImageId(name);
    if (!image && !isTemporaryImageName(name)) {
      return null;
    }
    const stats = statIfExistsSync(path.join(root, name));
    // Do not follow symlinks, junctions or directories.
    if (!stats?.isFile()) {
      return null;
    }
    const age = now - stats.mtimeMs;
    const reclaimable = image
      ? !referenced.has(name) && age >= this.retentionMs
      : age >= this.temporaryRetentionMs;
    return { name, stats, reclaimable };
  }
}
