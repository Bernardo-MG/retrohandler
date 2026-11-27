import { randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, unlinkSync, type Stats } from 'node:fs';
import { lstat, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { readRegular } from '../filesystem/file-reader';
import { assertSafeDirectory, ensureSafeDirectory } from '../filesystem/paths';
import { identifyArtwork, isArtworkId, MAX_ARTWORK_BYTES } from './artwork-image';

const TEMPORARY_NAME = /^\.download-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DAY = 24 * 60 * 60 * 1000;
const ARTWORK_RETENTION_MS = 7 * DAY;
const TEMPORARY_RETENTION_MS = DAY;
interface CachedFile {
  name: string;
  size: number;
  reclaimable: boolean;
}

export interface CachedArtwork {
  body: Buffer;
  mime: string;
}

export interface ArtworkFile {
  path: string;
  size: number;
}

export class ArtworkCache {
  public readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  public pathFor(id: string): string {
    if (!isArtworkId(id)) {
      throw new Error('Invalid artwork ID.');
    }
    return path.join(this.root, id);
  }

  public async store(bytes: Buffer): Promise<string> {
    const { id } = identifyArtwork(bytes);
    await ensureSafeDirectory(this.root);
    const temp = path.join(this.root, `.download-${randomUUID()}`);
    // Only remove a temporary file after this call successfully creates it.
    const handle = await open(temp, 'wx');
    try {
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      await assertSafeDirectory(this.root);
      await rename(temp, this.pathFor(id));
    } finally {
      await rm(temp, { force: true });
    }
    return id;
  }

  public async read(id: string): Promise<CachedArtwork> {
    const file = this.pathFor(id);
    await assertSafeDirectory(this.root);
    try {
      const body = await readRegular(file, MAX_ARTWORK_BYTES);
      if (body === null) {
        throw new Error('Artwork is absent.');
      }
      const image = identifyArtwork(body);
      if (image.id !== id) {
        throw new Error('Artwork identity changed.');
      }
      return { body, mime: image.mime };
    } catch {
      throw new Error('Invalid cached artwork.');
    }
  }

  /** Inspect a source for export; the export planner verifies its content hash. */
  public async find(id: string): Promise<ArtworkFile | null> {
    const file = this.pathFor(id);
    try {
      await assertSafeDirectory(this.root);
      const info = await lstat(file);
      return info.isFile() && info.size <= MAX_ARTWORK_BYTES ? { path: file, size: info.size } : null;
    } catch {
      return null;
    }
  }

  public inspect(referenced: ReadonlySet<string>, now = Date.now()) {
    const statistics = { artworkFiles: 0, artworkBytes: 0, reclaimableFiles: 0, reclaimableBytes: 0 };
    for (const file of this.listFiles(referenced, now)) {
      statistics.artworkFiles++;
      statistics.artworkBytes += file.size;
      if (file.reclaimable) {
        statistics.reclaimableFiles++;
        statistics.reclaimableBytes += file.size;
      }
    }
    return statistics;
  }

  /** Only old, recognized, unreferenced files are eligible. The main process obtains
   * references from SQLite immediately before this synchronous operation. */
  public cleanup(referenced: ReadonlySet<string>, now = Date.now()) {
    const receipt = { removedFiles: 0, removedBytes: 0, failedFiles: 0 };
    for (const file of this.listFiles(referenced, now)) {
      if (!file.reclaimable) {
        continue;
      }
      try {
        unlinkSync(path.join(this.root, file.name));
        receipt.removedFiles++;
        receipt.removedBytes += file.size;
      } catch {
        receipt.failedFiles++;
      }
    }
    return receipt;
  }

  private listFiles(referenced: ReadonlySet<string>, now: number): CachedFile[] {
    const directory = statIfExistsSync(this.root);
    if (!directory) {
      return [];
    }
    if (!directory.isDirectory()) {
      throw new Error('Artwork cache is not a regular directory.');
    }
    const result: CachedFile[] = [];
    for (const name of readdirSync(this.root)) {
      const file = this.inspectFile(name, referenced, now);
      if (file) {
        result.push(file);
      }
    }
    return result;
  }

  private inspectFile(name: string, referenced: ReadonlySet<string>, now: number): CachedFile | null {
    const artwork = isArtworkId(name);
    if (!artwork && !TEMPORARY_NAME.test(name)) {
      return null;
    }
    const info = statIfExistsSync(path.join(this.root, name));
    // Do not follow symlinks, junctions or directories.
    if (!info?.isFile()) {
      return null;
    }
    const age = now - info.mtimeMs;
    const reclaimable = artwork
      ? !referenced.has(name) && age >= ARTWORK_RETENTION_MS
      : age >= TEMPORARY_RETENTION_MS;
    return { name, size: info.size, reclaimable };
  }
}

function statIfExistsSync(file: string): Stats | null {
  try {
    return lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
