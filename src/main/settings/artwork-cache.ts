import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { CacheCleanupReceipt } from '../../shared';

const artworkName = /^[a-f0-9]{64}\.(jpg|png|webp)$/;
const temporaryName = /^\.download-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DAY = 24 * 60 * 60 * 1000;
interface CachedFile {
  name: string;
  size: number;
  reclaimable: boolean;
}

function files(root: string, referenced: ReadonlySet<string>, now: number): CachedFile[] {
  try {
    if (!lstatSync(root).isDirectory()) {
      throw new Error('Artwork cache is not a regular directory.');
    }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const result: CachedFile[] = [];
  for (const name of readdirSync(root)) {
    const artwork = artworkName.test(name);
    if (!artwork && !temporaryName.test(name)) {
      continue;
    }
    let stat;
    try {
      stat = lstatSync(path.join(root, name));
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    if (!stat.isFile()) {
      continue;
    } // Do not follow symlinks, junctions or directories.
    const age = now - stat.mtimeMs;
    result.push({
      name,
      size: stat.size,
      reclaimable: artwork ? !referenced.has(name) && age >= 7 * DAY : age >= DAY
    });
  }
  return result;
}
export function inspectArtworkCache(root: string, referenced: ReadonlySet<string>, now = Date.now()) {
  const entries = files(root, referenced, now);
  const reclaimable = entries.filter(file => file.reclaimable);
  return {
    artworkFiles: entries.length,
    artworkBytes: entries.reduce((sum, file) => sum + file.size, 0),
    reclaimableFiles: reclaimable.length,
    reclaimableBytes: reclaimable.reduce((sum, file) => sum + file.size, 0)
  };
}

/** Only old, recognized, unreferenced files are eligible. The main process obtains
 * references from SQLite immediately before this synchronous operation. */
export function cleanupArtworkCache(root: string, referenced: ReadonlySet<string>, now = Date.now()): CacheCleanupReceipt {
  const receipt = { removedFiles: 0, removedBytes: 0, failedFiles: 0 };
  for (const file of files(root, referenced, now)) {
    if (!file.reclaimable) {
      continue;
    }
    try {
      unlinkSync(path.join(root, file.name));
      receipt.removedFiles++;
      receipt.removedBytes += file.size;
    }
    catch {
      receipt.failedFiles++;
    }
  }
  return receipt;
}
