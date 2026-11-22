import { opendir, lstat, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Rom, ScanProgress, ScanResult, ScanWarning } from '../shared';
import { inferPlatform, isCandidateRom } from './scanner/platforms';
import { titleFromName } from './scanner/naming';

export interface ScanOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
}

const MAX_FILES = 250_000;
const MAX_DEPTH = 15;
const PROGRESS_INTERVAL = 50;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Scan cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

/** Only track filenames referenced explicitly by a disc descriptor are hidden.
 * Descriptor parsing is intentionally limited to same-directory files; it never
 * opens paths from the descriptor or examines external files. */
function trackNames(extension: string, contents: string): Set<string> {
  const names = new Set<string>();
  if (extension === '.cue') {
    for (const line of contents.split(/\r?\n/)) {
      const m = /^\s*FILE\s+(?:"([^"]+)"|([^\s]+))\s+/i.exec(line);
      if (m) names.add(m[1] ?? m[2]);
    }
  } else if (extension === '.gdi') {
    for (const line of contents.split(/\r?\n/).slice(1)) {
      const m = /^\s*\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))\s+\d+/i.exec(line);
      if (m) names.add(m[1] ?? m[2]);
    }
  }
  return new Set([...names].filter(name => name === path.basename(name) && name !== '.' && name !== '..').map(name => name.toLowerCase()));
}

/** Read-only scan, with optional cancellation and progress callbacks.
 * The public return fields remain compatible with Patch 001. */
export async function scanRoms(folder: string, options: ScanOptions = {}): Promise<ScanResult> {
  throwIfAborted(options.signal);
  const root = await realpath(folder);
  if (!(await lstat(root)).isDirectory()) throw new Error('Please choose a directory.');
  const games: Rom[] = [];
  const warnings: ScanWarning[] = [];
  let ignored = 0;
  let filesVisited = 0;
  let directoriesVisited = 0;
  const pending: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const report = (currentPath: string) => options.onProgress?.({
    filesVisited, gamesFound: games.length, directoriesVisited, ignored,
    warnings: warnings.length, currentPath
  });
  const warn = (filePath: string, error: unknown) => {
    warnings.push({ relativePath: path.relative(root, filePath), message: error instanceof Error ? error.message : String(error) });
  };
  report(root);
  while (pending.length) {
    throwIfAborted(options.signal);
    const next = pending.pop()!;
    const entries: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];
    try {
      const directory = await opendir(next.dir);
      for await (const entry of directory) {
        throwIfAborted(options.signal);
        if (entry.isSymbolicLink()) continue;
        entries.push({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() });
      }
    } catch (error) {
      throwIfAborted(options.signal);
      // The selected root must be readable; nested directories may be skipped.
      if (next.dir === root) throw error;
      warn(next.dir, error);
      report(next.dir);
      continue;
    }
    directoriesVisited++;
    const tracks = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile || !/\.(cue|gdi)$/i.test(entry.name)) continue;
      const fullPath = path.join(next.dir, entry.name);
      try {
        // Limit descriptor read size to avoid accidentally loading huge files.
        const stats = await lstat(fullPath);
        if (stats.size > 1024 * 1024) throw new Error('Disc descriptor exceeds 1 MiB.');
        const contents = await readFile(fullPath, 'utf8');
        for (const track of trackNames(path.extname(entry.name).toLowerCase(), contents)) tracks.add(track);
      } catch (error) { warn(fullPath, error); }
    }
    for (const entry of entries) {
      throwIfAborted(options.signal);
      const fullPath = path.join(next.dir, entry.name);
      if (entry.isDirectory) {
        if (next.depth < MAX_DEPTH && !entry.name.startsWith('.')) pending.push({ dir: fullPath, depth: next.depth + 1 });
        else if (next.depth >= MAX_DEPTH) warn(fullPath, new Error('Maximum scan depth reached.'));
        continue;
      }
      if (!entry.isFile) continue;
      filesVisited++;
      const extension = path.extname(entry.name).toLowerCase();
      if (!isCandidateRom(entry.name) || (extension === '.bin' && tracks.has(entry.name.toLowerCase()))) {
        ignored++;
      } else {
        try {
          const stats = await lstat(fullPath);
          const relativePath = path.relative(root, fullPath);
          games.push({
            id: createHash('sha256').update(relativePath).digest('hex').slice(0, 16),
            name: titleFromName(entry.name), system: inferPlatform(relativePath),
            relativePath, extension, bytes: stats.size
          });
          if (games.length >= MAX_FILES) throw new Error(`Scan limit (${MAX_FILES.toLocaleString()} files) reached. Select a smaller collection.`);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Scan limit (')) throw error;
          warn(fullPath, error);
        }
      }
      if (filesVisited % PROGRESS_INTERVAL === 0) report(fullPath);
    }
    report(next.dir);
  }
  games.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name));
  report(root);
  return { source: root, games, ignored, scannedAt: new Date().toISOString(), warnings };
}
